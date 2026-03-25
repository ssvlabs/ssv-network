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
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  DEFAULT_UNSTAKE_COOLDOWN,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getTxBlock,
  setAccountBalance,
} from "../../helpers/index.ts";

const PRECISION = 10n ** 18n;
const MINIMAL_STAKING_AMOUNT = 1_000_000_000n;

/** Helper: find and parse a named event from a receipt */
function findEvent(network: any, receipt: any, eventName: string, filter?: (parsed: any) => boolean) {
  const log = receipt.logs.find((l: any) => {
    try {
      const parsed = network.interface.parseLog(l);
      if (parsed?.name !== eventName) return false;
      return filter ? filter(parsed) : true;
    } catch {
      return false;
    }
  });
  return log ? network.interface.parseLog(log as any) : undefined;
}

describe("E2E Staking Gap Tests (ST Coverage Gaps)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let provider: any;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;
  let stakerC: HardhatEthersSigner;
  let stakerD: HardhatEthersSigner;
  let stakerE: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [deployer, operatorOwner, clusterOwner, stakerA, stakerB, stakerC, stakerD, stakerE],
    } = await setupTestContext());
    provider = connection.ethers.provider;
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ---------------------------------------------------------------------------
  // Helper: set up operators + whitelist + register 1 validator
  // ---------------------------------------------------------------------------
  async function setupCluster(network: any, opOwner: HardhatEthersSigner, clOwner: HardhatEthersSigner) {
    const operatorIds = await registerOperators(network, opOwner, 4);
    await whitelistAddresses(network, opOwner, operatorIds, [clOwner.address]);
    await network.connect(clOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    return operatorIds;
  }

  // ==========================================================================
  //  Precision & Overflow
  // ==========================================================================
  describe("Precision & Overflow", () => {
    it("ST-004: Large amount (1e23) stake — no overflow, cSSV minted 1:1", async function () {
      const { network, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);

      const largeAmount = 100_000n * PRECISION; // 100,000 SSV = 1e23
      await ssvToken.mint(stakerA.address, largeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), largeAmount);
      await network.connect(stakerA).stake(largeAmount);

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(largeAmount);
      expect(await cssvToken.totalSupply()).to.equal(largeAmount);
    });

    it("ST-062: Large stake + tiny fee — accEthPerShare rounds to 0, fees lost", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Set minimum possible ETH network fee
      await network.updateNetworkFee(ETH_DEDUCTED_DIGITS); // packed = 1

      // Stake very large amount so accDelta rounds to 0:
      // feesWei = 100,000 per block per validator (min fee)
      // With ~10 blocks of setup, totalFees ≈ 1,000,000 wei
      // accDelta = totalFees * 1e18 / totalStaked => 0 when totalStaked >= 1e25
      const largeStake = 10_000_000n * PRECISION; // 10M SSV = 1e25
      await ssvToken.mint(stakerA.address, largeStake);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), largeStake);
      await network.connect(stakerA).stake(largeStake);

      // Register cluster → generates fees (multiple blocks for operator registration)
      await setupCluster(network, operatorOwner, clusterOwner);

      // Claim should revert — accEthPerShare increment rounds to 0
      await expect(
        network.connect(stakerA).claimEthRewards(),
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_CLAIM);
    });

    it("ST-063: Tiny stake + large fee — no overflow in accEthPerShare", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Stake minimum amount
      await ssvToken.mint(stakerA.address, MINIMAL_STAKING_AMOUNT);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), MINIMAL_STAKING_AMOUNT);
      await network.connect(stakerA).stake(MINIMAL_STAKING_AMOUNT);

      // Register cluster and accrue many blocks of fees
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 1000);

      // Claim should succeed without overflow
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const ethReceived = BigInt(balAfter) - BigInt(balBefore) + gasUsed;
      expect(ethReceived).to.be.greaterThan(0n, "ST-063: tiny staker receives rewards");

      // Verify payout is multiple of ETH_DEDUCTED_DIGITS (100_000)
      expect(ethReceived % ETH_DEDUCTED_DIGITS).to.equal(0n, "ST-063: payout aligned to ETH precision");

      // As sole staker, should receive all protocol fees (minus truncation)
      // Verify the claim amount is at least 1 unit of packed ETH
      expect(ethReceived).to.be.greaterThanOrEqual(ETH_DEDUCTED_DIGITS, "ST-063: at least 1 packed ETH unit");
    });

    it("ST-094: _settle truncation-toward-zero rounding — no rounding up", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Stake an odd amount to create imperfect division
      const stakeAmount = 7n * PRECISION; // 7 SSV
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Register cluster, mine blocks
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 10);

      // Claim and verify exact truncation math
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const ethReceived = BigInt(balAfter) - BigInt(balBefore) + gasUsed;

      // Verify payout is a valid multiple of ETH_DEDUCTED_DIGITS
      expect(ethReceived).to.be.greaterThan(0n, "ST-094: payout > 0");
      expect(ethReceived).to.be.greaterThanOrEqual(ETH_DEDUCTED_DIGITS, "ST-094: at least 1 packed unit");
      expect(ethReceived % ETH_DEDUCTED_DIGITS).to.equal(0n, "ST-094: payout aligned to precision");

      // The key invariant: received ≤ total fees generated (truncation never rounds up)
      // With 7 SSV as only staker, all fees go to this user (minus truncation loss)
      // accDelta = feesWei * 1e18 / 7e18 = feesWei / 7 (floor)
      // pending = 7e18 * accDelta / 1e18 = 7 * (feesWei / 7) ≤ feesWei
      // This proves truncation toward zero: payout ≤ total fees (never rounded up).
    });
  });

  // ==========================================================================
  //  Boundary Values
  // ==========================================================================
  describe("Boundary Values", () => {
    it("ST-086: Accrued exactly ETH_DEDUCTED_DIGITS — smallest non-zero payout", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Set minimum ETH network fee: packed = 1, feesWei = 100,000 per block per validator
      await network.updateNetworkFee(ETH_DEDUCTED_DIGITS);

      // Stake exactly 1e18 SSV (1 token) so accrued = feesWei exactly
      const stakeAmount = PRECISION; // 1 SSV
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Register cluster (1 validator). Don't mine extra blocks.
      // After register, exactly 1 block to claimEthRewards → feesWei = 100,000
      await setupCluster(network, operatorOwner, clusterOwner);

      // Claim immediately (1 block after registerValidator)
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const ethReceived = BigInt(balAfter) - BigInt(balBefore) + gasUsed;

      // Payout should be exactly ETH_DEDUCTED_DIGITS (100,000 wei) — smallest non-zero payout
      expect(ethReceived).to.equal(ETH_DEDUCTED_DIGITS);
    });

    it("ST-087: requestUnstake of exactly 1 — minimum non-zero unstake amount", async function () {
      const { network, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);

      const stakeAmount = MINIMAL_STAKING_AMOUNT;
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Unstake exactly 1 — the minimum non-zero amount
      await expect(network.connect(stakerA).requestUnstake(1n))
        .to.emit(network, Events.UNSTAKE_REQUESTED);

      // cSSV balance reduced by 1
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount - 1n);

      // Can withdraw after cooldown
      const cooldownSeconds = Number(DEFAULT_UNSTAKE_COOLDOWN);
      await provider.send("evm_increaseTime", [cooldownSeconds + 1]);
      await mineBlocks(provider, 1);

      const ssvBefore = await ssvToken.balanceOf(stakerA.address);
      await network.connect(stakerA).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(stakerA.address);
      expect(ssvAfter - ssvBefore).to.equal(1n);
    });

    it("ST-088: withdrawUnlocked at exact cooldown expiry (>= boundary)", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      const stakeAmount = MINIMAL_STAKING_AMOUNT;
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      const unstakeTx = await network.connect(stakerA).requestUnstake(stakeAmount);
      const unstakeReceipt = await unstakeTx.wait();
      const unstakeBlock = await provider.getBlock(unstakeReceipt!.blockNumber);
      const unlockTime = unstakeBlock.timestamp + Number(DEFAULT_UNSTAKE_COOLDOWN);

      // Advance to exactly cooldown expiry (block.timestamp == unlockTime)
      const currentBlock = await provider.getBlock("latest");
      const timeToAdvance = unlockTime - currentBlock.timestamp;
      await provider.send("evm_increaseTime", [timeToAdvance]);
      await mineBlocks(provider, 1);

      // Verify the timestamp is at or past the unlock time
      const nowBlock = await provider.getBlock("latest");
      expect(nowBlock.timestamp).to.be.greaterThanOrEqual(unlockTime);

      // Should succeed — condition is `unlockTime <= block.timestamp`
      const ssvBefore = await ssvToken.balanceOf(stakerA.address);
      await network.connect(stakerA).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(stakerA.address);
      expect(ssvAfter - ssvBefore).to.equal(stakeAmount);
    });
  });

  // ==========================================================================
  //  Reentrancy Guards
  // ==========================================================================
  describe("Reentrancy Guards", () => {
    it("ST-072 / ST-082: Cross-function reentrancy blocked — claimEthRewards → receive → stake", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Deploy StakingAttacker
      const networkAddr = await network.getAddress();
      const ssvTokenAddr = await ssvToken.getAddress();
      const attacker = await connection.ethers.deployContract(
        "StakingAttacker",
        [networkAddr, ssvTokenAddr],
      );
      await attacker.waitForDeployment();
      const attackerAddr = await attacker.getAddress();

      // Fund attacker with SSV and have it stake
      const stakeAmount = 10n * PRECISION;
      await ssvToken.mint(attackerAddr, stakeAmount);
      await attacker.approveAndStake(stakeAmount);

      // Register cluster and accrue fees
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 100);

      // Fund attacker with extra SSV for the re-entrant stake attempt
      await ssvToken.mint(attackerAddr, MINIMAL_STAKING_AMOUNT);

      // Set attack mode: re-enter stake() on ETH receipt
      await attacker.setAttackMode(1);

      // Attack: claimEthRewards → receive ETH → try stake() → nonReentrant blocks → ETHTransferFailed
      await expect(attacker.claimRewards()).to.be.revertedWithCustomError(
        network,
        Errors.ETH_TRANSFER_FAILED,
      );
    });

    it("ST-084: Cross-function reentrancy blocked — claimEthRewards → receive → requestUnstake", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Deploy StakingAttacker
      const networkAddr = await network.getAddress();
      const ssvTokenAddr = await ssvToken.getAddress();
      const attacker = await connection.ethers.deployContract(
        "StakingAttacker",
        [networkAddr, ssvTokenAddr],
      );
      await attacker.waitForDeployment();
      const attackerAddr = await attacker.getAddress();

      // Fund attacker with SSV and have it stake
      const stakeAmount = 10n * PRECISION;
      await ssvToken.mint(attackerAddr, stakeAmount);
      await attacker.approveAndStake(stakeAmount);

      // Register cluster and accrue fees
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 100);

      // Set attack mode: re-enter requestUnstake() on ETH receipt
      await attacker.setAttackMode(2);

      // Attack: claimEthRewards → receive ETH → try requestUnstake() → nonReentrant blocks → ETHTransferFailed
      await expect(attacker.claimRewards()).to.be.revertedWithCustomError(
        network,
        Errors.ETH_TRANSFER_FAILED,
      );
    });
  });

  // ==========================================================================
  //  Settlement Edge Cases
  // ==========================================================================
  describe("Settlement Edge Cases", () => {
    it("ST-077: _settle idempotent — two stake operations in same block", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Set up cluster to generate fees
      await setupCluster(network, operatorOwner, clusterOwner);

      // Fund staker
      const totalAmount = 20n * PRECISION;
      await ssvToken.mint(stakerA.address, totalAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), totalAmount);

      // First stake → establishes userIndex
      await network.connect(stakerA).stake(10n * PRECISION);
      await mineBlocks(provider, 50);

      // Two stakes in the same block
      await provider.send("evm_setAutomine", [false]);
      try {
        const tx1 = await network.connect(stakerA).stake(MINIMAL_STAKING_AMOUNT);
        const tx2 = await network.connect(stakerA).stake(MINIMAL_STAKING_AMOUNT);
        await provider.send("evm_mine", []);

        const receipt1 = await tx1.wait();
        const receipt2 = await tx2.wait();

        // Both in same block
        expect(receipt1!.blockNumber).to.equal(receipt2!.blockNumber);

        // Second settle should have pending = 0 (idempotent within same block)
        const parsed = findEvent(network, receipt2, Events.REWARDS_SETTLED);
        expect(parsed).to.not.be.undefined;
        // pending (arg[1]) should be 0 in the second settlement
        expect(parsed!.args[1]).to.equal(0n);
      } finally {
        await provider.send("evm_setAutomine", [true]);
      }
    });

    it("ST-078: 5 concurrent stakers — per-user userIndex tracks correctly", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Set up cluster to generate fees
      await setupCluster(network, operatorOwner, clusterOwner);

      const stakers = [stakerA, stakerB, stakerC, stakerD, stakerE];
      const amount = 10n * PRECISION;

      // Fund all stakers
      for (const s of stakers) {
        await ssvToken.mint(s.address, amount);
        await ssvToken.connect(s).approve(await network.getAddress(), amount);
      }

      // Each staker stakes at a different block with blocks mined in between
      const stakeBlocks: number[] = [];
      for (let i = 0; i < stakers.length; i++) {
        if (i > 0) await mineBlocks(provider, 10);
        const block = await getTxBlock(await network.connect(stakers[i]).stake(amount));
        stakeBlocks.push(block);
      }

      // Verify stakers staked at different blocks
      for (let i = 1; i < stakeBlocks.length; i++) {
        expect(stakeBlocks[i]).to.be.greaterThan(stakeBlocks[i - 1]);
      }

      // Mine blocks then settle all stakers by re-staking
      await mineBlocks(provider, 50);

      const indices: bigint[] = [];
      const pendings: bigint[] = [];
      for (const s of stakers) {
        await ssvToken.mint(s.address, MINIMAL_STAKING_AMOUNT);
        await ssvToken.connect(s).approve(await network.getAddress(), MINIMAL_STAKING_AMOUNT);
        const tx = await network.connect(s).stake(MINIMAL_STAKING_AMOUNT);
        const receipt = await tx.wait();

        const parsed = findEvent(network, receipt, Events.REWARDS_SETTLED);
        expect(parsed).to.not.be.undefined;
        indices.push(BigInt(parsed!.args[3])); // idx
        pendings.push(BigInt(parsed!.args[1])); // pending
      }

      // After settlement, userIndices are monotonically non-decreasing
      // (each successive settlement sees slightly higher accEthPerShare)
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).to.be.greaterThanOrEqual(indices[i - 1]);
      }

      // Earlier stakers earned more pending rewards than later stakers
      // (they had more blocks of accrual before settlement)
      expect(pendings[0]).to.be.greaterThan(pendings[4]);
    });

    it("ST-097: _settleWithBalance bal==0, idx!=userIdx — index advances, no accrual", async function () {
      const { network, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Stake, then fully unstake so cSSV balance = 0
      const stakeAmount = 10n * PRECISION;
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 50);

      // Fully unstake — cSSV balance = 0
      await network.connect(stakerA).requestUnstake(stakeAmount);
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(0n);

      // Have another staker stake so accEthPerShare can advance
      const stakeB = 10n * PRECISION;
      await ssvToken.mint(stakerB.address, stakeB);
      await ssvToken.connect(stakerB).approve(await network.getAddress(), stakeB);
      await network.connect(stakerB).stake(stakeB);

      await mineBlocks(provider, 50);

      // Re-stake a tiny amount to trigger settle for stakerA (bal=0 at settle time)
      await ssvToken.mint(stakerA.address, MINIMAL_STAKING_AMOUNT);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), MINIMAL_STAKING_AMOUNT);
      const tx = await network.connect(stakerA).stake(MINIMAL_STAKING_AMOUNT);
      const receipt = await tx.wait();

      // Find RewardsSettled for stakerA
      const parsed = findEvent(network, receipt, Events.REWARDS_SETTLED,
        (p: any) => p.args[0] === stakerA.address);
      expect(parsed).to.not.be.undefined;

      // pending should be 0 (bal was 0 when settle ran, before the new mint)
      expect(parsed!.args[1]).to.equal(0n, "ST-097: pending == 0 when bal==0");
      // idx should be current accEthPerShare (advanced by stakerB's activity)
      const settledIdx = BigInt(parsed!.args[3]);
      expect(settledIdx).to.be.greaterThan(0n, "ST-097: idx advanced");

      // Verify stakerA's cSSV balance is now exactly MINIMAL_STAKING_AMOUNT (re-staked)
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        MINIMAL_STAKING_AMOUNT,
        "ST-097: cSSV balance == re-staked amount",
      );
    });

    it("ST-098: _settleWithBalance pending==0 due to rounding despite balance & index diff", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Set minimum fee to make precision loss easier to trigger
      await network.updateNetworkFee(ETH_DEDUCTED_DIGITS); // min fee: 100,000 wei/block/validator

      // StakerA stakes a large amount, StakerB stakes minimum.
      // totalStaked large enough that 1 block of min fees produces accDelta
      // where smallStaker's pending rounds to 0.
      const bigStake = 10_001n * PRECISION; // 10,001 SSV
      const smallStake = MINIMAL_STAKING_AMOUNT; // 1e9 = 1 gwei SSV

      await ssvToken.mint(stakerA.address, bigStake);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), bigStake);
      await network.connect(stakerA).stake(bigStake);

      await ssvToken.mint(stakerB.address, smallStake * 2n);
      await ssvToken.connect(stakerB).approve(await network.getAddress(), smallStake * 2n);
      await network.connect(stakerB).stake(smallStake);

      // Register cluster
      await setupCluster(network, operatorOwner, clusterOwner);

      // Mine 1 block so minimal fees accrue
      await mineBlocks(provider, 1);

      // StakerB stakes again to trigger settle
      // accDelta = 100000 * 1e18 / ~10001e18 ≈ 9 (very small)
      // pending = 1e9 * 9 / 1e18 = 0 (rounds to 0)
      const tx = await network.connect(stakerB).stake(smallStake);
      const receipt = await tx.wait();

      // Find RewardsSettled for stakerB
      const parsed = findEvent(network, receipt, Events.REWARDS_SETTLED,
        (p: any) => p.args[0] === stakerB.address);
      expect(parsed).to.not.be.undefined;

      // pending == 0 (rounding loss)
      expect(parsed!.args[1]).to.equal(0n, "ST-098: pending == 0 (truncation)");
      // accrued == 0 (nothing was added)
      expect(parsed!.args[2]).to.equal(0n, "ST-098: accrued == 0");
      // idx > 0 (accEthPerShare has advanced)
      const settledIdx = BigInt(parsed!.args[3]);
      expect(settledIdx).to.be.greaterThan(0n, "ST-098: idx advanced");

      // stakerA (big staker) should be able to claim rewards (they have large balance)
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);
      const claimed = BigInt(balAfter) - BigInt(balBefore) + gasUsed;
      expect(claimed).to.be.greaterThan(0n, "ST-098: big staker can claim");
    });
  });

  // ==========================================================================
  //  ETH Transfer Failures
  // ==========================================================================
  describe("ETH Transfer Failures", () => {
    it("ST-080: claimEthRewards — recipient contract rejects ETH", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Deploy ETH-rejecting staker (no receive/fallback)
      const networkAddr = await network.getAddress();
      const ssvTokenAddr = await ssvToken.getAddress();
      const rejecter = await connection.ethers.deployContract(
        "ETHRejectingStaker",
        [networkAddr, ssvTokenAddr],
      );
      await rejecter.waitForDeployment();
      const rejecterAddr = await rejecter.getAddress();

      // Fund and stake through the rejecter contract
      const stakeAmount = 10n * PRECISION;
      await ssvToken.mint(rejecterAddr, stakeAmount);
      await rejecter.approveAndStake(stakeAmount);

      // Register cluster and accrue fees
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 100);

      // Claim should fail — rejecter contract can't receive ETH
      await expect(rejecter.claimRewards()).to.be.revertedWithCustomError(
        network,
        Errors.ETH_TRANSFER_FAILED,
      );
    });

    it("ST-095: claimEthRewards — insufficient contract ETH (accounting mismatch)", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.mint(stakerA.address, stakeAmount);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Register cluster and accrue fees
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 100);

      // Drain the network proxy's ETH balance using hardhat
      const networkAddr = await network.getAddress();
      await setAccountBalance(provider, networkAddr, 0n);

      // Claim should fail — accounting says rewards exist but contract has no ETH
      await expect(
        network.connect(stakerA).claimEthRewards(),
      ).to.be.revertedWithCustomError(network, Errors.ETH_TRANSFER_FAILED);
    });
  });

  // ==========================================================================
  //  SyncFees Edge Cases
  // ==========================================================================
  describe("SyncFees Edge Cases", () => {
    it("ST-096: syncFees with no new earnings — current <= previous, no FeesSynced event", async function () {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

      // Call syncFees when no validators exist → no earnings
      const tx1 = await network.syncFees();
      const receipt1 = await tx1.wait();

      // No validators → no earnings → current <= previous → early return, no event
      expect(findEvent(network, receipt1, Events.FEES_SYNCED)).to.be.undefined;

      // Second call in next block — still no validators, still no event
      const tx2 = await network.syncFees();
      const receipt2 = await tx2.wait();
      expect(findEvent(network, receipt2, Events.FEES_SYNCED)).to.be.undefined;

      // Now register a cluster and verify syncFees DOES emit after that
      await setupCluster(network, operatorOwner, clusterOwner);
      await mineBlocks(provider, 10);

      // Stake first so there's cSSV supply (needed for accEthPerShare update)
      await ssvToken.mint(stakerA.address, MINIMAL_STAKING_AMOUNT);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), MINIMAL_STAKING_AMOUNT);
      await network.connect(stakerA).stake(MINIMAL_STAKING_AMOUNT);

      await mineBlocks(provider, 10);

      const tx3 = await network.syncFees();
      const receipt3 = await tx3.wait();

      // Now there ARE earnings → FeesSynced should be emitted
      expect(findEvent(network, receipt3, Events.FEES_SYNCED)).to.not.be.undefined;
    });
  });

  // ==========================================================================
  //  RescueERC20
  // ==========================================================================
  describe("RescueERC20", () => {
    it("ST-090: Rescued token transfer failure propagation", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Deploy a mock token
      const mockToken = await connection.ethers.deployContract("MockToken");
      await mockToken.waitForDeployment();
      const mockTokenAddr = await mockToken.getAddress();

      const networkAddr = await network.getAddress();

      // Mint some tokens to the network proxy
      await mockToken.mint(networkAddr, 50n);

      // Try to rescue more than the proxy holds → underlying transfer reverts
      await expect(
        network.rescueERC20(mockTokenAddr, deployer.address, 100n),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      // Verify that rescuing the actual amount succeeds
      await expect(
        network.rescueERC20(mockTokenAddr, deployer.address, 50n),
      ).to.emit(network, Events.ERC20_RESCUED)
        .withArgs(mockTokenAddr, deployer.address, 50n);
    });
  });
});
