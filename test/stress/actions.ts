// All write action implementations for the stress test.
// Each action: advances all state to the TX block, calls the contract,
// parses the event, and updates simulation state.
// Returns true on success, false if the action was skipped.

import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { makeValKey, parseOperatorId, parsedToStruct, toClusterStruct, getSigner } from './setup.ts';
import type { ClusterRecord, OperatorRecord, SimState, StakerRecord } from './state.ts';
import { advanceAll, onSyncFees, onSettleUser, isLiquidatable, liquidationThreshold, burnPerBlock, VERSION_ETH, VERSION_SSV, DEFAULT_EB, BPS_DENOMINATOR } from './state.ts';
import { parseClusterFromEvent } from '../helpers/cluster.ts';
import { computeClusterId, generateMerkleForClusterEB, commitEBRoot } from '../helpers/oracle.ts';
import { Events } from '../common/events.ts';
import {
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
  STRESS_STAKER_START_IDX,
  STRESS_STAKER_COUNT,
  STRESS_COOLDOWN_SECS,
  _SL_CON_START,
  STRESS_STAKERS_CONTRACT,
  STRESS_TOTAL_SIGNERS,
} from './constants.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from '../common/constants.ts';
import type { RNG } from './random.ts';
import { pickFrom } from './random.ts';
import type { RunReport } from './report.ts';

export type ActionFn = (
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
) => Promise<boolean>;

// ─── Precision, runway & fee helpers ─────────────────────────────────────

const BLOCKS_PER_DAY = 7160n;

/**
 * Return a fee randomly drawn from [center*(1-dev%), center*(1+dev%)],
 * rounded to the nearest ETH_DEDUCTED_DIGITS precision unit.
 */
function randFee(rng: RNG, center: bigint, deviationBps: bigint): bigint {
  const rangeBps = 2n * deviationBps + 1n;
  const devBps   = rng.nextInt(rangeBps) - deviationBps;
  const raw      = center + (center * devBps) / 10_000n;
  return ((raw + ETH_DEDUCTED_DIGITS / 2n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

/** Round amount UP to nearest multiple of ETH_DEDUCTED_DIGITS (100_000 wei). */
function ceilPrecision(amount: bigint): bigint {
  if (amount === 0n) return 0n;
  return ((amount + ETH_DEDUCTED_DIGITS - 1n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

/**
 * Compute a runway-based ETH deposit amount.
 * bpb: total burn-per-block for the cluster after the operation (wei/block).
 * targetDays: desired runway in days.
 * floorAmount: hard minimum (e.g. liquidation threshold + buffer), rounded up automatically.
 */
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

/**
 * Compute the safe floor deposit for a new/reactivated cluster with the given bpb.
 * = max(blockThreshold, collateralFloor) × 1.2  (rounded up)
 */
function newClusterFloor(bpb: bigint, simState: SimState): bigint {
  const blockThreshold = simState.minimumBlocksBeforeLiquidation * bpb;
  const threshold = blockThreshold > simState.minimumLiquidationCollateral
    ? blockThreshold : simState.minimumLiquidationCollateral;
  return threshold + threshold / 5n; // 20% buffer
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function getOwnerSigner(setup: StressSetup, ownerAddress: string): any | undefined {
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

function gas(receipt: any): bigint {
  return BigInt(receipt.gasUsed ?? 0n);
}

// ─── Diagnostic helpers (print history before re-throwing unexpected TX failures) ──

function dumpClusterDiag(cluster: ClusterRecord, _simState: SimState, report: RunReport, actionName: string, err: any): void {
  report.printTimeline([cluster.id], cluster.operatorIds);
  console.error(`\n[TX FAIL] ${actionName} — ${String((err as any)?.message ?? err)}`);
}

function dumpOperatorDiag(op: OperatorRecord, _simState: SimState, report: RunReport, actionName: string, err: any): void {
  report.printTimeline([], [op.id]);
  console.error(`\n[TX FAIL] ${actionName} — ${String((err as any)?.message ?? err)}`);
}

function dumpOpSetDiag(opSet: bigint[], existingCluster: ClusterRecord | undefined, report: RunReport, actionName: string, err: any): void {
  report.printTimeline(existingCluster ? [existingCluster.id] : [], opSet);
  console.error(`\n[TX FAIL] ${actionName} — ${String((err as any)?.message ?? err)}`);
}

/**
 * Minimum ETH deposit required to add `addedValidators` to an existing ETH cluster
 * without triggering InsufficientBalance. Returns 0n if the current balance already covers
 * the new threshold. Includes a 20% buffer for fee accrual between estimate and TX block.
 */
function depositForAddedValidators(
  cluster: ClusterRecord,
  addedValidators: bigint,
  simState: SimState,
): bigint {
  const newEB = cluster.effectiveBalance + addedValidators * DEFAULT_EB;
  const newBpb = cluster.burnRate * newEB / DEFAULT_EB;
  const blockThreshold = simState.minimumBlocksBeforeLiquidation * newBpb;
  const newThreshold = blockThreshold > simState.minimumLiquidationCollateral
    ? blockThreshold : simState.minimumLiquidationCollateral;
  const needed = newThreshold + newThreshold / 5n; // 20% buffer
  return needed > cluster.balance ? needed - cluster.balance : 0n;
}

/**
 * Parse the LAST matching event's cluster tuple from a receipt.
 * Bulk operations emit one event per validator; the last event carries the final cluster state.
 */
function parseLastClusterFromReceipt(contract: any, receipt: any, eventName: string): any {
  let last: any = null;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        const clusterTuple = parsed.args[parsed.args.length - 1];
        const [validatorCount, networkFeeIndex, index, active, balance] = clusterTuple;
        last = {
          validatorCount: BigInt(validatorCount),
          networkFeeIndex: BigInt(networkFeeIndex),
          index: BigInt(index),
          active: Boolean(active),
          balance: BigInt(balance),
        };
      }
    } catch { /* skip non-matching */ }
  }
  if (!last) throw new Error(`Event ${eventName} not found in receipt`);
  return last;
}

// ─── Action: registerOperator ────────────────────────────────────────────

export async function actRegisterOperator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;

  // Pick a signer that doesn't already own an operator
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

// ─── Action: registerValidator ───────────────────────────────────────────

export async function actRegisterValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;
  // Exclude clusters that ever contained a removed operator — registerValidator reverts on-chain
  // (contract's updateClusterOperatorsOnRegistration calls ensureOperatorExist which reverts).
  const activeClusters = getActiveClusters(setup).filter(c =>
    c.version === VERSION_ETH && c.canRegister,
  );

  // Either add to an existing cluster or create a new one (50/50)
  const createNew = activeClusters.length === 0 || rng.nextInt(2n) === 0n;

  if (createNew) {
    // Pick owner first, then build eligible operator pool (excluding private ops the owner can't use)
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

    // Only pick sizes achievable without wrapping (which causes duplicates and invalid set sizes)
    const achievableSizes = VALID_OP_SET_SIZES.filter(s => s <= eligibleOpIds.length);
    if (achievableSizes.length === 0) return false;
    const opSetSize = achievableSizes[Number(rng.nextInt(BigInt(achievableSizes.length)))];
    const startIdx = Number(rng.nextInt(BigInt(eligibleOpIds.length - opSetSize + 1)));
    const opSet = eligibleOpIds.slice(startIdx, startIdx + opSetSize);
    if (opSet.length !== opSetSize) return false;

    const valKey = makeValKey(simState.nextValidatorSeed++);
    const existingCluster = simState.clusters.get(computeClusterId(ownerSigner.address, opSet));
    // Only add to ETH clusters; SSV clusters require the legacy path
    if (existingCluster && existingCluster.version === VERSION_SSV) return false;
    const clusterStruct = existingCluster ? toClusterStruct(existingCluster) : EMPTY_CLUSTER;

    // Compute deposit from runway target:
    //   new cluster  → pick 60-180 days, deposit = targetDays * bpb, floored above threshold
    //   add to exist → pick 35-120 days, deposit = max(runway delta, min-safe)
    let deposit: bigint;
    if (existingCluster) {
      const newEB = existingCluster.effectiveBalance + DEFAULT_EB;
      const newBpb = existingCluster.burnRate * newEB / DEFAULT_EB;
      const targetDays = 35n + rng.nextInt(86n); // 35–120 days
      const targetBalance = ceilPrecision(targetDays * BLOCKS_PER_DAY * newBpb);
      const minSafe = depositForAddedValidators(existingCluster, 1n, simState);
      const needed = targetBalance > existingCluster.balance ? targetBalance - existingCluster.balance : 0n;
      deposit = ceilPrecision(needed > minSafe ? needed : minSafe);
    } else {
      let newBurnRate = simState.network.feeWei;
      for (const opId of opSet) newBurnRate += simState.operators.get(opId)!.feeWei;
      const newBpb = newBurnRate; // 1 validator = 32 ETH → burnRate * 32 / 32 = burnRate
      const targetDays = 60n + rng.nextInt(121n); // 60–180 days
      deposit = runwayDeposit(newBpb, targetDays, simState, newClusterFloor(newBpb, simState));
    }

    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).registerValidator(
        valKey, opSet, DEFAULT_SHARES, clusterStruct,
        { value: deposit },
      );
      receipt = await tx.wait();
    } catch (err) {
      dumpOpSetDiag(opSet, existingCluster, report, 'registerValidator (new cluster)', err);
      throw err;
    }
    const txBlock = BigInt(receipt.blockNumber);

    advanceAll(simState, txBlock);

    const parsed = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(ownerSigner.address, opSet);

    if (existingCluster) {
      // Adding to existing cluster: +32 ETH effective balance.
      // After advanceAll(txBlock), balance has fees deducted; deposit is added on top.
      const expectedBalance = existingCluster.balance + deposit;
      assert.equal(BigInt(parsed.balance), expectedBalance, `registerValidator(new→existing): cluster balance`);
      assert.equal(BigInt(parsed.validatorCount), existingCluster.validatorCount + 1n, `registerValidator(new→existing): validatorCount`);
      existingCluster.validatorCount += 1n;
      existingCluster.effectiveBalance += DEFAULT_EB;
      existingCluster.balance = expectedBalance;
      existingCluster.lastStruct = parsedToStruct(parsed);
      existingCluster.validators.add(valKey);
    } else {
      // New cluster: no previous fees, balance equals the deposit exactly.
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

    // Update operators and network with ETH effective balance
    for (const opId of opSet) {
      const op = simState.operators.get(opId)!;
      op.effectiveBalance += DEFAULT_EB;
    }
    simState.network.totalEffectiveBalance += DEFAULT_EB;

    report.record('registerValidator', gas(receipt), txBlock);
    report.recordClusterTx(clusterId, ownerSigner.address, opSet, txBlock,
      'registerValidator', { validators: '1', eb: `+${DEFAULT_EB} ETH`, version: 'ETH' }, 'ValidatorAdded');
    return true;
  } else {
    // Add to an existing cluster
    const cluster = pickFrom(rng, activeClusters);
    if (!cluster) return false;

    const ownerSigner = getOwnerSigner(setup, cluster.owner);
    if (!ownerSigner) return false;

    const valKey = makeValKey(simState.nextValidatorSeed++);

    const newEB1 = cluster.effectiveBalance + DEFAULT_EB;
    const newBpb1 = cluster.burnRate * newEB1 / DEFAULT_EB;
    const targetDays1 = 35n + rng.nextInt(86n); // 35–120 days
    const targetBalance1 = ceilPrecision(targetDays1 * BLOCKS_PER_DAY * newBpb1);
    const minSafe1 = depositForAddedValidators(cluster, 1n, simState);
    const needed1 = targetBalance1 > cluster.balance ? targetBalance1 - cluster.balance : 0n;
    const deposit1 = ceilPrecision(needed1 > minSafe1 ? needed1 : minSafe1);

    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).registerValidator(
        valKey, cluster.operatorIds, DEFAULT_SHARES, toClusterStruct(cluster), { value: deposit1 },
      );
      receipt = await tx.wait();
    } catch (err) {
      dumpClusterDiag(cluster, simState, report, 'registerValidator (add to cluster)', err);
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
      op.effectiveBalance += DEFAULT_EB;
    }
    simState.network.totalEffectiveBalance += DEFAULT_EB;

    report.record('registerValidator', gas(receipt), txBlock);
    report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
      'registerValidator', { validators: '1', eb: `+${DEFAULT_EB} ETH` }, 'ValidatorAdded');
    return true;
  }
}

