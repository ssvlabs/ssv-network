import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { toClusterStruct } from './setup.ts';
import type { RunReport } from './report.ts';
import { advanceAll } from './state.ts';
import { VERSION_ETH, VERSION_SSV } from './constants.ts';
import { Events } from '../common/events.ts';
import { SEED_ETH, SEED_SSV, STRESS_COOLDOWN_SECS } from './constants.ts';
import { parseClusterFromEvent } from '../helpers/index.js';
import { getOwnerSigner, gas } from './actions.js';

export async function teardown(
  setup: StressSetup,
  report: RunReport,
): Promise<void> {
  const { network, views, simState, provider, deployer } = setup;
  const { operators, clusters } = simState;
  const networkAddr = await network.getAddress();

  advanceAll(simState, BigInt(await provider.getBlockNumber()));

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

      const newStruct = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
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

      const newStruct = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      if (newStruct) cluster.lastStruct = newStruct;
      report.record('teardown:liquidateSSV', gas(receipt), txBlock);
      ssvLiquidated++;
    } catch (err: any) {
      console.warn(`  Self-liquidation failed for SSV cluster ${cluster.id.slice(0, 10)}: ${err?.message?.slice(0, 80)}`);
    }
  }

  {
    const block = BigInt(await provider.getBlockNumber());
    report.recordConservation(block, 0n, 0n, 0n);
  }

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

  if (anyNewRequests) {
    await provider.send('hardhat_mine', ['0x1']);
    await provider.send('evm_increaseTime', [Number(STRESS_COOLDOWN_SECS) + 1]);
    await provider.send('hardhat_mine', ['0x1']);
    const postCooldownBlock = BigInt(await provider.getBlockNumber());
    advanceAll(simState, postCooldownBlock);
  }

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
