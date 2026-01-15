import type { NetworkConnection } from 'hardhat/types/network';
import type { NetworkHelpersType } from '../common/types.js';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../setup/connection.js';
import { ssvNetworkFullFixture } from '../setup/fixtures.js';
import { getCurrentClusterState, makePublicKey, registerOperators, whitelistAddresses } from '../common/helpers.js';
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  SMALL_ETH_REGISTER_VALUE,
} from '../common/constants.js';
import { expect } from 'chai';
import { Events } from '../common/events.js';

describe("Cluster with a removed operator sanity test", () => {
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

  it("Allows to liquidate cluster with a previously removed operator", async function() {
    const { network, views } =
      await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

    const validatorKey = makePublicKey(1);
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

    await network.connect(clusterOwner).registerValidator(
      validatorKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: SMALL_ETH_REGISTER_VALUE }
    );

    const expectedCluster = await getCurrentClusterState(
      connection,
      network,
      clusterOwner.address,
      operatorIds
    );

    // make cluster liquidatable
    await networkHelpers.mine(100);
    await network.connect(operatorOwner).removeOperator(operatorIds[2]);
    await networkHelpers.mine(300);

    expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
      .to.be.equal(true);

    expect(await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, expectedCluster))
      .to.emit(network, Events.CLUSTER_LIQUIDATED);
  });
});