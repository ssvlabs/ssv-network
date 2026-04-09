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
  DEFAULT_STAKE_AMOUNT,
} from './constants.ts';
import { DEFAULT_EB } from './state.ts';
import type { SimState, OperatorRecord, ClusterRecord, ClusterStruct, NetworkRecord, StakerRecord } from './state.ts';
import { advanceAll } from './state.ts';
import type { RNG } from './random.ts';
import { randFee } from './random.ts';


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

export async function setupStressTest(
  connection: NetworkConnection<'generic'>,
  networkHelpers: any,
  rng: RNG,
): Promise<StressSetup> {
  const provider = connection.ethers.provider as any;
  const defaultSigners = await connection.ethers.getSigners();

  const allSigners: any[] = [];
  for (let i = 0; i < STRESS_TOTAL_SIGNERS; i++) {
    allSigners.push(await getSigner(connection, defaultSigners, i));
  }

  const deployer   = allSigners[0];
  const liquidator = allSigners[1];

  async function stressPreUpgradeFixture() {
    return ssvNetworkFullPreUpgradeFixture(connection);
  }
  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await networkHelpers.loadFixture(stressPreUpgradeFixture);

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
    nextFreshWalletIndex: 0,
    totalClampingExcess: 0n,
    totalStakingDust: 0n,
  };

  process.stdout.write(`  [setup] phase 2: registering ${STRESS_OPERATORS_PRE_UPGRADE} operators...\r`);
  for (let i = 0; i < STRESS_OPERATORS_PRE_UPGRADE; i++) {
    const owner = allSigners[_SL_PRE_OPS_START + i];
    const opKey = makeOpKey(i);
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

  process.stdout.write(`  [setup] phase 3: creating ${STRESS_SSV_CLUSTERS} SSV clusters...\r`);
  const allOpIds = [...simState.operators.keys()].sort((a, b) => (a < b ? -1 : 1));

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

    const achievableSsvSizes = VALID_OP_SET_SIZES.filter(s => s <= allOpIds.length);
    if (achievableSsvSizes.length === 0) continue;
    const ssvOpSetSize = achievableSsvSizes[i % achievableSsvSizes.length];
    const startIdx = (i * 3) % (allOpIds.length - ssvOpSetSize + 1);
    const opSet = allOpIds.slice(startIdx, startIdx + ssvOpSetSize);
    if (opSet.length !== ssvOpSetSize) continue;

    const nValidators = 1 + (i % 5); // 1, 2, 3, 4, 5 repeating

    let ssvBurnRate = simState.network.feeSSVWei;
    for (const opId of opSet) ssvBurnRate += simState.operators.get(opId)!.ssvFeeWei;

    const clusterId = computeClusterId(owner.address, opSet);
    const existingCluster = simState.clusters.get(clusterId);

    let lastTxBlock: bigint;
    let lastParsed: any;

    if (!existingCluster) {
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
      for (const opId of opSet) simState.operators.get(opId)!.ssvValidatorCount += 1n;
      simState.network.totalSSVValidators += 1n;

      const valKeys = new Set<string>([firstValKey]);

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
  {
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

  process.stdout.write(`  [setup] phase 3.6: creating ${STRESS_SSV_CLUSTERS_LIQUIDATED} SSV clusters for post-upgrade self-liquidation...\r`);
  let preUpgradeFeeDeclaration: PreUpgradeFeeDeclaration | undefined;
  let whitelistRemovedClusterId: string | undefined;
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

    {
      const candidateClusters = [...simState.clusters.values()].filter(c => {
        if (c.version !== VERSION_SSV || !c.active) return false;
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

        privateOp.whitelistedAddresses.delete(targetCluster.owner.toLowerCase());
        whitelistRemovedClusterId = targetCluster.id;
        process.stdout.write(`  [setup] phase 3.65: removed ${targetCluster.owner.slice(0, 10)} from op #${privateOpId} whitelist (cluster ${targetCluster.id.slice(0, 14)})\n`);
      }
    }

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
        const approvalBeginTime = BigInt(declareBlock.timestamp) + STRESS_FEE_PERIOD_SECS;

        await provider.send('hardhat_mine', ['0x' + (STRESS_FEE_PERIOD_SECS + 1n).toString(16)]);
        const postDeclareBlock = BigInt(await provider.getBlockNumber());
        advanceAll(simState, postDeclareBlock);

        preUpgradeFeeDeclaration = { opId: preUpgradeFeeOpId, ownerAddress: preUpgradeFeeOwner.address, declaredFee, approvalBeginTime };
      }
    }
  }

  process.stdout.write(`  [setup] phase 3.8: creating ${STRESS_SSV_CLUSTERS_SHORTRUN} short-runway SSV clusters...\r`);
  if (doomedOpSet.length >= 4) {
    const srBlockThreshold = simState.minimumBlocksBeforeLiquidation * doomedSsvBurnRate;
    const srCollateral = simState.minimumLiquidationCollateralSSV;
    const srThreshold = srBlockThreshold > srCollateral ? srBlockThreshold : srCollateral;
    const srDeposit = srThreshold + 2000n * doomedSsvBurnRate;

    for (let i = 0; i < STRESS_SSV_CLUSTERS_SHORTRUN; i++) {
      const srOwner = allSigners[_SL_SSV_OWN_START + (i % STRESS_SSV_OWNERS)];
      process.stdout.write(`  [setup] phase 3.8: shortrun cluster ${i}/${STRESS_SSV_CLUSTERS_SHORTRUN}...\r`);

      await (await ssvToken.mint(srOwner.address, srDeposit)).wait();
      await (await ssvToken.connect(srOwner).approve(await legacyNetwork.getAddress(), srDeposit)).wait();

      const preBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, preBlock);

      const srValKey = makeValKey(simState.nextValidatorSeed++);
      const srClusterId = computeClusterId(srOwner.address, doomedOpSet);
      const srExisting = simState.clusters.get(srClusterId);
      if (!srExisting) {
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

  let emptySSVClusterForMigrateTest: ClusterRecord | undefined;
  {
    process.stdout.write('  [setup] phase 3.9: creating empty SSV cluster for post-upgrade migrate test...\r');
    const nonPrivateNonRemovedOps = allOpIds.filter(id => {
      const op = simState.operators.get(id);
      return op && !op.isPrivate && !op.isRemoved;
    });
    if (nonPrivateNonRemovedOps.length >= 4) {
      const testOpSet = nonPrivateNonRemovedOps.slice(0, 4);
      const testOwner = await getSigner(connection, allSigners, STRESS_TOTAL_SIGNERS + 100);
      allSigners.push(testOwner);

      const ssvBurnRate = testOpSet.reduce(
        (sum, id) => sum + simState.operators.get(id)!.ssvFeeWei, simState.network.feeSSVWei,
      );
      const deposit = DEFAULT_SSV_CLUSTER_DEPOSIT;
      const clusterId = computeClusterId(testOwner.address, testOpSet);

      await (await ssvToken.mint(testOwner.address, deposit)).wait();
      await (await ssvToken.connect(testOwner).approve(await legacyNetwork.getAddress(), deposit)).wait();

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
  const { newNetwork, newViews, cssv: cssvToken } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

  const upgradeBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, upgradeBlock);
  simState.network.block = upgradeBlock;

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

  const oracleSigners = [allSigners[_SL_ORC_SIG_START], allSigners[_SL_ORC_SIG_START + 1], allSigners[_SL_ORC_SIG_START + 2]];
  const oracleStaker  = allSigners[ORACLE_STAKER_INDEX];
  await setupOracles(newNetwork.connect(deployer), ssvToken, oracleStaker, oracleSigners);
  const postOracleBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, postOracleBlock);
  const oracleStakerRec: StakerRecord = {
    address:        oracleStaker.address,
    cssvBalance:    DEFAULT_STAKE_AMOUNT,
    pendingUnstake: [],
    ethClaimed:     0n,
    totalEthAmount: 0n,
    userIndex:      0n,
  };
  simState.stakers.set(oracleStaker.address.toLowerCase(), oracleStakerRec);

  const networkFeeWei = randFee(rng, TARGET_NETWORK_FEE_ETH, FEE_DEVIATION_BPS);
  await (await newNetwork.connect(deployer).updateMinimumOperatorEthFee(STRESS_MIN_OPERATOR_ETH_FEE)).wait();
  await (await newNetwork.connect(deployer).updateNetworkFee(networkFeeWei)).wait();
  const feeOverrideBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, feeOverrideBlock);
  simState.network.feeWei = networkFeeWei;

  await (await newNetwork.connect(deployer).updateDeclareOperatorFeePeriod(STRESS_FEE_PERIOD_SECS)).wait();
  await (await newNetwork.connect(deployer).updateExecuteOperatorFeePeriod(STRESS_FEE_PERIOD_SECS)).wait();
  await (await newNetwork.connect(deployer).updateUnstakeCooldownDuration(500n)).wait();

  console.log(`  [setup] phase 5: registering ${STRESS_OPERATORS_POST_UPGRADE} post-upgrade ETH operators...`);
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
  const ethAllOpIds = [...simState.operators.keys()]
    .filter(id => !simState.operators.get(id)!.isRemoved)
    .sort((a, b) => (a < b ? -1 : 1));
  const potentialEthOwners = [
    ...allSigners.slice(_SL_ETH_CLU_START, _SL_ETH_CLU_START + STRESS_ETH_CLUSTERS),
    ...allSigners.slice(_SL_PRE_OPS_START, _SL_PRE_OPS_START + STRESS_OPERATORS_PRE_UPGRADE),
    ...allSigners.slice(_SL_SSV_OWN_START, _SL_SSV_OWN_START + STRESS_SSV_OWNERS),
  ];

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
  {
    const publicOpIds = ethAllOpIds.filter(id => !simState.operators.get(id)!.isPrivate);
    const sacOpSet = publicOpIds.slice(0, 4);
    console.log(`  [setup] phase 4.5: sacOpSet = [${sacOpSet.join(', ')}], publicOpIds.length = ${publicOpIds.length}`);
    if (sacOpSet.length >= 4) {
      let sacBurnRate = simState.network.feeWei;
      for (const opId of sacOpSet) sacBurnRate += simState.operators.get(opId)!.feeWei;
      const SAC_TEMP_MIN_BLOCKS = 21_480n;
      const origMinBlocks = simState.minimumBlocksBeforeLiquidation;
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriod(SAC_TEMP_MIN_BLOCKS)).wait();
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriodSSV(SAC_TEMP_MIN_BLOCKS)).wait();
      simState.minimumBlocksBeforeLiquidation = SAC_TEMP_MIN_BLOCKS;

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

      const drainBlocks = (sacDeposit - simState.minimumLiquidationCollateral) / sacBurnRate + 5n;
      console.log(`  [setup] phase 4.5: mining ${drainBlocks} drain blocks...`);
      await provider.send('hardhat_mine', ['0x' + drainBlocks.toString(16)]);
      const postDrainBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, postDrainBlock);

      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriod(origMinBlocks)).wait();
      await (await newNetwork.connect(deployer).updateLiquidationThresholdPeriodSSV(origMinBlocks)).wait();
      simState.minimumBlocksBeforeLiquidation = origMinBlocks;
      const postRestoreBlock = BigInt(await provider.getBlockNumber());
      advanceAll(simState, postRestoreBlock);
    }
  }

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
