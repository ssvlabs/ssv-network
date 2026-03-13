import type { NetworkConnection } from 'hardhat/types/network';
import type { NetworkHelpersType } from '../common/types.js';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../setup/connection.js';
import { ssvNetworkFullFixture } from '../setup/fixtures.js';
import {
  makePublicKey,
  makeOperatorKey,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
} from '../common/helpers.js';
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
} from '../common/constants.js';
import { expect } from 'chai';

describe("Operator views consistency sanity tests", () => {
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

  describe("getOperatorById vs getOperatorByIdSSV isActive consistency", () => {
    it("ETH-only operator: both views report isActive = true", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.connect(operatorOwner).registerOperator.staticCall(
        operatorKey, MINIMAL_OPERATOR_ETH_FEE, false
      );
      await network.connect(operatorOwner).registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, false);

      const ethView = await views.getOperatorById(operatorId);
      const ssvView = await views.getOperatorByIdSSV(operatorId);

      expect(ethView.isActive).to.equal(true);
      expect(ssvView.isActive).to.equal(true);
    });

    it("Removed operator: both views report isActive = false", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const operatorId = operatorIds[0];

      await network.connect(operatorOwner).removeOperator(operatorId);

      const ethView = await views.getOperatorById(operatorId);
      const ssvView = await views.getOperatorByIdSSV(operatorId);

      expect(ethView.isActive).to.equal(false);
      expect(ssvView.isActive).to.equal(false);
    });

    it("Operator used in ETH cluster: both views report isActive = true", async function () {
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

      await connection.networkHelpers.mine(50);

      for (const opId of operatorIds) {
        const ethView = await views.getOperatorById(opId);
        const ssvView = await views.getOperatorByIdSSV(opId);
        expect(ethView.isActive).to.equal(true);
        expect(ssvView.isActive).to.equal(true);
      }
    });

    it("Removed operator with prior ETH cluster usage: both views report isActive = false", async function () {
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

      await connection.networkHelpers.mine(10);

      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      const ethView = await views.getOperatorById(operatorIds[0]);
      const ssvView = await views.getOperatorByIdSSV(operatorIds[0]);

      expect(ethView.isActive).to.equal(false);
      expect(ssvView.isActive).to.equal(false);
    });
  });

});