// ─── Action: removeValidator ─────────────────────────────────────────────

export async function actRemoveValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Pick an active ETH cluster with at least 2 validators (keep 1 to stay active)
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
    dumpClusterDiag(cluster, simState, report, 'removeValidator (from cluster)', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.VALIDATOR_REMOVED);
  // Remove does not change balance — advanceAll already deducted fees to txBlock.
  assert.equal(BigInt(parsed.balance), cluster.balance, `removeValidator: balance`);
  assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount - 1n, `removeValidator: validatorCount`);
  cluster.validatorCount -= 1n;
  cluster.effectiveBalance = cluster.effectiveBalance >= DEFAULT_EB ? cluster.effectiveBalance - DEFAULT_EB : 0n;
  cluster.lastStruct = parsedToStruct(parsed);
  cluster.validators.delete(valKey);

  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && op.effectiveBalance >= DEFAULT_EB) op.effectiveBalance -= DEFAULT_EB;
  }
  if (simState.network.totalEffectiveBalance >= DEFAULT_EB) {
    simState.network.totalEffectiveBalance -= DEFAULT_EB;
  }

  report.record('removeValidator', gas(receipt), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'removeValidator', { validators: '1', eb: `-${DEFAULT_EB} ETH` }, 'ValidatorRemoved');
  return true;
}

// ─── Action: deposit ─────────────────────────────────────────────────────

export async function actDeposit(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  // ETH-denominated deposit only for ETH clusters
  const activeClusters = getActiveClusters(setup).filter(c => c.version === VERSION_ETH);
  const cluster = pickFrom(rng, activeClusters);
  if (!cluster) return false;

  const threshold = liquidationThreshold(cluster, simState);
  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  // Runway-based deposit: target x–y days of runway.
  // If the cluster already has more than the target, add just 1 day (keep exercising the deposit path).
  const bpb = burnPerBlock(cluster);
  const xDays = 35n + rng.nextInt(26n);           // 35–60 days (above ~30-day threshold)
  const yDays = xDays + 10n + rng.nextInt(41n);   // x+10 to x+50 extra days
  const targetDays = xDays + rng.nextInt(yDays - xDays + 1n);
  const targetBalance = bpb > 0n ? ceilPrecision(targetDays * BLOCKS_PER_DAY * bpb) : threshold * 2n;
  let amount: bigint;
  if (cluster.balance >= targetBalance) {
    // Already well-funded: add ~1 day to keep exercising the deposit path.
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
    dumpClusterDiag(cluster, simState, report, 'depositToCluster', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_DEPOSITED);
  // deposit() does NOT settle fees — the contract stores (prevStoredBalance + amount) without
  // deducting any accrued fees. The event's cluster.balance therefore equals the raw stored value
  // (which is HIGHER than the true current balance by the fees accrued since the last settlement TX).
  // Our sim's cluster.balance has already had those fees deducted by advanceAll, so the correct
  // update is simply += amount. See test/regression/regression4.test.ts for the full proof.
  cluster.balance += amount;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('deposit', gas(receipt), txBlock);
  report.totalEthDepositedWei += amount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'deposit', { amount: (Number(amount) / 1e18).toFixed(6) + ' ETH' }, 'ClusterDeposited');
  return true;
}

// ─── Action: withdraw ────────────────────────────────────────────────────

