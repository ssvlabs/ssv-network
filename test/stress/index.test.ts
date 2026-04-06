// Stress test: 5-year simulation of SSV Network v2.0.0.
// Generates ~1500 randomized write transactions across ~13M blocks.
// After every transaction, verifies TS simulation state matches on-chain state.

import * as path from 'path';
import * as fs from 'fs';
import { getTestConnection } from '../setup/connection.ts';
import { setupStressTest, toClusterStruct, makeValKey, parsedToStruct, parseOperatorId, getSigner } from './setup.ts';
import { checkState } from './checkState.ts';
import { ALL_ACTIONS, liquidateClusterDirectly, depositToClusterDirectly, migrateClusterDirectly, reactivateClusterDirectly } from './actions.ts';
import type { WeightedAction } from './actions.ts';
import { DEFAULT_SHARES, EMPTY_CLUSTER } from '../common/constants.ts';
import { parseClusterFromEvent } from '../helpers/cluster.ts';
import { computeClusterId } from '../helpers/oracle.ts';
import { Events } from '../common/events.ts';
import { teardown } from './teardown.ts';
import { RunReport } from './report.ts';
import { mulberry32, pickWeighted } from './random.ts';
import type { RNG } from './random.ts';
import {
  advanceAll,
  onSyncFees,
  onSettleUser,
  isLiquidatable,
  liquidationThreshold,
  VERSION_ETH,
  VERSION_SSV,
  BPS_DENOMINATOR,
  DEFAULT_EB,
} from './state.ts';
import type { SimState } from './state.ts';
import type { StressSetup } from './setup.ts';
import {
  STRESS_TARGET_WRITE_TXS,
  DEFAULT_RNG_SEED,
  FALLBACK_ETH_PRICE_USD,
  SEED_ETH,
  STRESS_SSV_CLUSTERS,
  STRESS_ETH_CLUSTERS,
  STRESS_OPERATORS_PRE_UPGRADE,
  STRESS_OPERATORS_POST_UPGRADE,
  STRESS_STAKER_START_IDX,
  STRESS_COOLDOWN_SECS,
  ETH_DEDUCTED_DIGITS,
  TARGET_OPERATOR_ETH_FEE,
  STRESS_TOTAL_SIGNERS,
} from './constants.ts';

// ── Fetch current ETH price from CoinGecko ─────────────────────────────────

async function fetchEthPriceUSD(): Promise<number> {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return FALLBACK_ETH_PRICE_USD;
    const data = await res.json() as any;
    const price = data?.ethereum?.usd;
    return typeof price === 'number' && price > 0 ? price : FALLBACK_ETH_PRICE_USD;
  } catch {
    return FALLBACK_ETH_PRICE_USD;
  }
}

// ── Safe block mining helpers ──────────────────────────────────────────────

/**
 * Pick a safe block count to mine.
 *
 * Strategy:
 *   1. Find the cluster whose balance hits 0 soonest from currentBlock.
 *      That gives a hard ceiling — we must mine fewer blocks than that.
 *   2. Within [1, ceiling], pick randomly (up to ~1 day / 8760 blocks max).
 *   3. Retry up to 20 times to also satisfy the soft rule: ≤5% of active
 *      clusters become liquidatable. Falls back to 1 block if all retries fail.
 */
function pickSafeBlockCount(simState: SimState, currentBlock: bigint, rng: RNG): bigint {
  const activeClusters = [...simState.clusters.values()].filter(c => c.active);

  // ── Step 1: find the cluster that hits 0 the soonest ──────────────────
  let minBlocksToZero = 8760n; // default ceiling when no cluster is close
  for (const c of activeClusters) {
    let bpb: bigint;
    let snapshotBlock: bigint;
    let snapshotBalance: bigint;

    if (c.version === VERSION_ETH) {
      if (c.effectiveBalance === 0n) continue;
      bpb = c.burnRate * (c.effectiveBalance * BPS_DENOMINATOR / DEFAULT_EB) / BPS_DENOMINATOR;
      snapshotBlock = c.block;
      snapshotBalance = c.balance;
    } else {
      if (c.validatorCount === 0n) continue;
      bpb = c.ssvBurnRate * c.validatorCount;
      snapshotBlock = c.ssvBlock;
      snapshotBalance = c.ssvBalance;
    }

    if (bpb === 0n) continue;

    // Block at which this cluster's balance hits 0 (from its last snapshot).
    // balance(block) = snapshotBalance - (block - snapshotBlock) * bpb = 0
    //   → block = snapshotBlock + snapshotBalance / bpb  (floor)
    const zeroBlock = snapshotBlock + snapshotBalance / bpb;
    const blocksFromNow = zeroBlock > currentBlock ? zeroBlock - currentBlock : 0n;
    if (blocksFromNow < minBlocksToZero) minBlocksToZero = blocksFromNow;
  }

  // We must mine strictly fewer than minBlocksToZero blocks (so no cluster hits exactly 0).
  // Cap at 8760 (≈1 day) and ensure at least 1.
  const hardCeiling = minBlocksToZero > 1n ? minBlocksToZero - 1n : 1n;
  const upperBound = hardCeiling < 8760n ? hardCeiling : 8760n;

  // ── Step 2: pick randomly within [1, upperBound], respecting ≤5% liquidatable ──
  for (let attempt = 0; attempt < 20; attempt++) {
    // nextInt(n) returns [0, n-1], so +1n gives [1, upperBound]
    const blocks = 1n + rng.nextInt(upperBound);
    const endBlock = currentBlock + blocks;

    const liquidatableCount = activeClusters.filter(c => {
      if (c.version === VERSION_ETH) {
        if (c.effectiveBalance === 0n) return false;
        const delta = endBlock > c.block ? endBlock - c.block : 0n;
        const cost = delta * c.burnRate * (c.effectiveBalance * BPS_DENOMINATOR / DEFAULT_EB) / BPS_DENOMINATOR;
        const projBal = c.balance > cost ? c.balance - cost : 0n;
        return projBal < liquidationThreshold(c, simState);
      } else {
        if (c.validatorCount === 0n) return false;
        const delta = endBlock > c.ssvBlock ? endBlock - c.ssvBlock : 0n;
        const cost = delta * c.ssvBurnRate * c.validatorCount;
        const projBal = c.ssvBalance > cost ? c.ssvBalance - cost : 0n;
        return projBal < liquidationThreshold(c, simState);
      }
    }).length;

    if (activeClusters.length === 0 || liquidatableCount / activeClusters.length <= 0.05) {
      return blocks;
    }
  }

  // Couldn't satisfy ≤5% in 20 tries — use 1 block (always safe)
  return 1n;
}

