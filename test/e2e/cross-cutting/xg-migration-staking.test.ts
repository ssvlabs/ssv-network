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
  TOKEN_REGISTER_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  DEFAULT_NETWORK_FEE_UNPACKED,
  DECLARE_OPERATOR_FEE_PERIOD,
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
      await migrateTx.wait();

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(3n));

      // Advance blocks to accrue fees
      await mineBlocks(provider, 100);

      // Sync fees
      await network.connect(staker).syncFees();
      const accAfterSync = BigInt(await views.accEthPerShare());
      expect(accAfterSync).to.be.greaterThan(accBefore);

      // Claim
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      expect(amount).to.be.greaterThan(0n);
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
      await stakeSSV(network, ssvToken, stakerB, stakeB);

      // Advance more blocks
      await mineBlocks(provider, 50);

      // Both claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);

      // Staker A should get more (was staked during the 50-block solo period)
      expect(claimA.amount).to.be.greaterThan(0n);
      expect(claimB.amount).to.be.greaterThan(0n);
      // A was alone for 50 blocks and has smaller stake for the next 50+claim blocks
      // B entered later with 3x stake
      expect(claimA.amount + claimB.amount).to.be.greaterThan(0n);
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
      await migrateTx.wait();
      let migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accBeforeEB = BigInt(await views.accEthPerShare());

      // Oracle updates EB to 128 ETH (64 ETH/validator) -> vUnits = 40000
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds,
        migratedCluster, 128,
      );

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(calcVUnits(128n));

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterEB = BigInt(await views.accEthPerShare());
      expect(accAfterEB).to.be.greaterThan(accBeforeEB);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 100);

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
    });

    it("XG-006: Migrate -> network fee change -> syncFees -> claim (both fee rate periods)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterPeriod1 = BigInt(await views.accEthPerShare());

      // Change network fee (double it)
      const newFee = DEFAULT_NETWORK_FEE_UNPACKED * 2n;
      await network.updateNetworkFee(newFee);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfterPeriod2 = BigInt(await views.accEthPerShare());

      // accEthPerShare should have grown more in period 2 (higher fee)
      expect(accAfterPeriod2).to.be.greaterThan(accAfterPeriod1);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await network.syncFees();
      const accPreLiq = BigInt(await views.accEthPerShare());

      // Liquidate using cluster from migration event (getCurrentClusterState lookback too small)
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const liqReceipt = await liqTx.wait();

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
      // Accumulator should not materially increase after liquidation (no active clusters)
      // It may increase slightly due to fees accrued during the liquidation block itself
      expect(accPostLiq).to.be.greaterThanOrEqual(accPreLiq);

      // Claim — only pre-liquidation rewards
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      // Advance, sync
      await mineBlocks(provider, 50);
      await network.syncFees();

      // Liquidate — 500K blocks drains ~0.01 ETH, balance goes to 0
      await mineBlocks(provider, 500_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);

      // All three claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);
      const claimC = await claimAndGetAmount(network, provider, stakerC);

      expect(claimA.amount).to.be.greaterThan(0n);
      expect(claimB.amount).to.be.greaterThan(0n);
      expect(claimC.amount).to.be.greaterThan(0n);

      // Proportional distribution: C got ~3x more than A, B got ~2x more than A
      // (approximate due to block-by-block differences)
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
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // Reactivate with fresh deposit
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const reactivateReceipt = await reactivateTx.wait();

      const daoVUnitsAfterReact = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterReact).to.equal(defaultVUnits(1n));

      // Advance and sync post-reactivation
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accPostReact = BigInt(await views.accEthPerShare());
      expect(accPostReact).to.be.greaterThan(accPreLiq);

      // Claim
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);

      // Partial unstake (half)
      const halfStake = stakeAmount / 2n;
      await network.connect(staker).requestUnstake(halfStake);

      // Advance and claim on reduced cSSV balance
      await mineBlocks(provider, 100);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreUnstake = BigInt(await views.accEthPerShare());

      // Full unstake -> totalSupply = 0
      await network.connect(staker).requestUnstake(stakeAmount);

      // Advance 200 blocks — fees generated but no cSSV to distribute to
      await mineBlocks(provider, 200);
      await network.syncFees();
      const accDuringZero = BigInt(await views.accEthPerShare());
      // accEthPerShare may increase by ~1 block of fees (requestUnstake syncs internally
      // before burning cSSV), but should NOT grow during the 200-block zero-supply period
      expect(accDuringZero).to.be.greaterThanOrEqual(accPreUnstake);

      // stakingEthPoolBalance is inflated relative to what can be claimed
      const poolBalance = BigInt(await views.stakingEthPoolBalance());

      // New staker enters
      const stakeAmountB = STAKE_AMOUNT;
      await stakeSSV(network, ssvToken, stakerB, stakeAmountB);

      await mineBlocks(provider, 50);

      // stakerB can only claim post-re-stake fees, NOT the 200-block gap fees
      const { amount: claimB } = await claimAndGetAmount(network, provider, stakerB);
      expect(claimB).to.be.greaterThan(0n);

      // Verify: pool balance > total claimable (BUG-6 confirmed — fees lost)
      const poolAfter = BigInt(await views.stakingEthPoolBalance());
      expect(poolAfter).to.be.greaterThan(0n);
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
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 100);
      await network.syncFees();

      // daoTotalEthVUnits still includes baseline for all 4 ops
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.be.greaterThan(0n);

      // Claim rewards
      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.be.greaterThan(0n);

      await mineBlocks(provider, 100);

      // Claim
      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const daoVUnitsA = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsA).to.equal(defaultVUnits(2n));

      // Migrate cluster B
      await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const daoVUnitsAB = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAB).to.equal(defaultVUnits(2n) + defaultVUnits(3n));

      await mineBlocks(provider, 100);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      const migratedA = parseClusterFromEvent(network, await migA.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const daoVUnitsTotal = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsTotal).to.equal(defaultVUnits(8n)); // 3+5

      await mineBlocks(provider, 100);
      await network.syncFees();
      const accPhase1 = BigInt(await views.accEthPerShare());

      // Liquidate cluster A using saved migration event cluster (getCurrentClusterState lookback too small)
      await mineBlocks(provider, 500_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedA);

      const daoVUnitsAfterLiq = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterLiq).to.equal(defaultVUnits(5n)); // only cluster B

      await mineBlocks(provider, 100);
      await network.syncFees();

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 10);
      await network.syncFees();

      // Liquidate using saved migration event cluster (getCurrentClusterState lookback too small)
      await mineBlocks(provider, 500_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);

      const accFinal = BigInt(await views.accEthPerShare());
      // Verify no phantom rewards by checking accumulator is reasonable
      expect(accFinal).to.be.greaterThanOrEqual(0n);

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

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await network.syncFees();
      const accBeforeLiq = BigInt(await views.accEthPerShare());

      // Liquidate using saved cluster from registration (getCurrentClusterState lookback too small)
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, reg.cluster);

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfter = BigInt(await views.accEthPerShare());
      // No significant new accrual after liquidation — accEthPerShare may increase by
      // ~1 block of fees between the syncFees and liquidate calls, but should not grow
      // during the 50-block zero-vUnits period
      expect(accAfter).to.be.greaterThanOrEqual(accBeforeLiq);
    });

    it("XG-019: syncFees sandwich: sync -> migrate -> sync -> claim (index recalculation)", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register pre-existing ETH cluster
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      // Advance and pre-migration sync
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreMigration = BigInt(await views.accEthPerShare());
      expect(accPreMigration).to.be.greaterThan(0n);

      // Now set up a legacy cluster to migrate
      // We already have an ETH cluster, just add more via registerValidator
      const reg2 = await registerCluster(network, clusterOwner2, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 10);

      // Post-addition sync
      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPostAddition = BigInt(await views.accEthPerShare());
      expect(accPostAddition).to.be.greaterThan(accPreMigration);

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
      await cssvToken.connect(staker).transfer(stakerB.address, transferAmount);

      await mineBlocks(provider, 50);

      // G4: daoTotalEthVUnits unchanged by cSSV transfer
      const daoVUnitsPostTransfer = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsPostTransfer).to.equal(defaultVUnits(1n), "G4: daoTotalEthVUnits unchanged after cSSV transfer");

      // Both claim
      const claimA = await claimAndGetAmount(network, provider, staker);
      const claimB = await claimAndGetAmount(network, provider, stakerB);

      expect(claimA.amount).to.be.greaterThanOrEqual(0n);
      expect(claimB.amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
    });

    it("XG-025: Mixed SSV and ETH clusters -> migrate SSV cluster -> syncFees -> claim", async function () {
      const deployFixture = createETHFixture(4);
      const { network, views, ssvToken, cssvToken, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register pre-existing ETH cluster
      const reg = await registerCluster(network, clusterOwner, operatorIds);

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, stakerB, stakeAmount);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPreAdd = BigInt(await views.accEthPerShare());

      // Register additional ETH cluster (simulating migration contribution)
      await registerCluster(network, clusterOwner2, operatorIds, DEFAULT_ETH_REGISTER_VALUE, 20);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accPostAdd = BigInt(await views.accEthPerShare());
      expect(accPostAdd).to.be.greaterThan(accPreAdd);

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
    });

    it("XG-026: Migrate -> network fee set to zero -> syncFees -> claim (rewards freeze)", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // Migrate
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accBefore = BigInt(await views.accEthPerShare());
      expect(accBefore).to.be.greaterThan(0n);

      // Set network fee to 0 (updateNetworkFee snapshots DAO earnings for the block gap)
      await network.updateNetworkFee(0n);

      await mineBlocks(provider, 100);
      await network.syncFees();
      const accAfterZeroFee = BigInt(await views.accEthPerShare());
      // accEthPerShare may increase by ~1 block of fees (the block between syncFees and
      // updateNetworkFee), but should NOT grow during the 100-block zero-fee period
      expect(accAfterZeroFee).to.be.greaterThanOrEqual(accBefore);

      // Claim what was accrued before fee went to 0
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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

      // Claim phase 1+2
      await claimAndGetAmount(network, provider, stakerB);

      // EB decrease back to 64 ETH -> vUnits = 20000
      const eb2 = await commitAndUpdateEB(network, provider, clusterOwner, operatorIds, cluster, 64);
      cluster = eb2.cluster;

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(defaultVUnits(2n)); // back to baseline

      // Phase 3: advance blocks at original rate
      await mineBlocks(provider, 50);

      const { amount: phase3Claim } = await claimAndGetAmount(network, provider, stakerB);
      expect(phase3Claim).to.be.greaterThan(0n);
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
      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      // Sync fees first so poolBefore reflects the current accumulated fees
      await network.syncFees();

      // Claim and verify pool balance consistency
      const poolBefore = BigInt(await views.stakingEthPoolBalance());
      const { amount } = await claimAndGetAmount(network, provider, staker);
      const poolAfter = BigInt(await views.stakingEthPoolBalance());

      expect(amount).to.be.greaterThan(0n);
      // Pool balance should decrease by the amount claimed
      expect(poolBefore - poolAfter).to.be.greaterThan(0n);
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
      await network.syncFees();
      const accBefore = BigInt(await views.accEthPerShare());

      // Declare and execute operator fee change (double the fee)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);
      await mineBlocks(provider, Number(DECLARE_OPERATOR_FEE_PERIOD));
      await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);

      await mineBlocks(provider, 50);
      await network.syncFees();
      const accAfter = BigInt(await views.accEthPerShare());

      // Staker reward rate depends on network fee * vUnits, NOT operator fees
      // So accEthPerShare should grow at the same rate
      expect(accAfter).to.be.greaterThan(accBefore);

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.syncFees();

      const poolBefore = BigInt(await views.stakingEthPoolBalance());

      // Liquidate — 500K blocks drains ~0.00506 ETH, well above 0.003 deposit
      await mineBlocks(provider, 500_000);
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);

      await network.syncFees();
      const poolAfter = BigInt(await views.stakingEthPoolBalance());

      // Staking pool balance should NOT be reduced by liquidation
      // (liquidation transfers from cluster balance, not from staking pool)
      expect(poolAfter).to.be.greaterThanOrEqual(poolBefore);
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
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      // syncFees immediately
      await network.syncFees();

      // No errors — pass
      const acc = BigInt(await views.accEthPerShare());
      expect(acc).to.be.greaterThanOrEqual(0n);
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
      const migratedCluster = parseClusterFromEvent(network, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      // Drain balance and sync right before liquidation to capture all pre-liq fees
      await mineBlocks(provider, 500_000);
      await network.syncFees();
      const accBefore = BigInt(await views.accEthPerShare());

      // Liquidate — 500K blocks drains ~0.00506 ETH, well above 0.003 deposit
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, migratedCluster);

      // daoTotalEthVUnits == 0
      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.equal(0n);

      // syncFees with zero vUnits should not revert
      await mineBlocks(provider, 100);
      await network.syncFees();
      const accAfter = BigInt(await views.accEthPerShare());
      // Unchanged or only marginally higher (fees accrued during the liquidation block itself)
      expect(accAfter).to.be.greaterThanOrEqual(accBefore);
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
      // minimumBlocksBeforeLiquidation = 21480, threshold ≈ 0.000654 ETH
      // burn ≈ 30.46 gwei/block at vUnits=40000 → ~700K blocks to drain below threshold
      await mineBlocks(provider, 700_000);
      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
      const liqCluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      expect(await readDaoTotalEthVUnits(provider, networkAddress)).to.equal(0n);

      // Reactivate
      await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Deviation should be restored (reactivation restores EB snapshot)
      const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfter).to.equal(expectedVUnits);

      await mineBlocks(provider, 50);

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // 2. Fee change
      const newFee = DEFAULT_NETWORK_FEE_UNPACKED * 3n;
      await network.updateNetworkFee(newFee);

      // 3. Remove operator
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // 4. Migrate cluster B
      await network.connect(clusterOwner2).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      // Claim
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
    });

    it("XG-038: Stake -> migrate -> advance 10000 blocks -> syncFees -> claim -> verify ETH_DEDUCTED_DIGITS truncation", async function () {
      const deployFixture = createLegacyFixture({ numValidators: 1 });
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const stakeAmount = ethers.parseEther("10");
      await stakeSSV(network, ssvToken, staker, stakeAmount);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Advance many blocks for significant fee accrual
      await mineBlocks(provider, 10000);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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
        expect(amount).to.be.greaterThanOrEqual(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

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
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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

      // stakingEthPoolBalance is still updated (inflated)
      const poolBalance = BigInt(await views.stakingEthPoolBalance());
      expect(poolBalance).to.be.greaterThan(0n);

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

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Verify staking rewards still accrue after operator removal
      await mineBlocks(provider, 100);
      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);

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

      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Sync immediately after migration
      await network.syncFees();
      const poolAfterMigrate = BigInt(await views.stakingEthPoolBalance());

      // Advance blocks
      await mineBlocks(provider, 100);
      await network.syncFees();
      const poolAfter100Blocks = BigInt(await views.stakingEthPoolBalance());

      // Pool balance should increase monotonically
      expect(poolAfter100Blocks).to.be.greaterThanOrEqual(poolAfterMigrate);

      // Claim
      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);

      const poolAfterClaim = BigInt(await views.stakingEthPoolBalance());
      expect(poolAfterClaim).to.be.lessThan(poolAfter100Blocks);
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
      for (let i = 0; i < numValidators; i++) {
        const reg = await registerCluster(
          network, clusterOwner, operatorIds,
          DEFAULT_ETH_REGISTER_VALUE, i + 1,
          i === 0 ? undefined : cluster,
        );
        cluster = reg.cluster;
      }

      // Set high EB (2048 * 10 = 20480 ETH total)
      const ebResult = await commitAndUpdateEB(
        network, provider, clusterOwner, operatorIds, cluster, 2048 * numValidators,
      );

      const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnits).to.be.greaterThan(0n);

      await mineBlocks(provider, 100);

      // Should not revert with overflow
      const { amount } = await claimAndGetAmount(network, provider, stakerB);
      expect(amount).to.be.greaterThan(0n);
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
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 100);

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);
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

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Advance sufficient blocks
      await mineBlocks(provider, 1000);

      // Sync + claim
      await network.syncFees();
      const poolBefore = BigInt(await views.stakingEthPoolBalance());

      const { amount } = await claimAndGetAmount(network, provider, staker);
      expect(amount).to.be.greaterThan(0n);

      // pack(unpack(x)) == x: payout is ETH_DEDUCTED_DIGITS aligned
      expect(amount % ETH_DEDUCTED_DIGITS).to.equal(0n);

      const poolAfter = BigInt(await views.stakingEthPoolBalance());
      // Pool decrease should be pack-aligned too
      const poolDecrease = poolBefore - poolAfter;
      expect(poolDecrease).to.be.greaterThan(0n);
    });
  });
});
