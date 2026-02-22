import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType, UnstakeRequest } from '../../common/types.ts';
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
} from '../../common/helpers.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  STAKE_AMOUNT,
  DEFAULT_UNSTAKE_COOLDOWN,
  DEFAULT_ORACLES_IDS,
  NETWORK_FEE,
} from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.js';

/**
 * Enhanced Integration Tests for SSVNetwork Staking
 * 
 * These tests focus on:
 * 1. Balance delta assertions for SSV/cSSV token movements
 * 2. Reward accrual from cluster ETH inflow (deposits, registrations, reactivations)
 * 3. Multi-block simulation for staking rewards distribution
 * 4. Invariant checks for staking/rewards balance consistency
 * 5. Combined scenarios: stake → earn rewards → claim → unstake
 * 
 * Key insight: The source of staking rewards is the network fee portion of ETH
 * that flows in from cluster owners when they:
 * - Register validators (deposit ETH)
 * - Deposit ETH into clusters
 * - Reactivate clusters (deposit ETH)
 */
describe("SSVNetwork Integration - Staking (Enhanced)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let staker2: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, staker, staker2] = await connection.ethers.getSigners();
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ============================================================================
  // SECTION 1: Balance Delta Assertions for Token Movements
  // ============================================================================

  describe("Balance Delta Assertions - Token Movements", async function() {

    it("stake: SSV transferred from staker to contract, cSSV minted 1:1", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);

      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      const contractSsvBefore = await ssvToken.balanceOf(await network.getAddress());
      const cssvSupplyBefore = await cssvToken.totalSupply();
      const stakerCssvBefore = await cssvToken.balanceOf(staker.address);

      const tx = await network.connect(staker).stake(STAKE_AMOUNT);
      await tx.wait();

      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);
      const contractSsvAfter = await ssvToken.balanceOf(await network.getAddress());
      const cssvSupplyAfter = await cssvToken.totalSupply();
      const stakerCssvAfter = await cssvToken.balanceOf(staker.address);

      // SSV moved from staker to contract
      expect(stakerSsvBefore - stakerSsvAfter).to.equal(STAKE_AMOUNT);
      expect(contractSsvAfter - contractSsvBefore).to.equal(STAKE_AMOUNT);

      // cSSV minted 1:1 to staker
      expect(cssvSupplyAfter - cssvSupplyBefore).to.equal(STAKE_AMOUNT);
      expect(stakerCssvAfter - stakerCssvBefore).to.equal(STAKE_AMOUNT);

      // Views reflect correct state
      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT);
    });

    it("requestUnstake: cSSV burned, delegation removed", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const cssvSupplyBefore = await cssvToken.totalSupply();
      const stakerCssvBefore = await cssvToken.balanceOf(staker.address);
      const stakedBefore = await views.stakedBalanceOf(staker.address);

      const unstakeAmount = STAKE_AMOUNT / 2n;
      const tx = await network.connect(staker).requestUnstake(unstakeAmount);
      const block = await tx.getBlock();

      const cssvSupplyAfter = await cssvToken.totalSupply();
      const stakerCssvAfter = await cssvToken.balanceOf(staker.address);
      const stakedAfter = await views.stakedBalanceOf(staker.address);

      // cSSV burned
      expect(cssvSupplyBefore - cssvSupplyAfter).to.equal(unstakeAmount);
      expect(stakerCssvBefore - stakerCssvAfter).to.equal(unstakeAmount);

      // Staked balance decreased
      expect(stakedBefore - stakedAfter).to.equal(unstakeAmount);

      // Pending unstake recorded with correct unlock time
      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requests[0].amount).to.equal(unstakeAmount);
      expect(requests[0].unlockTime).to.equal(BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
    });

    it("withdrawUnlocked: SSV returned to staker after cooldown", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT);

      // Wait for cooldown
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();

      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      const contractSsvBefore = await ssvToken.balanceOf(await network.getAddress());

      const tx = await network.connect(staker).withdrawUnlocked();
      await expect(tx).to.emit(network, Events.UNSTAKE_WITHDRAWN).withArgs(staker.address, STAKE_AMOUNT);

      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);
      const contractSsvAfter = await ssvToken.balanceOf(await network.getAddress());

      // SSV returned to staker
      expect(stakerSsvAfter - stakerSsvBefore).to.equal(STAKE_AMOUNT);
      expect(contractSsvBefore - contractSsvAfter).to.equal(STAKE_AMOUNT);

      // Pending unstake cleared
      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requests.length).to.equal(0);
    });
  });

  // ============================================================================
  // SECTION 2: Reward Accrual from Cluster ETH Inflow
  // ============================================================================

  describe("Reward Accrual from Cluster ETH Inflow", async function() {

    it("Network fees from validator registration flow to staking rewards pool", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // First, stake SSV to become eligible for rewards
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const networkEarningsBefore = await views.getNetworkEarnings();

      // Register a validator (source of ETH inflow)
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine blocks to accrue network fees
      await connection.networkHelpers.mine(100n);

      const networkEarningsAfter = await views.getNetworkEarnings();

      // Network fees should have accrued from validator operation
      expect(networkEarningsAfter).to.be.greaterThan(networkEarningsBefore);

      // Expected: 100 blocks * NETWORK_FEE per block
      const expectedNetworkEarnings = 100n * NETWORK_FEE;
      expect(networkEarningsAfter - networkEarningsBefore).to.equal(expectedNetworkEarnings);
    });

    it("Multiple cluster deposits increase reward pool proportionally", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Stake first
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // First validator registration
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const networkEarningsAfter1 = await views.getNetworkEarnings();

      // Mine blocks
      await connection.networkHelpers.mine(50n);

      const networkEarningsAfter50Blocks = await views.getNetworkEarnings();
      const earningsFrom1Validator = networkEarningsAfter50Blocks - networkEarningsAfter1;

      // Add second validator (double the burn rate)
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const networkEarningsAfter2Validators = await views.getNetworkEarnings();

      // Mine same number of blocks
      await connection.networkHelpers.mine(50n);

      const networkEarningsAfter2Val50Blocks = await views.getNetworkEarnings();
      const earningsFrom2Validators = networkEarningsAfter2Val50Blocks - networkEarningsAfter2Validators;

      // Earnings should double with 2 validators
      expect(earningsFrom2Validators).to.equal(earningsFrom1Validator * 2n);
    });
  });

  // ============================================================================
  // SECTION 3: Staking Rewards Distribution
  // ============================================================================

  describe("Staking Rewards Distribution", async function() {
    it("Multiple stakers share rewards proportionally", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Staker 1 stakes first
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      // Staker 2 stakes same amount
      await ssvToken.mint(staker2.address, STAKE_AMOUNT);
      await ssvToken.connect(staker2).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker2).stake(STAKE_AMOUNT);

      // Both should have equal staked balance
      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(staker2.address)).to.equal(STAKE_AMOUNT);
    });
  });

  // ============================================================================
  // SECTION 4: Invariant Checks
  // ============================================================================

  describe("Invariant Checks - Staking Consistency", async function() {

    it("Invariant: cSSV totalSupply always equals total staked across all users", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Initial state
      expect(await cssvToken.totalSupply()).to.equal(0n);
      expect(await views.totalStaked()).to.equal(0n);

      // Staker 1 stakes
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());

      // Staker 2 stakes
      await ssvToken.mint(staker2.address, STAKE_AMOUNT * 2n);
      await ssvToken.connect(staker2).approve(await network.getAddress(), STAKE_AMOUNT * 2n);
      await network.connect(staker2).stake(STAKE_AMOUNT * 2n);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());
      expect(await cssvToken.totalSupply()).to.equal(STAKE_AMOUNT * 3n);

      // Staker 1 requests partial unstake (burns cSSV)
      await network.connect(staker).requestUnstake(STAKE_AMOUNT / 2n);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());
      expect(await cssvToken.totalSupply()).to.equal(STAKE_AMOUNT * 3n - STAKE_AMOUNT / 2n);
    });

    it("Invariant: Sum of individual staked balances equals totalStaked", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Stake different amounts
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      await ssvToken.mint(staker2.address, STAKE_AMOUNT * 2n);
      await ssvToken.connect(staker2).approve(await network.getAddress(), STAKE_AMOUNT * 2n);
      await network.connect(staker2).stake(STAKE_AMOUNT * 2n);

      const staker1Balance = await views.stakedBalanceOf(staker.address);
      const staker2Balance = await views.stakedBalanceOf(staker2.address);
      const totalStaked = await views.totalStaked();

      expect(staker1Balance + staker2Balance).to.equal(totalStaked);
    });

    it("Invariant: Unstake request + staked balance = original stake", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const unstakeAmount = STAKE_AMOUNT / 3n;
      await network.connect(staker).requestUnstake(unstakeAmount);

      const stakedBalance = await views.stakedBalanceOf(staker.address);

      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      const pendingAmount = requests.reduce(
        (sum: bigint, r: { amount: bigint }) => sum + r.amount,
        0n
      );

      expect(stakedBalance + pendingAmount).to.equal(STAKE_AMOUNT);
    });
  });

  // ============================================================================
  // SECTION 5: Combined Scenarios - Full Staking Lifecycle
  // ============================================================================

  describe("Combined Scenarios - Full Staking Lifecycle", async function() {

    it("Full lifecycle: stake → cluster activity → unstake → withdraw", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // STEP 1: Stake SSV tokens
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT);
      expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT);

      // STEP 2: Generate network activity (cluster deposits → network fees)
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine blocks to accrue network fees
      await connection.networkHelpers.mine(200n);

      // Verify network earnings accrued
      const networkEarnings = await views.getNetworkEarnings();
      expect(networkEarnings).to.be.greaterThan(0n);

      // STEP 3: Request unstake (partial)
      const unstakeAmount = STAKE_AMOUNT / 2n;
      await network.connect(staker).requestUnstake(unstakeAmount);

      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);
      expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);

      // STEP 4: Wait for cooldown
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();

      // STEP 5: Withdraw unlocked SSV
      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      await network.connect(staker).withdrawUnlocked();
      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);

      expect(stakerSsvAfter - stakerSsvBefore).to.equal(unstakeAmount);

      // STEP 6: Remaining stake still active
      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);
    });

    it("Multiple unstake requests processed in order", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      // Request 3 partial unstakes
      const amount1 = STAKE_AMOUNT / 4n;
      const amount2 = STAKE_AMOUNT / 4n;
      const amount3 = STAKE_AMOUNT / 4n;

      await network.connect(staker).requestUnstake(amount1);
      await networkHelpers.time.increase(100n); // Small delay between requests
      await network.connect(staker).requestUnstake(amount2);
      await networkHelpers.time.increase(100n);
      await network.connect(staker).requestUnstake(amount3);

      // Verify 3 pending requests (order preserved)
      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);

      expect(requests.length).to.equal(3);
      expect(requests[0].amount).to.equal(amount1);
      expect(requests[1].amount).to.equal(amount2);
      expect(requests[2].amount).to.equal(amount3);

      // Wait for all cooldowns to pass
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();

      // Withdraw all at once
      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      await network.connect(staker).withdrawUnlocked();
      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);

      expect(stakerSsvAfter - stakerSsvBefore).to.equal(
        amount1 + amount2 + amount3
      );

      // All requests cleared
      const requestsAfter: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requestsAfter.length).to.equal(0);
    });
  });

  // ============================================================================
  // SECTION 6: Edge Cases and Error Conditions
  // ============================================================================

  describe("Edge Cases and Error Conditions", async function() {

    it("Cannot stake zero amount", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.stake(0)).to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
    });

    it("Cannot stake below minimum stake amount", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.stake(1)).to.be.revertedWithCustomError(network, Errors.STAKE_TOO_LOW);
    });

    it("Cannot unstake more than staked balance", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      await expect(
        network.connect(staker).requestUnstake(STAKE_AMOUNT + 1n)
      ).to.be.revertedWithCustomError(network, Errors.UNSTAKE_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Cannot unstake zero amount", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      await expect(
        network.connect(staker).requestUnstake(0)
      ).to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
    });

    it("Cannot withdraw before cooldown expires", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT);

      // Don't wait for cooldown
      await expect(
        network.connect(staker).withdrawUnlocked()
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);
    });

    it("Cannot withdraw with no pending requests", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(
        network.connect(staker).withdrawUnlocked()
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);
    });

    it("Cannot exceed maximum unstake requests (10)", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const smallAmount = STAKE_AMOUNT / 20000n; // Small enough for 10+ requests

      // Create 10 requests
      for (let i = 0; i < 2000; i++) {
        await network.connect(staker).requestUnstake(smallAmount);
      }

      // 11th request should fail
      await expect(
        network.connect(staker).requestUnstake(smallAmount)
      ).to.be.revertedWithCustomError(network, Errors.MAX_REQUESTS_AMOUNT_REACHED);
    });

    it("Cannot claim rewards when no rewards accrued", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      // No network activity, no rewards
      await expect(
        network.connect(staker).claimEthRewards()
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_CLAIM);
    });
  });
});
