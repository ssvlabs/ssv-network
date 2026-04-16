import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { makeValKey, parseOperatorId, parsedToStruct, toClusterStruct, getSigner } from './setup.ts';
import type { ClusterRecord, OperatorRecord, SimState, StakerRecord } from './state.ts';
import { advanceAll, onSyncFees, onSettleUser, isLiquidatable, liquidationThreshold, burnPerBlock, DEFAULT_EB } from './state.ts';
import { parseClusterFromEvent, parseLastClusterFromEvent } from '../helpers/cluster.ts';
import { computeClusterId, generateMerkleForClusterEB, commitEBRoot } from '../helpers/oracle.ts';
import { Events } from '../common/events.ts';
import {
  VERSION_ETH,
  VERSION_SSV,
  ETH_DEDUCTED_DIGITS,
  VALID_OP_SET_SIZES,
  TARGET_OPERATOR_ETH_FEE,
  TARGET_NETWORK_FEE_ETH,
  FEE_DEVIATION_BPS,
  STRESS_MIN_OPERATOR_ETH_FEE,
  STRESS_FEE_PERIOD_SECS,
  MIN_EB_PER_VALIDATOR,
  MAX_EB_PER_VALIDATOR,
  DEFAULT_STAKE_AMOUNT,
  MINIMAL_STAKING_AMOUNT,
  _SL_EOA_START,
  STRESS_STAKERS_EOA,
  STRESS_COOLDOWN_SECS,
  _SL_CON_START,
  STRESS_STAKERS_CONTRACT,
  STRESS_TOTAL_SIGNERS,
  DEFAULT_OPERATOR_ETH_FEE,
} from './constants.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from '../common/constants.ts';
import type { RNG } from './random.ts';
import { pickFrom, randFee } from './random.ts';
import type { RunReport } from './report.ts';

export type ActionFn = (
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
) => Promise<boolean>;

const BLOCKS_PER_DAY = 7160n;

function ceilPrecision(amount: bigint): bigint {
  if (amount === 0n) return 0n;
  return ((amount + ETH_DEDUCTED_DIGITS - 1n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

function runwayDeposit(
  bpb: bigint,
  targetDays: bigint,
  simState: SimState,
  floorAmount = 0n,
): bigint {
  const raw = bpb > 0n
    ? targetDays * BLOCKS_PER_DAY * bpb
    : simState.minimumLiquidationCollateral * 2n;
  const amount = ceilPrecision(raw);
  const floor = ceilPrecision(floorAmount);
  return amount < floor ? floor : amount;
}

function liquidationFloor(bpb: bigint, simState: SimState): bigint {
  const blockThreshold = simState.minimumBlocksBeforeLiquidation * bpb;
  const threshold = blockThreshold > simState.minimumLiquidationCollateral
    ? blockThreshold : simState.minimumLiquidationCollateral;
  return threshold + threshold / 5n; // 20% buffer
}

export function getOwnerSigner(setup: StressSetup, ownerAddress: string): any | undefined {
  return setup.allSigners.find((s: any) =>
    s.address.toLowerCase() === ownerAddress.toLowerCase(),
  );
}

function getActiveClusters(setup: StressSetup): ClusterRecord[] {
  return [...setup.simState.clusters.values()].filter(c => c.active);
}

function getInactiveClusters(setup: StressSetup): ClusterRecord[] {
  return [...setup.simState.clusters.values()].filter(c => !c.active && c.validatorCount > 0n);
}

function getActiveOperators(setup: StressSetup): OperatorRecord[] {
  return [...setup.simState.operators.values()].filter(op => !op.isRemoved);
}

export function gas(receipt: any): bigint {
  return BigInt(receipt.gasUsed ?? 0n);
}

function dumpDiag(report: RunReport, actionName: string, err: any, clusterIds: string[], opIds: bigint[]): void {
  report.printTimeline(clusterIds, opIds);
  console.error(`\n[TX FAIL] ${actionName} — ${String((err as any)?.message ?? err)}`);
}

function depositShortfall(cluster: ClusterRecord, addedValidators: bigint, simState: SimState): bigint {
  const newEB = cluster.effectiveBalance + addedValidators * DEFAULT_EB;
  const newBpb = cluster.burnRate * newEB / DEFAULT_EB;
  const floor = liquidationFloor(newBpb, simState);
  return floor > cluster.balance ? floor - cluster.balance : 0n;
}

export async function actRegisterOperator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;

  const usedOwners = new Set([...simState.operators.values()].map(op => op.owner.toLowerCase()));
  const available = setup.allSigners.filter((s: any) => !usedOwners.has(s.address.toLowerCase()));
  const ownerSigner = pickFrom(rng, available);
  if (!ownerSigner) return false;

  const opKey = `0x${simState.operators.size.toString(16).padStart(96, '0')}`;
  const feeWei = randFee(rng, TARGET_OPERATOR_ETH_FEE, FEE_DEVIATION_BPS);

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).registerOperator(opKey, feeWei, false);
    receipt = await tx.wait();
  } catch (err) {
    console.error(`\n[TX FAIL] registerOperator — ${String((err as any)?.message ?? err)}`);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const opId = parseOperatorId(receipt, network);
  simState.operators.set(opId, {
    id:               opId,
    owner:            ownerSigner.address,
    feeWei,
    block:            txBlock,
    balance:          0n,
    effectiveBalance: 0n,
    ssvFeeWei:        0n,
    ssvBlock:         txBlock,
    ssvBalance:       0n,
    ssvValidatorCount: 0n,
    pendingFeeWei:               0n,
    pendingFeeBlock:             0n,
    pendingFeeApprovalBeginTime: 0n,
    pendingFeeApprovalEndTime:   0n,
    useDefaultEthFee: false,        // registered with custom fee
    isRemoved:        false,
    isPrivate:        false,
    whitelistedAddresses: new Set(),
  });

  report.operatorsPostMigrationDynamic++;
  report.record('registerOperator', gas(receipt), txBlock);
  report.recordOperatorTx(ownerSigner.address, opId, txBlock, 'registerOperator',
    { feeWei: feeWei.toString() }, 'OperatorAdded');
  return true;
}

export async function actRegisterValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;
  const activeClusters = getActiveClusters(setup).filter(c =>
    c.version === VERSION_ETH && c.canRegister,
  );

  const createNew = activeClusters.length === 0 || rng.nextInt(2n) === 0n;

  if (createNew) {
    const ownerSigner = pickFrom(rng, setup.allSigners.slice(2));
    if (!ownerSigner) return false;

    const eligibleOpIds = [...simState.operators.keys()]
      .filter(id => {
        const op = simState.operators.get(id);
        if (!op || op.isRemoved) return false;
        if (op.isPrivate && !op.whitelistedAddresses.has(ownerSigner.address.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (a < b ? -1 : 1));
    if (eligibleOpIds.length < 4) return false;

    const achievableSizes = VALID_OP_SET_SIZES.filter(s => s <= eligibleOpIds.length);
    if (achievableSizes.length === 0) return false;
    const opSetSize = achievableSizes[Number(rng.nextInt(BigInt(achievableSizes.length)))];
    const startIdx = Number(rng.nextInt(BigInt(eligibleOpIds.length - opSetSize + 1)));
    const opSet = eligibleOpIds.slice(startIdx, startIdx + opSetSize);
    if (opSet.length !== opSetSize) return false;

    const valKey = makeValKey(simState.nextValidatorSeed++);
    const existingCluster = simState.clusters.get(computeClusterId(ownerSigner.address, opSet));
    if (existingCluster && existingCluster.version === VERSION_SSV) return false;
    const clusterStruct = existingCluster ? toClusterStruct(existingCluster) : EMPTY_CLUSTER;

    let deposit: bigint;
    if (existingCluster) {
      const newEB = existingCluster.effectiveBalance + DEFAULT_EB;
      const newBpb = existingCluster.burnRate * newEB / DEFAULT_EB;
      const targetDays = 35n + rng.nextInt(86n); // 35–120 days
      const targetBalance = ceilPrecision(targetDays * BLOCKS_PER_DAY * newBpb);
      const minSafe = depositShortfall(existingCluster, 1n, simState);
      const needed = targetBalance > existingCluster.balance ? targetBalance - existingCluster.balance : 0n;
      deposit = ceilPrecision(needed > minSafe ? needed : minSafe);
    } else {
      let newBurnRate = simState.network.feeWei;
      for (const opId of opSet) newBurnRate += simState.operators.get(opId)!.feeWei;
      const newBpb = newBurnRate; // 1 validator = 32 ETH → burnRate * 32 / 32 = burnRate
      const targetDays = 60n + rng.nextInt(121n); // 60–180 days
      deposit = runwayDeposit(newBpb, targetDays, simState, liquidationFloor(newBpb, simState));
    }

    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).registerValidator(
        valKey, opSet, DEFAULT_SHARES, clusterStruct,
        { value: deposit },
      );
      receipt = await tx.wait();
    } catch (err) {
      dumpDiag(report, 'registerValidator (new cluster)', err, existingCluster ? [existingCluster.id] : [], opSet);
      throw err;
    }
    const txBlock = BigInt(receipt.blockNumber);

    advanceAll(simState, txBlock);

    const parsed = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(ownerSigner.address, opSet);

    if (existingCluster) {
      const expectedBalance = existingCluster.balance + deposit;
      assert.equal(BigInt(parsed.balance), expectedBalance, `registerValidator(new→existing): cluster balance`);
      assert.equal(BigInt(parsed.validatorCount), existingCluster.validatorCount + 1n, `registerValidator(new→existing): validatorCount`);
      existingCluster.validatorCount += 1n;
      existingCluster.effectiveBalance += DEFAULT_EB;
      existingCluster.balance = expectedBalance;
      existingCluster.lastStruct = parsedToStruct(parsed);
      existingCluster.validators.add(valKey);
    } else {
      assert.equal(BigInt(parsed.balance), deposit, `registerValidator(new cluster): balance`);
      assert.equal(BigInt(parsed.validatorCount), 1n, `registerValidator(new cluster): validatorCount`);

      let burnRate = simState.network.feeWei;
      for (const opId of opSet) burnRate += simState.operators.get(opId)!.feeWei;

      const clusterRec: ClusterRecord = {
        id:               clusterId,
        owner:            ownerSigner.address,
        operatorIds:      [...opSet],
        version:          VERSION_ETH,
        block:            txBlock,
        balance:          deposit,
        burnRate,
        effectiveBalance: DEFAULT_EB,
        ssvBlock:         0n,
        ssvBalance:       0n,
        ssvBurnRate:      0n,
        createdBlock:     txBlock,
        validatorCount:   1n,
        active:           true,
        canRegister:      true,
        lastOracleEB:     0n,
        validators:       new Set([valKey]),
        lastStruct:       parsedToStruct(parsed),
      };
      simState.clusters.set(clusterId, clusterRec);
      report.ethClustersDynamic++;
    }

    for (const opId of opSet) {
      const op = simState.operators.get(opId)!;
      op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
      op.effectiveBalance += DEFAULT_EB;
    }
    simState.network.totalEffectiveBalance += DEFAULT_EB;

    report.record('registerValidator', gas(receipt), txBlock);
    report.recordClusterTx(clusterId, ownerSigner.address, opSet, txBlock,
      'registerValidator', { validators: '1', eb: `+${DEFAULT_EB} ETH`, version: 'ETH' }, 'ValidatorAdded');
    return true;
  } else {
    const cluster = pickFrom(rng, activeClusters);
    if (!cluster) return false;

    const ownerSigner = getOwnerSigner(setup, cluster.owner);
    if (!ownerSigner) return false;

    const valKey = makeValKey(simState.nextValidatorSeed++);

    const newEB1 = cluster.effectiveBalance + DEFAULT_EB;
    const newBpb1 = cluster.burnRate * newEB1 / DEFAULT_EB;
    const targetDays1 = 35n + rng.nextInt(86n); // 35–120 days
    const targetBalance1 = ceilPrecision(targetDays1 * BLOCKS_PER_DAY * newBpb1);
    const minSafe1 = depositShortfall(cluster, 1n, simState);
    const needed1 = targetBalance1 > cluster.balance ? targetBalance1 - cluster.balance : 0n;
    const deposit1 = ceilPrecision(needed1 > minSafe1 ? needed1 : minSafe1);

    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).registerValidator(
        valKey, cluster.operatorIds, DEFAULT_SHARES, toClusterStruct(cluster), { value: deposit1 },
      );
      receipt = await tx.wait();
    } catch (err) {
      dumpDiag(report, 'registerValidator (add to cluster)', err, [cluster.id], cluster.operatorIds);
      throw err;
    }
    const txBlock = BigInt(receipt.blockNumber);

    advanceAll(simState, txBlock);

    const parsed = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    const expectedBalance2 = cluster.balance + deposit1;
    assert.equal(BigInt(parsed.balance), expectedBalance2, `registerValidator(add to cluster): balance`);
    assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount + 1n, `registerValidator(add to cluster): validatorCount`);
    cluster.validatorCount += 1n;
    cluster.effectiveBalance += DEFAULT_EB;
    cluster.balance = expectedBalance2;
    cluster.lastStruct = parsedToStruct(parsed);
    cluster.validators.add(valKey);

    for (const opId of cluster.operatorIds) {
      const op = simState.operators.get(opId)!;
      op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
      op.effectiveBalance += DEFAULT_EB;
    }
    simState.network.totalEffectiveBalance += DEFAULT_EB;

    report.record('registerValidator', gas(receipt), txBlock);
    report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
      'registerValidator', { validators: '1', eb: `+${DEFAULT_EB} ETH` }, 'ValidatorAdded');
    return true;
  }
}

