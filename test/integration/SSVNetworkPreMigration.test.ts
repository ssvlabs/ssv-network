import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from '../setup/fixtures.ts';
import type { NetworkHelpersType, OperatorSSV } from '../common/types.ts';
import { CLUSTER_VERSION_ETH, CLUSTER_VERSION_SSV, DEFAULT_ETH_REGISTER_VALUE, DEFAULT_OPERATOR_ETH_FEE, DEFAULT_SHARES, EMPTY_CLUSTER, MAXIMUM_OPERATORS_FEE, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_FEE_SSV, MINIMUM_BLOCKS_BEFORE_LIQUIDATION, MINIMUM_LIQUIDATION_PERIOD_COLLATERAL, NETWORK_FEE, OPERATOR_MAX_FEE_INCREASE, SMALL_ETH_REGISTER_VALUE, TOKEN_REGISTER_AMOUNT, VALIDATORS_PER_OPERATOR_LIMIT, } from '../common/constants.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getCurrentClusterState, makePublicKey, registerOperators, registerOperatorsSSV, setupTestContext, whitelistAddresses, } from '../helpers/index.js';
import type { ISSVViewsTypes } from '../../types/ethers-contracts/contracts/SSVNetworkViews.js';
import { Errors } from '../common/errors.js';
import { Events } from '../common/events.js';