export async function actWithdraw(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, provider } = setup;

  // Only ETH clusters with enough balance to withdraw anything (must be above threshold)
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
  // Subtract a small fee buffer before computing any withdrawal amount.
  // The TX mines at currentBlock+1 and handleLiquidatableClusters may have mined
  // several extra blocks since the last advanceAll — use 20 blocks as a safe margin.
  const feeBuffer = bpbForBuffer * 20n;
  const safeBalance = cluster.balance > feeBuffer ? cluster.balance - feeBuffer : 0n;
  // safeMax: max withdrawal that keeps balance at or above threshold
  const safeMax = safeBalance > threshold ? safeBalance - threshold : 0n;
  if (safeMax === 0n) return false;

  // ── 7% of the time: drain close to threshold, mine a few blocks, then liquidate ──
  // The contract rejects any withdrawal that would leave balance < liquidation threshold,
  // so we withdraw to (threshold + N blocks of fees), then mine N+1 blocks to push it under.
  if (rng.nextInt(100n) < 7n) {
    const bpb = bpbForBuffer;
    if (bpb === 0n) {
      // No burn rate — can't make this cluster liquidatable this way, skip drain
    } else {
      // Pick N = 1..10 blocks of runway above threshold, then mine N+21 to cross it.
      // safeBalance already discounts 20 blocks of fees, so leaveAmount uses only extraBlocks.
      // After withdraw the cluster has ~T + (X+19)*bpb remaining; mining X+21 puts it at T-2*bpb < T.
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
          dumpClusterDiag(cluster, simState, report, 'clusterWithdraw (drain→liquidate)', err);
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

        // Mine extraBlocks+21 blocks so fees push balance below threshold, then liquidate.
        // (+20 to drain the feeBuffer that was left in leaveAmount; +1 to cross the threshold.)
        const drainBlocks = extraBlocks + 21n;
        await provider.send('hardhat_mine', ['0x' + drainBlocks.toString(16)]);
        await provider.send('evm_increaseTime', [Number(drainBlocks) * 12]);
        await liquidateClusterDirectly(cluster, setup, report);
        return true;
      }
    }
    // Fall through to normal withdraw if drain conditions aren't met
  }

  // ── Normal path: withdraw down to a runway target ──
  // Pick how many days of runway to leave behind (10–60 days).
  // If the target balance would be below threshold, floor at threshold (contract enforces this).
  // Use safeBalance (feeBuffer already subtracted) so we never overshoot after fee accrual.
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
    dumpClusterDiag(cluster, simState, report, 'clusterWithdraw', err);
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

// ─── Action: liquidate ───────────────────────────────────────────────────

export async function actLiquidate(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const liquidatable = getActiveClusters(setup).filter(c => isLiquidatable(c, simState));
  const cluster = pickFrom(rng, liquidatable);
  if (!cluster) return false;

  let receipt: any;
  try {
    const clusterStruct = toClusterStruct(cluster);
    const tx = cluster.version === VERSION_SSV
      ? await network.connect(setup.liquidator).liquidateSSV(cluster.owner, cluster.operatorIds, clusterStruct)
      : await network.connect(setup.liquidator).liquidate(cluster.owner, cluster.operatorIds, clusterStruct);
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'liquidateCluster', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  const ageBlocks = txBlock - cluster.createdBlock;
  advanceAll(simState, txBlock);

  // Classify liquidation type before zeroing the balance
  const liqBpb = burnPerBlock(cluster);
  const liqMinCollateral = cluster.version === VERSION_ETH
    ? simState.minimumLiquidationCollateral
    : simState.minimumLiquidationCollateralSSV;
  const balAtLiq = cluster.version === VERSION_ETH ? cluster.balance : cluster.ssvBalance;
  // Collateral liquidation: cluster's balance at liquidation is below the collateral floor
  const isCollateral = balAtLiq < liqMinCollateral;
  const liqMeasure = isCollateral ? balAtLiq : (liqBpb > 0n ? balAtLiq / liqBpb : 0n);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);

  // Track SSV clusters liquidated before they could be migrated
  if (cluster.version === VERSION_SSV) report.ssvClustersLiquidatedBeforeMigration++;

  // Update operators and network counts AFTER advance
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
    // Contract zeroes the balance on liquidation — assert then zero our side.
    assert.equal(BigInt(parsed.balance), 0n, `liquidate: cluster balance must be 0`);
    cluster.balance = 0n;
    cluster.burnRate = 0n;
  }

  cluster.active = false;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('liquidate', gas(receipt), txBlock);
  report.recordLiquidation(ageBlocks);
  report.recordLiquidationTyped(isCollateral, liqMeasure);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'liquidate', { age: ageBlocks.toString() + ' blocks', validators: cluster.validatorCount.toString(), ...(liqEB > 0n ? { eb: `-${liqEB} ETH` } : {}), type: isCollateral ? 'collateral' : 'runway' }, 'ClusterLiquidated');
  return true;
}

// ─── Action: reactivate ──────────────────────────────────────────────────

export async function actReactivate(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Only reactivate ETH clusters whose operators are all still live.
  // Reactivate any inactive ETH cluster — clusters with removed operators are allowed.
  // updateClusterOperatorsOnReactivation skips operators whose ethSnapshot.block == 0
  // (zeroed by _resetOperatorState), so removed operators contribute 0 fee/index.
  const inactive = getInactiveClusters(setup).filter(c => c.version === VERSION_ETH);
  const cluster = pickFrom(rng, inactive);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  // Runway-based deposit: cluster is at 0 balance (post-liquidation), so full deposit needed.
  // Compute CURRENT burnRate from live operator fees — cluster.burnRate is stale for inactive
  // clusters because actExecuteOperatorFee only updates active clusters.
  let currentBurnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) currentBurnRate += simState.operators.get(opId)!.feeWei;
  // effectiveBalance persists through liquidation — use it for deposit sizing and restore.
  const reactivateBpb = currentBurnRate * cluster.effectiveBalance / DEFAULT_EB;
  const reactivateTargetDays = 60n + rng.nextInt(121n); // 60–180 days
  const depositAmount = runwayDeposit(reactivateBpb, reactivateTargetDays, simState, newClusterFloor(reactivateBpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).reactivate(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'reactivateCluster', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_REACTIVATED);
  // Cluster was inactive (balance=0); reactivation balance equals the deposit.
  assert.equal(BigInt(parsed.balance), depositAmount, `reactivate: cluster balance`);
  cluster.active = true;
  cluster.block = txBlock;   // was inactive during advanceAll, must set explicitly
  cluster.balance = depositAmount;
  cluster.burnRate = currentBurnRate; // update to current fees (was stale while inactive)
  cluster.lastStruct = parsedToStruct(parsed);

  // Restore ETH effective balance tracking — skip removed operators (contract skips them too:
  // updateClusterOperatorsOnReactivation only increments ethValidatorCount when ethSnapshot.block != 0).
  const restoredEB = cluster.effectiveBalance;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && !op.isRemoved) op.effectiveBalance += restoredEB;
  }
  simState.network.totalEffectiveBalance += restoredEB;

  report.record('reactivate', gas(receipt), txBlock);
  report.recordReactivation();
  report.totalEthDepositedWei += depositAmount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'reactivate', { deposit: (Number(depositAmount) / 1e18).toFixed(6) + ' ETH', eb: `+${restoredEB} ETH` }, 'ClusterReactivated');
  return true;
}

