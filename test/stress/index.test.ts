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
  DEFAULT_EB,
} from './state.ts';
import type { SimState } from './state.ts';
import type { StressSetup } from './setup.ts';
import {
  VERSION_ETH,
  VERSION_SSV,
  BPS_DENOMINATOR,
  STRESS_TARGET_WRITE_TXS,
  DEFAULT_RNG_SEED,
  SEED_ETH,
  STRESS_SSV_CLUSTERS,
  STRESS_ETH_CLUSTERS,
  STRESS_OPERATORS_PRE_UPGRADE,
  STRESS_OPERATORS_POST_UPGRADE,
  _SL_EOA_START,
  STRESS_COOLDOWN_SECS,
  ETH_DEDUCTED_DIGITS,
  TARGET_OPERATOR_ETH_FEE,
  STRESS_TOTAL_SIGNERS,
} from './constants.ts';

async function fetchEthPriceUSD(): Promise<number> {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`CoinGecko API returned ${res.status}`);
  const data = await res.json() as any;
  const price = data?.ethereum?.usd;
  if (typeof price !== 'number' || price <= 0) throw new Error(`Invalid ETH price: ${price}`);
  return price;
}

function pickSafeBlockCount(simState: SimState, currentBlock: bigint, rng: RNG): bigint {
  const activeClusters = [...simState.clusters.values()].filter(c => c.active);

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

    const zeroBlock = snapshotBlock + snapshotBalance / bpb;
    const blocksFromNow = zeroBlock > currentBlock ? zeroBlock - currentBlock : 0n;
    if (blocksFromNow < minBlocksToZero) minBlocksToZero = blocksFromNow;
  }

  const hardCeiling = minBlocksToZero > 1n ? minBlocksToZero - 1n : 1n;
  const upperBound = hardCeiling < 8760n ? hardCeiling : 8760n;

  for (let attempt = 0; attempt < 20; attempt++) {
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

  return 1n;
}

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
      await liquidateClusterDirectly(cluster, setup, report);
    } else {
      const liquidateInstead = rng.nextInt(5n) === 0n;
      if (liquidateInstead) {
        await liquidateClusterDirectly(cluster, setup, report);
      } else {
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

    let ethPriceUSD = 0;
    try {
      ethPriceUSD = await fetchEthPriceUSD();
    } catch (err) {
      console.error(`  Failed to fetch ETH price: ${err}`);
    }

    const rng = mulberry32(DEFAULT_RNG_SEED);

    console.log(`\nSSV Network Stress Test — ${STRESS_TARGET_WRITE_TXS.toLocaleString()} TXs`);
    process.stdout.write('  pre-upgrade: deploying & registering operators...\r');

    const setup = await setupStressTest(connection, networkHelpers, rng);

    process.stdout.write('  post-upgrade: verifying initial state...          \r');

    await checkState(setup, 'initial');

    const report = new RunReport();
    report.ethPriceUSD = ethPriceUSD;
    report.txTarget = STRESS_TARGET_WRITE_TXS;
    report.ssvClustersSetup            = STRESS_SSV_CLUSTERS;
    report.ethClustersSetup            = STRESS_ETH_CLUSTERS;
    report.migrationsSetup             = 0; // SSV clusters are migrated dynamically, not in setup
    report.operatorsPreMigration       = STRESS_OPERATORS_PRE_UPGRADE;
    report.operatorsPostMigrationSetup = STRESS_OPERATORS_POST_UPGRADE;

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
    let migrateWithRemovedOpTested = false;
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
    if (setup.preUpgradeFeeDeclaration) {
      const { opId, ownerAddress } = setup.preUpgradeFeeDeclaration;

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

      await (await setup.network.connect(ownerSigner).cancelDeclaredOperatorFee(opId)).wait();
      await checkState(setup, 'post-preUpgradeFeeTest', report);
    }

    if (setup.whitelistRemovedClusterId) {
      const wlCluster = setup.simState.clusters.get(setup.whitelistRemovedClusterId);
      if (!wlCluster) throw new Error(`Whitelist-revoked cluster ${setup.whitelistRemovedClusterId} not in simState`);

      console.log(`\n  [static] whitelist-revoked cluster: migrate + register-fail test (${wlCluster.id.slice(0, 14)})`);

      await migrateClusterDirectly(wlCluster, setup, report);
      await checkState(setup, 'post-whitelistRevoke-migrate', report);

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

      wlCluster.canRegister = false;
      console.log(`  [static] whitelist-revoked cluster passed — migration OK, register blocked (canRegister=false)`);
    }

    {
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

      const dummyKey = makeValKey(999_000_000);

      await assertReverts(
        setup.network.connect(ssvOwner).withdraw(ops, 1n, strct),
        'IncorrectClusterVersion',
        'withdraw on SSV cluster',
      );

      await assertReverts(
        setup.network.connect(ssvOwner).registerValidator(dummyKey, ops, DEFAULT_SHARES, strct, { value: 0 }),
        'IncorrectClusterVersion',
        'registerValidator on SSV cluster',
      );

      await assertReverts(
        setup.network.connect(ssvOwner).bulkRegisterValidator([dummyKey], ops, [DEFAULT_SHARES], strct, { value: 0 }),
        'IncorrectClusterVersion',
        'bulkRegisterValidator on SSV cluster',
      );

      await assertReverts(
        setup.network.connect(liqOwner).reactivate(liquidatedSsvCluster.operatorIds, liqStrct, { value: 0 }),
        'IncorrectClusterVersion',
        'reactivate on liquidated SSV cluster',
      );

      await assertReverts(
        setup.network.connect(setup.deployer).deposit(ssvCluster.owner, ops, strct, { value: 1n }),
        'IncorrectClusterVersion',
        'deposit (ETH) on SSV cluster',
      );

      await checkState(setup, 'post-ssvVersionTests', report);
    }

    {
      const overUnstakeStaker = setup.allSigners[_SL_EOA_START];
      const stakeAmount = 5n * 10n ** 18n;
      const networkAddr = await setup.network.getAddress();

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

    {
      const earlyClaimStaker = setup.allSigners[_SL_EOA_START + 1];
      const stakeTotal = 10n * 10n ** 18n;
      const firstUnstake = 4n * 10n ** 18n;
      const secondUnstake = 6n * 10n ** 18n;
      const networkAddr = await setup.network.getAddress();

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

      await provider.send('hardhat_mine', ['0x' + (STRESS_COOLDOWN_SECS + 1n).toString(16)]);
      await provider.send('evm_increaseTime', [Number(STRESS_COOLDOWN_SECS) + 1]);
      advanceAll(setup.simState, BigInt(await provider.getBlockNumber()));

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

      const wu1 = await (await setup.network.connect(earlyClaimStaker).withdrawUnlocked()).wait();
      if (!wu1) throw new Error('earlyClaimStaker withdrawUnlocked() receipt null');
      advanceAll(setup.simState, BigInt(wu1.blockNumber));
      {
        const bd = await provider.getBlock(wu1.blockNumber);
        const stakerRec = setup.simState.stakers.get(earlyClaimStaker.address.toLowerCase())!;
        stakerRec.pendingUnstake = stakerRec.pendingUnstake.filter(r => r.unlockTime > BigInt(bd.timestamp));
      }

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

      await checkState(setup, 'post-earlyWithdrawRevert', report);
    }

    {
      console.log('\n  [static] setting up 20 removed-op clusters (canRegister=false test)');
      const { simState, network } = setup;

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

      const publicOps = [...simState.operators.values()]
        .filter(op => !op.isRemoved && !op.isPrivate && op.id !== testOpId)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 3)
        .map(op => op.id);
      if (publicOps.length < 3) throw new Error('static removed-op test: not enough public operators');
      const testOpSet = [...publicOps, testOpId].sort((a, b) => (a < b ? -1 : 1));

      let testClusterBurnRate = simState.network.feeWei;
      for (const opId of testOpSet) testClusterBurnRate += simState.operators.get(opId)!.feeWei;

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
        for (const opId of testOpSet) {
          const op = simState.operators.get(opId)!;
          op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
          op.effectiveBalance += DEFAULT_EB;
        }
        simState.network.totalEffectiveBalance += DEFAULT_EB;
        testClusters.push(clusterRec);

        report.ethClustersDynamic++;
        report.record('registerValidator', BigInt(regReceipt.gasUsed ?? 0n), regTxBlock);
      }

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

      for (const cluster of testClusters) {
        await reactivateClusterDirectly(cluster, setup, report);
      }

      for (const cluster of testClusters) {
        cluster.canRegister = false;
      }

      await checkState(setup, 'post-removedOpClusters', report);
      console.log(`  [static] done — ${testClusters.length} clusters marked canRegister=false (op #${testOpId})`);
    }

    {
      const emptyCluster = setup.emptySSVClusterForMigrateTest;
      if (emptyCluster) {
        console.log(`\n  [static] empty-SSV migrate test (cluster ${emptyCluster.id.slice(0, 14)})`);
        const emptyOwner = setup.allSigners.find((s: any) =>
          s.address.toLowerCase() === emptyCluster.owner.toLowerCase(),
        );
        if (!emptyOwner) throw new Error('empty SSV cluster owner signer not found');

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

        await migrateClusterDirectly(emptyCluster, setup, report);
        await checkState(setup, 'post-emptySsvCluster-migrate', report);

        {
          const n = 5;
          const keys: string[] = [];
          for (let v = 0; v < n; v++) keys.push(makeValKey(setup.simState.nextValidatorSeed++));
          const shares = keys.map(() => DEFAULT_SHARES);

          const preTxBlock = BigInt(await provider.getBlockNumber());
          advanceAll(setup.simState, preTxBlock);

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

          let lastParsed: any = null;
          for (const log of bulkReceipt.logs ?? []) {
            try {
              const p = setup.network.interface.parseLog(log);
              if (p?.name === 'ValidatorAdded') lastParsed = p.args.cluster ?? p.args[4];
            } catch { /* skip */ }
          }
          if (!lastParsed) throw new Error('empty-SSV migrate test: no ValidatorAdded event found');

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
            if (op && !op.isRemoved) {
              op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
              op.effectiveBalance += addedEB;
            }
          }
          setup.simState.network.totalEffectiveBalance += addedEB;

          report.record(`bulkRegisterValidator(${emptyCluster.operatorIds.length})`, BigInt(bulkReceipt.gasUsed ?? 0n), txBlock);
        }

        await checkState(setup, 'post-emptySsvCluster-bulkRegister', report);
        console.log(`  [static] empty-SSV migrate test done — cluster is now ETH with ${emptyCluster.validatorCount} validators`);
      }
    }

    const MINE_WEIGHT    = 40;   // relative weight for the "mine" option (~17% of picks)
    const SAME_BLOCK_PCT = 8n;   // % chance a protocol TX shares a block with the previous one

    while (report.primaryActionCount < STRESS_TARGET_WRITE_TXS) {
      const currentBlock = BigInt(await provider.getBlockNumber());
      currentBlockForProgress = currentBlock;

      const poolWeighted = [
        ...ALL_ACTIONS.map(a => ({ item: a as WeightedAction | { name: 'mine'; fn?: never }, weight: a.weight })),
        { item: { name: 'mine' as const }, weight: MINE_WEIGHT },
      ];
      const picked = pickWeighted(rng, poolWeighted);
      if (!picked) continue;

      if (picked.name === 'mine') {
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
      } else {
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
          const isStakingSync = ['stake', 'requestUnstake', 'transferCSSV', 'claimEthRewards'].includes(action.name);
          await checkState(setup, `after:${action.name}:tx${report.primaryActionCount}`, report, isStakingSync);
          report.checkStateCallCount++;
          checkStateCount++;

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

          if (action.name === 'removeOperator') {
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

    await checkState(setup, 'final', report);

    report.recordOperatorStats(setup.simState.operators);
    report.recordNetworkStats(setup.simState.network);
    report.recordStakingDust(setup.simState.totalStakingDust);
    report.recordStakerSummaries(setup.simState.stakers);

    await teardown(setup, report);

    try { report.writeSuccessHistory(); } catch { /* non-fatal */ }

    } finally {
      clearInterval(progressInterval);
      process.stdout.write('\n'); // end progress bar line

      try { report.print(); } catch { /* ignore print errors */ }

      try {
        const reportsDir = path.join(process.cwd(), 'test', 'stress', 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        const htmlPath = path.join(reportsDir, 'stress-test-report.html');
        await report.writeHTML(htmlPath);
      } catch (htmlErr) {
        console.error('  Failed to write HTML report:', htmlErr);
      }
    }
  });
});