describe("SSVNetwork full integration tests with performing an upgrade on a legacy artifact", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner] } = await setupTestContext());
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullPreUpgradeFixture(connection);
  };

  describe("Legacy setup configuration", async function () {
    it("Configures SSVNetwork and SSVNetworkViews correctly", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      expect(await network.getVersion()).to.be.equal("v1.2.0");
      expect(await views.ssvNetwork()).to.be.equal(await network.getAddress());
      expect(await views.getNetworkFee()).to.be.equal(NETWORK_FEE);
      expect(await views.getNetworkEarnings()).to.be.equal(0);
      expect(await views.getOperatorFeeIncreaseLimit()).to.be.equal(OPERATOR_MAX_FEE_INCREASE);
      expect(await views.getMaximumOperatorFee()).to.be.equal(MAXIMUM_OPERATORS_FEE);
      expect(await views.getLiquidationThresholdPeriod()).to.be.equal(MINIMUM_BLOCKS_BEFORE_LIQUIDATION);
      expect(await views.getMinimumLiquidationCollateral()).to.be.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
      expect(await views.getValidatorsPerOperatorLimit()).to.be.equal(VALIDATORS_PER_OPERATOR_LIMIT);
    });
  });

  describe("Restrictions for legacy ssv clusters", async function () {
    it("'registerValidator()' is reverted with 'IncorrectClusterVersion' if trying to register validators to a legacy cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).registerValidator(makePublicKey(322), operatorIds, DEFAULT_SHARES, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("'bulkRegisterValidator()' is reverted with 'IncorrectClusterVersion' if trying to register validators to a legacy cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).bulkRegisterValidator([makePublicKey(322)], operatorIds, [DEFAULT_SHARES], cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("'removeValidator()' is reverted with 'IncorrectClusterVersion' if trying to remove validators from a legacy cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).removeValidator(makePublicKey(123), operatorIds, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("'bulRemoveValidator()' is reverted with 'IncorrectClusterVersion' if trying to remove validators from a legacy cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).bulkRemoveValidator([makePublicKey(123)], operatorIds, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("'liquidate()' is reverted with 'IncorrectClusterVersion' if trying to liquidate legacy ssv cluster with an ETH-based function", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("'reactivate()' is reverted with 'IncorrectClusterVersion' if trying to reactivate a legacy ssv cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).reactivate(operatorIds, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("withdraw() is reverted with 'IncorrectClusterVersion' is trying to withdraw from a legacy ssv cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).withdraw(operatorIds, TOKEN_REGISTER_AMOUNT, cluster)).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("deposit() is reverted with 'IncorrectClusterVersion' is trying to deposit to a legacy ssv cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, } = await upgradeToStakingVersion(connection, network, views);
      await expect(newNetwork.connect(clusterOwner).deposit(clusterOwner.address, operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE })).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });
  });

  describe("Function 'migrateClusterToETH'", async function () {
    it("Executes as expected and emits correct event", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const clusterBalance = await newViews.getBalanceSSV(clusterOwner.address, operatorIds, cluster);
      const burnRateSSV = await newViews.getBurnRateSSV(clusterOwner.address, operatorIds, cluster);
      const expectedClusterBalance = clusterBalance - burnRateSSV;
      const tx = await newNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE });
      await tx.wait();
      await expect(tx)
        .to.changeTokenBalances(connection.ethers, ssvToken, [newNetwork, clusterOwner], [-expectedClusterBalance, expectedClusterBalance]);
      await expect(tx).to.emit(newNetwork, Events.CLUSTER_MIGRATED_TO_ETH);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.be.equal(CLUSTER_VERSION_ETH);
      expect(await newViews.getBalanceSSV(clusterOwner.address, operatorIds, cluster)).to.be.equal(0);
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, cluster)).to.be.equal(SMALL_ETH_REGISTER_VALUE);
      expect(cluster.active).to.be.equal(true);
    });

    it("Migrates a liquidated cluster, emits correct events and reactivates cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const tx = await newNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE });
      await tx.wait();
      await expect(tx).to.emit(newNetwork, Events.CLUSTER_MIGRATED_TO_ETH);
      await expect(tx).to.emit(newNetwork, Events.CLUSTER_REACTIVATED);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.be.equal(CLUSTER_VERSION_ETH);
      expect(await newViews.getBalanceSSV(clusterOwner.address, operatorIds, cluster)).to.be.equal(0);
      expect(await newViews.getBalance(clusterOwner.address, operatorIds, cluster)).to.be.equal(SMALL_ETH_REGISTER_VALUE);
      expect(cluster.active).to.be.equal(true);
    });
  });

  describe("Legacy operators migration", async function () {
    it("Migrates operators to the eth version after migration of operator's cluster", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      expect(await newNetwork.getVersion()).to.be.equal("v2.0.0");
      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.be.equal(CLUSTER_VERSION_SSV);
      for (let i = 0; i < operatorIds.length; i++) {
        const opSSV: OperatorSSV = await newViews.getOperatorByIdSSV(operatorIds[i]);
        const opEth: ISSVViewsTypes.OperatorDataStructOutput = await newViews.getOperatorById(operatorIds[i]);
        expect(opSSV.validatorCount).to.be.equal(1);
        expect(opEth.validatorCount).to.be.equal(0);
        expect(opSSV.fee).to.be.equal(MINIMAL_OPERATOR_FEE_SSV);
        expect(opEth.fee).to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
        expect(opSSV.isActive).to.be.equal(true);
        expect(opEth.isActive).to.be.equal(false);
      }
      await newNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE });
      expect(await newViews.getClusterAssetType(clusterOwner.address, operatorIds)).to.be.equal(CLUSTER_VERSION_ETH);
      for (let i = 0; i < operatorIds.length; i++) {
        const opSSV: OperatorSSV = await newViews.getOperatorByIdSSV(operatorIds[i]);
        const opEth: ISSVViewsTypes.OperatorDataStructOutput = await newViews.getOperatorById(operatorIds[i]);
        expect(opSSV.validatorCount).to.be.equal(0);
        expect(opEth.validatorCount).to.be.equal(1);
        expect(opSSV.fee).to.be.equal(MINIMAL_OPERATOR_FEE_SSV);
        expect(opEth.fee).to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
        expect(opSSV.isActive).to.be.equal(true);
        expect(opEth.isActive).to.be.equal(true);
      }
    });
  });

  describe("Sanity", async function () {
    it("Migrates operators to ETH after registering an ETH validator and applies correct fees", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      for (let i = 0; i < operatorIds.length; i++) {
        const opSSVFee = await newViews.getOperatorFeeSSV(operatorIds[i]);
        const opEthFee = await newViews.getOperatorFee(operatorIds[i]);
        expect(opSSVFee).to.be.equal(MINIMAL_OPERATOR_FEE_SSV);
        expect(opEthFee).to.be.equal(DEFAULT_OPERATOR_ETH_FEE);
      }
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await newNetwork.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });
      await networkHelpers.mine(999);
      for (let i = 0; i < operatorIds.length; i++) {
        const opSSVFee = await newViews.getOperatorFeeSSV(operatorIds[i]);
        const opEthFee = await newViews.getOperatorFee(operatorIds[i]);
        expect(opSSVFee).to.be.equal(MINIMAL_OPERATOR_FEE_SSV);
        expect(opEthFee).to.be.equal(DEFAULT_OPERATOR_ETH_FEE);
        expect(await newViews.getOperatorEarnings(operatorIds[i])).to.be.equal(DEFAULT_OPERATOR_ETH_FEE * 999n);
      }
    });

    it("Reactivates liquidated cluster during migration, emits event and applies correct fees", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
      const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER);
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      expect(await newViews.isLiquidated(clusterOwner.address, operatorIds, cluster)).to.be.equal(true);
      const tx = await newNetwork.connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE });
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(tx).to.emit(newNetwork, Events.CLUSTER_REACTIVATED);
      expect(await newViews.isLiquidated(clusterOwner.address, operatorIds, cluster)).to.be.equal(false);
      await networkHelpers.mine(999);
      for (let i = 0; i < operatorIds.length; i++) {
        const opEthFee = await newViews.getOperatorFee(operatorIds[i]);
        expect(opEthFee).to.be.equal(DEFAULT_OPERATOR_ETH_FEE);
        expect(await newViews.getOperatorEarnings(operatorIds[i])).to.be.equal(DEFAULT_OPERATOR_ETH_FEE * 999n);
      }
    });

    it("Allows to remove all validators from a liquidated cluster", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await newNetwork.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await newNetwork.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(await newViews.isLiquidated(clusterOwner.address, operatorIds, cluster)).to.be.equal(true);
      await newNetwork.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.validatorCount).to.be.deep.equal(0);
    });
  });
});
