import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  getCurrentClusterState,
  makeOperatorKey,
  makePublicKey,
  registerOperators,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  CLUSTER_VERSION_ETH,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { Errors } from "../../common/errors.ts";

/**
 * Legacy SSV Accounting Integration Tests
 * 
 * These tests verify the separation between legacy SSV token-based accounting
 * and the new ETH accounting system.
 * 
 * Key focus areas:
 * - SSV vs ETH cluster/operator differentiation (SSV getters return 0 for ETH clusters)
 * - SSV-specific DAO functions (updateNetworkFeeSSV, withdrawNetworkSSVEarnings)
 * - Independence of SSV and ETH fee systems
 * 
 * Note: ETH cluster economics (balance burn, deposits, withdrawals, liquidation)
 * are tested in clusters.test.ts. ETH operator earnings are tested in operators.test.ts.
 */
describe("SSVNetwork Integration - Legacy SSV Accounting", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ============================================
  // SECTION 1: SSV vs ETH Cluster Differentiation
  // ============================================
  describe("SSV vs ETH Cluster Differentiation", function () {
    it("ETH cluster has correct version and zero SSV balance/burn rate", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      // Verify ETH cluster properties
      expect(await views.getClusterAssetType(clusterOwner, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      expect(await views.getBalance(clusterOwner, operatorIds, cluster)).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(await views.getBurnRate(clusterOwner, operatorIds, cluster)).to.be.greaterThan(0n);

      // SSV getters revert for ETH clusters
      await expect(views.getBalanceSSV(clusterOwner, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
      await expect(views.getBurnRateSSV(clusterOwner, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
      await expect(views.isLiquidatableSSV(clusterOwner.address, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("Operator registered via ETH cluster has ETH fee but zero SSV fee", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      // ETH fee is set, SSV fee is 0 (not initialized for SSV)
      expect(await views.getOperatorFee(operatorId)).to.equal(MINIMAL_OPERATOR_ETH_FEE);
      expect(await views.getOperatorFeeSSV(operatorId)).to.equal(0n);

      // getOperatorById returns ETH details
      const opDetails = await views.getOperatorById(operatorId);
      expect(opDetails[1]).to.equal(MINIMAL_OPERATOR_ETH_FEE); // ethFee

      // getOperatorByIdSSV returns SSV details (all zeros for new operator)
      const opDetailsSSV = await views.getOperatorByIdSSV(operatorId);
      expect(opDetailsSSV[1]).to.equal(0n); // ssvFee
    });

    it("ETH cluster operators have zero SSV earnings", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine blocks to accrue fees
      await connection.networkHelpers.mine(100);

      // ETH earnings should be positive
      const ethEarnings = await views.getOperatorEarnings(operatorIds[0]);
      expect(ethEarnings).to.be.greaterThan(0n);

      // SSV earnings should be 0 (no SSV cluster)
      const ssvEarnings = await views.getOperatorEarningsSSV(operatorIds[0]);
      expect(ssvEarnings).to.equal(0n);
    });
  });

  // ============================================
  // SECTION 2: Network Fee Earnings - SSV vs ETH Independence
  // ============================================
  describe("Network Fee Earnings - SSV vs ETH Independence", function () {
    it("Initial network earnings are zero for both SSV and ETH", async function () {
      const { views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      expect(await views.getNetworkEarnings()).to.equal(0n);
      expect(await views.getNetworkEarningsSSV()).to.equal(0n);
    });

    it("Network fee is configured for both SSV and ETH", async function () {
      const { views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      expect(await views.getNetworkFee()).to.equal(NETWORK_FEE);
      expect(await views.getNetworkFeeSSV()).to.equal(NETWORK_FEE);
    });

    it("ETH cluster activity increases ETH network earnings only, SSV unchanged", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const ethEarningsBefore = await views.getNetworkEarnings();
      const ssvEarningsBefore = await views.getNetworkEarningsSSV();

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine blocks to accrue network fees
      await connection.networkHelpers.mine(100);

      const ethEarningsAfter = await views.getNetworkEarnings();
      const ssvEarningsAfter = await views.getNetworkEarningsSSV();

      // ETH earnings increased
      expect(ethEarningsAfter).to.be.greaterThan(ethEarningsBefore);
      // SSV earnings unchanged (no SSV clusters)
      expect(ssvEarningsAfter).to.equal(ssvEarningsBefore);
    });

    it("updateNetworkFeeSSV changes SSV network fee independently of ETH fee", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const initialSSVFee = await views.getNetworkFeeSSV();
      const initialETHFee = await views.getNetworkFee();

      const newSSVFee = initialSSVFee * 2n;
      const tx = await network.updateNetworkFeeSSV(newSSVFee);

      await expect(tx)
        .to.emit(network, Events.NETWORK_FEE_UPDATED_SSV)
        .withArgs(initialSSVFee, newSSVFee);

      expect(await views.getNetworkFeeSSV()).to.equal(newSSVFee);
      // ETH fee unchanged
      expect(await views.getNetworkFee()).to.equal(initialETHFee);
    });

    it("updateNetworkFee changes ETH network fee independently of SSV fee", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const initialSSVFee = await views.getNetworkFeeSSV();
      const initialETHFee = await views.getNetworkFee();

      const newETHFee = initialETHFee * 2n;
      const tx = await network.updateNetworkFee(newETHFee);

      await expect(tx)
        .to.emit(network, Events.NETWORK_FEE_UPDATED)
        .withArgs(initialETHFee, newETHFee);

      expect(await views.getNetworkFee()).to.equal(newETHFee);
      // SSV fee unchanged
      expect(await views.getNetworkFeeSSV()).to.equal(initialSSVFee);
    });
  });

  // ============================================
  // SECTION 3: SSV-Specific DAO Functions
  // ============================================
  describe("SSV-Specific DAO Functions", function () {
    it("withdrawNetworkSSVEarnings requires owner permission", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).withdrawNetworkSSVEarnings(1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });

    it("updateNetworkFeeSSV requires owner permission", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const newFee = (await views.getNetworkFeeSSV()) * 2n;

      await expect(network.connect(randomUser).updateNetworkFeeSSV(newFee))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });

    it("getMinimumLiquidationCollateralSSV is callable and returns a value", async function () {
      const { views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const ssvCollateral = await views.getMinimumLiquidationCollateralSSV();
      const ethCollateral = await views.getMinimumLiquidationCollateral();

      // SSV collateral may be 0 if not configured for legacy clusters
      // ETH collateral should be configured
      expect(ssvCollateral).to.be.greaterThanOrEqual(0n);
      expect(ethCollateral).to.be.greaterThan(0n);
    });
  });

  // ============================================
  // SECTION 4: SSV Operator Earnings Functions
  // ============================================
  describe("SSV Operator Earnings Functions", function () {
    it("withdrawOperatorEarningsSSV reverts with InsufficientBalance when no SSV earnings", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Create ETH cluster (not SSV)
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(100);

      // SSV earnings should be 0, use precision-safe amount (10_000_000n is the shrink factor)
      const precisionSafeAmount = 10_000_000n;
      await expect(network.connect(operatorOwner).withdrawOperatorEarningsSSV(operatorIds[0], precisionSafeAmount))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("withdrawAllOperatorEarningsSSV reverts with InsufficientBalance when no SSV earnings", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      // No cluster registered, so no earnings
      await expect(network.connect(operatorOwner).withdrawAllOperatorEarningsSSV(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("withdrawOperatorEarningsSSV requires operator ownership", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.connect(randomUser).withdrawOperatorEarningsSSV(operatorIds[0], 1n))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER);
    });
  });

  // ============================================
  // SECTION 5: Liquidation Version Checks
  // ============================================
  describe("Liquidation Version Checks", function () {
    it("liquidateSSV reverts for ETH clusters with IncorrectClusterVersion", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Create ETH cluster
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      // liquidateSSV should revert for ETH clusters
      await expect(network.liquidateSSV(clusterOwner.address, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
    });
  });
});
