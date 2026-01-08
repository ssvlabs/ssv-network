import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

const createCluster = () => ({
  ...EMPTY_CLUSTER,
  active: true,
});

describe("SSVClusters function `bulkExitValidator()`", async () => {
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

  it("Exits multiple validators and emits events", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.bulkExitValidator(publicKeys, operatorIds);

    await expect(tx).to.emit(clusters, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKeys[0]);
    await expect(tx).to.emit(clusters, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKeys[1]);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when no public keys are provided", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkExitValidator(
      [],
      operatorIds
    )).to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when any validator is not registered", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await clusters.registerValidator(
      publicKeys[0],
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    await expect(clusters.bulkExitValidator(
      publicKeys,
      operatorIds
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKeys[1]);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match stored validators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const mismatchedOperatorIds = [...operatorIds];
    mismatchedOperatorIds[0] = mismatchedOperatorIds[0] + 1n;

    await expect(clusters.bulkExitValidator(
      publicKeys,
      mismatchedOperatorIds
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKeys[0]);
  });
});
