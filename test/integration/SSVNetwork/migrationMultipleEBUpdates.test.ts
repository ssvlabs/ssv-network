import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

describe("ITEST-2 Integration: migration with multiple EB updates", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => ssvClustersHarnessFixture(connection);

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(
      coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance])
    );
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  const getMigratedToETHEventArgs = (clusters: any, receipt: any) => {
    for (const log of receipt.logs ?? []) {
      let parsed;
      try {
        parsed = clusters.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
        return parsed.args;
      }
    }
    throw new Error("ClusterMigratedToETH event not found");
  };

  it("Migrate after multiple EB updates uses the latest EB snapshot", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const ssvCluster = createCluster({
      validatorCount: 1n,
      index: 0n,
      networkFeeIndex: 0n,
      balance: 0n,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(1),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const root64 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root64);
    const updateTx1 = await clusters.updateClusterBalance(
      1,
      clusterOwner.address,
      operatorIds,
      ssvCluster,
      64,
      []
    );
    const updateReceipt1 = await updateTx1.wait();
    const clusterAfterUpdate1 = parseClusterFromEvent(clusters, updateReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const root96 = getEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(2, root96);
    const updateTx2 = await clusters.updateClusterBalance(
      2,
      clusterOwner.address,
      operatorIds,
      clusterAfterUpdate1,
      96,
      []
    );
    const updateReceipt2 = await updateTx2.wait();
    const clusterAfterUpdate2 = parseClusterFromEvent(clusters, updateReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    const latestVUnits = (96n * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(latestVUnits);

    const migrateTx = await clusters.migrateClusterToETH(operatorIds, clusterAfterUpdate2, {
      value: DEFAULT_ETH_REGISTER_VALUE,
    });
    const migrateReceipt = await migrateTx.wait();
    const migrationEvent = getMigratedToETHEventArgs(clusters, migrateReceipt);
    const migratedCluster = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(migrationEvent.effectiveBalance).to.equal(96);
    expect(migratedCluster.validatorCount).to.equal(1n);
    expect(migratedCluster.active).to.equal(true);
    expect(migratedCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    const baseline = 1n * VUNITS_PRECISION;
    const expectedDeviation = latestVUnits - baseline;

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(latestVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(latestVUnits);
    }
  });

  it("EB set then validators added: migration uses updated vUnits for new validator count", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const clusterWithOneValidator = createCluster({
      validatorCount: 1n,
      index: 0n,
      networkFeeIndex: 0n,
      balance: 0n,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(1),
      operatorIds,
      clusterOwner.address,
      clusterWithOneValidator
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const root64 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root64);
    await clusters.updateClusterBalance(
      1,
      clusterOwner.address,
      operatorIds,
      clusterWithOneValidator,
      64,
      []
    );

    const clusterWithTwoValidators = createCluster({
      validatorCount: 2n,
      index: 0n,
      networkFeeIndex: 0n,
      balance: 0n,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(2),
      operatorIds,
      clusterOwner.address,
      clusterWithTwoValidators
    );

    const root96 = getEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(2, root96);
    const updateTx2 = await clusters.updateClusterBalance(
      2,
      clusterOwner.address,
      operatorIds,
      clusterWithTwoValidators,
      96,
      []
    );
    const updateReceipt2 = await updateTx2.wait();
    const clusterAfterSecondUpdate = parseClusterFromEvent(clusters, updateReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (96n * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    const migrateTx = await clusters.migrateClusterToETH(operatorIds, clusterAfterSecondUpdate, {
      value: DEFAULT_ETH_REGISTER_VALUE,
    });
    const migrateReceipt = await migrateTx.wait();
    const migrationEvent = getMigratedToETHEventArgs(clusters, migrateReceipt);
    const migratedCluster = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(migrationEvent.effectiveBalance).to.equal(96);
    expect(migratedCluster.validatorCount).to.equal(2n);
    expect(migratedCluster.active).to.equal(true);
    expect(migratedCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    const expectedBaseline = 2n * VUNITS_PRECISION;
    const expectedDeviation = expectedVUnits - expectedBaseline;

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(expectedVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits);
    }
  });
});
