import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType, UnstakeRequest } from '../../common/types.ts';
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
  setupTestContext,
} from '../../common/helpers.ts';
import { computeClusterId, generateMerkleForClusterEB, commitEBRoot } from '../../helpers/oracle.ts';
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
import { deployMultisig, multisigExec } from '../../helpers/multisig.ts';

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
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, staker, staker2] } = await setupTestContext());
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

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
      expect(stakerSsvBefore - stakerSsvAfter).to.equal(STAKE_AMOUNT);
      expect(contractSsvAfter - contractSsvBefore).to.equal(STAKE_AMOUNT);
      expect(cssvSupplyAfter - cssvSupplyBefore).to.equal(STAKE_AMOUNT);
      expect(stakerCssvAfter - stakerCssvBefore).to.equal(STAKE_AMOUNT);
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
      expect(cssvSupplyBefore - cssvSupplyAfter).to.equal(unstakeAmount);
      expect(stakerCssvBefore - stakerCssvAfter).to.equal(unstakeAmount);
      expect(stakedBefore - stakedAfter).to.equal(unstakeAmount);
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
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();

      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      const contractSsvBefore = await ssvToken.balanceOf(await network.getAddress());

      const tx = await network.connect(staker).withdrawUnlocked();
      await expect(tx).to.emit(network, Events.UNSTAKE_WITHDRAWN).withArgs(staker.address, STAKE_AMOUNT);

      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);
      const contractSsvAfter = await ssvToken.balanceOf(await network.getAddress());
      expect(stakerSsvAfter - stakerSsvBefore).to.equal(STAKE_AMOUNT);
      expect(contractSsvBefore - contractSsvAfter).to.equal(STAKE_AMOUNT);
      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requests.length).to.equal(0);
    });
  });

  describe("Reward Accrual from Cluster ETH Inflow", async function() {

    it("Network fees from validator registration flow to staking rewards pool", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const networkEarningsBefore = await views.getNetworkEarnings();
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await connection.networkHelpers.mine(100n);

      const networkEarningsAfter = await views.getNetworkEarnings();
      expect(networkEarningsAfter).to.be.greaterThan(networkEarningsBefore);
      const expectedNetworkEarnings = 100n * NETWORK_FEE;
      expect(networkEarningsAfter - networkEarningsBefore).to.equal(expectedNetworkEarnings);
    });

    it("Multiple cluster deposits increase reward pool proportionally", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const networkEarningsAfter1 = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(50n);

      const networkEarningsAfter50Blocks = await views.getNetworkEarnings();
      const earningsFrom1Validator = networkEarningsAfter50Blocks - networkEarningsAfter1;
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const networkEarningsAfter2Validators = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(50n);

      const networkEarningsAfter2Val50Blocks = await views.getNetworkEarnings();
      const earningsFrom2Validators = networkEarningsAfter2Val50Blocks - networkEarningsAfter2Validators;
      expect(earningsFrom2Validators).to.equal(earningsFrom1Validator * 2n);
    });

    it('EB=64 cluster contributes exactly 2x network-fee rewards vs EB=32', async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(
        deployFullSSVNetworkFixture,
      );

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(11),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const blocksPerPhase = 100n;
      const before32 = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(blocksPerPhase);
      const after32 = await views.getNetworkEarnings();
      const eb32Delta = after32 - before32;

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const eb64 = 64;
      const ebBlock = Number(await connection.ethers.provider.getBlockNumber());
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: eb64 },
      ]);

      await commitEBRoot(network, root, ebBlock, oracles);

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
        eb64,
        proofs[clusterId],
      );

      const before64 = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(blocksPerPhase);
      const after64 = await views.getNetworkEarnings();
      const eb64Delta = after64 - before64;

      expect(eb64Delta).to.equal(eb32Delta * 2n);
    });

    it('Multiple clusters with different EBs accrue cumulative EB-weighted staking fees', async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(
        deployFullSSVNetworkFixture,
      );

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const clusterOwner2 = staker2;
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(21),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await network.connect(clusterOwner2).registerValidator(
        makePublicKey(22),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const blocks = 120n;
      await network.connect(staker).syncFees();
      const phaseAStart = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(blocks);
      const phaseAEnd = await views.getNetworkEarnings();
      const phaseASyncTx = await network.connect(staker).syncFees();
      const phaseAReceipt = await phaseASyncTx.wait();
      const phaseAViewDelta = phaseAEnd - phaseAStart;
      const phaseAFees: bigint = phaseAReceipt!.logs
        .map((log) => network.interface.parseLog(log))
        .find((e) => e?.name === Events.FEES_SYNCED)!.args.newFeesWei;
      await expect(phaseASyncTx).to.emit(network, Events.FEES_SYNCED).withArgs(phaseAFees, anyValue);

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId1 = computeClusterId(clusterOwner.address, operatorIds);
      const clusterId2 = computeClusterId(clusterOwner2.address, operatorIds);
      const eb32 = 32;
      const eb64 = 64;
      const ebBlock = Number(await connection.ethers.provider.getBlockNumber());
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId: clusterId1, effectiveBalance: eb32 },
        { clusterId: clusterId2, effectiveBalance: eb64 },
      ]);

      await commitEBRoot(network, root, ebBlock, oracles);

      const cluster1 = await getCurrentClusterState(
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
          validatorCount: Number(cluster1.validatorCount),
          networkFeeIndex: BigInt(cluster1.networkFeeIndex),
          index: BigInt(cluster1.index),
          active: cluster1.active,
          balance: BigInt(cluster1.balance),
        },
        eb32,
        proofs[clusterId1],
      );

      const cluster2 = await getCurrentClusterState(
        connection,
        network,
        clusterOwner2.address,
        operatorIds,
      );
      await network.connect(clusterOwner2).updateClusterBalance(
        ebBlock,
        clusterOwner2.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(cluster2.validatorCount),
          networkFeeIndex: BigInt(cluster2.networkFeeIndex),
          index: BigInt(cluster2.index),
          active: cluster2.active,
          balance: BigInt(cluster2.balance),
        },
        eb64,
        proofs[clusterId2],
      );

      // Settle transition-period fees (replaceOracle + commitRoot + updateClusterBalance blocks)
      // so phase B window starts at a clean checkpoint with only 30k vUnits active.
      await network.connect(staker).syncFees();

      const phaseBStart = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(blocks);
      const phaseBEnd = await views.getNetworkEarnings();
      const phaseBSyncTx = await network.connect(staker).syncFees();
      const phaseBReceipt = await phaseBSyncTx.wait();
      const phaseBViewDelta = phaseBEnd - phaseBStart;
      const phaseBFees: bigint = phaseBReceipt!.logs
        .map((log) => network.interface.parseLog(log))
        .find((e) => e?.name === Events.FEES_SYNCED)!.args.newFeesWei;
      await expect(phaseBSyncTx).to.emit(network, Events.FEES_SYNCED).withArgs(phaseBFees, anyValue);

      // Two implicit 32-EB clusters (20k vUnits total) should become 32+64 EB (30k vUnits):
      // fee rate scales from 2x to 3x, so over equal blocks the fee deltas scale 3:2.
      expect(phaseBViewDelta * 2n).to.equal(phaseAViewDelta * 3n);
      expect(phaseBFees * 2n).to.equal(phaseAFees * 3n)
    });
  });

  describe("Staking Rewards Distribution", async function() {
    it("Multiple stakers share rewards proportionally", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await ssvToken.mint(staker2.address, STAKE_AMOUNT);
      await ssvToken.connect(staker2).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker2).stake(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(staker2.address)).to.equal(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(101),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(100n);

      const claimableA = await views.previewClaimableEth(staker.address);
      const claimableB = await views.previewClaimableEth(staker2.address);

      expect(claimableA).to.be.greaterThan(0n);
      expect(claimableA).to.equal(claimableB);
    });
  });

  describe("Invariant Checks - Staking Consistency", async function() {

    it("Invariant: cSSV totalSupply always equals total staked across all users", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      expect(await cssvToken.totalSupply()).to.equal(0n);
      expect(await views.totalStaked()).to.equal(0n);
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());
      await ssvToken.mint(staker2.address, STAKE_AMOUNT * 2n);
      await ssvToken.connect(staker2).approve(await network.getAddress(), STAKE_AMOUNT * 2n);
      await network.connect(staker2).stake(STAKE_AMOUNT * 2n);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());
      expect(await cssvToken.totalSupply()).to.equal(STAKE_AMOUNT * 3n);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT / 2n);

      expect(await cssvToken.totalSupply()).to.equal(await views.totalStaked());
      expect(await cssvToken.totalSupply()).to.equal(STAKE_AMOUNT * 3n - STAKE_AMOUNT / 2n);
    });

    it("Invariant: Sum of individual staked balances equals totalStaked", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
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

  describe("Combined Scenarios - Full Staking Lifecycle", async function() {

    it("Full lifecycle: stake → cluster activity → unstake → withdraw", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT);
      expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await connection.networkHelpers.mine(200n);
      const networkEarnings = await views.getNetworkEarnings();
      expect(networkEarnings).to.be.greaterThan(0n);
      const unstakeAmount = STAKE_AMOUNT / 2n;
      await network.connect(staker).requestUnstake(unstakeAmount);

      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);
      expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();
      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      await network.connect(staker).withdrawUnlocked();
      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);

      expect(stakerSsvAfter - stakerSsvBefore).to.equal(unstakeAmount);
      expect(await views.stakedBalanceOf(staker.address)).to.equal(STAKE_AMOUNT - unstakeAmount);
    });

    it("Multiple unstake requests processed in order", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      const amount1 = STAKE_AMOUNT / 4n;
      const amount2 = STAKE_AMOUNT / 4n;
      const amount3 = STAKE_AMOUNT / 4n;

      await network.connect(staker).requestUnstake(amount1);
      await networkHelpers.time.increase(100n);
      await network.connect(staker).requestUnstake(amount2);
      await networkHelpers.time.increase(100n);
      await network.connect(staker).requestUnstake(amount3);
      const requests: UnstakeRequest[] = await views.pendingUnstake(staker.address);

      expect(requests.length).to.equal(3);
      expect(requests[0].amount).to.equal(amount1);
      expect(requests[1].amount).to.equal(amount2);
      expect(requests[2].amount).to.equal(amount3);
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();
      const stakerSsvBefore = await ssvToken.balanceOf(staker.address);
      await network.connect(staker).withdrawUnlocked();
      const stakerSsvAfter = await ssvToken.balanceOf(staker.address);

      expect(stakerSsvAfter - stakerSsvBefore).to.equal(
        amount1 + amount2 + amount3
      );
      const requestsAfter: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requestsAfter.length).to.equal(0);
    });
  });

  describe("Edge Cases and Error Conditions", async function() {

    it("Cannot stake zero amount", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.stake(0)).to.be.revertedWithCustomError(network, Errors.STAKE_TOO_LOW);
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

    it("Withdraws full amount one year after maturity", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT);

      const oneYear = 365n * 24n * 60n * 60n;
      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + oneYear);

      const balanceBefore = await ssvToken.balanceOf(staker.address);
      const tx = await network.connect(staker).withdrawUnlocked();
      await expect(tx)
        .to.emit(network, Events.UNSTAKE_WITHDRAWN)
        .withArgs(staker.address, STAKE_AMOUNT);

      const balanceAfter = await ssvToken.balanceOf(staker.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("Does not change cSSV supply on withdrawal", async function() {
      const { network, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT);

      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

      const supplyBefore = await cssvToken.totalSupply();
      await network.connect(staker).withdrawUnlocked();
      const supplyAfter = await cssvToken.totalSupply();

      expect(supplyAfter).to.equal(supplyBefore);
    });

    it("Cannot withdraw before cooldown expires", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await network.connect(staker).requestUnstake(STAKE_AMOUNT);
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

      const smallAmount = STAKE_AMOUNT / 20000n;
      for (let i = 0; i < 2000; i++) {
        await network.connect(staker).requestUnstake(smallAmount);
      }
      await expect(
        network.connect(staker).requestUnstake(smallAmount)
      ).to.be.revertedWithCustomError(network, Errors.MAX_REQUESTS_AMOUNT_REACHED);
    });

    it("Cannot unstake when caller has no cSSV", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(
        network.connect(staker).requestUnstake(1n)
      ).to.be.revertedWithCustomError(network, Errors.UNSTAKE_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Cooldown duration change only affects new unstake requests", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const firstAmount = STAKE_AMOUNT / 4n;
      const firstTx = await network.connect(staker).requestUnstake(firstAmount);
      const firstBlock = await firstTx.getBlock();
      const expectedFirstUnlock = BigInt(firstBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

      const requestsBefore: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requestsBefore[0].unlockTime).to.equal(expectedFirstUnlock);

      const newCooldown = DEFAULT_UNSTAKE_COOLDOWN * 3n;
      await network.updateUnstakeCooldownDuration(newCooldown);

      const requestsAfterChange: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requestsAfterChange[0].unlockTime).to.equal(expectedFirstUnlock);

      const secondAmount = STAKE_AMOUNT / 4n;
      const secondTx = await network.connect(staker).requestUnstake(secondAmount);
      const secondBlock = await secondTx.getBlock();
      const expectedSecondUnlock = BigInt(secondBlock!.timestamp) + newCooldown;

      const requestsAfterSecond: UnstakeRequest[] = await views.pendingUnstake(staker.address);
      expect(requestsAfterSecond[0].unlockTime).to.equal(expectedFirstUnlock);
      expect(requestsAfterSecond[1].unlockTime).to.equal(expectedSecondUnlock);
    });

    it("Cannot claim rewards when no rewards accrued", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);
      await expect(
        network.connect(staker).claimEthRewards()
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_CLAIM);
    });
  });

  describe("Explicit EB staking revenue checks", async function() {
    it("liquidating an explicit EB=64 cluster stops further staking revenue accrual", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(9101),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebBlock = Number(await connection.ethers.provider.getBlockNumber());
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await commitEBRoot(network, root, ebBlock, oracles);

      const clusterBeforeUpdate = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.updateClusterBalance(
        ebBlock,
        clusterOwner.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(clusterBeforeUpdate.validatorCount),
          networkFeeIndex: BigInt(clusterBeforeUpdate.networkFeeIndex),
          index: BigInt(clusterBeforeUpdate.index),
          active: clusterBeforeUpdate.active,
          balance: BigInt(clusterBeforeUpdate.balance),
        },
        64,
        proofs[clusterId],
      );

      const earningsBefore = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(100n);
      const earningsBeforeLiquidation = await views.getNetworkEarnings();
      const preLiquidationDelta = earningsBeforeLiquidation - earningsBefore;
      expect(preLiquidationDelta).to.be.greaterThan(0n);

      const clusterBeforeLiquidation = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        {
          validatorCount: Number(clusterBeforeLiquidation.validatorCount),
          networkFeeIndex: BigInt(clusterBeforeLiquidation.networkFeeIndex),
          index: BigInt(clusterBeforeLiquidation.index),
          active: clusterBeforeLiquidation.active,
          balance: BigInt(clusterBeforeLiquidation.balance),
        },
      );

      const earningsImmediatelyAfterLiquidation = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(100n);
      const earningsAfterLiquidation = await views.getNetworkEarnings();
      const postLiquidationDelta = earningsAfterLiquidation - earningsImmediatelyAfterLiquidation;
      expect(postLiquidationDelta).to.equal(0n);
    });

    it("staking revenue doubles when explicit EB increases from 64 to 128", async function() {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.mint(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(9102),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      await network.updateMinBlocksBetweenUpdates(1n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const eb64Block = Number(await connection.ethers.provider.getBlockNumber());
      const merkle64 = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 64 }]);
      await commitEBRoot(network, merkle64.root, eb64Block, oracles);
      const clusterBefore64 = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.updateClusterBalance(
        eb64Block,
        clusterOwner.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(clusterBefore64.validatorCount),
          networkFeeIndex: BigInt(clusterBefore64.networkFeeIndex),
          index: BigInt(clusterBefore64.index),
          active: clusterBefore64.active,
          balance: BigInt(clusterBefore64.balance),
        },
        64,
        merkle64.proofs[clusterId],
      );

      const earningsBefore64 = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(100n);
      const earningsAfter64 = await views.getNetworkEarnings();
      const delta64 = earningsAfter64 - earningsBefore64;

      await connection.networkHelpers.mine(1n);
      const eb128Block = Number(await connection.ethers.provider.getBlockNumber());
      const merkle128 = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 128 }]);
      await commitEBRoot(network, merkle128.root, eb128Block, oracles);
      const clusterBefore128 = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.updateClusterBalance(
        eb128Block,
        clusterOwner.address,
        operatorIds.map((id) => BigInt(id)),
        {
          validatorCount: Number(clusterBefore128.validatorCount),
          networkFeeIndex: BigInt(clusterBefore128.networkFeeIndex),
          index: BigInt(clusterBefore128.index),
          active: clusterBefore128.active,
          balance: BigInt(clusterBefore128.balance),
        },
        128,
        merkle128.proofs[clusterId],
      );

      const earningsBefore128 = await views.getNetworkEarnings();
      await connection.networkHelpers.mine(100n);
      const earningsAfter128 = await views.getNetworkEarnings();
      const delta128 = earningsAfter128 - earningsBefore128;

      expect(delta64).to.be.greaterThan(0n);
      expect(delta128).to.equal(delta64 * 2n);
    });
  });

  describe("Multisig Accounts", async function() {

    it("Multisig contract stakes SSV tokens", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const multisig = await deployMultisig(connection.ethers);
      const multisigAddress = await multisig.getAddress();
      const networkAddress = await network.getAddress();

      await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
      await multisigExec(multisig, ssvToken, "approve", [networkAddress, STAKE_AMOUNT]);

      const ssvBefore = await ssvToken.balanceOf(multisigAddress);
      const contractSsvBefore = await ssvToken.balanceOf(networkAddress);

      const tx = await multisigExec(multisig, network, "stake", [STAKE_AMOUNT]);

      await expect(tx)
        .to.emit(network, Events.STAKED)
        .withArgs(multisigAddress, STAKE_AMOUNT);

      expect(await ssvToken.balanceOf(multisigAddress)).to.equal(ssvBefore - STAKE_AMOUNT);
      expect(await ssvToken.balanceOf(networkAddress)).to.equal(contractSsvBefore + STAKE_AMOUNT);
      expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);
    });

    it("Multisig stakes multiple times", async function() {
      const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const multisig = await deployMultisig(connection.ethers);
      const multisigAddress = await multisig.getAddress();
      const networkAddress = await network.getAddress();

      const totalAmount = STAKE_AMOUNT * 3n;
      await ssvToken.mint(multisigAddress, totalAmount);
      await multisigExec(multisig, ssvToken, "approve", [networkAddress, totalAmount]);

      await multisigExec(multisig, network, "stake", [STAKE_AMOUNT]);
      expect(await views.stakedBalanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);

      await multisigExec(multisig, network, "stake", [STAKE_AMOUNT]);
      expect(await views.stakedBalanceOf(multisigAddress)).to.equal(STAKE_AMOUNT * 2n);

      await multisigExec(multisig, network, "stake", [STAKE_AMOUNT]);
      expect(await views.stakedBalanceOf(multisigAddress)).to.equal(STAKE_AMOUNT * 3n);

      expect(await ssvToken.balanceOf(multisigAddress)).to.equal(0n);
      expect(await cssvToken.balanceOf(multisigAddress)).to.equal(totalAmount);
    });
  });
});
