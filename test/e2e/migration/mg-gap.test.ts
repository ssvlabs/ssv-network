import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  extractEventArgs,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  DEFAULT_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcLiquidationThreshold,
  defaultVUnits,
  computeClusterId,
  generateMerkleForClusterEB,
  setupOracles,
  commitEBRoot,
} from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

// ── Storage layout helpers for direct protocol storage writes ──

const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;

/** Set validatorsPerOperatorLimit via direct storage write. Field is at bits [96..127] of slot 0. */
async function setValidatorsPerOperatorLimit(
  provider: any,
  proxyAddress: string,
  limit: number,
): Promise<void> {
  const slotHex = "0x" + PROTOCOL_BASE_SLOT.toString(16).padStart(64, "0");
  const raw = BigInt(await provider.getStorage(proxyAddress, slotHex));
  const mask = ~(0xFFFFFFFFn << 96n);
  const updated = (raw & mask) | (BigInt(limit) << 96n);
  await provider.send("hardhat_setStorageAt", [
    proxyAddress,
    slotHex,
    ethers.zeroPadValue(ethers.toBeHex(updated), 32),
  ]);
}

describe("MG Gap Tests — Migration Coverage Gaps", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, clusterOwnerB] } = await setupTestContext());
  });

  // ═══════════════════════════════════════════════════════════
  // MG-002 / MG-003 / MG-004: Larger operator sets (7, 10, 13)
  // ═══════════════════════════════════════════════════════════

  describe("MG-002/003/004: Migration with 7, 10, 13 operators", () => {
    for (const opCount of [7, 10, 13]) {
      it(`MG-${String(opCount === 7 ? "002" : opCount === 10 ? "003" : "004")}: Migrates active SSV cluster with ${opCount} operators`, async function () {
        const deployFixture = async () => {
          const { network: legacyNetwork, views: legacyViews, ssvToken } =
            await ssvNetworkFullPreUpgradeFixture(connection);

          const operatorIds: number[] = [];
          for (let i = 0; i < opCount; i++) {
            const expectedId = await legacyNetwork.connect(clusterOwner)
              .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
            await legacyNetwork.connect(clusterOwner)
              .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
            operatorIds.push(Number(expectedId));
          }

          await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
          await ssvToken.connect(clusterOwner).approve(
            await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
          );

          await legacyNetwork.connect(clusterOwner).registerValidator(
            makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
          );
          const cluster = await getCurrentClusterState(
            connection, legacyNetwork, clusterOwner.address, operatorIds,
          );

          const { newNetwork, newViews } = await upgradeToStakingVersion(
            connection, legacyNetwork, legacyViews,
          );

          return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
        };

        const { network, views, operatorIds, cluster } =
          await networkHelpers.loadFixture(deployFixture);

        const ethDeposit = ethers.parseEther("10");
        const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: ethDeposit },
        );
        const receipt = await migrateTx.wait();
        await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

        const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
        expect(clusterAfter.active).to.equal(true);
        expect(clusterAfter.balance).to.equal(ethDeposit);
        expect(clusterAfter.validatorCount).to.equal(1n);

        for (const opId of operatorIds) {
          const opETH = await views.getOperatorById(opId);
          expect(opETH.validatorCount).to.equal(1);
          const opSSV = await views.getOperatorByIdSSV(opId);
          expect(opSSV.validatorCount).to.equal(0);
        }

        expect(await views.getNetworkValidatorsCount()).to.equal(1);
      });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // MG-020: Pending operator fee declaration ignored during migration
  // ═══════════════════════════════════════════════════════════

  describe("MG-020: Migration uses current ethFee, not pending declaration", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      // Create two SSV clusters: one to initialize ETH fees, one to migrate later
      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Second cluster (different owner) to migrate first → initializes ETH defaults
      await ssvToken.mint(clusterOwnerB.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwnerB).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );
      await legacyNetwork.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const clusterB = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwnerB.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, clusterB };
    };

    it("MG-020: Pending fee declaration does not affect migration (uses current ethFee)", async function () {
      const { network, views, operatorIds, cluster, clusterB } =
        await networkHelpers.loadFixture(deployFixture);

      // Step 1: Migrate cluster B first → this initializes operators' ETH defaults
      await network.connect(clusterOwnerB).migrateClusterToETH(
        operatorIds, clusterB, { value: ethers.parseEther("10") },
      );

      // Verify operator 0 now has default ETH fee
      const feeBeforeDeclare = await views.getOperatorFee(operatorIds[0]);
      expect(feeBeforeDeclare).to.equal(DEFAULT_OPERATOR_ETH_FEE);

      // Step 2: Declare a higher fee for op0 (within increase limit) but DON'T execute
      const newFee = await (async () => {
        const { getValidOperatorFeeIncrease } = await import("../../helpers/operator.ts");
        return getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
      })();
      await network.connect(clusterOwner).declareOperatorFee(
        BigInt(operatorIds[0]), newFee,
      );

      // Step 3: Migrate cluster A — should use current fee, not pending
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Op0 fee should still be the original (pending fee not executed)
      const feeAfterMigrate = await views.getOperatorFee(operatorIds[0]);
      expect(feeAfterMigrate).to.equal(DEFAULT_OPERATOR_ETH_FEE);

      // All operators functional
      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(2); // 1 from cluster B + 1 from cluster A
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-026 / MG-027: Operator validator limit boundary
  // ═══════════════════════════════════════════════════════════

  describe("MG-026/027: Operator validator limit boundary during migration", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      // Register SSV cluster with 2 validators
      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-026: Migration succeeds when exactly at operator validator limit", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set limit to 5, then register 3 ETH validators → ethValidatorCount = 3
      // Migration adds 2 → 3 + 2 = 5 == limit
      const proxyAddress = await network.getAddress() as string;
      await setValidatorsPerOperatorLimit(provider, proxyAddress, 5);

      // Register an ETH cluster with 3 validators on the same operators
      for (let i = 0; i < 3; i++) {
        const regCluster = i === 0 ? EMPTY_CLUSTER
          : await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);
        await network.connect(clusterOwnerB).registerValidator(
          makePublicKey(100 + i), operatorIds, DEFAULT_SHARES, regCluster,
          { value: i === 0 ? DEFAULT_ETH_REGISTER_VALUE : 0n },
        );
      }

      // Verify ethValidatorCount = 3 for each op
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(3);
      }

      // Migrate SSV cluster (2 validators) → should succeed at exactly limit=5
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify ethValidatorCount = 5 (at limit)
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(5);
      }
    });

    it("MG-027: Migration reverts when exceeding operator validator limit", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set limit to 4, then register 3 ETH validators → ethValidatorCount = 3
      // Migration adds 2 → 3 + 2 = 5 > 4 → revert
      const proxyAddress = await network.getAddress() as string;
      await setValidatorsPerOperatorLimit(provider, proxyAddress, 4);

      // Register an ETH cluster with 3 validators on the same operators
      for (let i = 0; i < 3; i++) {
        const regCluster = i === 0 ? EMPTY_CLUSTER
          : await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);
        await network.connect(clusterOwnerB).registerValidator(
          makePublicKey(100 + i), operatorIds, DEFAULT_SHARES, regCluster,
          { value: i === 0 ? DEFAULT_ETH_REGISTER_VALUE : 0n },
        );
      }

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-047: Migrate cluster with 0 validators
  // ═══════════════════════════════════════════════════════════

  describe("MG-047: Zero-validator cluster migration", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      // Register 1 validator, then remove it → 0 validators
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(0n);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-047: Migrates zero-validator cluster without operator increments", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      const ethDeposit = ethers.parseEther("1");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.validatorCount).to.equal(0n);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.balance).to.equal(ethDeposit);

      // No operators should have ethValidatorCount incremented
      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(0);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-048: Non-owner caller → revert
  // ═══════════════════════════════════════════════════════════

  describe("MG-048: Non-owner migration revert", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, operatorIds, cluster };
    };

    it("MG-048: Non-owner caller reverts with ClusterDoesNotExist", async function () {
      const { network, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      // clusterOwnerB is not the cluster owner — hash mismatch → ClusterDoesNotExist
      await expect(
        network.connect(clusterOwnerB).migrateClusterToETH(
          operatorIds, cluster, { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-050: Stale cluster struct → revert IncorrectClusterState
  // ═══════════════════════════════════════════════════════════

  describe("MG-050: Stale cluster state revert", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const staleCluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Register another validator — cluster struct changes, staleCluster is now outdated
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, staleCluster,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, operatorIds, staleCluster };
    };

    it("MG-050: Stale cluster struct reverts with IncorrectClusterState", async function () {
      const { network, operatorIds, staleCluster } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, staleCluster, { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-058: All zero-fee operators
  // ═══════════════════════════════════════════════════════════

  describe("MG-058: Migration with all zero-fee operators", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      // Register operators with SSV fee = 0
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), 0n, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), 0n, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-058: Zero-fee operators → ethFee stays 0, migration succeeds with only network fee", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);

      // With SSV fee=0, ensureETHDefaults should NOT assign default ETH fee
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // OperatorFeeExecuted should NOT be emitted (zero-fee ops don't get default)
      await expect(migrateTx).to.not.emit(network, Events.OPERATOR_FEE_EXECUTED);

      // All operators should have ethFee = 0
      for (const opId of operatorIds) {
        const opFee = await views.getOperatorFee(opId);
        expect(opFee).to.equal(0n);
      }

      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.balance).to.equal(ethDeposit);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-052: Explicit EB + removed operator + deviation
  // ═══════════════════════════════════════════════════════════

  describe("MG-052: Explicit EB deviation with removed operator", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      // Register 2 validators
      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-052: Explicit EB + removed op — deviation applied to all ops including removed (stranded)", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set up oracles to enable updateClusterBalance on SSV cluster
      const signers = await connection.ethers.getSigners();
      const oracles = [signers[5], signers[6], signers[7], signers[8]];
      const staker = signers[9];

      await setupOracles(network, ssvToken, staker, oracles);

      // Set explicit EB via updateClusterBalance on the SSV cluster
      // 2 validators × 48 ETH/validator = 96 ETH total → vUnits = ceil(96*10000/32) = 30000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 96;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance },
      ]);

      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, oracles);

      const ebTx = await network.updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
      );
      await ebTx.wait();

      // Now remove op4
      await network.connect(clusterOwner).removeOperator(operatorIds[3]);

      await mineBlocks(provider, 10);

      // Migrate the cluster
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      // effectiveBalance in event should be 96 (from explicit EB)
      expect(eventArgs.effectiveBalance).to.equal(96);

      // Live operators (0-2) should have ethValidatorCount = 2
      for (let i = 0; i < 3; i++) {
        const opETH = await views.getOperatorById(operatorIds[i]);
        expect(opETH.validatorCount).to.equal(2);
      }

      // Removed operator (3) should have ethValidatorCount = 0
      const op3ETH = await views.getOperatorById(operatorIds[3]);
      expect(op3ETH.validatorCount).to.equal(0);

      // Cluster is active with correct balance
      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(2n);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-055: Migrate → liquidate → reactivate lifecycle
  // ═══════════════════════════════════════════════════════════

  describe("MG-055: Full migrate → liquidate → reactivate lifecycle", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-055: SSV→ETH migration, liquidation, then ETH reactivation", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Step 1: Migrate SSV → ETH with minimal ETH deposit
      const ethFeeRaw = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeeRaw = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
        numOperators: 4n,
        ethFee: ethFeeRaw,
        networkFee: networkFeeRaw,
        effectiveVUnits: defaultVUnits(1n),
      });
      // Deposit just above threshold
      const smallDeposit = threshold + 1n;

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: smallDeposit },
      );
      const migrateReceipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      let migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(migratedCluster.active).to.equal(true);

      // Step 2: Mine blocks to drain the balance → becomes liquidatable
      await mineBlocks(provider, 500);

      // Step 3: Liquidate
      const liquidateTx = await network.connect(clusterOwnerB).liquidate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const liqReceipt = await liquidateTx.wait();
      await expect(liquidateTx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);

      // Verify operators lost ETH validator count
      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(0);
      }

      // Step 4: Reactivate with fresh ETH
      const reactivateDeposit = ethers.parseEther("10");
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: reactivateDeposit },
      );
      const reactReceipt = await reactivateTx.wait();
      await expect(reactivateTx).to.emit(network, Events.CLUSTER_REACTIVATED);

      const reactivatedCluster = parseClusterFromEvent(network, reactReceipt, Events.CLUSTER_REACTIVATED);
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.balance).to.equal(reactivateDeposit);
      expect(reactivatedCluster.validatorCount).to.equal(1n);

      // Operators restored
      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(1);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-060: Large validator count + high EB — overflow check
  // ═══════════════════════════════════════════════════════════

  describe("MG-060: Large validator count with high explicit EB", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      // Register 10 validators
      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 10n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      let cluster = EMPTY_CLUSTER;
      for (let i = 0; i < 10; i++) {
        const clusterForReg = i === 0
          ? EMPTY_CLUSTER
          : await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);
        await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(i + 1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, clusterForReg,
        );
      }
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(10n);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-060: 10 validators × 2048 ETH EB — no overflow in deviation accounting", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set up oracles to enable updateClusterBalance
      const signers = await connection.ethers.getSigners();
      const oracles = [signers[5], signers[6], signers[7], signers[8]];
      const staker = signers[9];

      await setupOracles(network, ssvToken, staker, oracles);

      // Set explicit EB: 10 validators × 2048 ETH each = 20480 ETH total
      // vUnits = ceil(20480 * 10000 / 32) = 6400000
      // baseline = 10 * 10000 = 100000
      // deviation = 6400000 - 100000 = 6300000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 20480; // 10 × 2048 ETH
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance },
      ]);

      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, oracles);

      const ebTx = await network.updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
      );
      await ebTx.wait();

      // Migrate the cluster
      const ethDeposit = ethers.parseEther("100");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

      const clusterAfter = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(10n);
      expect(clusterAfter.balance).to.equal(ethDeposit);

      // All operators should have ethValidatorCount = 10
      for (const opId of operatorIds) {
        const opETH = await views.getOperatorById(opId);
        expect(opETH.validatorCount).to.equal(10);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-017: Migrate → immediately updateClusterBalance
  // ═══════════════════════════════════════════════════════════

  describe("MG-017: Migrate then updateClusterBalance", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-017: updateClusterBalance succeeds immediately after migration", async function () {
      const { network, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set up oracles
      const signers = await connection.ethers.getSigners();
      const oracles = [signers[5], signers[6], signers[7], signers[8]];
      const staker = signers[9];

      await setupOracles(network, ssvToken, staker, oracles);

      // Migrate cluster to ETH
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const migrateReceipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Immediately updateClusterBalance with same EB (2 validators × 32 ETH = 64)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance },
      ]);

      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, oracles);

      const updateTx = await network.updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, migratedCluster, effectiveBalance, proofs[clusterId],
      );
      const updateReceipt = await updateTx.wait();
      await expect(updateTx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      // Cluster should still be active with balance near initial deposit
      const updatedCluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);
      expect(updatedCluster.active).to.equal(true);
      expect(updatedCluster.validatorCount).to.equal(2n);
      // Balance should be slightly less than deposit due to a few blocks of fee accrual
      expect(BigInt(updatedCluster.balance)).to.be.lessThanOrEqual(ethDeposit);
      expect(BigInt(updatedCluster.balance)).to.be.greaterThan(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // MG-018: Migrate → removeOperator → updateClusterBalance
  // ═══════════════════════════════════════════════════════════

  describe("MG-018: Migrate → removeOperator → updateClusterBalance", () => {
    const deployFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("MG-018: updateClusterBalance succeeds after migration and operator removal", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set up oracles
      const signers = await connection.ethers.getSigners();
      const oracles = [signers[5], signers[6], signers[7], signers[8]];
      const staker = signers[9];

      await setupOracles(network, ssvToken, staker, oracles);

      // Step 1: Migrate
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const migrateReceipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);

      // Step 2: Remove op4
      await network.connect(clusterOwner).removeOperator(operatorIds[3]);

      await mineBlocks(provider, 50);

      // Step 3: updateClusterBalance with explicit EB
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 32; // 1 validator × 32 ETH
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance },
      ]);

      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, oracles);

      const updateTx = await network.updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, migratedCluster, effectiveBalance, proofs[clusterId],
      );
      const updateReceipt = await updateTx.wait();
      await expect(updateTx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      // Cluster active, fees accrued from 3 live operators only
      const updatedCluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);
      expect(updatedCluster.active).to.equal(true);
      expect(BigInt(updatedCluster.balance)).to.be.lessThan(ethDeposit);
      expect(BigInt(updatedCluster.balance)).to.be.greaterThan(0n);

      // Live operators should have validatorCount=1, removed op should have 0
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(1);
      }
      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0);
    });
  });
});