export async function actRemoveValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const eligible = getActiveClusters(setup).filter(
    c => c.version === VERSION_ETH && c.validators.size >= 2,
  );
  const cluster = pickFrom(rng, eligible);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  const valKey = [...cluster.validators][0]; // remove first validator

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).removeValidator(
      valKey, cluster.operatorIds, toClusterStruct(cluster),
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'removeValidator (from cluster)', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.VALIDATOR_REMOVED);
  assert.equal(BigInt(parsed.balance), cluster.balance, `removeValidator: balance`);
  assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount - 1n, `removeValidator: validatorCount`);
  cluster.validatorCount -= 1n;
  cluster.effectiveBalance = cluster.effectiveBalance >= DEFAULT_EB ? cluster.effectiveBalance - DEFAULT_EB : 0n;
  cluster.lastStruct = parsedToStruct(parsed);
  cluster.validators.delete(valKey);

  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (!op) continue;
    op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
    if (op.effectiveBalance >= DEFAULT_EB) op.effectiveBalance -= DEFAULT_EB;
  }
  if (simState.network.totalEffectiveBalance >= DEFAULT_EB) {
    simState.network.totalEffectiveBalance -= DEFAULT_EB;
  }

  report.record('removeValidator', gas(receipt), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'removeValidator', { validators: '1', eb: `-${DEFAULT_EB} ETH` }, 'ValidatorRemoved');
  return true;
}

export async function actDeposit(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  const activeClusters = getActiveClusters(setup).filter(c => c.version === VERSION_ETH);
  const cluster = pickFrom(rng, activeClusters);
  if (!cluster) return false;

  const threshold = liquidationThreshold(cluster, simState);
  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  const bpb = burnPerBlock(cluster);
  const xDays = 35n + rng.nextInt(26n);           // 35–60 days (above ~30-day threshold)
  const yDays = xDays + 10n + rng.nextInt(41n);   // x+10 to x+50 extra days
  const targetDays = xDays + rng.nextInt(yDays - xDays + 1n);
  const targetBalance = bpb > 0n ? ceilPrecision(targetDays * BLOCKS_PER_DAY * bpb) : threshold * 2n;
  let amount: bigint;
  if (cluster.balance >= targetBalance) {
    const oneDayWei = ceilPrecision(BLOCKS_PER_DAY * bpb);
    if (oneDayWei === 0n) return false; // zero-bpb cluster, nothing meaningful to deposit
    amount = oneDayWei;
  } else {
    const minFloor = threshold > simState.minimumLiquidationCollateral
      ? threshold + threshold / 4n
      : simState.minimumLiquidationCollateral * 2n;
    amount = runwayDeposit(bpb, targetDays, simState, minFloor);
  }

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).deposit(
      cluster.owner, cluster.operatorIds, toClusterStruct(cluster), { value: amount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'depositToCluster', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_DEPOSITED);
  cluster.balance += amount;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('deposit', gas(receipt), txBlock);
  report.totalEthDepositedWei += amount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'deposit', { amount: (Number(amount) / 1e18).toFixed(6) + ' ETH' }, 'ClusterDeposited');
  return true;
}

export async function actWithdraw(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;

  const activeClusters = getActiveClusters(setup).filter(c => {
    if (c.version !== VERSION_ETH) return false;
    return c.balance > liquidationThreshold(c, simState);
  });
  const cluster = pickFrom(rng, activeClusters);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  const threshold = liquidationThreshold(cluster, simState);
  const bpbForBuffer = burnPerBlock(cluster);
  const feeBuffer = bpbForBuffer * 20n;
  const safeBalance = cluster.balance > feeBuffer ? cluster.balance - feeBuffer : 0n;
  const safeMax = safeBalance > threshold ? safeBalance - threshold : 0n;
  if (safeMax === 0n) return false;

  if (rng.nextInt(100n) < 7n) {
    const bpb = bpbForBuffer;
    if (bpb === 0n) {
    } else {
      const extraBlocks = 1n + rng.nextInt(10n);
      const leaveAmount = threshold + bpb * extraBlocks + 1n;
      if (safeBalance > leaveAmount) {
        const withdrawAmount = safeBalance - leaveAmount;

        let receipt: any;
        try {
          const tx = await network.connect(ownerSigner).withdraw(
            cluster.operatorIds, withdrawAmount, toClusterStruct(cluster),
          );
          receipt = await tx.wait();
        } catch (err) {
          dumpDiag(report, 'clusterWithdraw (drain→liquidate)', err, [cluster.id], cluster.operatorIds);
          throw err;
        }
        const txBlock = BigInt(receipt.blockNumber);
        advanceAll(simState, txBlock);
        const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_WITHDRAWN);
        const expectedWithdrawBalance = cluster.balance - withdrawAmount;
        assert.equal(BigInt(parsed.balance), expectedWithdrawBalance, `withdraw(drain): cluster balance`);
        cluster.balance = expectedWithdrawBalance;
        cluster.lastStruct = parsedToStruct(parsed);
        report.record('withdraw', gas(receipt), txBlock);
        report.totalEthWithdrawnByOwnersWei += withdrawAmount;
        report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
          'withdraw', { amount: (Number(withdrawAmount) / 1e18).toFixed(9) + ' ETH', note: 'drain→liquidate' }, 'ClusterWithdrawn');

        const drainBlocks = extraBlocks + 21n;
        await provider.send('hardhat_mine', ['0x' + drainBlocks.toString(16)]);
        await provider.send('evm_increaseTime', [Number(drainBlocks) * 12]);
        await liquidateClusterDirectly(cluster, setup, report);
        return true;
      }
    }
  }

  const withdrawBpb = bpbForBuffer;
  const remainingDays = 10n + rng.nextInt(51n); // 10–60 days remaining
  const targetRemaining = withdrawBpb > 0n
    ? ceilPrecision(remainingDays * BLOCKS_PER_DAY * withdrawBpb)
    : threshold;
  const withdrawTarget = targetRemaining < threshold ? threshold : targetRemaining;
  const withdrawAmount = safeBalance > withdrawTarget ? safeBalance - withdrawTarget : 0n;
  if (withdrawAmount === 0n) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).withdraw(
      cluster.operatorIds, withdrawAmount, toClusterStruct(cluster),
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'clusterWithdraw', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);
  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_WITHDRAWN);
  const expectedNormalWithdrawBalance = cluster.balance - withdrawAmount;
  assert.equal(BigInt(parsed.balance), expectedNormalWithdrawBalance, `withdraw: cluster balance`);
  cluster.balance = expectedNormalWithdrawBalance;
  cluster.lastStruct = parsedToStruct(parsed);
  report.record('withdraw', gas(receipt), txBlock);
  report.totalEthWithdrawnByOwnersWei += withdrawAmount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'withdraw', { amount: (Number(withdrawAmount) / 1e18).toFixed(9) + ' ETH' }, 'ClusterWithdrawn');
  return true;
}

