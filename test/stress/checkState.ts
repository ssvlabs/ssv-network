import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { advanceAll, burnPerBlock, isLiquidatable } from './state.ts';
import { VERSION_SSV, VERSION_ETH } from './constants.ts';
import type { RunReport } from './report.ts';
import { SEED_ETH, SEED_SSV, PRECISION } from './constants.ts';

function assertMatch(
  onChain: bigint,
  expected: bigint,
  label: string,
  debug?: string[],
  trace?: () => void,
  report?: RunReport,
  block?: bigint,
): void {
  if (onChain === expected) return;
  const diff = onChain > expected ? onChain - expected : expected - onChain;
  const dir = onChain > expected ? 'contract > TS' : 'TS > contract';
  console.error(`\n${'─'.repeat(60)}`);
  console.error(`FAIL: ${label}`);
  console.error(`  on-chain : ${onChain}`);
  console.error(`  expected : ${expected}`);
  console.error(`  diff     : ${diff} (${dir})`);
  if (debug) for (const l of debug) console.error(l);
  if (trace) trace();
  console.error('─'.repeat(60));

  if (report) {
    const bracketEnd = label.indexOf('] ');
    report.failures.push({
      block:    (block ?? 0n).toString(),
      check:    bracketEnd >= 0 ? label.slice(bracketEnd + 2) : label,
      expected: expected.toString(),
      actual:   onChain.toString(),
      action:   bracketEnd >= 0 ? label.slice(1, bracketEnd) : '',
    });
  }

  assert.equal(onChain, expected, label);
}