// ─── Action: withdrawOperatorEarnings ────────────────────────────────────

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

  // Withdraw ETH earnings
  if (op.balance > 0n || op.effectiveBalance > 0n) {
    let receipt: any;
    try {
      const tx = await network.connect(ownerSigner).withdrawAllOperatorEarnings(op.id);
      receipt = await tx.wait();
    } catch (err) {
      dumpOperatorDiag(op, simState, report, 'withdrawOperatorEarnings (ETH)', err);
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

  // Also drain SSV earnings for pre-migration operators
  if (op.ssvFeeWei > 0n && (op.ssvBalance > 0n || op.ssvValidatorCount > 0n)) {
    let receipt2: any;
    try {
      const tx2 = await network.connect(ownerSigner).withdrawAllOperatorEarningsSSV(op.id);
      receipt2 = await tx2.wait();
    } catch (err) {
      dumpOperatorDiag(op, simState, report, 'withdrawOperatorEarnings (SSV token)', err);
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

// Validator count for bulk operations keyed by operator-set size.
// 4 ops → 80 validators, 7 ops → 45, 10 ops → 30, 13 ops → 20.
const BULK_VALIDATOR_COUNT: Record<number, number> = { 4: 80, 7: 45, 10: 30, 13: 20 };

// ─── Action: bulkRegisterValidator ───────────────────────────────────────

export async function actBulkRegisterValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Either add to existing ETH cluster or create a new one (50/50).
  // opSet is determined first so we can derive n from its size.
  // Exclude clusters that ever contained a removed operator — registering to those would revert on-chain.
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
    // Pick owner first, then build eligible operator pool (excluding private ops the owner can't use)
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

  // Derive validator count from operator-set size (opSet is now known)
  const n = BULK_VALIDATOR_COUNT[opSet.length] ?? 20;
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(makeValKey(simState.nextValidatorSeed++));
  const shares = keys.map(() => DEFAULT_SHARES);

  if (cluster && cluster.version === VERSION_ETH) {
    const newEB = cluster.effectiveBalance + BigInt(n) * DEFAULT_EB;
    const newBpb = cluster.burnRate * newEB / DEFAULT_EB;
    const tDays = 35n + rng.nextInt(86n); // 35–120 days
    const targetBal = ceilPrecision(tDays * BLOCKS_PER_DAY * newBpb);
    const minSafe = depositForAddedValidators(cluster, BigInt(n), simState);
    const needed = targetBal > cluster.balance ? targetBal - cluster.balance : 0n;
    depositValue = ceilPrecision(needed > minSafe ? needed : minSafe);
  } else {
    // New cluster
    let newBurnRate = simState.network.feeWei;
    for (const opId of opSet) newBurnRate += simState.operators.get(opId)!.feeWei;
    const newBpb = newBurnRate * BigInt(n); // n validators * BPS_DENOMINATOR / BPS_DENOMINATOR = n
    const tDays = 60n + rng.nextInt(121n); // 60–180 days
    depositValue = runwayDeposit(newBpb, tDays, simState, newClusterFloor(newBpb, simState));
  }

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).bulkRegisterValidator(
      keys, opSet, shares, clusterStruct, { value: depositValue },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpOpSetDiag(opSet, cluster, report, 'bulkRegisterValidator (to cluster)', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseLastClusterFromReceipt(network, receipt, Events.VALIDATOR_ADDED);
  const clusterId = computeClusterId(ownerSigner.address, opSet);
  const addedEB = BigInt(n) * DEFAULT_EB;

  if (cluster && cluster.version === VERSION_ETH) {
    // Adding to existing ETH cluster: fees deducted by advanceAll, deposit added on top.
    const expectedBulkBalance = cluster.balance + depositValue;
    assert.equal(BigInt(parsed.balance), expectedBulkBalance, `bulkRegisterValidator(existing): balance`);
    assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount + BigInt(n), `bulkRegisterValidator(existing): validatorCount`);
    cluster.validatorCount += BigInt(n);
    cluster.effectiveBalance += addedEB;
    cluster.balance = expectedBulkBalance;
    cluster.lastStruct = parsedToStruct(parsed);
    for (const key of keys) cluster.validators.add(key);
  } else {
    // New cluster: no previous fees, balance equals the deposit exactly.
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
    simState.operators.get(opId)!.effectiveBalance += addedEB;
  }
  simState.network.totalEffectiveBalance += addedEB;

  report.record(`bulkRegisterValidator(${opSet.length})`, gas(receipt), txBlock);
  report.recordClusterTx(clusterId, ownerSigner.address, opSet, txBlock,
    'bulkRegisterValidator', { validators: n.toString(), eb: `+${addedEB} ETH`, version: 'ETH' }, 'ValidatorAdded');
  return true;
}

// ─── Action: bulkRemoveValidator ─────────────────────────────────────────

export async function actBulkRemoveValidator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Need an active ETH cluster with at least 2 validators (remove target count, keep at least 1)
  const eligible = getActiveClusters(setup).filter(
    c => c.version === VERSION_ETH && c.validators.size >= 2,
  );
  const cluster = pickFrom(rng, eligible);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  // Remove exactly the target count for this operator-set size, capped at validators.size - 1
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
    dumpClusterDiag(cluster, simState, report, 'bulkRemoveValidator (from cluster)', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseLastClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);
  const removedEB    = BigInt(n) * DEFAULT_EB;

  // Bulk remove does not change balance — advanceAll deducted fees to txBlock.
  assert.equal(BigInt(parsed.balance), cluster.balance, `bulkRemoveValidator: balance`);
  assert.equal(BigInt(parsed.validatorCount), cluster.validatorCount - BigInt(n), `bulkRemoveValidator: validatorCount`);
  cluster.validatorCount -= BigInt(n);
  cluster.effectiveBalance = cluster.effectiveBalance >= removedEB ? cluster.effectiveBalance - removedEB : 0n;
  cluster.lastStruct = parsedToStruct(parsed);
  for (const key of keysToRemove) cluster.validators.delete(key);

  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && op.effectiveBalance >= removedEB) op.effectiveBalance -= removedEB;
  }
  if (simState.network.totalEffectiveBalance >= removedEB) {
    simState.network.totalEffectiveBalance -= removedEB;
  }

  report.record('bulkRemoveValidator', gas(receipt), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'bulkRemoveValidator', { validators: n.toString(), eb: `-${removedEB} ETH` }, 'ValidatorRemoved');
  return true;
}

// ─── Action: migrateCluster ──────────────────────────────────────────────

export async function actMigrateCluster(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Pick any SSV cluster (active or liquidated-inactive) to migrate.
  // The contract handles both: isLiquidated=true skips SSV DAO decrement for inactive clusters.
  // Clusters with removed operators are allowed — migrateClusterToETH accepts them.
  const ssvClusters = [...simState.clusters.values()].filter(
    c => c.version === VERSION_SSV && c.validatorCount > 0n,
  );
  const cluster = pickFrom(rng, ssvClusters);
  if (!cluster) return false;

  const ownerSigner = getOwnerSigner(setup, cluster.owner);
  if (!ownerSigner) return false;

  // Runway-based deposit: compute the ETH burnRate the cluster will have after migration.
  const migrateEB = cluster.validatorCount * DEFAULT_EB;
  let migrateBurnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) migrateBurnRate += simState.operators.get(opId)!.feeWei;
  const migrateBpb = migrateBurnRate * migrateEB / DEFAULT_EB;
  const migrateTargetDays = 60n + rng.nextInt(121n); // 60–180 days
  const depositAmount = runwayDeposit(migrateBpb, migrateTargetDays, simState, newClusterFloor(migrateBpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).migrateClusterToETH(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'migrateCluster (SSV→ETH)', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
  // Migration balance equals the ETH deposit (fresh ETH cluster, no prior fees).
  assert.equal(BigInt(parsed.balance), depositAmount, `migrateCluster: balance`);
  const validatorsCount = cluster.validatorCount;
  const wasLiquidated = !cluster.active; // SSV counts already removed at liquidation time

  // ETH burnRate: sum(op.feeWei) + networkFeeWei
  // Pre-upgrade operators store DEFAULT_OPERATOR_ETH_FEE in op.feeWei
  let burnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) {
    burnRate += simState.operators.get(opId)!.feeWei;
  }

  // Move validators from SSV tracking to ETH tracking on operators.
  // For liquidated clusters, SSV counts were already decremented at liquidation — skip.
  const migratedEB = validatorsCount * DEFAULT_EB;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op) {
      if (!wasLiquidated && op.ssvValidatorCount >= validatorsCount) op.ssvValidatorCount -= validatorsCount;
      op.effectiveBalance += migratedEB;
    }
  }
  if (!wasLiquidated && simState.network.totalSSVValidators >= validatorsCount) {
    simState.network.totalSSVValidators -= validatorsCount;
  }
  simState.network.totalEffectiveBalance += migratedEB;

  // Convert cluster to ETH version (active: true set by contract regardless of prior state)
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
  report.record('migrateCluster', gas(receipt), txBlock);
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'migrateCluster', { deposit: (Number(depositAmount) / 1e18).toFixed(6) + ' ETH', eb: `+${migratedEB} ETH`, ...(wasLiquidated ? { note: 'from-liquidated' } : {}) }, 'ClusterMigratedToETH');
  return true;
}

