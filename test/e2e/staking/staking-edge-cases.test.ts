import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
} from "../../common/helpers.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  NETWORK_FEE,
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
  DEFAULT_UNSTAKE_COOLDOWN,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getTxBlock,
  calcAccEthPerShareDelta,
  calcStakingReward,
  defaultVUnits,
} from "../helpers/index.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
const MINIMAL_STAKING_AMOUNT = 1_000_000_000n;
const MAX_PENDING_REQUESTS = 10;

describe("E2E Staking Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let provider: any;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [deployer, operatorOwner, clusterOwner, stakerA, stakerB] =
      await connection.ethers.getSigners();
    provider = connection.ethers.provider;
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Accumulator Edge Cases", () => {
    it("Zero cSSV supply — fees are unclaimable", async function () {
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

      await mineBlocks(provider, 100);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 100);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const claimBlock = receipt!.blockNumber;
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const postStakeBlocks = BigInt(claimBlock - stakeBlock);
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const expectedFeesPacked = earningsPerBlockPacked * postStakeBlocks;
      const expectedFeesWei = expectedFeesPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(expectedFeesWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout =
        expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(reward).to.equal(expectedPayout);
    });

    it("accEthPerShare monotonicity — never decreases", async function () {
      const { network, ssvToken } =
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

      const accValues: bigint[] = [];

      for (let i = 0; i < 5; i++) {
        await mineBlocks(provider, 20);
        const tx = await network.connect(stakerA).syncFees();
        const receipt = await tx.wait();

        const feesSyncedLog = receipt!.logs.find((log: any) => {
          try {
            return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
          } catch {
            return false;
          }
        });

        if (feesSyncedLog) {
          const parsed = network.interface.parseLog(feesSyncedLog);
          accValues.push(BigInt(parsed!.args[1]));
        }
      }

      for (let i = 1; i < accValues.length; i++) {
        expect(accValues[i]).to.be.greaterThanOrEqual(accValues[i - 1]);
      }
    });

    it("Dust accumulation — dust eventually claimable", async function () {
      const { network, ssvToken } =
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

      const stakeAmount = 3n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      let totalClaimed = 0n;
      let lastClaimBlock = stakeBlock;
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      let cumulativeAcc = 0n;

      for (let i = 0; i < 3; i++) {
        await mineBlocks(provider, 50);
        const balBefore = await provider.getBalance(stakerA.address);
        const claimTx = await network.connect(stakerA).claimEthRewards();
        const receipt = await claimTx.wait();
        const claimBlock = receipt!.blockNumber;
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const balAfter = await provider.getBalance(stakerA.address);
        const claimed = BigInt(balAfter) - balBefore + gasUsed;
        totalClaimed += claimed;

        const blockDiff = BigInt(claimBlock - lastClaimBlock);
        const feesWei = earningsPerBlockPacked * blockDiff * ETH_DEDUCTED_DIGITS;
        const accDelta = calcAccEthPerShareDelta(feesWei, stakeAmount);
        cumulativeAcc += accDelta;
        lastClaimBlock = claimBlock;

        expect(claimed % ETH_DEDUCTED_DIGITS).to.equal(0n);
      }

      const expectedTotal = calcStakingReward(stakeAmount, cumulativeAcc, 0n);
      const expectedPayout = expectedTotal - (expectedTotal % ETH_DEDUCTED_DIGITS);
      expect(totalClaimed).to.equal(expectedPayout);
      expect(totalClaimed % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  describe("MAX_PENDING_REQUESTS (10)", () => {
    it("Should allow exactly 10 pending requests and revert on 11th", async function () {
      const { network, ssvToken } =
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

      const stakeAmount = 100n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      const unstakeAmount = 1n * PRECISION;
      for (let i = 0; i < MAX_PENDING_REQUESTS; i++) {
        await network.connect(stakerA).requestUnstake(unstakeAmount);
      }

      await expect(
        network.connect(stakerA).requestUnstake(unstakeAmount),
      ).to.be.revertedWithCustomError(network, Errors.MAX_REQUESTS_AMOUNT_REACHED);
    });

    it("Withdrawing unlocked requests frees slots for new requests", async function () {
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

      const stakeAmount = 100n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      const unstakeAmount = 1n * PRECISION;
      for (let i = 0; i < MAX_PENDING_REQUESTS; i++) {
        await network.connect(stakerA).requestUnstake(unstakeAmount);
      }

      const cooldownSeconds = Number(DEFAULT_UNSTAKE_COOLDOWN);
      await provider.send("evm_increaseTime", [cooldownSeconds + 1]);
      await mineBlocks(provider, 1);

      const ssvBefore = await ssvToken.balanceOf(stakerA.address);
      await network.connect(stakerA).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(stakerA.address);

      expect(ssvAfter - ssvBefore).to.equal(
        unstakeAmount * BigInt(MAX_PENDING_REQUESTS),
      );

      await network.connect(stakerA).requestUnstake(unstakeAmount);
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        stakeAmount -
          unstakeAmount * BigInt(MAX_PENDING_REQUESTS) -
          unstakeAmount,
      );
    });
  });

  describe("MINIMAL_STAKING_AMOUNT", () => {
    it("Should revert with ZeroAmount for stake(0)", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(stakerA).stake(0n),
      ).to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
    });

    it("Should revert with StakeTooLow for amount below minimum", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const belowMinimum = MINIMAL_STAKING_AMOUNT - 1n;
      await ssvToken.connect(deployer).transfer(stakerA.address, belowMinimum);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), belowMinimum);

      await expect(
        network.connect(stakerA).stake(belowMinimum),
      ).to.be.revertedWithCustomError(network, Errors.STAKE_TOO_LOW);
    });

    it("Should succeed at exactly MINIMAL_STAKING_AMOUNT", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const exact = MINIMAL_STAKING_AMOUNT;
      await ssvToken.connect(deployer).transfer(stakerA.address, exact);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), exact);

      await network.connect(stakerA).stake(exact);
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(exact);
    });
  });

  describe("syncFees() Public Function", () => {
    it("Should update accEthPerShare without settling any user's rewards", async function () {
      const { network, ssvToken } =
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
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 100);

      const tx = await network.connect(deployer).syncFees();
      const receipt = await tx.wait();
      const syncBlock = receipt!.blockNumber;

      const feesSyncedLog = receipt!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      expect(feesSyncedLog).to.not.be.undefined;

      const parsed = network.interface.parseLog(feesSyncedLog);
      const newFeesWei = BigInt(parsed!.args[0]);
      const accEthPerShare = BigInt(parsed!.args[1]);

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const blockDiff = BigInt(syncBlock - stakeBlock);
      const expectedFeesWei = earningsPerBlockPacked * blockDiff * ETH_DEDUCTED_DIGITS;
      const expectedAcc = calcAccEthPerShareDelta(expectedFeesWei, stakeAmount);

      expect(newFeesWei).to.equal(expectedFeesWei);
      expect(accEthPerShare).to.equal(expectedAcc);

      const settleLog = receipt!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.REWARDS_SETTLED;
        } catch {
          return false;
        }
      });
      expect(settleLog).to.be.undefined;
    });

    it("Anyone can call syncFees (not restricted to stakers)", async function () {
      const { network } =
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

      await mineBlocks(provider, 50);

      const tx = await network.connect(stakerB).syncFees();
      const receipt = await tx.wait();

      const feesSyncedLog = receipt!.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === Events.FEES_SYNCED;
        } catch {
          return false;
        }
      });
      expect(feesSyncedLog).to.not.be.undefined;
    });
  });

  describe("requestUnstake Followed by Immediate Claim", () => {
    it("Both requestUnstake and claimEthRewards can be called in same block context", async function () {
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
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 100);

      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(5n * PRECISION),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        5n * PRECISION,
      );

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const claimBlock = receipt!.blockNumber;
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = BigInt(balAfter) - balBefore + gasUsed;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;

      const phase1Blocks = BigInt(unstakeBlock - stakeBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, stakeAmount);
      const settledReward = calcStakingReward(stakeAmount, acc1, 0n);

      const phase2Blocks = BigInt(claimBlock - unstakeBlock);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const remainingBalance = 5n * PRECISION;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, remainingBalance);
      const postUnstakeReward = calcStakingReward(remainingBalance, acc2, 0n);
      const expectedReward = settledReward + postUnstakeReward;
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(reward).to.equal(expectedPayout);
      expect(reward % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });
});