export async function actLiquidate(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const cluster = pickFrom(rng, getActiveClusters(setup).filter(c => isLiquidatable(c, setup.simState)));
  if (!cluster) return false;
  return liquidateClusterDirectly(cluster, setup, report);
}

export async function actReactivate(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const cluster = pickFrom(rng, getInactiveClusters(setup).filter(c => c.version === VERSION_ETH));
  if (!cluster) return false;
  return reactivateClusterDirectly(cluster, setup, report, 60n + rng.nextInt(121n));
}

export async function actWithdrawOperatorEarnings(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const ops = getActiveOperators(setup).filter(
    op => op.balance > 0n || op.effectiveBalance > 0n || op.ssvBalance > 0n || op.ssvValidatorCount > 0n,
  );
  const op = pickFrom(rng, ops);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  if (op.balance > 0n || op.effectiveBalance > 0n) {
    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).withdrawAllOperatorEarnings(op.id);
      receipt = await tx.wait();
    } catch (err) {
      dumpDiag(report, 'withdrawOperatorEarnings (ETH)', err, [], [op.id]);
      throw err;
    }
    const txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);
    const withdrawn = op.balance;
    op.balance = 0n;
    report.record('withdrawOperatorEarnings', gas(receipt), txBlock);
    report.totalOperatorEthWithdrawnWei += withdrawn;
    report.recordOperatorTx(op.owner, op.id, txBlock, 'withdrawOperatorEarnings',
      { amount: (Number(withdrawn) / 1e18).toFixed(9) + ' ETH' }, 'OperatorWithdrawn');
  }

  if (op.ssvFeeWei > 0n && (op.ssvBalance > 0n || op.ssvValidatorCount > 0n)) {
    let receipt2: any;
    try {
      const tx2 = await network.connect(ownerSigner).withdrawAllOperatorEarningsSSV(op.id);
      receipt2 = await tx2.wait();
    } catch (err) {
      dumpDiag(report, 'withdrawOperatorEarnings (SSV token)', err, [], [op.id]);
      throw err;
    }
    const txBlock2 = BigInt(receipt2.blockNumber);
    advanceAll(simState, txBlock2);
    const ssvWithdrawn = op.ssvBalance;
    op.ssvBalance = 0n;
    report.record('withdrawOperatorEarningsSSV', gas(receipt2), txBlock2);
    report.recordOperatorTx(op.owner, op.id, txBlock2, 'withdrawOperatorEarningsSSV',
      { amount: (Number(ssvWithdrawn) / 1e18).toFixed(6) + ' SSV' }, 'OperatorWithdrawnSSV');
  }

  return true;
}

const BULK_VALIDATOR_COUNT: Record<number, number> = { 4: 80, 7: 45, 10: 30, 13: 20 };

export async function actBulkRegisterValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const activeClusters = getActiveClusters(setup).filter(c =>
    c.version === VERSION_ETH && c.canRegister,
  );
  const createNew = activeClusters.length === 0 || rng.nextInt(2n) === 0n;

  let cluster: ClusterRecord | undefined;
  let opSet: bigint[];
  let ownerSigner: any;
  let depositValue: bigint;
  let clusterStruct: any;

  if (createNew) {
    ownerSigner = pickFrom(rng, setup.allSigners.slice(2));
    if (!ownerSigner) return false;

    const eligibleOpIds = [...simState.operators.keys()]
      .filter(id => {
        const op = simState.operators.get(id);
        if (!op || op.isRemoved) return false;
        if (op.isPrivate && !op.whitelistedAddresses.has(ownerSigner!.address.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (a < b ? -1 : 1));
    if (eligibleOpIds.length < 4) return false;
    const achievableSizes = VALID_OP_SET_SIZES.filter(s => s <= eligibleOpIds.length);
    if (achievableSizes.length === 0) return false;
    const opSetSize = achievableSizes[Number(rng.nextInt(BigInt(achievableSizes.length)))];
    const startIdx = Number(rng.nextInt(BigInt(eligibleOpIds.length - opSetSize + 1)));
    opSet = eligibleOpIds.slice(startIdx, startIdx + opSetSize);
    if (opSet.length !== opSetSize) return false;
    const existingCluster = simState.clusters.get(computeClusterId(ownerSigner.address, opSet));
    if (existingCluster && existingCluster.version === VERSION_SSV) return false;
    clusterStruct = existingCluster ? toClusterStruct(existingCluster) : EMPTY_CLUSTER;
    cluster = existingCluster;
  } else {
    const picked = pickFrom(rng, activeClusters);
    if (!picked) return false;
    cluster = picked;
    opSet = cluster.operatorIds;
    ownerSigner = getOwnerSigner(setup, cluster.owner);
    if (!ownerSigner) return false;
    clusterStruct = toClusterStruct(cluster);
  }

  const n = BULK_VALIDATOR_COUNT[opSet.length] ?? 20;
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(makeValKey(simState.nextValidatorSeed++));
  const shares = keys.map(() => DEFAULT_SHARES);

  if (cluster && cluster.version === VERSION_ETH) {
    const newEB = cluster.effectiveBalance + BigInt(n) * DEFAULT_EB;
    const newBpb = cluster.burnRate * newEB / DEFAULT_EB;
    const tDays = 35n + rng.nextInt(86n); // 35–120 days
    const targetBal = ceilPrecision(tDays * BLOCKS_PER_DAY * newBpb);
    const minSafe = depositShortfall(cluster, BigInt(n), simState);
    const needed = targetBal > cluster.balance ? targetBal - cluster.balance : 0n;
    depositValue = ceilPrecision(needed > minSafe ? needed : minSafe);
  } else {
    let newBurnRate = simState.network.feeWei;
    for (const opId of opSet) newBurnRate += simState.operators.get(opId)!.feeWei;
    const newBpb = newBurnRate * BigInt(n); // n validators * BPS_DENOMINATOR / BPS_DENOMINATOR = n
    const tDays = 60n + rng.nextInt(121n); // 60–180 days
    depositValue = runwayDeposit(newBpb, tDays, simState, liquidationFloor(newBpb, simState));
  }

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).bulkRegisterValidator(
      keys, opSet, shares, clusterStruct, { value: depositValue },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'bulkRegisterValidator (to cluster)', err, cluster ? [cluster.id] : [], opSet);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseLastClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
  const clusterId = computeClusterId(ownerSigner.address, opSet);
  const addedEB = BigInt(n) * DEFAULT_EB;

  if (cluster && cluster.version === VERSION_ETH) {
    const expectedBulkBalance = cluster.balance + depositValue;
    assert.equal(BigInt(parsed.balance), expectedBulkBalance, `bulkRegisterValidator(existing): balance`);
    assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount + BigInt(n), `bulkRegisterValidator(existing): validatorCount`);
    cluster.validatorCount += BigInt(n);
    cluster.effectiveBalance += addedEB;
    cluster.balance = expectedBulkBalance;
    cluster.lastStruct = parsedToStruct(parsed);
    for (const key of keys) cluster.validators.add(key);
  } else {
    assert.equal(BigInt(parsed.balance), depositValue, `bulkRegisterValidator(new): balance`);
    assert.equal(BigInt(parsed.validatorCount), BigInt(n), `bulkRegisterValidator(new): validatorCount`);
    let burnRate = simState.network.feeWei;
    for (const opId of opSet) burnRate += simState.operators.get(opId)!.feeWei;
    const clusterRec: ClusterRecord = {
      id:               clusterId,
      owner:            ownerSigner.address,
      operatorIds:      [...opSet],
      version:          VERSION_ETH,
      block:            txBlock,
      balance:          depositValue,
      burnRate,
      effectiveBalance: addedEB,
      ssvBlock:         0n,
      ssvBalance:       0n,
      ssvBurnRate:      0n,
      createdBlock:     txBlock,
      validatorCount:   BigInt(n),
      active:           true,
      canRegister:      true,
      lastOracleEB:     0n,
      validators:       new Set(keys),
      lastStruct:       parsedToStruct(parsed),
    };
    simState.clusters.set(clusterId, clusterRec);
    report.ethClustersDynamic++;
  }

  for (const opId of opSet) {
    const op = simState.operators.get(opId)!;
    op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
    op.effectiveBalance += addedEB;
  }
  simState.network.totalEffectiveBalance += addedEB;

  report.record(`bulkRegisterValidator(${opSet.length})`, gas(receipt), txBlock);
  report.recordClusterTx(clusterId, ownerSigner.address, opSet, txBlock,
    'bulkRegisterValidator', { validators: n.toString(), eb: `+${addedEB} ETH`, version: 'ETH' }, 'ValidatorAdded');
  return true;
}

export async function actBulkRemoveValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const eligible = getActiveClusters(setup).filter(
    c => c.version === VERSION_ETH && c.validators.size >= 2,
  );
  const cluster = pickFrom(rng, eligible);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  const target = BULK_VALIDATOR_COUNT[cluster.operatorIds.length] ?? 20;
  const n = Math.min(target, cluster.validators.size - 1);
  if (n < 1) return false;
  const allKeys = [...cluster.validators];
  const keysToRemove = allKeys.slice(0, n);

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).bulkRemoveValidator(
      keysToRemove, cluster.operatorIds, toClusterStruct(cluster),
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'bulkRemoveValidator (from cluster)', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseLastClusterFromEvent(network, receipt, Events.VALIDATOR_REMOVED);
  const removedEB    = BigInt(n) * DEFAULT_EB;

  assert.equal(BigInt(parsed.balance), cluster.balance, `bulkRemoveValidator: balance`);
  assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount - BigInt(n), `bulkRemoveValidator: validatorCount`);
  cluster.validatorCount -= BigInt(n);
  cluster.effectiveBalance = cluster.effectiveBalance >= removedEB ? cluster.effectiveBalance - removedEB : 0n;
  cluster.lastStruct = parsedToStruct(parsed);
  for (const key of keysToRemove) cluster.validators.delete(key);

  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (!op) continue;
    op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
    if (op.effectiveBalance >= removedEB) op.effectiveBalance -= removedEB;
  }
  if (simState.network.totalEffectiveBalance >= removedEB) {
    simState.network.totalEffectiveBalance -= removedEB;
  }

  report.record('bulkRemoveValidator', gas(receipt), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'bulkRemoveValidator', { validators: n.toString(), eb: `-${removedEB} ETH` }, 'ValidatorRemoved');
  return true;
}