/**
 * After mining blocks, handle all clusters that are now liquidatable:
 *   - SSV clusters: always liquidate (no SSV top-up option).
 *   - ETH clusters: 80% of the time rescue with a large deposit; 20% liquidate instead.
 *     Deposit gives 50× the liquidation threshold, dramatically reducing re-rescue frequency.
 *     If the deposit fails or the cluster is still at risk after depositing, liquidate anyway.
 */
async function handleLiquidatableClusters(
  setup: StressSetup,
  provider: any,
  rng: RNG,
  report: RunReport,
): Promise<void> {
  const { simState } = setup;
  const currentBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  const toHandle = [...simState.clusters.values()].filter(c => isLiquidatable(c, simState));
  for (const cluster of toHandle) {
    if (cluster.version === VERSION_SSV) {
      // SSV clusters: always liquidate
      await liquidateClusterDirectly(cluster, setup, report);
    } else {
      // ETH clusters: 20% chance to liquidate instead of rescue (1-in-5)
      const liquidateInstead = rng.nextInt(5n) === 0n;
      if (liquidateInstead) {
        await liquidateClusterDirectly(cluster, setup, report);
      } else {
        // Deposit 50× the liquidation threshold — gives substantial runway before next rescue
        const threshold = liquidationThreshold(cluster, simState);
        const depositAmount = threshold * 50n;
        const ok = await depositToClusterDirectly(cluster, depositAmount, setup, report);
        if (!ok || isLiquidatable(cluster, simState)) {
          await liquidateClusterDirectly(cluster, setup, report);
        }
      }
    }
  }
}