// ─── Action: declareOperatorFee ───────────────────────────────────────────

export async function actDeclareOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Any active operator (pre- or post-upgrade) with no pending declaration.
  // Pre-upgrade operators use DEFAULT_OPERATOR_ETH_FEE as their current ETH fee baseline
  // (the contract initialises it via ensureETHDefaults on first declareOperatorFee call).
  const eligible = getActiveOperators(setup).filter(
    op => op.pendingFeeWei === 0n,
  );
  const op = pickFrom(rng, eligible);
  if (!op) return false;

  const ownerSigner = getOwnerSigner(setup, op.owner);
  if (!ownerSigner) return false;

  // Pick a new fee: ±20% of current, clamped to minimum, divisible by ETH_DEDUCTED_DIGITS
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
    dumpOperatorDiag(op, simState, report, 'declareOperatorFee (ETH)', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  const declareBlock = await setup.provider.getBlock(receipt.blockNumber);
  const declareTimestamp = BigInt(declareBlock.timestamp);

  advanceAll(simState, txBlock);
  op.pendingFeeWei = newFee;
  op.pendingFeeBlock = txBlock;
  op.pendingFeeApprovalBeginTime = declareTimestamp + STRESS_FEE_PERIOD_SECS;
  op.pendingFeeApprovalEndTime   = declareTimestamp + STRESS_FEE_PERIOD_SECS + STRESS_FEE_PERIOD_SECS;

  report.record('declareOperatorFee', gas(receipt), txBlock);
  report.recordOperatorTx(op.owner, op.id, txBlock, 'declareOperatorFee',
    { from: (Number(op.feeWei) / 1e9).toFixed(2) + ' gwei', to: (Number(newFee) / 1e9).toFixed(2) + ' gwei' }, 'OperatorFeeDeclared');
  return true;
}

// ─── Action: executeOperatorFee ───────────────────────────────────────────

export async function actExecuteOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Only pick operators whose execute window is currently open.
  // We check the current block timestamp against the stored approval window.
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
    // The execute window may have closed between our timestamp check and the TX landing.
    // ApprovalNotWithinTimeframe means we were too early or too late — that's fine, skip.
    // Any other error is unexpected and should propagate.
    const msg = String((err as any)?.message ?? err);
    if (!msg.includes('ApprovalNotWithinTimeframe')) {
      dumpOperatorDiag(op, simState, report, 'executeOperatorFee', err);
      throw err;
    }
    return false;
  }

  const txBlock = BigInt(execReceipt.blockNumber);
  advanceAll(simState, txBlock);

  const oldFee = op.feeWei;
  op.feeWei = op.pendingFeeWei;
  op.pendingFeeWei = 0n;
  op.pendingFeeBlock = 0n;
  op.pendingFeeApprovalBeginTime = 0n;
  op.pendingFeeApprovalEndTime   = 0n;

  // Update burnRate for all active ETH clusters using this operator.
  // advanceAll already charged fees at the old rate up to txBlock; from here the new rate applies.
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

// ─── Action: removeOperator ──────────────────────────────────────────────

export async function actRemoveOperator(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // 95% of the time: remove an operator that is currently serving clusters (has active validators).
  // 5% of the time: remove an idle operator (no validators, cleanup / edge-case coverage).
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
    dumpOperatorDiag(op, simState, report, 'removeOperator', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  // Earnings are transferred back to owner by the contract; zero them in sim state
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

  // Update burn rates and collect all affected clusters (both versions, active or not) for history.
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

  // All clusters that ever contained this operator can no longer register new validators.
  // (contract's updateClusterOperatorsOnRegistration calls ensureOperatorExist which reverts
  // for removed operators). Mark them so actRegisterValidator / actBulkRegisterValidator skip them.
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

  // Record in every cluster that ever had this operator (ETH and SSV)
  for (const cluster of affectedClusters) {
    const adj: Record<string, string> = { opId: op.id.toString() };
    if (cluster.version === VERSION_ETH) adj['burnRateAdj'] = `-${(Number(oldFee) / 1e9).toFixed(2)} gwei`;
    else adj['version'] = 'SSV';
    report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
      'removeOperator', adj, 'OperatorRemoved');
  }

  return true;
}

// ─── Action: cancelOperatorFee ────────────────────────────────────────────

export async function actCancelOperatorFee(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  const latestBlockForCancel = await setup.provider.getBlock('latest');
  const nowForCancel = BigInt(latestBlockForCancel.timestamp);

  // Prefer cancelling expired declarations (past execute window) so operators
  // can declare again; fall back to any pending declaration.
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
    dumpOperatorDiag(op, simState, report, 'cancelOperatorFee', err);
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

// ─── Action: withdrawFromOperator (partial) ──────────────────────────────

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

  // Withdraw 20–80% of current balance, floored to ETH_DEDUCTED_DIGITS precision
  const pct = 20n + rng.nextInt(61n); // 20..80
  const raw = (op.balance * pct) / 100n;
  const amount = (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
  if (amount === 0n) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).withdrawOperatorEarnings(op.id, amount);
    receipt = await tx.wait();
  } catch (err) {
    dumpOperatorDiag(op, simState, report, 'withdrawFromOperator', err);
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

// ─── Direct helpers (non-random, for post-mine remediation) ─────────────

/**
 * Liquidate a specific cluster directly (no RNG — used by post-mine handler).
 * Mirrors actLiquidate but accepts the target cluster explicitly.
 */
export async function liquidateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  let receipt: any;
  try {
    // VERSION_SSV clusters use liquidateSSV; VERSION_ETH clusters use liquidate.
    const clusterStruct = toClusterStruct(cluster);
    const tx = cluster.version === VERSION_SSV
      ? await network.connect(setup.liquidator).liquidateSSV(cluster.owner, cluster.operatorIds, clusterStruct)
      : await network.connect(setup.liquidator).liquidate(cluster.owner, cluster.operatorIds, clusterStruct);
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'liquidateClusterDirectly', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  const ageBlocks = txBlock - cluster.createdBlock;
  advanceAll(simState, txBlock);

  // Classify liquidation type before zeroing balance
  const liqBpb = burnPerBlock(cluster);
  const liqMinCollateral = cluster.version === VERSION_ETH
    ? simState.minimumLiquidationCollateral
    : simState.minimumLiquidationCollateralSSV;
  const balAtLiq = cluster.version === VERSION_ETH ? cluster.balance : cluster.ssvBalance;
  // Collateral liquidation: cluster's balance at liquidation is below the collateral floor
  const isCollateral = balAtLiq < liqMinCollateral;
  const liqMeasure = isCollateral ? balAtLiq : (liqBpb > 0n ? balAtLiq / liqBpb : 0n);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);

  // Track SSV clusters liquidated before they could be migrated
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

/**
 * Deposit a specific amount into an ETH cluster directly (no RNG — used by post-mine handler).
 * Mirrors actDeposit but accepts the target cluster and amount explicitly.
 */
export async function depositToClusterDirectly(
  cluster: ClusterRecord,
  amount: bigint,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = setup.allSigners.find((s: any) =>
    s.address.toLowerCase() === cluster.owner.toLowerCase(),
  );
  if (!ownerSigner) return false;

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).deposit(
      cluster.owner, cluster.operatorIds, toClusterStruct(cluster), { value: amount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'depositToClusterDirectly', err);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);

  advanceAll(simState, txBlock);

  const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_DEPOSITED);
  // Same as actDeposit: deposit() stores (prevStoredBalance + amount) without settling fees.
  // See actDeposit comment above and test/regression/regression4.test.ts.
  cluster.balance += amount;
  cluster.lastStruct = parsedToStruct(parsed);

  report.record('deposit', BigInt(receipt.gasUsed ?? 0n), txBlock);
  report.totalEthDepositedWei += amount;
  report.recordClusterTx(cluster.id, cluster.owner, cluster.operatorIds, txBlock,
    'deposit', { amount: (Number(amount) / 1e18).toFixed(6) + ' ETH', note: 'post-mine rescue' }, 'ClusterDeposited');
  return true;
}

