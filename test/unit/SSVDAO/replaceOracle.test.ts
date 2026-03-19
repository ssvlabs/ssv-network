import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVDAO function `replaceOracle()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let oldOracle: HardhatEthersSigner;
  let newOracle: HardhatEthersSigner;
  let otherOracle: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner, oldOracle, newOracle, otherOracle] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Replaces an oracle and emits OracleReplaced event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.mockSetOracle(1, oldOracle.address);

    const tx = await dao.replaceOracle(1, newOracle.address);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REPLACE_ORACLE]);

    await expect(tx)
      .to.emit(dao, Events.ORACLE_REPLACED)
      .withArgs(1, oldOracle.address, newOracle.address);
  });

  it("Updates oracle address in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.mockSetOracle(1, oldOracle.address);

    await dao.replaceOracle(1, newOracle.address);

    const storedOracle = await dao.getOracleAddress(1);
    expect(storedOracle).to.equal(newOracle.address);
  });

  it("Updates reverse mapping (oracleIdOf) correctly", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.mockSetOracle(1, oldOracle.address);

    await dao.replaceOracle(1, newOracle.address);

    const oldOracleId = await dao.getOracleId(oldOracle.address);
    expect(oldOracleId).to.equal(0);

    const newOracleId = await dao.getOracleId(newOracle.address);
    expect(newOracleId).to.equal(1);
  });

  it("Is reverted with 'InvalidOracleId' when oracle ID is zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.replaceOracle(0, newOracle.address))
      .to.be.revertedWithCustomError(dao, Errors.INVALID_ORACLE_ID);
  });

  it("Is reverted with 'ZeroAddress' when new oracle address is zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.replaceOracle(1, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(dao, Errors.ZERO_ADDRESS);
  });

  it("Is reverted with 'OracleAlreadyAssigned' when new oracle is already assigned to another ID", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.mockSetOracle(1, oldOracle.address);
    await dao.mockSetOracle(2, otherOracle.address);

    await expect(dao.replaceOracle(1, otherOracle.address))
      .to.be.revertedWithCustomError(dao, Errors.ORACLE_ALREADY_ASSIGNED);
  });

  it("Is reverted with 'SameOracleAddressNotAllowed' when replacing with same address", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.mockSetOracle(1, oldOracle.address);

    await expect(dao.replaceOracle(1, oldOracle.address))
      .to.be.revertedWithCustomError(dao, Errors.SAME_ORACLE_ADDRESS_NOT_ALLOWED);
  });

  it("Can replace an oracle with ID that had no previous address", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const tx = await dao.replaceOracle(1, newOracle.address);

    await expect(tx)
      .to.emit(dao, Events.ORACLE_REPLACED)
      .withArgs(1, ethers.ZeroAddress, newOracle.address);

    const storedOracle = await dao.getOracleAddress(1);
    expect(storedOracle).to.equal(newOracle.address);
  });
});
