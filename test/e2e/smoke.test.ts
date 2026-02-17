/**
 * Smoke test: proves e2e infrastructure compiles and runs.
 * Deploys contracts, registers operators + validator, advances blocks,
 * and verifies fee calculator produces a non-zero result.
 */

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

  it("deploys, registers, mines blocks, and computes fees correctly", async function () {
    const { network, views, ssvToken } =
      await networkHelpers.loadFixture(deployFixture);

    const provider = connection.ethers.provider;

    // 1. Register 4 operators
    const operatorIds = await registerOperators(network, operatorOwner, 4);

    // 2. Whitelist the cluster owner and register 1 validator with ETH deposit
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Fund the cluster owner with enough ETH
    await provider.send("hardhat_setBalance", [
      clusterOwner.address,
      "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
    ]);

    // Snapshot contract balance before registration
    const networkAddress = await network.getAddress();
    const balanceBefore = await snapshotContractBalance(provider, networkAddress);

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );

    // Verify contract received ETH
    const balanceAfter = await snapshotContractBalance(provider, networkAddress);
    expect(balanceAfter - balanceBefore).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    // 3. Get block number before mining
    const blockBefore = await getBlockNumber(provider);

    // 4. Advance 10 blocks
    await mineBlocks(provider, 10);

    const blockAfter = await getBlockNumber(provider);
    expect(blockAfter - blockBefore).to.equal(10);

    // 5. Use calcClusterBurn to compute expected fees
    const vUnits = defaultVUnits(1n); // 1 validator, implicit EB
    const expectedBurn = calcClusterBurn({
      blockDiff: 10n,
      numOperators: 4n,
      ethFee: MINIMAL_OPERATOR_ETH_FEE,
      networkFee: NETWORK_FEE_ETH,
      effectiveVUnits: vUnits,
    });

    // 6. Verify the computed value is a non-zero bigint (sanity check)
    expect(expectedBurn).to.be.a("bigint");
    expect(expectedBurn).to.be.greaterThan(0n);
  });
});
