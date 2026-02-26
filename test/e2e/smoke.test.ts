import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.ts";
import { ssvNetworkFullFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
} from "../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
} from "../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  defaultVUnits,
  snapshotContractBalance,
} from "./helpers/index.ts";

describe("E2E Smoke Test", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  it("Deploys, registers, mines blocks, and computes fees correctly", async function () {
    const { network } =
      await networkHelpers.loadFixture(deployFixture);

    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const networkAddress = await network.getAddress();
    const balanceBefore = await snapshotContractBalance(provider, networkAddress);

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );

    const balanceAfter = await snapshotContractBalance(provider, networkAddress);
    expect(balanceAfter - balanceBefore).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    const blockBefore = await getBlockNumber(provider);

    await mineBlocks(provider, 10);

    const blockAfter = await getBlockNumber(provider);
    expect(blockAfter - blockBefore).to.equal(10);

    const vUnits = defaultVUnits(1n); // 1 validator, implicit EB
    const expectedBurn = calcClusterBurn({
      blockDiff: 10n,
      numOperators: 4n,
      ethFee: MINIMAL_OPERATOR_ETH_FEE,
      networkFee: NETWORK_FEE_ETH,
      effectiveVUnits: vUnits,
    });

    expect(expectedBurn).to.be.a("bigint");
    expect(expectedBurn).to.be.greaterThan(0n);
  });
});
