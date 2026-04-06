import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  setupTestContext,
  computeClusterId,
  computeEBRoot,
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../common/helpers.ts";
import { DEFAULT_SHARES, DEFAULT_ETH_REGISTER_VALUE, ETH_DEDUCTED_DIGITS } from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";

const OPERATOR_FEE_WEI = 100_000n * ETH_DEDUCTED_DIGITS;

describe("stale snapshot replay matrix", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

  const deployFixture = async () => ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE_WEI);

  async function registerValidator(clusters: any, operatorIds: bigint[], pubKeySeed: number, cluster = createCluster()) {
    const tx = await clusters.connect(clusterOwner).registerValidator(
      makePublicKey(pubKeySeed),
      operatorIds,
      DEFAULT_SHARES,
      cluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    return parseClusterFromEvent(clusters, await tx.wait(), Events.VALIDATOR_ADDED);
  }

  async function updateEB(clusters: any, operatorIds: bigint[], cluster: any, effectiveBalance: number, blockNum: number) {
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetEBRoot(blockNum, computeEBRoot(clusterId, effectiveBalance));
    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    return parseClusterFromEvent(clusters, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);
  }

  it("stale caller-supplied cluster is rejected on repeated updateClusterBalance", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);

    const clusterAfterRegister = await registerValidator(clusters, operatorIds, 1001);
    const staleCluster = { ...clusterAfterRegister };
    const clusterAfter64 = await updateEB(clusters, operatorIds, clusterAfterRegister, 64, 1);
    expect(clusterAfter64.active).to.equal(true);

    await clusters.mockSetEBRoot(2, computeEBRoot(computeClusterId(clusterOwner.address, operatorIds), 128));
    await expect(
      clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, staleCluster, 128, [])
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("liquidation rejects stale pre-mutation cluster snapshot", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const clusterAfterRegister = await registerValidator(clusters, operatorIds, 1002);
    const clusterAfter64 = await updateEB(clusters, operatorIds, clusterAfterRegister, 64, 1);
    const stalePreMutation = { ...clusterAfter64 };

    const depositTx = await clusters.deposit(clusterOwner.address, operatorIds, clusterAfter64, { value: DEFAULT_ETH_REGISTER_VALUE });
    parseClusterFromEvent(clusters, await depositTx.wait(), Events.CLUSTER_DEPOSITED);

    await expect(
      clusters.liquidate(clusterOwner.address, operatorIds, stalePreMutation)
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("removeValidator rejects stale snapshot after a successful fresh removal", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);

    const clusterAfterReg1 = await registerValidator(clusters, operatorIds, 1003);
    const clusterAfterReg2 = await registerValidator(clusters, operatorIds, 1004, clusterAfterReg1);
    const staleBeforeFirstRemove = { ...clusterAfterReg2 };

    const removeFirstTx = await clusters.removeValidator(makePublicKey(1003), operatorIds, clusterAfterReg2);
    parseClusterFromEvent(clusters, await removeFirstTx.wait(), Events.VALIDATOR_REMOVED);

    await expect(
      clusters.removeValidator(makePublicKey(1004), operatorIds, staleBeforeFirstRemove)
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("reactivate rejects stale active snapshot after liquidation", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const clusterAfterRegister = await registerValidator(clusters, operatorIds, 1005);
    const clusterAfter64 = await updateEB(clusters, operatorIds, clusterAfterRegister, 64, 1);
    const staleActiveCluster = { ...clusterAfter64 };

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfter64);
    parseClusterFromEvent(clusters, await liquidateTx.wait(), Events.CLUSTER_LIQUIDATED);

    await expect(
      clusters.reactivate(operatorIds, staleActiveCluster, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("removeValidator rejects stale EB=64 snapshot after EB=128 update", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);

    const validatorPubKey = makePublicKey(1006);
    const registerTx = await clusters.registerValidator(
      validatorPubKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);

    const clusterAfter64 = await updateEB(clusters, operatorIds, clusterAfterRegister, 64, 1);
    const staleEb64Cluster = { ...clusterAfter64 };
    await updateEB(clusters, operatorIds, clusterAfter64, 128, 2);

    await expect(
      clusters.removeValidator(validatorPubKey, operatorIds, staleEb64Cluster)
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("liquidate replay with stale pre-liquidation snapshot fails cleanly", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const clusterAfterRegister = await registerValidator(clusters, operatorIds, 1007);
    const clusterAfter64 = await updateEB(clusters, operatorIds, clusterAfterRegister, 64, 1);
    const stalePreLiquidation = { ...clusterAfter64 };

    const firstLiqTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfter64);
    parseClusterFromEvent(clusters, await firstLiqTx.wait(), Events.CLUSTER_LIQUIDATED);

    await expect(
      clusters.liquidate(clusterOwner.address, operatorIds, stalePreLiquidation)
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });
});
