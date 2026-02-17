/**
 * Operator revert tests: OV-19 (operator-related reverts) and OV-21 (operator remove reverts).
 */

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

describe("Operator Reverts (OV-19 partial, OV-21)", () => {
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

  // ──── OV-19: Register Validator Revert Cases (operator-related subset) ────

  describe("OV-19: Register Validator — Operator Revert Cases", () => {
    it("OV-19a: reverts with OperatorAlreadyExists when registering operator with same pubkey", async function () {
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

    it("OV-19b: reverts with OperatorDoesNotExist when registering validator with removed operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 operators
      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        4,
      );

      // Whitelist the cluster owner BEFORE removing operator (whitelist checks ownership)
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      // Remove operator 1
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      // Try to register validator with removed operator
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

    it("OV-19c: reverts with CallerNotWhitelistedWithData when registering on private operator without whitelist", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 operators as private (registerOperators uses setPrivate=true)
      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        4,
      );

      // Do NOT whitelist clusterOwner
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

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

  // ──── OV-21: Operator Remove Revert Cases ────

  describe("OV-21: Operator Remove Revert Cases", () => {
    it("OV-21a: reverts with OperatorDoesNotExist when removing non-existent operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        network.connect(operatorOwner).removeOperator(999),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_DOES_NOT_EXIST,
      );
    });

    it("OV-21b: reverts with CallerNotOwnerWithData when non-owner tries to remove operator", async function () {
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

    it("OV-21c: reverts with OperatorDoesNotExist when removing already-removed operator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        1,
      );

      // First removal succeeds
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // Second removal reverts — ethSnapshot.block == 0 && snapshot.block == 0
      await expect(
        network.connect(operatorOwner).removeOperator(operatorIds[0]),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATOR_DOES_NOT_EXIST,
      );
    });
  });
});
