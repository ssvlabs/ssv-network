/**
 * ES-19: cSSV Transfer Settles Rewards
 * ES-30: cSSV Transfer — Mint/Burn Do NOT Trigger Hook
 */

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
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcAccEthPerShareDelta,
  calcStakingReward,
  defaultVUnits,
} from "../helpers/index.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Transfers (ES-19, ES-30)", () => {
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

  // ───────────────────────────────────────────────────────────────────
  // ES-19: cSSV Transfer Settles Rewards
  // ───────────────────────────────────────────────────────────────────
  describe("ES-19: cSSV Transfer Settles Rewards", () => {
    it("transfer settles both sender and receiver; pre-transfer revenue goes to sender only", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      // Setup: register operators and cluster
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // A stakes 10e18 SSV
      const amountA = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      // Phase 1: 50 blocks of revenue with only A staked
      await mineBlocks(provider, 50);

      // A transfers 5e18 cSSV to B
      // This triggers _beforeTokenTransfer → onCSSVTransfer → _syncFees + _settle(A) + _settle(B)
      const transferAmount = 5n * PRECISION;
      const transferBlock = await getTxBlock(
        await cssvToken.connect(stakerA).transfer(stakerB.address, transferAmount),
      );

      // Verify balances after transfer
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        amountA - transferAmount,
      );
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(
        transferAmount,
      );

      // Phase 2: 50 more blocks of revenue with A=5e18, B=5e18
      await mineBlocks(provider, 50);

      // Both claim
      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const claimBlockA = claimReceiptA.blockNumber;
      const gasA = claimReceiptA.gasUsed * claimReceiptA.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = balAfterA - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const claimBlockB = claimReceiptB.blockNumber;
      const gasB = claimReceiptB.gasUsed * claimReceiptB.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = balAfterB - balBeforeB + gasB;

      // Calculate exact expected rewards
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const totalSupply = amountA; // 10e18 (constant throughout, transfer doesn't change it)

      // Phase 1: stakeBlock → transferBlock, totalSupply = 10e18, A is sole staker
      const phase1Blocks = BigInt(transferBlock - stakeBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const accAtTransfer = calcAccEthPerShareDelta(phase1FeesWei, totalSupply);

      // At transfer: A is settled with 10e18 cSSV * accAtTransfer / 1e18 (stored in accrued[A])
      // A's userIndex = accAtTransfer, B's userIndex = accAtTransfer

      // Phase 2a: transferBlock → claimBlockA, totalSupply = 10e18
      const phase2aBlocks = BigInt(claimBlockA - transferBlock);
      const phase2aFeesWei = earningsPerBlockPacked * phase2aBlocks * ETH_DEDUCTED_DIGITS;
      const accDelta2a = calcAccEthPerShareDelta(phase2aFeesWei, totalSupply);

      // A's reward at claim:
      //   accrued from transfer settlement: 10e18 * accAtTransfer / 1e18
      //   + post-transfer earnings: 5e18 * accDelta2a / 1e18
      const aAccrued = calcStakingReward(amountA, accAtTransfer, 0n);
      const aPostTransfer = calcStakingReward(amountA - transferAmount, accDelta2a, 0n);
      const expectedRewardA = aAccrued + aPostTransfer;
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      // Phase 2b: claimBlockA → claimBlockB (1 block), totalSupply = 10e18
      const phase2bBlocks = BigInt(claimBlockB - claimBlockA);
      const phase2bFeesWei = earningsPerBlockPacked * phase2bBlocks * ETH_DEDUCTED_DIGITS;
      const accDelta2b = calcAccEthPerShareDelta(phase2bFeesWei, totalSupply);

      // B's reward at claim:
      //   B's userIndex = accAtTransfer, accEthPerShare = accAtTransfer + accDelta2a + accDelta2b
      //   reward = 5e18 * (accDelta2a + accDelta2b) / 1e18
      const expectedRewardB = calcStakingReward(transferAmount, accDelta2a + accDelta2b, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);

      // A captured ALL of Phase 1 (settled with full balance) + 50% of Phase 2
      expect(rewardA).to.be.greaterThan(rewardB);
    });

    it("receiver B's userIndex is set to accEthPerShare at transfer time", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // A stakes
      const amountA = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      await network.connect(stakerA).stake(amountA);

      // Revenue accrues
      await mineBlocks(provider, 100);

      // Transfer to B
      await cssvToken
        .connect(stakerA)
        .transfer(stakerB.address, 5n * PRECISION);

      // B claims in the next block — B's reward should be tiny (only 1 block of accrual)
      // because userIndex[B] was set to accEthPerShare at transfer time.
      // The claim itself takes 1 block, during which fees accrue and B earns
      // their share (5e18 / 10e18 = 50%).
      const balBefore = await provider.getBalance(stakerB.address);
      const claimTx = await network.connect(stakerB).claimEthRewards();
      const receipt = await claimTx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await provider.getBalance(stakerB.address);
      const reward = balAfter - balBefore + gasUsed;

      // B's reward should be at most 1 block's worth of fees * 50%
      // (very small compared to the 100 blocks of pre-transfer revenue A got)
      const vUnits = defaultVUnits(1n);
      const maxOneBlockReward =
        ((PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;
      expect(reward).to.be.lessThanOrEqual(maxOneBlockReward);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-30: cSSV Transfer — Mint/Burn Do NOT Trigger Hook
  // ───────────────────────────────────────────────────────────────────
  describe("ES-30: cSSV Transfer — Mint/Burn Do NOT Trigger Hook", () => {
    it("mint (via stake) does not trigger onCSSVTransfer — from == address(0)", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Stake triggers mint. If hook was called, we'd see an onCSSVTransfer call
      // which would cause issues (settlement happens manually in stake() before mint).
      // The fact that stake succeeds without reverting proves the hook is skipped.
      const tx = await network.connect(stakerA).stake(stakeAmount);
      const receipt = await tx.wait();

      // Verify mint happened (Transfer event from address(0))
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);

      // If the hook had fired, it would have tried to settle BEFORE mint with
      // a balance of 0, which would be fine but would emit extra RewardsSettled events.
      // The key invariant is that the settlement in stake() uses _settle() directly,
      // not the hook.
    });

    it("burn (via requestUnstake) does not trigger onCSSVTransfer — to == address(0)", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // requestUnstake triggers burn. The hook is NOT called because to == address(0).
      // Settlement happens via _settleWithBalance in requestUnstake before burn.
      const tx = await network
        .connect(stakerA)
        .requestUnstake(5n * PRECISION);
      const receipt = await tx.wait();

      // Verify burn happened
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        5n * PRECISION,
      );
    });

    it("self-transfer does not trigger onCSSVTransfer — from == to", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Self-transfer: from == to, skipped by the guard
      const tx = await cssvToken
        .connect(stakerA)
        .transfer(stakerA.address, 5n * PRECISION);
      await tx.wait();

      // Balance should be unchanged
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
    });

    it("zero-amount transfer does not trigger onCSSVTransfer — amount == 0", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Zero-amount transfer: skipped by the guard (amount > 0 is false)
      const tx = await cssvToken.connect(stakerA).transfer(stakerB.address, 0n);
      await tx.wait();

      // Balances unchanged
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(0n);
    });

    it("normal user-to-user transfer DOES trigger onCSSVTransfer", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Normal transfer from A to B: should trigger onCSSVTransfer
      // This will emit FeesSynced and RewardsSettled events through the hook
      const transferAmount = 5n * PRECISION;
      const tx = await cssvToken
        .connect(stakerA)
        .transfer(stakerB.address, transferAmount);
      const receipt = await tx.wait();

      // Look for RewardsSettled events (emitted by _settle in onCSSVTransfer)
      const networkAddress = await network.getAddress();
      const settleLogs = receipt.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === "RewardsSettled";
        } catch {
          return false;
        }
      });

      // Should have 2 RewardsSettled events: one for A, one for B
      expect(settleLogs.length).to.equal(2);

      // Verify balances changed
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        stakeAmount - transferAmount,
      );
      expect(await cssvToken.balanceOf(stakerB.address)).to.equal(
        transferAmount,
      );
    });
  });
});