export async function actMigrateCluster(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const cluster = pickFrom(rng, [...setup.simState.clusters.values()].filter(
    c => c.version === VERSION_SSV && c.validatorCount > 0n,
  ));
  if (!cluster) return false;
  return migrateClusterDirectly(cluster, setup, report, 60n + rng.nextInt(121n));
}

export async function actDeclareOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const eligible = getActiveOperators(setup).filter(
    op => op.pendingFeeWei === 0n,
  );
  const op = pickFrom(rng, eligible);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  const delta = BigInt(rng.nextInt(5n) + 1n);  // 1..5
  const newFeeRaw = op.pendingFeeWei > 0n
    ? op.pendingFeeWei
    : (rng.nextInt(2n) === 0n
      ? op.feeWei + delta * ETH_DEDUCTED_DIGITS
      : (op.feeWei > delta * ETH_DEDUCTED_DIGITS + STRESS_MIN_OPERATOR_ETH_FEE
        ? op.feeWei - delta * ETH_DEDUCTED_DIGITS
        : op.feeWei + delta * ETH_DEDUCTED_DIGITS));
  const newFee = newFeeRaw < STRESS_MIN_OPERATOR_ETH_FEE ? STRESS_MIN_OPERATOR_ETH_FEE : newFeeRaw;

  if (newFee === op.feeWei) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).declareOperatorFee(op.id, newFee);
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'declareOperatorFee (ETH)', err, [], [op.id]);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  const declareBlock = await setup.provider.getBlock(receipt.blockNumber);
  const declareTimestamp = BigInt(declareBlock.timestamp);

  advanceAll(simState, txBlock);
  op.useDefaultEthFee = false; // ensureETHDefaults called on-chain during declare
  op.pendingFeeWei = newFee;
  op.pendingFeeBlock = txBlock;
  op.pendingFeeApprovalBeginTime = declareTimestamp + STRESS_FEE_PERIOD_SECS;
  op.pendingFeeApprovalEndTime   = declareTimestamp + STRESS_FEE_PERIOD_SECS + STRESS_FEE_PERIOD_SECS;

  report.record('declareOperatorFee', gas(receipt), txBlock);
  report.recordOperatorTx(op.owner, op.id, txBlock, 'declareOperatorFee',
    { from: (Number(op.feeWei) / 1e9).toFixed(2) + ' gwei', to: (Number(newFee) / 1e9).toFixed(2) + ' gwei' }, 'OperatorFeeDeclared');
  return true;
}

export async function actExecuteOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const latestBlock = await setup.provider.getBlock('latest');
  const now = BigInt(latestBlock.timestamp);

  const eligible = getActiveOperators(setup).filter(op =>
    op.pendingFeeWei > 0n &&
    op.pendingFeeApprovalBeginTime > 0n &&
    now >= op.pendingFeeApprovalBeginTime &&
    now <= op.pendingFeeApprovalEndTime,
  );
  const op = pickFrom(rng, eligible);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  let execReceipt: any;
  try {
    const tx = await network.connect(ownerSigner).executeOperatorFee(op.id);
    execReceipt = await tx.wait();
  } catch (err) {
    const msg = String((err as any)?.message ?? err);
    if (!msg.includes('ApprovalNotWithinTimeframe')) {
      dumpDiag(report, 'executeOperatorFee', err, [], [op.id]);
      throw err;
    }
    return false;
  }

  const txBlock = BigInt(execReceipt.blockNumber);
  advanceAll(simState, txBlock);

  const oldFee = op.feeWei;
  op.feeWei = op.pendingFeeWei;
  op.useDefaultEthFee = false;
  op.pendingFeeWei = 0n;
  op.pendingFeeBlock = 0n;
  op.pendingFeeApprovalBeginTime = 0n;
  op.pendingFeeApprovalEndTime   = 0n;

  for (const cluster of simState.clusters.values()) {
    if (!cluster.active || cluster.version !== VERSION_ETH) continue;
    if (!cluster.operatorIds.includes(op.id)) continue;
    cluster.burnRate = cluster.burnRate - oldFee + op.feeWei;
  }

  report.record('executeOperatorFee', gas(execReceipt), txBlock);
  report.recordOperatorTx(op.owner, op.id, txBlock, 'executeOperatorFee',
    { fee: (Number(op.feeWei) / 1e9).toFixed(2) + ' gwei' }, 'OperatorFeeExecuted');
  return true;
}

export async function actRemoveOperator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const allActive = getActiveOperators(setup);
  const servingOps = allActive.filter(op => op.effectiveBalance > 0n || op.ssvValidatorCount > 0n);
  const idleOps    = allActive.filter(op => op.effectiveBalance === 0n && op.ssvValidatorCount === 0n);

  let pool: typeof allActive;
  if (rng.nextInt(100n) < 95n) {
    pool = servingOps.length > 0 ? servingOps : idleOps;
  } else {
    pool = idleOps.length > 0 ? idleOps : servingOps;
  }
  if (pool.length === 0) return false;

  const op = pickFrom(rng, pool);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).removeOperator(op.id);
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'removeOperator', err, [], [op.id]);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const returnedETH = op.balance;
  const returnedSSV = op.ssvBalance;
  const oldFee = op.feeWei;

  op.balance = 0n;
  op.ssvBalance = 0n;
  op.feeWei = 0n;
  op.effectiveBalance = 0n;
  op.ssvValidatorCount = 0n;
  op.pendingFeeWei = 0n;
  op.pendingFeeBlock = 0n;
  op.isRemoved = true;

  const oldSsvFee = op.ssvFeeWei;
  const affectedClusters: ClusterRecord[] = [];
  for (const cluster of simState.clusters.values()) {
    if (!cluster.operatorIds.includes(op.id)) continue;
    if (cluster.version === VERSION_ETH && cluster.active) {
      cluster.burnRate = cluster.burnRate > oldFee ? cluster.burnRate - oldFee : 0n;
    } else if (cluster.version === VERSION_SSV && cluster.active && oldSsvFee > 0n) {
      cluster.ssvBurnRate = cluster.ssvBurnRate > oldSsvFee ? cluster.ssvBurnRate - oldSsvFee : 0n;
    }
    affectedClusters.push(cluster);
  }

  for (const cluster of affectedClusters) {
    cluster.canRegister = false;
  }

  report.record('removeOperator', gas(receipt), txBlock);
  report.recordOperatorTx(op.owner, op.id, txBlock, 'removeOperator',
    {
      returnedETH: (Number(returnedETH) / 1e18).toFixed(9) + ' ETH',
      ...(returnedSSV > 0n ? { returnedSSV: (Number(returnedSSV) / 1e18).toFixed(6) + ' SSV' } : {}),
      affectedClusters: affectedClusters.length.toString(),
    }, 'OperatorRemoved');

  for (const cluster of affectedClusters) {
    const adj: Record<string, string> = { opId: op.id.toString() };
    if (cluster.version === VERSION_ETH) adj['burnRateAdj'] = `-${(Number(oldFee) / 1e9).toFixed(2)} gwei`;
    else adj['version'] = 'SSV';
    report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
      'removeOperator', adj, 'OperatorRemoved');
  }

  return true;
}

export async function actCancelOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const latestBlockForCancel = await setup.provider.getBlock('latest');
  const nowForCancel = BigInt(latestBlockForCancel.timestamp);

  const allPending = getActiveOperators(setup).filter(op => op.pendingFeeWei > 0n);
  const expired = allPending.filter(op =>
    op.pendingFeeApprovalEndTime > 0n && nowForCancel > op.pendingFeeApprovalEndTime,
  );
  const pool = expired.length > 0 ? expired : allPending;
  const op = pickFrom(rng, pool);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).cancelDeclaredOperatorFee(op.id);
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'cancelOperatorFee', err, [], [op.id]);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  op.pendingFeeWei = 0n;
  op.pendingFeeBlock = 0n;
  op.pendingFeeApprovalBeginTime = 0n;
  op.pendingFeeApprovalEndTime   = 0n;

  report.record('cancelOperatorFee', gas(receipt), txBlock);
  report.recordOperatorTx(op.owner, op.id, txBlock, 'cancelOperatorFee',
    { fee: (Number(op.feeWei) / 1e9).toFixed(2) + ' gwei (kept)' }, 'OperatorFeeDeclarationCancelled');
  return true;
}

export async function actWithdrawFromOperator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const eligible = getActiveOperators(setup).filter(op => op.balance > 0n);
  const op = pickFrom(rng, eligible);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  const pct = 20n + rng.nextInt(61n); // 20..80
  const raw = (op.balance * pct) / 100n;
  const amount = (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
  if (amount === 0n) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).withdrawOperatorEarnings(op.id, amount);
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'withdrawFromOperator', err, [], [op.id]);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  op.balance -= amount;
  report.record('withdrawFromOperator', gas(receipt), txBlock);
  report.totalOperatorEthWithdrawnWei += amount;
  report.recordOperatorTx(op.owner, op.id, txBlock, 'withdrawFromOperator',
    { amount: (Number(amount) / 1e18).toFixed(9) + ' ETH', pct: pct.toString() + '%' }, 'OperatorWithdrawn');
  return true;
}