/**
 * Migrate a specific SSV cluster to ETH directly (used for one-shot tests).
 * Mirrors actMigrateCluster but accepts the target cluster explicitly.
 * Intentionally allows clusters with removed operators — the contract's
 * updateClusterOperatorsMigration skips removed operators (both snapshots zeroed)
 * rather than reverting, so migration succeeds with 0 fee contribution from them.
 */
export async function migrateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = setup.allSigners.find((s: any) =>
    s.address.toLowerCase() === cluster.owner.toLowerCase(),
  );
  if (!ownerSigner) return false;

  // Compute burnRate: removed operators have feeWei=0 so they contribute 0
  let burnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op) burnRate += op.feeWei;
  }
  const migratedEB = cluster.validatorCount * DEFAULT_EB;
  const bpb = burnRate * migratedEB / DEFAULT_EB;
  const depositAmount = runwayDeposit(bpb, 90n, simState, newClusterFloor(bpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).migrateClusterToETH(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'migrateClusterDirectly (with removed op)', err);
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

/**
 * Reactivate a specific ETH cluster directly (used for one-shot tests).
 * Allows clusters with removed operators — updateClusterOperatorsOnReactivation skips
 * operators whose ethSnapshot.block == 0, so they contribute 0 fee/index.
 * Removed operators do NOT have their effectiveBalance restored (contract doesn't update
 * their ethValidatorCount either).
 */
export async function reactivateClusterDirectly(
  cluster: ClusterRecord,
  setup: StressSetup,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;
  const ownerSigner = setup.allSigners.find((s: any) =>
    s.address.toLowerCase() === cluster.owner.toLowerCase(),
  );
  if (!ownerSigner) return false;

  // Compute current burnRate — removed operators contribute 0 (feeWei was zeroed on removal)
  let currentBurnRate = simState.network.feeWei;
  for (const opId of cluster.operatorIds) {
    const op = simState.operators.get(opId);
    if (op && !op.isRemoved) currentBurnRate += op.feeWei;
  }
  const bpb = currentBurnRate * cluster.effectiveBalance / DEFAULT_EB;
  const depositAmount = runwayDeposit(bpb, 90n, simState, newClusterFloor(bpb, simState));

  let receipt: any;
  try {
    const tx = await network.connect(ownerSigner).reactivate(
      cluster.operatorIds, toClusterStruct(cluster), { value: depositAmount },
    );
    receipt = await tx.wait();
  } catch (err) {
    dumpClusterDiag(cluster, simState, report, 'reactivateClusterDirectly (with removed op)', err);
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
    if (op && !op.isRemoved) op.effectiveBalance += restoredEB;
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

// ─── Action: updateNetworkFee ─────────────────────────────────────────────
//
// Picks a new ETH network fee in [0, hardCeiling] where hardCeiling is the
// maximum fee that doesn't immediately push any ETH cluster into liquidation.
// Also enforces the ≤5% liquidatable rule (mirrors pickSafeBlockCount logic).
//
// Math: after the fee changes from oldFee → newFee, each active ETH cluster's
// burnRate changes by (newFee - oldFee). The cluster is immediately liquidatable if
//   balance < minBlocks * (burnRate - oldFee + newFee) * ebUnits
// Solving for the max safe fee per cluster:
//   newFee ≤ floor(balance / (minBlocks * ebUnits)) + oldFee - burnRate
// hardCeiling = min across all active ETH clusters of this value.

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

  // Hard ceiling: max fee before any ETH cluster immediately hits its liquidation threshold.
  let hardCeiling = 10n * TARGET_NETWORK_FEE_ETH; // reasonable absolute cap

  for (const c of activeClusters) {
    if (c.version !== VERSION_ETH || c.effectiveBalance === 0n) continue;
    const denom = minBlocks * c.effectiveBalance / DEFAULT_EB;
    if (denom === 0n) continue;
    // Max fee: balance >= minBlocks * (burnRate - oldFee + newFee) * effectiveBalance / DEFAULT_EB
    const maxFeeForCluster = c.balance / denom + oldFee - c.burnRate;
    if (maxFeeForCluster < 0n) continue;  // already problematic, skip
    if (maxFeeForCluster < hardCeiling) hardCeiling = maxFeeForCluster;
  }

  // Round down to ETH precision units
  const ceilingUnits = hardCeiling / ETH_DEDUCTED_DIGITS;
  if (ceilingUnits === 0n) return false;

  // Try up to 20 random fees, reject if > 5% of active clusters become liquidatable.
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

      // Update sim state: network fee and all active ETH cluster burnRates
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

// ─── Action: updateLiquidationThresholdPeriod ─────────────────────────────
//
// Picks a new minimumBlocksBeforeLiquidation in [MINIMAL_LIQ_THRESHOLD, hardCeiling].
// hardCeiling = min over all active clusters of floor(balance / burnPerBlock).
// This is the largest minBlocks that doesn't immediately liquidate any cluster.
// Also enforces the ≤5% liquidatable rule.
//
// Decreasing minBlocks is always safe; the ceiling only constrains increases.

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

// ─── Action: updateMinimumLiquidationCollateral ───────────────────────────
//
// Picks a new minimumLiquidationCollateral (ETH wei) in [ETH_DEDUCTED_DIGITS, hardCeiling].
// hardCeiling = min over all active ETH clusters of cluster.balance.
// A higher collateral requirement immediately makes clusters liquidatable if their
// balance falls below the new threshold — so we cap below the smallest cluster balance.
// Also enforces the ≤5% liquidatable rule.

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

  // Hard ceiling: max collateral such that no ETH cluster's balance falls below it.
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

// ─── Action: commitEBRoot ─────────────────────────────────────────────────
//
// Picks ~10% of active ETH clusters, assigns each a new effective balance (which may
// be higher, lower, or "liquidating"), builds a Merkle tree, and commits the root via
// 3 oracle signers.  Any pending entries from the previous round that were never applied
// via actUpdateClusterBalance are abandoned here and counted as skipped.
//
// EB selection rules:
//   - Must be ≥ validatorCount × 32 (protocol minimum)
//   - Must be ≤ validatorCount × 2048 (protocol maximum)
//   - 15% chance: pick a "liquidating" EB (so high the cluster auto-liquidates on next updateClusterBalance)
//   - 85% chance: pick randomly in [validatorCount×32, min(validatorCount×2048, currentEB×3)]

export async function actCommitEBRoot(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network, oracleSigners, connection } = setup;

  // Advance sim state to current chain block
  const currentBlock = BigInt(await setup.provider.getBlockNumber());
  advanceAll(simState, currentBlock);

  // Need active ETH clusters with at least 1 validator
  const activeETH = [...simState.clusters.values()].filter(
    c => c.active && c.version === VERSION_ETH && c.validatorCount > 0n && c.effectiveBalance > 0n,
  );
  if (activeETH.length === 0) return false;

  // Pick ~10% of active ETH clusters (at least 1)
  const count = Math.max(1, Math.round(activeETH.length * 0.10));
  const shuffled = [...activeETH];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Number(rng.nextInt(BigInt(i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled.slice(0, count);

  // Compute new EB values for each selected cluster
  const merkleEntries: { clusterId: string; effectiveBalance: number }[] = [];
  const pendingEntries: Map<string, { oldEB: bigint; newEB: bigint; proof: string[] }> = new Map();

  for (const cluster of selected) {
    const minEB = cluster.validatorCount * BigInt(MIN_EB_PER_VALIDATOR);
    const maxEB = cluster.validatorCount * BigInt(MAX_EB_PER_VALIDATOR);

    // Skip clusters whose lastOracleEB exceeds maxEB — validators were removed since the last oracle
    // commit, leaving no valid newEB: any value >= lastOracleEB violates EBExceedsMaximum, and any
    // value < lastOracleEB would underflow operatorEthVUnits in the contract.
    // The cluster becomes eligible again once validators are re-added (raising maxEB) or migrated.
    if (cluster.lastOracleEB > 0n && cluster.lastOracleEB > maxEB) {
      continue;
    }

    // Floor: never commit an oracle EB below the last committed value.
    // Reasoning: the contract stores seb.clusterEB[id].vUnits from the last updateClusterBalance.
    // If the new oracle vUnits < stored vUnits, _updateOperatorVUnits subtracts the delta from
    // seb.operatorEthVUnits, which can underflow (panic 0x11) when operatorEthVUnits < delta.
    // This happens after removeValidator lowers ethValidatorCount but leaves the stored oracle
    // vUnits unchanged, making a smaller newEB look like a larger decrease than the operator
    // has accumulated deviation to absorb. Flooring at lastOracleEB guarantees the delta
    // is always non-negative, eliminating the underflow.
    const oracleFloor = cluster.lastOracleEB > minEB ? cluster.lastOracleEB : minEB;

    let newEB: bigint;
    const makeLiquidating = rng.nextInt(100n) < 15n; // 15% chance

    if (makeLiquidating && cluster.burnRate > 0n && cluster.balance > 0n) {
      // Pick an EB large enough that 1 block of fees exceeds the cluster balance.
      // Round UP to next multiple of DEFAULT_EB (32) so effectiveBalance is always exact (32n divides it),
      // no split-floor rounding loss, TS and contract stay in perfect sync.
      const liqEB = (cluster.balance * DEFAULT_EB / cluster.burnRate + 1n) * 3n;
      const liqEB32 = ((liqEB + DEFAULT_EB - 1n) / DEFAULT_EB) * DEFAULT_EB;
      newEB = liqEB32 < maxEB ? liqEB32 : maxEB;
      if (newEB < oracleFloor) newEB = oracleFloor;
    } else {
      // Pick randomly in multiples of DEFAULT_EB (32) so effectiveBalance / DEFAULT_EB is always exact,
      // matching the contract's fee accumulator split exactly.
      const upperBound = maxEB < cluster.effectiveBalance * 3n ? maxEB : cluster.effectiveBalance * 3n;
      const upperBound32 = (upperBound / DEFAULT_EB) * DEFAULT_EB;  // round down to multiple of 32
      // Also floor the lower bound at oracleFloor to guarantee non-negative delta in contract
      const floorUnits = oracleFloor / DEFAULT_EB;
      const minUnits = floorUnits > minEB / DEFAULT_EB ? floorUnits : minEB / DEFAULT_EB;
      const maxUnits = upperBound32 / DEFAULT_EB;
      const range = maxUnits > minUnits ? maxUnits - minUnits + 1n : 1n;
      newEB = (minUnits + rng.nextInt(range)) * DEFAULT_EB;
    }

    // oldEB = oracle-stored EB (seb.clusterEB value), used for op.effectiveBalance delta
    merkleEntries.push({ clusterId: cluster.id, effectiveBalance: Number(newEB) });
    pendingEntries.set(cluster.id, { oldEB: cluster.effectiveBalance, newEB, proof: [] });
  }

  // Build Merkle tree and fill proofs
  const { root, proofs } = generateMerkleForClusterEB(connection, merkleEntries);
  for (const { clusterId } of merkleEntries) {
    pendingEntries.get(clusterId)!.proof = proofs[clusterId] ?? [];
  }

  // Commit root via 3 oracle signers (3 TXs → quorum at 75%)
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

  // ── Apply all entries immediately (updateClusterBalance is not a random action —
  //    it can only be called against the just-committed root, so we process all
  //    entries here. ~5 across the whole test are intentionally skipped.)
  const blockNum = Number(currentBlock);

  for (const [clusterId, entry] of pendingEntries) {
    const cluster = simState.clusters.get(clusterId);

    // Cluster may have been liquidated during a preceding entry's TX in this same loop
    if (!cluster || !cluster.active) {
      report.recordEBSkipped();
      continue;
    }

    // Intentional skip: ~5 across the whole test
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
      dumpClusterDiag(cluster, simState, report, 'updateClusterBalance', err);
      throw err;
    }

    txBlock = BigInt(receipt.blockNumber);
    advanceAll(simState, txBlock);

    const { oldEB, newEB } = entry;

    // Detect auto-liquidation: contract always emits ClusterBalanceUpdated (even when liquidated),
    // but ClusterLiquidated is only emitted on auto-liquidation. Check for its presence instead.
    let isLiquidated = false;
    try {
      parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      isLiquidated = true;
    } catch {
      // no CLUSTER_LIQUIDATED event → normal balance update
    }

    if (isLiquidated) {
      const parsed = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      // _updateEBSnapshot runs BEFORE auto-liquidation on-chain; contract uses oldEB for fee
      // settlement but applies newEB for operator/DAO accounting cleanup.
      // Net change to op.effectiveBalance = -oldEB [see analysis in comment above].
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
      // advanceAll deducted fees at old EB; updateClusterBalance charges fees at old EB too.
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

  // Round is fully consumed — clear pending state
  simState.pendingEBRound = null;
  return true;
}

// ─── Staking actions ─────────────────────────────────────────────────────

/**
 * actStake: pick a random staker from the pool, mint SSV, and stake it.
 * Tracks the resulting cSSV in simState.stakers.
 */
async function actStake(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { network, ssvToken, simState, provider } = setup;

  const idx = STRESS_STAKER_START_IDX + Number(rng.nextInt(BigInt(STRESS_STAKER_COUNT)));
  const staker = setup.allSigners[idx];
  if (!staker) return false;

  // Random amount in [MINIMAL_STAKING_AMOUNT, DEFAULT_STAKE_AMOUNT]
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
    // Mirror contract: _syncFees then _settleWithBalance(oldBalance) before mint.
    onSyncFees(simState);
    onSettleUser(stakerRec, simState);
    stakerRec.cssvBalance += amount;

    report.record('stake', gas(receipt), txBlock);
    return true;
  } catch (err: any) {
    report.writeFullHistory('stake');
    throw err;
  }
}

/**
 * actRequestUnstake: pick a staker with cSSV, request to unstake a random portion.
 * Tracks the new pending request in simState.stakers.
 */
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

  // Random amount in [1, cssvBalance]
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

    // Mirror contract: _syncFees then _settleWithBalance(fullBalance) before burn.
    onSyncFees(simState);
    onSettleUser(stakerRec, simState);
    stakerRec.cssvBalance -= amount;
    stakerRec.pendingUnstake.push({ amount, unlockTime });

    report.record('requestUnstake', gas(receipt), txBlock);
    return true;
  } catch (err: any) {
    report.writeFullHistory('requestUnstake');
    throw err;
  }
}

/**
 * actWithdrawUnlocked: pick a staker with at least one unlocked pending request,
 * call withdrawUnlocked(), and remove all now-unlocked entries from TS state.
 */
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

    // Remove all requests that were unlocked at TX time (contract uses swap-and-pop)
    stakerRec.pendingUnstake = stakerRec.pendingUnstake.filter(r => r.unlockTime > txTimestamp);

    report.record('withdrawUnlocked', gas(receipt), txBlock);
    return true;
  } catch (err: any) {
    report.writeFullHistory('withdrawUnlocked');
    throw err;
  }
}

// ─── Action: claimEthRewards ─────────────────────────────────────────────

export async function actClaimEthRewards(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, network } = setup;

  // Any staker with a cSSV balance OR already-settled rewards can claim.
  const eligible = [...simState.stakers.values()].filter(s => s.cssvBalance > 0n || s.totalEthAmount > 0n);
  const stakerRec = pickFrom(rng, eligible);
  if (!stakerRec) return false;

  const staker = setup.allSigners.find((s: any) =>
    s.address.toLowerCase() === stakerRec.address.toLowerCase(),
  );
  if (!staker) return false;

  let receipt: any;
  try {
    const tx = await network.connect(staker).claimEthRewards();
    receipt = await tx.wait();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // NothingToClaim: staker has no accrued rewards yet — skip.
    if (msg.includes('NothingToClaim')) return false;
    console.error(`\n[TX FAIL] claimEthRewards — ${msg}`);
    throw err;
  }
  const txBlock = BigInt(receipt.blockNumber);
  advanceAll(simState, txBlock);

  // Mirror contract: _syncFees then _settleWithBalance(fullBalance) before transfer.
  onSyncFees(simState);
  onSettleUser(stakerRec, simState);

  // The contract floors the payout to ETH_DEDUCTED_DIGITS (100k wei) granularity:
  //   payout    = claimable - (claimable % ETH_DEDUCTED_DIGITS)
  //   remainder = claimable % ETH_DEDUCTED_DIGITS  (kept in accrued[user])
  // Exception: if cssvBalance == 0 AND remainder > 0, the contract zeroes accrued[user]
  // (SSVStaking.sol line 145: accrued[user] = (remainder != 0 && userBalance == 0) ? 0 : remainder)
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
  // Keep sub-ETH_DEDUCTED_DIGITS dust in totalEthAmount unless user has no cSSV
  // (in which case the contract discards it from accrued[user]).
  stakerRec.totalEthAmount = keepRemainder ? remainder : 0n;
  // Only the actual payout left the contract; subtract it from earnings for conservation.
  // Also mirror the contract's: stakingEthPoolBalance -= packedPayout
  // (payout is ETH_DEDUCTED_DIGITS-aligned so lastSyncedPackedEarnings decrements by the same amount).
  if (payout > 0n && simState.network.ethNetworkEarnings >= payout) {
    simState.network.ethNetworkEarnings -= payout;
    simState.network.lastSyncedPackedEarnings -= payout;
  }

  report.record('claimEthRewards', gas(receipt), txBlock);
  return true;
}

