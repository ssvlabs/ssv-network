import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcOperatorFeeAccrual,
  calcVUnits,
  defaultVUnits,
  snapshotContractBalance,
  checkETHConservation,
} from "../../helpers/index.ts";

describe("Cross-Cutting: Economics", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, operatorOwner] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Full Economic Conservation Law", () => {
    it("conservation holds after every step (deposit, register, advance, withdraw, operator withdrawal)", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const networkAddress = await network.getAddress();

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const deposit1 = ethers.parseEther("10");
      const tx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit1 },
      );
      const receipt1 = await tx1.wait();
      let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);

      let contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);
      expect(contractETH).to.equal(deposit1);
      expect(cluster.balance).to.equal(deposit1);
      await checkETHConservation(networkAddress, connection.ethers.provider, [cluster.balance], [0n, 0n, 0n, 0n], 0n);

      const deposit2 = ethers.parseEther("5");
      const tx2 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: deposit2 },
      );
      const receipt2 = await tx2.wait();
      cluster = parseClusterFromEvent(network, receipt2, Events.VALIDATOR_ADDED);

      contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);
      expect(contractETH).to.equal(deposit1 + deposit2);

      await checkETHConservation(
        networkAddress, connection.ethers.provider,
        [cluster.balance], [0n, 0n, 0n, 0n], 0n,
      );

      await mineBlocks(connection.ethers.provider, 100);

      await checkETHConservation(
        networkAddress, connection.ethers.provider,
        [cluster.balance], [0n, 0n, 0n, 0n], 0n,
      );

      const withdrawAmount = ethers.parseEther("1");
      const tx4 = await network.connect(clusterOwner).withdraw(
        operatorIds, withdrawAmount, cluster,
      );
      const receipt4 = await tx4.wait();
      cluster = parseClusterFromEvent(network, receipt4, Events.CLUSTER_WITHDRAWN);

      contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);
      expect(contractETH).to.equal(deposit1 + deposit2 - withdrawAmount);

      await checkETHConservation(
        networkAddress, connection.ethers.provider,
        [cluster.balance], [0n, 0n, 0n, 0n], 0n,
      );

      const tx5 = await network.connect(operatorOwner).withdrawAllOperatorEarnings(operatorIds[0]);
      await tx5.wait();

      const txSettle = await network.connect(clusterOwner).withdraw(
        operatorIds, 0n, cluster,
      );
      const receiptSettle = await txSettle.wait();
      cluster = parseClusterFromEvent(network, receiptSettle, Events.CLUSTER_WITHDRAWN);

      contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);

      const opEarnings: bigint[] = [];
      for (let i = 0; i < operatorIds.length; i++) {
        const earnings = await views.getOperatorEarnings(BigInt(operatorIds[i]));
        opEarnings.push(BigInt(earnings));
      }

      const daoEarnings = BigInt(await views.getNetworkEarnings());

      await checkETHConservation(
        networkAddress, connection.ethers.provider,
        [cluster.balance], opEarnings, daoEarnings,
      );

      const totalAccounted = cluster.balance + opEarnings.reduce((a, b) => a + b, 0n) + daoEarnings;
      const dust = contractETH - totalAccounted;
      expect(dust).to.be.greaterThanOrEqual(0n);
      expect(dust).to.be.lessThanOrEqual(10n * ETH_DEDUCTED_DIGITS);
    });
  });

  describe("Register -> Advance -> Verify Full Economics (Exact Numbers)", () => {
    it("Produces exact operator earnings, cluster balance, and DAO earnings after 100 blocks", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const networkAddress = await network.getAddress();

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const deposit = ethers.parseEther("10");
      const tx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const receipt1 = await tx1.wait();
      let cluster = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);
      const registerBlock = receipt1!.blockNumber;

      await mineBlocks(connection.ethers.provider, 100);

      const tx3 = await network.connect(clusterOwner).withdraw(
        operatorIds, 0n, cluster,
      );
      const receipt3 = await tx3.wait();
      cluster = parseClusterFromEvent(network, receipt3, Events.CLUSTER_WITHDRAWN);
      const settlementBlock = receipt3!.blockNumber;
      const blockDiff = BigInt(settlementBlock - registerBlock);

      const vUnits = defaultVUnits(1n);
      const numOps = 4n;

      const perOpAccrual = calcOperatorFeeAccrual(blockDiff, ethFeePacked, vUnits);
      const perOpEarningsWei = perOpAccrual * ETH_DEDUCTED_DIGITS;
      const totalOpEarningsWei = perOpEarningsWei * numOps;

      const clusterBurn = calcClusterBurn({
        blockDiff,
        numOperators: numOps,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: vUnits,
      });

      const expectedClusterBalance = deposit - clusterBurn;

      const daoEarningsPacked = (blockDiff * networkFeePacked * vUnits) / BPS_DENOMINATOR;
      const expectedDaoEarningsWei = daoEarningsPacked * ETH_DEDUCTED_DIGITS;

      expect(cluster.balance).to.equal(expectedClusterBalance);

      for (const opId of operatorIds) {
        const earnings = BigInt(await views.getOperatorEarnings(BigInt(opId)));
        expect(earnings).to.equal(perOpEarningsWei);
      }

      const daoEarnings = BigInt(await views.getNetworkEarnings());
      expect(daoEarnings).to.equal(expectedDaoEarningsWei);

      const totalAccountedWei = expectedClusterBalance + totalOpEarningsWei + expectedDaoEarningsWei;
      expect(totalAccountedWei).to.equal(deposit);

      const contractETH = await snapshotContractBalance(connection.ethers.provider, networkAddress);
      expect(contractETH).to.equal(deposit);
    });
  });

  describe("Operator Serving Multiple Clusters with Different EBs", () => {
    it("Correctly accumulates vUnit deviations and adjusts earnings after liquidation", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const clusterOwnerA = signers[11];
      const clusterOwnerB = signers[12];
      const staker = signers[13];
      const liquidator = signers[14];
      const networkAddress = await network.getAddress();

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
        clusterOwnerB.address,
      ]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;
      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const stakeAmount = ethers.parseEther("100");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);

      const depositA = ethers.parseEther("2");
      const txA1 = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositA },
      );
      const receiptA1 = await txA1.wait();
      let clusterA = parseClusterFromEvent(network, receiptA1, Events.VALIDATOR_ADDED);

      const depositB = ethers.parseEther("50");
      const txB1 = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositB },
      );
      const receiptB1 = await txB1.wait();
      let clusterB = parseClusterFromEvent(network, receiptB1, Events.VALIDATOR_ADDED);

      const opAfterReg = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opAfterReg.validatorCount)).to.equal(2n);

      const oracle1 = signers[15];
      const oracle2 = signers[16];
      const oracle3 = signers[17];
      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);

      await mineBlocks(provider, 10);
      const blockForRoot = await getBlockNumber(provider);

      const clusterIdA = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwnerA.address, operatorIds]),
      );
      const clusterIdB = ethers.keccak256(
        ethers.solidityPacked(["address", "uint64[]"], [clusterOwnerB.address, operatorIds]),
      );

      const entries = [
        { clusterId: clusterIdA, effectiveBalance: 64 },
        { clusterId: clusterIdB, effectiveBalance: 48 },
      ];
      const { root, proofs } = generateMerkleForClusterEB(connection, entries);

      await mineBlocks(provider, 1);
      for (const oracle of [oracle1, oracle2, oracle3]) {
        await network.connect(oracle).commitRoot(root, BigInt(blockForRoot));
      }

      const txEBA = await network.updateClusterBalance(
        blockForRoot, clusterOwnerA.address, operatorIds, clusterA, 64, proofs[clusterIdA],
      );
      const receiptEBA = await txEBA.wait();
      clusterA = parseClusterFromEvent(network, receiptEBA, Events.CLUSTER_BALANCE_UPDATED);
      const vUnitsA = calcVUnits(64n);
      expect(vUnitsA).to.equal(20000n);

      const txEBB = await network.updateClusterBalance(
        blockForRoot, clusterOwnerB.address, operatorIds, clusterB, 48, proofs[clusterIdB],
      );
      const receiptEBB = await txEBB.wait();
      clusterB = parseClusterFromEvent(network, receiptEBB, Events.CLUSTER_BALANCE_UPDATED);
      const vUnitsB = calcVUnits(48n);
      expect(vUnitsB).to.equal(15000n);

      await mineBlocks(provider, 100);

      const postEBBlocks = 100n;
      const opEffectiveVUnitsPostEB = 35000n;
      const postEBEarningsPacked = calcOperatorFeeAccrual(postEBBlocks, ethFeePacked, opEffectiveVUnitsPostEB);
      const postEBEarningsWei = postEBEarningsPacked * ETH_DEDUCTED_DIGITS;
      const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
      expect(op1Earnings).to.be.greaterThanOrEqual(postEBEarningsWei);

      const burnRateA = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: vUnitsA,
      });

      const isLiqA = await views.isLiquidatable(clusterOwnerA.address, operatorIds, clusterA);
      if (!isLiqA) {
        const currentBalance = BigInt(clusterA.balance);
        const blocksToLiquidation = currentBalance / burnRateA;
        await mineBlocks(provider, Number(blocksToLiquidation) + 100);
      }

      await network.connect(liquidator).liquidate(
        clusterOwnerA.address, operatorIds, clusterA,
      );

      await mineBlocks(provider, 100);

      const daoValCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCount).to.equal(1n);

      const txSettleB = await network.connect(clusterOwnerB).withdraw(
        operatorIds, 0n, clusterB,
      );
      const receiptSettleB = await txSettleB.wait();
      clusterB = parseClusterFromEvent(network, receiptSettleB, Events.CLUSTER_WITHDRAWN);

      const opEarnings: bigint[] = [];
      for (const opId of operatorIds) {
        opEarnings.push(BigInt(await views.getOperatorEarnings(BigInt(opId))));
      }

      const regBBlock = BigInt(receiptB1!.blockNumber);
      const ebBBlock = BigInt(receiptEBB!.blockNumber);
      const settleBBlock = BigInt(receiptSettleB!.blockNumber);
      const burnPhase1 = calcClusterBurn({
        blockDiff: ebBBlock - regBBlock,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const burnPhase2 = calcClusterBurn({
        blockDiff: settleBBlock - ebBBlock,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: vUnitsB,
      });
      const expectedClusterBBalance = depositB - burnPhase1 - burnPhase2;
      expect(clusterB.balance).to.equal(expectedClusterBBalance);

      const postLiqEarningsPacked = calcOperatorFeeAccrual(100n, ethFeePacked, vUnitsB);
      const postLiqEarningsWei = postLiqEarningsPacked * ETH_DEDUCTED_DIGITS;
      for (const earnings of opEarnings) {
        expect(earnings).to.be.greaterThanOrEqual(postLiqEarningsWei);
      }
    });
  });
});
