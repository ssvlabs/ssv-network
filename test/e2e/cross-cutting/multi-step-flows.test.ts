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
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcOperatorFeeAccrual,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
  snapshotContractBalance,
  checkETHConservation,
} from "../../helpers/index.ts";

describe("Cross-Cutting: Multi-Step Flows", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, clusterOwner2, staker, liquidator, oracle1, oracle2, oracle3] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Register → EB Update → Fee Change → Liquidation", () => {
    it("Correctly settles fees across EB update, fee change, and liquidation phases", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const stakeAmount = ethers.parseEther("100");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);

      const deposit = ethers.parseEther("5");
      const tx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const receipt1 = await tx1.wait();
      let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);

      const tx1b = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const receipt1b = await tx1b.wait();
      cluster = parseClusterFromEvent(network, receipt1b, Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(2n);

      await checkETHConservation(
        networkAddress, provider,
        [cluster.balance], [0n, 0n, 0n, 0n], 0n,
      );

      await mineBlocks(provider, 50);

      const tx2 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const receipt2 = await tx2.wait();
      cluster = parseClusterFromEvent(network, receipt2, Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(3n);

      expect(cluster.balance).to.be.lessThan(deposit);

      await mineBlocks(provider, 50);

      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);

      const blockForRoot = await getBlockNumber(provider);

      const clusterId = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
      );

      const entries = [{ clusterId, effectiveBalance: 192 }];
      const { root, proofs } = generateMerkleForClusterEB(connection, entries);

      await network.connect(oracle1).commitRoot(root, blockForRoot);
      await network.connect(oracle2).commitRoot(root, blockForRoot);
      await network.connect(oracle3).commitRoot(root, blockForRoot);

      const balanceBeforeEB = cluster.balance;
      const txEB = await network.updateClusterBalance(
        blockForRoot, clusterOwner.address, operatorIds, cluster, 192, proofs[clusterId],
      );
      const receiptEB = await txEB.wait();
      cluster = parseClusterFromEvent(network, receiptEB, Events.CLUSTER_BALANCE_UPDATED);
      const step3Block = receiptEB!.blockNumber;

      const expectedVUnits = calcVUnits(192n);
      expect(expectedVUnits).to.equal(60000n);

      expect(cluster.balance).to.be.lessThan(balanceBeforeEB);

      const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));

      const txDecl = await network.connect(operatorOwner).declareOperatorFee(
        operatorIds[0], newFee,
      );
      await txDecl.wait();

      const feePeriods = await views.getOperatorFeePeriods();
      const declareTimePeriod = BigInt(feePeriods[0]);
      await provider.send("evm_increaseTime", [Number(declareTimePeriod) + 1]);
      await mineBlocks(provider, 1);

      const txExec = await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);
      const receiptExec = await txExec.wait();
      const step5Block = receiptExec!.blockNumber;

      const opAfterFee = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opAfterFee.fee)).to.equal(BigInt(newFee));

      const newOpFeePacked = BigInt(newFee) / ETH_DEDUCTED_DIGITS;
      const currentBalance = BigInt(
        await views.getBalance(clusterOwner.address, operatorIds, cluster),
      );

      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 3n,
        ethFee: ethFeePacked,
        networkFee: 0n,
        effectiveVUnits: expectedVUnits,
      }) + calcClusterBurn({
        blockDiff: 1n,
        numOperators: 1n,
        ethFee: newOpFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: expectedVUnits,
      });

      if (burnPerBlock > 0n) {
        const blocksToLiquidation = currentBalance / burnPerBlock;
        await mineBlocks(provider, Number(blocksToLiquidation) + 200);
      }

      const isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
      if (isLiq) {
        const txLiq = await network.connect(liquidator).liquidate(
          clusterOwner.address, operatorIds, cluster,
        );
        const receiptLiq = await txLiq.wait();
        const clusterPostLiq = parseClusterFromEvent(network, receiptLiq, Events.CLUSTER_LIQUIDATED);

        expect(clusterPostLiq.active).to.be.false;
        expect(clusterPostLiq.balance).to.equal(0n);

        const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
        const op1Phase3 = calcOperatorFeeAccrual(
          BigInt(step5Block - step3Block), ethFeePacked, expectedVUnits,
        ) * ETH_DEDUCTED_DIGITS;
        expect(op1Earnings).to.be.greaterThanOrEqual(op1Phase3);

        const txWithdraw = await network.connect(operatorOwner).withdrawAllOperatorEarnings(operatorIds[0]);
        await txWithdraw.wait();

        const op1EarningsAfter = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
        expect(op1EarningsAfter).to.equal(0n);

        const contractETH = await snapshotContractBalance(provider, networkAddress);
        const opEarnings: bigint[] = [];
        for (const opId of operatorIds) {
          opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
        }
        const daoEarnings = BigInt(await views.getNetworkEarnings());
        const totalAccounted = opEarnings.reduce((a, b) => a + b, 0n) + daoEarnings;
        const diff = contractETH > totalAccounted
          ? contractETH - totalAccounted
          : totalAccounted - contractETH;
        expect(diff).to.be.lessThanOrEqual(ethers.parseEther("0.01"));
      }
    });
  });

  describe("Sequential Registration — Two Clusters, Same Operators", () => {
    it("Correctly tracks operator ETH state when two clusters register sequentially", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address, clusterOwner2.address,
      ]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;

      const depositA = ethers.parseEther("5");
      const txA = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositA },
      );
      const receiptA = await txA.wait();
      let clusterA = parseClusterFromEvent(network, receiptA, Events.VALIDATOR_ADDED);
      const blockA = receiptA!.blockNumber;

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op.validatorCount)).to.equal(1n);
      }

      await mineBlocks(provider, 100);

      const depositB = ethers.parseEther("10");
      const txB1 = await network.connect(clusterOwner2).registerValidator(
        makePublicKey(10), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositB },
      );
      const receiptB1 = await txB1.wait();
      let clusterB = parseClusterFromEvent(network, receiptB1, Events.VALIDATOR_ADDED);
      const blockB = receiptB1!.blockNumber;

      const txB2 = await network.connect(clusterOwner2).registerValidator(
        makePublicKey(11), operatorIds, DEFAULT_SHARES, clusterB,
        { value: 0n },
      );
      const receiptB2 = await txB2.wait();
      clusterB = parseClusterFromEvent(network, receiptB2, Events.VALIDATOR_ADDED);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op.validatorCount)).to.equal(3n);
      }

      const blockDiffPhase1 = BigInt(blockB - blockA);

      const blockB2 = receiptB2!.blockNumber;
      const perOpIndexAtB2 = BigInt(blockB2 - blockA) * ethFeePacked;
      const expectedMinIndex = 4n * perOpIndexAtB2;
      expect(clusterB.index).to.be.greaterThanOrEqual(expectedMinIndex);

      await mineBlocks(provider, 100);

      const expectedPerOpPhase1 =
        calcOperatorFeeAccrual(blockDiffPhase1, ethFeePacked, defaultVUnits(1n)) * ETH_DEDUCTED_DIGITS;
      const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
      expect(op1Earnings).to.be.greaterThan(expectedPerOpPhase1);

      const clusterABalance = BigInt(
        await views.getBalance(clusterOwner.address, operatorIds, clusterA),
      );
      const clusterBBalance = BigInt(
        await views.getBalance(clusterOwner2.address, operatorIds, clusterB),
      );
      const opEarnings: bigint[] = [];
      for (const opId of operatorIds) {
        opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
      }
      const daoEarnings = BigInt(await views.getNetworkEarnings());

      await checkETHConservation(
        networkAddress, provider,
        [clusterABalance, clusterBBalance],
        opEarnings, daoEarnings,
      );

      const daoValCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCount).to.equal(3n);
    });
  });

  describe("Governance Parameter Change Mid-Operation", () => {
    describe("Network Fee Update", () => {
      it("Correctly applies old fee for first half and new fee for second half", async function () {
        const { network, views } =
          await networkHelpers.loadFixture(deployFixture);
        const provider = connection.ethers.provider;

        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

        const opData = await views.getOperatorById(BigInt(operatorIds[0]));
        const ethFeePacked = BigInt(opData.fee) / ETH_DEDUCTED_DIGITS;
        const oldNetworkFeeWei = BigInt(await views.getNetworkFee());
        const oldNetworkFeePacked = oldNetworkFeeWei / ETH_DEDUCTED_DIGITS;

        const tx1 = await network.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        const receipt1 = await tx1.wait();
        let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);
        const registerBlock = receipt1!.blockNumber;

        await mineBlocks(provider, 100);

        const newNetworkFeeWei = oldNetworkFeeWei * 2n;
        const txFee = await network.updateNetworkFee(newNetworkFeeWei);
        const receiptFee = await txFee.wait();
        const feeChangeBlock = receiptFee!.blockNumber;

        const currentFee = BigInt(await views.getNetworkFee());
        expect(currentFee).to.equal(newNetworkFeeWei);

        await mineBlocks(provider, 100);

        const tx3 = await network.connect(clusterOwner).withdraw(
          operatorIds, 0n, cluster,
        );
        const receipt3 = await tx3.wait();
        cluster = parseClusterFromEvent(network, receipt3, Events.CLUSTER_WITHDRAWN);
        const withdrawBlock = receipt3!.blockNumber;

        const vUnits = defaultVUnits(1n);
        const blockDiff1 = BigInt(feeChangeBlock - registerBlock);
        const blockDiff2 = BigInt(withdrawBlock - feeChangeBlock);
        const newNetworkFeePacked = newNetworkFeeWei / ETH_DEDUCTED_DIGITS;

        const burn1 = calcClusterBurn({
          blockDiff: blockDiff1,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: oldNetworkFeePacked,
          effectiveVUnits: vUnits,
        });

        const burn2 = calcClusterBurn({
          blockDiff: blockDiff2,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: newNetworkFeePacked,
          effectiveVUnits: vUnits,
        });

        const totalBurn = burn1 + burn2;
        const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalBurn;

        expect(cluster.balance).to.equal(expectedBalance);

        const expectedDaoEarnings =
          (blockDiff1 * oldNetworkFeePacked + blockDiff2 * newNetworkFeePacked) * ETH_DEDUCTED_DIGITS;
        const daoEarnings = BigInt(await views.getNetworkEarnings());
        expect(daoEarnings).to.equal(expectedDaoEarnings);
      });
    });

    describe("Liquidation Threshold Update", () => {
      it("Cluster becomes liquidatable when threshold increases", async function () {
        const { network, views } =
          await networkHelpers.loadFixture(deployFixture);
        const provider = connection.ethers.provider;

        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

        const opData = await views.getOperatorById(BigInt(operatorIds[0]));
        const ethFeeWei = BigInt(opData.fee);
        const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
        const networkFeeWei = BigInt(await views.getNetworkFee());
        const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

        const currentThreshold = BigInt(await views.getLiquidationThresholdPeriod());

        const vUnits = defaultVUnits(1n);
        const thresholdBalance = calcLiquidationThreshold({
          minimumBlocksBeforeLiquidation: currentThreshold,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });

        const deposit = thresholdBalance + ethers.parseEther("0.1");
        const tx1 = await network.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: deposit },
        );
        const receipt1 = await tx1.wait();
        let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);

        await mineBlocks(provider, 100);

        let isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
        expect(isLiq).to.be.false;

        const newThreshold = currentThreshold * 2n;
        await network.updateLiquidationThresholdPeriod(newThreshold);

        const updatedThreshold = BigInt(await views.getLiquidationThresholdPeriod());
        expect(updatedThreshold).to.equal(newThreshold);

        const burnPerBlockWei = calcClusterBurn({
          blockDiff: 1n,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });
        const newThresholdBalance = calcLiquidationThreshold({
          minimumBlocksBeforeLiquidation: newThreshold,
          numOperators: 4n,
          ethFee: ethFeePacked,
          networkFee: networkFeePacked,
          effectiveVUnits: vUnits,
        });

        if (burnPerBlockWei > 0n) {
          const additionalNeeded = (deposit - newThresholdBalance) / burnPerBlockWei;
          const blocksToMine = Number(additionalNeeded) + 200;
          await mineBlocks(provider, blocksToMine);
        }

        isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
        expect(isLiq).to.be.true;

        const txLiq = await network.connect(liquidator).liquidate(
          clusterOwner.address, operatorIds, cluster,
        );
        const receiptLiq = await txLiq.wait();
        const liquidatedCluster = parseClusterFromEvent(
          network, receiptLiq, Events.CLUSTER_LIQUIDATED,
        );
        expect(liquidatedCluster.active).to.be.false;
      });
    });
  });

  describe("Fee declaration interleavings with EB updates", () => {
    it("declaring fee, then updating EB, then executing settles pre-exec blocks at old fee", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkAddress = await network.getAddress();
      const stakeAmount = ethers.parseEther("100");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);
      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);

      const registerTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(9101), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const registerReceipt = await registerTx.wait();
      const clusterAfterRegister = parseClusterFromEvent(network, registerReceipt, Events.VALIDATOR_ADDED);

      const clusterId = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
      );
      const oldFeeWei = BigInt((await views.getOperatorById(BigInt(operatorIds[0]))).fee);
      const oldFeePacked = oldFeeWei / ETH_DEDUCTED_DIGITS;

      const { root: root64, proofs: proofs64 } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      const rootBlock64 = await getBlockNumber(provider);
      await network.connect(oracle1).commitRoot(root64, rootBlock64);
      await network.connect(oracle2).commitRoot(root64, rootBlock64);
      await network.connect(oracle3).commitRoot(root64, rootBlock64);
      const txEb64 = await network.updateClusterBalance(
        rootBlock64, clusterOwner.address, operatorIds, clusterAfterRegister, 64, proofs64[clusterId],
      );
      const clusterAfterEb64 = parseClusterFromEvent(network, await txEb64.wait(), Events.CLUSTER_BALANCE_UPDATED);

      const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
      await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);

      const { root: root128, proofs: proofs128 } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 128 },
      ]);
      const rootBlock128 = await getBlockNumber(provider);
      await network.connect(oracle1).commitRoot(root128, rootBlock128);
      await network.connect(oracle2).commitRoot(root128, rootBlock128);
      await network.connect(oracle3).commitRoot(root128, rootBlock128);
      const txEb128 = await network.updateClusterBalance(
        rootBlock128, clusterOwner.address, operatorIds, clusterAfterEb64, 128, proofs128[clusterId],
      );
      const receiptEb128 = await txEb128.wait();
      const earningsBeforeExecute = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));

      const feePeriods = await views.getOperatorFeePeriods();
      const declareDelay = BigInt(feePeriods[0]);
      await provider.send("evm_increaseTime", [Number(declareDelay) + 1]);
      await mineBlocks(provider, 1);

      const execTx = await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);
      const execReceipt = await execTx.wait();
      const execBlock = BigInt(execReceipt!.blockNumber);
      const eb128Block = BigInt(receiptEb128!.blockNumber);

      const earningsAfterExecute = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
      const expectedDelta = calcOperatorFeeAccrual(
        execBlock - eb128Block,
        oldFeePacked,
        calcVUnits(128n),
      ) * ETH_DEDUCTED_DIGITS;
      expect(earningsAfterExecute - earningsBeforeExecute).to.equal(expectedDelta);

      const updatedOperator = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(updatedOperator.fee)).to.equal(BigInt(newFee));
    });

    it("executeOperatorFee reverts after operator removal on explicit-EB cluster", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkAddress = await network.getAddress();
      const stakeAmount = ethers.parseEther("100");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);
      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);

      const registerTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(9201), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterRegister = parseClusterFromEvent(network, await registerTx.wait(), Events.VALIDATOR_ADDED);

      const clusterId = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
      );
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      const rootBlock = await getBlockNumber(provider);
      await network.connect(oracle1).commitRoot(root, rootBlock);
      await network.connect(oracle2).commitRoot(root, rootBlock);
      await network.connect(oracle3).commitRoot(root, rootBlock);
      await network.updateClusterBalance(
        rootBlock, clusterOwner.address, operatorIds, clusterAfterRegister, 64, proofs[clusterId],
      );

      const declaredFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
      await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], declaredFee);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      const feePeriods = await views.getOperatorFeePeriods();
      const declareDelay = BigInt(feePeriods[0]);
      await provider.send("evm_increaseTime", [Number(declareDelay) + 1]);
      await mineBlocks(provider, 1);

      await expect(
        network.connect(operatorOwner).executeOperatorFee(operatorIds[0]),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });
});