export async function liquidateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  let receipt: any;
  try {
    const clusterStruct = toClusterStruct(cluster);
    const tx = cluster.version === VERSION_SSV
      ? await network.connect(setup.liquidator).liquidateSSV(cluster.owner, cluster.operatorIds, clusterStruct)
      : await network.connect(setup.liquidator).liquidate(cluster.owner, cluster.operatorIds, clusterStruct);
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'liquidateClusterDirectly', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  const ageBlocks = txBlock - cluster.createdBlock;
  advanceAll(simState, txBlock);

  const liqBpb = burnPerBlock(cluster);
  const liqMinCollateral = cluster.version === VERSION_ETH
    ? simState.minimumLiquidationCollateral
    : simState.minimumLiquidationCollateralSSV;
  const balAtLiq = cluster.version === VERSION_ETH ? cluster.balance : cluster.ssvBalance;
  const isCollateral = balAtLiq < liqMinCollateral;
  const liqMeasure = isCollateral ? balAtLiq : (liqBpb > 0n ? balAtLiq / liqBpb : 0n);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);

  if (cluster.version === VERSION_SSV) report.ssvClustersLiquidatedBeforeMigration++;

  let liqEB = 0n;
  if (cluster.version === VERSION_SSV) {
    const validatorsRemoved = cluster.validatorCount;
    for (const opId of cluster.operatorIds) {
      const op = simState.operators.get(opId);
      if (op && op.ssvValidatorCount >= validatorsRemoved) op.ssvValidatorCount -= validatorsRemoved;
    }
    if (simState.network.totalSSVValidators >= validatorsRemoved) {
      simState.network.totalSSVValidators -= validatorsRemoved;
    }
    cluster.ssvBalance = 0n;
    cluster.ssvBurnRate = 0n;
  } else {
    liqEB = cluster.effectiveBalance;
    for (const opId of cluster.operatorIds) {
      const op = simState.operators.get(opId);
      if (op && op.effectiveBalance >= liqEB) op.effectiveBalance -= liqEB;
    }
    if (simState.network.totalEffectiveBalance >= liqEB) {
      simState.network.totalEffectiveBalance -= liqEB;
    }
    assert.equal(BigInt(parsed.balance), 0n, `liquidateDirectly: cluster balance must be 0`);
    cluster.balance = 0n;
    cluster.burnRate = 0n;
  }

  cluster.active = false;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('liquidate', BigInt(receipt.gasUsed ?? 0n), txBlock);
  report.recordLiquidation(ageBlocks);
  report.recordLiquidationTyped(isCollateral, liqMeasure);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'liquidate', { age: ageBlocks.toString() + ' blocks', validators: cluster.validatorCount.toString(), ...(liqEB > 0n ? { eb: `-${liqEB} ETH` } : {}), type: isCollateral ? 'collateral' : 'runway', note: 'post-mine' }, 'ClusterLiquidated');
  return true;
}

export async function depositToClusterDirectly(
  cluster: ClusterRecord,
  amount: bigint,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).deposit(
      cluster.owner, cluster.operatorIds, toClusterStruct(cluster), { value: amount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'depositToClusterDirectly', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_DEPOSITED);
  cluster.balance += amount;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('deposit', BigInt(receipt.gasUsed ?? 0n), txBlock);
  report.totalEthDepositedWei += amount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'deposit', { amount: (Number(amount) / 1e18).toFixed(6) + ' ETH', note: 'post-mine rescue' }, 'ClusterDeposited');
  return true;
}

export async function migrateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
  targetDays = 90n,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  let burnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op) burnRate += op.feeWei;
  }
  const migratedEB = cluster.validatorCount * DEFAULT_EB;
  const bpb = burnRate * migratedEB / DEFAULT_EB;
  const depositAmount = runwayDeposit(bpb, targetDays, simState, liquidationFloor(bpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).migrateClusterToETH(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'migrateClusterDirectly (with removed op)', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
  assert.equal(BigInt(parsed.balance), depositAmount, `migrateClusterDirectly: balance`);
  const wasLiquidated = !cluster.active;

  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && !op.isRemoved) {
      op.useDefaultEthFee = false; // ensureETHDefaults called on-chain during migration
      if (!wasLiquidated && op.ssvValidatorCount >= cluster.validatorCount) op.ssvValidatorCount -= cluster.validatorCount;
      op.effectiveBalance += migratedEB;
    }
  }
  if (!wasLiquidated && simState.network.totalSSVValidators >= cluster.validatorCount) {
    simState.network.totalSSVValidators -= cluster.validatorCount;
  }
  simState.network.totalEffectiveBalance += migratedEB;

  cluster.version          = VERSION_ETH;
  cluster.active           = true;
  cluster.block            = txBlock;
  cluster.createdBlock     = txBlock;
  cluster.balance          = depositAmount;
  cluster.burnRate         = burnRate;
  cluster.effectiveBalance = migratedEB;
  cluster.lastOracleEB     = 0n;  // fresh ETH cluster — no oracle EB committed yet
  cluster.ssvBalance  = 0n;
  cluster.ssvBurnRate = 0n;
  cluster.ssvBlock    = 0n;
  cluster.lastStruct  = parsedToStruct(parsed);

  report.migrationsDynamic++;
  report.record('migrateCluster', BigInt(receipt.gasUsed ?? 0n), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'migrateCluster', {
      deposit: (Number(depositAmount) / 1e18).toFixed(6) + ' ETH',
      eb: `+${migratedEB} ETH`,
      note: 'test:removed-op-allowed',
      ...(wasLiquidated ? { from: 'liquidated' } : {}),
    }, 'ClusterMigratedToETH');
  return true;
}

export async function reactivateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
  targetDays = 90n,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  let currentBurnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && !op.isRemoved) currentBurnRate += op.feeWei;
  }
  const bpb = currentBurnRate * cluster.effectiveBalance / DEFAULT_EB;
  const depositAmount = runwayDeposit(bpb, targetDays, simState, liquidationFloor(bpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).reactivate(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpDiag(report, 'reactivateClusterDirectly (with removed op)', err, [cluster.id], cluster.operatorIds);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_REACTIVATED);
  assert.equal(BigInt(parsed.balance), depositAmount, `reactivateClusterDirectly: balance`);
  cluster.active    = true;
  cluster.block     = txBlock;
  cluster.balance   = depositAmount;
  cluster.burnRate  = currentBurnRate;
  cluster.lastStruct = parsedToStruct(parsed);

  // Restore effectiveBalance only for non-removed operators
  const restoredEB = cluster.effectiveBalance;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && !op.isRemoved) {
      op.useDefaultEthFee = false; // ensureETHDefaults called on-chain
      op.effectiveBalance += restoredEB;
    }
  }
  simState.network.totalEffectiveBalance += restoredEB;

  report.totalReactivations++;
  report.record('reactivate', BigInt(receipt.gasUsed ?? 0n), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'reactivate', {
      deposit: (Number(depositAmount) / 1e18).toFixed(6) + ' ETH',
      note: 'test:removed-op-allowed',
    }, 'ClusterReactivated');
  return true;
}

export async function actUpdateNetworkFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, deployer } = setup;

  const currentBlock = BigInt(await setup.provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  const oldFee   = simState.network.feeWei;
  const minBlocks = simState.minimumBlocksBeforeLiquidation;
  const minCollateral = simState.minimumLiquidationCollateral;
  const activeClusters = [...simState.clusters.values()].filter(c => c.active);

  let hardCeiling = 10n * TARGET_NETWORK_FEE_ETH; // reasonable absolute cap

  for (const c of activeClusters) {
    if (c.version !== VERSION_ETH || c.effectiveBalance === 0n) continue;
    const denom = minBlocks * c.effectiveBalance / DEFAULT_EB;
    if (denom === 0n) continue;
    const maxFeeForCluster = c.balance / denom + oldFee - c.burnRate;
    if (maxFeeForCluster < 0n) continue;  // already problematic, skip
    if (maxFeeForCluster < hardCeiling) hardCeiling = maxFeeForCluster;
  }

  const ceilingUnits = hardCeiling / ETH_DEDUCTED_DIGITS;
  if (ceilingUnits === 0n) return false;

  for (let attempt = 0; attempt < 20; attempt++) {
    const newFee = rng.nextInt(ceilingUnits + 1n) * ETH_DEDUCTED_DIGITS;
    if (newFee === oldFee) continue;

    let liquidatableCount = 0;
    for (const c of activeClusters) {
      if (c.version !== VERSION_ETH || c.effectiveBalance === 0n) continue;
      const newBpb = (c.burnRate - oldFee + newFee) * c.effectiveBalance / DEFAULT_EB;
      const threshold = minBlocks * newBpb > minCollateral ? minBlocks * newBpb : minCollateral;
      if (c.balance < threshold) liquidatableCount++;
    }

    if (activeClusters.length === 0 || liquidatableCount / activeClusters.length <= 0.05) {
      let receipt: any;
      try {
        const tx = await network.connect(deployer).updateNetworkFee(newFee);
        receipt = await tx.wait();
      } catch (err) {
        report.writeFullHistory('updateNetworkFee');
        throw err;
      }
      const txBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, txBlock);  // advance the 1 block mined by the TX

      simState.network.feeWei = newFee;
      for (const c of simState.clusters.values()) {
        if (!c.active || c.version !== VERSION_ETH) continue;
        c.burnRate = c.burnRate - oldFee + newFee;
      }

      report.record('updateNetworkFee', gas(receipt), txBlock);
      report.recordNetworkFeeChange(txBlock, oldFee, newFee);
      report.recordNetworkAction(txBlock, 'updateNetworkFee', {
        oldFee: (Number(oldFee) / 1e9).toFixed(4) + ' gwei',
        newFee: (Number(newFee) / 1e9).toFixed(4) + ' gwei',
        delta: ((Number(newFee) - Number(oldFee)) / 1e9 >= 0 ? '+' : '') + ((Number(newFee) - Number(oldFee)) / 1e9).toFixed(4) + ' gwei',
      });
      return true;
    }
  }
  return false;
}

const MINIMAL_LIQ_THRESHOLD = 21_480n; // from SSVDAO.sol: MINIMAL_LIQUIDATION_THRESHOLD

