import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `updateExecuteOperatorFeePeriod()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the execute operator fee period and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 604800n;

    const tx = await dao.updateExecuteOperatorFeePeriod(newPeriod);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD]);

    await expect(tx)
      .to.emit(dao, Events.EXECUTE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(newPeriod);
  });

  it("Stores the new execute operator fee period in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 86400n;

    await dao.updateExecuteOperatorFeePeriod(newPeriod);

    const storedPeriod = await dao.getExecuteOperatorFeePeriod();
    expect(storedPeriod).to.equal(newPeriod);
  });

  it("Can set execute period to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateExecuteOperatorFeePeriod(86400n);
    const tx = await dao.updateExecuteOperatorFeePeriod(0n);

    await expect(tx)
      .to.emit(dao, Events.EXECUTE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(0n);

    const storedPeriod = await dao.getExecuteOperatorFeePeriod();
    expect(storedPeriod).to.equal(0n);
  });

  it("Can update from one period to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstPeriod = 86400n;
    const secondPeriod = 259200n;

    await dao.updateExecuteOperatorFeePeriod(firstPeriod);
    const tx = await dao.updateExecuteOperatorFeePeriod(secondPeriod);

    await expect(tx)
      .to.emit(dao, Events.EXECUTE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(secondPeriod);

    const storedPeriod = await dao.getExecuteOperatorFeePeriod();
    expect(storedPeriod).to.equal(secondPeriod);
  });
});
