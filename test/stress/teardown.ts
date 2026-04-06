// Teardown: every cluster owner self-liquidates their cluster.
//
// When clusterOwner == msg.sender, the contract skips the liquidation-threshold
// check and returns the full balance to the caller immediately — no mining needed.
//
// Flow:
//   1. Each ETH cluster owner calls liquidate(ownerAddr, operatorIds, cluster)
//   2. Each SSV cluster owner calls liquidateSSV(ownerAddr, operatorIds, cluster)
//   3. Withdraw all operator ETH and SSV earnings
//   4. Withdraw network SSV earnings (DAO treasury)
//
// After teardown:
//   ETH = SEED_ETH + accumulated ETH network fees (verified via getNetworkEarnings())
//   SSV = SEED_SSV  (all SSV earnings drained)

import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { toClusterStruct } from './setup.ts';
import type { RunReport } from './report.ts';
import { advanceAll, VERSION_ETH, VERSION_SSV } from './state.ts';
import { Events } from '../common/events.ts';
import { SEED_ETH, SEED_SSV, UNSTAKE_COOLDOWN_BLOCKS } from './constants.ts';

function gas(receipt: any): bigint {
  return BigInt(receipt?.gasUsed ?? 0n);
}

function parseLastClusterStruct(contract: any, receipt: any, eventName: string): any | null {
  let last: any = null;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        const t = parsed.args[parsed.args.length - 1];
        last = {
          validatorCount:  BigInt(t[0]),
          networkFeeIndex: BigInt(t[1]),
          index:           BigInt(t[2]),
          active:          Boolean(t[3]),
          balance:         BigInt(t[4]),
        };
      }
    } catch { /* skip */ }
  }
  return last;
}

function getOwnerSigner(setup: StressSetup, owner: string): any {
  return setup.allSigners.find(
    (s: any) => s.address.toLowerCase() === owner.toLowerCase(),
  ) ?? null;
}

