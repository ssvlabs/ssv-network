import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../setup/connection.js';
import { ssvValidatorsHarnessFixture } from '../setup/fixtures.js';
import type { NetworkHelpersType } from '../common/types.js';
import { createCluster, makePublicKey, parseClusterFromEvent } from '../common/helpers.js';
import { DEFAULT_SHARES, ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR } from '../common/constants.js';
import { Events } from '../common/events.js';
import { Errors } from '../common/errors.js';
import { ethers } from "ethers";

const OPERATOR_FEE = ETH_DEDUCTED_DIGITS;

const MINIMUM_BLOCKS = 1000n;
const START_V_UNITS = 2n * BPS_DENOMINATOR;

describe("SSV-3: bulkRegisterValidator uses post-registration vUnits for liquidation check", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const deployWithFeeAndParams = async () => {
    const result = await ssvValidatorsHarnessFixture(connection, 4, OPERATOR_FEE);
    const { validators } = result;

    await validators.mockEthNetworkFee(0n);
    await validators.mockMinimumBlocksBeforeLiquidation(MINIMUM_BLOCKS);
    await validators.mockMinimumLiquidationCollateral(0n);

    return result;
  };

  it("Reverts with InsufficientBalance when deposit covers old vUnits but not post-registration vUnits", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployWithFeeAndParams);

    const initialDeposit = 1_000_000_000n;
    const regTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: initialDeposit }
    );
    const regReceipt = await regTx.wait();
    const existingCluster = parseClusterFromEvent(validators, regReceipt, Events.VALIDATOR_ADDED);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, START_V_UNITS);

    await expect(
      validators.bulkRegisterValidator(
        [makePublicKey(2)],
        operatorIds,
        [DEFAULT_SHARES],
        existingCluster,
        { value: 0n }
      )
    ).to.be.revertedWithCustomError(validators, Errors.INSUFFICIENT_BALANCE);
  });

  it("Succeeds when deposit is sufficient for post-registration vUnits", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployWithFeeAndParams);

    const initialDeposit = 2_000_000_000n;
    const regTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: initialDeposit }
    );
    const regReceipt = await regTx.wait();
    const existingCluster = parseClusterFromEvent(validators, regReceipt, Events.VALIDATOR_ADDED);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await validators.mockSetClusterVUnits(clusterId, START_V_UNITS);

    await expect(
      validators.bulkRegisterValidator(
        [makePublicKey(2)],
        operatorIds,
        [DEFAULT_SHARES],
        existingCluster,
        { value: 0n }
      )
    ).to.emit(validators, Events.VALIDATOR_ADDED);
  });

  it("Implicit EB clusters (vUnits == 0 in storage) are unaffected", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployWithFeeAndParams);

    const initialDeposit = 2_000_000_000n;
    const regTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: initialDeposit }
    );
    const regReceipt = await regTx.wait();
    const existingCluster = parseClusterFromEvent(validators, regReceipt, Events.VALIDATOR_ADDED);

    await expect(
      validators.bulkRegisterValidator(
        [makePublicKey(2)],
        operatorIds,
        [DEFAULT_SHARES],
        existingCluster,
        { value: 0n }
      )
    ).to.emit(validators, Events.VALIDATOR_ADDED);
  });
});