export async function actUpdateLiquidationThresholdPeriod(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, deployer } = setup;

  const currentBlock = BigInt(await setup.provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  const activeClusters = [...simState.clusters.values()].filter(c => c.active);

  // Hard ceiling: max minBlocks before any cluster immediately hits its threshold.
  // For cluster c: balance >= newMinBlocks * bpb → newMinBlocks <= floor(balance / bpb)
  let hardCeiling = 1_000_000n; // absolute cap (~139 days of blocks)

  for (const c of activeClusters) {
    const bpb = burnPerBlock(c);
    if (bpb === 0n) continue;
    const maxBlocksForCluster = (c.version === VERSION_ETH ? c.balance : c.ssvBalance) / bpb;
    if (maxBlocksForCluster < MINIMAL_LIQ_THRESHOLD) continue; // can't go below protocol min
    if (maxBlocksForCluster < hardCeiling) hardCeiling = maxBlocksForCluster;
  }

  if (hardCeiling < MINIMAL_LIQ_THRESHOLD) return false;

  // Pick randomly in [MINIMAL_LIQ_THRESHOLD, hardCeiling], retry for ≤5% rule.
  const range = hardCeiling - MINIMAL_LIQ_THRESHOLD;
  const minCollateral = simState.minimumLiquidationCollateral;
  const minCollateralSSV = simState.minimumLiquidationCollateralSSV;

  for (let attempt = 0; attempt < 20; attempt++) {
    const newMinBlocks = MINIMAL_LIQ_THRESHOLD + rng.nextInt(range + 1n);
    if (newMinBlocks === simState.minimumBlocksBeforeLiquidation) continue;

    let liquidatableCount = 0;
    for (const c of activeClusters) {
      const bpb = burnPerBlock(c);
      if (bpb === 0n) continue;
      const balance = c.version === VERSION_ETH ? c.balance : c.ssvBalance;
      const mc = c.version === VERSION_ETH ? minCollateral : minCollateralSSV;
      const threshold = newMinBlocks * bpb > mc ? newMinBlocks * bpb : mc;
      if (balance < threshold) liquidatableCount++;
    }

    if (activeClusters.length === 0 || liquidatableCount / activeClusters.length <= 0.05) {
      let receipt: any;
      try {
        // Update both ETH and SSV thresholds together to keep TS state consistent.
        const tx = await network.connect(deployer).updateLiquidationThresholdPeriod(newMinBlocks);
        receipt = await tx.wait();
        // Keep SSV in sync
        await (await network.connect(deployer).updateLiquidationThresholdPeriodSSV(newMinBlocks)).wait();
      } catch (err) {
        report.writeFullHistory('updateLiquidationThresholdPeriod');
        throw err;
      }
      const txBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, txBlock);

      const oldMinBlocks = simState.minimumBlocksBeforeLiquidation;
      simState.minimumBlocksBeforeLiquidation = newMinBlocks;

      report.record('updateLiquidationThresholdPeriod', gas(receipt), txBlock);
      report.recordNetworkAction(txBlock, 'updateLiquidationThresholdPeriod', {
        oldBlocks: oldMinBlocks.toString(),
        newBlocks: newMinBlocks.toString(),
        delta: (Number(newMinBlocks) - Number(oldMinBlocks) >= 0 ? '+' : '') + (Number(newMinBlocks) - Number(oldMinBlocks)).toString(),
      });
      return true;
    }
  }
  return false;
}

export async function actUpdateLiquidationCollateral(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, deployer } = setup;

  const currentBlock = BigInt(await setup.provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  const activeClusters = [...simState.clusters.values()].filter(c => c.active);
  const activeETH = activeClusters.filter(c => c.version === VERSION_ETH && c.effectiveBalance > 0n);

  let hardCeiling = 10n * 10n ** 18n; // absolute cap: 10 ETH
  for (const c of activeETH) {
    if (c.balance < hardCeiling) hardCeiling = c.balance;
  }
  if (hardCeiling < ETH_DEDUCTED_DIGITS) return false;

  const ceilingUnits = hardCeiling / ETH_DEDUCTED_DIGITS;
  if (ceilingUnits === 0n) return false;

  const minBlocks = simState.minimumBlocksBeforeLiquidation;

  for (let attempt = 0; attempt < 20; attempt++) {
    // Pick in [1 unit, ceilingUnits] (minimum 1 × ETH_DEDUCTED_DIGITS)
    const newCollateral = (1n + rng.nextInt(ceilingUnits)) * ETH_DEDUCTED_DIGITS;
    if (newCollateral === simState.minimumLiquidationCollateral) continue;

    let liquidatableCount = 0;
    for (const c of activeETH) {
      const bpb = burnPerBlock(c);
      const threshold = minBlocks * bpb > newCollateral ? minBlocks * bpb : newCollateral;
      if (c.balance < threshold) liquidatableCount++;
    }

    if (activeClusters.length === 0 || liquidatableCount / activeClusters.length <= 0.05) {
      let receipt: any;
      try {
        const tx = await network.connect(deployer).updateMinimumLiquidationCollateral(newCollateral);
        receipt = await tx.wait();
      } catch (err) {
        report.writeFullHistory('updateMinimumLiquidationCollateral');
        throw err;
      }
      const txBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, txBlock);

      const oldCollateral = simState.minimumLiquidationCollateral;
      simState.minimumLiquidationCollateral = newCollateral;

      report.record('updateMinimumLiquidationCollateral', gas(receipt), txBlock);
      report.recordNetworkAction(txBlock, 'updateMinimumLiquidationCollateral', {
        oldCollateral: (Number(oldCollateral) / 1e18).toFixed(8) + ' ETH',
        newCollateral: (Number(newCollateral) / 1e18).toFixed(8) + ' ETH',
        delta: ((Number(newCollateral) - Number(oldCollateral)) / 1e18 >= 0 ? '+' : '') + ((Number(newCollateral) - Number(oldCollateral)) / 1e18).toFixed(8) + ' ETH',
      });
      return true;
    }
  }
  return false;
}

export async function actCommitEBRoot(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, oracleSigners, connection } = setup;

  const currentBlock = BigInt(await setup.provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  const activeETH = [...simState.clusters.values()].filter(
    c => c.active && c.version === VERSION_ETH && c.validatorCount > 0n && c.effectiveBalance > 0n,
  );
  if (activeETH.length === 0) return false;

  const count = Math.max(1, Math.round(activeETH.length * 0.10));
  const shuffled = [...activeETH];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Number(rng.nextInt(BigInt(i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled.slice(0, count);

  const merkleEntries: { clusterId: string; effectiveBalance: number }[] = [];
  const pendingEntries: Map<string, { oldEB: bigint; newEB: bigint; proof: string[] }> = new Map();

  for (const cluster of selected) {
    const minEB = cluster.validatorCount * MIN_EB_PER_VALIDATOR;
    const maxEB = cluster.validatorCount * MAX_EB_PER_VALIDATOR;

    if (cluster.lastOracleEB > 0n && cluster.lastOracleEB > maxEB) {
      continue;
    }

    const oracleFloor = cluster.lastOracleEB > minEB ? cluster.lastOracleEB : minEB;

    let newEB: bigint;
    const makeLiquidating = rng.nextInt(100n) < 15n; // 15% chance

    if (makeLiquidating && cluster.burnRate > 0n && cluster.balance > 0n) {
      const liqEB = (cluster.balance * DEFAULT_EB / cluster.burnRate + 1n) * 3n;
      const liqEB32 = ((liqEB + DEFAULT_EB - 1n) / DEFAULT_EB) * DEFAULT_EB;
      newEB = liqEB32 < maxEB ? liqEB32 : maxEB;
      if (newEB < oracleFloor) newEB = oracleFloor;
    } else {
      const upperBound = maxEB < cluster.effectiveBalance * 3n ? maxEB : cluster.effectiveBalance * 3n;
      const upperBound32 = (upperBound / DEFAULT_EB) * DEFAULT_EB;  // round down to multiple of 32
      const floorUnits = oracleFloor / DEFAULT_EB;
      const minUnits = floorUnits > minEB / DEFAULT_EB ? floorUnits : minEB / DEFAULT_EB;
      const maxUnits = upperBound32 / DEFAULT_EB;
      const range = maxUnits > minUnits ? maxUnits - minUnits + 1n : 1n;
      newEB = (minUnits + rng.nextInt(range)) * DEFAULT_EB;
    }

    merkleEntries.push({ clusterId: cluster.id, effectiveBalance: Number(newEB) });
    pendingEntries.set(cluster.id, { oldEB: cluster.effectiveBalance, newEB, proof: [] });
  }

  const { root, proofs } = generateMerkleForClusterEB(connection, merkleEntries);
  for (const { clusterId } of merkleEntries) {
    pendingEntries.get(clusterId)!.proof = proofs[clusterId] ?? [];
  }

  let commitReceipt: any;
  try {
    commitReceipt = await commitEBRoot(network, root, Number(currentBlock), oracleSigners);
  } catch (err) {
    console.error(`\n[TX FAIL] commitEBRoot — blockNum=${currentBlock} entries=${merkleEntries.length} — ${String((err as any)?.message ?? err)}`);
    throw err;
  }
  let txBlock = BigInt(commitReceipt.blockNumber);
  advanceAll(simState, txBlock);

  report.record('commitEBRoot', gas(commitReceipt), txBlock);
  report.recordEBRound(txBlock, count);

  const blockNum = Number(currentBlock);

  for (const [clusterId, entry] of pendingEntries) {
    const cluster = simState.clusters.get(clusterId);

    if (!cluster || !cluster.active) {
      report.recordEBSkipped();
      continue;
    }

    if (report.ebSkipped < 5 && rng.nextInt(25n) === 0n) {
      report.recordEBSkipped();
      report.recordClusterTx(clusterId, cluster.owner, cluster.operatorIds, txBlock,
        'updateClusterBalance-skipped', { oldEB: `${entry.oldEB} ETH`, newEB: `${entry.newEB} ETH`, note: 'intentional skip' }, '');
      continue;
    }

    const preTxBlock = BigInt(await setup.provider.getBlockNumber());
    advanceAll(simState, preTxBlock);

    let receipt: any;
    try {
      const tx = await network.connect(setup.deployer).updateClusterBalance(
        blockNum,
        cluster.owner,
        cluster.operatorIds,
        toClusterStruct(cluster),
        Number(entry.newEB),
        entry.proof,
      );
      receipt = await tx.wait();
    } catch (err) {
      dumpDiag(report, 'updateClusterBalance', err, [cluster.id], cluster.operatorIds);
      throw err;
    }

    txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);

    const { oldEB, newEB } = entry;

    let isLiquidated = false;
    try {
      parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      isLiquidated = true;
    } catch {
      // no CLUSTER_LIQUIDATED event → normal balance update
    }

    if (isLiquidated) {
      const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      const liqEB = cluster.effectiveBalance;
      for (const opId of cluster.operatorIds) {
        const op = simState.operators.get(opId);
        if (op && op.effectiveBalance >= liqEB) op.effectiveBalance -= liqEB;
      }
      if (simState.network.totalEffectiveBalance >= liqEB) simState.network.totalEffectiveBalance -= liqEB;
      cluster.effectiveBalance = newEB;  // seb.clusterEB was updated to newEB before liquidation
      cluster.lastOracleEB = newEB;
      cluster.balance = 0n;
      cluster.burnRate = 0n;
      cluster.active = false;
      cluster.lastStruct = parsedToStruct(parsed);
      report.recordEBLiquidated();
      report.record('updateClusterBalance', gas(receipt), txBlock);
      report.recordClusterTx(clusterId, cluster.owner, cluster.operatorIds, txBlock,
        'updateClusterBalance', { oldEB: `${oldEB} ETH`, newEB: `${newEB} ETH`, note: 'auto-liquidated' }, 'ClusterLiquidated');
    } else {
      const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
      for (const opId of cluster.operatorIds) {
        const op = simState.operators.get(opId);
        if (op) {
          if (newEB >= oldEB) {
            op.effectiveBalance += newEB - oldEB;
          } else {
            const drop = oldEB - newEB;
            op.effectiveBalance = op.effectiveBalance >= drop ? op.effectiveBalance - drop : 0n;
          }
        }
      }
      if (newEB >= oldEB) {
        simState.network.totalEffectiveBalance += newEB - oldEB;
      } else {
        const drop = oldEB - newEB;
        simState.network.totalEffectiveBalance = simState.network.totalEffectiveBalance >= drop
          ? simState.network.totalEffectiveBalance - drop : 0n;
      }
      assert.equal(BigInt(parsed.balance), cluster.balance, `updateClusterBalance: balance`);
      cluster.effectiveBalance = newEB;
      cluster.lastOracleEB = newEB;
      cluster.block = txBlock;
      cluster.lastStruct = parsedToStruct(parsed);
      if (newEB > oldEB) report.recordEBRaised();
      else if (newEB < oldEB) report.recordEBLowered();
      const ebDiff = newEB >= oldEB ? newEB - oldEB : -(oldEB - newEB);
      const ebDiffStr = ebDiff >= 0n ? `+${ebDiff}` : `${ebDiff}`;
      report.record('updateClusterBalance', gas(receipt), txBlock);
      report.recordClusterTx(clusterId, cluster.owner, cluster.operatorIds, txBlock,
        'updateClusterBalance', { oldEB: `${oldEB} ETH`, newEB: `${newEB} ETH`, delta: `${ebDiffStr} ETH` }, 'ClusterBalanceUpdated');
    }
  }

  return true;
}

async function actStake(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { network, ssvToken, simState, provider } = setup;

  const idx = _SL_EOA_START + Number(rng.nextInt(BigInt(STRESS_STAKERS_EOA)));
  const staker = setup.allSigners[idx];
  if (!staker) return false;

  const range = DEFAULT_STAKE_AMOUNT - MINIMAL_STAKING_AMOUNT + 1n;
  const amount = MINIMAL_STAKING_AMOUNT + rng.nextInt(range);

  const preTxBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, preTxBlock);

  try {
    await (await ssvToken.mint(staker.address, amount)).wait();
    await (await ssvToken.connect(staker).approve(await network.getAddress(), amount)).wait();
    const receipt = await (await network.connect(staker).stake(amount)).wait();
    if (!receipt) return false;
    const txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);

    let stakerRec = simState.stakers.get(staker.address.toLowerCase());
    if (!stakerRec) {
      stakerRec = { address: staker.address, cssvBalance: 0n, pendingUnstake: [], ethClaimed: 0n, totalEthAmount: 0n, userIndex: 0n };
      simState.stakers.set(staker.address.toLowerCase(), stakerRec);
    }
    onSyncFees(simState);
    onSettleUser(stakerRec, simState);
    stakerRec.cssvBalance += amount;

    report.record('stake', gas(receipt), txBlock);
    report.recordStakerTx(staker.address, txBlock, 'stake',
      { amount: (Number(amount) / 1e18).toFixed(6) + ' SSV' }, 'Staked');
    return true;
  } catch (err: any) {
    report.writeFullHistory('stake');
    throw err;
  }
}

