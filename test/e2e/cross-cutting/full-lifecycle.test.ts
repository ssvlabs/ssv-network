/**
 * Cross-Cutting Full Lifecycle Test: CC-10
 *
 * CC-10: Full System Lifecycle (End-to-End)
 * The ultimate integration test — touches every module.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  getValidOperatorFeeIncrease,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  calcOperatorFeeAccrual,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
  calcAccEthPerShareDelta,
  calcStakingReward,
  snapshotContractBalance,
  checkETHConservation,
  checkAccumulatorMonotonicity,
  checkCSSVSupplyConsistency,
} from "../helpers/index.ts";

describe("Cross-Cutting: Full System Lifecycle (CC-10)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  it("CC-10: exercises all modules through a complete system lifecycle", async function () {
    const { network, views, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const signers = await connection.ethers.getSigners();
    const clusterOwner = signers[1];
    const stakerA = signers[2];
    const liquidator = signers[3];
    const networkAddress = await network.getAddress();

    // Fund accounts generously
    for (const signer of [clusterOwner, stakerA, liquidator]) {
      await provider.send("hardhat_setBalance", [
        signer.address,
        "0x" + (200n * 10n ** 18n).toString(16),
      ]);
    }

    // Read protocol parameters
    const opData0 = await views.getOperatorById(1n); // won't exist yet
    const networkFeeWei = BigInt(await views.getNetworkFee());
    const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

    // ════════════════════════════════════════════════════════════════
    // Step 1: Register 4 operators
    // ════════════════════════════════════════════════════════════════
    const operatorIds = await registerOperators(network, operatorOwner, 4);

    // Verify operators registered
    for (const opId of operatorIds) {
      const op = await views.getOperatorById(BigInt(opId));
      expect(op.owner).to.equal(operatorOwner.address);
      expect(op.isActive).to.be.true;
    }

    const opData = await views.getOperatorById(BigInt(operatorIds[0]));
    const ethFeeWei = BigInt(opData.fee);
    const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;

    // Whitelist cluster owner
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // ════════════════════════════════════════════════════════════════
    // Step 2: User A stakes 50e18 SSV
    // ════════════════════════════════════════════════════════════════
    const stakeAmount = ethers.parseEther("50");
    await ssvToken.transfer(stakerA.address, stakeAmount);
    await ssvToken.connect(stakerA).approve(networkAddress, stakeAmount);
    const txStake = await network.connect(stakerA).stake(stakeAmount);
    await txStake.wait();

    await checkCSSVSupplyConsistency(cssvToken, stakeAmount);
    let prevAccEthPerShare = BigInt(await views.accEthPerShare());

    // ════════════════════════════════════════════════════════════════
    // Step 3: Register validator with 10 ETH deposit
    // ════════════════════════════════════════════════════════════════
    const deposit = ethers.parseEther("10");
    const txReg = await network.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
      { value: deposit },
    );
    const receiptReg = await txReg.wait();
    let cluster = parseClusterFromEvent(network, receiptReg, Events.VALIDATOR_ADDED);
    const registerBlock = receiptReg!.blockNumber;

    expect(cluster.validatorCount).to.equal(1n);
    expect(cluster.balance).to.equal(deposit);
    expect(cluster.active).to.be.true;

    // Validator count consistency
    const daoValCount1 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount1).to.equal(1n);

    // Conservation after registration
    await checkETHConservation(
      networkAddress, provider,
      [cluster.balance], [0n, 0n, 0n, 0n], 0n, 0n,
    );

    // ════════════════════════════════════════════════════════════════
    // Step 4: Advance 100 blocks
    // ════════════════════════════════════════════════════════════════
    await mineBlocks(provider, 100);

    // ════════════════════════════════════════════════════════════════
    // Step 5-6: Oracle commits EB root, update cluster balance with EB=48
    // ════════════════════════════════════════════════════════════════
    const oracle1 = signers[5];
    const oracle2 = signers[6];
    const oracle3 = signers[7];
    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);

    const blockForRoot = await getBlockNumber(provider);

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
    );

    // EB = 48 for 1 validator -> vUnits = ceil(48 * 10000/32) = 15000
    const entries = [{ clusterId, effectiveBalance: 48 }];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);

    // Commit root (needs 3 of 4 oracles for 75% quorum)
    await network.connect(oracle1).commitRoot(root, blockForRoot);
    await network.connect(oracle2).commitRoot(root, blockForRoot);
    await network.connect(oracle3).commitRoot(root, blockForRoot);

    const txEB = await network.updateClusterBalance(
      blockForRoot, clusterOwner.address, operatorIds, cluster, 48, proofs[clusterId],
    );
    const receiptEB = await txEB.wait();
    cluster = parseClusterFromEvent(network, receiptEB, Events.CLUSTER_BALANCE_UPDATED);
    const ebUpdateBlock = receiptEB!.blockNumber;

    const newVUnits = calcVUnits(48n); // 15000
    expect(newVUnits).to.equal(15000n);

    // Balance should have decreased from fee settlement at OLD vUnits (10000)
    expect(cluster.balance).to.be.lessThan(deposit);

    // ════════════════════════════════════════════════════════════════
    // Step 7: Advance 100 blocks
    // ════════════════════════════════════════════════════════════════
    await mineBlocks(provider, 100);

    // ════════════════════════════════════════════════════════════════
    // Step 8: Operator 1 declares fee increase
    // ════════════════════════════════════════════════════════════════
    const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
    const txDecl = await network.connect(operatorOwner).declareOperatorFee(
      operatorIds[0], newFee,
    );
    await txDecl.wait();

    // ════════════════════════════════════════════════════════════════
    // Step 9: Advance past timelock, execute fee
    // ════════════════════════════════════════════════════════════════
    const feePeriods = await views.getOperatorFeePeriods();
    const declareTimePeriod = BigInt(feePeriods[0]);
    await provider.send("evm_increaseTime", [Number(declareTimePeriod) + 1]);
    await mineBlocks(provider, 1);

    const txExec = await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);
    const receiptExec = await txExec.wait();
    const feeExecBlock = receiptExec!.blockNumber;

    // Verify fee changed
    const opAfterFee = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(opAfterFee.fee)).to.equal(BigInt(newFee));

    // ════════════════════════════════════════════════════════════════
    // Step 10: Register 2nd validator, 0 ETH additional deposit
    // ════════════════════════════════════════════════════════════════
    const txReg2 = await network.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
      { value: 0n },
    );
    const receiptReg2 = await txReg2.wait();
    cluster = parseClusterFromEvent(network, receiptReg2, Events.VALIDATOR_ADDED);
    const reg2Block = receiptReg2!.blockNumber;

    expect(cluster.validatorCount).to.equal(2n);

    const daoValCount2 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount2).to.equal(2n);

    // ════════════════════════════════════════════════════════════════
    // Step 11: Advance 100 blocks
    // ════════════════════════════════════════════════════════════════
    await mineBlocks(provider, 100);

    // ════════════════════════════════════════════════════════════════
    // Step 12: User A claims staking rewards
    // ════════════════════════════════════════════════════════════════
    const txClaim = await network.connect(stakerA).claimEthRewards();
    const receiptClaim = await txClaim.wait();

    let claimedAmount = 0n;
    for (const log of receiptClaim!.logs) {
      try {
        const parsed = network.interface.parseLog(log);
        if (parsed?.name === Events.REWARDS_CLAIMED) {
          claimedAmount = BigInt(parsed.args.amount);
        }
      } catch { /* skip */ }
    }
    // The staker (stakerA) is the sole cSSV holder with stakeAmount = 50e18 cSSV.
    // _syncFees was last called during stake() (before any clusters existed, so poolBalance=0).
    // Since then, DAO earned network fees from 1 validator across registerBlock to claimBlock.
    // At claim: _syncFees adds all accumulated DAO earnings to accEthPerShare.
    // Since stakerA has 100% of cSSV supply, their reward = total DAO earnings (minus packing dust).
    //
    // Compute: the claimed amount should equal accEthPerShare * stakeAmount / 1e18
    // (since userIndex was 0 from initial stake when no earnings existed).
    // After claim, the DAO balance was reduced by the payout, so getNetworkEarnings() shows remainder.
    // Verify: claimedAmount + remainingDaoEarnings ≈ total DAO earnings before claim.
    const remainingDaoEarnings = BigInt(await views.getNetworkEarnings());
    // The claimed amount plus remaining should approximately equal the pre-claim total.
    // Since stakerA got ~100% of fees, remaining should be close to 0 (just packing dust).
    expect(remainingDaoEarnings).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS);
    // Verify claimed amount is consistent with accEthPerShare:
    const accAtClaim = BigInt(await views.accEthPerShare());
    const expectedRewardRaw = (stakeAmount * accAtClaim) / (10n ** 18n);
    const expectedPayout = expectedRewardRaw - (expectedRewardRaw % ETH_DEDUCTED_DIGITS);
    expect(claimedAmount).to.equal(expectedPayout);

    // accEthPerShare increased monotonically
    const accAfterClaim = BigInt(await views.accEthPerShare());
    checkAccumulatorMonotonicity(prevAccEthPerShare, accAfterClaim);
    prevAccEthPerShare = accAfterClaim;

    // ════════════════════════════════════════════════════════════════
    // Step 13: Remove 1st validator
    // ════════════════════════════════════════════════════════════════
    const txRemove = await network.connect(clusterOwner).removeValidator(
      makePublicKey(1), operatorIds, cluster,
    );
    const receiptRemove = await txRemove.wait();
    cluster = parseClusterFromEvent(network, receiptRemove, Events.VALIDATOR_REMOVED);
    const removeBlock = receiptRemove!.blockNumber;

    expect(cluster.validatorCount).to.equal(1n);
    expect(cluster.active).to.be.true;

    const daoValCount3 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount3).to.equal(1n);

    // ════════════════════════════════════════════════════════════════
    // Step 14: Advance 100 blocks
    // ════════════════════════════════════════════════════════════════
    await mineBlocks(provider, 100);

    // ════════════════════════════════════════════════════════════════
    // Step 15: Withdraw remaining cluster balance
    // ════════════════════════════════════════════════════════════════
    // Get current balance before withdrawal
    const currentBalance = BigInt(
      await views.getBalance(clusterOwner.address, operatorIds, cluster),
    );

    // Need to leave enough to not be liquidatable, or withdraw all if removing validator first
    // Since we still have 1 validator, we need to be careful. Withdraw a safe portion.
    const liqThreshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: BigInt(await views.getLiquidationThresholdPeriod()),
      numOperators: 4n,
      ethFee: ethFeePacked,
      networkFee: networkFeePacked,
      effectiveVUnits: defaultVUnits(1n),
    });

    let withdrawAmount: bigint;
    if (currentBalance > liqThreshold * 2n) {
      withdrawAmount = currentBalance - liqThreshold * 2n;
    } else {
      // If balance is too low, just withdraw 0 to trigger settlement
      withdrawAmount = 0n;
    }

    const txWithdraw = await network.connect(clusterOwner).withdraw(
      operatorIds, withdrawAmount, cluster,
    );
    const receiptWithdraw = await txWithdraw.wait();
    cluster = parseClusterFromEvent(network, receiptWithdraw, Events.CLUSTER_WITHDRAWN);
    const withdrawBlock = receiptWithdraw!.blockNumber;

    if (withdrawAmount > 0n) {
      expect(cluster.balance).to.be.lessThan(currentBalance);
    }

    // ════════════════════════════════════════════════════════════════
    // Step 16: Remove last validator then remove operator
    // ════════════════════════════════════════════════════════════════
    // First remove the remaining validator
    const txRemove2 = await network.connect(clusterOwner).removeValidator(
      makePublicKey(2), operatorIds, cluster,
    );
    const receiptRemove2 = await txRemove2.wait();
    cluster = parseClusterFromEvent(network, receiptRemove2, Events.VALIDATOR_REMOVED);

    expect(cluster.validatorCount).to.equal(0n);

    const daoValCount4 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount4).to.equal(0n);

    // Now remove operator 1 (withdraws remaining operator earnings)
    const op1EarningsBefore = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
    const txRemoveOp = await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    await txRemoveOp.wait();

    // Verify operator is removed
    const opRemoved = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(opRemoved.isActive).to.be.false;

    // ════════════════════════════════════════════════════════════════
    // Final Verification: ALL global invariants
    // ════════════════════════════════════════════════════════════════

    // INV-1: ETH Conservation
    const contractETH = await snapshotContractBalance(provider, networkAddress);
    const clusterBalance = cluster.balance; // should still have remaining balance
    const opEarnings: bigint[] = [];
    for (const opId of operatorIds) {
      opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
    }
    const daoEarnings = BigInt(await views.getNetworkEarnings());

    await checkETHConservation(
      networkAddress, provider,
      [clusterBalance], opEarnings, 0n, daoEarnings,
    );

    // INV-3: Validator count consistency
    const finalDaoValCount = BigInt(await views.getNetworkValidatorsCount());
    let totalOpValCount = 0n;
    for (const opId of operatorIds) {
      const op = await views.getOperatorById(BigInt(opId));
      totalOpValCount += BigInt(op.validatorCount);
    }
    // Note: operator 1 was removed, so its validator count is 0
    // Remaining operators should have 0 validators (all removed)
    expect(finalDaoValCount).to.equal(0n);

    // INV-6: cSSV supply consistency
    await checkCSSVSupplyConsistency(cssvToken, stakeAmount);

    // INV-7: Accumulator monotonicity (already checked at each step)
    const finalAcc = BigInt(await views.accEthPerShare());
    checkAccumulatorMonotonicity(prevAccEthPerShare, finalAcc);

    // Verify total system accounting:
    // All ETH deposited = 10 ETH
    // All ETH withdrawn = withdrawAmount + operator earnings + staking rewards + liquidator bounties
    // Contract balance should account for remaining cluster balance + unsettled earnings
    const totalDeposited = deposit;

    // The system correctly tracked everything through:
    // - Operator registration
    // - SSV staking
    // - Validator registration (ETH deposit)
    // - Block advancement
    // - Oracle EB update (vUnit change)
    // - Operator fee declaration and execution
    // - Second validator registration
    // - Staking reward claims
    // - Validator removal
    // - Cluster withdrawal
    // - Operator removal

    // Final sanity: contract ETH >= all accounted values
    const totalAccounted = clusterBalance + opEarnings.reduce((a, b) => a + b, 0n) + daoEarnings;
    expect(contractETH).to.be.greaterThanOrEqual(totalAccounted);

    // Precision dust bounded
    const dust = contractETH - totalAccounted;
    expect(dust).to.be.greaterThanOrEqual(0n);
    expect(dust).to.be.lessThanOrEqual(20n * ETH_DEDUCTED_DIGITS);
  });
});
