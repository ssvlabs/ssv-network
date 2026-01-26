import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

type ClusterType = ReturnType<typeof createCluster>;

describe("SSVClusters function `updateClusterBalance()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  const registerCluster = async (clusters: any, operatorIds: bigint[]): Promise<ClusterType> => {
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await registerTx.wait();
    return parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
  };

  it("Is reverted with 'RootNotFound' when EB root is missing for the provided block", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    await expect(clusters.updateClusterBalance(
      1, // blockNum
      clusterOwner.address,
      operatorIds,
      cluster,
      32, // effectiveBalance
      [] // merkleProof
    )).to.be.revertedWithCustomError(clusters, Errors.ROOT_NOT_FOUND);
  });

  it("Updates cluster balance when proof is valid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds])
    );
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    const root = ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));

    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.UPDATE_CLUSTER_BALANCE]);
  });
});
