import { expect } from "chai";
import { getTestConnection } from "./setup/connection.js";
import { fullNetworkFixture } from "./setup/fixtures.js";

async function deployFullNetwork() {
  const { connection } = await getTestConnection();
  return fullNetworkFixture(connection);
}

describe("SSVNetwork – deployAll", function () {
  it("deploys full system", async function () {
    const { connection, networkHelpers } = await getTestConnection();

    const {
      network,
      modules,
      views,
    } = await networkHelpers.loadFixture(deployFullNetwork);

    expect(await views.ssvNetwork()).to.equal(
      await network.getAddress()
    );
  });
});