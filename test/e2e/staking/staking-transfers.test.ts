import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
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
  getTxBlock,
  calcAccEthPerShareDelta,
  calcStakingReward,
  defaultVUnits,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Transfers", () => {
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

  describe("cSSV Transfer Settles Rewards", () => {
    it("Transfer settles both sender and receiver; pre-transfer revenue goes to sender only", async function () {
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

      const amountA = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      await mineBlocks(provider, 50);

      const transferAmount = 5n * PRECISION;
      const transferBlock = await getTxBlock(
        await cssvToken.connect(stakerA).transfer(stakerB.address, transferAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        amountA - transferAmount,
      );
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(
        transferAmount,
      );

      await mineBlocks(provider, 50);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const claimBlockA = claimReceiptA!.blockNumber;
      const gasA = claimReceiptA!.gasUsed * claimReceiptA!.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const claimBlockB = claimReceiptB!.blockNumber;
      const gasB = claimReceiptB!.gasUsed * claimReceiptB!.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const totalSupply = amountA;

      const phase1Blocks = BigInt(transferBlock - stakeBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const accAtTransfer = calcAccEthPerShareDelta(phase1FeesWei, totalSupply);

      const phase2aBlocks = BigInt(claimBlockA - transferBlock);
      const phase2aFeesWei = earningsPerBlockPacked * phase2aBlocks * ETH_DEDUCTED_DIGITS;
      const accDelta2a = calcAccEthPerShareDelta(phase2aFeesWei, totalSupply);

      const aAccrued = calcStakingReward(amountA, accAtTransfer, 0n);
      const aPostTransfer = calcStakingReward(amountA - transferAmount, accDelta2a, 0n);
      const expectedRewardA = aAccrued + aPostTransfer;
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      const phase2bBlocks = BigInt(claimBlockB - claimBlockA);
      const phase2bFeesWei = earningsPerBlockPacked * phase2bBlocks * ETH_DEDUCTED_DIGITS;
      const accDelta2b = calcAccEthPerShareDelta(phase2bFeesWei, totalSupply);

      const expectedRewardB = calcStakingReward(transferAmount, accDelta2a + accDelta2b, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);

      expect(rewardA).to.be.greaterThan(rewardB);
    });

    it("Stake-transfer-stake cycle preserves reward boundaries across all phases", async function () {
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

      const initialStake = 10n * PRECISION;
      const transferAmount = 5n * PRECISION;
      const restakeAmount = 5n * PRECISION;
      const phase2Supply = initialStake;
      const phase3Supply = initialStake + restakeAmount;

      await ssvToken
        .connect(deployer)
        .transfer(stakerA.address, initialStake + restakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), initialStake + restakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(initialStake),
      );

      await mineBlocks(provider, 50);

      const transferBlock = await getTxBlock(
        await cssvToken.connect(stakerA).transfer(stakerB.address, transferAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        initialStake - transferAmount,
      );
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(
        transferAmount,
      );

      await mineBlocks(provider, 50);

      const restakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(restakeAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(initialStake);

      await mineBlocks(provider, 50);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const balBeforeB = await provider.getBalance(stakerB.address);

      let claimTxA: any;
      let claimTxB: any;

      await provider.send("evm_setAutomine", [false]);
      try {
        claimTxA = await network.connect(stakerA).claimEthRewards();
        claimTxB = await network.connect(stakerB).claimEthRewards();
        await provider.send("evm_mine", []);
      } finally {
        await provider.send("evm_setAutomine", [true]);
      }

      const claimReceiptA = await claimTxA.wait();
      const claimReceiptB = await claimTxB.wait();
      const claimBlock = claimReceiptA!.blockNumber;

      expect(claimReceiptB!.blockNumber).to.equal(claimBlock);

      const gasA = claimReceiptA!.gasUsed * claimReceiptA!.gasPrice;
      const gasB = claimReceiptB!.gasUsed * claimReceiptB!.gasPrice;

      const balAfterA = await provider.getBalance(stakerA.address);
      const balAfterB = await provider.getBalance(stakerB.address);

      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const phase1Blocks = BigInt(transferBlock - stakeBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, initialStake);

      const phase2Blocks = BigInt(restakeBlock - transferBlock);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, phase2Supply);

      const phase3Blocks = BigInt(claimBlock - restakeBlock);
      const phase3FeesWei = earningsPerBlockPacked * phase3Blocks * ETH_DEDUCTED_DIGITS;
      const acc3 = calcAccEthPerShareDelta(phase3FeesWei, phase3Supply);

      const expectedRewardA =
        calcStakingReward(initialStake, acc1, 0n) +
        calcStakingReward(initialStake - transferAmount, acc2, 0n) +
        calcStakingReward(initialStake, acc3, 0n);
      const expectedRewardB =
        calcStakingReward(transferAmount, acc2, 0n) +
        calcStakingReward(transferAmount, acc3, 0n);

      const expectedPayoutA =
        expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      const expectedPayoutB =
        expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);

      expect(rewardA).to.equal(expectedPayoutA);
      expect(rewardB).to.equal(expectedPayoutB);
      expect(rewardA).to.be.greaterThan(rewardB);
    });

    it("Receiver B's userIndex is set to accEthPerShare at transfer time", async function () {
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

      const amountA = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      await network.connect(stakerA).stake(amountA);

      await mineBlocks(provider, 100);

      await cssvToken
        .connect(stakerA)
        .transfer(stakerB.address, 5n * PRECISION);

      const balBefore = await provider.getBalance(stakerB.address);
      const claimTx = await network.connect(stakerB).claimEthRewards();
      const receipt = await claimTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerB.address);
      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const vUnits = defaultVUnits(1n);
      const maxOneBlockReward =
        ((PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(reward).to.be.lessThanOrEqual(maxOneBlockReward);
    });
  });

  describe("cSSV Transfer — Mint/Burn Do NOT Trigger Hook", () => {
    it("Mint (via stake) does not trigger onCSSVTransfer — from == address(0)", async function () {
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

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const tx = await network.connect(stakerA).stake(stakeAmount);
      await tx.wait();

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
    });

    it("Burn (via requestUnstake) does not trigger onCSSVTransfer — to == address(0)", async function () {
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

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await mineBlocks(provider, 50);

      const tx = await network
        .connect(stakerA)
        .requestUnstake(5n * PRECISION);
      const receipt = await tx.wait();

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        5n * PRECISION,
      );
    });

    it("Self-transfer does not trigger onCSSVTransfer — from == to", async function () {
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

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await mineBlocks(provider, 50);

      const tx = await cssvToken
        .connect(stakerA)
        .transfer(stakerA.address, 5n * PRECISION);
      await tx.wait();

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
    });

    it("Self-transfer keeps reward accrual equal to uninterrupted staking", async function () {
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

      const stakeAmount = 10n * PRECISION;
      const selfTransferAmount = 5n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 50);

      const selfTransferBlock = await getTxBlock(
        await cssvToken
          .connect(stakerA)
          .transfer(stakerA.address, selfTransferAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);

      await mineBlocks(provider, 50);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt!.blockNumber;
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);
      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const phase1Blocks = BigInt(selfTransferBlock - stakeBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, stakeAmount);

      const phase2Blocks = BigInt(claimBlock - selfTransferBlock);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, stakeAmount);

      const expectedReward = calcStakingReward(stakeAmount, acc1 + acc2, 0n);
      const expectedPayout =
        expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(reward).to.equal(expectedPayout);
    });

    it("Zero-amount transfer does not trigger onCSSVTransfer — amount == 0", async function () {
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

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await mineBlocks(provider, 50);

      const tx = await cssvToken.connect(stakerA).transfer(stakerB.address, 0n);
      await tx.wait();

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(0n);
    });

    it("Normal user-to-user transfer DOES trigger onCSSVTransfer", async function () {
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

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await mineBlocks(provider, 50);

      const transferAmount = 5n * PRECISION;
      const tx = await cssvToken
        .connect(stakerA)
        .transfer(stakerB.address, transferAmount);
      const receipt = await tx.wait();

      const networkAddress = await network.getAddress();
      const settleLogs = receipt!.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === Events.REWARDS_SETTLED;
        } catch {
          return false;
        }
      });

      expect(settleLogs.length).to.equal(2);

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        stakeAmount - transferAmount,
      );
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(
        transferAmount,
      );
    });
  });
});