// ─── Action: transferCSSV ─────────────────────────────────────────────────
//
// Any staker with cSSV (EOA, contract, oracle) transfers to:
//   60% → an existing staker already tracked in simState
//   20% → a contract-staker slot ([_SL_CON_START, _SL_CON_END))
//   20% → a fresh wallet (never seen before, index > STRESS_TOTAL_SIGNERS+300)
//
// Amount: 15% chance transfer all cSSV, 85% chance random in [1, cssvBalance].
// onCSSVTransfer hook fires on every transfer, calling _syncFees + settling both parties.

let _freshCssvWalletCounter = 0;

async function actTransferCSSV(
  setup: StressSetup,
  rng: RNG,
  report: RunReport,
): Promise<boolean> {
  const { simState, cssvToken, provider } = setup;

  // Any staker type can be a sender — EOA, oracle staker, or contract staker
  const eligible = [...simState.stakers.values()].filter(s => s.cssvBalance > 0n);
  if (eligible.length === 0) return false;

  const senderRec = eligible[Number(rng.nextInt(BigInt(eligible.length)))];
  const senderSigner = getOwnerSigner(setup, senderRec.address);
  if (!senderSigner) return false;

  // Amount: 15% transfer all, 85% random in [1, cssvBalance]
  const transferAll = rng.nextInt(100n) < 15n;
  const amount = transferAll
    ? senderRec.cssvBalance
    : 1n + rng.nextInt(senderRec.cssvBalance);
  if (amount === 0n) return false;

  // Is sender a contract-staker slot?
  const senderIsContract = setup.allSigners
    .slice(_SL_CON_START, _SL_CON_START + STRESS_STAKERS_CONTRACT)
    .some((s: any) => s.address.toLowerCase() === senderRec.address.toLowerCase());

  // Determine recipient
  let recipientAddress: string;
  let recipientType: 'existing' | 'contract' | 'fresh';

  const roll = rng.nextInt(100n);
  if (roll < 60n) {
    // 60%: pick a different existing staker
    const others = eligible.filter(s => s.address.toLowerCase() !== senderRec.address.toLowerCase());
    if (others.length === 0) return false;
    const rec = others[Number(rng.nextInt(BigInt(others.length)))];
    recipientAddress = rec.address;
    recipientType = 'existing';
  } else if (roll < 80n) {
    // 20%: pick a contract-staker slot
    if (STRESS_STAKERS_CONTRACT === 0) return false;
    const j = Number(rng.nextInt(BigInt(STRESS_STAKERS_CONTRACT)));
    const contractStaker = setup.allSigners[_SL_CON_START + j];
    if (!contractStaker) return false;
    recipientAddress = contractStaker.address;
    recipientType = 'contract';
  } else {
    // 20%: fresh wallet beyond the main signer pool
    const freshIdx = STRESS_TOTAL_SIGNERS + 300 + _freshCssvWalletCounter++;
    const freshSigner = await getSigner(setup.connection, setup.allSigners, freshIdx);
    if (!freshSigner) return false;
    // Register in allSigners so teardown can drain this wallet's cSSV later
    if (!setup.allSigners.some((s: any) => s.address.toLowerCase() === freshSigner.address.toLowerCase())) {
      setup.allSigners.push(freshSigner);
    }
    recipientAddress = freshSigner.address;
    recipientType = 'fresh';
  }

  // Skip self-transfer
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

  // Ensure recipient record exists before settlement (create if this is their first cSSV)
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

  // Mirror onCSSVTransfer: _syncFees once, then settle both parties using their
  // pre-transfer balances (hook fires before ERC-20 balance update).
  onSyncFees(simState);
  onSettleUser(senderRec, simState);
  onSettleUser(recipientRec, simState);
  senderRec.cssvBalance -= amount;
  recipientRec.cssvBalance += amount;

  report.record('transferCSSV', gas(receipt), txBlock);
  report.recordCSSVTransfer(transferAll, recipientType, senderIsContract);
  return true;
}