export async function checkState(setup: StressSetup, label = '', report?: RunReport, checkStaking = false): Promise<void> {
  const { views, simState, provider } = setup;
  const { operators, clusters } = simState;

  const block = BigInt(await provider.getBlockNumber());
  const prefix = label ? `[${label}] ` : '';

  advanceAll(simState, block);

  for (const op of operators.values()) {
    if (op.isRemoved) continue;

    assertMatch(
      BigInt(await views.getOperatorEarnings(op.id)),
      op.balance,
      `${prefix}operator ${op.id} ETH earnings`,
      [`  state    : block=${op.block} effectiveBalance=${op.effectiveBalance} feeWei=${op.feeWei}`],
      report ? () => report.getOperatorTrace(op.id) : undefined,
      report, block,
    );
  }

  for (const op of operators.values()) {
    if (op.isRemoved) continue;
    if (op.ssvFeeWei === 0n) continue;

    assertMatch(
      BigInt(await views.getOperatorEarningsSSV(op.id)),
      op.ssvBalance,
      `${prefix}operator ${op.id} SSV earnings`,
      [`  state    : ssvBlock=${op.ssvBlock} ssvValidatorCount=${op.ssvValidatorCount} ssvFeeWei=${op.ssvFeeWei}`],
      undefined, report, block,
    );
  }

  for (const cluster of clusters.values()) {
    if (!cluster.active) continue;

    const { lastStruct } = cluster;
    const structArg = {
      validatorCount:  lastStruct.validatorCount,
      networkFeeIndex: lastStruct.networkFeeIndex,
      index:           lastStruct.index,
      active:          lastStruct.active,
      balance:         lastStruct.balance,
    };

    if (cluster.version === VERSION_SSV) {
      assertMatch(
        BigInt(await views.getBalanceSSV(cluster.owner, cluster.operatorIds, structArg)),
        cluster.ssvBalance,
        `${prefix}SSV cluster ${cluster.id.slice(0, 14)} balance`,
        [`  state    : ssvBlock=${cluster.ssvBlock} validatorCount=${cluster.validatorCount} ssvBurnRate=${cluster.ssvBurnRate}`],
        report ? () => report.getClusterTrace(cluster.id) : undefined,
        report, block,
      );
    } else {
      assertMatch(
        BigInt(await views.getBalance(cluster.owner, cluster.operatorIds, structArg)),
        cluster.balance,
        `${prefix}cluster ${cluster.id.slice(0, 14)} balance`,
        [
          `  state    : block=${cluster.block} validatorCount=${cluster.validatorCount} burnRate=${cluster.burnRate}`,
          `  lastStruct.balance=${lastStruct.balance} lastStruct.validatorCount=${lastStruct.validatorCount}`,
        ],
        report ? () => report.getClusterTrace(cluster.id) : undefined,
        report, block,
      );
    }
  }

  assertMatch(
    BigInt(await views.getNetworkEarnings()),
    simState.network.ethNetworkEarnings,
    `${prefix}network ETH earnings`,
    [`  state    : block=${simState.network.block} totalEB=${simState.network.totalEffectiveBalance} feeWei=${simState.network.feeWei}`],
    undefined, report, block,
  );

  assertMatch(
    BigInt(await views.getNetworkEarningsSSV()),
    simState.network.ssvNetworkEarnings,
    `${prefix}network SSV earnings`,
    [`  state    : totalSSVValidators=${simState.network.totalSSVValidators} feeSSVWei=${simState.network.feeSSVWei}`],
    undefined, report, block,
  );

  assertMatch(
    simState.totalClampingExcess,
    0n,
    `${prefix}cluster balance went negative — missed liquidation`,
    [`  totalClampingExcess : ${simState.totalClampingExcess} wei`],
    undefined, report, block,
  );

  const networkAddr = await setup.network.getAddress();
  const contractETH = BigInt(await provider.getBalance(networkAddr));

  let expectedETH = SEED_ETH + simState.network.ethNetworkEarnings;
  for (const op of operators.values()) {
    if (!op.isRemoved) expectedETH += op.balance;
  }
  for (const cluster of clusters.values()) {
    if (cluster.active && cluster.version === VERSION_ETH) expectedETH += cluster.balance;
  }

  {
    let opEarningsETH = 0n;
    let clusterBalancesETH = 0n;
    for (const op of operators.values()) if (!op.isRemoved) opEarningsETH += op.balance;
    for (const cluster of clusters.values()) if (cluster.active && cluster.version === VERSION_ETH) clusterBalancesETH += cluster.balance;
    assertMatch(
      contractETH,
      expectedETH,
      `${prefix}ETH conservation`,
      [`  breakdown    : SEED=${SEED_ETH} clusterBalances=${clusterBalancesETH} opEarnings=${opEarningsETH} networkFees=${simState.network.ethNetworkEarnings}`],
      undefined, report, block,
    );
  }

  const contractSSV = BigInt(await setup.ssvToken.balanceOf(networkAddr));
  const stakedSSV = BigInt(await setup.views.totalStaked());

  let pendingUnstakeSSV = 0n;
  for (const s of simState.stakers.values()) {
    for (const r of s.pendingUnstake) pendingUnstakeSSV += r.amount;
  }

  let expectedSSV = SEED_SSV + stakedSSV + pendingUnstakeSSV + simState.network.ssvNetworkEarnings;
  for (const op of operators.values()) {
    if (!op.isRemoved) expectedSSV += op.ssvBalance;
  }
  for (const cluster of clusters.values()) {
    if (cluster.active && cluster.version === VERSION_SSV) expectedSSV += cluster.ssvBalance;
  }

  assertMatch(
    contractSSV,
    expectedSSV,
    `${prefix}SSV conservation`,
    [`  breakdown    : SEED=${SEED_SSV} staked=${stakedSSV} pendingUnstake=${pendingUnstakeSSV} networkFees=${simState.network.ssvNetworkEarnings}`],
    undefined, report, block,
  );

  if (checkStaking) {
    for (const stakerRec of simState.stakers.values()) {
      assertMatch(
        BigInt(await views.stakedBalanceOf(stakerRec.address)),
        stakerRec.cssvBalance,
        `${prefix}staker ${stakerRec.address.slice(0, 10)} cSSV`,
        undefined, undefined, report, block,
      );

      const onChainPending = await views.pendingUnstake(stakerRec.address);
      const sortKey = (a: { amount: bigint; unlockTime: bigint }) =>
        a.unlockTime * (2n ** 64n) + a.amount;
      const onChainSorted = [...onChainPending]
        .map(r => ({ amount: BigInt(r.amount), unlockTime: BigInt(r.unlockTime) }))
        .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
      const tsSorted = [...stakerRec.pendingUnstake]
        .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

      assertMatch(
        BigInt(onChainSorted.length),
        BigInt(tsSorted.length),
        `${prefix}staker ${stakerRec.address.slice(0, 10)} pending count`,
        undefined, undefined, report, block,
      );
      for (let i = 0; i < onChainSorted.length; i++) {
        const oc = onChainSorted[i];
        const ts = tsSorted[i];
        if (oc.amount !== ts.amount || oc.unlockTime !== ts.unlockTime) {
          assertMatch(oc.amount, ts.amount, `${prefix}staker pending[${i}].amount`, undefined, undefined, report, block);
          assertMatch(oc.unlockTime, ts.unlockTime, `${prefix}staker pending[${i}].unlockTime`, undefined, undefined, report, block);
        }
      }
    }

    const { accEthPerShare } = simState.network;
    for (const stakerRec of simState.stakers.values()) {
      const pending = stakerRec.cssvBalance * (accEthPerShare - stakerRec.userIndex) / PRECISION;
      const expected = stakerRec.totalEthAmount + pending;
      assertMatch(
        BigInt(await views.previewClaimableEth(stakerRec.address)),
        expected,
        `${prefix}staker ${stakerRec.address.slice(0, 10)} previewClaimableEth`,
        [`  state    : accEthPerShare=${accEthPerShare} userIndex=${stakerRec.userIndex} cssvBalance=${stakerRec.cssvBalance}`],
        undefined, report, block,
      );
    }

    assertMatch(
      BigInt(await views.stakingEthPoolBalance()),
      simState.network.lastSyncedPackedEarnings,
      `${prefix}stakingEthPoolBalance`,
      undefined, undefined, report, block,
    );

    {
      let tsTotal = 0n;
      for (const s of simState.stakers.values()) tsTotal += s.cssvBalance;
      assertMatch(
        BigInt(await views.totalStaked()),
        tsTotal,
        `${prefix}totalStaked`,
        undefined, undefined, report, block,
      );
    }

    {
      const totalCSSV = BigInt(await views.totalStaked());
      if (totalCSSV > 0n) {
        assertMatch(
          BigInt(await views.getOracleWeight(1)),
          totalCSSV / 4n,
          `${prefix}oracle weight`,
          [`  totalCSSV=${totalCSSV}`],
          undefined, report, block,
        );
      }
    }
  }

  for (const op of operators.values()) {
    if (op.isRemoved) continue;

    assertMatch(
      BigInt(await views.getOperatorFee(op.id)),
      op.feeWei,
      `${prefix}operator ${op.id} ETH fee`,
      undefined, undefined, report, block,
    );

    if (op.ssvFeeWei > 0n) {
      assertMatch(
        BigInt(await views.getOperatorFeeSSV(op.id)),
        op.ssvFeeWei,
        `${prefix}operator ${op.id} SSV fee`,
        undefined, undefined, report, block,
      );
    }

    let tsEthValidatorCount = 0n;
    for (const c of clusters.values()) {
      if (c.active && c.version === VERSION_ETH && c.operatorIds.includes(op.id)) {
        tsEthValidatorCount += c.validatorCount;
      }
    }
    const onChainOpData = await views.getOperatorById(op.id);
    assertMatch(
      BigInt(onChainOpData.validatorCount),
      tsEthValidatorCount,
      `${prefix}operator ${op.id} ETH validator count`,
      [`  effectiveBalance=${op.effectiveBalance}`],
      undefined, report, block,
    );

    if (op.ssvFeeWei > 0n) {
      const onChainOpDataSSV = await views.getOperatorByIdSSV(op.id);
      assertMatch(
        BigInt(onChainOpDataSSV.validatorCount),
        op.ssvValidatorCount,
        `${prefix}operator ${op.id} SSV validator count`,
        undefined, undefined, report, block,
      );
    }
  }

  for (const cluster of clusters.values()) {
    const structArg = {
      validatorCount:  cluster.lastStruct.validatorCount,
      networkFeeIndex: cluster.lastStruct.networkFeeIndex,
      index:           cluster.lastStruct.index,
      active:          cluster.lastStruct.active,
      balance:         cluster.lastStruct.balance,
    };

    assertMatch(
      BigInt(await views.getClusterAssetType(cluster.owner, cluster.operatorIds)),
      cluster.version,
      `${prefix}cluster ${cluster.id.slice(0, 14)} asset type`,
      undefined, undefined, report, block,
    );

    if (!cluster.active) {
      const onChainLiquidated = await views.isLiquidated(cluster.owner, cluster.operatorIds, structArg);
      if (!onChainLiquidated) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} should be liquidated on-chain`);
        console.error('─'.repeat(60));
        if (report) {
          report.failures.push({
            block: block.toString(),
            check: `cluster ${cluster.id.slice(0, 14)} isLiquidated`,
            expected: 'true',
            actual: 'false',
            action: label,
          });
        }
        assert.ok(onChainLiquidated, `${prefix}cluster ${cluster.id.slice(0, 14)} isLiquidated`);
      }
      continue;
    }

    if (cluster.version === VERSION_ETH) {
      const tsBurnRate = burnPerBlock(cluster);
      assertMatch(
        BigInt(await views.getBurnRate(cluster.owner, cluster.operatorIds, structArg)),
        tsBurnRate,
        `${prefix}cluster ${cluster.id.slice(0, 14)} ETH burn rate`,
        [
          `  burnRate=${cluster.burnRate} effectiveBalance=${cluster.effectiveBalance}`,
          `  lastStruct: active=${cluster.lastStruct.active} validatorCount=${cluster.lastStruct.validatorCount}`,
        ],
        report ? () => report.printTimeline([cluster.id], []) : undefined,
        report, block,
      );

      assertMatch(
        BigInt(await views.getEffectiveBalance(cluster.owner, cluster.operatorIds, structArg)),
        cluster.effectiveBalance,
        `${prefix}cluster ${cluster.id.slice(0, 14)} effective balance`,
        [`  validatorCount=${cluster.validatorCount}`],
        report ? () => report.printTimeline([cluster.id], []) : undefined,
        report, block,
      );

      const tsLiq = isLiquidatable(cluster, simState);
      assertMatch(
        BigInt(await views.isLiquidatable(cluster.owner, cluster.operatorIds, structArg) ? 1n : 0n),
        BigInt(tsLiq ? 1n : 0n),
        `${prefix}cluster ${cluster.id.slice(0, 14)} isLiquidatable`,
        [`  balance=${cluster.balance} burnRate=${tsBurnRate}`],
        undefined, report, block,
      );
    } else {
      const tsBurnRateSSV = burnPerBlock(cluster);
      assertMatch(
        BigInt(await views.getBurnRateSSV(cluster.owner, cluster.operatorIds, structArg)),
        tsBurnRateSSV,
        `${prefix}SSV cluster ${cluster.id.slice(0, 14)} burn rate`,
        [`  ssvBurnRate=${cluster.ssvBurnRate} validatorCount=${cluster.validatorCount}`],
        undefined, report, block,
      );

      const tsLiqSSV = isLiquidatable(cluster, simState);
      assertMatch(
        BigInt(await views.isLiquidatableSSV(cluster.owner, cluster.operatorIds, structArg) ? 1n : 0n),
        BigInt(tsLiqSSV ? 1n : 0n),
        `${prefix}SSV cluster ${cluster.id.slice(0, 14)} isLiquidatableSSV`,
        [`  ssvBalance=${cluster.ssvBalance} burnRate=${tsBurnRateSSV}`],
        undefined, report, block,
      );
    }
  }
}