async function actRequestUnstake(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { network, simState, provider } = setup;

  const eligible = [...simState.stakers.values()].filter(s => s.cssvBalance > 0n);
  if (eligible.length === 0) return false;

  const stakerRec = eligible[Number(rng.nextInt(BigInt(eligible.length)))];
  const staker = getOwnerSigner(setup, stakerRec.address);
  if (!staker) return false;

  const amount = 1n + rng.nextInt(stakerRec.cssvBalance);

  const preTxBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, preTxBlock);

  try {
    const receipt = await (await network.connect(staker).requestUnstake(amount)).wait();
    if (!receipt) return false;
    const txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);

    const txBlockData = await provider.getBlock(receipt.blockNumber);
    const unlockTime = BigInt(txBlockData.timestamp) + STRESS_COOLDOWN_SECS;

    onSyncFees(simState);
    onSettleUser(stakerRec, simState);
    stakerRec.cssvBalance -= amount;
    stakerRec.pendingUnstake.push({ amount, unlockTime });

    report.record('requestUnstake', gas(receipt), txBlock);
    report.recordStakerTx(stakerRec.address, txBlock, 'requestUnstake',
      { amount: (Number(amount) / 1e18).toFixed(6) + ' SSV', unlockTime: unlockTime.toString() }, 'UnstakeRequested');
    return true;
  } catch (err: any) {
    report.writeFullHistory('requestUnstake');
    throw err;
  }
}

async function actWithdrawUnlocked(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { network, simState, provider } = setup;

  const currentBlockNum = await provider.getBlockNumber();
  const currentBlockData = await provider.getBlock(currentBlockNum);
  const currentTimestamp = BigInt(currentBlockData.timestamp);

  const eligible = [...simState.stakers.values()].filter(s =>
    s.pendingUnstake.some(r => r.unlockTime <= currentTimestamp),
  );
  if (eligible.length === 0) return false;

  const stakerRec = eligible[Number(rng.nextInt(BigInt(eligible.length)))];
  const staker = getOwnerSigner(setup, stakerRec.address);
  if (!staker) return false;

  const preTxBlock = BigInt(currentBlockNum);
  advanceAll(simState, preTxBlock);

  try {
    const receipt = await (await network.connect(staker).withdrawUnlocked()).wait();
    if (!receipt) return false;
    const txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);

    const txBlockData = await provider.getBlock(receipt.blockNumber);
    const txTimestamp = BigInt(txBlockData.timestamp);

    stakerRec.pendingUnstake = stakerRec.pendingUnstake.filter(r => r.unlockTime > txTimestamp);

    report.record('withdrawUnlocked', gas(receipt), txBlock);
    report.recordStakerTx(stakerRec.address, txBlock, 'withdrawUnlocked', {}, 'UnlockedWithdrawn');
    return true;
  } catch (err: any) {
    report.writeFullHistory('withdrawUnlocked');
    throw err;
  }
}

export async function actClaimEthRewards(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const eligible = [...simState.stakers.values()].filter(s => s.cssvBalance > 0n || s.totalEthAmount > 0n);
  const stakerRec = pickFrom(rng, eligible);
  if (!stakerRec) return false;

  const staker = getOwnerSigner(setup, stakerRec.address);
  if (!staker) return false;

  let receipt: any;
  try {
    const tx = await network.connect(staker).claimEthRewards();
    receipt = await tx.wait();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes('NothingToClaim')) return false;
    console.error(`\n[TX FAIL] claimEthRewards — ${msg}`);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);

  onSyncFees(simState);
  onSettleUser(stakerRec, simState);

  const claimable  = stakerRec.totalEthAmount;
  const remainder  = claimable % ETH_DEDUCTED_DIGITS;
  const payout     = claimable - remainder;
  const keepRemainder = !(remainder > 0n && stakerRec.cssvBalance === 0n);

  let eventPayout = 0n;
  for (const log of receipt.logs ?? []) {
    try {
      const p = network.interface.parseLog(log);
      if (p?.name === 'RewardsClaimed') { eventPayout = BigInt(p.args[1]); break; }
    } catch { /* skip */ }
  }
  assert.equal(eventPayout, payout, `claimEthRewards: payout`);

  stakerRec.ethClaimed    += payout;
  stakerRec.totalEthAmount = keepRemainder ? remainder : 0n;
  if (payout > 0n && simState.network.ethNetworkEarnings >= payout) {
    simState.network.ethNetworkEarnings -= payout;
    simState.network.lastSyncedPackedEarnings -= payout;
  }

  report.record('claimEthRewards', gas(receipt), txBlock);
  report.recordStakerTx(stakerRec.address, txBlock, 'claimEthRewards',
    { payout: (Number(payout) / 1e18).toFixed(9) + ' ETH' }, 'RewardsClaimed');
  return true;
}

