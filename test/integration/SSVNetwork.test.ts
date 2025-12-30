import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../setup/connection.ts';
import { ssvNetworkFullFixture } from '../setup/fixtures.ts';
import type { NetworkHelpersType } from '../common/types.ts';
import {
  getCurrentClusterState,
  makeOperatorKey,
  makePublicKey,
  registerOperators,
  whitelistAddresses,
} from '../common/helpers.ts';
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
} from '../common/constants.ts';
import { Events } from '../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';

describe("SSVNetwork full integration tests", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Constructor, initializer and upgrades", async function () {
    it("Configures SSVNetwork correctly", async function () {
      const { network, views, cssvToken, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      expect(await network.getAddress()).to.be.properAddress;
      expect(await views.getAddress()).to.be.properAddress;
      expect(await cssvToken.getAddress()).to.be.properAddress;
      expect(await ssvToken.getAddress()).to.be.properAddress;

      const version = await network.getVersion();
      expect(version).to.be.a("string").and.not.empty;

      expect(await views.getMinimumLiquidationCollateral()).to.equal(1_000_000_000_000_000_000n);
      expect(await views.getValidatorsPerOperatorLimit()).to.equal(3000n);
      expect(await views.getOperatorFeePeriods()).to.deep.equal([604800n, 604800n]); // declare, execute
      expect(await views.getOperatorFeeIncreaseLimit()).to.equal(1000n); // 10%
      expect(await views.getDefaultOracleIds()).to.deep.equal([1n, 2n, 3n, 4n]);
      expect(await views.getQuorumBps()).to.equal(7500n);

      expect(await views.getNetworkFee()).to.equal(382640000000n);
      expect(await views.getNetworkFeeSSV()).to.equal(382640000000n);
      expect(await views.getMaximumOperatorFee()).to.equal(76528650000000n);

      expect(await views.cooldownDuration()).to.equal(7n * 24n * 60n * 60n);

      expect(await views.getNetworkEarnings()).to.equal(0n);
      expect(await views.getNetworkEarningsSSV()).to.equal(0n);
      expect(await views.getNetworkValidatorsCount()).to.equal(0);
      expect(await views.totalStaked()).to.equal(0n);
    });
  });

  describe("Function 'registerOperator()'", async function () {
    it("Creates new operator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);

      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true))
        .to.emit(network, Events.OPERATOR_ADDED).withArgs(expectedId, operatorOwner.address, operatorKey, MINIMAL_OPERATOR_ETH_FEE)
        .and.to.emit(network, Events.OPERATOR_PRIVACY_STATUS_UPDATED).withArgs([expectedId], true);

      expect(await views.getOperatorFee(expectedId)).to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
      expect(await views.getOperatorFeeSSV(expectedId)).to.be.equal(0);
      expect(await views.getOperatorDeclaredFee(expectedId)).to.be.deep.equal([false, 0n, 0n, 0n]);
      expect(await views.getOperatorById(expectedId)).to.be.deep.equal([
        operatorOwner.address,
        MINIMAL_OPERATOR_ETH_FEE,
        0,
        connection.ethers.ZeroAddress,
        true,
        true
        ]);
      expect(await views.getOperatorByIdSSV(expectedId)).to.be.deep.equal([
        operatorOwner.address,
        0,
        0,
        connection.ethers.ZeroAddress,
        true,
        true
      ]);
    });
  });

  describe("Function 'registerValidator()'", async function () {
    it("Creates new validator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

        const validatorKey = makePublicKey(1);
        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

        await expect(await network.connect(clusterOwner).registerValidator(
          validatorKey,
          operatorIds,
          DEFAULT_SHARES,
          0,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        )).to.emit(network, Events.VALIDATOR_ADDED);

      const expectedCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);

      networkHelpers.mine(10_000_000_000);

      await network.liquidate(clusterOwner, operatorIds, expectedCluster);
    });
  });
});