// ─── ALL_ACTIONS export ───────────────────────────────────────────────────

export interface WeightedAction {
  name:   string;
  weight: number;
  fn:     ActionFn;
}

export const ALL_ACTIONS: WeightedAction[] = [
  // Operator lifecycle
  { name: 'registerOperator',              weight: 12, fn: actRegisterOperator },
  { name: 'removeOperator',               weight: 5, fn: actRemoveOperator },
  { name: 'declareOperatorFee',            weight: 6,  fn: actDeclareOperatorFee },
  { name: 'cancelOperatorFee',             weight: 3,  fn: actCancelOperatorFee },
  { name: 'executeOperatorFee',            weight: 5,  fn: actExecuteOperatorFee },
  { name: 'withdrawFromOperator',          weight: 6,  fn: actWithdrawFromOperator },
  { name: 'withdrawAllOperatorEarnings',    weight: 6,  fn: actWithdrawOperatorEarnings },
  // Cluster/validator lifecycle
  { name: 'registerValidator',             weight: 18, fn: actRegisterValidator },
  { name: 'bulkRegisterValidator',         weight: 12, fn: actBulkRegisterValidator },
  { name: 'removeValidatorFromCluster',    weight: 8,  fn: actRemoveValidator },
  { name: 'bulkRemoveValidatorFromCluster',weight: 6,  fn: actBulkRemoveValidator },
  { name: 'depositToCluster',              weight: 12, fn: actDeposit },
  { name: 'clusterWithdraw',               weight: 8,  fn: actWithdraw },
  { name: 'liquidateCluster',              weight: 18, fn: actLiquidate },
  { name: 'reactivateCluster',             weight: 14, fn: actReactivate },
  { name: 'migrateClusterSSVtoETH',        weight: 8,  fn: actMigrateCluster },
  // Protocol governance (owner-only)
  { name: 'updateNetworkFee',                    weight: 4,  fn: actUpdateNetworkFee },
  { name: 'updateLiquidationThresholdPeriod',    weight: 3,  fn: actUpdateLiquidationThresholdPeriod },
  { name: 'updateMinimumLiquidationCollateral',  weight: 3,  fn: actUpdateLiquidationCollateral },
  // Oracle / EB
  { name: 'commitEBRoot', weight: 9, fn: actCommitEBRoot },
  // SSV staking
  { name: 'stake',              weight: 10, fn: actStake },
  { name: 'requestUnstake',     weight: 8,  fn: actRequestUnstake },
  { name: 'withdrawUnlocked',   weight: 6,  fn: actWithdrawUnlocked },
  { name: 'transferCSSV',       weight: 7,  fn: actTransferCSSV },
  { name: 'claimEthRewards',    weight: 5,  fn: actClaimEthRewards },
];
