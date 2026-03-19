import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import { Errors } from "../common/errors.ts";

const MAX_DELEGATION_SLOTS = 4;

describe("replaceOracle() - InvalidOracleId boundary sanity", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let newOracle: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [, newOracle] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Accepts oracleId equal to MAX_DELEGATION_SLOTS (boundary)", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.replaceOracle(MAX_DELEGATION_SLOTS, newOracle.address);
  });

  it("Is reverted with 'InvalidOracleId' when oracleId is MAX_DELEGATION_SLOTS + 1", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.replaceOracle(MAX_DELEGATION_SLOTS + 1, newOracle.address)).to.be.revertedWithCustomError(
      dao,
      Errors.INVALID_ORACLE_ID,
    );
  });

  it("Is reverted with 'InvalidOracleId' when oracleId is far above MAX_DELEGATION_SLOTS", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.replaceOracle(100, newOracle.address)).to.be.revertedWithCustomError(
      dao,
      Errors.INVALID_ORACLE_ID,
    );
  });
});
