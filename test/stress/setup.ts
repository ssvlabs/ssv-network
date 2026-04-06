// Stress test setup: deploy the network (pre-upgrade → upgrade), register operators and clusters.
// Flow:
//   1. Deploy V1.2.0 (legacy) network via ssvNetworkFullPreUpgradeFixture
//   2. Register STRESS_OPERATORS_PRE_UPGRADE SSV operators + STRESS_SSV_CLUSTERS SSV clusters
//   3. Upgrade to V2.0.0 via upgradeToStakingVersion
//   4. Register STRESS_OPERATORS_POST_UPGRADE ETH operators + STRESS_ETH_CLUSTERS ETH clusters
//   SSV clusters remain active post-upgrade and are migrated dynamically by actMigrateCluster

import { ethers } from 'ethers';
import type { NetworkConnection } from 'hardhat/types/network';
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from '../setup/fixtures.ts';
import { parseClusterFromEvent } from '../helpers/cluster.ts';
import { computeClusterId, setupOracles } from '../helpers/oracle.ts';
import { Events } from '../common/events.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from '../common/constants.ts';
import {
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  VERSION_SSV,
  VERSION_ETH,
  DEFAULT_OPERATOR_ETH_FEE,
  STRESS_OPERATORS_PRE_UPGRADE, STRESS_OPERATORS_POST_UPGRADE,
  STRESS_OPERATORS_REMOVED_PRE_UPGRADE,
  STRESS_ETH_CLUSTERS, STRESS_SSV_CLUSTERS,
  STRESS_SSV_OWNERS, STRESS_SSV_CLUSTERS_LIQUIDATED, STRESS_SAC_CLUSTERS, STRESS_SSV_CLUSTERS_SHORTRUN,
  STRESS_TOTAL_SIGNERS,
  _SL_PRE_OPS_START, _SL_SSV_OWN_START, _SL_POST_OPS_START, _SL_POST_OPS_END,
  _SL_ETH_CLU_START, _SL_SAC_START, _SL_DOOMED_START, _SL_DOOMED_END,
  _SL_ORC_SIG_START, ORACLE_STAKER_INDEX,
  INIT_NETWORK_FEE_ETH, INIT_MIN_BLOCKS_LIQ, INIT_MIN_LIQ_COLLATERAL,
  INIT_MIN_OPERATOR_SSV_FEE,
  INIT_NETWORK_FEE_SSV,
  DEFAULT_CLUSTER_DEPOSIT, DEFAULT_SSV_CLUSTER_DEPOSIT,
  HARDHAT_MNEMONIC,
  VALID_OP_SET_SIZES,
  SEED_ETH, SEED_SSV,
  TARGET_NETWORK_FEE_ETH,
  TARGET_OPERATOR_ETH_FEE,
  FEE_DEVIATION_BPS,
  STRESS_MIN_OPERATOR_ETH_FEE,
  STRESS_FEE_PERIOD_SECS,
  INIT_DECLARE_PERIOD,
  ORACLE_STAKER_STAKE,
} from './constants.ts';
import { DEFAULT_EB } from './state.ts';
import type { SimState, OperatorRecord, ClusterRecord, ClusterStruct, NetworkRecord, StakerRecord } from './state.ts';
import { advanceAll } from './state.ts';
import type { RNG } from './random.ts';

// ─── Fee randomisation helper ─────────────────────────────────────────────

/**
 * Return a fee randomly drawn from [center*(1-dev%), center*(1+dev%)],
 * rounded to the nearest ETH_DEDUCTED_DIGITS precision unit.
 */
