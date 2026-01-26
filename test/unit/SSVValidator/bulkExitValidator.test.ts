import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvValidatorsHarnessFixture, getValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, makePublicKeys } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVClusters function `bulkExitValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getValidatorsHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getValidatorsHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();

    deployClustersWith7Operators = getValidatorsHarnessFixture(connection, 7);
    deployClustersWith10Operators = getValidatorsHarnessFixture(connection, 10);
    deployClustersWith13Operators = getValidatorsHarnessFixture(connection, 13);
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return ssvValidatorsHarnessFixture(connection);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  it("Exits multiple validators and emits events", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.bulkExitValidator(publicKeys, operatorIds);

    await expect(tx).to.emit(validators, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKeys[0]);
    await expect(tx).to.emit(validators, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKeys[1]);
  });

  it("Does not change operatorEthVUnits or stored cluster EB snapshot when bulk exiting", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 9n * VUNITS_PRECISION);

    const beforeClusterVUnits = await validators.getClusterVUnits(clusterId);
    const beforeOperatorVUnits = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    await validators.bulkExitValidator(publicKeys, operatorIds);

    const afterClusterVUnits = await validators.getClusterVUnits(clusterId);
    const afterOperatorVUnits = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    expect(afterClusterVUnits).to.equal(beforeClusterVUnits);
    expect(afterOperatorVUnits).to.deep.equal(beforeOperatorVUnits);
  });

  it("Exits 10 validators with 4 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_4]);
  });

  it("Exits 10 validators with 7 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_7]);
  });

  it("Exits 10 validators with 10 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_10]);
  });

  it("Exits 10 validators with 13 operators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.bulkExitValidator(publicKeys, operatorIds);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.BULK_EXIT_10_VALIDATOR_13]);
  });

  it("Is reverted with 'ValidatorDoesNotExist' when no public keys are provided", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    await expect(validators.bulkExitValidator(
      [],
      operatorIds
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when any validator is not registered", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await validators.registerValidator(
      publicKeys[0],
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    await expect(validators.bulkExitValidator(
      publicKeys,
      operatorIds
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKeys[1]);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match stored validators", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      [DEFAULT_SHARES, DEFAULT_SHARES],
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const mismatchedOperatorIds = [...operatorIds];
    mismatchedOperatorIds[0] = mismatchedOperatorIds[0] + 1n;

    await expect(validators.bulkExitValidator(
      publicKeys,
      mismatchedOperatorIds
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKeys[0]);
  });
});
