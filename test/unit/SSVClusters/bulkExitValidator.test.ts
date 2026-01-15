import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { getClustersHarnessFixture, ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, makePublicKeys } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `bulkExitValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getClustersHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();

    deployClustersWith7Operators = getClustersHarnessFixture(connection, 7);
    deployClustersWith10Operators = getClustersHarnessFixture(connection, 10);
    deployClustersWith13Operators = getClustersHarnessFixture(connection, 13);
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

  it("Exits 10 validators with 4 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_4]);
  });

  it("Exits 10 validators with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_7]);
  });

  it("Exits 10 validators with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_10]);
  });

  it("Exits 10 validators with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await clusters.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await clusters.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_13]);
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