function randFee(rng: RNG, center: bigint, deviationBps: bigint): bigint {
  const rangeBps = 2n * deviationBps + 1n;              // e.g. 1401 for 700 BPS
  const devBps   = rng.nextInt(rangeBps) - deviationBps; // uniform in [-700, +700]
  const raw      = center + (center * devBps) / 10_000n;
  // Round to nearest ETH_DEDUCTED_DIGITS
  return ((raw + ETH_DEDUCTED_DIGITS / 2n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

// ─── Signer pool ─────────────────────────────────────────────────────────

/** Return signer at index, impersonating + funding extra accounts beyond the 20 defaults. */
export async function getSigner(
  connection: NetworkConnection<'generic'>,
  defaultSigners: any[],
  index: number,
): Promise<any> {
  if (index < defaultSigners.length) return defaultSigners[index];
  const provider = connection.ethers.provider as any;
  const mnemonic = ethers.Mnemonic.fromPhrase(HARDHAT_MNEMONIC);
  const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
  await provider.send('hardhat_setBalance', [
    wallet.address,
    '0x' + (2000n * 10n ** 18n).toString(16),
  ]);
  await provider.send('hardhat_impersonateAccount', [wallet.address]);
  return provider.getSigner(wallet.address);
}

// ─── StressSetup ─────────────────────────────────────────────────────────

export interface PreUpgradeFeeDeclaration {
  opId:              bigint;
  ownerAddress:      string;
  declaredFee:       bigint;  // SSV fee declared on V1.2.0
  approvalBeginTime: bigint;  // unix timestamp when execute window opens
}

export interface StressSetup {
  network:    any;
  views:      any;
  ssvToken:   any;
  cssvToken:  any;     // cSSV ERC-20 — minted by stake(), freely transferable
  provider:   any;
  deployer:   any;     // signer[0]
  liquidator: any;     // signer[1]
  allSigners: any[];   // full signer pool
  simState:   SimState;
  connection: any;     // NetworkConnection — passed to generateMerkleForClusterEB
  oracleSigners: any[]; // 3 signers registered at oracle slots 1, 2, 3
  preUpgradeFeeDeclaration?: PreUpgradeFeeDeclaration;
  whitelistRemovedClusterId?: string;
  emptySSVClusterForMigrateTest?: ClusterRecord;
}

// ─── Main setup ──────────────────────────────────────────────────────────

export async function setupStressTest(
  connection: NetworkConnection<'generic'>,
  networkHelpers: any,
  rng: RNG,
): Promise<StressSetup> {
  const provider = connection.ethers.provider as any;
  const defaultSigners = await connection.ethers.getSigners();

  // Build the full signer pool — size derived from scaled constants
  const allSigners: any[] = [];
  for (let i = 0; i < STRESS_TOTAL_SIGNERS; i++) {
    allSigners.push(await getSigner(connection, defaultSigners, i));
  }

  const deployer   = allSigners[0];
  const liquidator = allSigners[1];

  // ── Phase 1: Deploy V1.2.0 (pre-upgrade) ─────────────────────────────
  async function stressPreUpgradeFixture() {
    return ssvNetworkFullPreUpgradeFixture(connection);
  }
  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await networkHelpers.loadFixture(stressPreUpgradeFixture);

  // Build the SimState — will be populated below
  const netRecord: NetworkRecord = {
    block:                    0n,
    ethNetworkEarnings:       0n,
    accEthPerShare:           0n,
    lastSyncedPackedEarnings: 0n,
    feeWei:                   INIT_NETWORK_FEE_ETH,
    totalEffectiveBalance:    0n,
    ssvNetworkEarnings:       0n,
    feeSSVWei:                INIT_NETWORK_FEE_SSV,
    totalSSVValidators:       0n,
  };

  const simState: SimState = {
    operators:  new Map(),
    clusters:   new Map(),
    stakers:    new Map(),
    network:    netRecord,
    minimumBlocksBeforeLiquidation:  INIT_MIN_BLOCKS_LIQ,
    minimumLiquidationCollateral:    INIT_MIN_LIQ_COLLATERAL,
    minimumLiquidationCollateralSSV: INIT_MIN_LIQ_COLLATERAL,  // same initial value for SSV clusters
    nextValidatorSeed: 1,
    totalClampingExcess: 0n,
    totalStakingDust: 0n,
    pendingEBRound: null,
  };

  // ── Phase 2: Register pre-upgrade SSV operators (V1.2.0) ─────────────
  process.stdout.write(`  [setup] phase 2: registering ${STRESS_OPERATORS_PRE_UPGRADE} operators...\r`);
  for (let i = 0; i < STRESS_OPERATORS_PRE_UPGRADE; i++) {
    const owner = allSigners[_SL_PRE_OPS_START + i];
    const opKey = makeOpKey(i);
    // SSV fee (must be divisible by DEDUCTED_DIGITS = 10_000_000)
    const ssvFeeWei = INIT_MIN_OPERATOR_SSV_FEE + BigInt(i) * DEDUCTED_DIGITS;
    const isPrivate = i % 5 === 0;

    const receipt = await (await legacyNetwork.connect(owner).registerOperator(opKey, ssvFeeWei, isPrivate)).wait();
    const opId = parseOperatorId(receipt, legacyNetwork);
    const block = BigInt(receipt.blockNumber);

    const rec: OperatorRecord = {
      id:               opId,
      owner:            owner.address,
      feeWei:           DEFAULT_OPERATOR_ETH_FEE,  // will be effective after upgrade
      block,
      balance:          0n,
      effectiveBalance: 0n,
      ssvFeeWei,
      ssvBlock:         block,
      ssvBalance:       0n,
      ssvValidatorCount: 0n,
      pendingFeeWei:               0n,
      pendingFeeBlock:             0n,
      pendingFeeApprovalBeginTime: 0n,
      pendingFeeApprovalEndTime:   0n,
      isRemoved:        false,
      isPrivate,
      whitelistedAddresses: new Set<string>(),
    };
    simState.operators.set(opId, rec);
  }

  // ── Phase 3: Create SSV clusters (V1.2.0, using 5-arg registerValidator) ──
  process.stdout.write(`  [setup] phase 3: creating ${STRESS_SSV_CLUSTERS} SSV clusters...\r`);
  const allOpIds = [...simState.operators.keys()].sort((a, b) => (a < b ? -1 : 1));

  // Whitelist potential SSV cluster owners for private operators
  const potentialSsvOwners = allSigners.slice(_SL_SSV_OWN_START, _SL_SSV_OWN_START + STRESS_SSV_OWNERS);
  for (const opId of allOpIds) {
    const op = simState.operators.get(opId)!;
    if (op.isPrivate) {
      const ownerSigner = allSigners.find((s: any) => s.address.toLowerCase() === op.owner.toLowerCase());
      if (ownerSigner) {
        const addrs = potentialSsvOwners.map((s: any) => s.address);
        await (await legacyNetwork.connect(ownerSigner).setOperatorsWhitelists([opId], addrs)).wait();
        for (const addr of addrs) op.whitelistedAddresses.add(addr.toLowerCase());
      }
    }
  }

  for (let i = 0; i < STRESS_SSV_CLUSTERS; i++) {
    const owner = allSigners[_SL_SSV_OWN_START + (i % STRESS_SSV_OWNERS)];

    // Use 4/7/10/13-operator sets (mirrors ETH cluster selection)
    const achievableSsvSizes = VALID_OP_SET_SIZES.filter(s => s <= allOpIds.length);
    if (achievableSsvSizes.length === 0) continue;
    const ssvOpSetSize = achievableSsvSizes[i % achievableSsvSizes.length];
    const startIdx = (i * 3) % (allOpIds.length - ssvOpSetSize + 1);
    const opSet = allOpIds.slice(startIdx, startIdx + ssvOpSetSize);
    if (opSet.length !== ssvOpSetSize) continue;

    // Most clusters have multiple validators: cycle through 1-5 so ~80% have >1
    const nValidators = 1 + (i % 5); // 1, 2, 3, 4, 5 repeating

    // SSV burnRate = sum(op.ssvFeeWei) + networkFeeSSVWei
    let ssvBurnRate = simState.network.feeSSVWei;
    for (const opId of opSet) ssvBurnRate += simState.operators.get(opId)!.ssvFeeWei;

    // Check if this owner+opSet cluster already exists (startIdx cycle can repeat for some sizes).
    // If so, append validators to the existing cluster instead of creating a new one.
    const clusterId = computeClusterId(owner.address, opSet);
    const existingCluster = simState.clusters.get(clusterId);

    let lastTxBlock: bigint;
    let lastParsed: any;

    if (!existingCluster) {
      // New cluster: mint tokens, register first validator with full deposit + EMPTY_CLUSTER
      await (await ssvToken.mint(owner.address, DEFAULT_SSV_CLUSTER_DEPOSIT)).wait();
      await (await ssvToken.connect(owner).approve(await legacyNetwork.getAddress(), DEFAULT_SSV_CLUSTER_DEPOSIT)).wait();

      let preTxBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, preTxBlock);
      const firstValKey = makeValKey(simState.nextValidatorSeed++);
      const firstTx = await legacyNetwork.connect(owner).registerValidator(
        firstValKey, opSet, DEFAULT_SHARES, DEFAULT_SSV_CLUSTER_DEPOSIT, EMPTY_CLUSTER,
      );
      const firstReceipt = await firstTx.wait();
      lastTxBlock = BigInt(firstReceipt.blockNumber);
      advanceAll(simState, lastTxBlock);
      lastParsed = parseClusterFromEvent(legacyNetwork, firstReceipt, Events.VALIDATOR_ADDED);
      // Increment immediately so subsequent advanceAll calls use the correct count
      for (const opId of opSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
      simState.network.totalSSVValidators += 1n;

      const valKeys = new Set<string>([firstValKey]);

      // Register additional validators (no extra SSV deposit — balance already funded)
      for (let v = 1; v < nValidators; v++) {
        preTxBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preTxBlock);
        const addlValKey = makeValKey(simState.nextValidatorSeed++);
        const addlTx = await legacyNetwork.connect(owner).registerValidator(
          addlValKey, opSet, DEFAULT_SHARES, 0n, parsedToStruct(lastParsed),
        );
        const addlReceipt = await addlTx.wait();
        lastTxBlock = BigInt(addlReceipt.blockNumber);
        advanceAll(simState, lastTxBlock);
        lastParsed = parseClusterFromEvent(legacyNetwork, addlReceipt, Events.VALIDATOR_ADDED);
        valKeys.add(addlValKey);
        for (const opId of opSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
      }

      const clusterRec: ClusterRecord = {
        id:               clusterId,
        owner:            owner.address,
        operatorIds:      [...opSet],
        version:          VERSION_SSV,
        block:            0n,
        balance:          0n,
        burnRate:         0n,
        effectiveBalance: 0n,
        ssvBlock:         lastTxBlock,
        ssvBalance:       lastParsed.balance,
        ssvBurnRate,
        createdBlock:     lastTxBlock,
        validatorCount:   lastParsed.validatorCount,
        active:           lastParsed.active,
        canRegister:      true,
        lastOracleEB:     0n,
        validators:       valKeys,
        lastStruct:       parsedToStruct(lastParsed),
      };
      simState.clusters.set(clusterId, clusterRec);
    } else {
      // Existing cluster (same owner+opSet already registered): append nValidators more validators.
      // No new deposit needed — existing balance is sufficient.
      lastTxBlock = existingCluster.ssvBlock;
      lastParsed = existingCluster.lastStruct;

      for (let v = 0; v < nValidators; v++) {
        const preTxBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preTxBlock);
        const addlValKey = makeValKey(simState.nextValidatorSeed++);
        const addlTx = await legacyNetwork.connect(owner).registerValidator(
          addlValKey, opSet, DEFAULT_SHARES, 0n, lastParsed,
        );
        const addlReceipt = await addlTx.wait();
        lastTxBlock = BigInt(addlReceipt.blockNumber);
        advanceAll(simState, lastTxBlock);
        lastParsed = parseClusterFromEvent(legacyNetwork, addlReceipt, Events.VALIDATOR_ADDED);
        existingCluster.validators.add(addlValKey);
        for (const opId of opSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
      }
      existingCluster.ssvBlock     = lastTxBlock;
      existingCluster.ssvBalance   = lastParsed.balance;
      existingCluster.validatorCount = lastParsed.validatorCount;
      existingCluster.lastStruct   = parsedToStruct(lastParsed);
    }
  }

  process.stdout.write(`  [setup] phase 3.5: removing ${STRESS_OPERATORS_REMOVED_PRE_UPGRADE} operators pre-upgrade...\r`);
  // ── Phase 3.5: Remove STRESS_OPERATORS_REMOVED_PRE_UPGRADE operators pre-upgrade ──
  // Pick operators from the tail of the pre-upgrade pool that have no active clusters
  // (registered but not yet used in any cluster — we pick from beyond the cluster slot usage).
  // This seeds the sim with removed operators before upgrade, triggering edge cases like
  // regression2/3 organically during the main loop.
  {
    // Only remove operators with no SSV validators — operators in clusters cannot be removed
    // in the legacy contract if they have active validators. Pick any unused operator first,
    // then fall back to operators with validators (which the legacy contract WILL allow;
    // _resetOperatorState forces validatorCount to 0). We try/catch so a revert is skipped.
    const removalCandidates = [...allOpIds]
      .sort((a, b) => {
        const va = simState.operators.get(a)!.ssvValidatorCount;
        const vb = simState.operators.get(b)!.ssvValidatorCount;
        return va < vb ? -1 : va > vb ? 1 : 0;  // prefer zero-validator operators first
      })
      .slice(0, STRESS_OPERATORS_REMOVED_PRE_UPGRADE);

    for (const opId of removalCandidates) {
      const op = simState.operators.get(opId)!;
      if (op.isRemoved) continue;
      const ownerSigner = allSigners.find((s: any) => s.address.toLowerCase() === op.owner.toLowerCase());
      if (!ownerSigner) continue;

      const preBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, preBlock);

      let receipt: any;
      try {
        receipt = await (await legacyNetwork.connect(ownerSigner).removeOperator(opId)).wait();
      } catch {
        continue;  // legacy contract may reject if operator has active validators
      }
      const removeBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, removeBlock);

      // Mirror _resetOperatorState: zero out earnings, counts, fees
      const removedSsvFee = op.ssvFeeWei;
      op.feeWei            = 0n;
      op.ssvFeeWei         = 0n;
      op.balance           = 0n;
      op.ssvBalance        = 0n;
      op.effectiveBalance  = 0n;
      op.ssvValidatorCount = 0n;
      op.isRemoved         = true;

      // On-chain, the removed operator's SSV index is frozen at removeBlock.
      // All SSV clusters containing this operator stop accruing that operator's fee portion
      // from removeBlock onward. Update simState to match (balance already snapshotted above).
      // Also mark canRegister=false — registerValidator reverts if any cluster operator is removed.
      if (removedSsvFee > 0n || true) {
        for (const cluster of simState.clusters.values()) {
          if (cluster.operatorIds.includes(opId)) {
            cluster.canRegister = false;
            if (cluster.version === VERSION_SSV && cluster.active && removedSsvFee > 0n) {
              cluster.ssvBurnRate -= removedSsvFee;
            }
          }
        }
      }
    }
  }

  // ── Phase 3.6: Create STRESS_SSV_CLUSTERS_LIQUIDATED SSV clusters to self-liquidate post-upgrade ──
  // Clusters are created with DEFAULT_SSV_CLUSTER_DEPOSIT. After the upgrade, liquidateSSV is called
  // by the cluster owner (msg.sender == clusterOwner bypasses the threshold check — V2 feature).
  // These inactive SSV clusters remain in simState and will be migrated by actMigrateCluster.
  process.stdout.write(`  [setup] phase 3.6: creating ${STRESS_SSV_CLUSTERS_LIQUIDATED} SSV clusters for post-upgrade self-liquidation...\r`);
  let preUpgradeFeeDeclaration: PreUpgradeFeeDeclaration | undefined;
  let whitelistRemovedClusterId: string | undefined;
  // Declared outside scoped block so Phase 4.0 (self-liquidation) and Phase 3.8 can reference them.
  const doomedClusters: ClusterRecord[] = [];
  let doomedOpSet: bigint[] = [];
  let doomedSsvBurnRate = 0n;
  {
    const nonPrivateOpIds = allOpIds.filter(id => {
      const op = simState.operators.get(id);
      return op && !op.isPrivate && !op.isRemoved;
    });
    if (nonPrivateOpIds.length >= 4) {
      doomedOpSet = nonPrivateOpIds.slice(0, 4);

      // SSV burn rate for 1 validator on this op set
      doomedSsvBurnRate = simState.network.feeSSVWei;
      for (const opId of doomedOpSet) doomedSsvBurnRate += simState.operators.get(opId)!.ssvFeeWei;

      console.log(`  [setup] phase 3.6: doomedOpSet = [${doomedOpSet.join(', ')}]`);
      for (let i = 0; i < STRESS_SSV_CLUSTERS_LIQUIDATED; i++) {
        const doomedOwner = allSigners[_SL_DOOMED_START + i];
        process.stdout.write(`  [setup] phase 3.6: doomed cluster ${i}/${STRESS_SSV_CLUSTERS_LIQUIDATED}...\r`);

        await (await ssvToken.mint(doomedOwner.address, DEFAULT_SSV_CLUSTER_DEPOSIT)).wait();
        await (await ssvToken.connect(doomedOwner).approve(await legacyNetwork.getAddress(), DEFAULT_SSV_CLUSTER_DEPOSIT)).wait();

        const preBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preBlock);

        const doomedValKey = makeValKey(simState.nextValidatorSeed++);
        const doomedTx = await legacyNetwork.connect(doomedOwner).registerValidator(
          doomedValKey, doomedOpSet, DEFAULT_SHARES, DEFAULT_SSV_CLUSTER_DEPOSIT, EMPTY_CLUSTER,
        );
        const doomedReceipt = await doomedTx.wait();
        const doomedTxBlock = BigInt(doomedReceipt.blockNumber);
        advanceAll(simState, doomedTxBlock);

        const doomedParsed = parseClusterFromEvent(legacyNetwork, doomedReceipt, Events.VALIDATOR_ADDED);
        const doomedClusterId = computeClusterId(doomedOwner.address, doomedOpSet);

        const doomedRec: ClusterRecord = {
          id:               doomedClusterId,
          owner:            doomedOwner.address,
          operatorIds:      [...doomedOpSet],
          version:          VERSION_SSV,
          block:            0n,
          balance:          0n,
          burnRate:         0n,
          effectiveBalance: 0n,
          ssvBlock:         doomedTxBlock,
          ssvBalance:       doomedParsed.balance,
          ssvBurnRate:      doomedSsvBurnRate,
          createdBlock:     doomedTxBlock,
          validatorCount:   doomedParsed.validatorCount,
          active:           doomedParsed.active,
          canRegister:      true,
          lastOracleEB:     0n,
          validators:       new Set([doomedValKey]),
          lastStruct:       parsedToStruct(doomedParsed),
        };
        simState.clusters.set(doomedClusterId, doomedRec);
        for (const opId of doomedOpSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
        doomedClusters.push(doomedRec);
      }
    }

    // ── Phase 3.65: Remove cluster owner from a private operator's whitelist ────
    // This cluster will migrate successfully post-upgrade (migration bypasses whitelist),
    // but any subsequent registerValidator attempt will revert with CallerNotWhitelistedWithData.
    // Asserted as a static test in index.test.ts after upgrade.
    {
      const candidateClusters = [...simState.clusters.values()].filter(c => {
        if (c.version !== VERSION_SSV || !c.active) return false;
        // All operators must be non-removed — registerValidator checks ensureOperatorExist
        // on every operator, so a single removed op causes OperatorDoesNotExist instead of
        // CallerNotWhitelistedWithData (which is what the static test asserts).
        if (c.operatorIds.some(id => simState.operators.get(id)?.isRemoved)) return false;
        return c.operatorIds.some(id => {
          const op = simState.operators.get(id);
          return op && op.isPrivate && !op.isRemoved &&
                 op.whitelistedAddresses.has(c.owner.toLowerCase());
        });
      });
      const targetCluster = candidateClusters[0];
      if (targetCluster) {
        const privateOpId = targetCluster.operatorIds.find(id => {
          const op = simState.operators.get(id);
          return op && op.isPrivate && !op.isRemoved &&
                 op.whitelistedAddresses.has(targetCluster.owner.toLowerCase());
        })!;
        const privateOp = simState.operators.get(privateOpId)!;
        const privateOpOwner = allSigners.find((s: any) =>
          s.address.toLowerCase() === privateOp.owner.toLowerCase(),
        )!;

        const preBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preBlock);

        await (await legacyNetwork.connect(privateOpOwner).removeOperatorsWhitelists(
          [privateOpId], [targetCluster.owner],
        )).wait();

        // Mirror on-chain state: cluster owner is no longer whitelisted by this operator
        privateOp.whitelistedAddresses.delete(targetCluster.owner.toLowerCase());
        whitelistRemovedClusterId = targetCluster.id;
        process.stdout.write(`  [setup] phase 3.65: removed ${targetCluster.owner.slice(0, 10)} from op #${privateOpId} whitelist (cluster ${targetCluster.id.slice(0, 14)})\n`);
      }
    }

    // ── Phase 3.7: Declare an SSV operator fee right before upgrade ─────────
    // After upgrade this execute call must revert with LegacyOperatorFeeDeclarationInvalid.
    const activeOpIds = allOpIds.filter(id => !simState.operators.get(id)!.isRemoved);
    if (activeOpIds.length > 0) {
      const preUpgradeFeeOpId = activeOpIds[0];
      const preUpgradeFeeOp = simState.operators.get(preUpgradeFeeOpId)!;
      const preUpgradeFeeOwner = allSigners.find((s: any) => s.address.toLowerCase() === preUpgradeFeeOp.owner.toLowerCase());
      if (preUpgradeFeeOwner) {
        const declaredFee = preUpgradeFeeOp.ssvFeeWei + DEDUCTED_DIGITS; // small increase
        const declareTx = await legacyNetwork.connect(preUpgradeFeeOwner).declareOperatorFee(preUpgradeFeeOpId, declaredFee);
        const declareReceipt = await declareTx.wait();
        const declareBlock = await provider.getBlock(declareReceipt.blockNumber);
        const approvalBeginTime = BigInt(declareBlock.timestamp) + INIT_DECLARE_PERIOD;

        // Mine INIT_DECLARE_PERIOD+1 blocks before upgrading.
        // Each Hardhat block advances timestamp by 1s, so this advances time by ~604801s.
        // approvalBeginTime = declareBlock.timestamp + 604800 (Unix seconds).
        // UPGRADE_TIMESTAMP = upgradeBlock.timestamp (also Unix seconds, set in fixtures.ts).
        // After mining: upgradeBlock.timestamp ≈ declareBlock.timestamp + 604801 + N
        // → approvalBeginTime (T+604800) ≤ UPGRADE_TIMESTAMP (T+604801+N) → LegacyOperatorFeeDeclarationInvalid fires.
        await provider.send('hardhat_mine', ['0x' + (INIT_DECLARE_PERIOD + 1n).toString(16)]);
        const postDeclareBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, postDeclareBlock);

        preUpgradeFeeDeclaration = { opId: preUpgradeFeeOpId, ownerAddress: preUpgradeFeeOwner.address, declaredFee, approvalBeginTime };
      }
    }
  }

  // ── Phase 3.8: Create STRESS_SSV_CLUSTERS_SHORTRUN short-runway SSV clusters ─────────────
  // These clusters have ~2k blocks of runway above the liquidation threshold.
  // Created AFTER the 604801-block mine so they start fresh. They will drain during the
  // random loop post-upgrade and become liquidatable (picked up by actLiquidate).
  process.stdout.write(`  [setup] phase 3.8: creating ${STRESS_SSV_CLUSTERS_SHORTRUN} short-runway SSV clusters...\r`);
  if (doomedOpSet.length >= 4) {
    // threshold = max(minimumBlocksBeforeLiquidation * burnRate, minimumLiquidationCollateralSSV)
    const srBlockThreshold = simState.minimumBlocksBeforeLiquidation * doomedSsvBurnRate;
    const srCollateral = simState.minimumLiquidationCollateralSSV;
    const srThreshold = srBlockThreshold > srCollateral ? srBlockThreshold : srCollateral;
    // Deposit gives ~2k blocks of runway above the liquidation threshold
    const srDeposit = srThreshold + 2000n * doomedSsvBurnRate;

    for (let i = 0; i < STRESS_SSV_CLUSTERS_SHORTRUN; i++) {
      // Reuse SSV cluster owner signers — already whitelisted for private operators
      const srOwner = allSigners[_SL_SSV_OWN_START + (i % STRESS_SSV_OWNERS)];
      process.stdout.write(`  [setup] phase 3.8: shortrun cluster ${i}/${STRESS_SSV_CLUSTERS_SHORTRUN}...\r`);

      await (await ssvToken.mint(srOwner.address, srDeposit)).wait();
      await (await ssvToken.connect(srOwner).approve(await legacyNetwork.getAddress(), srDeposit)).wait();

      const preBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, preBlock);

      const srValKey = makeValKey(simState.nextValidatorSeed++);
      // Use EMPTY_CLUSTER since each srOwner may own the doomedOpSet cluster from a previous
      // iteration — but different srOwner means different cluster key, so check if already exists.
      const srClusterId = computeClusterId(srOwner.address, doomedOpSet);
      const srExisting = simState.clusters.get(srClusterId);
      if (!srExisting) {
        // First cluster for this owner + op set — register with full deposit
        const srTx = await legacyNetwork.connect(srOwner).registerValidator(
          srValKey, doomedOpSet, DEFAULT_SHARES, srDeposit, EMPTY_CLUSTER,
        );
        const srReceipt = await srTx.wait();
        const srTxBlock = BigInt(srReceipt.blockNumber);
        advanceAll(simState, srTxBlock);

        const srParsed = parseClusterFromEvent(legacyNetwork, srReceipt, Events.VALIDATOR_ADDED);
        const srRec: ClusterRecord = {
          id:               srClusterId,
          owner:            srOwner.address,
          operatorIds:      [...doomedOpSet],
          version:          VERSION_SSV,
          block:            0n,
          balance:          0n,
          burnRate:         0n,
          effectiveBalance: 0n,
          ssvBlock:         srTxBlock,
          ssvBalance:       srParsed.balance,
          ssvBurnRate:      doomedSsvBurnRate,
          createdBlock:     srTxBlock,
          validatorCount:   srParsed.validatorCount,
          active:           srParsed.active,
          canRegister:      true,
          lastOracleEB:     0n,
          validators:       new Set([srValKey]),
          lastStruct:       parsedToStruct(srParsed),
        };
        simState.clusters.set(srClusterId, srRec);
        for (const opId of doomedOpSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
      } else {
        // Cluster already exists for this owner + op set — add another validator with extra deposit
        const srTx = await legacyNetwork.connect(srOwner).registerValidator(
          srValKey, doomedOpSet, DEFAULT_SHARES, srDeposit, srExisting.lastStruct,
        );
        const srReceipt = await srTx.wait();
        const srTxBlock = BigInt(srReceipt.blockNumber);
        advanceAll(simState, srTxBlock);

        const srParsed = parseClusterFromEvent(legacyNetwork, srReceipt, Events.VALIDATOR_ADDED);
        srExisting.ssvBalance = srParsed.balance;
        srExisting.validatorCount = srParsed.validatorCount;
        srExisting.validators.add(srValKey);
        srExisting.lastStruct = parsedToStruct(srParsed);
        srExisting.ssvBlock = srTxBlock;
        for (const opId of doomedOpSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
      }
    }
  }

  // ── Phase 3.9: Create an empty SSV cluster for the post-upgrade migrate-only test ──
  // Creates a 4-op / 5-validator cluster, removes all validators, and withdraws all SSV
  // so the cluster is empty (0 validators, 0 balance, active=true) at upgrade time.
  // Post-upgrade, the static test verifies that registerValidator reverts (must migrate first),
  // then migrates and bulk-registers 5 ETH validators.
  let emptySSVClusterForMigrateTest: ClusterRecord | undefined;
  {
    process.stdout.write('  [setup] phase 3.9: creating empty SSV cluster for post-upgrade migrate test...\r');
    // Use only non-private, non-removed operators so no whitelist juggling is needed.
    const nonPrivateNonRemovedOps = allOpIds.filter(id => {
      const op = simState.operators.get(id);
      return op && !op.isPrivate && !op.isRemoved;
    });
    if (nonPrivateNonRemovedOps.length >= 4) {
      const testOpSet = nonPrivateNonRemovedOps.slice(0, 4);
      // Dedicated signer well beyond the normal pool — not in any signer range.
      const testOwner = await getSigner(connection, allSigners, STRESS_TOTAL_SIGNERS + 100);
      allSigners.push(testOwner);

      const ssvBurnRate = testOpSet.reduce(
        (sum, id) => sum + simState.operators.get(id)!.ssvFeeWei, simState.network.feeSSVWei,
      );
      const deposit = DEFAULT_SSV_CLUSTER_DEPOSIT;
      const clusterId = computeClusterId(testOwner.address, testOpSet);

      await (await ssvToken.mint(testOwner.address, deposit)).wait();
      await (await ssvToken.connect(testOwner).approve(await legacyNetwork.getAddress(), deposit)).wait();

      // Register 5 validators (first with full deposit, rest free-riding on existing balance)
      let lastTxBlock = 0n;
      let firstTxBlock = 0n;
      let lastParsed: any;
      const valKeys: string[] = [];
      for (let v = 0; v < 5; v++) {
        const preBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preBlock);
        const valKey = makeValKey(simState.nextValidatorSeed++);
        valKeys.push(valKey);
        const clusterArg = v === 0 ? EMPTY_CLUSTER : parsedToStruct(lastParsed);
        const depositAmount = v === 0 ? deposit : 0n;
        const tx = await legacyNetwork.connect(testOwner).registerValidator(
          valKey, testOpSet, DEFAULT_SHARES, depositAmount, clusterArg,
        );
        const receipt = await tx.wait();
        const txBlock = BigInt(receipt.blockNumber);
        advanceAll(simState, txBlock);
        lastParsed = parseClusterFromEvent(legacyNetwork, receipt, Events.VALIDATOR_ADDED);
        if (v === 0) firstTxBlock = txBlock;
        lastTxBlock = txBlock;
        for (const opId of testOpSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
        simState.network.totalSSVValidators += 1n;
      }

      const clusterRec: ClusterRecord = {
        id:               clusterId,
        owner:            testOwner.address,
        operatorIds:      [...testOpSet],
        version:          VERSION_SSV,
        block:            0n,
        balance:          0n,
        burnRate:         0n,
        effectiveBalance: 0n,
        ssvBlock:         lastTxBlock,
        ssvBalance:       BigInt(lastParsed.balance),
        ssvBurnRate,
        createdBlock:     firstTxBlock,
        validatorCount:   BigInt(lastParsed.validatorCount),
        active:           Boolean(lastParsed.active),
        canRegister:      true,
        lastOracleEB:     0n,
        validators:       new Set(valKeys),
        lastStruct:       parsedToStruct(lastParsed),
      };
      simState.clusters.set(clusterId, clusterRec);

      // Remove all 5 validators one by one
      for (const valKey of valKeys) {
        const preBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preBlock);
        const tx = await legacyNetwork.connect(testOwner).removeValidator(
          valKey, testOpSet, clusterRec.lastStruct,
        );
        const receipt = await tx.wait();
        const txBlock = BigInt(receipt.blockNumber);
        advanceAll(simState, txBlock);
        const parsed = parseClusterFromEvent(legacyNetwork, receipt, Events.VALIDATOR_REMOVED);
        clusterRec.validators.delete(valKey);
        clusterRec.validatorCount = BigInt(parsed.validatorCount);
        clusterRec.ssvBalance     = BigInt(parsed.balance);
        clusterRec.ssvBlock       = txBlock;
        clusterRec.lastStruct     = parsedToStruct(parsed);
        for (const opId of testOpSet) simState.operators.get(opId)!.ssvValidatorCount -= 1n;
        simState.network.totalSSVValidators -= 1n;
      }

      // Withdraw all remaining SSV balance (validatorCount=0 so no further burn accrues)
      if (clusterRec.ssvBalance > 0n) {
        const preBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preBlock);
        const tx = await legacyNetwork.connect(testOwner).withdraw(
          testOpSet, clusterRec.ssvBalance, clusterRec.lastStruct,
        );
        const receipt = await tx.wait();
        const txBlock = BigInt(receipt.blockNumber);
        advanceAll(simState, txBlock);
        const parsed = parseClusterFromEvent(legacyNetwork, receipt, Events.CLUSTER_WITHDRAWN);
        clusterRec.ssvBalance  = BigInt(parsed.balance);
        clusterRec.ssvBlock    = txBlock;
        clusterRec.lastStruct  = parsedToStruct(parsed);
      }

      emptySSVClusterForMigrateTest = clusterRec;
      process.stdout.write(`  [setup] phase 3.9: empty SSV cluster ready (${clusterId.slice(0, 14)})\n`);
    }
  }

  console.log('  [setup] phase 4: upgrading to v2.0.0...');
  // ── Phase 4: Upgrade V1.2.0 → V2.0.0 ─────────────────────────────────
  const { newNetwork, newViews, cssv: cssvToken } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

  // Update network block after upgrade
  const upgradeBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, upgradeBlock);
  simState.network.block = upgradeBlock;

  // ── Phase 4.0: Self-liquidate the STRESS_SSV_CLUSTERS_LIQUIDATED doomed clusters ──────────
  // liquidateSSV on V2 bypasses the threshold check when msg.sender == clusterOwner,
  // so we can liquidate immediately without waiting for the cluster to drain.
  // After liquidation these inactive VERSION_SSV clusters remain in simState and will be
  // migrated to ETH clusters by actMigrateCluster during the random loop.
  if (doomedClusters.length > 0) {
    process.stdout.write(`  [setup] phase 4.0: self-liquidating ${doomedClusters.length} SSV clusters...\r`);
    for (let di = 0; di < doomedClusters.length; di++) {
      const doomedCluster = doomedClusters[di];
      if (di % 10 === 0) process.stdout.write(`  [setup] phase 4.0: self-liquidating ${di}/${doomedClusters.length}...\r`);
      const doomedOwnerSigner = allSigners.find((s: any) =>
        s.address.toLowerCase() === doomedCluster.owner.toLowerCase(),
      );
      if (!doomedOwnerSigner) continue;

      const preLiqBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, preLiqBlock);

      const liqReceipt = await (await newNetwork.connect(doomedOwnerSigner).liquidateSSV(
        doomedCluster.owner, doomedCluster.operatorIds, doomedCluster.lastStruct,
      )).wait();
      if (!liqReceipt) throw new Error(`Phase 4.0: liquidateSSV receipt null for cluster ${doomedCluster.id}`);
      const liqBlock = BigInt(liqReceipt.blockNumber);
      advanceAll(simState, liqBlock);

      const validatorsRemoved = doomedCluster.validatorCount;
      for (const opId of doomedCluster.operatorIds) {
        const op = simState.operators.get(opId);
        if (op && op.ssvValidatorCount >= validatorsRemoved) op.ssvValidatorCount -= validatorsRemoved;
      }
      if (simState.network.totalSSVValidators >= validatorsRemoved) {
        simState.network.totalSSVValidators -= validatorsRemoved;
      }
      doomedCluster.ssvBalance = 0n;
      doomedCluster.active = false;
      const liqParsed = parseClusterFromEvent(newNetwork, liqReceipt, Events.CLUSTER_LIQUIDATED);
      doomedCluster.lastStruct = parsedToStruct(liqParsed);
    }
    console.log(`  [setup] phase 4.0: self-liquidated ${doomedClusters.length} SSV clusters`);
  }

  // ── Phase 4.1: First stake (MUST happen before any migrate/register) ──────
  // Set up oracle signers and have the oracle staker stake SSV immediately after upgrade.
  // This ensures accEthPerShare starts accumulating before any validator activity.
  const oracleSigners = [allSigners[_SL_ORC_SIG_START], allSigners[_SL_ORC_SIG_START + 1], allSigners[_SL_ORC_SIG_START + 2]];
  const oracleStaker  = allSigners[ORACLE_STAKER_INDEX];
  await setupOracles(newNetwork.connect(deployer), ssvToken, oracleStaker, oracleSigners);
  const postOracleBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, postOracleBlock);
  // Record oracle staker in simState
  const oracleStakerRec: StakerRecord = {
    address:        oracleStaker.address,
    cssvBalance:    ORACLE_STAKER_STAKE,
    pendingUnstake: [],
    ethClaimed:     0n,
    totalEthAmount: 0n,
    userIndex:      0n,
  };
  simState.stakers.set(oracleStaker.address.toLowerCase(), oracleStakerRec);

  // Override network fee and minimum operator fee with randomised values.
  // The upgrade sets network fee to NETWORK_FEE_ETH (3_000_000_000); we override to TARGET ±7%.
  // We also lower minimumOperatorEthFee so post-upgrade operators can register below the original min.
  const networkFeeWei = randFee(rng, TARGET_NETWORK_FEE_ETH, FEE_DEVIATION_BPS);
  await (await newNetwork.connect(deployer).updateMinimumOperatorEthFee(STRESS_MIN_OPERATOR_ETH_FEE)).wait();
  await (await newNetwork.connect(deployer).updateNetworkFee(networkFeeWei)).wait();
  const feeOverrideBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, feeOverrideBlock);
  simState.network.feeWei = networkFeeWei;

  // Reduce declare/execute fee periods to STRESS_FEE_PERIOD_SECS so the random
  // declareOperatorFee + executeOperatorFee cycle completes in ~500 blocks (not 7 days).
  await (await newNetwork.connect(deployer).updateDeclareOperatorFeePeriod(STRESS_FEE_PERIOD_SECS)).wait();
  await (await newNetwork.connect(deployer).updateExecuteOperatorFeePeriod(STRESS_FEE_PERIOD_SECS)).wait();
  // Reduce unstake cooldown similarly.
  await (await newNetwork.connect(deployer).updateUnstakeCooldownDuration(500n)).wait();

  // SSV clusters remain active post-upgrade — they will be migrated dynamically
  // by actMigrateCluster during the simulation run. migrateClusterToETH handles
  // both active and liquidated SSV clusters.

  console.log(`  [setup] phase 5: registering ${STRESS_OPERATORS_POST_UPGRADE} post-upgrade ETH operators...`);
  // ── Phase 5: Register post-upgrade ETH operators ──────────────────────
  for (let i = 0; i < STRESS_OPERATORS_POST_UPGRADE; i++) {
    const owner = allSigners[_SL_POST_OPS_START + i];
    const opKey = makeOpKey(STRESS_OPERATORS_PRE_UPGRADE + i);
    const feeWei = randFee(rng, TARGET_OPERATOR_ETH_FEE, FEE_DEVIATION_BPS);
    const isPrivate = i % 5 === 0;

    const receipt = await (await newNetwork.connect(owner).registerOperator(opKey, feeWei, isPrivate)).wait();
    if (!receipt) continue;
    const opId = parseOperatorId(receipt, newNetwork);
    const block = BigInt(receipt.blockNumber);

    const rec: OperatorRecord = {
      id:               opId,
      owner:            owner.address,
      feeWei,
      block,
      balance:          0n,
      effectiveBalance: 0n,
      ssvFeeWei:        0n,
      ssvBlock:         block,
      ssvBalance:       0n,
      ssvValidatorCount: 0n,
      pendingFeeWei:               0n,
      pendingFeeBlock:             0n,
      pendingFeeApprovalBeginTime: 0n,
      pendingFeeApprovalEndTime:   0n,
      isRemoved:        false,
      isPrivate,
      whitelistedAddresses: new Set<string>(),
    };
    simState.operators.set(opId, rec);
  }

  console.log(`  [setup] phase 6: creating ${STRESS_ETH_CLUSTERS} ETH clusters...`);
  // ── Phase 6: Create ETH clusters ──────────────────────────────────────
  // Active (non-removed) operators only
  const ethAllOpIds = [...simState.operators.keys()]
    .filter(id => !simState.operators.get(id)!.isRemoved)
    .sort((a, b) => (a < b ? -1 : 1));
  // ETH cluster owners: dedicated setup slots + allow reuse of pre-upgrade accounts
  // potentialEthOwners = dedicated ETH slots + all pre-upgrade op owners + all SSV cluster owners
  const potentialEthOwners = [
    ...allSigners.slice(_SL_ETH_CLU_START, _SL_ETH_CLU_START + STRESS_ETH_CLUSTERS),
    ...allSigners.slice(_SL_PRE_OPS_START, _SL_PRE_OPS_START + STRESS_OPERATORS_PRE_UPGRADE),
    ...allSigners.slice(_SL_SSV_OWN_START, _SL_SSV_OWN_START + STRESS_SSV_OWNERS),
  ];

  // Whitelist potential ETH cluster owners for private operators
  for (const opId of ethAllOpIds) {
    const op = simState.operators.get(opId)!;
    if (op.isPrivate) {
      const ownerSigner = allSigners.find((s: any) => s.address.toLowerCase() === op.owner.toLowerCase());
      if (ownerSigner && potentialEthOwners.length > 0) {
        const addrs = potentialEthOwners.map((s: any) => s.address);
        await (await newNetwork.connect(ownerSigner).setOperatorsWhitelists([opId], addrs)).wait();
        for (const addr of addrs) op.whitelistedAddresses.add(addr.toLowerCase());
      }
    }
  }

  // Phase 6 re-whitelists everyone, including any owner removed in Phase 3.65.
  // Re-apply the removal so the whitelist-revoked cluster test remains valid.
  if (whitelistRemovedClusterId) {
    const wlCluster = simState.clusters.get(whitelistRemovedClusterId);
    if (wlCluster) {
      for (const opId of wlCluster.operatorIds) {
        const op = simState.operators.get(opId);
        if (op && op.isPrivate && !op.isRemoved) {
          const opOwner = allSigners.find((s: any) => s.address.toLowerCase() === op.owner.toLowerCase());
          if (opOwner && op.whitelistedAddresses.has(wlCluster.owner.toLowerCase())) {
            await (await newNetwork.connect(opOwner).removeOperatorsWhitelists(
              [opId], [wlCluster.owner],
            )).wait();
            op.whitelistedAddresses.delete(wlCluster.owner.toLowerCase());
          }
        }
      }
    }
  }

  for (let i = 0; i < STRESS_ETH_CLUSTERS; i++) {
    if (i % 20 === 0) process.stdout.write(`  [setup] phase 6: ETH cluster ${i}/${STRESS_ETH_CLUSTERS}...\r`);
    const owner = potentialEthOwners[i % potentialEthOwners.length];

    // Only use sizes achievable without wrapping (wrapping causes duplicates → invalid length)
    const achievableSizes = VALID_OP_SET_SIZES.filter(s => s <= ethAllOpIds.length);
    if (achievableSizes.length === 0) continue;
    const opSetSize = achievableSizes[i % achievableSizes.length];
    const startIdx = (i * 3) % (ethAllOpIds.length - opSetSize + 1);
    const opSet = ethAllOpIds.slice(startIdx, startIdx + opSetSize);
    if (opSet.length !== opSetSize) continue;

    const nValidators = 1 + (i % 3);
    const keys: string[] = [];
    for (let v = 0; v < nValidators; v++) {
      keys.push(makeValKey(simState.nextValidatorSeed++));
    }

    const preTxBlock = BigInt(await provider.getBlockNumber());
    advanceAll(simState, preTxBlock);

    let tx: any;
    if (keys.length === 1) {
      tx = await newNetwork.connect(owner).registerValidator(
        keys[0], opSet, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_CLUSTER_DEPOSIT },
      );
    } else {
      const shares = keys.map(() => DEFAULT_SHARES);
      tx = await newNetwork.connect(owner).bulkRegisterValidator(
        keys, opSet, shares, EMPTY_CLUSTER, { value: DEFAULT_CLUSTER_DEPOSIT },
      );
    }
    const receipt = await tx.wait();
    const txBlock = BigInt(receipt.blockNumber);
    const parsed = parseClusterFromEvent(newNetwork, receipt, Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(owner.address, opSet);

    advanceAll(simState, txBlock);

    // ETH burnRate = sum(opFeeWei) + networkFeeWei
    // For SSV pre-upgrade operators in ETH clusters: use feeWei = DEFAULT_OPERATOR_ETH_FEE
    let burnRate = simState.network.feeWei;
    for (const opId of opSet) burnRate += simState.operators.get(opId)!.feeWei;

    const clusterEB = BigInt(nValidators) * DEFAULT_EB;
    const clusterRec: ClusterRecord = {
      id:               clusterId,
      owner:            owner.address,
      operatorIds:      [...opSet],
      version:          VERSION_ETH,
      block:            txBlock,
      balance:          parsed.balance,
      burnRate,
      effectiveBalance: clusterEB,
      ssvBlock:         0n,
      ssvBalance:       0n,
      ssvBurnRate:      0n,
      createdBlock:     txBlock,
      validatorCount:   parsed.validatorCount,
      active:           parsed.active,
      canRegister:      true,
      lastOracleEB:     0n,
      validators:       new Set(keys),
      lastStruct:       parsedToStruct(parsed),
    };
    simState.clusters.set(clusterId, clusterRec);

    for (const opId of opSet) {
      simState.operators.get(opId)!.effectiveBalance += clusterEB;
    }
    simState.network.totalEffectiveBalance += clusterEB;
  }

  console.log('  [setup] phase 4.5: seeding SAC clusters...');
  // ── Phase 4.5: Seed 3 collateral-liquidatable ETH clusters ───────────────
  // We want clusters whose balance drops below minimumLiquidationCollateral (collateral floor)
  // so they become "collateral liquidatable" during the main loop.
  //
  // Strategy: temporarily lower minimumBlocksBeforeLiquidation to 100 so the block-based
  // threshold (100 × burnRate ≈ 1.07e12) falls well below the collateral floor (1e15).
  // This lets us register at ~1.2× collateral floor and drain in ~18k blocks instead of ~164k.
  // After drain we restore the original liquidation threshold.
  {
    const publicOpIds = ethAllOpIds.filter(id => !simState.operators.get(id)!.isPrivate);
    const sacOpSet = publicOpIds.slice(0, 4);
    console.log(`  [setup] phase 4.5: sacOpSet = [${sacOpSet.join(', ')}], publicOpIds.length = ${publicOpIds.length}`);
    if (sacOpSet.length >= 4) {
      // Compute burn rate for this op set (unpacked wei/block per validator)
      let sacBurnRate = simState.network.feeWei;
      for (const opId of sacOpSet) sacBurnRate += simState.operators.get(opId)!.feeWei;

      // Temporarily lower block threshold to the DAO minimum (21_480) so the block-based
      // threshold falls well below the collateral floor, making collateral the binding constraint.
      // This reduces drain from ~164k blocks to ~18k blocks.
      const SAC_TEMP_MIN_BLOCKS = 21_480n;
      const origMinBlocks = simState.minimumBlocksBeforeLiquidation;
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriod(SAC_TEMP_MIN_BLOCKS)).wait();
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriodSSV(SAC_TEMP_MIN_BLOCKS)).wait();
      simState.minimumBlocksBeforeLiquidation = SAC_TEMP_MIN_BLOCKS;

      // With threshold=100, blockThreshold=100*burnRate<<collateral, so sacThreshold=collateral.
      const sacThreshold = simState.minimumLiquidationCollateral;
      const sacDeposit = sacThreshold + sacThreshold / 5n; // 20% above collateral floor

      for (let i = 0; i < STRESS_SAC_CLUSTERS; i++) {
        const sacOwner = allSigners[_SL_SAC_START + i];
        const sacValKey = makeValKey(simState.nextValidatorSeed++);
        console.log(`  [setup] phase 4.5: SAC cluster ${i}, owner=${sacOwner.address}, deposit=${sacDeposit}`);

        const preSacBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, preSacBlock);

        const sacTx = await newNetwork.connect(sacOwner).registerValidator(
          sacValKey, sacOpSet, DEFAULT_SHARES, EMPTY_CLUSTER, { value: sacDeposit },
        );
        const sacReceipt = await sacTx.wait();
        if (!sacReceipt) throw new Error('sacTx.wait() returned null');
        const sacTxBlock = BigInt(sacReceipt.blockNumber);
        const sacParsed = parseClusterFromEvent(newNetwork, sacReceipt, Events.VALIDATOR_ADDED);
        const sacClusterId = computeClusterId(sacOwner.address, sacOpSet);

        advanceAll(simState, sacTxBlock);

        const sacRec: ClusterRecord = {
          id:               sacClusterId,
          owner:            sacOwner.address,
          operatorIds:      [...sacOpSet],
          version:          VERSION_ETH,
          block:            sacTxBlock,
          balance:          sacParsed.balance,
          burnRate:         sacBurnRate,
          effectiveBalance: DEFAULT_EB,
          ssvBlock:         0n,
          ssvBalance:       0n,
          ssvBurnRate:      0n,
          createdBlock:     sacTxBlock,
          validatorCount:   1n,
          active:           true,
          canRegister:      true,
          lastOracleEB:     0n,
          validators:       new Set([sacValKey]),
          lastStruct:       parsedToStruct(sacParsed),
        };
        simState.clusters.set(sacClusterId, sacRec);

        for (const opId of sacOpSet) {
          simState.operators.get(opId)!.effectiveBalance += DEFAULT_EB;
        }
        simState.network.totalEffectiveBalance += DEFAULT_EB;
      }

      // Mine enough blocks to drain all 3 clusters below the collateral floor.
      // +5n buffer covers the ~3 blocks elapsed during registration plus rounding.
      const drainBlocks = (sacDeposit - simState.minimumLiquidationCollateral) / sacBurnRate + 5n;
      console.log(`  [setup] phase 4.5: mining ${drainBlocks} drain blocks...`);
      await provider.send('hardhat_mine', ['0x' + drainBlocks.toString(16)]);
      const postDrainBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, postDrainBlock);

      // Restore original liquidation threshold — SAC clusters are now below collateral floor
      // and will remain liquidatable under the restored (larger) block-based threshold too.
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriod(origMinBlocks)).wait();
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriodSSV(origMinBlocks)).wait();
      simState.minimumBlocksBeforeLiquidation = origMinBlocks;
      const postRestoreBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, postRestoreBlock);
    }
  }

  // ── Phase 7: Seed the contract with SEED_ETH and SEED_SSV ────────────────
  // These are constant offsets in the conservation invariant:
  //   contractETH = SEED_ETH + Σ(ETH cluster balances) + Σ(op ETH earnings) + ethNetworkFees
  //   contractSSV = SEED_SSV + Σ(SSV cluster balances) + Σ(op SSV earnings) + ssvNetworkFees
  const networkContractAddr = await newNetwork.getAddress();
  const existingETH = BigInt(await provider.getBalance(networkContractAddr));
  await provider.send('hardhat_setBalance', [
    networkContractAddr,
    '0x' + (existingETH + SEED_ETH).toString(16),
  ]);
  await (await ssvToken.mint(deployer.address, SEED_SSV)).wait();
  await (await ssvToken.connect(deployer).transfer(networkContractAddr, SEED_SSV)).wait();
  const postSeedBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, postSeedBlock);

  return {
    network:    newNetwork,
    views:      newViews,
    ssvToken,
    cssvToken,
    provider,
    deployer,
    liquidator,
    allSigners,
    simState,
    connection,
    oracleSigners,
    preUpgradeFeeDeclaration,
    whitelistRemovedClusterId,
    emptySSVClusterForMigrateTest,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeOpKey(seed: number): string {
  return `0x${(seed + 5000).toString(16).padStart(96, '0')}`;
}

export function makeValKey(seed: number): string {
  return `0x${seed.toString(16).padStart(96, '0')}`;
}

export function parseOperatorId(receipt: any, network: any): bigint {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === 'OperatorAdded') return BigInt(parsed.args[0]);
    } catch { /* skip */ }
  }
  throw new Error('OperatorAdded event not found in receipt');
}

export function parsedToStruct(parsed: any): ClusterStruct {
  return {
    validatorCount:  BigInt(parsed.validatorCount),
    networkFeeIndex: BigInt(parsed.networkFeeIndex),
    index:           BigInt(parsed.index),
    active:          Boolean(parsed.active),
    balance:         BigInt(parsed.balance),
  };
}

export function toClusterStruct(cluster: ClusterRecord): ClusterStruct {
  return { ...cluster.lastStruct };
}
