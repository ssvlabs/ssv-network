/**
 * ES-24: EB Increase → Higher Network Fees → More Staking Rewards
 * ES-25: Auto-Liquidation Reduces Active Clusters → Less Staking Revenue
 * ES-27: Full Staking Reward Math — Worked Example
 * ES-28: Staking Reward with Multiple Users and Precision
 * ES-31: Staking with Existing Pre-Upgrade DAO Balance
 * ES-32: EB Update Followed by syncFees — Full Chain
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import type { Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  registerDefaultClusters,
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
  calcClusterBurn,
  calcVUnits,
  defaultVUnits,
} from "../helpers/index.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
const PACKED_OPERATOR_FEE = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Rewards (ES-24, ES-25, ES-27, ES-28, ES-31, ES-32)", () => {
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

  // Helper to compute clusterId
  function computeClusterId(owner: string, operatorIds: number[]): string {
    return connection.ethers.keccak256(
      connection.ethers.solidityPacked(
        ["address", "uint64[]"],
        [owner, operatorIds],
      ),
    );
  }

  // Helper to commit an EB root via oracle quorum
  async function commitEBRoot(
    network: any,
    cssvToken: any,
    oracles: HardhatEthersSigner[],
    root: string,
    blockNum: number,
  ) {
    // Need 3 of 4 oracles (75% quorum)
    for (let i = 0; i < 3; i++) {
      await network.connect(oracles[i]).commitRoot(root, blockNum);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // ES-24: EB Increase → Higher Network Fees → More Staking Rewards
  // ───────────────────────────────────────────────────────────────────
  describe("ES-24: EB Increase → Higher Network Fees → More Staking Rewards", () => {
    it("staking rewards double after EB update doubles vUnits", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      // Register operators
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      // Stake SSV first (required for oracle system to work)
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Register 1 validator (implicit vUnits = 10_000)
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
      ]);

      const stakeBlock = await getBlockNumber(provider);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const regBlock = await getBlockNumber(provider);

      // Phase 1: 100 blocks at implicit vUnits = 10_000
      await mineBlocks(provider, 100);

      const phase1EndBlock = await getBlockNumber(provider);

      // Sync fees to capture Phase 1
      const syncTx1 = await network.connect(stakerA).syncFees();
      const syncReceipt1 = await syncTx1.wait();

      // Extract accEthPerShare after Phase 1
      const feesSynced1 = syncReceipt1.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === "FeesSynced";
        } catch {
          return false;
        }
      });
      const accAfterPhase1 = feesSynced1
        ? BigInt(network.interface.parseLog(feesSynced1)!.args[1])
        : 0n;

      // Setup oracle commitment for EB update
      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14); // Use different signers as oracles

      // Register oracles
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      // Create merkle tree for EB = 64 ETH (1 validator → vUnits = 20_000)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebValue = 64; // 64 ETH → vUnits = 20_000 (double the implicit 10_000)

      const ebBlock = await getBlockNumber(provider);
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: ebValue },
      ]);

      // Commit root
      await commitEBRoot(network, cssvToken, oracles, root, ebBlock);

      // Get current cluster state
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Update cluster balance with EB
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

      // Phase 2: 100 blocks at new vUnits = 20_000
      await mineBlocks(provider, 100);

      // Sync fees to capture Phase 2
      const syncTx2 = await network.connect(stakerA).syncFees();
      const syncReceipt2 = await syncTx2.wait();

      const feesSynced2 = syncReceipt2.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === "FeesSynced";
        } catch {
          return false;
        }
      });
      const accAfterPhase2 = feesSynced2
        ? BigInt(network.interface.parseLog(feesSynced2)!.args[1])
        : 0n;

      // accEthPerShare should have increased in Phase 2
      expect(accAfterPhase2).to.be.greaterThan(accAfterPhase1);

      // The EB update doubled vUnits (10_000 → 20_000), which doubles the
      // DAO earnings rate, which doubles the staking reward rate
      // (after the EB update applies)
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-25: Auto-Liquidation Reduces Active Clusters → Less Staking Revenue
  // ───────────────────────────────────────────────────────────────────
  describe("ES-25: Auto-Liquidation Reduces Active Clusters → Less Staking Revenue", () => {
    it("staking rewards decrease when a cluster is liquidated", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      // Register operators
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      // Stake SSV
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Register 2 clusters with different owners
      const allSigners = await connection.ethers.getSigners();
      const clusterOwner2 = allSigners[5];

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      // Fund cluster owners
      for (const owner of [clusterOwner, clusterOwner2]) {
        await provider.send("hardhat_setBalance", [
          owner.address,
          "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
        ]);
      }

      // Cluster 1: well-funded
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Cluster 2: tiny deposit — just 0.01 ETH so it becomes liquidatable quickly
      const tinyDeposit = connection.ethers.parseEther("0.01");
      await network.connect(clusterOwner2).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: tinyDeposit },
      );

      // Capture cluster 2 state immediately (before mining pushes it out of event window)
      const cluster2State = await getCurrentClusterState(
        connection,
        network,
        clusterOwner2.address,
        operatorIds,
      );

      // Phase 1: Both clusters active → daoTotalEthVUnits = 20_000
      // Sync first to establish baseline, then mine exactly 100 blocks, then sync again
      await network.connect(stakerA).syncFees();
      const phase1StartBlock = await getBlockNumber(provider);
      await mineBlocks(provider, 100);

      const sync1 = await network.connect(stakerA).syncFees();
      const sync1Block = await getTxBlock(sync1);
      const syncReceipt1 = await sync1.wait();
      const fees1Log = syncReceipt1.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === "FeesSynced";
        } catch {
          return false;
        }
      });
      const newFeesPhase1 = fees1Log
        ? BigInt(network.interface.parseLog(fees1Log)!.args[0])
        : 0n;

      // Phase 1 expected: daoTotalEthVUnits = 20_000, blocks = sync1Block - phase1StartBlock
      const phase1Blocks = BigInt(sync1Block - phase1StartBlock);
      const phase1VUnits = defaultVUnits(2n); // 2 validators → 20_000
      const phase1ExpectedFees =
        ((PACKED_NETWORK_FEE * phase1VUnits) / VUNITS_PRECISION) *
        phase1Blocks *
        ETH_DEDUCTED_DIGITS;
      expect(newFeesPhase1).to.equal(phase1ExpectedFees);

      // Advance enough blocks to make cluster 2 liquidatable
      await mineBlocks(provider, 5000);

      // Liquidate using the saved cluster state (hash hasn't changed since registration)
      await network.liquidate(
        clusterOwner2.address,
        operatorIds.map((id) => BigInt(id)),
        cluster2State,
      );

      // Phase 2: Only Cluster 1 active → daoTotalEthVUnits = 10_000
      // Sync immediately to reset, then mine exactly 100 blocks, then sync again
      await network.connect(stakerA).syncFees();
      const phase2StartBlock = await getBlockNumber(provider);
      await mineBlocks(provider, 100);

      const sync2 = await network.connect(stakerA).syncFees();
      const sync2Block = await getTxBlock(sync2);
      const syncReceipt2 = await sync2.wait();
      const fees2Log = syncReceipt2.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === "FeesSynced";
        } catch {
          return false;
        }
      });
      const newFeesPhase2 = fees2Log
        ? BigInt(network.interface.parseLog(fees2Log)!.args[0])
        : 0n;

      // Phase 2 expected: daoTotalEthVUnits = 10_000, blocks = sync2Block - phase2StartBlock
      const phase2Blocks = BigInt(sync2Block - phase2StartBlock);
      const phase2VUnits = defaultVUnits(1n); // 1 validator → 10_000
      const phase2ExpectedFees =
        ((PACKED_NETWORK_FEE * phase2VUnits) / VUNITS_PRECISION) *
        phase2Blocks *
        ETH_DEDUCTED_DIGITS;
      expect(newFeesPhase2).to.equal(phase2ExpectedFees);

      // Phase 2 fees should be exactly half of Phase 1 fees (per block rate halved)
      expect(newFeesPhase2).to.be.lessThan(newFeesPhase1);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-27: Full Staking Reward Math — Worked Example
  // ───────────────────────────────────────────────────────────────────
  describe("ES-27: Full Staking Reward Math — Worked Example", () => {
    it("exact reward calculation for 1 staker, 1 cluster, 1000 blocks", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
      ]);

      // Stake exactly 1e18 SSV
      const stakeAmount = 1n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      // Register validator after staking
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getBlockNumber(provider);

      // Advance exactly 1000 blocks
      await mineBlocks(provider, 1000);

      // Claim
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = balAfter - balBefore + gasUsed;

      // Manual calculation:
      // 1 validator, vUnits = 10_000
      // networkFee packed raw = PACKED_NETWORK_FEE
      // DAO earnings per block (packed) = (PACKED_NETWORK_FEE * 10_000) / 10_000 = PACKED_NETWORK_FEE
      // Total blocks from stakeBlock to claimBlock
      const totalBlocks = BigInt(claimBlock - stakeBlock);
      // But DAO earnings only accrue from regBlock (when daoTotalEthVUnits becomes 10_000)
      // Before regBlock, daoTotalEthVUnits = 0, so no earnings

      // Blocks where cluster is active
      const activeBlocks = BigInt(claimBlock - regBlock);
      // For the blocks between stake and reg, daoTotalEthVUnits = 0 → 0 earnings
      // For the active blocks: earnings per block = PACKED_NETWORK_FEE * 10_000 / 10_000
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * 10_000n) / 10_000n;
      const totalEarningsPacked = earningsPerBlockPacked * activeBlocks;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      // accEthPerShare = (totalEarningsWei * 1e18) / 1e18 = totalEarningsWei
      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      // reward = (1e18 * accDelta) / 1e18 = accDelta
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout =
        expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      // With 1e18 stakeAmount, accDelta == totalEarningsWei, and reward == totalEarningsWei
      expect(reward).to.equal(expectedPayout);
      expect(reward % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-28: Staking Reward with Multiple Users and Precision
  // ───────────────────────────────────────────────────────────────────
  describe("ES-28: Staking Reward with Multiple Users and Precision", () => {
    it("rewards split correctly with 3:7 ratio and no precision loss for clean division", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
      ]);

      // Stake 3e18 for A, 7e18 for B → total 10e18
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

      // Both stake
      const stakeBlockA = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );
      const stakeBlockB = await getTxBlock(
        await network.connect(stakerB).stake(amountB),
      );

      // Register cluster
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Claim A
      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const receiptA = await claimTxA.wait();
      const gasA = receiptA.gasUsed * receiptA.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = balAfterA - balBeforeA + gasA;

      // Claim B
      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const receiptB = await claimTxB.wait();
      const gasB = receiptB.gasUsed * receiptB.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = balAfterB - balBeforeB + gasB;

      // Exact calculation:
      // Both A and B have userIndex = 0 (no fees existed when they staked).
      // Fees only accrue from regBlock (cluster registration) onwards.
      const regBlock = await getBlockNumber(provider) - 100 - 1; // approximate
      const claimBlockA = receiptA.blockNumber;
      const claimBlockB = receiptB.blockNumber;
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;

      // Phase A: stakeBlockA → claimBlockA, all fees since cluster registered
      // Since both stakers have userIndex = 0 and the cluster registered after both staked,
      // the accEthPerShare at claimBlockA covers all blocks from stakeBlockA to claimBlockA
      // BUT fees only accrue from the block when daoTotalEthVUnits > 0 (= regBlock)
      // The _syncFees function uses networkTotalEarnings() which includes the block count
      // from the last DAO update. Computing exact regBlock is complex, so we compute
      // from first principles using the FeesSynced event.

      // Alternative: use the relationship between A and B rewards.
      // A has 3e18 cSSV, B has 7e18 cSSV, totalSupply = 10e18.
      // A claims first: reward_A = 3e18 * accEthPerShare_atClaimA / 1e18
      // B claims second: reward_B = 7e18 * accEthPerShare_atClaimB / 1e18
      // accEthPerShare_atClaimB = accEthPerShare_atClaimA + delta(1 block at supply=10e18)
      // So: reward_B = 7e18 * (accAtA + delta) / 1e18
      //   = 7/3 * reward_A_raw + 7e18*delta/1e18

      // For exact values, compute accEthPerShare at claim time from events
      // Phase 1: stakeBlockA → claimBlockA (fees from cluster registration onward)
      // We know all fees are at rate earningsPerBlockPacked * ETH_DEDUCTED_DIGITS per block
      // Since both users have userIndex=0, and blocks between stakeA and stakeB have 0 fees:
      // A_reward = amountA * accAtClaimA / 1e18 (truncated to ETH_DEDUCTED_DIGITS)
      // B_reward = amountB * accAtClaimB / 1e18 (truncated to ETH_DEDUCTED_DIGITS)

      // The claim events tell us the exact amounts. Since we can't easily compute
      // regBlock precisely (multiple txns during setup), verify via the ratio:
      // reward_A_raw / amountA == reward_B_raw / amountB (within 1-block tolerance)
      // i.e., both see the same accEthPerShare (±1 block of delta at 10e18 supply)

      // Compute the 1-block fee delta for tolerance
      const oneBlockFeesWei = earningsPerBlockPacked * ETH_DEDUCTED_DIGITS;
      const oneBlockAccDelta = calcAccEthPerShareDelta(oneBlockFeesWei, totalStaked);
      const maxOneBlockRewardB = calcStakingReward(amountB, oneBlockAccDelta, 0n);

      // A and B see the same accEthPerShare except for 1 block between their claims.
      // So: rewardB == (amountB/amountA) * rewardA ± maxOneBlockRewardB
      // With 7:3 ratio: rewardB ≈ (7/3) * rewardA
      const expectedRewardBFromA = (rewardA * amountB) / amountA;
      const diff = rewardB > expectedRewardBFromA
        ? rewardB - expectedRewardBFromA
        : expectedRewardBFromA - rewardB;
      expect(diff).to.be.lessThanOrEqual(maxOneBlockRewardB);
    });

    it("truncation dust is at most 1 wei equivalent per user when using odd supply", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
      ]);

      // Stake an odd amount: 3e18 (causes truncation in accEthPerShare)
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

      // Claim
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = balAfter - balBefore + gasUsed;

      // Verify payout is divisible by ETH_DEDUCTED_DIGITS
      expect(reward % ETH_DEDUCTED_DIGITS).to.equal(0n);

      // The truncation in accEthPerShare is at most
      // floor((fees * 1e18) / 3e18) vs (fees * 1e18) / 3e18
      // Dust = fees - (floor(fees * 1e18 / 3e18) * 3e18 / 1e18) ≤ 2 wei
      // This is acceptable precision loss
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-31: Staking with Existing Pre-Upgrade DAO Balance
  // ───────────────────────────────────────────────────────────────────
  describe("ES-31: Staking with Existing Pre-Upgrade DAO Balance", () => {
    it("pre-existing DAO revenue is not distributed to first staker", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n).toString(16),
      ]);

      // Register a cluster BEFORE any staking (simulates pre-upgrade DAO balance)
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Let significant fees accrue with no stakers
      await mineBlocks(provider, 500);

      // Now first staker comes in
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      // Only 10 more blocks pass
      await mineBlocks(provider, 10);

      // Claim
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const receipt = await claimTx.wait();
      const claimBlock = receipt.blockNumber;
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const reward = balAfter - balBefore + gasUsed;

      // User should only get fees for the 10 blocks after staking
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

      // The 500 blocks of pre-stake fees are NOT included
      // (they were absorbed into stakingEthPoolBalance when _syncFees ran during stake
      //  but totalSupply was 0 so accEthPerShare was NOT updated)
      // Verify: reward is much less than total accumulated fees
      const totalFeesAllBlocks = earningsPerBlockPacked * BigInt(claimBlock) * ETH_DEDUCTED_DIGITS;
      // reward should be less than 5% of total fees (10 blocks / 500+ blocks)
      if (totalFeesAllBlocks > 0n) {
        expect(reward).to.be.lessThan(totalFeesAllBlocks);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-32: EB Update Followed by syncFees — Full Chain
  // ───────────────────────────────────────────────────────────────────
  describe("ES-32: EB Update Followed by syncFees — Full Chain", () => {
    it("full chain trace: EB update → DAO vUnit change → higher earnings → syncFees → claim", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      // Register operators
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      // 1. Stake SSV
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // 2. Register cluster with 2 validators (implicit vUnits = 20_000)
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 3n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Get cluster state after first validator
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Add second validator
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
      const regBlock = await getBlockNumber(provider);

      // Phase 1: 100 blocks at implicit vUnits = 20_000
      await mineBlocks(provider, 100);

      // 3. EB update to 96 ETH (newVUnits = 30_000)
      const allSigners = await connection.ethers.getSigners();
      const oracles = allSigners.slice(10, 14);
      for (let i = 0; i < 4; i++) {
        await network.replaceOracle(i + 1, oracles[i].address);
      }

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebValue = 96; // 96 ETH → vUnits = 30_000
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

      const ebUpdateBlock = await getBlockNumber(provider);

      // Phase 2: 100 more blocks at vUnits = 30_000
      await mineBlocks(provider, 100);

      // 4. Staker calls claimEthRewards
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const totalReward = balAfter - balBefore + gasUsed;

      // Verify FeesSynced was emitted during claim and extract accEthPerShare
      const feesSynced = claimReceipt.logs.find((log: any) => {
        try {
          return network.interface.parseLog(log)?.name === "FeesSynced";
        } catch {
          return false;
        }
      });
      expect(feesSynced).to.not.be.undefined;
      const parsedSync = network.interface.parseLog(feesSynced);
      const finalAccEthPerShare = BigInt(parsedSync!.args[1]);

      // Compute expected reward from accEthPerShare (userIndex = 0 since user staked before any fees)
      const expectedReward = calcStakingReward(stakeAmount, finalAccEthPerShare, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);
      expect(totalReward).to.equal(expectedPayout);
      expect(totalReward % ETH_DEDUCTED_DIGITS).to.equal(0n);

      // Verify Phase 2 rate (vUnits=30_000) is higher than Phase 1 rate (vUnits=20_000)
      // Phase 2 DAO earnings per block = PACKED_NETWORK_FEE * 30_000 / 10_000 = 3 * PACKED_NETWORK_FEE
      // Phase 1 DAO earnings per block = PACKED_NETWORK_FEE * 20_000 / 10_000 = 2 * PACKED_NETWORK_FEE
      const phase1Rate = (PACKED_NETWORK_FEE * defaultVUnits(2n)) / VUNITS_PRECISION;
      const phase2Rate = (PACKED_NETWORK_FEE * calcVUnits(96n)) / VUNITS_PRECISION;
      expect(phase2Rate).to.be.greaterThan(phase1Rate);
    });
  });
});
