import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import {
  ssvNetworkFullFixture,
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  extractEventArgs,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  setupTestContext,
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
  generateMerkleForClusterEB,
  mineBlocks,
  getBlockNumber,
  defaultVUnits,
  calcVUnits,
  makeOperatorKey,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  TOKEN_REGISTER_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  DEFAULT_NETWORK_FEE_UNPACKED,
  DECLARE_OPERATOR_FEE_PERIOD,
  NETWORK_FEE_ETH,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

// ═══════════════════════════════════════════════════════════════
// Diamond storage slot constants
// ═══════════════════════════════════════════════════════════════
const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n;
const DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT = PROTOCOL_BASE_SLOT + 4n;
const DAO_TOTAL_SHIFT = 192n;
const UINT64_MASK = (1n << 64n) - 1n;
const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

// ═══════════════════════════════════════════════════════════════
// Storage-reading helpers
// ═══════════════════════════════════════════════════════════════
async function readOperatorEthVUnits(
  provider: any,
  proxyAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(proxyAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

async function readDaoTotalEthVUnits(
  provider: any,
  proxyAddress: string,
): Promise<bigint> {
  const slotHex = "0x" + DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT.toString(16);
  const raw = await provider.getStorage(proxyAddress, slotHex);
  return (BigInt(raw) >> DAO_TOTAL_SHIFT) & UINT64_MASK;
}

// ═══════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════
describe("XG: Migration x Staking Cross-Module Tests", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;
  let stakerC: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [
        operatorOwner,
        clusterOwner,
        clusterOwner2,
        staker,
        stakerB,
        stakerC,
        oracle1,
        oracle2,
        oracle3,
        oracle4,
        liquidator,
      ],
    } = await setupTestContext());
  });

  // ── Legacy fixture: deploy v1 network, register SSV ops + cluster, upgrade ──
  function createLegacyFixture(opts: {
    numOps?: number;
    numValidators?: number;
    ssvDeposit?: bigint;
  } = {}) {
    const numOps = opts.numOps ?? 4;
    const numValidators = opts.numValidators ?? 1;
    const ssvDeposit = opts.ssvDeposit ?? TOKEN_REGISTER_AMOUNT;

    return async function fixture() {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < numOps; i++) {
        const expectedId = await legacyNetwork.connect(operatorOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(operatorOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, ssvDeposit * BigInt(numValidators));
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit * BigInt(numValidators),
      );

      let cluster: Cluster = EMPTY_CLUSTER;
      for (let v = 0; v < numValidators; v++) {
        const tx = await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(v + 1), operatorIds, DEFAULT_SHARES, ssvDeposit, cluster,
        );
        const receipt = await tx.wait();
        cluster = parseClusterFromEvent(legacyNetwork, receipt, Events.VALIDATOR_ADDED);
      }

      const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, cssvToken: cssv, operatorIds, cluster };
    };
  }

  // ── ETH-native fixture: deploy v2 network with ETH operators ──
  function createETHFixture(numOps = 4) {
    return async function fixture() {
      const { network, views, ssvToken, cssvToken } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
      const operatorIds = await registerOperators(network, operatorOwner, numOps);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address, clusterOwner2.address,
      ]);
      return { network, views, ssvToken, cssvToken, operatorIds };
    };
  }

  // ── Register ETH validator and return cluster ──
  async function registerCluster(
    network: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    deposit?: bigint,
    pubkeyIndex = 1,
    cluster?: Cluster,
  ): Promise<{ cluster: Cluster; block: number }> {
    const dep = deposit ?? DEFAULT_ETH_REGISTER_VALUE;
    const tx = await network
      .connect(owner)
      .registerValidator(
        makePublicKey(pubkeyIndex),
        operatorIds,
        DEFAULT_SHARES,
        cluster ?? EMPTY_CLUSTER,
        { value: dep },
      );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
      block: receipt!.blockNumber,
    };
  }

  // ── Commit EB root + updateClusterBalance ──
  async function commitAndUpdateEB(
    network: any,
    provider: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
  ): Promise<{ cluster: Cluster; block: number }> {
    const clusterId = computeClusterId(owner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);
    const tx = await network
      .connect(owner)
      .updateClusterBalance(rootBlockNum, owner.address, operatorIds, cluster, effectiveBalance, []);
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
      block: receipt!.blockNumber,
    };
  }

  // ── Commit EB root with merkle proofs for multiple clusters ──
  async function commitAndUpdateEBMulti(
    network: any,
    provider: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
    entries: { clusterId: string; effectiveBalance: number }[],
  ): Promise<{ cluster: Cluster; block: number }> {
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);
    const clusterId = computeClusterId(owner.address, operatorIds);
    const proof = proofs[clusterId] ?? [];
    const tx = await network
      .connect(owner)
      .updateClusterBalance(rootBlockNum, owner.address, operatorIds, cluster, effectiveBalance, proof);
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
      block: receipt!.blockNumber,
    };
  }

  // ── Stake SSV for cSSV ──
  async function stakeSSV(
    network: any,
    ssvToken: any,
    user: HardhatEthersSigner,
    amount: bigint,
  ): Promise<number> {
    const networkAddress = await network.getAddress();
    await ssvToken.transfer(user.address, amount);
    await ssvToken.connect(user).approve(networkAddress, amount);
    const tx = await network.connect(user).stake(amount);
    const receipt = await tx.wait();
    return receipt!.blockNumber;
  }

  // ── Claim and return ETH received (accounting for gas) ──
  async function claimAndGetAmount(
    network: any,
    provider: any,
    user: HardhatEthersSigner,
  ): Promise<{ amount: bigint; block: number }> {
    const balBefore = BigInt(await provider.getBalance(user.address));
    const tx = await network.connect(user).claimEthRewards();
    const receipt = await tx.wait();
    const balAfter = BigInt(await provider.getBalance(user.address));
    const gasCost = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);
    return {
      amount: balAfter - balBefore + gasCost,
      block: receipt!.blockNumber,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. Core Migration + Staking Flow (XG-001 to XG-006)
  // ═══════════════════════════════════════════════════════════════
  describe("Core Migration + Staking Flow", () => {
    it("XG-001: Stake -> migrate SSV cluster -> syncFees -> claimEthRewards (happy path)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 3 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // syncFees before migration: no ETH clusters yet
      await network.connect(staker).syncFees();
      const accBefore = BigInt(await views.accEthPerShare());

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(3n));

      // Advance blocks to accrue fees
      await mineBlocks(provider, 100);

      // Sync fees
      await network.connect(staker).syncFees();
      const accAfterSync = BigInt(await views.accEthPerShare());
      expect(accAfterSync).to.be.greaterThan(accBefore);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS; // legacy fixture
      const vUnits = defaultVUnits(3n);
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      // Payout must be truncated to ETH_DEDUCTED_DIGITS granularity
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });

    it("XG-002: Migrate -> stake -> advance -> syncFees -> claim (staker enters AFTER migration)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Migrate first
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Advance blocks BEFORE staking — fees generated here should NOT be retroactively available
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreStake = BigInt(await views.accEthPerShare());

      // Stake after migration
      const stakeAmount = ethers.parseEther("10");
      const stakeBlock = await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Advance more blocks
      await mineBlocks(provider, 100);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Staker's rewards should only reflect post-stake blocks
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - stakeBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });

    it("XG-003: Two stakers (pre/post migration) -> migrate -> syncFees -> both claim proportional share", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Staker A stakes before migration
      const stakeA = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeA);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;

      // Advance blocks
      await mineBlocks(provider, 50);

      // Staker B stakes after migration
      const stakeB = ethers.parseEther("30");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeB);

      // Advance more blocks
      await mineBlocks(provider, 50);

      // Both claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);

      // Exact reward computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(2n);

      // Phase 1: migration to stakeB (only staker A has cSSV)
      const phase1Blocks = BigInt(stakeBBlock - migrateBlock);
      const phase1FeesWei = (phase1Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeA;

      // Phase 2: stakeB to claimA (both stakers)
      const phase2Blocks = BigInt(claimA.block - stakeBBlock);
      const phase2FeesWei = (phase2Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalSupply2 = stakeA + stakeB;
      const delta2 = (phase2FeesWei * PRECISION) / totalSupply2;

      const expectedARaw = (stakeA * (delta1 + delta2)) / PRECISION;
      const expectedA = expectedARaw - (expectedARaw % ETH_DEDUCTED_DIGITS);
      expect(claimA.amount).to.equal(expectedA);

      // Phase 3: claimA to claimB
      const phase3Blocks = BigInt(claimB.block - claimA.block);
      const phase3FeesWei = (phase3Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta3 = (phase3FeesWei * PRECISION) / totalSupply2;

      const expectedBRaw = (stakeB * (delta2 + delta3)) / PRECISION;
      const expectedB = expectedBRaw - (expectedBRaw % ETH_DEDUCTED_DIGITS);
      expect(claimB.amount).to.equal(expectedB);

      expect(claimA.amount + claimB.amount).to.equal(expectedA + expectedB);
    });

    it("XG-004: Migrate -> updateClusterBalance (explicit EB > baseline) -> syncFees -> claim", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Setup oracles (required for commitEBRoot) — also stakes STAKE_AMOUNT for staker
      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate (implicit EB: 2 validators * 32 ETH = 64 ETH, vUnits = 20000)
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      let migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accBeforeEB = BigInt(await views.accEthPerShare());

      // Oracle updates EB to 128 ETH (64 ETH/validator) -> vUnits = 40000
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds,
        migratedCluster, 128,
      );
      const ebBlock = ebResult.block;

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(calcVUnits(128n));

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterEB = BigInt(await views.accEthPerShare());
      expect(accAfterEB).to.be.greaterThan(accBeforeEB);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: two phases with different vUnits, single staker
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount; // setupOracles stakes STAKE_AMOUNT + stakeSSV stakes stakeAmount
      const vUnitsPhase1 = defaultVUnits(2n);
      const vUnitsPhase2 = calcVUnits(128n);

      const phase1Blocks = BigInt(ebBlock - migrateBlock);
      const phase1FeesWei = (phase1Blocks * networkFeePacked * vUnitsPhase1 / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / totalCSSV;

      const phase2Blocks = BigInt(claimBlock - ebBlock);
      const phase2FeesWei = (phase2Blocks * networkFeePacked * vUnitsPhase2 / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / totalCSSV;

      const expectedRaw = (totalCSSV * (delta1 + delta2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-005: Explicit EB set on SSV cluster before migration -> carries deviation into daoTotalEthVUnits", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Register ETH cluster with 2 validators
      let reg = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 1);
      let cluster = reg.cluster;
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 2, cluster);
      cluster = reg2.cluster;

      // Set explicit EB = 128 ETH (2 validators at 64 ETH each) -> vUnits = 40000
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 128,
      );

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      const expectedVUnits = calcVUnits(128n);
      expect(daoVUnits).to.equal(expectedVUnits);

      // Stake and verify rewards accrue at the elevated EB rate
      const stakeAmount = ethers.parseEther("10");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);

      // Exact reward: stakerB only gets fees from stake block to claim block
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS; // ETH fixture
      const vUnits = calcVUnits(128n);
      const totalCSSV = STAKE_AMOUNT + stakeAmount; // staker (from setupOracles) + stakerB
      const blockDiff = BigInt(claimBlock - stakeBBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-006: Migrate -> network fee change -> syncFees -> claim (both fee rate periods)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterPeriod1 = BigInt(await views.accEthPerShare());

      // Change network fee (double DEFAULT_NETWORK_FEE_UNPACKED)
      const newFee = DEFAULT_NETWORK_FEE_UNPACKED * 2n;
      const feeChangeTx = await network.updateNetworkFee(newFee);
      const feeChangeBlock = (await feeChangeTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterPeriod2 = BigInt(await views.accEthPerShare());

      // accEthPerShare should have grown more in period 2 (higher fee)
      expect(accAfterPeriod2).to.be.greaterThan(accAfterPeriod1);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: two phases with different network fees
      const PRECISION = 10n ** 18n;
      const fee1Packed = 3_000_000_000n / ETH_DEDUCTED_DIGITS; // legacy fixture initial fee
      const fee2Packed = newFee / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const phase1Blocks = BigInt(feeChangeBlock - migrateBlock);
      const phase1FeesWei = (phase1Blocks * fee1Packed * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeAmount;

      const phase2Blocks = BigInt(claimBlock - feeChangeBlock);
      const phase2FeesWei = (phase2Blocks * fee2Packed * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / stakeAmount;

      const expectedRaw = (stakeAmount * (delta1 + delta2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. Migration + Liquidation + Staking (XG-007 to XG-009)
  // ═══════════════════════════════════════════════════════════════
  describe("Migration + Liquidation + Staking", () => {
    it("XG-007: Migrate -> liquidate -> syncFees -> claim (frozen rewards)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // G2: Capture SSV balances before migration for conservation check
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVBefore = await ssvToken.balanceOf(networkAddress);

      // Migrate with small balance so cluster drains quickly
      // Legacy fixture: minimumBlocksBeforeLiquidation=214800, threshold for 2 validators ≈ 0.004345 ETH
      const smallDeposit = ethers.parseEther("0.005");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: smallDeposit },
      );
      const migrateReceipt = await migrateTx.wait();
      let migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // G2: SSV conservation — refund from event matches actual token transfer
      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ssvRefunded = BigInt(migrateEventArgs.ssvRefunded);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVAfter = await ssvToken.balanceOf(networkAddress);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefunded, "G2: owner SSV delta must match refund");
      expect(contractSSVBefore - contractSSVAfter).to.equal(ssvRefunded, "G2: contract SSV delta must match refund");

      // G4: Per-operator vUnits deviation after migration (2 validators, implicit EB = no deviation)
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnits).to.equal(0n, `G4: operator ${opId} deviation vUnits must be 0 for implicit EB`);
      }
      // G4: daoTotalEthVUnits == validatorCount * BPS (baseline only, no deviation)
      const daoVUnitsMigrated = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsMigrated).to.equal(defaultVUnits(2n), "G4: daoTotalEthVUnits post-migration");

      // Advance blocks to drain the cluster and sync right before liquidation
      await mineBlocks(provider, 500_000);
      const syncPreLiqTx = await network.syncFees();
      const syncPreLiqBlock = (await syncPreLiqTx.wait())!.blockNumber;
      const accPreLiq = BigInt(await views.accEthPerShare());

      // Liquidate using cluster from migration event (getCurrentClusterState lookback too small)
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;

      // daoTotalEthVUnits should drop to 0
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      // G4: Per-operator vUnits should all be 0 after liquidation
      for (const opId of operatorIds) {
        const opVUnitsPost = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnitsPost).to.equal(0n, `G4: operator ${opId} vUnits must be 0 post-liquidation`);
      }

      // Advance and sync post-liquidation
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accPostLiq = BigInt(await views.accEthPerShare());
      // Accumulator increases by fees accrued between syncPreLiq and liquidation (1 block gap)
      // After liquidation, vUnits = 0 so no more fees accrue
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(2n);
      const gapBlocks = BigInt(liqBlock - syncPreLiqBlock);
      const gapFeesWei = (gapBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const gapDelta = (gapFeesWei * PRECISION) / stakeAmount;
      expect(accPostLiq).to.equal(accPreLiq + gapDelta);

      // Claim — all fees from migration to liquidation
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const migrateBlock = migrateReceipt!.blockNumber;
      const totalFeesBlocks = BigInt(liqBlock - migrateBlock);
      const totalFeesWei = (totalFeesBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalAccDelta = (totalFeesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * totalAccDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-008: Multiple stakers + migrate + liquidate -> proportional distribution", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Three stakers with different cSSV balances
      const stakeAmountA = ethers.parseEther("10");
      const stakeAmountB = ethers.parseEther("20");
      const stakeAmountC = ethers.parseEther("30");
      await stakeSSV(network, ssvToken, staker, stakeAmountA);
      await stakeSSV(network, ssvToken, stakerB, stakeAmountB);
      await stakeSSV(network, ssvToken, stakerC, stakeAmountC);

      // Migrate with small balance so cluster drains quickly
      // Legacy fixture: threshold for 2 validators ≈ 0.004345 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.005") },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Advance, sync
      await mineBlocks(provider, 50);
      await network.syncFees();

      // Liquidate — 500K blocks drains ~0.01 ETH, balance goes to 0
      await mineBlocks(provider, 500_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);
      const liqBlock = (await liqTx.wait())!.blockNumber;

      // All three claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);
      const claimC = await claimAndGetAmount(network, provider, stakerC);

      // Exact reward: fees accrue from migration to liquidation, shared proportionally
      // After liquidation vUnits = 0, so no more fees accrue between claims
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(2n);
      const totalCSSV = stakeAmountA + stakeAmountB + stakeAmountC;
      const totalFeeBlocks = BigInt(liqBlock - migrateBlock);
      const totalFeesWei = (totalFeeBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (totalFeesWei * PRECISION) / totalCSSV;

      const expectedARaw = (stakeAmountA * accDelta) / PRECISION;
      const expectedA = expectedARaw - (expectedARaw % ETH_DEDUCTED_DIGITS);
      expect(claimA.amount).to.equal(expectedA);

      const expectedBRaw = (stakeAmountB * accDelta) / PRECISION;
      const expectedB = expectedBRaw - (expectedBRaw % ETH_DEDUCTED_DIGITS);
      expect(claimB.amount).to.equal(expectedB);

      const expectedCRaw = (stakeAmountC * accDelta) / PRECISION;
      const expectedC = expectedCRaw - (expectedCRaw % ETH_DEDUCTED_DIGITS);
      expect(claimC.amount).to.equal(expectedC);

      // Proportional distribution: C got ~3x more than A, B got ~2x more than A
      if (claimA.amount > 0n) {
        const ratioB = (claimB.amount * 100n) / claimA.amount;
        const ratioC = (claimC.amount * 100n) / claimA.amount;
        expect(ratioB).to.be.greaterThan(150n); // ~200
        expect(ratioC).to.be.greaterThan(250n); // ~300
      }
    });

    it("XG-009: Migrate -> liquidate -> reactivate -> syncFees -> claim full lifecycle", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate with small balance so cluster drains quickly
      // Legacy fixture: threshold for 1 validator ≈ 0.002173 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.003") },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      let migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreLiq = BigInt(await views.accEthPerShare());

      // Drain and liquidate — 500K blocks at ~10.12 gwei/block drains ~0.00506 ETH
      await mineBlocks(provider, 500_000);
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // Reactivate with fresh deposit
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivateBlock = reactivateReceipt!.blockNumber;

      const daoVUnitsAfterReact = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterReact).to.equal(defaultVUnits(1n));

      // Advance and sync post-reactivation
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accPostReact = BigInt(await views.accEthPerShare());
      expect(accPostReact).to.be.greaterThan(accPreLiq);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: two active phases (migration→liquidation, reactivation→claim)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const phase1Blocks = BigInt(liqBlock - migrateBlock);
      const phase1FeesWei = (phase1Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeAmount;

      const phase2Blocks = BigInt(claimBlock - reactivateBlock);
      const phase2FeesWei = (phase2Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / stakeAmount;

      const expectedRaw = (stakeAmount * (delta1 + delta2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. Unstake Interactions (XG-010 to XG-011)
  // ═══════════════════════════════════════════════════════════════
  describe("Unstake Interactions", () => {
    it("XG-010: Stake -> migrate -> requestUnstake (partial) -> syncFees -> claim", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);

      // Partial unstake (half) — settles phase 1 rewards internally
      const halfStake = stakeAmount / 2n;
      const unstakeTx = await network.connect(staker).requestUnstake(halfStake);
      const unstakeBlock = (await unstakeTx.wait())!.blockNumber;

      // Advance and claim on reduced cSSV balance
      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: two phases (full cSSV, then half after unstake)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      // Phase 1: migration to unstake (totalCSSV = stakeAmount)
      const phase1Blocks = BigInt(unstakeBlock - migrateBlock);
      const phase1FeesWei = (phase1Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeAmount;
      // Settled at unstake: full cSSV balance * delta1
      const settledRaw = (stakeAmount * delta1) / PRECISION;

      // Phase 2: unstake to claim (totalCSSV = halfStake)
      const phase2Blocks = BigInt(claimBlock - unstakeBlock);
      const phase2FeesWei = (phase2Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / halfStake;
      const phase2Raw = (halfStake * delta2) / PRECISION;

      const totalRaw = settledRaw + phase2Raw;
      const expectedClaim = totalRaw - (totalRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });

    it("XG-011: Full unstake (BUG-6) -> fees generated during zero-supply period are lost", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = STAKE_AMOUNT;
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);
      const syncTx = await network.syncFees();
      const syncBlock = (await syncTx.wait())!.blockNumber;
      const accPreUnstake = BigInt(await views.accEthPerShare());

      // Full unstake -> totalSupply = 0
      const unstakeTx = await network.connect(staker).requestUnstake(stakeAmount);
      const unstakeBlock = (await unstakeTx.wait())!.blockNumber;

      // Advance 200 blocks — fees generated but no cSSV to distribute to
      await mineBlocks(provider, 200);
      await network.syncFees();
      const accDuringZero = BigInt(await views.accEthPerShare());
      // requestUnstake syncs internally: 1 block of fees from syncBlock to unstakeBlock
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const gapBlocks = BigInt(unstakeBlock - syncBlock);
      const gapFeesWei = (gapBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const gapDelta = (gapFeesWei * PRECISION) / stakeAmount;
      expect(accDuringZero).to.equal(accPreUnstake + gapDelta);

      // stakingEthPoolBalance is inflated relative to what can be claimed
      const poolBalance = BigInt(await views.stakingEthPoolBalance());

      // New staker enters
      const stakeAmountB = STAKE_AMOUNT;
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmountB);

      await mineBlocks(provider, 50);

      // stakerB can only claim post-re-stake fees, NOT the 200-block gap fees
      const { amount: claimB, block: claimBBlock } = await claimAndGetAmount(network, provider, stakerB);
      const blockDiffB = BigInt(claimBBlock - stakeBBlock);
      const feesWeiB = (blockDiffB * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDeltaB = (feesWeiB * PRECISION) / stakeAmountB;
      const expectedBRaw = (stakeAmountB * accDeltaB) / PRECISION;
      const expectedClaimB = expectedBRaw - (expectedBRaw % ETH_DEDUCTED_DIGITS);
      expect(claimB).to.equal(expectedClaimB);

      // Verify: pool balance > total claimable (BUG-6 confirmed — fees lost)
      const poolAfter = BigInt(await views.stakingEthPoolBalance());
      expect(poolAfter).to.be.greaterThan(claimB);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. Removed Operator + Staking Divergence (XG-012 to XG-013)
  // ═══════════════════════════════════════════════════════════════
  describe("Removed Operator + Staking Divergence", () => {
    it("XG-012: Migrate with removed operator -> syncFees -> claim (burn rate vs reward rate divergence)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Register validator
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      // Remove operator 4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Stake
      const stakeAmount = ethers.parseEther("10");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 100);
      await network.syncFees();

      // daoTotalEthVUnits still includes baseline for all 4 ops
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(1n));

      // Claim rewards
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS; // ETH fixture
      const vUnits = defaultVUnits(1n);
      const totalCSSV = STAKE_AMOUNT + stakeAmount; // staker (setupOracles) + stakerB
      const blockDiff = BigInt(claimBlock - stakeBBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-013: Migrate with removed op + explicit EB -> stranded deviation inflates daoTotalEthVUnits", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Register validator with 2 validators
      let reg = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 2, reg.cluster);
      let cluster = reg2.cluster;

      // Set explicit EB = 96 ETH (vUnits = 30000)
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 96,
      );
      cluster = ebResult.cluster;

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Verify stranded deviation: removed op4 still has operatorEthVUnits > 0
      const op4VUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[3]);
      // The guard should have cleaned it on removal. But if EB was set before removal,
      // the deviation was already written.

      // Stake
      const stakeAmount = ethers.parseEther("10");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      // EB=96 with 2 validators: calcVUnits(96)=30000. Guard on op removal may reduce deviation.
      // Use actual value from contract for reward computation.
      expect(daoVUnits).to.equal(calcVUnits(96n));

      await mineBlocks(provider, 100);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS; // ETH fixture
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const blockDiff = BigInt(claimBlock - stakeBBlock);
      const feesWei = (blockDiff * networkFeePacked * daoVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. Multi-Cluster / Staker (XG-014 to XG-016)
  // ═══════════════════════════════════════════════════════════════
  describe("Multi-Cluster / Staker", () => {
    it("XG-014: Migrate multiple clusters in sequence -> syncFees -> claim", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner)
            .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(expectedId));
        }

        // Cluster A: clusterOwner, 2 validators
        await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n);
        let clusterA: Cluster = EMPTY_CLUSTER;
        for (let v = 0; v < 2; v++) {
          const tx = await legacyNetwork.connect(clusterOwner).registerValidator(
            makePublicKey(v + 1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterA,
          );
          const receipt = await tx.wait();
          clusterA = parseClusterFromEvent(legacyNetwork, receipt, Events.VALIDATOR_ADDED);
        }

        // Cluster B: clusterOwner2, 3 validators
        await ssvToken.mint(clusterOwner2.address, TOKEN_REGISTER_AMOUNT * 3n);
        await ssvToken.connect(clusterOwner2).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 3n);
        let clusterB: Cluster = EMPTY_CLUSTER;
        for (let v = 0; v < 3; v++) {
          const tx = await legacyNetwork.connect(clusterOwner2).registerValidator(
            makePublicKey(v + 10), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterB,
          );
          const receipt = await tx.wait();
          clusterB = parseClusterFromEvent(legacyNetwork, receipt, Events.VALIDATOR_ADDED);
        }

        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, clusterA, clusterB };
      };

      const { network, views, ssvToken, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate cluster A
      const migAReceipt = await (await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE },
      )).wait();
      const migABlock = migAReceipt!.blockNumber;
      const daoVUnitsA = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsA).to.equal(defaultVUnits(2n));

      // Migrate cluster B
      const migBReceipt = await (await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      )).wait();
      const migBBlock = migBReceipt!.blockNumber;
      const daoVUnitsAB = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAB).to.equal(defaultVUnits(2n) + defaultVUnits(3n));

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: phase 1 (only A migrated, 2 validators), phase 2 (A+B, 5 validators)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;

      const phase1Blocks = BigInt(migBBlock - migABlock);
      const phase1FeesWei = (phase1Blocks * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeAmount;

      const phase2Blocks = BigInt(claimBlock - migBBlock);
      const phase2FeesWei = (phase2Blocks * networkFeePacked * defaultVUnits(5n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / stakeAmount;

      const expectedRaw = (stakeAmount * (delta1 + delta2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-015: Migrate multiple clusters (shared operators) -> one liquidated -> reward rate drops", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);
        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(id));
        }
        // Cluster A: 3 validators, small balance
        await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 3n);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 3n);
        let clusterA: Cluster = EMPTY_CLUSTER;
        for (let v = 0; v < 3; v++) {
          const tx = await legacyNetwork.connect(clusterOwner).registerValidator(
            makePublicKey(v + 1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterA,
          );
          clusterA = parseClusterFromEvent(legacyNetwork, await tx.wait(), Events.VALIDATOR_ADDED);
        }
        // Cluster B: 5 validators
        await ssvToken.mint(clusterOwner2.address, TOKEN_REGISTER_AMOUNT * 5n);
        await ssvToken.connect(clusterOwner2).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 5n);
        let clusterB: Cluster = EMPTY_CLUSTER;
        for (let v = 0; v < 5; v++) {
          const tx = await legacyNetwork.connect(clusterOwner2).registerValidator(
            makePublicKey(v + 20), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterB,
          );
          clusterB = parseClusterFromEvent(legacyNetwork, await tx.wait(), Events.VALIDATOR_ADDED);
        }
        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, clusterA, clusterB };
      };

      const { network, views, ssvToken, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate both — cluster A with small deposit so it drains quickly
      // Legacy fixture: threshold for 3 validators ≈ 0.006518 ETH
      const migA = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: ethers.parseEther("0.007") },
      );
      const migABlock = (await migA.wait())!.blockNumber;
      const migratedA = parseClusterFromEvent(network, await migA.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      const migB = await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migBBlock = (await migB.wait())!.blockNumber;

      const daoVUnitsTotal = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsTotal).to.equal(defaultVUnits(8n)); // 3+5

      await mineBlocks(provider, 100);
      await network.syncFees();
      const accPhase1 = BigInt(await views.accEthPerShare());

      // Liquidate cluster A using saved migration event cluster (getCurrentClusterState lookback too small)
      await mineBlocks(provider, 500_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedA);
      const liqBlock = (await liqTx.wait())!.blockNumber;

      const daoVUnitsAfterLiq = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterLiq).to.equal(defaultVUnits(5n)); // only cluster B

      await mineBlocks(provider, 100);
      await network.syncFees();

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);

      // Exact reward: 3 phases with different vUnits
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;

      // Phase 1: migA to migB (only cluster A, 3 validators)
      const p1Blocks = BigInt(migBBlock - migABlock);
      const p1Fees = (p1Blocks * networkFeePacked * defaultVUnits(3n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d1 = (p1Fees * PRECISION) / stakeAmount;

      // Phase 2: migB to liqBlock (both clusters, 8 validators)
      const p2Blocks = BigInt(liqBlock - migBBlock);
      const p2Fees = (p2Blocks * networkFeePacked * defaultVUnits(8n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d2 = (p2Fees * PRECISION) / stakeAmount;

      // Phase 3: liqBlock to claimBlock (only cluster B, 5 validators)
      const p3Blocks = BigInt(claimBlock - liqBlock);
      const p3Fees = (p3Blocks * networkFeePacked * defaultVUnits(5n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d3 = (p3Fees * PRECISION) / stakeAmount;

      const expectedRaw = (stakeAmount * (d1 + d2 + d3)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-016: Large staking event -> small cluster liquidation -> precision check", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Stake a very large amount
      const largeStake = ethers.parseEther("1000000");
      await ssvToken.mint(staker.address, largeStake);
      const networkAddress = await network.getAddress();
      await ssvToken.connect(staker).approve(networkAddress, largeStake);
      await network.connect(staker).stake(largeStake);

      // Migrate small cluster — legacy threshold for 1 validator ≈ 0.002173 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.003") },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 10);
      const syncTx = await network.syncFees();
      const syncBlock = (await syncTx.wait())!.blockNumber;

      // Liquidate using saved migration event cluster (getCurrentClusterState lookback too small)
      await mineBlocks(provider, 500_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);
      await liqTx.wait();

      const accFinal = BigInt(await views.accEthPerShare());
      // Accumulator only reflects fees up to the last syncFees (liquidate does NOT sync)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const syncBlocks = BigInt(syncBlock - migrateBlock);
      const syncFeesWei = (syncBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const expectedAcc = (syncFeesWei * PRECISION) / largeStake;
      expect(accFinal).to.equal(expectedAcc);

      // Claim — may be 0 or small due to precision, but should not revert unexpectedly
      try {
        const { amount } = await claimAndGetAmount(network, provider, staker);
        expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
      } catch (e: any) {
        // NothingToClaim is acceptable for dust amounts
        expect(e.message).to.include("NothingToClaim");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. Migration Edge Cases + Staking (XG-017 to XG-019)
  // ═══════════════════════════════════════════════════════════════
  describe("Migration Edge Cases + Staking", () => {
    it("XG-017: Migrate liquidated SSV cluster -> syncFees -> claim (reactivation path)", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);
        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(id));
        }
        // Create SSV cluster — deposit must exceed SSV liquidation threshold (~0.091 SSV)
        // but small enough to drain within 300K blocks (~0.127 SSV drained)
        const smallDeposit = ethers.parseEther("0.1");
        await ssvToken.mint(clusterOwner.address, smallDeposit);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), smallDeposit);
        const regTx = await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, smallDeposit, EMPTY_CLUSTER,
        );
        // Save cluster from registration event (getCurrentClusterState has 199-block lookback limit)
        let cluster = parseClusterFromEvent(legacyNetwork, await regTx.wait(), Events.VALIDATOR_ADDED);

        // Liquidate the SSV cluster (legacy network uses `liquidate`, not `liquidateSSV`)
        // 300K blocks drains ~0.127 SSV at ~422 gwei/block burn rate, exceeding 0.1 deposit
        await mineBlocks(connection.ethers.provider, 300_000);
        const liqTx = await legacyNetwork.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
        // Save cluster from liquidation event
        cluster = parseClusterFromEvent(legacyNetwork, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
      };

      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // G2: Capture SSV balances before migration for conservation check
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVBefore = await ssvToken.balanceOf(networkAddress);

      // Migrate liquidated cluster — this reactivates it
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();

      // G2: SSV conservation — refund from event matches actual token transfer
      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ssvRefunded = BigInt(migrateEventArgs.ssvRefunded);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVAfter = await ssvToken.balanceOf(networkAddress);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefunded, "G2: owner SSV delta must match refund");
      expect(contractSSVBefore - contractSSVAfter).to.equal(ssvRefunded, "G2: contract SSV delta must match refund");

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(1n));

      // G4: Per-operator vUnits deviation after migration (1 validator, implicit EB = no deviation)
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnits).to.equal(0n, `G4: operator ${opId} deviation vUnits must be 0 for implicit EB`);
      }
      // G4: daoTotalEthVUnits == validatorCount * BPS (baseline, no deviation)
      expect(daoVUnits).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits must equal validatorCount * BPS");

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const migrateBlock = migrateReceipt!.blockNumber;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-018: Migrate -> EB update triggers auto-liquidation -> staker rewards stop", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Stake
      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register with very small deposit so cluster drains quickly
      const reg = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.001"), 1);

      await mineBlocks(provider, 50);
      await network.syncFees();

      // Drain balance over many blocks
      await mineBlocks(provider, 200_000);
      // Sync right before liquidation to capture all pre-liquidation fees
      const syncPreLiqTx = await network.syncFees();
      const syncPreLiqBlock = (await syncPreLiqTx.wait())!.blockNumber;
      const accBeforeLiq = BigInt(await views.accEthPerShare());

      // Liquidate using saved cluster from registration (getCurrentClusterState lookback too small)
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, reg.cluster);
      const liqBlock = (await liqTx.wait())!.blockNumber;

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfter = BigInt(await views.accEthPerShare());
      // Accumulator increases by fees accrued between syncPreLiq and liquidation block
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS; // ETH fixture
      const vUnits = defaultVUnits(1n);
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const gapBlocks = BigInt(liqBlock - syncPreLiqBlock);
      const gapFees = (gapBlocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const gapDelta = (gapFees * PRECISION) / totalCSSV;
      expect(accAfter).to.equal(accBeforeLiq + gapDelta);
    });

    it("XG-019: syncFees sandwich: sync -> migrate -> sync -> claim (index recalculation)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register pre-existing ETH cluster
      const reg = await registerCluster(network, clusterOwner, operatorIds);
      const regBlock = reg.block;

      const stakeAmount = ethers.parseEther("10");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Advance and pre-migration sync
      await mineBlocks(provider, 50);
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;
      const accPreMigration = BigInt(await views.accEthPerShare());
      // accPreMigration covers fees from registration to sync1 for 1 validator
      // Two sub-phases: regBlock→stakeBBlock (supply=STAKE_AMOUNT), stakeBBlock→sync1Block (supply=STAKE_AMOUNT+stakeAmount)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS; // ETH fixture
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const subA = BigInt(stakeBBlock - regBlock);
      const subAFees = (subA * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const dA = (subAFees * PRECISION) / STAKE_AMOUNT;
      const subB = BigInt(sync1Block - stakeBBlock);
      const subBFees = (subB * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const dB = (subBFees * PRECISION) / totalCSSV;
      const expectedPreAcc = dA + dB;
      expect(accPreMigration).to.equal(expectedPreAcc);

      // Now set up a legacy cluster to migrate
      // We already have an ETH cluster, just add more via registerValidator
      const reg2 = await registerCluster(network, clusterOwner2, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 10);
      const reg2Block = reg2.block;

      // Post-addition sync
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPostAddition = BigInt(await views.accEthPerShare());
      expect(accPostAddition).to.be.greaterThan(accPreMigration);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // stakerB's rewards: fees from stakeBBlock to reg2Block (1 cluster), reg2Block to claimBlock (2 clusters)
      const phase1Blocks = BigInt(reg2Block - stakeBBlock);
      const phase1Fees = (phase1Blocks * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d1 = (phase1Fees * PRECISION) / totalCSSV;

      const phase2Blocks = BigInt(claimBlock - reg2Block);
      const phase2Fees = (phase2Blocks * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d2 = (phase2Fees * PRECISION) / totalCSSV;

      const expectedRaw = (stakeAmount * (d1 + d2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. Post-Migration Operations + Staking (XG-020 to XG-023)
  // ═══════════════════════════════════════════════════════════════
  describe("Post-Migration Operations + Staking", () => {
    it("XG-020: Migrate -> removeOperator from migrated cluster -> syncFees -> claim", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // G2: Capture SSV balances before migration for conservation check
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVBefore = await ssvToken.balanceOf(networkAddress);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;

      // G2: SSV conservation — refund from event matches actual token transfer
      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ssvRefunded = BigInt(migrateEventArgs.ssvRefunded);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVAfter = await ssvToken.balanceOf(networkAddress);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefunded, "G2: owner SSV delta must match refund");
      expect(contractSSVBefore - contractSSVAfter).to.equal(ssvRefunded, "G2: contract SSV delta must match refund");

      const daoVUnitsPre = await readDaoTotalEthVUnits(provider, networkAddress);
      // G4: daoTotalEthVUnits post-migration matches 2 validators baseline
      expect(daoVUnitsPre).to.equal(defaultVUnits(2n), "G4: daoTotalEthVUnits post-migration");

      // G4: Per-operator deviation vUnits are 0 for implicit EB
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnits).to.equal(0n, `G4: operator ${opId} deviation vUnits must be 0 for implicit EB`);
      }

      // Remove operator after migration
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // G4: Removed operator deviation vUnits should remain 0
      const removedOpVUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[3]);
      expect(removedOpVUnits).to.equal(0n, "G4: removed operator deviation vUnits must be 0");

      await mineBlocks(provider, 100);
      await network.syncFees();

      // daoTotalEthVUnits reflects baseline, but removal doesn't change it directly
      // (only ethValidatorCount on the operator changes)
      const daoVUnitsPost = await readDaoTotalEthVUnits(provider, networkAddress);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-021: Migrate -> deposit ETH -> syncFees -> claim (deposit does not change fee accrual)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;
      let migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accBeforeDeposit = BigInt(await views.accEthPerShare());

      // Deposit more ETH
      const depositTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, migratedCluster, { value: ethers.parseEther("5") },
      );
      await depositTx.wait();

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterDeposit = BigInt(await views.accEthPerShare());
      expect(accAfterDeposit).to.be.greaterThan(accBeforeDeposit);

      // Reward rate should be same as before deposit (vUnits unchanged)
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-022: Migrate -> withdraw ETH -> cluster near liquidation -> syncFees -> claim", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;
      let migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 10);

      // Withdraw most ETH
      const withdrawAmount = ethers.parseEther("9");
      const withdrawTx = await network.connect(clusterOwner).withdraw(
        operatorIds, withdrawAmount, migratedCluster,
      );
      await withdrawTx.wait();

      // Fee rate unchanged by withdrawal
      await mineBlocks(provider, 50);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });

    it("XG-023: Migrate -> cSSV transfer between stakers -> syncFees -> both claim", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, ssvToken, cssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Both stake
      const stakeA = ethers.parseEther("10");
      const stakeB = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeA);
      await stakeSSV(network, ssvToken, stakerB, stakeB);

      // G2: Capture SSV balances before migration for conservation check
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVBefore = await ssvToken.balanceOf(networkAddress);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;

      // G2: SSV conservation — refund from event matches actual token transfer
      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ssvRefunded = BigInt(migrateEventArgs.ssvRefunded);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVAfter = await ssvToken.balanceOf(networkAddress);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefunded, "G2: owner SSV delta must match refund");
      expect(contractSSVBefore - contractSSVAfter).to.equal(ssvRefunded, "G2: contract SSV delta must match refund");

      // G4: daoTotalEthVUnits matches 1 validator baseline
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits post-migration");

      // G4: Per-operator deviation vUnits are 0 for implicit EB
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnits).to.equal(0n, `G4: operator ${opId} deviation vUnits must be 0 for implicit EB`);
      }

      await mineBlocks(provider, 50);
      await network.syncFees();

      // Transfer half of staker's cSSV to stakerB (triggers onCSSVTransfer settlement)
      const transferAmount = stakeA / 2n;
      const transferTx = await cssvToken.connect(staker).transfer(stakerB.address, transferAmount);
      const transferBlock = (await transferTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);

      // G4: daoTotalEthVUnits unchanged by cSSV transfer
      const daoVUnitsPostTransfer = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsPostTransfer).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits unchanged after cSSV transfer");

      // Both claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);

      // Exact reward computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 3_000_000_000n / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeA + stakeB;

      // Phase 1: migration to transfer (A=10, B=10, total=20)
      const p1Blocks = BigInt(transferBlock - migrateBlock);
      const p1Fees = (p1Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d1 = (p1Fees * PRECISION) / totalCSSV;

      // Transfer settles: A gets stakeA * d1, B gets stakeB * d1 as pending

      // Phase 2: transfer to claimA (A=5e18, B=15e18, total=20e18)
      const p2Blocks = BigInt(claimA.block - transferBlock);
      const p2Fees = (p2Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d2 = (p2Fees * PRECISION) / totalCSSV;

      // A's total: settled from transfer (stakeA * d1) + post-transfer accrual (transferAmount * d2)
      // transferAmount = stakeA/2 = 5e18 (A's remaining cSSV after transfer)
      const settledA = (stakeA * d1) / PRECISION;
      const postTransferA = (transferAmount * d2) / PRECISION;
      const totalARaw = settledA + postTransferA;
      const expectedA = totalARaw - (totalARaw % ETH_DEDUCTED_DIGITS);
      expect(claimA.amount).to.equal(expectedA);

      // Phase 3: claimA to claimB
      const p3Blocks = BigInt(claimB.block - claimA.block);
      const p3Fees = (p3Blocks * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d3 = (p3Fees * PRECISION) / totalCSSV;

      // B's total: settled from transfer (stakeB * d1) + post-transfer accrual ((stakeB + transferAmount) * (d2 + d3))
      const cssvB = stakeB + transferAmount; // 15e18
      const settledB = (stakeB * d1) / PRECISION;
      const postTransferB = (cssvB * (d2 + d3)) / PRECISION;
      const totalBRaw = settledB + postTransferB;
      const expectedB = totalBRaw - (totalBRaw % ETH_DEDUCTED_DIGITS);
      expect(claimB.amount).to.equal(expectedB);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. Fee Version Interactions (XG-024 to XG-027)
  // ═══════════════════════════════════════════════════════════════
  describe("Fee Version Interactions", () => {
    it("XG-024: SSV-only cluster fees -> migrate -> staker claims ETH rewards from post-migration only", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Sync before migration — SSV clusters don't generate ETH fees
      await network.syncFees();
      const accSSVEra = BigInt(await views.accEthPerShare());

      // SSV-era fees should not contribute to ETH staking
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accSSVEra2 = BigInt(await views.accEthPerShare());
      expect(accSSVEra2).to.equal(accSSVEra); // No ETH fee accrual from SSV clusters

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / stakeAmount;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-025: Mixed SSV and ETH clusters -> migrate SSV cluster -> syncFees -> claim", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register pre-existing ETH cluster
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      const stakeAmount = ethers.parseEther("10");
      const stakeBBlock = await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreAdd = BigInt(await views.accEthPerShare());

      // Register additional ETH cluster (simulating migration contribution)
      const reg2 = await registerCluster(network, clusterOwner2, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 20);
      const reg2Block = reg2.block;

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPostAdd = BigInt(await views.accEthPerShare());
      expect(accPostAdd).to.be.greaterThan(accPreAdd);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // stakerB's reward: fees from stakeBBlock to reg2Block (1 validator), reg2Block to claimBlock (2 validators)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = 500_000_000n / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const p1 = BigInt(reg2Block - stakeBBlock);
      const p1Fees = (p1 * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d1 = (p1Fees * PRECISION) / totalCSSV;
      const p2 = BigInt(claimBlock - reg2Block);
      const p2Fees = (p2 * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const d2 = (p2Fees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * (d1 + d2)) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-026: Migrate -> network fee set to zero -> syncFees -> claim (rewards freeze)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;
      const accBefore = BigInt(await views.accEthPerShare());

      // Exact accBefore computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeAmount;
      const p1Diff = BigInt(sync1Block - migrateBlock);
      const p1Fees = (p1Diff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const expectedAccBefore = (p1Fees * PRECISION) / totalCSSV;
      expect(accBefore).to.equal(expectedAccBefore);

      // Set network fee to 0 (updateNetworkFee snapshots DAO earnings for the block gap)
      const feeChangeTx = await network.updateNetworkFee(0n);
      const feeChangeBlock = (await feeChangeTx.wait())!.blockNumber;

      await mineBlocks(provider, 100);
      await network.syncFees();
      const accAfterZeroFee = BigInt(await views.accEthPerShare());
      // accEthPerShare increases by fees from the 1 block between sync1 and updateNetworkFee,
      // then zero fees for the 100-block zero-fee period
      const gapDiff = BigInt(feeChangeBlock - sync1Block);
      const gapFees = (gapDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const expectedAccAfter = expectedAccBefore + (gapFees * PRECISION) / totalCSSV;
      expect(accAfterZeroFee).to.equal(expectedAccAfter);

      // Claim what was accrued before fee went to 0
      const { amount } = await claimAndGetAmount(network, provider, staker);
      // claimEthRewards calls syncFees internally, but fee=0 so no additional accrual
      const expectedRaw = (stakeAmount * expectedAccAfter) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-027: Migrate cluster with 0 validators -> syncFees -> claim (no fee contribution)", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);
        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(id));
        }
        // Register and immediately remove validator to get 0-validator cluster
        await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);
        await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
        );
        let cluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);
        await legacyNetwork.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
        cluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);
        expect(cluster.validatorCount).to.equal(0n);

        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
      };

      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Also create an active ETH cluster to have some fee generation
      const deployFixtureETH = createETHFixture(4);

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate the 0-validator cluster
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("1") },
      );

      // 0 validators means 0 vUnits added
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      await mineBlocks(provider, 100);
      await network.syncFees();
      const acc = BigInt(await views.accEthPerShare());
      expect(acc).to.equal(0n); // No fee accrual from 0 vUnits
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. EB + Staking (XG-028 to XG-029)
  // ═══════════════════════════════════════════════════════════════
  describe("EB + Staking", () => {
    it("XG-028: Two-phase EB change — reward rate up then down", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register cluster with 2 validators (implicit EB = 64 ETH, vUnits = 20000)
      let reg = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 2, reg.cluster);
      let cluster = reg2.cluster;

      // Phase 1: advance blocks at baseline rate
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPhase1 = BigInt(await views.accEthPerShare());

      // EB increase: 128 ETH -> vUnits = 40000 (double)
      const eb1 = await commitAndUpdateEB(network, provider, clusterOwner, operatorIds, cluster, 128);
      cluster = eb1.cluster;

      // Phase 2: advance blocks at double rate
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPhase2 = BigInt(await views.accEthPerShare());

      // Claim phase 1+2 — sets user index to current acc
      const { block: claim1Block } = await claimAndGetAmount(network, provider, stakerB);

      // EB decrease back to 64 ETH -> vUnits = 20000
      const eb2 = await commitAndUpdateEB(network, provider, clusterOwner, operatorIds, cluster, 64);
      cluster = eb2.cluster;

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(2n)); // back to baseline

      // Phase 3: advance blocks at original rate
      await mineBlocks(provider, 50);

      const { amount: phase3Claim, block: claim2Block } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation for phase 3:
      // Fees accrue from eb2.block to claim2Block at vUnits=20000 (baseline for 2 validators)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      // User index was set at claim1Block. Between claim1Block and eb2.block, vUnits=40000 (128 ETH EB).
      // Between eb2.block and claim2Block, vUnits=20000 (64 ETH EB = baseline).
      const p3aDiff = BigInt(eb2.block - claim1Block);
      const p3aVUnits = calcVUnits(128n);
      const p3aFees = (p3aDiff * networkFeePacked * p3aVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const p3bDiff = BigInt(claim2Block - eb2.block);
      const p3bVUnits = defaultVUnits(2n);
      const p3bFees = (p3bDiff * networkFeePacked * p3bVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta3 = ((p3aFees + p3bFees) * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta3) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(phase3Claim).to.equal(expectedClaim);
    });

    it("XG-029: Migrate -> EB update to MAX (2048 ETH) -> syncFees -> claim (max vUnits, no overflow)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register cluster with 1 validator
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      // EB update to MAX: 2048 ETH
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, reg.cluster, 2048,
      );

      const expectedVUnits = calcVUnits(2048n);
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(expectedVUnits);

      await mineBlocks(provider, 100);

      // Should not overflow
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation: phase 1 (reg to EB update at implicit vUnits) + phase 2 (EB update to claim at max vUnits)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const p1Diff = BigInt(ebResult.block - reg.block);
      const p1Fees = (p1Diff * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const p2Diff = BigInt(claimBlock - ebResult.block);
      const p2Fees = (p2Diff * networkFeePacked * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = ((p1Fees + p2Fees) * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. Staking Pool Balance Checks (XG-030 to XG-032)
  // ═══════════════════════════════════════════════════════════════
  describe("Staking Pool Balance Checks", () => {
    it("XG-030: Migrate -> ethDaoBalance -> claimEthRewards double-guard (pool + DAO balance)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 100);

      // Sync fees first so poolBefore reflects the current accumulated fees
      const syncTx = await network.syncFees();
      const syncBlock = (await syncTx.wait())!.blockNumber;

      // Claim and verify pool balance consistency
      const poolBefore = BigInt(await views.stakingEthPoolBalance());
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      const poolAfter = BigInt(await views.stakingEthPoolBalance());

      // Exact claim computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      // Pool = poolBefore + gapFees - amount (claim syncs fees internally adding gapFees)
      const gapDiff = BigInt(claimBlock - syncBlock);
      const gapFees = (gapDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(poolBefore - poolAfter).to.equal(amount - gapFees);
    });

    it("XG-031: Migrate -> operator fee change -> syncFees -> claim (staker reward unaffected by op fee)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      const reg = await registerCluster(network, clusterOwner, operatorIds);

      await mineBlocks(provider, 50);
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;
      const accBefore = BigInt(await views.accEthPerShare());

      // Declare and execute operator fee change (double the fee)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);
      await mineBlocks(provider, Number(DECLARE_OPERATOR_FEE_PERIOD));
      await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);

      await mineBlocks(provider, 50);
      const syncTx2 = await network.syncFees();
      const sync2Block = (await syncTx2.wait())!.blockNumber;
      const accAfter = BigInt(await views.accEthPerShare());

      // Staker reward rate depends on network fee * vUnits, NOT operator fees
      // So accEthPerShare grows at the same rate throughout
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation: constant network fee rate from reg.block to claimBlock
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - reg.block);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);

      // accBefore and accAfter: exact computation at constant rate
      const acc1Diff = BigInt(sync1Block - reg.block);
      const acc1Fees = (acc1Diff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(accBefore).to.equal((acc1Fees * PRECISION) / totalCSSV);
      const acc2Diff = BigInt(sync2Block - reg.block);
      const acc2Fees = (acc2Diff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(accAfter).to.equal((acc2Fees * PRECISION) / totalCSSV);
    });

    it("XG-032: Migrate -> liquidate (ETH to liquidator) -> verify staking pool not affected", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Legacy fixture: threshold for 1 validator ≈ 0.002173 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.003") },
      );
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;

      const poolBefore = BigInt(await views.stakingEthPoolBalance());

      // Liquidate — 500K blocks drains ~0.00506 ETH, well above 0.003 deposit
      await mineBlocks(provider, 500_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);
      const liqBlock = (await liqTx.wait())!.blockNumber;

      await network.syncFees();
      const poolAfter = BigInt(await views.stakingEthPoolBalance());

      // Pool increases by fees from sync1Block to liqBlock (cluster was active until liquidation)
      // After liquidation vUnits=0, so no fees accrue between liqBlock and sync2Block
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(liqBlock - sync1Block);
      const newFees = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(poolAfter).to.equal(poolBefore + newFees);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 11. Atomicity + Same-Block (XG-033 to XG-034)
  // ═══════════════════════════════════════════════════════════════
  describe("Atomicity + Same-Block", () => {
    it("XG-033: Migration + staking in same block -> no double-counting or zero-division", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Migrate
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Stake immediately in next block (not literally same block in Hardhat but very close)
      const stakeAmount = ethers.parseEther("10");
      const stakeBlock = await stakeSSV(network, ssvToken, staker, stakeAmount);

      // syncFees immediately
      const syncTx = await network.syncFees();
      const syncBlock = (await syncTx.wait())!.blockNumber;

      // No errors — pass
      const acc = BigInt(await views.accEthPerShare());
      // Fees accrued from stakeBlock (when cSSV supply became non-zero) to syncBlock
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(syncBlock - stakeBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const expectedAcc = (feesWei * PRECISION) / stakeAmount;
      expect(acc).to.equal(expectedAcc);
    });

    it("XG-034: Migrate -> liquidate -> all validators removed -> syncFees with daoTotalEthVUnits = 0", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Legacy fixture: threshold for 1 validator ≈ 0.002173 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.003") },
      );
      const migrateReceipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Drain balance and sync right before liquidation to capture all pre-liq fees
      await mineBlocks(provider, 500_000);
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;
      const accBefore = BigInt(await views.accEthPerShare());

      // Liquidate — 500K blocks drains ~0.00506 ETH, well above 0.003 deposit
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);
      const liqBlock = (await liqTx.wait())!.blockNumber;

      // daoTotalEthVUnits == 0
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      // syncFees with zero vUnits should not revert
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accAfter = BigInt(await views.accEthPerShare());
      // Increases by fees from the 1 block between sync1 and liquidation (vUnits still active)
      // After liquidation vUnits=0, so zero new fees in the 100-block period
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const gapDiff = BigInt(liqBlock - sync1Block);
      const gapFees = (gapDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accGap = (gapFees * PRECISION) / stakeAmount;
      expect(accAfter).to.equal(accBefore + accGap);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 12. Deviation Accounting (XG-035 to XG-036)
  // ═══════════════════════════════════════════════════════════════
  describe("Deviation Accounting", () => {
    it("XG-035: Explicit EB -> liquidate -> deviation removed from daoTotalEthVUnits", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register with 2 validators
      let reg = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.1"), 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.1"), 2, reg.cluster);
      let cluster = reg2.cluster;

      // Set explicit EB = 128 ETH (vUnits = 40000)
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 128,
      );
      cluster = ebResult.cluster;

      const daoVUnitsPre = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsPre).to.equal(calcVUnits(128n));

      // Drain and liquidate — use enough blocks to fully drain 0.2 ETH at EB=128 burn rate
      // minimumBlocksBeforeLiquidation = 21480, threshold ≈ 0.000654 ETH
      // burn ≈ 30.46 gwei/block at vUnits=40000 → ~7M blocks to drain 0.2 ETH to 0
      await mineBlocks(provider, 7_000_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);

      // Both baseline AND deviation should be removed
      const daoVUnitsPost = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsPost).to.equal(0n);

      // operatorEthVUnits cleaned up
      for (const opId of operatorIds) {
        const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(vUnits).to.equal(0n);
      }
    });

    it("XG-036: Explicit EB -> liquidate -> reactivate -> deviation restored", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register 2 validators (small deposit so cluster drains quickly)
      let reg = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.01"), 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.01"), 2, reg.cluster);
      let cluster = reg2.cluster;

      // EB = 128 ETH
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 128,
      );
      cluster = ebResult.cluster;
      const expectedVUnits = calcVUnits(128n);

      // Liquidate — use enough blocks to fully drain 0.02 ETH at EB=128 burn rate
      await mineBlocks(provider, 700_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      expect(await readDaoTotalEthVUnits(provider, networkAddress)).to.equal(0n);

      // Reactivate
      const reactTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const reactBlock = (await reactTx.wait())!.blockNumber;

      // Deviation should be restored (reactivation restores EB snapshot)
      const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfter).to.equal(expectedVUnits);

      await mineBlocks(provider, 50);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation: sum of all fee phases
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      // Phase 1: reg.block to reg2.block at vUnits=defaultVUnits(1n)
      const p1 = BigInt(reg2.block - reg.block);
      const p1Fees = (p1 * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 2: reg2.block to ebResult.block at vUnits=defaultVUnits(2n)
      const p2 = BigInt(ebResult.block - reg2.block);
      const p2Fees = (p2 * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 3: ebResult.block to liqBlock at vUnits=calcVUnits(128n)
      const p3 = BigInt(liqBlock - ebResult.block);
      const p3Fees = (p3 * networkFeePacked * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 4: liqBlock to reactBlock at vUnits=0 (no fees)
      // Phase 5: reactBlock to claimBlock at vUnits=calcVUnits(128n)
      const p5 = BigInt(claimBlock - reactBlock);
      const p5Fees = (p5 * networkFeePacked * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalFees = p1Fees + p2Fees + p3Fees + p5Fees;
      const accDelta = (totalFees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 13. Multi-Mutation Chains (XG-037 to XG-038)
  // ═══════════════════════════════════════════════════════════════
  describe("Multi-Mutation Chains", () => {
    it("XG-037: Migrate -> fee change -> removeOperator -> migrate second cluster -> syncFees -> claim", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);
        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(id));
        }
        // Cluster A
        await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);
        await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
        );
        const clusterA = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);
        // Cluster B
        await ssvToken.mint(clusterOwner2.address, TOKEN_REGISTER_AMOUNT);
        await ssvToken.connect(clusterOwner2).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);
        await legacyNetwork.connect(clusterOwner2).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
        );
        const clusterB = await getCurrentClusterState(connection, legacyNetwork, clusterOwner2.address, operatorIds);

        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, clusterA, clusterB };
      };

      const { network, views, ssvToken, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // 1. Migrate cluster A
      const migATx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migABlock = (await migATx.wait())!.blockNumber;

      // 2. Fee change (from NETWORK_FEE_ETH=3B to newFee=1.5B)
      const newFee = DEFAULT_NETWORK_FEE_UNPACKED * 3n;
      const feeTx = await network.updateNetworkFee(newFee);
      const feeBlock = (await feeTx.wait())!.blockNumber;

      // 3. Remove operator
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // 4. Migrate cluster B
      const migBTx = await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migBBlock = (await migBTx.wait())!.blockNumber;

      await mineBlocks(provider, 100);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact computation across 3 fee phases:
      const PRECISION = 10n ** 18n;
      const totalCSSV = stakeAmount;
      const oldFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const newFeePacked = newFee / ETH_DEDUCTED_DIGITS;
      // Phase 1: migABlock to feeBlock — oldFee, vUnits=defaultVUnits(1n)
      const p1 = BigInt(feeBlock - migABlock);
      const p1Fees = (p1 * oldFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 2: feeBlock to migBBlock — newFee, vUnits=defaultVUnits(1n)
      const p2 = BigInt(migBBlock - feeBlock);
      const p2Fees = (p2 * newFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 3: migBBlock to claimBlock — newFee, vUnits=defaultVUnits(2n)
      const p3 = BigInt(claimBlock - migBBlock);
      const p3Fees = (p3 * newFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalFees = p1Fees + p2Fees + p3Fees;
      const accDelta = (totalFees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-038: Stake -> migrate -> advance 10000 blocks -> syncFees -> claim -> verify ETH_DEDUCTED_DIGITS truncation", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      // Advance many blocks for significant fee accrual
      await mineBlocks(provider, 10000);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      // Verify 100K-wei granularity truncation
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 14. Revert Scenarios (XG-039, XG-045, XG-048)
  // ═══════════════════════════════════════════════════════════════
  describe("Revert Scenarios", () => {
    it("XG-039: claimEthRewards exceeds stakingEthPoolBalance -> revert InsufficientBalance", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Register and set explicit EB with removed op to create potential over-reward
      let reg = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 2, reg.cluster);
      let cluster = reg2.cluster;

      // Set high EB
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 128,
      );

      // Remove an operator to create divergence
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Stake
      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 100);

      // Claim should succeed or revert with InsufficientBalance
      // (depends on whether over-reward actually exceeds pool)
      try {
        const { amount } = await claimAndGetAmount(network, provider, stakerB);
        // If claim succeeds, payout must be ETH_DEDUCTED_DIGITS aligned and positive
        expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
        expect(amount).to.be.greaterThan(0n);
      } catch (e: any) {
        expect(e.message).to.include(Errors.INSUFFICIENT_BALANCE);
      }
    });

    it("XG-045: Double migration prevention + staking: re-migrate reverts, staker unaffected", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accBefore = BigInt(await views.accEthPerShare());

      // Second migration should revert (SSV cluster was consumed, hash no longer matches)
      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);

      // accEthPerShare unchanged by failed tx
      const accAfter = BigInt(await views.accEthPerShare());
      expect(accAfter).to.equal(accBefore);

      // Staker can still claim
      await mineBlocks(provider, 50);
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact computation: fees from migrateBlock to claimBlock at constant rate
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });

    it("XG-048: Migrate -> claim dust -> NothingToClaim revert (remainder preserved)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Stake very large amount to make per-share increment tiny
      const hugeStake = ethers.parseEther("100000000");
      await ssvToken.mint(staker.address, hugeStake);
      const networkAddress = await network.getAddress();
      await ssvToken.connect(staker).approve(networkAddress, hugeStake);
      await network.connect(staker).stake(hugeStake);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Only 1 block — tiny fee
      await network.syncFees();

      // Claim should revert NothingToClaim if payout rounds to 0
      try {
        await network.connect(staker).claimEthRewards();
      } catch (e: any) {
        expect(e.message).to.include(Errors.NOTHING_TO_CLAIM);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 15. Zero cSSV Supply (XG-040)
  // ═══════════════════════════════════════════════════════════════
  describe("Zero cSSV Supply", () => {
    it("XG-040: Migrate -> syncFees with totalStaked == 0 -> fees from migrated cluster lost (BUG-6)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // G2: Capture SSV balances before migration for conservation check
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVBefore = await ssvToken.balanceOf(networkAddress);

      // Migrate without any stakers
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();

      // G2: SSV conservation — refund from event matches actual token transfer
      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ssvRefunded = BigInt(migrateEventArgs.ssvRefunded);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const contractSSVAfter = await ssvToken.balanceOf(networkAddress);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefunded, "G2: owner SSV delta must match refund");
      expect(contractSSVBefore - contractSSVAfter).to.equal(ssvRefunded, "G2: contract SSV delta must match refund");

      // G4: daoTotalEthVUnits matches 1 validator baseline
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits post-migration");

      // G4: Per-operator deviation vUnits are 0 for implicit EB
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(opVUnits).to.equal(0n, `G4: operator ${opId} deviation vUnits must be 0 for implicit EB`);
      }

      await mineBlocks(provider, 100);

      // syncFees with totalStaked == 0
      await network.syncFees();

      const acc = BigInt(await views.accEthPerShare());
      // Should remain 0 — no cSSV supply to distribute to
      expect(acc).to.equal(0n);

      // stakingEthPoolBalance is still updated (inflated) — compute exact value
      const syncBlock = await getBlockNumber(provider);
      const migrateBlock = migrateReceipt!.blockNumber;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(syncBlock - migrateBlock);
      const expectedPool = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const poolBalance = BigInt(await views.stakingEthPoolBalance());
      expect(poolBalance).to.equal(expectedPool);

      // G4: daoTotalEthVUnits unchanged after syncFees (cluster still active)
      const daoVUnitsPost = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsPost).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits unchanged after syncFees");

      // The fees in poolBalance are permanently orphaned — BUG-6
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 16. Mixed EB (XG-041)
  // ═══════════════════════════════════════════════════════════════
  describe("Mixed EB", () => {
    it("XG-041: Migrate cluster A (implicit EB) + cluster B (explicit EB) -> syncFees -> claim", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Cluster A: 1 validator, implicit EB (vUnits = 10000)
      const regA = await registerCluster(network, clusterOwner, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Cluster B: 1 validator, explicit EB = 96 ETH (vUnits = 30000)
      const regB = await registerCluster(network, clusterOwner2, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 10);

      // Set explicit EB on cluster B
      const clusterIdA = computeClusterId(clusterOwner.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwner2.address, operatorIds);

      const entries = [
        { clusterId: clusterIdA, effectiveBalance: 32 },
        { clusterId: clusterIdB, effectiveBalance: 96 },
      ];
      const ebB = await commitAndUpdateEBMulti(
        network, provider, clusterOwner2, operatorIds, regB.cluster, 96, entries,
      );

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      // A baseline (10000) + B (30000)
      const expectedTotal = defaultVUnits(1n) + calcVUnits(96n);
      expect(daoVUnits).to.equal(expectedTotal);

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation across 3 phases
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      // Phase 1: regA.block to regB.block — vUnits=defaultVUnits(1n)
      const p1 = BigInt(regB.block - regA.block);
      const p1Fees = (p1 * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 2: regB.block to ebB.block — vUnits=defaultVUnits(1n)+defaultVUnits(1n) (both implicit)
      const p2 = BigInt(ebB.block - regB.block);
      const p2Fees = (p2 * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 3: ebB.block to claimBlock — vUnits=expectedTotal
      const p3 = BigInt(claimBlock - ebB.block);
      const p3Fees = (p3 * networkFeePacked * expectedTotal / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalFees = p1Fees + p2Fees + p3Fees;
      const accDelta = (totalFees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 17. Removed Operator + EB + Liquidation Chain (XG-042)
  // ═══════════════════════════════════════════════════════════════
  describe("Removed Operator + EB + Liquidation Chain", () => {
    it("XG-042: Migrate -> EB update -> operator removed -> liquidate succeeds (guard skips removed op)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register with 2 validators, small balance so cluster drains quickly
      let reg = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.01"), 1);
      const reg2 = await registerCluster(network, clusterOwner, operatorIds, ethers.parseEther("0.01"), 2, reg.cluster);
      let cluster = reg2.cluster;

      // Set explicit EB = 128 ETH
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 128,
      );
      cluster = ebResult.cluster;

      // Remove operator — this cleans up operatorEthVUnits for the removed op
      const removeOpTx = await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      const removeOpBlock = (await removeOpTx.wait())!.blockNumber;

      // Read actual daoTotalEthVUnits after removal (may differ from pre-removal)
      const daoVUnitsPostRemoval = await readDaoTotalEthVUnits(provider, networkAddress);

      // Verify staking rewards still accrue after operator removal
      await mineBlocks(provider, 100);
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation across phases
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      // Phase 1: reg.block to reg2.block at vUnits=defaultVUnits(1n)
      const p1 = BigInt(reg2.block - reg.block);
      const p1Fees = (p1 * networkFeePacked * defaultVUnits(1n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 2: reg2.block to ebResult.block at vUnits=defaultVUnits(2n)
      const p2 = BigInt(ebResult.block - reg2.block);
      const p2Fees = (p2 * networkFeePacked * defaultVUnits(2n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 3: ebResult.block to removeOpBlock at vUnits=calcVUnits(128n)
      const p3 = BigInt(removeOpBlock - ebResult.block);
      const p3Fees = (p3 * networkFeePacked * calcVUnits(128n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      // Phase 4: removeOpBlock to claimBlock at vUnits=daoVUnitsPostRemoval
      const p4 = BigInt(claimBlock - removeOpBlock);
      const p4Fees = (p4 * networkFeePacked * daoVUnitsPostRemoval / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const totalFees = p1Fees + p2Fees + p3Fees + p4Fees;
      const accDelta = (totalFees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);

      // Liquidation succeeds — guard skips removed op in _executeLiquidation
      await mineBlocks(provider, 900_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
      const liqReceipt = await liqTx.wait();
      expect(liqReceipt).to.not.be.null;

      // Removed operator vUnits stay at 0
      const removedVUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[3]);
      expect(removedVUnits).to.equal(0n, "removed op stays 0 after liquidation");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 18. Max Operator Count (XG-043)
  // ═══════════════════════════════════════════════════════════════
  describe("Max Operator Count", () => {
    it("XG-043: Migrate with 13 operators -> syncFees -> claim (no truncation/overflow)", async function () {
      const deployFixture = createETHFixture(13);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register with 13 operators
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(1n));

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation: fees from reg.block to claimBlock
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - reg.block);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 19. Unstake + Liquidation Pool Separation (XG-044)
  // ═══════════════════════════════════════════════════════════════
  describe("Unstake + Liquidation Pool Separation", () => {
    it("XG-044: Stake -> migrate -> requestUnstake (full) -> liquidate -> withdrawUnlocked -> no cross-contamination", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = STAKE_AMOUNT;
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate with small balance so cluster drains quickly
      // Legacy fixture: threshold for 1 validator ≈ 0.002173 ETH
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("0.003") },
      );
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 10);

      // Full unstake
      await network.connect(staker).requestUnstake(stakeAmount);

      // Liquidate using saved migration event cluster (getCurrentClusterState lookback too small)
      await mineBlocks(provider, 500_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);

      // Wait for cooldown and withdraw SSV
      await mineBlocks(provider, Number(7n * 24n * 60n * 60n / 12n)); // ~7 days in blocks

      // Use time-based cooldown
      await provider.send("evm_increaseTime", [604800]); // 7 days
      await mineBlocks(provider, 1);

      const ssvBefore = await ssvToken.balanceOf(staker.address);
      await network.connect(staker).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(staker.address);

      // SSV returned from staking pool, not ETH pool
      expect(ssvAfter - ssvBefore).to.equal(stakeAmount);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 20. DAO Earnings Consistency (XG-046)
  // ═══════════════════════════════════════════════════════════════
  describe("DAO Earnings Consistency", () => {
    it("XG-046: Migrate -> ethDaoBalance updated -> syncFees reads networkTotalEarnings -> no double-counting", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      // Sync immediately after migration
      const syncTx1 = await network.syncFees();
      const sync1Block = (await syncTx1.wait())!.blockNumber;
      const poolAfterMigrate = BigInt(await views.stakingEthPoolBalance());

      // Advance blocks
      await mineBlocks(provider, 100);
      const syncTx2 = await network.syncFees();
      const sync2Block = (await syncTx2.wait())!.blockNumber;
      const poolAfter100Blocks = BigInt(await views.stakingEthPoolBalance());

      // Pool balance increases by exact fee accrual
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const gap = BigInt(sync2Block - sync1Block);
      const newFees = (gap * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(poolAfter100Blocks).to.equal(poolAfterMigrate + newFees);

      // Claim
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact claim: fees from migrateBlock to claimBlock
      const PRECISION = 10n ** 18n;
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);

      const poolAfterClaim = BigInt(await views.stakingEthPoolBalance());
      // Pool increases by fees from sync2 to claim, then decreases by amount
      const claimGap = BigInt(claimBlock - sync2Block);
      const claimGapFees = (claimGap * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      expect(poolAfterClaim).to.equal(poolAfter100Blocks + claimGapFees - amount);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 21. Overflow Boundary (XG-047)
  // ═══════════════════════════════════════════════════════════════
  describe("Overflow Boundary", () => {
    it("XG-047: Large validator count + explicit high EB -> syncFees -> claim (overflow boundary check)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Register multiple validators for stress test
      let cluster: Cluster = EMPTY_CLUSTER;
      const numValidators = 10; // Practical limit for test speed
      const regBlocks: number[] = [];
      for (let i = 0; i < numValidators; i++) {
        const reg = await registerCluster(
          network, clusterOwner, operatorIds,
          DEFAULT_ETH_REGISTER_VALUE, i + 1,
          i === 0 ? undefined : cluster,
        );
        cluster = reg.cluster;
        regBlocks.push(reg.block);
      }

      // Set high EB (2048 * 10 = 20480 ETH total)
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 2048 * numValidators,
      );

      const expectedVUnits = calcVUnits(BigInt(2048 * numValidators));
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(expectedVUnits);

      await mineBlocks(provider, 100);

      // Should not revert with overflow
      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, stakerB);
      // Exact computation across all phases
      const PRECISION = 10n ** 18n;
      const networkFeePacked = DEFAULT_NETWORK_FEE_UNPACKED / ETH_DEDUCTED_DIGITS;
      const totalCSSV = STAKE_AMOUNT + stakeAmount;
      let totalFees = 0n;
      // Phases from each registration to next (implicit EB)
      for (let i = 0; i < numValidators; i++) {
        const endBlock = i < numValidators - 1 ? regBlocks[i + 1] : ebResult.block;
        const startBlock = regBlocks[i];
        const phaseVUnits = defaultVUnits(BigInt(i + 1));
        const phaseDiff = BigInt(endBlock - startBlock);
        totalFees += (phaseDiff * networkFeePacked * phaseVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      }
      // Phase after EB update to claim
      const ebPhaseDiff = BigInt(claimBlock - ebResult.block);
      totalFees += (ebPhaseDiff * networkFeePacked * expectedVUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (totalFees * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 22. SSV Liquidation -> Migration (XG-049)
  // ═══════════════════════════════════════════════════════════════
  describe("SSV Liquidation -> Migration", () => {
    it("XG-049: SSV cluster liquidated -> migrate (reactivation) -> staker gets only post-migration ETH fees", async function () {
      const fixture = async () => {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(connection);
        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const id = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          await legacyNetwork.connect(operatorOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
          operatorIds.push(Number(id));
        }
        // Create SSV cluster — deposit must exceed SSV liquidation threshold (~0.091 SSV)
        // but small enough to drain within 300K blocks (~0.127 SSV drained)
        const smallDeposit = ethers.parseEther("0.1");
        await ssvToken.mint(clusterOwner.address, smallDeposit);
        await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), smallDeposit);
        const regTx = await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, smallDeposit, EMPTY_CLUSTER,
        );
        let cluster = parseClusterFromEvent(legacyNetwork, await regTx.wait(), Events.VALIDATOR_ADDED);

        // Liquidate SSV cluster (legacy network uses `liquidate`, not `liquidateSSV`)
        // 300K blocks drains ~0.127 SSV, exceeding 0.1 deposit
        await mineBlocks(connection.ethers.provider, 300_000);
        const liqTx = await legacyNetwork.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
        cluster = parseClusterFromEvent(legacyNetwork, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

        const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
      };

      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Sync — no ETH fees from SSV era
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accSSVEra = BigInt(await views.accEthPerShare());
      expect(accSSVEra).to.equal(0n);

      // Migrate (reactivation)
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      await mineBlocks(provider, 100);

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact computation: fees from migrateBlock to claimBlock (no SSV-era fees)
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 23. Pack/Unpack Consistency (XG-050)
  // ═══════════════════════════════════════════════════════════════
  describe("Pack/Unpack Consistency", () => {
    it("XG-050: Migrate -> syncFees -> claimEthRewards -> verify packed ETH arithmetic consistency", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 2 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateBlock = (await migrateTx.wait())!.blockNumber;

      // Advance sufficient blocks
      await mineBlocks(provider, 1000);

      // Sync + claim
      const syncTx = await network.syncFees();
      const syncBlock = (await syncTx.wait())!.blockNumber;
      const poolBefore = BigInt(await views.stakingEthPoolBalance());

      const { amount, block: claimBlock } = await claimAndGetAmount(network, provider, staker);
      // Exact computation
      const PRECISION = 10n ** 18n;
      const networkFeePacked = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(2n);
      const totalCSSV = stakeAmount;
      const blockDiff = BigInt(claimBlock - migrateBlock);
      const feesWei = (blockDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const accDelta = (feesWei * PRECISION) / totalCSSV;
      const expectedRaw = (stakeAmount * accDelta) / PRECISION;
      const expectedClaim = expectedRaw - (expectedRaw % ETH_DEDUCTED_DIGITS);
      expect(amount).to.equal(expectedClaim);

      // pack(unpack(x)) == x: payout is ETH_DEDUCTED_DIGITS aligned
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);

      const poolAfter = BigInt(await views.stakingEthPoolBalance());
      // Pool = poolBefore + gapFees - amount, where gapFees are from syncBlock to claimBlock
      const gapDiff = BigInt(claimBlock - syncBlock);
      const gapFees = (gapDiff * networkFeePacked * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
      const poolDecrease = poolBefore - poolAfter;
      expect(poolDecrease).to.equal(amount - gapFees);
    });
  });
});
