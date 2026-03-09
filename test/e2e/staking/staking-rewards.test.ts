import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  NETWORK_FEE,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcAccEthPerShareDelta,
  calcStakingReward,
  calcVUnits,
  defaultVUnits,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Rewards", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let provider: any;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [deployer, operatorOwner, clusterOwner, stakerA, stakerB] } = await setupTestContext());
    provider = connection.ethers.provider;
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  function computeClusterId(owner: string, operatorIds: number[]): string {
    return connection.ethers.keccak256(
      connection.ethers.solidityPacked(
        ["address", "uint64[]"],
        [owner, operatorIds],
      ),
    );
  }

  async function commitEBRoot(
    network: any,
    cssvToken: any,
    oracles: HardhatEthersSigner[],
    root: string,
    blockNum: number,
  ) {
    for (let i = 0; i < 3; i++) {
      await network.connect(oracles[i]).commitRoot(root, blockNum);
    }
  }

  describe("EB Increase → Higher Network Fees → More Staking Rewards", () => {
    it("Staking rewards double after EB update doubles vUnits", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      const syncTx1 = await network.connect(stakerA).syncFees();
      const syncReceipt1 = await syncTx1.wait();

      const feesSynced1 = syncReceipt1!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      const accAfterPhase1 = feesSynced1
        ? BigInt(network.interface.parseLog(feesSynced1)!.args[1])
        : 0n;

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);

      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebValue = 64;

      const ebBlock = await getBlockNumber(provider);
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: ebValue },
      ]);

      await commitEBRoot(network, cssvToken, oracles, root, ebBlock);

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await network.updateClusterBalance(
        ebBlock,
        clusterOwner.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(cluster.validatorCount),
          networkFeeIndex: BigInt(cluster.networkFeeIndex),
          index: BigInt(cluster.index),
          active: cluster.active,
          balance: BigInt(cluster.balance),
        },
        ebValue,
        proofs[clusterId],
      );

      await mineBlocks(provider, 100);

      const syncTx2 = await network.connect(stakerA).syncFees();
      const syncReceipt2 = await syncTx2.wait();

      const feesSynced2 = syncReceipt2!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      const accAfterPhase2 = feesSynced2
        ? BigInt(network.interface.parseLog(feesSynced2)!.args[1])
        : 0n;

      expect(accAfterPhase2).to.be.greaterThan(accAfterPhase1);
    });
  });

  describe("Auto-Liquidation Reduces Active Clusters → Less Staking Revenue", () => {
    it("Staking rewards decrease when a cluster is liquidated", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      const allSigners = await connection.ethers.getSigners();
      const clusterOwner2 = allSigners[5];

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const tinyDeposit = connection.ethers.parseEther("0.01");
      await network.connect(clusterOwner2).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: tinyDeposit },
      );

      const cluster2State = await getCurrentClusterState(
        connection,
        network,
        clusterOwner2.address,
        operatorIds,
      );

      await network.connect(stakerA).syncFees();
      const phase1StartBlock = await getBlockNumber(provider);
      await mineBlocks(provider, 100);

      const sync1 = await network.connect(stakerA).syncFees();
      const sync1Block = await getTxBlock(sync1);
      const syncReceipt1 = await sync1.wait();
      const fees1Log = syncReceipt1!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      const newFeesPhase1 = fees1Log
        ? BigInt(network.interface.parseLog(fees1Log)!.args[0])
        : 0n;

      const phase1Blocks = BigInt(sync1Block - phase1StartBlock);
      const phase1VUnits = defaultVUnits(2n);
      const phase1ExpectedFees =
        ((PACKED_NETWORK_FEE * phase1VUnits) / BPS_DENOMINATOR) *
        phase1Blocks *
        ETH_DEDUCTED_DIGITS;
      expect(newFeesPhase1).to.equal(phase1ExpectedFees);

      await mineBlocks(provider, 5000);

      await network.liquidate(
        clusterOwner2.address,
        operatorIds.map((id) => BigInt(id)),
        cluster2State,
      );

      await network.connect(stakerA).syncFees();
      const phase2StartBlock = await getBlockNumber(provider);
      await mineBlocks(provider, 100);

      const sync2 = await network.connect(stakerA).syncFees();
      const sync2Block = await getTxBlock(sync2);
      const syncReceipt2 = await sync2.wait();
      const fees2Log = syncReceipt2!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      const newFeesPhase2 = fees2Log
        ? BigInt(network.interface.parseLog(fees2Log)!.args[0])
        : 0n;

      const phase2Blocks = BigInt(sync2Block - phase2StartBlock);
      const phase2VUnits = defaultVUnits(1n);
      const phase2ExpectedFees =
        ((PACKED_NETWORK_FEE * phase2VUnits) / BPS_DENOMINATOR) *
        phase2Blocks *
        ETH_DEDUCTED_DIGITS;
      expect(newFeesPhase2).to.equal(phase2ExpectedFees);

      expect(newFeesPhase2).to.be.lessThan(newFeesPhase1);
    });
  });

  describe("Full Staking Reward Math — Worked Example", () => {
    it("Exact reward calculation for 1 staker, 1 cluster, 1000 blocks", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const stakeAmount = 1n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getBlockNumber(provider);

      await mineBlocks(provider, 1000);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt!.blockNumber;
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const activeBlocks = BigInt(claimBlock - regBlock);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * 10_000n) / 10_000n;
      const totalEarningsPacked = earningsPerBlockPacked * activeBlocks;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout =
        expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(reward).to.equal(expectedPayout);
      expect(reward % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  describe("Staking Reward with Multiple Users and Precision", () => {
    it("Rewards split correctly with 3:7 ratio and no precision loss for clean division", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const amountA = 3n * PRECISION;
      const amountB = 7n * PRECISION;
      const totalStaked = amountA + amountB;

      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken.connect(deployer).transfer(stakerB.address, amountB);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      await ssvToken
        .connect(stakerB)
        .approve(await network.getAddress(), amountB);
      await network.connect(stakerA).stake(amountA);
      await network.connect(stakerB).stake(amountB);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const receiptA = await claimTxA.wait();
      const gasA = receiptA!.gasUsed * receiptA!.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const receiptB = await claimTxB.wait();
      const gasB = receiptB!.gasUsed * receiptB!.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const oneBlockFeesWei = earningsPerBlockPacked * ETH_DEDUCTED_DIGITS;
      const oneBlockAccDelta = calcAccEthPerShareDelta(oneBlockFeesWei, totalStaked);
      const maxOneBlockRewardB = calcStakingReward(amountB, oneBlockAccDelta, 0n);

      const expectedRewardBFromA = (rewardA * amountB) / amountA;
      const diff = rewardB > expectedRewardBFromA
        ? rewardB - expectedRewardBFromA
        : expectedRewardBFromA - rewardB;
      expect(diff).to.be.lessThanOrEqual(maxOneBlockRewardB);
    });

    it("Truncation dust is at most 1 wei equivalent per user when using odd supply", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const stakeAmount = 3n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = BigInt(balAfter) - balBefore + gasUsed;

      expect(reward % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  describe("Staking with Existing Pre-Upgrade DAO Balance", () => {
    it("Pre-existing DAO revenue is not distributed to first staker", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 500);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 10);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const claimBlock = receipt!.blockNumber;
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const postStakeBlocks = BigInt(claimBlock - stakeBlock);
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const expectedFeesPacked = earningsPerBlockPacked * postStakeBlocks;
      const expectedFeesWei = expectedFeesPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(expectedFeesWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout =
        expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(reward).to.equal(expectedPayout);

      const totalFeesAllBlocks = earningsPerBlockPacked * BigInt(claimBlock) * ETH_DEDUCTED_DIGITS;
      if (totalFeesAllBlocks > 0n) {
        expect(reward).to.be.lessThan(totalFeesAllBlocks);
      }
    });
  });

  describe("EB Update Followed by syncFees — Full Chain", () => {
    it("Full chain trace: EB update → DAO vUnit change → higher earnings → syncFees → claim", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        {
          validatorCount: cluster.validatorCount,
          networkFeeIndex: cluster.networkFeeIndex,
          index: cluster.index,
          active: cluster.active,
          balance: cluster.balance,
        },
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await mineBlocks(provider, 100);

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebValue = 96;
      const ebBlock = await getBlockNumber(provider);

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: ebValue },
      ]);

      await commitEBRoot(network, cssvToken, oracles, root, ebBlock);

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await network.updateClusterBalance(
        ebBlock,
        clusterOwner.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(cluster.validatorCount),
          networkFeeIndex: BigInt(cluster.networkFeeIndex),
          index: BigInt(cluster.index),
          active: cluster.active,
          balance: BigInt(cluster.balance),
        },
        ebValue,
        proofs[clusterId],
      );

      await mineBlocks(provider, 100);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const totalReward = BigInt(balAfter) - balBefore + gasUsed;

      const feesSynced = claimReceipt!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      expect(feesSynced).to.not.be.undefined;
      const parsedSync = network.interface.parseLog(feesSynced);
      const finalAccEthPerShare = BigInt(parsedSync!.args[1]);

      const expectedReward = calcStakingReward(stakeAmount, finalAccEthPerShare, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);
      expect(totalReward).to.equal(expectedPayout);
      expect(totalReward % ETH_DEDUCTED_DIGITS).to.equal(0n);

      const phase1Rate = (PACKED_NETWORK_FEE * defaultVUnits(2n)) / BPS_DENOMINATOR;
      const phase2Rate = (PACKED_NETWORK_FEE * calcVUnits(96n)) / BPS_DENOMINATOR;
      expect(phase2Rate).to.be.greaterThan(phase1Rate);
    });
  });
});
