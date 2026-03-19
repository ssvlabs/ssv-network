import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  getValidOperatorFeeIncrease,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
  snapshotContractBalance,
  checkETHConservation,
  checkAccumulatorMonotonicity,
  checkCSSVSupplyConsistency,
} from "../../helpers/index.ts";

describe("Cross-Cutting: Full System Lifecycle", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, stakerA, oracle1, oracle2, oracle3] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  it("Exercises all modules through a complete system lifecycle", async function () {
    const { network, views, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployFixture);
    const networkAddress = await network.getAddress();

    const networkFeeWei = BigInt(await views.getNetworkFee());
    const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    const opData = await views.getOperatorById(BigInt(operatorIds[0]));
    const ethFeeWei = BigInt(opData.fee);
    const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;

    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const stakeAmount = ethers.parseEther("50");
    await ssvToken.transfer(stakerA.address, stakeAmount);
    await ssvToken.connect(stakerA).approve(networkAddress, stakeAmount);
    const txStake = await network.connect(stakerA).stake(stakeAmount);
    await txStake.wait();

    await checkCSSVSupplyConsistency(cssvToken, stakeAmount);
    let prevAccEthPerShare = BigInt(await views.accEthPerShare());

    const deposit = ethers.parseEther("10");
    const txReg = await network.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
      { value: deposit },
    );
    const receiptReg = await txReg.wait();
    let cluster = parseClusterFromEvent(network, receiptReg, Events.VALIDATOR_ADDED);

    expect(cluster.validatorCount).to.equal(1n);
    expect(cluster.balance).to.equal(deposit);
    expect(cluster.active).to.be.true;

    const daoValCount1 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount1).to.equal(1n);

    await checkETHConservation(
      networkAddress, connection.ethers.provider,
      [cluster.balance], [0n, 0n, 0n, 0n], 0n,
    );

    await mineBlocks(connection.ethers.provider, 100);

    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);

    const blockForRoot = await getBlockNumber(connection.ethers.provider);

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
    );

    const entries = [{ clusterId, effectiveBalance: 48 }];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);

    await network.connect(oracle1).commitRoot(root, blockForRoot);
    await network.connect(oracle2).commitRoot(root, blockForRoot);
    await network.connect(oracle3).commitRoot(root, blockForRoot);

    const txEB = await network.updateClusterBalance(
      blockForRoot, clusterOwner.address, operatorIds, cluster, 48, proofs[clusterId],
    );
    const receiptEB = await txEB.wait();
    cluster = parseClusterFromEvent(network, receiptEB, Events.CLUSTER_BALANCE_UPDATED);
    const ebUpdateBlock = receiptEB!.blockNumber;

    const newVUnits = calcVUnits(48n);
    expect(newVUnits).to.equal(15000n);

    expect(cluster.balance).to.be.lessThan(deposit);
    await mineBlocks(connection.ethers.provider, 100);

    const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
    const txDecl = await network.connect(operatorOwner).declareOperatorFee(
      operatorIds[0], newFee,
    );
    await txDecl.wait();

    const feePeriods = await views.getOperatorFeePeriods();
    const declareTimePeriod = BigInt(feePeriods[0]);
    await connection.ethers.provider.send("evm_increaseTime", [Number(declareTimePeriod) + 1]);
    await mineBlocks(connection.ethers.provider, 1);

    await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);

    const opAfterFee = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(opAfterFee.fee)).to.equal(BigInt(newFee));

    const txReg2 = await network.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
      { value: 0n },
    );
    const receiptReg2 = await txReg2.wait();
    cluster = parseClusterFromEvent(network, receiptReg2, Events.VALIDATOR_ADDED);

    expect(cluster.validatorCount).to.equal(2n);

    const daoValCount2 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount2).to.equal(2n);

    await mineBlocks(connection.ethers.provider, 100);

    const stakerABalanceBefore = await connection.ethers.provider.getBalance(stakerA.address);
    const txClaim = await network.connect(stakerA).claimEthRewards();
    const receiptClaim = await txClaim.wait();
    const stakerABalanceAfter = await connection.ethers.provider.getBalance(stakerA.address);
    const claimedAmount = stakerABalanceAfter - stakerABalanceBefore + receiptClaim!.gasUsed * receiptClaim!.gasPrice;

    const remainingDaoEarnings = BigInt(await views.getNetworkEarnings());
    expect(remainingDaoEarnings).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS);
    const accAtClaim = BigInt(await views.accEthPerShare());
    const expectedRewardRaw = (stakeAmount * accAtClaim) / (10n ** 18n);
    const expectedPayout = expectedRewardRaw - (expectedRewardRaw % ETH_DEDUCTED_DIGITS);
    expect(claimedAmount).to.equal(expectedPayout);

    const accAfterClaim = BigInt(await views.accEthPerShare());
    checkAccumulatorMonotonicity(prevAccEthPerShare, accAfterClaim);
    prevAccEthPerShare = accAfterClaim;

    const txRemove = await network.connect(clusterOwner).removeValidator(
      makePublicKey(1), operatorIds, cluster,
    );
    const receiptRemove = await txRemove.wait();
    cluster = parseClusterFromEvent(network, receiptRemove, Events.VALIDATOR_REMOVED);

    expect(cluster.validatorCount).to.equal(1n);
    expect(cluster.active).to.be.true;

    const daoValCount3 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount3).to.equal(1n);

    await mineBlocks(connection.ethers.provider, 100);

    const currentBalance = BigInt(
      await views.getBalance(clusterOwner.address, operatorIds, cluster),
    );

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

    const txRemove2 = await network.connect(clusterOwner).removeValidator(
      makePublicKey(2), operatorIds, cluster,
    );
    const receiptRemove2 = await txRemove2.wait();
    cluster = parseClusterFromEvent(network, receiptRemove2, Events.VALIDATOR_REMOVED);

    expect(cluster.validatorCount).to.equal(0n);

    const daoValCount4 = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount4).to.equal(0n);

    const txRemoveOp = await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    await txRemoveOp.wait();

    const opRemoved = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(opRemoved.isActive).to.be.false;

    const contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);
    const clusterBalance = cluster.balance;
    const opEarnings: bigint[] = [];
    for (const opId of operatorIds) {
      opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
    }
    const daoEarnings = BigInt(await views.getNetworkEarnings());

    await checkETHConservation(
      networkAddress, connection.ethers.provider,
      [clusterBalance], opEarnings, daoEarnings,
    );

    const finalDaoValCount = BigInt(await views.getNetworkValidatorsCount());
    let totalOpValCount = 0n;
    for (const opId of operatorIds) {
      const op = await views.getOperatorById(BigInt(opId));
      totalOpValCount += BigInt(op.validatorCount);
    }
    expect(finalDaoValCount).to.equal(0n);

    await checkCSSVSupplyConsistency(cssvToken, stakeAmount);

    const finalAcc = BigInt(await views.accEthPerShare());
    checkAccumulatorMonotonicity(prevAccEthPerShare, finalAcc);

    const totalAccounted = clusterBalance + opEarnings.reduce((a, b) => a + b, 0n) + daoEarnings;
    expect(contractETH).to.be.greaterThanOrEqual(totalAccounted);

    const dust = contractETH - totalAccounted;
    expect(dust).to.be.greaterThanOrEqual(0n);
    expect(dust).to.be.lessThanOrEqual(20n * ETH_DEDUCTED_DIGITS);
  });
});
