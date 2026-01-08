import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

describe("SSVDAO function `updateMinimumLiquidationCollateral()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the minimum liquidation collateral and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newCollateral = ethers.parseEther("1");

    const tx = await dao.updateMinimumLiquidationCollateral(newCollateral);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED)
      .withArgs(newCollateral);
  });

  it("Stores the new minimum liquidation collateral in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newCollateral = ethers.parseEther("2");

    await dao.updateMinimumLiquidationCollateral(newCollateral);

    const storedCollateral = await dao.getMinimumLiquidationCollateral();
    expect(storedCollateral).to.equal(newCollateral / 10_000_000n);
  });

  it("Can set minimum liquidation collateral to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMinimumLiquidationCollateral(ethers.parseEther("1"));
    const tx = await dao.updateMinimumLiquidationCollateral(0n);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED)
      .withArgs(0n);

    const storedCollateral = await dao.getMinimumLiquidationCollateral();
    expect(storedCollateral).to.equal(0n);
  });

  it("Can update from one collateral to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstCollateral = ethers.parseEther("1");
    const secondCollateral = ethers.parseEther("5");

    await dao.updateMinimumLiquidationCollateral(firstCollateral);
    const tx = await dao.updateMinimumLiquidationCollateral(secondCollateral);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED)
      .withArgs(secondCollateral);
  });
});

describe("SSVDAO function `updateMinimumLiquidationCollateralSSV()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the SSV minimum liquidation collateral and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newCollateral = ethers.parseEther("1");

    const tx = await dao.updateMinimumLiquidationCollateralSSV(newCollateral);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED_SSV)
      .withArgs(newCollateral);
  });

  it("Stores the new SSV minimum liquidation collateral in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newCollateral = ethers.parseEther("3");

    await dao.updateMinimumLiquidationCollateralSSV(newCollateral);

    const storedCollateral = await dao.getMinimumLiquidationCollateralSSV();
    expect(storedCollateral).to.equal(newCollateral / 10_000_000n);
  });

  it("Can set SSV minimum liquidation collateral to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMinimumLiquidationCollateralSSV(ethers.parseEther("1"));
    const tx = await dao.updateMinimumLiquidationCollateralSSV(0n);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED_SSV)
      .withArgs(0n);
  });
});