export async function teardown(
  setup: StressSetup,
  report: RunReport,
): Promise<void> {
  const { network, views, simState, provider, deployer } = setup;
  const { operators, clusters } = simState;
  const networkAddr = await network.getAddress();

  // Advance TS to current block before starting
  advanceAll(simState, BigInt(await provider.getBlockNumber()));

  // ── 1. Self-liquidate all ETH clusters ──────────────────────────────────────
  // Owner calls liquidate(ownerAddr, ...) → threshold check skipped, full ETH returned.
  let ethLiquidated = 0;
  for (const cluster of clusters.values()) {
    if (!cluster.active || cluster.version !== VERSION_ETH) continue;

    const ownerSigner = getOwnerSigner(setup, cluster.owner);
    if (!ownerSigner) continue;

    try {
      const receipt = await (await network.connect(ownerSigner).liquidate(
        cluster.owner, cluster.operatorIds, toClusterStruct(cluster),
      )).wait();
      if (!receipt) continue;
      const txBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, txBlock);

      const eb = cluster.effectiveBalance;
      for (const opId of cluster.operatorIds) {
        const op = operators.get(opId);
        if (op && op.effectiveBalance >= eb) op.effectiveBalance -= eb;
      }
      if (simState.network.totalEffectiveBalance >= eb) simState.network.totalEffectiveBalance -= eb;
      cluster.balance = 0n;
      cluster.burnRate = 0n;
      cluster.active = false;

      const newStruct = parseLastClusterStruct(network, receipt, Events.CLUSTER_LIQUIDATED);
      if (newStruct) cluster.lastStruct = newStruct;
      report.record('teardown:liquidate', gas(receipt), txBlock);
      ethLiquidated++;
    } catch (err: any) {
      const opDebug: string[] = [];
      for (const opId of cluster.operatorIds) {
        const op = operators.get(opId);
        opDebug.push(`op${opId}:removed=${op?.isRemoved},effBal=${op?.effectiveBalance}`);
      }
      console.warn(
        `  Self-liquidation failed for ETH cluster ${cluster.id.slice(0, 10)}\n` +
        `    validatorCount=${cluster.lastStruct?.validatorCount} active=${cluster.lastStruct?.active} balance=${cluster.lastStruct?.balance}\n` +
        `    operators: [${opDebug.join(', ')}]\n` +
        `    lastOracleEB=${cluster.lastOracleEB} effectiveBalance=${cluster.effectiveBalance}\n` +
        `    err: ${err?.message?.slice(0, 200)}`
      );
    }
  }

  // ── 2. Self-liquidate all SSV clusters ──────────────────────────────────────
  let ssvLiquidated = 0;
  for (const cluster of clusters.values()) {
    if (!cluster.active || cluster.version !== VERSION_SSV) continue;

    const ownerSigner = getOwnerSigner(setup, cluster.owner);
    if (!ownerSigner) continue;

    try {
      const receipt = await (await network.connect(ownerSigner).liquidateSSV(
        cluster.owner, cluster.operatorIds, toClusterStruct(cluster),
      )).wait();
      if (!receipt) continue;
      const txBlock = BigInt(receipt.blockNumber);
      advanceAll(simState, txBlock);

      const vc = cluster.validatorCount;
      for (const opId of cluster.operatorIds) {
        const op = operators.get(opId);
        if (op && op.ssvValidatorCount >= vc) op.ssvValidatorCount -= vc;
      }
      if (simState.network.totalSSVValidators >= vc) simState.network.totalSSVValidators -= vc;
      cluster.ssvBalance = 0n;
      cluster.active = false;

      const newStruct = parseLastClusterStruct(network, receipt, Events.CLUSTER_LIQUIDATED);
      if (newStruct) cluster.lastStruct = newStruct;
      report.record('teardown:liquidateSSV', gas(receipt), txBlock);
      ssvLiquidated++;
    } catch (err: any) {
      console.warn(`  Self-liquidation failed for SSV cluster ${cluster.id.slice(0, 10)}: ${err?.message?.slice(0, 80)}`);
    }
  }

  // Record a conservation point now — all cluster balances are 0 (shows drop in graph)
  {
    const block = BigInt(await provider.getBlockNumber());
    report.recordConservation(block, 0n, 0n, 0n);
  }

  // ── 3. Withdraw all operator ETH and SSV earnings ────────────────────────────
  for (const op of operators.values()) {
    if (op.isRemoved) continue;
    const ownerSigner = getOwnerSigner(setup, op.owner);
    if (!ownerSigner) continue;

    try {
      const receipt = await (await network.connect(ownerSigner).withdrawAllOperatorEarnings(op.id)).wait();
      if (receipt) {
        advanceAll(simState, BigInt(receipt.blockNumber));
        op.balance = 0n;
        report.record('teardown:withdrawOpETH', gas(receipt), BigInt(receipt.blockNumber));
      }
    } catch { /* already zero */ }

    if (op.ssvFeeWei > 0n) {
      try {
        const receipt = await (await network.connect(ownerSigner).withdrawAllOperatorEarningsSSV(op.id)).wait();
        if (receipt) {
          advanceAll(simState, BigInt(receipt.blockNumber));
          op.ssvBalance = 0n;
          report.record('teardown:withdrawOpSSV', gas(receipt), BigInt(receipt.blockNumber));
        }
      } catch { /* already zero */ }
    }
  }

  // ── 4. Withdraw network SSV earnings (DAO treasury) ──────────────────────────
  try {
    const networkSSVBal = BigInt(await views.getNetworkEarningsSSV());
    if (networkSSVBal > 0n) {
      const receipt = await (await network.connect(deployer).withdrawNetworkSSVEarnings(networkSSVBal)).wait();
      if (receipt) {
        advanceAll(simState, BigInt(receipt.blockNumber));
        simState.network.ssvNetworkEarnings = 0n;
        report.record('teardown:withdrawNetworkSSV', gas(receipt), BigInt(receipt.blockNumber));
      }
    }
  } catch { /* ignore */ }

  // ── 5. Drain all stakers' SSV (requestUnstake any remaining cSSV, then withdrawUnlocked) ───
  // Phase A: requestUnstake for any staker with remaining cSSV balance
  let anyNewRequests = false;
  for (const stakerRec of simState.stakers.values()) {
    if (stakerRec.cssvBalance === 0n) continue;
    const ownerSigner = getOwnerSigner(setup, stakerRec.address);
    if (!ownerSigner) continue;
    try {
      const receipt = await (await network.connect(ownerSigner).requestUnstake(stakerRec.cssvBalance)).wait();
      if (receipt) {
        advanceAll(simState, BigInt(receipt.blockNumber));
        stakerRec.pendingUnstake.push({ amount: stakerRec.cssvBalance, unlockTime: 0n }); // unlockTime irrelevant in teardown
        stakerRec.cssvBalance = 0n;
        anyNewRequests = true;
        report.record('teardown:requestUnstake', gas(receipt), BigInt(receipt.blockNumber));
      }
    } catch { /* already 0 or insufficient */ }
  }

  // Phase B: mine cooldown blocks so all newly requested unstakes become withdrawable
  if (anyNewRequests) {
    await provider.send('hardhat_mine', [`0x${UNSTAKE_COOLDOWN_BLOCKS.toString(16)}`]);
    const postCooldownBlock = BigInt(await provider.getBlockNumber());
    advanceAll(simState, postCooldownBlock);
  }

  // Phase C: withdrawUnlocked for all stakers with any pending requests
  for (const stakerRec of simState.stakers.values()) {
    if (stakerRec.pendingUnstake.length === 0) continue;
    const ownerSigner = getOwnerSigner(setup, stakerRec.address);
    if (!ownerSigner) continue;
    try {
      const receipt = await (await network.connect(ownerSigner).withdrawUnlocked()).wait();
      if (receipt) {
        advanceAll(simState, BigInt(receipt.blockNumber));
        stakerRec.pendingUnstake = [];
        report.record('teardown:withdrawUnlocked', gas(receipt), BigInt(receipt.blockNumber));
      }
    } catch { /* nothing unlocked or already withdrawn */ }
  }

  // ── Final assertions ─────────────────────────────────────────────────────────
  const finalContractETH = BigInt(await provider.getBalance(networkAddr));
  const finalContractSSV = BigInt(await setup.ssvToken.balanceOf(networkAddr));
  report.finalDustSSV = finalContractSSV;
  report.expectedFinalSSV = SEED_SSV;
  const onChainNetworkETH = BigInt(await views.getNetworkEarnings());
  const expectedFinalETH = SEED_ETH + onChainNetworkETH;


  report.finalContractETH = finalContractETH;
  report.expectedFinalETH = expectedFinalETH;
  report.expectedEthNetworkFees = onChainNetworkETH;

  assert(
    finalContractETH === expectedFinalETH,
    `ETH balance mismatch: contract=${finalContractETH} expected=${expectedFinalETH} diff=${finalContractETH - expectedFinalETH}`,
  );

  assert(
    finalContractSSV === SEED_SSV,
    `SSV balance mismatch: contract=${finalContractSSV} expected=${SEED_SSV} diff=${finalContractSSV - SEED_SSV}`,
  );

}
