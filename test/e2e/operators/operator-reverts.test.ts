import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";

describe("Operator Reverts", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, otherAccount] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };


  describe("Register Validator — Operator Revert Cases", () => {
    it("Reverts with OperatorAlreadyExists when registering operator with same pubkey", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false);

      await expect(
        network
          .connect(operatorOwner)
          .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_ALREADY_EXISTS,
      );
    });

    it("Reverts with OperatorDoesNotExist when registering validator with removed operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        4,
      );

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_DOES_NOT_EXIST,
      );
    });

    it("Reverts with CallerNotWhitelistedWithData when registering on private operator without whitelist", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        4,
      );

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.CALLER_NOT_WHITELISTED,
      );
    });
  });


  describe("Operator Remove Revert Cases", () => {
    it("Reverts with OperatorDoesNotExist when removing non-existent operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(operatorOwner).removeOperator(999),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_DOES_NOT_EXIST,
      );
    });

    it("Reverts with CallerNotOwnerWithData when non-owner tries to remove operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        1,
      );

      await expect(
        network.connect(otherAccount).removeOperator(operatorIds[0]),
      ).to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER);
    });

    it("Reverts with OperatorDoesNotExist when removing already-removed operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        1,
      );

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await expect(
        network.connect(operatorOwner).removeOperator(operatorIds[0]),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_DOES_NOT_EXIST,
      );
    });
  });
});
