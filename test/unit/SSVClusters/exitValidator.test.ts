import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `exitValidator()`", async () => {
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

  it("Exits an existing validator and emits the correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.exitValidator(
      publicKey,
      operatorIds
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.VALIDATOR_EXIT]);

    await expect(tx).to.emit(clusters, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKey);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when validator was not registered", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const missingPk = makePublicKey(1);

    await expect(clusters.exitValidator(
      missingPk,
      operatorIds
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(missingPk);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match the validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const mismatchedOperatorIds = [...operatorIds];
    mismatchedOperatorIds[0] = mismatchedOperatorIds[0] + 1n; // alter first id

    await expect(clusters.exitValidator(
      publicKey,
      mismatchedOperatorIds
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKey);
  });
});
