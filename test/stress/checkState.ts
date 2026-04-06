// Verification: after each write TX, assert TS simulation state matches on-chain state.
// Calls advanceAll() first to bring every entity to the current block, then asserts.

import { assert } from 'chai';
import type { StressSetup } from './setup.ts';
import { advanceAll, VERSION_SSV, VERSION_ETH, burnPerBlock, isLiquidatable } from './state.ts';
import type { RunReport } from './report.ts';
import { SEED_ETH, SEED_SSV, PRECISION } from './constants.ts';

/**
 * Full state verification pass.
 * Advances all TS state to the current block, then asserts:
 *   1. Each operator's TS earnings == getOperatorEarnings()
 *   2. Each active cluster's TS balance == getBalance(lastStruct)
 *   3. Contract ETH >= sum of active cluster balances (conservation)
 */
export async function checkState(setup: StressSetup, label = '', report?: RunReport, checkStaking = false): Promise<void> {
  const { views, simState, provider } = setup;
  const { operators, clusters } = simState;

  const block = BigInt(await provider.getBlockNumber());
  const prefix = label ? `[${label}] ` : '';

  // Advance ALL entities to current block before asserting
  advanceAll(simState, block);

  // ── Operator ETH earnings ──────────────────────────────────────────────
  for (const op of operators.values()) {
    if (op.isRemoved) continue;

    const tsBalance = op.balance;
    const onChain = BigInt(await views.getOperatorEarnings(op.id));

    if (onChain !== tsBalance) {
      const diff = onChain > tsBalance ? onChain - tsBalance : tsBalance - onChain;
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}operator ${op.id} ETH earnings`);
      console.error(`  on-chain : ${onChain} (${(Number(onChain) / 1e18).toFixed(9)} ETH)`);
      console.error(`  expected : ${tsBalance} (${(Number(tsBalance) / 1e18).toFixed(9)} ETH)`);
      console.error(`  diff     : ${diff} wei (${onChain > tsBalance ? 'contract > TS' : 'TS > contract'})`);
      console.error(`  state    : block=${op.block} effectiveBalance=${op.effectiveBalance} feeWei=${op.feeWei}`);
      if (report) report.getOperatorTrace(op.id);
      console.error('─'.repeat(60));
      assert.equal(onChain, tsBalance, `${prefix}operator ${op.id} ETH earnings`);
    }
  }

  // ── Operator SSV earnings ──────────────────────────────────────────────
  for (const op of operators.values()) {
    if (op.isRemoved) continue;
    if (op.ssvFeeWei === 0n) continue;  // only pre-migration operators have SSV fees

    const tsBalance = op.ssvBalance;
    const onChain = BigInt(await views.getOperatorEarningsSSV(op.id));

    if (onChain !== tsBalance) {
      const diff = onChain > tsBalance ? onChain - tsBalance : tsBalance - onChain;
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}operator ${op.id} SSV earnings`);
      console.error(`  on-chain : ${onChain}`);
      console.error(`  expected : ${tsBalance}`);
      console.error(`  diff     : ${diff} (${onChain > tsBalance ? 'contract > TS' : 'TS > contract'})`);
      console.error(`  state    : ssvBlock=${op.ssvBlock} ssvValidatorCount=${op.ssvValidatorCount} ssvFeeWei=${op.ssvFeeWei}`);
      console.error('─'.repeat(60));
      assert.equal(onChain, tsBalance, `${prefix}operator ${op.id} SSV earnings`);
    }
  }

  // ── Cluster balances ───────────────────────────────────────────────────
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
      // SSV cluster — balance is in SSV wei
      const tsBalance = cluster.ssvBalance;
      const onChainBalance = BigInt(await views.getBalanceSSV(
        cluster.owner, cluster.operatorIds, structArg,
      ));
      if (onChainBalance !== tsBalance) {
        const diff = onChainBalance > tsBalance ? onChainBalance - tsBalance : tsBalance - onChainBalance;
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}SSV cluster ${cluster.id.slice(0, 14)} balance`);
        console.error(`  on-chain : ${onChainBalance}`);
        console.error(`  expected : ${tsBalance}`);
        console.error(`  diff     : ${diff} (${onChainBalance > tsBalance ? 'contract > TS' : 'TS > contract'})`);
        console.error(`  state    : ssvBlock=${cluster.ssvBlock} validatorCount=${cluster.validatorCount} ssvBurnRate=${cluster.ssvBurnRate}`);
        if (report) report.getClusterTrace(cluster.id);
        console.error('─'.repeat(60));
        assert.equal(onChainBalance, tsBalance, `${prefix}SSV cluster ${cluster.id.slice(0, 14)} balance`);
      }
    } else {
      // ETH cluster
      const tsBalance = cluster.balance;
      const onChainBalance = BigInt(await views.getBalance(
        cluster.owner, cluster.operatorIds, structArg,
      ));
      if (onChainBalance !== tsBalance) {
        const diff = onChainBalance > tsBalance ? onChainBalance - tsBalance : tsBalance - onChainBalance;
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} balance`);
        console.error(`  on-chain : ${onChainBalance} (${(Number(onChainBalance) / 1e18).toFixed(9)} ETH)`);
        console.error(`  expected : ${tsBalance} (${(Number(tsBalance) / 1e18).toFixed(9)} ETH)`);
        console.error(`  diff     : ${diff} wei (${onChainBalance > tsBalance ? 'contract > TS' : 'TS > contract'})`);
        console.error(`  state    : block=${cluster.block} validatorCount=${cluster.validatorCount} burnRate=${cluster.burnRate}`);
        console.error(`  lastStruct.balance=${lastStruct.balance} lastStruct.validatorCount=${lastStruct.validatorCount}`);
        if (report) report.getClusterTrace(cluster.id);
        console.error('─'.repeat(60));
        assert.equal(onChainBalance, tsBalance, `${prefix}cluster ${cluster.id.slice(0, 14)} balance`);
      }
    }
  }

  // ── Network ETH earnings (staking pool) ───────────────────────────────
  {
    const tsEarnings = simState.network.ethNetworkEarnings;
    const onChain = BigInt(await views.getNetworkEarnings());
    if (onChain !== tsEarnings) {
      const diff = onChain > tsEarnings ? onChain - tsEarnings : tsEarnings - onChain;
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}network ETH earnings`);
      console.error(`  on-chain : ${onChain} (${(Number(onChain) / 1e18).toFixed(9)} ETH)`);
      console.error(`  expected : ${tsEarnings} (${(Number(tsEarnings) / 1e18).toFixed(9)} ETH)`);
      console.error(`  diff     : ${diff} wei`);
      console.error(`  state    : block=${simState.network.block} totalEB=${simState.network.totalEffectiveBalance} feeWei=${simState.network.feeWei}`);
      console.error('─'.repeat(60));
      assert.equal(onChain, tsEarnings, `${prefix}network ETH earnings`);
    }
  }

  // ── Network SSV earnings (DAO treasury) ───────────────────────────────
  {
    const tsEarnings = simState.network.ssvNetworkEarnings;
    const onChain = BigInt(await views.getNetworkEarningsSSV());
    if (onChain !== tsEarnings) {
      const diff = onChain > tsEarnings ? onChain - tsEarnings : tsEarnings - onChain;
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}network SSV earnings`);
      console.error(`  on-chain : ${onChain}`);
      console.error(`  expected : ${tsEarnings}`);
      console.error(`  diff     : ${diff}`);
      console.error(`  state    : totalSSVValidators=${simState.network.totalSSVValidators} feeSSVWei=${simState.network.feeSSVWei}`);
      console.error('─'.repeat(60));
      assert.equal(onChain, tsEarnings, `${prefix}network SSV earnings`);
    }
  }

  // ── Cluster balance clamping must never happen ────────────────────────
  // totalClampingExcess > 0 means a cluster's fees exceeded its balance (went below zero).
  // This indicates a missed liquidation — the cluster should have been liquidated before
  // its balance reached zero. This is a bug, not an expected condition.
  if (simState.totalClampingExcess > 0n) {
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`FAIL: ${prefix}cluster balance clamping detected (missed liquidation)`);
    console.error(`  totalClampingExcess : ${simState.totalClampingExcess} wei`);
    console.error('─'.repeat(60));
    assert.equal(simState.totalClampingExcess, 0n, `${prefix}cluster balance went negative — missed liquidation`);
  }

  // ── ETH conservation (exact equality) ────────────────────────────────
  // contractETH == SEED_ETH + Σ(active ETH cluster balances) + Σ(op ETH earnings) + ethNetworkFees
  const networkAddr = await setup.network.getAddress();
  const contractETH = BigInt(await provider.getBalance(networkAddr));

  let expectedETH = SEED_ETH + simState.network.ethNetworkEarnings;
  for (const op of operators.values()) {
    if (!op.isRemoved) expectedETH += op.balance;
  }
  for (const cluster of clusters.values()) {
    if (cluster.active && cluster.version === VERSION_ETH) expectedETH += cluster.balance;
  }

  if (contractETH !== expectedETH) {
    const diff = contractETH > expectedETH ? contractETH - expectedETH : expectedETH - contractETH;
    let opEarningsETH = 0n;
    let clusterBalancesETH = 0n;
    for (const op of operators.values()) if (!op.isRemoved) opEarningsETH += op.balance;
    for (const cluster of clusters.values()) if (cluster.active && cluster.version === VERSION_ETH) clusterBalancesETH += cluster.balance;
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`FAIL: ${prefix}ETH conservation`);
    console.error(`  contract ETH : ${contractETH} (${(Number(contractETH) / 1e18).toFixed(9)} ETH)`);
    console.error(`  expected     : ${expectedETH} (${(Number(expectedETH) / 1e18).toFixed(9)} ETH)`);
    console.error(`  diff         : ${diff} wei (${contractETH > expectedETH ? 'contract > expected' : 'expected > contract'})`);
    console.error(`  breakdown    : SEED=${SEED_ETH} clusterBalances=${clusterBalancesETH} opEarnings=${opEarningsETH} networkFees=${simState.network.ethNetworkEarnings}`);
    console.error('─'.repeat(60));
    assert.equal(contractETH, expectedETH, `${prefix}ETH conservation`);
  }

  // ── SSV conservation (exact equality) ────────────────────────────────
  // contractSSV == SEED_SSV + stakedSSV + pendingUnstakeSSV
  //              + Σ(active SSV cluster balances) + Σ(op SSV earnings) + ssvNetworkFees
  //
  // stakedSSV      = cSSV.totalSupply() — SSV locked while cSSV is outstanding
  // pendingUnstakeSSV = Σ staker.pendingUnstake[].amount — SSV requested but not yet withdrawn
  //   (requestUnstake burns cSSV immediately, so this SSV falls out of totalStaked()
  //    but stays in the contract until withdrawUnlocked() is called)
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

  if (contractSSV !== expectedSSV) {
    const diff = contractSSV > expectedSSV ? contractSSV - expectedSSV : expectedSSV - contractSSV;
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`FAIL: ${prefix}SSV conservation`);
    console.error(`  contract SSV : ${contractSSV}`);
    console.error(`  expected     : ${expectedSSV}`);
    console.error(`  diff         : ${diff} (${contractSSV > expectedSSV ? 'contract > expected' : 'expected > contract'})`);
    console.error(`  breakdown    : SEED=${SEED_SSV} staked=${stakedSSV} pendingUnstake=${pendingUnstakeSSV} networkFees=${simState.network.ssvNetworkEarnings}`);
    console.error('─'.repeat(60));
    assert.equal(contractSSV, expectedSSV, `${prefix}SSV conservation`);
  }

  if (checkStaking) {
    // ── Staking: per-staker cSSV balance & pending requests ─────────────────
    for (const stakerRec of simState.stakers.values()) {
      // cSSV balance (= stakedBalanceOf)
      const onChainCSSV = BigInt(await views.stakedBalanceOf(stakerRec.address));
      if (onChainCSSV !== stakerRec.cssvBalance) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}staker ${stakerRec.address.slice(0, 10)} cSSV balance`);
        console.error(`  on-chain : ${onChainCSSV}`);
        console.error(`  expected : ${stakerRec.cssvBalance}`);
        console.error('─'.repeat(60));
        assert.equal(onChainCSSV, stakerRec.cssvBalance, `${prefix}staker ${stakerRec.address.slice(0, 10)} cSSV`);
      }

      // Pending unstake requests — compare sorted by (unlockTime, amount)
      const onChainPending = await views.pendingUnstake(stakerRec.address);
      const sortKey = (a: { amount: bigint; unlockTime: bigint }) =>
        a.unlockTime * (2n ** 64n) + a.amount;
      const onChainSorted = [...onChainPending]
        .map(r => ({ amount: BigInt(r.amount), unlockTime: BigInt(r.unlockTime) }))
        .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
      const tsSorted = [...stakerRec.pendingUnstake]
        .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

      if (onChainSorted.length !== tsSorted.length) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}staker ${stakerRec.address.slice(0, 10)} pending count`);
        console.error(`  on-chain : ${onChainSorted.length}`);
        console.error(`  expected : ${tsSorted.length}`);
        console.error('─'.repeat(60));
        assert.equal(onChainSorted.length, tsSorted.length, `${prefix}staker pending count`);
      }
      for (let i = 0; i < onChainSorted.length; i++) {
        const oc = onChainSorted[i];
        const ts = tsSorted[i];
        if (oc.amount !== ts.amount || oc.unlockTime !== ts.unlockTime) {
          console.error(`\n${'─'.repeat(60)}`);
          console.error(`FAIL: ${prefix}staker ${stakerRec.address.slice(0, 10)} pending[${i}]`);
          console.error(`  on-chain : amount=${oc.amount} unlockTime=${oc.unlockTime}`);
          console.error(`  expected : amount=${ts.amount} unlockTime=${ts.unlockTime}`);
          console.error('─'.repeat(60));
          assert.equal(oc.amount, ts.amount, `${prefix}staker pending[${i}].amount`);
          assert.equal(oc.unlockTime, ts.unlockTime, `${prefix}staker pending[${i}].unlockTime`);
        }
      }
    }

    // ── Staking: previewClaimableEth ─────────────────────────────────────────
    // Valid only immediately after a staking TX that calls _syncFees (stake, requestUnstake,
    // claimEthRewards). After _syncFees: stakingPoolBalance == currentPackedEarnings so
    // _previewAccEthPerShare returns accEthPerShare with zero diff.
    // The contract therefore returns:
    //   accrued[user] + cssvBalance * (accEthPerShare - userIndex[user]) / PRECISION
    // = staker.totalEthAmount + staker.cssvBalance * (accEthPerShare - staker.userIndex) / PRECISION
    // Only the TX maker has userIndex == accEthPerShare (pending=0); other stakers may have
    // accumulated unsettled rewards that the assertion must account for.
    const { accEthPerShare } = simState.network;
    for (const stakerRec of simState.stakers.values()) {
      const onChainClaimable = BigInt(await views.previewClaimableEth(stakerRec.address));
      const pending = stakerRec.cssvBalance * (accEthPerShare - stakerRec.userIndex) / PRECISION;
      const expected = stakerRec.totalEthAmount + pending;
      if (onChainClaimable !== expected) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}staker ${stakerRec.address.slice(0, 10)} previewClaimableEth`);
        console.error(`  on-chain : ${onChainClaimable}`);
        console.error(`  expected : ${expected} (settled=${stakerRec.totalEthAmount} pending=${pending})`);
        console.error(`  diff     : ${onChainClaimable > expected ? onChainClaimable - expected : expected - onChainClaimable}`);
        console.error(`  state    : accEthPerShare=${accEthPerShare} userIndex=${stakerRec.userIndex} cssvBalance=${stakerRec.cssvBalance}`);
        console.error('─'.repeat(60));
        assert.equal(onChainClaimable, expected, `${prefix}staker ${stakerRec.address.slice(0, 10)} previewClaimableEth`);
      }
    }

    // ── Staking: stakingEthPoolBalance == lastSyncedPackedEarnings ───────────
    {
      const onChainPool = BigInt(await views.stakingEthPoolBalance());
      const expected = simState.network.lastSyncedPackedEarnings;
      if (onChainPool !== expected) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}stakingEthPoolBalance`);
        console.error(`  on-chain : ${onChainPool}`);
        console.error(`  expected : ${expected}`);
        console.error('─'.repeat(60));
        assert.equal(onChainPool, expected, `${prefix}stakingEthPoolBalance`);
      }
    }

    // ── Staking: totalStaked == Σ cssvBalance ─────────────────────────────────
    {
      const onChainTotal = BigInt(await views.totalStaked());
      let tsTotal = 0n;
      for (const s of simState.stakers.values()) tsTotal += s.cssvBalance;
      if (onChainTotal !== tsTotal) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}totalStaked`);
        console.error(`  on-chain : ${onChainTotal}`);
        console.error(`  expected : ${tsTotal}`);
        console.error('─'.repeat(60));
        assert.equal(onChainTotal, tsTotal, `${prefix}totalStaked`);
      }
    }

    // ── Staking: getOracleWeight == totalCSSV / 4 ─────────────────────────────
    {
      const totalCSSV = BigInt(await views.totalStaked());
      if (totalCSSV > 0n) {
        const onChainWeight = BigInt(await views.getOracleWeight(1));
        const expectedWeight = totalCSSV / 4n;
        if (onChainWeight !== expectedWeight) {
          console.error(`\n${'─'.repeat(60)}`);
          console.error(`FAIL: ${prefix}oracle weight`);
          console.error(`  on-chain : ${onChainWeight}`);
          console.error(`  expected : ${expectedWeight} (totalCSSV=${totalCSSV})`);
          console.error('─'.repeat(60));
          assert.equal(onChainWeight, expectedWeight, `${prefix}oracle weight`);
        }
      }
    }
  }

  // ── Per-operator additional checks ───────────────────────────────────────
  // C. Operator ETH fee
  // D. ETH validator count (ethValidatorCount = effectiveBalance / 32)
  // E. SSV validator count
  for (const op of operators.values()) {
    if (op.isRemoved) continue;

    // C. ETH fee
    const onChainFee = BigInt(await views.getOperatorFee(op.id));
    if (onChainFee !== op.feeWei) {
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}operator ${op.id} ETH fee`);
      console.error(`  on-chain : ${onChainFee}`);
      console.error(`  expected : ${op.feeWei}`);
      console.error('─'.repeat(60));
      assert.equal(onChainFee, op.feeWei, `${prefix}operator ${op.id} ETH fee`);
    }

    // C. SSV fee (pre-migration operators only)
    if (op.ssvFeeWei > 0n) {
      const onChainFeeSSV = BigInt(await views.getOperatorFeeSSV(op.id));
      if (onChainFeeSSV !== op.ssvFeeWei) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}operator ${op.id} SSV fee`);
        console.error(`  on-chain : ${onChainFeeSSV}`);
        console.error(`  expected : ${op.ssvFeeWei}`);
        console.error('─'.repeat(60));
        assert.equal(onChainFeeSSV, op.ssvFeeWei, `${prefix}operator ${op.id} SSV fee`);
      }
    }

    // D. ETH validator count
    // ethValidatorCount on-chain = sum of validatorCount across all ACTIVE ETH clusters
    // that include this operator. It is NOT affected by oracle EB updates — those only
    // change the operator's ETH accounting accumulator, not the plain validator count.
    // op.effectiveBalance tracks total ETH for earnings math but diverges from validatorCount*32
    // once any cluster receives an oracle EB update.
    let tsEthValidatorCount = 0n;
    for (const c of clusters.values()) {
      if (c.active && c.version === VERSION_ETH && c.operatorIds.includes(op.id)) {
        tsEthValidatorCount += c.validatorCount;
      }
    }
    const onChainOpData = await views.getOperatorById(op.id);
    const onChainEthVc = BigInt(onChainOpData.validatorCount);
    if (onChainEthVc !== tsEthValidatorCount) {
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}operator ${op.id} ETH validator count`);
      console.error(`  on-chain : ${onChainEthVc}`);
      console.error(`  expected : ${tsEthValidatorCount} (effectiveBalance=${op.effectiveBalance})`);
      console.error('─'.repeat(60));
      assert.equal(onChainEthVc, tsEthValidatorCount, `${prefix}operator ${op.id} ETH validator count`);
    }

    // E. SSV validator count
    if (op.ssvFeeWei > 0n) {
      const onChainOpDataSSV = await views.getOperatorByIdSSV(op.id);
      const onChainSsvVc = BigInt(onChainOpDataSSV.validatorCount);
      if (onChainSsvVc !== op.ssvValidatorCount) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}operator ${op.id} SSV validator count`);
        console.error(`  on-chain : ${onChainSsvVc}`);
        console.error(`  expected : ${op.ssvValidatorCount}`);
        console.error('─'.repeat(60));
        assert.equal(onChainSsvVc, op.ssvValidatorCount, `${prefix}operator ${op.id} SSV validator count`);
      }
    }
  }

  // ── Per-cluster additional checks ────────────────────────────────────────
  for (const cluster of clusters.values()) {
    const structArg = {
      validatorCount:  cluster.lastStruct.validatorCount,
      networkFeeIndex: cluster.lastStruct.networkFeeIndex,
      index:           cluster.lastStruct.index,
      active:          cluster.lastStruct.active,
      balance:         cluster.lastStruct.balance,
    };

    // G. Cluster asset type (VERSION_ETH vs VERSION_SSV)
    const onChainType = BigInt(await views.getClusterAssetType(cluster.owner, cluster.operatorIds));
    if (onChainType !== cluster.version) {
      console.error(`\n${'─'.repeat(60)}`);
      console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} asset type`);
      console.error(`  on-chain : ${onChainType}`);
      console.error(`  expected : ${cluster.version}`);
      console.error('─'.repeat(60));
      assert.equal(onChainType, cluster.version, `${prefix}cluster ${cluster.id.slice(0, 14)} asset type`);
    }

    if (!cluster.active) {
      // F. isLiquidated — inactive clusters must be liquidated on-chain
      const onChainLiquidated = await views.isLiquidated(cluster.owner, cluster.operatorIds, structArg);
      if (!onChainLiquidated) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} should be liquidated on-chain`);
        console.error('─'.repeat(60));
        assert.ok(onChainLiquidated, `${prefix}cluster ${cluster.id.slice(0, 14)} isLiquidated`);
      }
      continue;
    }

    // Active cluster checks
    if (cluster.version === VERSION_ETH) {
      // A. Burn rate (wei per block)
      const onChainBurnRate = BigInt(await views.getBurnRate(cluster.owner, cluster.operatorIds, structArg));
      const tsBurnRate = burnPerBlock(cluster);
      if (onChainBurnRate !== tsBurnRate) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} ETH burn rate`);
        console.error(`  on-chain : ${onChainBurnRate}`);
        console.error(`  expected : ${tsBurnRate} (burnRate=${cluster.burnRate} effectiveBalance=${cluster.effectiveBalance})`);
        console.error(`  lastStruct: active=${cluster.lastStruct.active} validatorCount=${cluster.lastStruct.validatorCount}`);
        if (report) report.printTimeline([cluster.id], []);
        console.error('─'.repeat(60));
        assert.equal(onChainBurnRate, tsBurnRate, `${prefix}cluster ${cluster.id.slice(0, 14)} ETH burn rate`);
      }

      // H. Effective balance (whole ETH)
      const onChainEB = BigInt(await views.getEffectiveBalance(cluster.owner, cluster.operatorIds, structArg));
      const tsEB = cluster.effectiveBalance;
      if (onChainEB !== tsEB) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} effective balance`);
        console.error(`  on-chain : ${onChainEB} ETH`);
        console.error(`  expected : ${tsEB} ETH (effectiveBalance=${cluster.effectiveBalance} validatorCount=${cluster.validatorCount})`);
        if (report) report.printTimeline([cluster.id], []);
        console.error('─'.repeat(60));
        assert.equal(onChainEB, tsEB, `${prefix}cluster ${cluster.id.slice(0, 14)} effective balance`);
      }

      // I. isLiquidatable (ETH)
      const onChainLiq = await views.isLiquidatable(cluster.owner, cluster.operatorIds, structArg);
      const tsLiq = isLiquidatable(cluster, simState);
      if (onChainLiq !== tsLiq) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}cluster ${cluster.id.slice(0, 14)} isLiquidatable`);
        console.error(`  on-chain : ${onChainLiq}`);
        console.error(`  expected : ${tsLiq} (balance=${cluster.balance} burnRate=${tsBurnRate})`);
        console.error('─'.repeat(60));
        assert.equal(onChainLiq, tsLiq, `${prefix}cluster ${cluster.id.slice(0, 14)} isLiquidatable`);
      }
    } else {
      // B. Burn rate SSV (SSV wei per block)
      const onChainBurnRateSSV = BigInt(await views.getBurnRateSSV(cluster.owner, cluster.operatorIds, structArg));
      const tsBurnRateSSV = burnPerBlock(cluster);
      if (onChainBurnRateSSV !== tsBurnRateSSV) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}SSV cluster ${cluster.id.slice(0, 14)} burn rate`);
        console.error(`  on-chain : ${onChainBurnRateSSV}`);
        console.error(`  expected : ${tsBurnRateSSV} (ssvBurnRate=${cluster.ssvBurnRate} validatorCount=${cluster.validatorCount})`);
        console.error('─'.repeat(60));
        assert.equal(onChainBurnRateSSV, tsBurnRateSSV, `${prefix}SSV cluster ${cluster.id.slice(0, 14)} burn rate`);
      }

      // I. isLiquidatableSSV
      const onChainLiqSSV = await views.isLiquidatableSSV(cluster.owner, cluster.operatorIds, structArg);
      const tsLiqSSV = isLiquidatable(cluster, simState);
      if (onChainLiqSSV !== tsLiqSSV) {
        console.error(`\n${'─'.repeat(60)}`);
        console.error(`FAIL: ${prefix}SSV cluster ${cluster.id.slice(0, 14)} isLiquidatableSSV`);
        console.error(`  on-chain : ${onChainLiqSSV}`);
        console.error(`  expected : ${tsLiqSSV} (ssvBalance=${cluster.ssvBalance} burnRate=${tsBurnRateSSV})`);
        console.error('─'.repeat(60));
        assert.equal(onChainLiqSSV, tsLiqSSV, `${prefix}SSV cluster ${cluster.id.slice(0, 14)} isLiquidatableSSV`);
      }
    }
  }
}