describe('Stress Test', function () {
  this.timeout(86_400_000); // 24 hours max

  it('runs without invariant violations', async function () {
    const { connection, networkHelpers } = await getTestConnection();
    const provider = connection.ethers.provider as any;

    // ── Fetch ETH price for report ─────────────────────────────────────
    const ethPriceUSD = await fetchEthPriceUSD();

    // ── RNG — shared across setup (fee randomisation) and main loop ────
    const rng = mulberry32(DEFAULT_RNG_SEED);

    console.log(`\nSSV Network Stress Test — ${STRESS_TARGET_WRITE_TXS.toLocaleString()} TXs`);
    process.stdout.write('  pre-upgrade: deploying & registering operators...\r');

    // ── Deploy and set up the full network ─────────────────────────────
    const setup = await setupStressTest(connection, networkHelpers, rng);

    process.stdout.write('  post-upgrade: verifying initial state...          \r');

    // ── Initial state check ────────────────────────────────────────────
    await checkState(setup, 'initial');

    const report = new RunReport();
    report.ethPriceUSD = ethPriceUSD;
    report.txTarget = STRESS_TARGET_WRITE_TXS;
    // Seed counts from setup (action increments add on top of these during the run)
    report.ssvClustersSetup            = STRESS_SSV_CLUSTERS;
    report.ethClustersSetup            = STRESS_ETH_CLUSTERS;
    report.migrationsSetup             = 0; // SSV clusters are migrated dynamically, not in setup
    report.operatorsPreMigration       = STRESS_OPERATORS_PRE_UPGRADE;
    report.operatorsPostMigrationSetup = STRESS_OPERATORS_POST_UPGRADE;

    // Record creation events for all clusters created during setup (before report tracking began)
    for (const cluster of setup.simState.clusters.values()) {
      const creationBlock = cluster.version === VERSION_ETH ? cluster.block : cluster.ssvBlock;
      const version = cluster.version === VERSION_ETH ? 'ETH' : 'SSV';
      report.recordClusterTx(
        cluster.id, cluster.owner, cluster.operatorIds, creationBlock,
        'registerValidator',
        { validators: cluster.validatorCount.toString(), version, note: 'setup' },
        'ValidatorAdded',
      );
    }

    let totalBlocks = 0n;
    let consecutiveSkips = 0;
    let checkStateCount = 0;
    let currentBlockForProgress = 0n;
    // One-shot test: migrate an SSV cluster that contains a removed operator.
    let migrateWithRemovedOpTested = false;
    // One-shot test: reactivate a liquidated ETH cluster that contains a removed operator,
    // then verify no new validators can be registered to it (registerValidator/bulkRegister
    // filter those clusters out) but all other operations remain valid.
    let reactivateWithRemovedOpTested = false;
    const simStartBlock = BigInt(await setup.provider.getBlockNumber());

    function fmtSimElapsed(currentBlock: bigint): string {
      const totalSecs = Number(currentBlock - simStartBlock) * 12;
      const years  = Math.floor(totalSecs / (365.25 * 24 * 3600));
      const days   = Math.floor((totalSecs % (365.25 * 24 * 3600)) / 86400);
      const hours  = Math.floor((totalSecs % 86400) / 3600);
      if (years > 0) return `${years}y ${days}d`;
      if (days > 0)  return `${days}d ${hours}h`;
      return `${hours}h`;
    }

    // Progress bar — updates every 5 seconds.
    // Cleared in the finally block so it always stops, even on test failure.
    const progressInterval = setInterval(() => {
      if (currentBlockForProgress === 0n) {
        process.stdout.write('  starting simulation loop...                                                   \r');
        return;
      }
      const pct = Math.min(100, Math.floor((report.primaryActionCount / STRESS_TARGET_WRITE_TXS) * 100));
      process.stdout.write(
        `\r  [${pct.toString().padStart(3)}%] ${report.primaryActionCount}/${STRESS_TARGET_WRITE_TXS} TXs | current block: ${currentBlockForProgress} | elapsed: ${fmtSimElapsed(currentBlockForProgress)} | mined times: ${report.miningRounds} | mined blocks: ${totalBlocks}   `,
      );
    }, 5000);

    try {

    // ── Assert: pre-upgrade SSV fee declaration is rejected post-upgrade ──
    // setup.ts mined 604801 blocks (≈7 days) before the upgrade so that
    // UPGRADE_TIMESTAMP (= upgradeBlock.timestamp) > approvalBeginTime.
    // The contract checks approvalBeginTime <= UPGRADE_TIMESTAMP first, so
    // executeOperatorFee must revert with LegacyOperatorFeeDeclarationInvalid.
    if (setup.preUpgradeFeeDeclaration) {
      const { opId, ownerAddress } = setup.preUpgradeFeeDeclaration;

      // The contract may revert with either LegacyOperatorFeeDeclarationInvalid or
      // ApprovalNotWithinTimeframe depending on check order — both correctly block execution.
      const ownerSigner = setup.allSigners.find((s: any) =>
        s.address.toLowerCase() === ownerAddress.toLowerCase(),
      );
      if (!ownerSigner) throw new Error(`Pre-upgrade fee test: signer ${ownerAddress} not found`);

      let reverted = false;
      try {
        await (await setup.network.connect(ownerSigner).executeOperatorFee(opId)).wait();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes('LegacyOperatorFeeDeclarationInvalid') && !msg.includes('ApprovalNotWithinTimeframe')) {
          throw new Error(`executeOperatorFee should revert with LegacyOperatorFeeDeclarationInvalid or ApprovalNotWithinTimeframe, got: ${msg}`);
        }
        reverted = true;
      }
      if (!reverted) throw new Error('ASSERTION FAILED: pre-upgrade fee declaration should be blocked post-upgrade');

      // Cancel the stale declaration so it doesn't interfere with the random action loop
      await (await setup.network.connect(ownerSigner).cancelDeclaredOperatorFee(opId)).wait();
      await checkState(setup, 'post-preUpgradeFeeTest', report);
    }

    // ── Assert: whitelist-revoked cluster migrates OK but cannot register validators ──
    // setup.ts (Phase 3.65) removed the cluster owner from a private operator's whitelist
    // before the upgrade. Migration must succeed — migrateClusterToETH does not check operator
    // whitelists. registerValidator afterward must revert with CallerNotWhitelistedWithData
    // because the cluster owner is no longer on the private operator's whitelist.
    if (setup.whitelistRemovedClusterId) {
      const wlCluster = setup.simState.clusters.get(setup.whitelistRemovedClusterId);
      if (!wlCluster) throw new Error(`Whitelist-revoked cluster ${setup.whitelistRemovedClusterId} not in simState`);

      console.log(`\n  [static] whitelist-revoked cluster: migrate + register-fail test (${wlCluster.id.slice(0, 14)})`);

      // Step 1: migrate — must succeed even though owner is no longer whitelisted
      await migrateClusterDirectly(wlCluster, setup, report);
      await checkState(setup, 'post-whitelistRevoke-migrate', report);

      // Step 2: try registerValidator — must fail with CallerNotWhitelistedWithData
      const wlOwnerSigner = setup.allSigners.find((s: any) =>
        s.address.toLowerCase() === wlCluster.owner.toLowerCase(),
      );
      if (!wlOwnerSigner) throw new Error(`Whitelist-revoked cluster owner ${wlCluster.owner} not found in allSigners`);

      const wlNewValKey = makeValKey(setup.simState.nextValidatorSeed++);
      let wlRegisterReverted = false;
      try {
        await (await setup.network.connect(wlOwnerSigner).registerValidator(
          wlNewValKey, wlCluster.operatorIds, DEFAULT_SHARES, toClusterStruct(wlCluster), { value: 0n },
        )).wait();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes('CallerNotWhitelistedWithData')) {
          throw new Error(`Expected CallerNotWhitelistedWithData, got: ${msg}`);
        }
        wlRegisterReverted = true;
      }
      if (!wlRegisterReverted) throw new Error('ASSERTION FAILED: registerValidator should revert with CallerNotWhitelistedWithData');

      // Mark canRegister=false — actRegisterValidator / actBulkRegisterValidator will skip this cluster
      wlCluster.canRegister = false;
      console.log(`  [static] whitelist-revoked cluster passed — migration OK, register blocked (canRegister=false)`);
    }

    // ── Assert: ETH cluster operations revert with IncorrectClusterVersion on SSV clusters ──
    // After the upgrade, SSV clusters exist in s.clusters (not s.ethClusters).
    // Every ETH-only cluster operation checks validateClusterVersion(VERSION_ETH) and
    // must revert with IncorrectClusterVersion when called on an SSV cluster.
    {
      // Helper: send a TX and assert it reverts with the expected error name.
      async function assertReverts(
        txPromise: Promise<any>,
        errorName: string,
        label: string,
      ): Promise<void> {
        let reverted = false;
        try {
          await (await txPromise).wait();
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          if (!msg.includes(errorName)) {
            throw new Error(`[${label}] expected revert with ${errorName}, got: ${msg}`);
          }
          reverted = true;
        }
        if (!reverted) throw new Error(`ASSERTION FAILED: [${label}] succeeded but should have reverted with ${errorName}`);
      }

      // Find test targets in sim state
      const activeSsvClusters = [...setup.simState.clusters.values()].filter(
        c => c.version === VERSION_SSV && c.active && c.validatorCount > 0n,
      );
      const inactiveSsvClusters = [...setup.simState.clusters.values()].filter(
        c => c.version === VERSION_SSV && !c.active,
      );

      if (activeSsvClusters.length === 0) throw new Error('SSV version test: no active SSV clusters found');
      if (inactiveSsvClusters.length === 0) throw new Error('SSV version test: no inactive (liquidated) SSV clusters found');

      const ssvCluster = activeSsvClusters[0];
      const liquidatedSsvCluster = inactiveSsvClusters[0];

      const ssvOwner = setup.allSigners.find((s: any) =>
        s.address.toLowerCase() === ssvCluster.owner.toLowerCase(),
      );
      const liqOwner = setup.allSigners.find((s: any) =>
        s.address.toLowerCase() === liquidatedSsvCluster.owner.toLowerCase(),
      );
      if (!ssvOwner) throw new Error(`SSV version test: signer for ${ssvCluster.owner} not found`);
      if (!liqOwner) throw new Error(`SSV version test: signer for ${liquidatedSsvCluster.owner} not found`);

      const ops   = ssvCluster.operatorIds;
      const strct = toClusterStruct(ssvCluster);
      const liqStrct = toClusterStruct(liquidatedSsvCluster);

      // Use a validator key far outside the sequential seed range (stress test maxes out ~50k)
      const dummyKey = makeValKey(999_000_000);

      // 1. withdraw → IncorrectClusterVersion
      await assertReverts(
        setup.network.connect(ssvOwner).withdraw(ops, 1n, strct),
        'IncorrectClusterVersion',
        'withdraw on SSV cluster',
      );

      // 2. registerValidator → IncorrectClusterVersion
      //    validateClusterOnRegistration fires after registerPublicKey loop; both roll back on revert.
      await assertReverts(
        setup.network.connect(ssvOwner).registerValidator(dummyKey, ops, DEFAULT_SHARES, strct, { value: 0 }),
        'IncorrectClusterVersion',
        'registerValidator on SSV cluster',
      );

      // 3. bulkRegisterValidator → IncorrectClusterVersion
      await assertReverts(
        setup.network.connect(ssvOwner).bulkRegisterValidator([dummyKey], ops, [DEFAULT_SHARES], strct, { value: 0 }),
        'IncorrectClusterVersion',
        'bulkRegisterValidator on SSV cluster',
      );

      // 4. reactivate on a liquidated SSV cluster → IncorrectClusterVersion
      await assertReverts(
        setup.network.connect(liqOwner).reactivate(liquidatedSsvCluster.operatorIds, liqStrct, { value: 0 }),
        'IncorrectClusterVersion',
        'reactivate on liquidated SSV cluster',
      );

      // 5. deposit (ETH path, any caller) → IncorrectClusterVersion
      await assertReverts(
        setup.network.connect(setup.deployer).deposit(ssvCluster.owner, ops, strct, { value: 1n }),
        'IncorrectClusterVersion',
        'deposit (ETH) on SSV cluster',
      );

      await checkState(setup, 'post-ssvVersionTests', report);
    }

    // ── Assert: over-unstake correctly reverts ─────────────────────────────
    // Use the first random staker (allSigners[STRESS_STAKER_START_IDX]):
    //   1. Mint 5 SSV and stake it → cssvBalance = 5 SSV
    //   2. requestUnstake(5 SSV) → cssvBalance = 0, 1 pending entry
    //   3. requestUnstake(1 SSV) → MUST revert with UnstakeAmountExceedsBalance
    {
      const overUnstakeStaker = setup.allSigners[STRESS_STAKER_START_IDX];
      const stakeAmount = 5n * 10n ** 18n;
      const networkAddr = await setup.network.getAddress();

      // Stake
      await (await setup.ssvToken.mint(overUnstakeStaker.address, stakeAmount)).wait();
      await (await setup.ssvToken.connect(overUnstakeStaker).approve(networkAddr, stakeAmount)).wait();
      const stakeReceipt = await (await setup.network.connect(overUnstakeStaker).stake(stakeAmount)).wait();
      if (!stakeReceipt) throw new Error('over-unstake test: stake receipt null');
      {
        const stakeBlock = BigInt(stakeReceipt.blockNumber);
        advanceAll(setup.simState, stakeBlock);
        let stakerRec = setup.simState.stakers.get(overUnstakeStaker.address.toLowerCase());
        if (!stakerRec) {
          stakerRec = { address: overUnstakeStaker.address, cssvBalance: 0n, pendingUnstake: [], ethClaimed: 0n, totalEthAmount: 0n, userIndex: 0n };
          setup.simState.stakers.set(overUnstakeStaker.address.toLowerCase(), stakerRec);
        }
        onSyncFees(setup.simState);
        onSettleUser(stakerRec, setup.simState);
        stakerRec.cssvBalance += stakeAmount;
      }

      // requestUnstake(all) — burns all cSSV
      const unstakeReceipt = await (await setup.network.connect(overUnstakeStaker).requestUnstake(stakeAmount)).wait();
      if (!unstakeReceipt) throw new Error('over-unstake test: requestUnstake receipt null');
      {
        const unstakeBlock = BigInt(unstakeReceipt.blockNumber);
        advanceAll(setup.simState, unstakeBlock);
        const txBlockData = await provider.getBlock(unstakeReceipt.blockNumber);
        const unlockTime = BigInt(txBlockData.timestamp) + STRESS_COOLDOWN_SECS;
        const stakerRec = setup.simState.stakers.get(overUnstakeStaker.address.toLowerCase())!;
        onSyncFees(setup.simState);
        onSettleUser(stakerRec, setup.simState);
        stakerRec.pendingUnstake.push({ amount: stakeAmount, unlockTime });
        stakerRec.cssvBalance = 0n;
      }

      // requestUnstake(1) — MUST revert
      let overReverted = false;
      try {
        await (await setup.network.connect(overUnstakeStaker).requestUnstake(1n)).wait();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes('UnstakeAmountExceedsBalance')) {
          throw new Error(`over-unstake: expected UnstakeAmountExceedsBalance, got: ${msg}`);
        }
        overReverted = true;
      }
      if (!overReverted) throw new Error('ASSERTION FAILED: over-unstake should revert with UnstakeAmountExceedsBalance');

      await checkState(setup, 'post-overUnstake', report);
    }

    // ── Assert: withdrawUnlocked reverts when only locked requests remain ──
    // Uses the second random staker (allSigners[STRESS_STAKER_START_IDX + 1]):
    //   1. Stake 10 SSV → 10 cSSV
    //   2. requestUnstake(4 SSV) → pending entry A, unlockTime_A = now + 500s
    //   3. Mine 500 blocks (500s) → entry A is now unlocked
    //   4. requestUnstake(6 SSV) → pending entry B, unlockTime_B = new_now + 500s (still locked)
    //   5. withdrawUnlocked() → drains 4 SSV (entry A), leaves entry B pending
    //   6. withdrawUnlocked() again → REVERTS with NothingToWithdraw (only entry B remains, still locked)
    //   Entry B stays in the pool (teardown will drain it after the cooldown).
    {
      const earlyClaimStaker = setup.allSigners[STRESS_STAKER_START_IDX + 1];
      const stakeTotal = 10n * 10n ** 18n;
      const firstUnstake = 4n * 10n ** 18n;
      const secondUnstake = 6n * 10n ** 18n;
      const networkAddr = await setup.network.getAddress();

      // Stake 10 SSV
      await (await setup.ssvToken.mint(earlyClaimStaker.address, stakeTotal)).wait();
      await (await setup.ssvToken.connect(earlyClaimStaker).approve(networkAddr, stakeTotal)).wait();
      const s1 = await (await setup.network.connect(earlyClaimStaker).stake(stakeTotal)).wait();
      if (!s1) throw new Error('earlyClaimStaker stake receipt null');
      advanceAll(setup.simState, BigInt(s1.blockNumber));
      {
        let stakerRec = setup.simState.stakers.get(earlyClaimStaker.address.toLowerCase());
        if (!stakerRec) {
          stakerRec = { address: earlyClaimStaker.address, cssvBalance: 0n, pendingUnstake: [], ethClaimed: 0n, totalEthAmount: 0n, userIndex: 0n };
          setup.simState.stakers.set(earlyClaimStaker.address.toLowerCase(), stakerRec);
        }
        onSyncFees(setup.simState);
        onSettleUser(stakerRec, setup.simState);
        stakerRec.cssvBalance += stakeTotal;
      }

      // requestUnstake(4 SSV)
      const ru1 = await (await setup.network.connect(earlyClaimStaker).requestUnstake(firstUnstake)).wait();
      if (!ru1) throw new Error('earlyClaimStaker requestUnstake(4) receipt null');
      advanceAll(setup.simState, BigInt(ru1.blockNumber));
      {
        const bd1 = await provider.getBlock(ru1.blockNumber);
        const stakerRec = setup.simState.stakers.get(earlyClaimStaker.address.toLowerCase())!;
        onSyncFees(setup.simState);
        onSettleUser(stakerRec, setup.simState);
        stakerRec.cssvBalance -= firstUnstake;
        stakerRec.pendingUnstake.push({ amount: firstUnstake, unlockTime: BigInt(bd1.timestamp) + STRESS_COOLDOWN_SECS });
      }

      // Mine 500 blocks so entry A is past its unlockTime
      await provider.send('hardhat_mine', ['0x' + (STRESS_COOLDOWN_SECS + 1n).toString(16)]);
      await provider.send('evm_increaseTime', [Number(STRESS_COOLDOWN_SECS) + 1]);
      advanceAll(setup.simState, BigInt(await provider.getBlockNumber()));

      // requestUnstake(6 SSV) — entry B, unlockTime_B is still in the future
      const ru2 = await (await setup.network.connect(earlyClaimStaker).requestUnstake(secondUnstake)).wait();
      if (!ru2) throw new Error('earlyClaimStaker requestUnstake(6) receipt null');
      advanceAll(setup.simState, BigInt(ru2.blockNumber));
      {
        const bd2 = await provider.getBlock(ru2.blockNumber);
        const stakerRec = setup.simState.stakers.get(earlyClaimStaker.address.toLowerCase())!;
        onSyncFees(setup.simState);
        onSettleUser(stakerRec, setup.simState);
        stakerRec.cssvBalance -= secondUnstake;
        stakerRec.pendingUnstake.push({ amount: secondUnstake, unlockTime: BigInt(bd2.timestamp) + STRESS_COOLDOWN_SECS });
      }

      // withdrawUnlocked() → drains entry A (4 SSV unlocked), entry B stays pending
      const wu1 = await (await setup.network.connect(earlyClaimStaker).withdrawUnlocked()).wait();
      if (!wu1) throw new Error('earlyClaimStaker withdrawUnlocked() receipt null');
      advanceAll(setup.simState, BigInt(wu1.blockNumber));
      {
        const bd = await provider.getBlock(wu1.blockNumber);
        const stakerRec = setup.simState.stakers.get(earlyClaimStaker.address.toLowerCase())!;
        stakerRec.pendingUnstake = stakerRec.pendingUnstake.filter(r => r.unlockTime > BigInt(bd.timestamp));
      }

      // withdrawUnlocked() again — entry B is still locked → MUST revert with NothingToWithdraw
      let earlyReverted = false;
      try {
        await (await setup.network.connect(earlyClaimStaker).withdrawUnlocked()).wait();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (!msg.includes('NothingToWithdraw')) {
          throw new Error(`earlyClaimStaker: expected NothingToWithdraw, got: ${msg}`);
        }
        earlyReverted = true;
      }
      if (!earlyReverted) throw new Error('ASSERTION FAILED: early withdrawUnlocked should revert with NothingToWithdraw');

      // Entry B remains in pendingUnstake — teardown will drain it after the cooldown.
      await checkState(setup, 'post-earlyWithdrawRevert', report);
    }

    // ── Assert: canRegister=false blocks register/bulkRegister but allows all else ──
    // 1. Register 1 fresh public ETH operator (owner = allSigners[158]).
    // 2. Create 20 ETH clusters (owners allSigners[159..178]), each with the test op + 3 public ops.
    // 3. Owner self-liquidates each cluster (bypasses threshold — owner==liquidator in contract).
    // 4. Remove the test operator (effectiveBalance=0 after all liquidations).
    // 5. Reactivate all 20 via reactivateClusterDirectly (allowed — contract skips removed ops).
    // 6. Mark canRegister=false on all 20 → actRegisterValidator / actBulkRegisterValidator skip them.
    {
      console.log('\n  [static] setting up 20 removed-op clusters (canRegister=false test)');
      const { simState, network } = setup;

      // ── Step 1: Register test operator ────────────────────────────────────
      // Signers beyond STRESS_TOTAL_SIGNERS — generated on demand and appended to allSigners
      // so that existing setup.allSigners.find() calls (e.g. in reactivateClusterDirectly) work.
      const testOpOwner = await getSigner(setup.connection, [], STRESS_TOTAL_SIGNERS);
      const testClusterOwners: any[] = [];
      for (let j = 0; j < 20; j++) {
        testClusterOwners.push(await getSigner(setup.connection, [], STRESS_TOTAL_SIGNERS + 1 + j));
      }
      setup.allSigners.push(testOpOwner, ...testClusterOwners);

      const testOpFeeWei = ((TARGET_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS / 2n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
      const testOpKey = `0x${'ab'.repeat(48)}`;
      const testOpTx = await network.connect(testOpOwner).registerOperator(testOpKey, testOpFeeWei, false);
      const testOpReceipt = await testOpTx.wait();
      if (!testOpReceipt) throw new Error('static removed-op test: registerOperator receipt null');
      const testOpTxBlock = BigInt(testOpReceipt.blockNumber);
      advanceAll(simState, testOpTxBlock);

      const testOpId = parseOperatorId(testOpReceipt, network);
      simState.operators.set(testOpId, {
        id: testOpId, owner: testOpOwner.address,
        feeWei: testOpFeeWei, block: testOpTxBlock, balance: 0n, effectiveBalance: 0n,
        ssvFeeWei: 0n, ssvBlock: testOpTxBlock, ssvBalance: 0n, ssvValidatorCount: 0n,
        pendingFeeWei: 0n, pendingFeeBlock: 0n, pendingFeeApprovalBeginTime: 0n, pendingFeeApprovalEndTime: 0n,
        isRemoved: false, isPrivate: false, whitelistedAddresses: new Set(),
      });
      report.operatorsPostMigrationDynamic++;

      // ── Step 2: Pick 3 companion public ops (non-removed, non-private, lowest IDs) ──
      const publicOps = [...simState.operators.values()]
        .filter(op => !op.isRemoved && !op.isPrivate && op.id !== testOpId)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 3)
        .map(op => op.id);
      if (publicOps.length < 3) throw new Error('static removed-op test: not enough public operators');
      // Sort the full op set (testOpId fits in its natural position)
      const testOpSet = [...publicOps, testOpId].sort((a, b) => (a < b ? -1 : 1));

      // Precompute burnRate for these clusters (all operators are non-removed at this point)
      let testClusterBurnRate = simState.network.feeWei;
      for (const opId of testOpSet) testClusterBurnRate += simState.operators.get(opId)!.feeWei;

      // Deposit: 2 ETH per cluster, comfortably above threshold, allows immediate self-liquidation
      const testClusterDeposit = 2n * 10n ** 18n;

      const testClusters: import('./state.ts').ClusterRecord[] = [];
      for (let i = 0; i < 20; i++) {
        const clusterOwner = testClusterOwners[i];
        const valKey = makeValKey(simState.nextValidatorSeed++);

        const preTxBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preTxBlock);

        const regTx = await network.connect(clusterOwner).registerValidator(
          valKey, testOpSet, DEFAULT_SHARES, EMPTY_CLUSTER, { value: testClusterDeposit },
        );
        const regReceipt = await regTx.wait();
        if (!regReceipt) throw new Error(`static removed-op test: registerValidator receipt null (cluster ${i})`);
        const regTxBlock = BigInt(regReceipt.blockNumber);
        advanceAll(simState, regTxBlock);

        const parsed = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);
        const clusterId = computeClusterId(clusterOwner.address, testOpSet);

        const clusterRec: import('./state.ts').ClusterRecord = {
          id: clusterId, owner: clusterOwner.address, operatorIds: [...testOpSet],
          version: VERSION_ETH, block: regTxBlock, balance: parsed.balance,
          burnRate: testClusterBurnRate, effectiveBalance: DEFAULT_EB,
          ssvBlock: 0n, ssvBalance: 0n, ssvBurnRate: 0n,
          createdBlock: regTxBlock,
          validatorCount: parsed.validatorCount, active: parsed.active,
          canRegister: true,
          lastOracleEB: 0n,
          validators: new Set([valKey]), lastStruct: parsedToStruct(parsed),
        };
        simState.clusters.set(clusterId, clusterRec);
        for (const opId of testOpSet) simState.operators.get(opId)!.effectiveBalance += DEFAULT_EB;
        simState.network.totalEffectiveBalance += DEFAULT_EB;
        testClusters.push(clusterRec);

        report.ethClustersDynamic++;
        report.record('registerValidator', BigInt(regReceipt.gasUsed ?? 0n), regTxBlock);
      }

      // ── Step 3: Owner self-liquidates each cluster ─────────────────────────
      // Contract skips the threshold check when msg.sender == clusterOwner.
      for (const cluster of testClusters) {
        const clusterOwner = setup.allSigners.find((s: any) =>
          s.address.toLowerCase() === cluster.owner.toLowerCase(),
        )!;

        const liqTx = await network.connect(clusterOwner).liquidate(
          cluster.owner, cluster.operatorIds, toClusterStruct(cluster),
        );
        const liqReceipt = await liqTx.wait();
        if (!liqReceipt) throw new Error(`static removed-op test: self-liquidate receipt null for ${cluster.id}`);
        const liqTxBlock = BigInt(liqReceipt.blockNumber);
        advanceAll(simState, liqTxBlock);

        const liqEB = cluster.effectiveBalance;
        for (const opId of cluster.operatorIds) {
          const op = simState.operators.get(opId);
          if (op && op.effectiveBalance >= liqEB) op.effectiveBalance -= liqEB;
        }
        if (simState.network.totalEffectiveBalance >= liqEB) simState.network.totalEffectiveBalance -= liqEB;
        cluster.balance = 0n;
        cluster.burnRate = 0n;
        cluster.active = false;
        cluster.lastStruct = parsedToStruct(parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED));

        report.record('liquidate', BigInt(liqReceipt.gasUsed ?? 0n), liqTxBlock);
        report.totalClustersLiquidated++;
      }

      // ── Step 4: Remove the test operator ──────────────────────────────────
      // effectiveBalance is 0 on all 20 operators (all clusters liquidated), so remove is valid.
      const remTx = await network.connect(testOpOwner).removeOperator(testOpId);
      const remReceipt = await remTx.wait();
      if (!remReceipt) throw new Error('static removed-op test: removeOperator receipt null');
      const remTxBlock = BigInt(remReceipt.blockNumber);
      advanceAll(simState, remTxBlock);

      const testOp = simState.operators.get(testOpId)!;
      testOp.balance = 0n; testOp.ssvBalance = 0n; testOp.feeWei = 0n;
      testOp.effectiveBalance = 0n; testOp.ssvValidatorCount = 0n;
      testOp.pendingFeeWei = 0n; testOp.pendingFeeBlock = 0n;
      testOp.isRemoved = true;
      report.record('removeOperator', BigInt(remReceipt.gasUsed ?? 0n), remTxBlock);

      // ── Step 5: Reactivate all 20 (allowed — contract skips removed ops) ──
      for (const cluster of testClusters) {
        await reactivateClusterDirectly(cluster, setup, report);
      }

      // ── Step 6: Mark canRegister=false ────────────────────────────────────
      // actRegisterValidator / actBulkRegisterValidator will skip these clusters.
      for (const cluster of testClusters) {
        cluster.canRegister = false;
      }

      await checkState(setup, 'post-removedOpClusters', report);
      console.log(`  [static] done — ${testClusters.length} clusters marked canRegister=false (op #${testOpId})`);
    }

    // ── Assert: empty SSV cluster must migrate before registering ETH validators ──
    // Setup Phase 3.9 created a 4-op / 5-validator SSV cluster, then removed all
    // validators and withdrew all SSV, leaving an empty (0-validator, 0-balance) SSV
    // cluster. Post-upgrade, ETH registerValidator must revert with IncorrectClusterVersion.
    // After migration, bulkRegisterValidator must succeed and the cluster joins the pool.
    {
      const emptyCluster = setup.emptySSVClusterForMigrateTest;
      if (emptyCluster) {
        console.log(`\n  [static] empty-SSV migrate test (cluster ${emptyCluster.id.slice(0, 14)})`);
        const emptyOwner = setup.allSigners.find((s: any) =>
          s.address.toLowerCase() === emptyCluster.owner.toLowerCase(),
        );
        if (!emptyOwner) throw new Error('empty SSV cluster owner signer not found');

        // Step 1: registerValidator (ETH path) MUST revert with IncorrectClusterVersion
        let registerReverted = false;
        try {
          await (await setup.network.connect(emptyOwner).registerValidator(
            makeValKey(999999999),
            emptyCluster.operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: 1_000_000_000_000_000n },
          )).wait();
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          if (!msg.includes('IncorrectClusterVersion')) {
            throw new Error(`empty-SSV migrate test: expected IncorrectClusterVersion, got: ${msg}`);
          }
          registerReverted = true;
        }
        if (!registerReverted) throw new Error('ASSERTION FAILED: registerValidator on empty SSV cluster must revert with IncorrectClusterVersion');

        // Step 2: migrate → converts to VERSION_ETH, deposits ETH
        await migrateClusterDirectly(emptyCluster, setup, report);
        await checkState(setup, 'post-emptySsvCluster-migrate', report);

        // Step 3: bulkRegisterValidator — 5 validators on the freshly migrated ETH cluster
        {
          const n = 5;
          const keys: string[] = [];
          for (let v = 0; v < n; v++) keys.push(makeValKey(setup.simState.nextValidatorSeed++));
          const shares = keys.map(() => DEFAULT_SHARES);

          const preTxBlock = BigInt(await provider.getBlockNumber());
          advanceAll(setup.simState, preTxBlock);

          // Compute deposit: 90-day runway on 5 validators × burnRate per DEFAULT_EB
          const addedEB = BigInt(n) * DEFAULT_EB;
          const newEB = emptyCluster.effectiveBalance + addedEB;
          const bpb = emptyCluster.burnRate * newEB / DEFAULT_EB;
          const depositValue = bpb > 0n
            ? ((90n * 7160n * bpb + ETH_DEDUCTED_DIGITS - 1n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS
            : setup.simState.minimumLiquidationCollateral * 2n;

          const bulkTx = await setup.network.connect(emptyOwner).bulkRegisterValidator(
            keys, emptyCluster.operatorIds, shares, toClusterStruct(emptyCluster),
            { value: depositValue },
          );
          const bulkReceipt = await bulkTx.wait();
          if (!bulkReceipt) throw new Error('empty-SSV migrate test: bulkRegisterValidator receipt null');
          const txBlock = BigInt(bulkReceipt.blockNumber);
          advanceAll(setup.simState, txBlock);

          // Parse final cluster state from last ValidatorAdded event
          let lastParsed: any = null;
          for (const log of bulkReceipt.logs ?? []) {
            try {
              const p = setup.network.interface.parseLog(log);
              if (p?.name === 'ValidatorAdded') lastParsed = p.args.cluster ?? p.args[4];
            } catch { /* skip */ }
          }
          if (!lastParsed) throw new Error('empty-SSV migrate test: no ValidatorAdded event found');

          // Update sim state
          emptyCluster.validatorCount  = BigInt(lastParsed.validatorCount ?? lastParsed[0]);
          emptyCluster.effectiveBalance += addedEB;
          emptyCluster.balance         = BigInt(lastParsed.balance ?? lastParsed[4]);
          emptyCluster.block           = txBlock;
          emptyCluster.lastStruct      = {
            validatorCount:  emptyCluster.validatorCount,
            networkFeeIndex: BigInt(lastParsed.networkFeeIndex ?? lastParsed[1]),
            index:           BigInt(lastParsed.index ?? lastParsed[2]),
            active:          Boolean(lastParsed.active ?? lastParsed[3]),
            balance:         emptyCluster.balance,
          };
          for (const key of keys) emptyCluster.validators.add(key);

          for (const opId of emptyCluster.operatorIds) {
            const op = setup.simState.operators.get(opId);
            if (op && !op.isRemoved) op.effectiveBalance += addedEB;
          }
          setup.simState.network.totalEffectiveBalance += addedEB;

          report.record(`bulkRegisterValidator(${emptyCluster.operatorIds.length})`, BigInt(bulkReceipt.gasUsed ?? 0n), txBlock);
        }

        await checkState(setup, 'post-emptySsvCluster-bulkRegister', report);
        console.log(`  [static] empty-SSV migrate test done — cluster is now ETH with ${emptyCluster.validatorCount} validators`);
      }
    }

    // ── Main simulation loop ───────────────────────────────────────────
    // Mining is one weighted option in the pool (weight=100, ~34% of picks).
    // Protocol actions make up the rest. When a protocol action is selected,
    // there is a SAME_BLOCK_PCT % chance it lands in the same block as the
    // previous TX; otherwise we advance 1 block first.
    const MINE_WEIGHT    = 40;   // relative weight for the "mine" option (~17% of picks)
    const SAME_BLOCK_PCT = 8n;   // % chance a protocol TX shares a block with the previous one

    while (report.primaryActionCount < STRESS_TARGET_WRITE_TXS) {
      const currentBlock = BigInt(await provider.getBlockNumber());
      currentBlockForProgress = currentBlock;

      // Build weighted pool: all protocol actions + the "mine" pseudo-action
      const poolWeighted = [
        ...ALL_ACTIONS.map(a => ({ item: a as WeightedAction | { name: 'mine'; fn?: never }, weight: a.weight })),
        { item: { name: 'mine' as const }, weight: MINE_WEIGHT },
      ];
      const picked = pickWeighted(rng, poolWeighted);
      if (!picked) continue;

      if (picked.name === 'mine') {
        // ── Mine a safe block count ──────────────────────────────────────
        const blocksToMine = pickSafeBlockCount(setup.simState, currentBlock, rng);
        await provider.send('hardhat_mine', ['0x' + blocksToMine.toString(16)]);
        await provider.send('evm_increaseTime', [Number(blocksToMine) * 12]);
        totalBlocks += blocksToMine;
        report.blocksMined += blocksToMine;
        report.miningRounds++;
        await handleLiquidatableClusters(setup, provider, rng, report);
        await checkState(setup, `post-mine:tx${report.primaryActionCount}`, report);
        report.checkStateCallCount++;
        consecutiveSkips = 0;
        // Mining does NOT increment primaryActionCount — it's infrastructure, not a protocol TX.
      } else {
        // ── Protocol action ──────────────────────────────────────────────
        // Advance 1 block first unless we roll into the same-block window.
        if (rng.nextInt(100n) >= SAME_BLOCK_PCT) {
          await provider.send('hardhat_mine', ['0x1']);
          await provider.send('evm_increaseTime', [12]);
          totalBlocks += 1n;
          report.blocksMined += 1n;
          await handleLiquidatableClusters(setup, provider, rng, report);
        }

        const action = picked as WeightedAction;
        const success = await action.fn(setup, rng, report);

        if (success) {
          consecutiveSkips = 0;
          report.primaryActionCount++;
          // Only assert staking state after TXs that call _syncFees on-chain.
          const isStakingSync = ['stake', 'requestUnstake', 'transferCSSV', 'claimEthRewards'].includes(action.name);
          await checkState(setup, `after:${action.name}:tx${report.primaryActionCount}`, report, isStakingSync);
          report.checkStateCallCount++;
          checkStateCount++;

          // Record conservation data every 50 successful TXs
          if (checkStateCount % 50 === 0) {
            const block = BigInt(await provider.getBlockNumber());
            const networkAddr = await setup.network.getAddress();
            const contractETH = BigInt(await provider.getBalance(networkAddr));

            let totalActiveClusterBalance = 0n;
            for (const cluster of setup.simState.clusters.values()) {
              if (cluster.active && cluster.version === VERSION_ETH) totalActiveClusterBalance += cluster.balance;
            }
            const baseline = totalActiveClusterBalance + SEED_ETH;
            const excessWei = contractETH > baseline ? contractETH - baseline : 0n;
            const validatorCount = BigInt(
              [...setup.simState.clusters.values()]
                .filter(c => c.active)
                .reduce((s, c) => s + Number(c.validatorCount), 0),
            );
            report.recordConservation(block, excessWei, totalActiveClusterBalance, validatorCount);
          }

          // ── One-shot test: migrateClusterToETH with a removed operator ──────
          // Fires the first time removeOperator succeeds AND an SSV cluster (active
          // or liquidated) that still contains the removed operator can be found.
          // Verifies the contract skips removed operators during migration rather than
          // reverting — migrateClusterToETH's updateClusterOperatorsMigration just
          // continues past operators whose both snapshots are zeroed.
          if (action.name === 'removeOperator') {
            // ── one-shot: migrateClusterToETH with a removed operator ──────────
            if (!migrateWithRemovedOpTested) {
              const target = [...setup.simState.clusters.values()].find(c =>
                c.version === VERSION_SSV &&
                c.validatorCount > 0n &&
                c.operatorIds.some(id => setup.simState.operators.get(id)?.isRemoved),
              );
              if (target) {
                console.log(`\n  [one-shot] migrateClusterToETH with removed operator (cluster ${target.id.slice(0, 10)})`);
                await migrateClusterDirectly(target, setup, report);
                await checkState(setup, `after:migrateWithRemovedOp:tx${report.primaryActionCount}`, report);
                report.checkStateCallCount++;
                migrateWithRemovedOpTested = true;
              }
            }
            // ── one-shot: reactivate a liquidated ETH cluster with a removed operator ──
            if (!reactivateWithRemovedOpTested) {
              const target = [...setup.simState.clusters.values()].find(c =>
                c.version === VERSION_ETH &&
                !c.active &&
                c.effectiveBalance > 0n &&
                c.operatorIds.some(id => setup.simState.operators.get(id)?.isRemoved),
              );
              if (target) {
                console.log(`\n  [one-shot] reactivate ETH cluster with removed operator (cluster ${target.id.slice(0, 10)})`);
                await reactivateClusterDirectly(target, setup, report);
                await checkState(setup, `after:reactivateWithRemovedOp:tx${report.primaryActionCount}`, report);
                report.checkStateCallCount++;
                reactivateWithRemovedOpTested = true;
              }
            }
          }
        } else {
          consecutiveSkips++;
          if (consecutiveSkips > 200) {
            // Too many skips in a row — mine a safe number of blocks to unblock state
            const fallbackBlock = BigInt(await provider.getBlockNumber());
            const fallbackBlocks = pickSafeBlockCount(setup.simState, fallbackBlock, rng);
            await provider.send('hardhat_mine', ['0x' + fallbackBlocks.toString(16)]);
            await provider.send('evm_increaseTime', [Number(fallbackBlocks) * 12]);
            totalBlocks += fallbackBlocks;
            report.blocksMined += fallbackBlocks;
            report.miningRounds++;
            await handleLiquidatableClusters(setup, provider, rng, report);
            await checkState(setup, `post-liquidate-fallback:tx${report.primaryActionCount}`, report);
            report.checkStateCallCount++;
            consecutiveSkips = 0;
          }
        }
      }
    }

    // ── Final state check ──────────────────────────────────────────────
    await checkState(setup, 'final', report);

    // ── Snapshot operator + network stats before teardown ─────────────
    report.recordOperatorStats(setup.simState.operators);
    report.recordNetworkStats(setup.simState.network);
    report.recordStakingDust(setup.simState.totalStakingDust);

    // ── Teardown: drain all balances ───────────────────────────────────
    await teardown(setup, report);

    // ── Write full TX history for successful run ───────────────────────
    try { report.writeSuccessHistory(); } catch { /* non-fatal */ }

    } finally {
      clearInterval(progressInterval);
      process.stdout.write('\n'); // end progress bar line

      // ── Print console report (always, even on failure) ─────────────
      try { report.print(); } catch { /* ignore print errors */ }

      // ── Write HTML report (always, even on failure) ─────────────────
      try {
        const reportsDir = path.join(process.cwd(), 'test', 'stress', 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        const htmlPath = path.join(reportsDir, 'stress-test-report.html');
        const simSummary = {
          totalBlocks:  totalBlocks.toString(),
          totalTxs:     report.primaryActionCount,
          miningRounds: report.miningRounds,
          blocksMined:  report.blocksMined.toString(),
          operators:    setup.simState.operators.size,
          clusters:     setup.simState.clusters.size,
          liquidations: report.totalClustersLiquidated,
          failures:     report.failures.length,
        };
        await report.writeHTML(htmlPath, simSummary);
      } catch (htmlErr) {
        console.error('  Failed to write HTML report:', htmlErr);
      }
    }
  });
});
