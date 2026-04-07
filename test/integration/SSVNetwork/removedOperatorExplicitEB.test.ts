import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
  computeEBRoot,
  computeClusterId,
  setupOracles,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  NETWORK_FEE,
} from "../../common/constants.ts";

/**
 * These tests intentionally describe the expected legitimate behavior.
 * On the current code, they fail and demonstrate the removed-operator / explicit-EB bug.
 */
describe("Known Issue Repro: removed operator bricks explicit-EB maintenance paths", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [deployer, operatorOwner, clusterOwner, liquidator, oracle1, oracle2, oracle3, oracle4],
    } = await setupTestContext());
  });

  const deployFixture = async () => ssvNetworkFullFixture(connection);

  async function prepareScenario(highNetworkFee = false) {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);

    if (highNetworkFee) {
      await network.updateNetworkFee(NETWORK_FEE * 100n);
    }

    await setupOracles(network, ssvToken, deployer, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    await (
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      )
    ).wait();

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const clusterAfterRegister = await getCurrentClusterState(
      connection,
      network,
      clusterOwner.address,
      operatorIds
    );

    await networkHelpers.mine(1n);
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const root64 = computeEBRoot(clusterId, 64);

    await (await network.connect(oracle1).commitRoot(root64, blockNum)).wait();
    await (await network.connect(oracle2).commitRoot(root64, blockNum)).wait();
    await (await network.connect(oracle3).commitRoot(root64, blockNum)).wait();

    await (
      await network.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        clusterAfterRegister,
        64,
        []
      )
    ).wait();

    const clusterAfterEB = await getCurrentClusterState(
      connection,
      network,
      clusterOwner.address,
      operatorIds
    );

    await (await network.connect(operatorOwner).removeOperator(operatorIds[0])).wait();

    return {
      network,
      views,
      operatorIds,
      clusterId,
      clusterAfterEB,
    };
  }

  it("allows the owner to self-liquidate after an operator removal", async function () {
    const { network, operatorIds, clusterAfterEB } = await prepareScenario();

    await network.connect(clusterOwner).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB
    );
  });

  it("allows an EB decrease after an operator removal", async function () {
    const { network, operatorIds, clusterId, clusterAfterEB } = await prepareScenario();

    await networkHelpers.mine(1n);
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const root32 = computeEBRoot(clusterId, 32);

    await (await network.connect(oracle1).commitRoot(root32, blockNum)).wait();
    await (await network.connect(oracle2).commitRoot(root32, blockNum)).wait();
    await (await network.connect(oracle3).commitRoot(root32, blockNum)).wait();

    await network.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfterEB,
      32,
      []
    );
  });

  it("allows the last validator to be removed cleanly after an operator removal", async function () {
    const { network, operatorIds, clusterAfterEB } = await prepareScenario();

    await network.connect(clusterOwner).removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterEB
    );
  });

  it("allows third-party liquidation once the cluster becomes objectively liquidatable", async function () {
    const { network, views, operatorIds, clusterAfterEB } = await prepareScenario(true);

    let liquidatable = await views.isLiquidatable(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB
    );
    let attempts = 0;

    while (!liquidatable && attempts < 20) {
      await networkHelpers.mine(100000n);
      liquidatable = await views.isLiquidatable(
        clusterOwner.address,
        operatorIds,
        clusterAfterEB
      );
      attempts++;
    }

    expect(liquidatable).to.equal(true);

    await network.connect(liquidator).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB
    );
  });
});