async function actTransferCSSV(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, cssvToken, provider } = setup;

  const eligible = [...simState.stakers.values()].filter(s => s.cssvBalance > 0n);
  if (eligible.length === 0) return false;

  const senderRec = eligible[Number(rng.nextInt(BigInt(eligible.length)))];
  const senderSigner = getOwnerSigner(setup, senderRec.address);
  if (!senderSigner) return false;

  const transferAll = rng.nextInt(100n) < 15n;
  const amount = transferAll
    ? senderRec.cssvBalance
    : 1n + rng.nextInt(senderRec.cssvBalance);
  if (amount === 0n) return false;

  const senderIsContract = setup.allSigners
    .slice(_SL_CON_START, _SL_CON_START + STRESS_STAKERS_CONTRACT)
    .some((s: any) => s.address.toLowerCase() === senderRec.address.toLowerCase());

  // Determine recipient
  let recipientAddress: string;
  let recipientType: 'existing' | 'contract' | 'fresh';

  const roll = rng.nextInt(100n);
  if (roll < 60n) {
    const others = eligible.filter(s => s.address.toLowerCase() !== senderRec.address.toLowerCase());
    if (others.length === 0) return false;
    const rec = others[Number(rng.nextInt(BigInt(others.length)))];
    recipientAddress = rec.address;
    recipientType = 'existing';
  } else if (roll < 80n) {
    if (STRESS_STAKERS_CONTRACT === 0) return false;
    const j = Number(rng.nextInt(BigInt(STRESS_STAKERS_CONTRACT)));
    const contractStaker = setup.allSigners[_SL_CON_START + j];
    if (!contractStaker) return false;
    recipientAddress = contractStaker.address;
    recipientType = 'contract';
  } else {
    const freshIdx = STRESS_TOTAL_SIGNERS + 300 + simState.nextFreshWalletIndex++;
    const freshSigner = await getSigner(setup.connection, setup.allSigners, freshIdx);
    if (!freshSigner) return false;
    if (!setup.allSigners.some((s: any) => s.address.toLowerCase() === freshSigner.address.toLowerCase())) {
      setup.allSigners.push(freshSigner);
    }
    recipientAddress = freshSigner.address;
    recipientType = 'fresh';
  }

  if (recipientAddress.toLowerCase() === senderRec.address.toLowerCase()) return false;

  const preTxBlock = BigInt(await provider.getBlockNumber());
  advanceAll(simState, preTxBlock);

  let receipt: any;
  try {
    const tx = await cssvToken.connect(senderSigner).transfer(recipientAddress, amount);
    receipt = await tx.wait();
  } catch (err: any) {
    console.error(`\n[TX FAIL] transferCSSV — ${String(err?.message ?? err)}`);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);

  let recipientRec = simState.stakers.get(recipientAddress.toLowerCase());
  if (!recipientRec) {
    recipientRec = {
      address: recipientAddress,
      cssvBalance: 0n,
      pendingUnstake: [],
      ethClaimed: 0n,
      totalEthAmount: 0n,
      userIndex: 0n,
    };
    simState.stakers.set(recipientAddress.toLowerCase(), recipientRec);
  }

  onSyncFees(simState);
  onSettleUser(senderRec, simState);
  onSettleUser(recipientRec, simState);
  senderRec.cssvBalance -= amount;
  recipientRec.cssvBalance += amount;

  report.record('transferCSSV', gas(receipt), txBlock);
  report.recordCSSVTransfer(transferAll, recipientType, senderIsContract);
  report.recordStakerTx(senderRec.address, txBlock, 'transferCSSV',
    { amount: (Number(amount) / 1e18).toFixed(6) + ' cSSV', to: recipientAddress.slice(0, 10), type: recipientType }, 'Transfer');
  return true;
}

// ─── Change DEFAULT_OPERATOR_ETH_FEE via module upgrade ─────────────────────

const _ACTIONS_DIR = path.dirname(new URL(import.meta.url).pathname);
const CORE_TYPES_PATH = path.resolve(_ACTIONS_DIR, '../../contracts/libraries/SSVCoreTypes.sol');
const PROJECT_ROOT = path.resolve(_ACTIONS_DIR, '../..');

export async function actChangeDefaultOperatorEthFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider, connection } = setup;

  // ── Pick new fee: ±10% of current default, rounded to ETH_DEDUCTED_DIGITS ──
  const currentDefault = simState.defaultOperatorEthFee;
  const deviationBps = 1000n; // 10%
  const newFee = randFee(rng, currentDefault, deviationBps);
  if (newFee === currentDefault) return false;

  // ── Modify SSVCoreTypes.sol with the new constant value ──
  const source = fs.readFileSync(CORE_TYPES_PATH, 'utf8');
  const feeRegex = /uint256 constant DEFAULT_OPERATOR_ETH_FEE = \d[_\d]*;/;
  if (!feeRegex.test(source)) {
    throw new Error('[changeDefaultOperatorEthFee] cannot find DEFAULT_OPERATOR_ETH_FEE in SSVCoreTypes.sol');
  }
  const newSource = source.replace(feeRegex, `uint256 constant DEFAULT_OPERATOR_ETH_FEE = ${newFee.toString()};`);
  fs.writeFileSync(CORE_TYPES_PATH, newSource, 'utf8');

  // ── Recompile contracts ──
  try {
    execSync('npx hardhat compile --force', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      timeout: 600_000, // 10 minutes
    });
  } catch (err) {
    fs.writeFileSync(CORE_TYPES_PATH, source, 'utf8');
    throw new Error(`[changeDefaultOperatorEthFee] compile failed: ${String((err as any)?.message ?? err)}`);
  }

  // ── Deploy new SSVOperators and SSVViews ──
  const { deployContract, attachModule } = await import('../../scripts/common/helpers.ts');
  const cssvAddress = await setup.cssvToken.getAddress();
  const networkAddress = await network.getAddress();

  let newOpsAddr: string;
  let newViewsAddr: string;
  try {
    ({ address: newOpsAddr } = await deployContract(connection.ethers, 'SSVOperators', [0]));
    ({ address: newViewsAddr } = await deployContract(connection.ethers, 'SSVViews', [cssvAddress]));
  } finally {
    // Restore original source immediately after deploy so the working tree stays clean
    fs.writeFileSync(CORE_TYPES_PATH, source, 'utf8');
  }

  // ── Attach new modules to the proxy ──
  await attachModule(connection.ethers, networkAddress, 'SSVOperators', newOpsAddr);
  await attachModule(connection.ethers, networkAddress, 'SSVViews', newViewsAddr);

  // ── Advance sim state to current block, then apply fee change ──
  const block = BigInt(await provider.getBlockNumber());
  advanceAll(simState, block);

  const oldDefault = simState.defaultOperatorEthFee;
  simState.defaultOperatorEthFee = newFee;

  // Update all operators still using the default fee and track affected clusters
  const affectedOps: bigint[] = [];
  const affectedClusterIds = new Set<string>();

  for (const op of simState.operators.values()) {
    if (!op.useDefaultEthFee || op.isRemoved) continue;
    const oldFee = op.feeWei;
    op.feeWei = newFee;
    affectedOps.push(op.id);

    report.recordOperatorTx(op.owner, op.id, block, 'changeDefaultOperatorEthFee',
      { oldFee: oldFee.toString(), newFee: newFee.toString() }, 'ModuleUpgraded');

    // Update burn rate on every active ETH cluster that uses this operator
    for (const cluster of simState.clusters.values()) {
      if (!cluster.active || cluster.version !== VERSION_ETH) continue;
      if (!cluster.operatorIds.includes(op.id)) continue;
      cluster.burnRate = cluster.burnRate - oldFee + newFee;
      affectedClusterIds.add(cluster.id);
    }
  }

  // Record on each affected cluster's history
  for (const clusterId of affectedClusterIds) {
    const cluster = simState.clusters.get(clusterId)!;
    report.recordClusterTx(clusterId, cluster.owner, cluster.operatorIds, block,
      'changeDefaultOperatorEthFee',
      { oldDefault: oldDefault.toString(), newFee: newFee.toString(), burnRate: cluster.burnRate.toString() },
      'ModuleUpgraded');
  }

  report.record('changeDefaultOperatorEthFee', 0n, block);
  console.log(`  [action] changeDefaultOperatorEthFee: ${oldDefault} → ${newFee} | ops=${affectedOps.length} clusters=${affectedClusterIds.size} (block ${block})`);
  return true;
}

export interface WeightedAction {
  name:   string;
  weight: number;
  fn:     ActionFn;
}

export const ALL_ACTIONS: WeightedAction[] = [
  { name: 'registerOperator',              weight: 12, fn: actRegisterOperator },
  { name: 'removeOperator',               weight: 5, fn: actRemoveOperator },
  { name: 'declareOperatorFee',            weight: 6,  fn: actDeclareOperatorFee },
  { name: 'cancelOperatorFee',             weight: 3,  fn: actCancelOperatorFee },
  { name: 'executeOperatorFee',            weight: 5,  fn: actExecuteOperatorFee },
  { name: 'withdrawFromOperator',          weight: 6,  fn: actWithdrawFromOperator },
  { name: 'withdrawAllOperatorEarnings',    weight: 6,  fn: actWithdrawOperatorEarnings },
  { name: 'registerValidator',             weight: 18, fn: actRegisterValidator },
  { name: 'bulkRegisterValidator',         weight: 12, fn: actBulkRegisterValidator },
  { name: 'removeValidatorFromCluster',    weight: 8,  fn: actRemoveValidator },
  { name: 'bulkRemoveValidatorFromCluster',weight: 6,  fn: actBulkRemoveValidator },
  { name: 'depositToCluster',              weight: 12, fn: actDeposit },
  { name: 'clusterWithdraw',               weight: 8,  fn: actWithdraw },
  { name: 'liquidateCluster',              weight: 18, fn: actLiquidate },
  { name: 'reactivateCluster',             weight: 14, fn: actReactivate },
  { name: 'migrateClusterSSVtoETH',        weight: 8,  fn: actMigrateCluster },
  { name: 'updateNetworkFee',                    weight: 4,  fn: actUpdateNetworkFee },
  { name: 'updateLiquidationThresholdPeriod',    weight: 3,  fn: actUpdateLiquidationThresholdPeriod },
  { name: 'updateMinimumLiquidationCollateral',  weight: 3,  fn: actUpdateLiquidationCollateral },
  { name: 'commitEBRoot', weight: 9, fn: actCommitEBRoot },
  { name: 'stake',              weight: 10, fn: actStake },
  { name: 'requestUnstake',     weight: 8,  fn: actRequestUnstake },
  { name: 'withdrawUnlocked',   weight: 6,  fn: actWithdrawUnlocked },
  { name: 'transferCSSV',       weight: 7,  fn: actTransferCSSV },
  { name: 'claimEthRewards',    weight: 5,  fn: actClaimEthRewards },
  { name: 'changeDefaultOperatorEthFee', weight: 1, fn: actChangeDefaultOperatorEthFee },
];
