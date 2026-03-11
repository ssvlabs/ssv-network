import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultValidatorsFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, computeClusterId } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVClusters function `exitValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return defaultValidatorsFixture(connection);
  };

  it("Exits an existing validator and emits the correct event", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const tx = await validators.exitValidator(
      publicKey,
      operatorIds
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.VALIDATOR_EXIT]);

    await expect(tx).to.emit(validators, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKey);
  });

  it("Does not change operatorEthVUnits or stored cluster EB snapshot when exiting", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, 7n * VUNITS_PRECISION);

    const beforeClusterVUnits = await validators.getClusterVUnits(clusterId);
    const beforeOperatorVUnits = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    await validators.exitValidator(publicKey, operatorIds);

    const afterClusterVUnits = await validators.getClusterVUnits(clusterId);
    const afterOperatorVUnits = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    expect(afterClusterVUnits).to.equal(beforeClusterVUnits);
    expect(afterOperatorVUnits).to.deep.equal(beforeOperatorVUnits);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when validator was not registered", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const missingPk = makePublicKey(1);

    await expect(validators.exitValidator(
      missingPk,
      operatorIds
    )).to.be.revertedWithCustomError(validators, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  it("Calling exitValidator twice on the same validator succeeds both times without reverting", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    await validators.exitValidator(publicKey, operatorIds);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const validatorDataBeforeSecondExit = await validators.getValidatorData(publicKey, clusterOwner.address);
    const clusterVUnitsBeforeSecondExit = await validators.getClusterVUnits(clusterId);
    const operatorVUnitsBeforeSecondExit = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    const tx = await validators.exitValidator(publicKey, operatorIds);
    await expect(tx).to.emit(validators, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKey);

    const validatorDataAfterSecondExit = await validators.getValidatorData(publicKey, clusterOwner.address);
    const clusterVUnitsAfterSecondExit = await validators.getClusterVUnits(clusterId);
    const operatorVUnitsAfterSecondExit = await Promise.all(operatorIds.map((id) => validators.getOperatorEthVUnits(id)));

    expect(validatorDataAfterSecondExit).to.equal(validatorDataBeforeSecondExit);
    expect(clusterVUnitsAfterSecondExit).to.equal(clusterVUnitsBeforeSecondExit);
    expect(operatorVUnitsAfterSecondExit).to.deep.equal(operatorVUnitsBeforeSecondExit);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match the validator", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const mismatchedOperatorIds = [...operatorIds];
    mismatchedOperatorIds[0] = mismatchedOperatorIds[0] + 1n;

    await expect(validators.exitValidator(
      publicKey,
      mismatchedOperatorIds
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKey);
  });
});
