import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvValidatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

const createCluster = () => ({
  ...EMPTY_CLUSTER,
  active: true,
});

describe("SSVClusters function `exitValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVValidatorsAndPrepareOperatorsFixture = async () => {
    return ssvValidatorsHarnessFixture(connection);
  };

  it("Exits an existing validator and emits the correct event", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    await expect(validators.exitValidator(
      publicKey,
      operatorIds
    )).to.emit(validators, Events.VALIDATOR_EXITED).withArgs(clusterOwner.address, operatorIds, publicKey);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when validator was not registered", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const missingPk = makePublicKey(1);

    await expect(validators.exitValidator(
      missingPk,
      operatorIds
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(missingPk);
  });

  it("Is reverted with 'IncorrectValidatorStateWithData' when operator ids do not match the validator", async function () {
    const { validators, operatorIds } =
      await networkHelpers.loadFixture(deploySSVValidatorsAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await validators.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const mismatchedOperatorIds = [...operatorIds];
    mismatchedOperatorIds[0] = mismatchedOperatorIds[0] + 1n; // alter first id

    await expect(validators.exitValidator(
      publicKey,
      mismatchedOperatorIds
    )).to.be.revertedWithCustomError(validators, Errors.INCORRECT_VALIDATOR_STATE_WITH_DATA).withArgs(publicKey);
  });
});
