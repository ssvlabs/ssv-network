import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../setup/connection.ts';
import { ssvNetworkFullFixture } from '../setup/fixtures.ts';
import type { NetworkHelpersType, OperatorTuple } from '../common/types.ts';
import {
  addValidatorsToCluster,
  calculateInitialBurnRate,
  getCurrentClusterState, makeArrayOfKeysAndShares,
  makeOperatorKey,
  makePublicKey, registerDefaultCluster,
  registerOperators,
  whitelistAddresses,
} from '../common/helpers.ts';
import {
  CLUSTER_VERSION_ETH,
  DECLARE_OPERATOR_FEE_PERIOD,
  DEFAULT_ETH_EB_PER_VALIDATOR,
  DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ORACLES_IDS,
  DEFAULT_SHARES, DEFAULT_UNSTAKE_COOLDOWN,
  EMPTY_CLUSTER,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMAL_OPERATOR_ETH_FEE,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  OPERATOR_MAX_FEE_INCREASE, STAKE_AMOUNT, NETWORK_FEE,
} from '../common/constants.ts';
import { Events } from '../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../common/errors.js';
import { deployContract } from '../../scripts/common/helpers.js';
import { ContractTransactionResponse } from 'ethers';
import * as net from 'node:net';
import { trackGasFromReceipt, GasGroup } from '../helpers/gas-usage.ts';

describe("SSVNetwork full integration tests", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Constructor, initializer and upgrades", async function () {
    it("Configures SSVNetwork correctly", async function () {
      const { network, views, cssvToken, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      expect(await network.getAddress()).to.be.properAddress;
      expect(await views.getAddress()).to.be.properAddress;
      expect(await cssvToken.getAddress()).to.be.properAddress;
      expect(await ssvToken.getAddress()).to.be.properAddress;

      const version = await network.getVersion();
      expect(version).to.be.a("string").and.not.empty;

      expect(await views.getMinimumLiquidationCollateral()).to.equal(1_000_000_000_000_000_000n);
      expect(await views.getValidatorsPerOperatorLimit()).to.equal(3000n);
      expect(await views.getOperatorFeePeriods()).to.deep.equal([604800n, 604800n]); // declare, execute
      expect(await views.getOperatorFeeIncreaseLimit()).to.equal(1000n); // 10%
      expect(await views.getDefaultOracleIds()).to.deep.equal([1n, 2n, 3n, 4n]);
      expect(await views.getQuorumBps()).to.equal(7500n);

      expect(await views.getNetworkFee()).to.equal(382640000000n);
      expect(await views.getNetworkFeeSSV()).to.equal(382640000000n);
      expect(await views.getMaximumOperatorFee()).to.equal(76528650000000n);

      expect(await views.cooldownDuration()).to.equal(7n * 24n * 60n * 60n);

      expect(await views.getNetworkEarnings()).to.equal(0n);
      expect(await views.getNetworkEarningsSSV()).to.equal(0n);
      expect(await views.getNetworkValidatorsCount()).to.equal(0);
      expect(await views.totalStaked()).to.equal(0n);
    });
  });

  describe("Function 'registerOperator()'", async function () {
    it("Creates new operator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);

      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      const tx = await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_OPERATOR]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_ADDED).withArgs(expectedId, operatorOwner.address, operatorKey, MINIMAL_OPERATOR_ETH_FEE)
        .and.to.emit(network, Events.OPERATOR_PRIVACY_STATUS_UPDATED).withArgs([expectedId], true);

      expect(await views.getOperatorFee(expectedId)).to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
      expect(await views.getOperatorFeeSSV(expectedId)).to.be.equal(0);
      expect(await views.getOperatorDeclaredFee(expectedId)).to.be.deep.equal([false, 0n, 0n, 0n]);
      expect(await views.getOperatorById(expectedId)).to.be.deep.equal([
        operatorOwner.address,
        MINIMAL_OPERATOR_ETH_FEE,
        0,
        connection.ethers.ZeroAddress,
        true,
        true
        ]);
      expect(await views.getOperatorByIdSSV(expectedId)).to.be.deep.equal([
        operatorOwner.address,
        0,
        0,
        connection.ethers.ZeroAddress,
        true,
        true
      ]);
    });

    it("Is reverted with 'FeeTooLow' if the provided fee is less than minimal allowed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE - 1n, true))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
    });

    it("Is reverted with 'FeeTooHigh' if the provided fee is higher than maximum allowed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MAXIMUM_OPERATORS_FEE + 1n, true))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
    });

    it("Is reverted with 'OperatorAlreadyExists' if the public key is already registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_ALREADY_EXISTS);
    });
  });

  describe("Function 'removeOperator()'", async function (){
    it("Deactivates the operator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      const tx = await network.removeOperator(expectedId);

      expect(tx)
        .to.emit(network, Events.OPERATOR_REMOVED)
        .withArgs(expectedId)
        
        const receipt = await tx.wait();
        await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR]);
  
      const operator: OperatorTuple = await views.getOperatorById(expectedId)

      // todo check how to make typed, maybe cast to object like cluster
      expect(operator[5]).to.be.equal(false)
      expect(await views.getOperatorFee(expectedId)).to.be.equal(0);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator with passed id is not registered", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperator(12345n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.connect(randomUser).removeOperator(expectedId))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });
  });

  describe("Function 'setOperatorsWhitelists()'", async function () {
    it("Whitelists addresses and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      expect(await network.setOperatorsWhitelists([expectedId], [clusterOwner]))
        .to.emit(network, Events.OPERATOR_MULTIPLE_WHITELIST_UPDATED)
        .withArgs([expectedId], [clusterOwner]);

      expect(await views.getWhitelistedOperators([expectedId], clusterOwner)).to.be.deep.equal([1n]); //true
    });

    it("Whitelists multiple operators for multiple addresses", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 10);
      const whitelistAddresses = Array(10).fill(clusterOwner.address);

      const tx = await network.setOperatorsWhitelists(operatorIds, whitelistAddresses);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10]);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsWhitelists([], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH)
    });

    it("Is reverted with 'InvalidWhitelistAddressesLength' if the array of addresses is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsWhitelists([123], []))
        .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELIST_ADDRESSES_LENGTH)
    });

    it("Is reverted with 'ZeroAddressNotAllowed' if one of addresses is zero address", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.setOperatorsWhitelists([expectedId], [connection.ethers.ZeroAddress]))
        .to.be.revertedWithCustomError(network, Errors.ZERO_ADDRESS_NOT_ALLOWED)
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsWhitelists([123], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.connect(randomUser).setOperatorsWhitelists([expectedId], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });

    it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicate", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.setOperatorsWhitelists([expectedId, expectedId], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
    });

    it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network,operatorOwner, 3);
      const lastOp = operatorIds.pop();
      operatorIds.unshift(lastOp!);

      await expect(network.setOperatorsWhitelists(operatorIds, [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
    });
  });

  describe("Function 'removeOperatorsWhitelists()'", async function(){
    it("Removes addresses from the whitelist and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.setOperatorsWhitelists([expectedId], [clusterOwner])

      expect(await network.removeOperatorsWhitelists([expectedId], [clusterOwner]))
        .to.emit(network, Events.OPERATOR_MULTIPLE_WHITELIST_REMOVED)
        .withArgs([expectedId], [clusterOwner]);

      expect(await views.getWhitelistedOperators([expectedId], clusterOwner)).to.be.deep.equal([]); //false
    });

    it("Removes multiple operators for multiple addresses", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 10);
      const whitelistAddresses = Array(10).fill(clusterOwner.address);

      await network.setOperatorsWhitelists(operatorIds, whitelistAddresses);

      const tx = await network.removeOperatorsWhitelists(operatorIds, whitelistAddresses);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10]);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperatorsWhitelists([], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH)
    });

    it("Is reverted with 'InvalidWhitelistAddressesLength' if the array of addresses is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperatorsWhitelists([123], []))
        .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELIST_ADDRESSES_LENGTH)
    });

    it("Is reverted with 'ZeroAddressNotAllowed' if one of addresses is zero address", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.removeOperatorsWhitelists([expectedId], [connection.ethers.ZeroAddress]))
        .to.be.revertedWithCustomError(network, Errors.ZERO_ADDRESS_NOT_ALLOWED)
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperatorsWhitelists([123], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.connect(randomUser).removeOperatorsWhitelists([expectedId], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });

    it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicate", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

      await expect(network.removeOperatorsWhitelists([expectedId, expectedId], [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
    });

    it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network,operatorOwner, 3);
      const lastOp = operatorIds.pop();
      operatorIds.unshift(lastOp!);

      await expect(network.removeOperatorsWhitelists(operatorIds, [clusterOwner]))
        .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
    });
  });

  describe("Function 'setOperatorsWhitelistingContract()'", async function () {
    it("Registers whitelisting contract, emits correct event and allows to whitelist addresses via contract", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network,operatorOwner, 3);
      const { contract: whiteListingContract, address: contractAddress } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      const tx = await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT]);

      expect(tx)
        .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
        .withArgs(operatorIds, contractAddress);

      expect(await views.isWhitelistingContract(contractAddress)).to.be.equal(true);

      await whiteListingContract.addWhitelistedAddress(clusterOwner);

      expect(await views.isAddressWhitelistedInWhitelistingContract(clusterOwner, operatorIds[0], contractAddress))
        .to.be.equal(true);
    });

    it("Updates whitelisting contract for operators", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 3);
      const { contract: firstContract, address: firstAddress } =
        await deployContract(connection.ethers, "BasicWhitelisting");
      const { contract: secondContract, address: secondAddress } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      await network.setOperatorsWhitelistingContract(operatorIds, firstContract);

      const tx = await network.setOperatorsWhitelistingContract(operatorIds, secondContract);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.UPDATE_OPERATOR_WHITELISTING_CONTRACT]);

      await expect(tx)
        .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
        .withArgs(operatorIds, secondAddress);

      expect(firstAddress).to.not.equal(secondAddress);
    });

    it("Registers whitelisting contract for 10 operators", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 10);
      const { contract: whiteListingContract } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      const tx = await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT_10]);
    });

    it("Is reverted with 'InvalidWhitelistingContract' if the contract does not support required interface", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { address: contractAddress } = await deployContract(connection.ethers, "SSVOperatorsWhitelist");
      const operatorIds = await registerOperators(network,operatorOwner, 3);

      expect(network.setOperatorsWhitelistingContract(operatorIds, contractAddress))
        .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELISTING_CONTRACT)
        .withArgs(contractAddress);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' is the array of operators is empty", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");

      await expect(network.setOperatorsWhitelistingContract([], contractAddress))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");

      await expect(network.setOperatorsWhitelistingContract([12345n], contractAddress))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
      const operatorIds = await registerOperators(network,operatorOwner, 3);

      await expect(network.connect(randomUser).setOperatorsWhitelistingContract(operatorIds, contractAddress))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address)
    });
  });

  describe("Function 'removeOperatorsWhitelistingContract()'", async function(){
    it("Removes whitelisting address and emits correct event", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network,operatorOwner, 3);
      const { contract: whiteListingContract } =
        await deployContract(connection.ethers, "BasicWhitelisting");
      await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);

      const tx = await network.removeOperatorsWhitelistingContract(operatorIds);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT]);

      expect(tx)
        .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
        .withArgs(operatorIds, connection.ethers.ZeroAddress);
    });

    it("Removes whitelisting contract for 10 operators", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 10);
      const { contract: whiteListingContract } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);

      const tx = await network.removeOperatorsWhitelistingContract(operatorIds);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT_10]);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperatorsWhitelistingContract([]))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.removeOperatorsWhitelistingContract([12345n]))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(randomUser).removeOperatorsWhitelistingContract(operatorIds))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address)
    });
  });

  describe("Function 'setOperatorsPrivateUnchecked()'", async function() {
    it("Changes privacy status and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      expect(await network.setOperatorsPrivateUnchecked(operatorIds))
        .to.emit(network, Events.OPERATORS_PRIVACY_STATUS_UPDATED)
        .withArgs(operatorIds, true);

      const operator: OperatorTuple = await views.getOperatorById(operatorIds[0]);
      // todo type
      expect(operator[4]).to.be.equal(true); //isPrivate
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsPrivateUnchecked([]))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsPrivateUnchecked([12345n]))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.connect(randomUser).setOperatorsPrivateUnchecked(operatorIds))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner);
    });
  });

  describe("Function 'setOperatorsPublicUnchecked()'", async function () {
    it("Changes privacy status and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      expect(await network.setOperatorsPublicUnchecked(operatorIds))
        .to.emit(network, Events.OPERATORS_PRIVACY_STATUS_UPDATED)
        .withArgs(operatorIds, false);

      const operator: OperatorTuple = await views.getOperatorById(operatorIds[0]);
      // todo type
      expect(operator[4]).to.be.equal(false); //isPrivate
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsPublicUnchecked([]))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.setOperatorsPublicUnchecked([12345n]))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.connect(randomUser).setOperatorsPublicUnchecked(operatorIds))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner);
    });
  });

  describe("Function 'declareOperatorFee()'", async function() {
    it("Declares new fee and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const newFee: bigint = MINIMAL_OPERATOR_ETH_FEE * 2n;

      const tx: ContractTransactionResponse = await network.declareOperatorFee(operatorIds[0], newFee)
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DECLARE_OPERATOR_FEE]);
      const block = await tx.getBlock();

      const expectedBegin = BigInt(block!.timestamp) + DECLARE_OPERATOR_FEE_PERIOD;
      const expectedEnd = expectedBegin + EXECUTE_OPERATOR_FEE_PERIOD;

      await expect(tx)
        .to.emit(network, Events.OPERATOR_FEE_DECLARED)
        .withArgs(operatorOwner.address, operatorIds[0], tx.blockNumber, newFee);

      // todo type
      expect(await views.getOperatorDeclaredFee(operatorIds[0]))
        .to.be.deep.equal([
          true, // isActive
          newFee, // declaredFee
          expectedBegin,
          expectedEnd
      ]);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

      await expect(network.declareOperatorFee(12345n, newFee))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

      await expect(network.connect(randomUser).declareOperatorFee(operatorIds[0], newFee))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner);
    });

    it("Is reverted with 'FeeTooLow' is the passed fee is less than minimal", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE - 1n))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
    });

    it("Is reverted with 'SameFeeChangeNotAllowed' is the passed value is the same as current one", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.SAME_FEE_CHANGE_NOW_ALLOWED);
    });

    it("Is reverted with 'SameFeeChangeNotAllowed' is the passed value is the same as current one", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.SAME_FEE_CHANGE_NOW_ALLOWED);
    });

    it("Is reverted with 'FeeTooHigh' if the new fee is higher than allowed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.declareOperatorFee(operatorIds[0], MAXIMUM_OPERATORS_FEE + 1n))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
    });

    it("Is reverted with 'FeeExceedsIncreaseLimit' if the new fee exceeds the allowed limit", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const exceedingFee = MINIMAL_OPERATOR_ETH_FEE * 3n;

      await expect(network.declareOperatorFee(operatorIds[0], exceedingFee))
        .to.be.revertedWithCustomError(network, Errors.FEE_EXCEEDS_INCREASE_LIMIT);
    });

    it("Is reverted with 'FeeIncreaseNotAllowed' if operators current fee is zero", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);
      const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, 0, true);

      await expect(network.declareOperatorFee(expectedId, MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });
  });

  describe("Function 'cancelDeclaredOperatorFee()'", async function(){
    it("Cancels declared fee and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)

      const tx = await network.cancelDeclaredOperatorFee(operatorIds[0]);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.CANCEL_OPERATOR_FEE]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_FEE_DECLARATION_CANCELLED)
        .withArgs(operatorOwner, operatorIds[0]);

      expect(await views.getOperatorDeclaredFee(operatorIds[0]))
        .to.be.deep.equal([
        false, // isActive
        0n,
        0n,
        0n
      ]);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.cancelDeclaredOperatorFee(12345n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)

      await expect(network.connect(randomUser).cancelDeclaredOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner);
    });

    it("Is reverted with 'NoFeeDeclared' if no declarations were done before", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.cancelDeclaredOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
    });
  });

  describe("Function 'executeOperatorFee()'", async function() {
    it("Updates operator fee according to a declared one and emits the correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)

      await connection.networkHelpers.time.increase(EXECUTE_OPERATOR_FEE_PERIOD + 1n);
      await connection.networkHelpers.mine();

      const tx = await network.executeOperatorFee(operatorIds[0]);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.EXECUTE_OPERATOR_FEE]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_FEE_EXECUTED);

      expect(await views.getOperatorFee(operatorIds[0])).to.be.equal(MINIMAL_OPERATOR_ETH_FEE * 2n);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.executeOperatorFee(12345n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)

      await expect(network.connect(randomUser).executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });

    it("Is reverted with 'NoFeeDeclared' if no declarations were done before", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);

      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
    });

    it("Is reverted with 'ApprovalNotWithinTimeframe' if execution period is not started or ended", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)

      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);

      await connection.networkHelpers.time.increase(EXECUTE_OPERATOR_FEE_PERIOD * 2n);
      await connection.networkHelpers.mine();

      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);
    });

    it("Is reverted with 'FeeTooHigh' if the maximum fee changed during the execution period", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n)
      await network.updateMaximumOperatorFee(MINIMAL_OPERATOR_ETH_FEE + 1n);

      await connection.networkHelpers.time.increase(EXECUTE_OPERATOR_FEE_PERIOD + 1n);
      await connection.networkHelpers.mine();

      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
    });
  });

  describe("Function 'updateMaximumOperatorFee()'", async function(){
    it("Updates maximum fee and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE * 2n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_MAXIMUM_FEE_UPDATED);

      expect(await views.getMaximumOperatorFee())
        .to.be.equal(MAXIMUM_OPERATORS_FEE * 2n);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if the caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE * 2n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateMaximumOperatorFeeSSV()'", async function(){
    it("Updates maximum fee and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(await network.updateMaximumOperatorFeeSSV(MAXIMUM_OPERATORS_FEE * 2n))
        .to.emit(network, Events.OPERATOR_MAXIMUM_FEE_UPDATED_SSV);

      expect(await views.getMaximumOperatorFeeSSV())
        .to.be.equal(MAXIMUM_OPERATORS_FEE * 2n);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if the caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE * 2n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'reduceOperatorFee()'", async function(){
    it("Decreases fee and emits the correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      const tx = await network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REDUCE_OPERATOR_FEE]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_FEE_EXECUTED);

      expect(await views.getOperatorFee(operatorId))
        .to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
    });

    it("Is reverted with 'OperatorDoesNotExist' if the operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.reduceOperatorFee(12345n, MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      await expect(network.connect(randomUser).reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });

    it("Is reverted with 'FeeTooLow' if the passed fee is less than minimum allowed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      await expect(network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE - 1n))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
    });

    it("Is reverted with 'FeeIncreaseNotAllowed' if caller is trying to increase the fee", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      await expect(network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE * 3n))
        .to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });
  });

  describe("Function 'withdrawOperatorEarnings()'", async function(){
    it("Withdraws operators earnings, update balances and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);
      const earningsPeriod = 100n;

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(earningsPeriod);
      const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
      const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);

      expect(expectedEarnings).to.be.equal(earnings);

      const tx = await network.withdrawOperatorEarnings(operatorIds[0], earnings);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_OPERATOR_BALANCE]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_WITHDRAWN)
        .withArgs(operatorOwner.address, operatorIds[0], earnings);

      expect(await views.getOperatorEarnings(operatorIds[0]))
        .to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.withdrawOperatorEarnings(12345n, 9999n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(randomUser).withdrawOperatorEarnings(operatorIds[0], 9999n))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });

    it("Is reverted with 'InsufficientBalance' if the amount is less than operator earnings", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      // no validators no earnings rn
      await expect(network.withdrawOperatorEarnings(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });

  describe("Function 'withdrawAllOperatorEarnings()'", async function(){
    it("Withdraws all operators earnings, update balances and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);
      const earningsPeriod = 100n;

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(earningsPeriod);
      const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
      const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);

      expect(expectedEarnings).to.be.equal(earnings);

      await expect(await network.withdrawAllOperatorEarnings(operatorIds[0]))
        .to.emit(network, Events.OPERATOR_WITHDRAWN)
        .withArgs(operatorOwner.address, operatorIds[0], earnings + MINIMAL_OPERATOR_ETH_FEE); // 1 block passed

      expect(await views.getOperatorEarnings(operatorIds[0]))
        .to.be.equal(0);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.withdrawAllOperatorEarnings(12345n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(randomUser).withdrawAllOperatorEarnings(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });
  });

  describe("Function 'withdrawAllVersionOperatorEarnings()'", async function() {
    it("Withdraws all operators earnings and emits correct events", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);
      const earningsPeriod = 100n;

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(earningsPeriod);
      const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
      const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);

      expect(expectedEarnings).to.be.equal(earnings);

      await expect(await network.withdrawAllVersionOperatorEarnings(operatorIds[0]))
        .to.emit(network, Events.OPERATOR_WITHDRAWN)
        .withArgs(operatorOwner.address, operatorIds[0], earnings + MINIMAL_OPERATOR_ETH_FEE); // 1 block passed

      expect(await views.getOperatorEarnings(operatorIds[0]))
        .to.be.equal(0);
    });

    it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.withdrawAllVersionOperatorEarnings(12345n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(randomUser).withdrawAllVersionOperatorEarnings(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
        .withArgs(randomUser.address, operatorOwner.address);
    });
  });

  describe("Function 'setFeeRecipientAddress()'", async function(){
    it("Emits the correct event with the correct input data", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).setFeeRecipientAddress(clusterOwner.address))
        .to.emit(network, Events.FEE_RECIPIENT_ADDRESS_UPDATED)
        .withArgs(randomUser.address, clusterOwner.address);
    });
  });

  describe("Function 'updateOperatorFeeIncreaseLimit()'", async function(){
    it("Changes fee increase limit and emits the correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE + 1n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT]);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
        .withArgs(OPERATOR_MAX_FEE_INCREASE + 1n);

      expect(await views.getOperatorFeeIncreaseLimit()).to.be.equal(OPERATOR_MAX_FEE_INCREASE + 1n);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE + 1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateDeclareOperatorFeePeriod()'", async function() {
    it("Changes the fee declare period and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateDeclareOperatorFeePeriod(DECLARE_OPERATOR_FEE_PERIOD + 1n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD]);

      await expect(tx)
        .to.emit(network, Events.DECLARE_OPERATOR_FEE_PERIOD_UPDATED)
        .withArgs(DECLARE_OPERATOR_FEE_PERIOD + 1n);

      expect(await views.getOperatorFeePeriods())
        .to.be.deep.equal([DECLARE_OPERATOR_FEE_PERIOD + 1n, EXECUTE_OPERATOR_FEE_PERIOD]);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateDeclareOperatorFeePeriod(DECLARE_OPERATOR_FEE_PERIOD + 1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateExecuteOperatorFeePeriod()'", async function(){
    it("Changes the fee execute period and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateExecuteOperatorFeePeriod(EXECUTE_OPERATOR_FEE_PERIOD + 1n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD]);

      await expect(tx)
        .to.emit(network, Events.EXECUTE_OPERATOR_FEE_PERIOD_UPDATED)
        .withArgs(EXECUTE_OPERATOR_FEE_PERIOD + 1n);

      expect(await views.getOperatorFeePeriods())
        .to.be.deep.equal([DECLARE_OPERATOR_FEE_PERIOD , EXECUTE_OPERATOR_FEE_PERIOD + 1n]);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateExecuteOperatorFeePeriod(EXECUTE_OPERATOR_FEE_PERIOD + 1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateLiquidationThresholdPeriod()'", async function(){
    it("Changes the period and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateLiquidationThresholdPeriod(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.CHANGE_LIQUIDATION_THRESHOLD_PERIOD]);

      await expect(tx)
        .to.emit(network, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
        .withArgs(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n);

      expect(await views.getLiquidationThresholdPeriod())
        .to.be.equal(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n);
    });

    it("Is reverted 'NewBlockPeriodIsBelowMinimum' if the passed threshold is less than minimum allowed", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD - 1n))
        .to.be.revertedWithCustomError(network, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateLiquidationThresholdPeriod(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateLiquidationThresholdPeriodSSV()'", async function(){
    it("Changes the period and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.updateLiquidationThresholdPeriodSSV(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n))
        .to.emit(network, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED_SSV)
        .withArgs(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n);

      expect(await views.getLiquidationThresholdPeriodSSV())
        .to.be.equal(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n);
    });

    it("Is reverted 'NewBlockPeriodIsBelowMinimum' if the passed threshold is less than minimum allowed", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.updateLiquidationThresholdPeriodSSV(MINIMAL_LIQUIDATION_THRESHOLD - 1n))
        .to.be.revertedWithCustomError(network, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateLiquidationThresholdPeriodSSV(MINIMUM_BLOCKS_BEFORE_LIQUIDATION + 1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateMinimumLiquidationCollateral()'", async function(){
    it("Changes collateral and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const tx = await network.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.CHANGE_MINIMUM_COLLATERAL]);

      await expect(tx)
        .to.emit(network, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED)
        .withArgs(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);

      expect(await views.getMinimumLiquidationCollateral())
        .to.be.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateMinimumLiquidationCollateralSSV()'", async function(){
    it("Changes collateral and emits correct event", async function(){
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.updateMinimumLiquidationCollateralSSV(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
        .to.emit(network, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED_SSV)
        .withArgs(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);

      expect(await views.getMinimumLiquidationCollateralSSV())
        .to.be.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateMinimumLiquidationCollateralSSV(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateNetworkFee()'", async function() {
    it("Updates network fee and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const currentFee = await views.getNetworkFee();
      const newFee = currentFee * 2n;

      const tx = await network.updateNetworkFee(newFee);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.NETWORK_FEE_CHANGE]);

      await expect(tx)
        .to.emit(network, Events.NETWORK_FEE_UPDATED)
        .withArgs(currentFee, newFee);

      expect(await views.getNetworkFee()).to.equal(newFee);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateNetworkFee(1000n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'updateNetworkFeeSSV()'", async function() {
    it("Updates network fee SSV and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const currentFee = await views.getNetworkFeeSSV();
      const newFee = currentFee * 2n;

      await expect(network.updateNetworkFeeSSV(newFee))
        .to.emit(network, Events.NETWORK_FEE_UPDATED_SSV)
        .withArgs(currentFee, newFee);

      expect(await views.getNetworkFeeSSV()).to.equal(newFee);
    });

    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).updateNetworkFeeSSV(1000n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'withdrawNetworkSSVEarnings()'", async function() {
    it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.connect(randomUser).withdrawNetworkSSVEarnings(1n))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  });

  describe("Function 'registerValidator()'", async function () {
    it("For a new cluster, creates it with a passed validator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

        const validatorKey = makePublicKey(1);
        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

        const tx = await network.connect(clusterOwner).registerValidator(
          validatorKey,
          operatorIds,
          DEFAULT_SHARES,
          0,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        );
        const receipt = await tx.wait();
        await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

        await expect(tx).to.emit(network, Events.VALIDATOR_ADDED);

      const expectedCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      expect(await views.getValidator(clusterOwner, validatorKey)).to.equal(true);
      expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);
      expect(await views.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);
      expect(await views.getBurnRate(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(await calculateInitialBurnRate(views, operatorIds, expectedCluster));
      expect(await views.getBalance(clusterOwner, operatorIds, expectedCluster))
        .to.be.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(await views.getEffectiveBalance(clusterOwner, operatorIds, expectedCluster))
        .to.be.equal(DEFAULT_ETH_EB_PER_VALIDATOR);
      expect(await views.getClusterVersion(clusterOwner, operatorIds))
        .to.be.equal(CLUSTER_VERSION_ETH);

      // ssv legacy getters
      await expect(views.isLiquidatableSSV(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
      expect(await views.getBurnRateSSV(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(0);
      expect(await views.getBalanceSSV(clusterOwner, operatorIds, expectedCluster))
        .to.be.equal(0);
    });

    it("Registers a validator for a new ETH cluster using whitelisting contract", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      const { contract: whitelistingContract, address: whitelistingContractAddress } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      await whitelistingContract.addWhitelistedAddress(clusterOwner.address);
      await network.setOperatorsWhitelistingContract(operatorIds, whitelistingContractAddress);

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTING_CONTRACT_4]);
    });

    it("Registers a validator for a new ETH cluster with one whitelisted operator", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await network.setOperatorsPublicUnchecked([operatorIds[1], operatorIds[2], operatorIds[3]]);
      await network.setOperatorsWhitelists([operatorIds[0]], [clusterOwner.address]);

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4]);
    });

    it("Registers a validator for a new ETH cluster with four whitelisted operators", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await network.setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4]);
    });

    it("Registers a validator into an existing ETH cluster with four whitelisted operators", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await network.setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const existingCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        0,
        existingCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4]);
    });

    it("Registers a validator for a new ETH cluster with one whitelisting contract operator", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await network.setOperatorsPublicUnchecked([operatorIds[1], operatorIds[2], operatorIds[3]]);

      const { contract: whitelistingContract } =
        await deployContract(connection.ethers, "BasicWhitelisting");

      await whitelistingContract.addWhitelistedAddress(clusterOwner.address);
      await network.setOperatorsWhitelistingContract([operatorIds[0]], whitelistingContract);

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTING_CONTRACT_4]);
    });

    it("Registers a validator into an existing ETH cluster", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const existingCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        0,
        existingCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_ETH_CLUSTER]);
    });

    it("Registers a validator into a prefunded ETH cluster with zero additional deposit", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
      );

      const existingCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        0,
        existingCluster,
        { value: 0 }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the amount of operators is not the allowed one", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 5); // 5 operators for invalid cluster size
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'InvalidPublicKeyLength' if the public key is not 48 bytes", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const invalidLengthPublicKey = makePublicKey(1) + "11";
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).registerValidator(
        invalidLengthPublicKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INVALID_PUBLIC_KEYS_LENGTH);
    });

    it("Is reverted with 'ValidatorAlreadyExistsWithData' if the public key is already registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA)
        .withArgs(validatorKey);
    });

    it("Is reverted with 'IncorrectClusterState' for the new cluster is the cluster data is not consisting from zeroes", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const invalidCluster = { ...EMPTY_CLUSTER, validatorCount: 123n };

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        invalidCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const lastOp = operatorIds.pop();
      operatorIds.unshift(lastOp!);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
    });

    it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicates", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      operatorIds.pop();
      operatorIds.unshift(operatorIds[0]);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
    });

    it("Is reverted with 'CallerNotWhitelistedWithData' if one of operators did not whitelist the caller", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED)
        .withArgs(operatorIds[0]);
    });

    it("Is reverted with 'ExceedValidatorLimitWithData' if one of operators will exceed the network limit", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkValidatorsPerOperatorUpgrade");
      const factory = await connection.ethers.getContractFactory("SSVNetworkValidatorsPerOperatorUpgrade");
      const initData = factory.interface.encodeFunctionData("initializev2", [0]);
      await network.upgradeToAndCall(upgradeImplAddr, initData);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED)
        .withArgs(operatorIds[0]);
    });

    it("Is reverted with 'InsufficientBalance' if msg value is not enough to cover the validator", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: 0 }
      ))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });

  describe("Function bulkRegisterValidator()", async function() {
    it("Registers bulk of validators, creates a new cluster with the expected data and emits correct events", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const tx = await network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await tx.wait();

      for (let i = 0; i < keys.length; i++) {
        const expectedCluster = await getCurrentClusterState(
          connection,
          network,
          clusterOwner.address,
          operatorIds
        );

        expect(await views.getValidator(clusterOwner, keys[i])).to.equal(true);
        expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
          .to.be.equal(false);
        expect(await views.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
          .to.be.equal(false);
        expect(await views.getBurnRate(clusterOwner.address, operatorIds, expectedCluster))
          .to.be.equal(await calculateInitialBurnRate(views, operatorIds, expectedCluster));
        expect(await views.getBalance(clusterOwner, operatorIds, expectedCluster))
          .to.be.equal(DEFAULT_ETH_REGISTER_VALUE);
        expect(await views.getEffectiveBalance(clusterOwner, operatorIds, expectedCluster))
          .to.be.equal(DEFAULT_ETH_EB_PER_VALIDATOR * BigInt(keys.length));
        expect(await views.getClusterVersion(clusterOwner, operatorIds))
          .to.be.equal(CLUSTER_VERSION_ETH);

        await expect(views.isLiquidatableSSV(clusterOwner.address, operatorIds, expectedCluster))
          .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
        expect(await views.getBurnRateSSV(clusterOwner.address, operatorIds, expectedCluster))
          .to.be.equal(0);
        expect(await views.getBalanceSSV(clusterOwner, operatorIds, expectedCluster))
          .to.be.equal(0);
      }
    });

    it("Registers bulk of validators into an existing cluster with one whitelisting contract operator", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await network.setOperatorsPublicUnchecked([operatorIds[1], operatorIds[2], operatorIds[3]]);

      const { contract: whitelistingContract } =
        await deployContract(connection.ethers, "BasicWhitelisting");
      await whitelistingContract.addWhitelistedAddress(clusterOwner.address);
      await network.setOperatorsWhitelistingContract([operatorIds[0]], whitelistingContract);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const existingCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      const keys = Array.from({ length: 10 }, (_, i) => makePublicKey(i + 2));
      const shares = Array(10).fill(DEFAULT_SHARES);

      const tx = await network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        existingCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4]);
    });

    it("Is reverted with 'InvalidOperatorIdsLength' if the amount of operators is not the allowed one", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 5); // 5 operators for invalid cluster size
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
    });

    it("Is reverted with 'InvalidPublicKeyLength' if one of public keys is not 48 bytes", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);

      const invalidLengthPublicKey = makePublicKey(1) + "11";
      keys.shift();
      keys.unshift(invalidLengthPublicKey);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INVALID_PUBLIC_KEYS_LENGTH);
    });

    it("Is reverted with 'ValidatorAlreadyExistsWithData' if  one of public keys is already registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        keys[7],
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA)
        .withArgs(keys[7]);
    });

    it("Is reverted with 'IncorrectClusterState' for the new cluster is the cluster data is not consisting from zeroes", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const invalidCluster = { ...EMPTY_CLUSTER, validatorCount: 123n };

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        invalidCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const lastOp = operatorIds.pop();
      operatorIds.unshift(lastOp!);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
    });

    it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicates", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      operatorIds.pop();
      operatorIds.unshift(operatorIds[0]);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
    });

    it("Is reverted with 'CallerNotWhitelistedWithData' if one of operators did not whitelist the caller", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED)
        .withArgs(operatorIds[0]);
    });

    it("Is reverted with 'ExceedValidatorLimitWithData' if one of operators will exceed the network limit", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkValidatorsPerOperatorUpgrade");
      const factory = await connection.ethers.getContractFactory("SSVNetworkValidatorsPerOperatorUpgrade");
      const initData = factory.interface.encodeFunctionData("initializev2", [0]);
      await network.upgradeToAndCall(upgradeImplAddr, initData);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED)
        .withArgs(operatorIds[0]);
    });

    it("Is reverted with 'InsufficientBalance' if msg value is not enough to cover new validators", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await expect(network.connect(clusterOwner).bulkRegisterValidator(
        keys,
        operatorIds,
        shares,
        0,
        EMPTY_CLUSTER,
        { value: 0 }
      ))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });

  it("Is reverted with 'EmptyPublicKeysList' if the array of public keys is empty", async function() {
    const { network } =
      await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

    const {shares} = makeArrayOfKeysAndShares(1, 10);
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

    await expect(network.connect(clusterOwner).bulkRegisterValidator(
      [],
      operatorIds,
      shares,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    ))
      .to.be.revertedWithCustomError(network, Errors.EMPTY_PUBLIC_KEYS_LIST);
  });

  it("Is reverted with 'PublicKeysSharesLengthMismatch' if the array of keys and array of shares have different length", async function(){
    const { network } =
      await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

    const {keys, shares} = makeArrayOfKeysAndShares(1, 10);
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

    await expect(network.connect(clusterOwner).bulkRegisterValidator(
      keys,
      operatorIds,
      shares,
      0,
      EMPTY_CLUSTER,
      { value: 0 }
    ))
      .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
  });

  describe("Function 'removeValidator()'", async function() {
    it("Removes validator and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const tx = await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REMOVE_VALIDATOR]);

      await expect(tx)
        .to.emit(network, Events.VALIDATOR_REMOVED);

      const clusterAfter = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      expect(clusterAfter.validatorCount).to.equal(0n);
      expect(clusterAfter.active).to.equal(true);
      expect(await views.getValidator(clusterOwner.address, validatorKey)).to.be.equal(false);
    });

    it("Is reverted with 'ClusterDoesNotExists' if the cluster with this owner and operators does not exist", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      await expect(network.connect(randomUser).removeValidator(validatorKey, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });

    it("Is reverted with 'IncorrectClusterState' if the cluster data is incorrect", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      cluster.validatorCount += 1n;

      await expect(network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Is reverted with 'ValidatorDoesNotExist' if the validator was never registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const incorrectValidator: string = validatorKey + "11";

      await expect(network.connect(clusterOwner).removeValidator(incorrectValidator, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
    });

    it("Is reveted with 'ValidatorDoesNotExist' if validator is already removed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
      const updatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await expect(network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, updatedCluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
    });
  });

  describe("Function 'bulkRemoveValidator()'", async function(){
    it("Removes validators and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);
      const { keys, shares } = makeArrayOfKeysAndShares(2, 10);
      const populatedCluster = await addValidatorsToCluster(
        connection, network, keys, shares, clusterOwner, operatorIds, cluster
      );

      const tx = await network.connect(clusterOwner).bulkRemoveValidator(keys, operatorIds, populatedCluster);
      await tx.wait();
      const clusterAfter = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds
      );

      for (let i = 0; i < keys.length; i++) {
        await expect(tx).to.emit(network, Events.VALIDATOR_REMOVED);
        expect(await views.getValidator(clusterOwner.address, keys[i])).to.be.equal(false);
      }

      expect(clusterAfter.validatorCount).to.equal(cluster.validatorCount); // populated keys are removed
      expect(clusterAfter.active).to.equal(true);
    });

    it("Is reverted with 'ClusterDoesNotExists' if the cluster with this owner and operators does not exist", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      await expect(network.connect(randomUser).bulkRemoveValidator([validatorKey], operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });

    it("Is reverted with 'IncorrectClusterState' if the cluster data is incorrect", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      cluster.validatorCount += 1n;

      await expect(network.connect(clusterOwner).bulkRemoveValidator([validatorKey], operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Is reverted with 'IncorrectValidatorStateWithData' if the validator was never registered", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const incorrectValidator: string = validatorKey + "11";

      await expect(network.connect(clusterOwner).bulkRemoveValidator([incorrectValidator], operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE)
        .withArgs(incorrectValidator);
    });

    it("Is reveted with 'ValidatorDoesNotExist' if validator is already removed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, validatorKey, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
      const updatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await expect(network.connect(clusterOwner).bulkRemoveValidator([validatorKey], operatorIds, updatedCluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
    });
  });

  describe("Function 'deposit()'", async function() {
    it("Deposits ETH into an existing cluster and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE;
      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);

      const tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        0, // deprecated amount param
        cluster,
        { value: depositAmount }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.DEPOSIT]);

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await expect(tx)
        .to.emit(network, Events.CLUSTER_DEPOSITED);

      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);
    });

    it("Allows third party to deposit into a cluster", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE;

      // randomUser deposits into clusterOwner's cluster
      const tx = await network.connect(randomUser).deposit(
        clusterOwner.address,
        operatorIds,
        0,
        cluster,
        { value: depositAmount }
      );

      await expect(tx).to.emit(network, Events.CLUSTER_DEPOSITED);
    });

    it("Is reverted with 'ClusterDoesNotExists' if cluster does not exist", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.deposit(
        clusterOwner.address,
        operatorIds,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });

    it("Is reverted with 'IncorrectClusterState' if cluster data is incorrect", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const incorrectCluster = { ...cluster, validatorCount: cluster.validatorCount + 1n };

      await expect(network.deposit(
        clusterOwner.address,
        operatorIds,
        0,
        incorrectCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });
  });

  describe("Function 'withdraw()'", async function() {
    it("Withdraws ETH from cluster and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const withdrawAmount = balanceBefore / 2n;

      const ownerEthBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_CLUSTER_BALANCE]);
      const gasUsed = BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice);

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await expect(tx)
        .to.emit(network, Events.CLUSTER_WITHDRAWN);

      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      expect(balanceAfter).to.be.lessThan(balanceBefore);

      const ownerEthAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(ownerEthAfter + gasUsed - ownerEthBefore).to.equal(withdrawAmount);
    });

    it("Is reverted with 'ClusterDoesNotExists' if cluster does not exist", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.withdraw(operatorIds, 1000n, EMPTY_CLUSTER))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });

    it("Is reverted with 'InsufficientBalance' if withdrawing more than available", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const balance = await views.getBalance(clusterOwner.address, operatorIds, cluster);

      await expect(network.connect(clusterOwner).withdraw(operatorIds, balance * 10n, cluster))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Is reverted with 'IncorrectClusterState' if cluster data is incorrect", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      const incorrectCluster = { ...cluster, validatorCount: cluster.validatorCount + 1n };

      await expect(network.connect(clusterOwner).withdraw(operatorIds, 1000n, incorrectCluster))
        .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });
  });

  describe("Function 'liquidate()'", async function() {
    it("Liquidates an underfunded cluster and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Set higher network fee to increase burn rate for faster liquidation
      // With NETWORK_FEE * 100, liquidation occurs within ~50k blocks
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(99);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      // Use DEFAULT_ETH_REGISTER_VALUE to ensure registration succeeds with network fee
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine blocks to drain balance below liquidation threshold
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);

      // Keep mining until liquidatable
      let attempts = 0;
      while (!isLiquidatable && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
        isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
        attempts++;
      }

      expect(isLiquidatable).to.be.equal(true);

      const tx = await network.connect(randomUser).liquidate(
        clusterOwner.address,
        operatorIds,
        currentCluster
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.LIQUIDATE_CLUSTER_4]);

      await expect(tx)
        .to.emit(network, Events.CLUSTER_LIQUIDATED);

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfter.active).to.equal(false);
      expect(await views.isLiquidated(clusterOwner.address, operatorIds, clusterAfter)).to.be.equal(true);
    });

    it("Is reverted with 'ClusterNotLiquidatable' if cluster has sufficient balance", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      await expect(network.liquidate(clusterOwner.address, operatorIds, cluster))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("Is reverted with 'ClusterDoesNotExists' if cluster does not exist", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.liquidate(clusterOwner.address, operatorIds, EMPTY_CLUSTER))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });
  });

  describe("Function 'reactivate()'", async function() {
    it("Reactivates a liquidated cluster with sufficient deposit and emits correct event", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Set higher network fee to increase burn rate for faster liquidation
      // With NETWORK_FEE * 100, liquidation occurs within ~50k blocks
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(98);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Mine until liquidatable
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
      let attempts = 0;
      while (!isLiquidatable && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
        isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
        attempts++;
      }

      // Liquidate
      await network.connect(randomUser).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      // Reactivate with fresh deposit
      const tx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        0, // deprecated amount param
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REACTIVATE_CLUSTER]);

      await expect(tx)
        .to.emit(network, Events.CLUSTER_REACTIVATED);

      const reactivatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(reactivatedCluster.active).to.equal(true);
      expect(await views.isLiquidated(clusterOwner.address, operatorIds, reactivatedCluster)).to.be.equal(false);
    });

    it("Is reverted with 'ClusterAlreadyEnabled' if cluster is not liquidated", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const {cluster, operatorIds} =
        await registerDefaultCluster(connection, network, operatorOwner, clusterOwner);

      await expect(network.connect(clusterOwner).reactivate(
        operatorIds,
        0,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_ALREADY_ENABLED);
    });

    it("Is reverted with 'ClusterDoesNotExists' if cluster does not exist", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(network.reactivate(
        operatorIds,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ))
        .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });
  });

  describe("Function stake()", async function() {
    it("Stakes SSV, mints CSSV to the staker and creates delegation weight", async function() {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);

      const tx = await network.connect(randomUser).stake(STAKE_AMOUNT);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.STAKE_SSV]);

      await expect(tx)
        .to.emit(network, Events.STAKED)
        .withArgs(randomUser.address, STAKE_AMOUNT);

      expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);

      const expectedWeightPerOracle = STAKE_AMOUNT / BigInt(DEFAULT_ORACLES_IDS.length);
      let expectedWeights: bigint[] = [];
      for (let i = 0; i < DEFAULT_ORACLES_IDS.length; i++) {
        expectedWeights.push(expectedWeightPerOracle);
      }

      expect(await views.getUserDelegation(randomUser.address))
        .to.be.deep.equal([DEFAULT_ORACLES_IDS, expectedWeights]);
    });

    it("Is reverted with 'StakeTooLow' if the amount to stake is smaller than minimum allowed", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.stake(1))
        .to.be.revertedWithCustomError(network, Errors.STAKE_TOO_LOW);
    });

    it("Is reverted with 'ZeroAmount' is caller is trying to stake 0 SSV", async function(){
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.stake(0))
        .to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
    });
  });

  describe("Function requestUnstake()", async function() {
    it("For full amount, creates unstake request, burns CSSV and removes delegation", async function(){
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT)

      const tx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT);
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.REQUEST_UNSTAKE]);
      const block = await tx.getBlock();

      await expect(tx)
        .to.emit(network, Events.UNSTAKE_REQUESTED)
        .withArgs(randomUser.address, STAKE_AMOUNT, BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN)

      expect(await views.pendingUnstake(randomUser.address))
        .to.be.deep.equal([[STAKE_AMOUNT], [BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN]]);

      expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(0);
      expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(0);
    });

    it("For partial amount, creates unstake request, burns CSSV and removes delegation", async function(){
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT)

      const tx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT / 2n);
      await tx.wait();
      const block = await tx.getBlock();

      await expect(tx)
        .to.emit(network, Events.UNSTAKE_REQUESTED)
        .withArgs(randomUser.address, STAKE_AMOUNT / 2n, BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN)

      expect(await views.pendingUnstake(randomUser.address))
        .to.be.deep.equal([[STAKE_AMOUNT / 2n], [BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN]]);

      const secondTx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT / 2n);
      await secondTx.wait();
      const secondBlock = await secondTx.getBlock();

      await expect(secondTx)
        .to.emit(network, Events.UNSTAKE_REQUESTED)
        .withArgs(randomUser.address, STAKE_AMOUNT / 2n, BigInt(secondBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);

      expect(await views.pendingUnstake(randomUser.address))
        .to.be.deep.equal([
        [STAKE_AMOUNT / 2n, STAKE_AMOUNT / 2n],
        [BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN, BigInt(secondBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN]
      ]);
    });

    it("Is reverted with 'MaxRequestsAmountReached' if more than 10 pending requests", async function() {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT);

      const smallAmount = STAKE_AMOUNT / 11n;

      for (let i = 0; i < 10; i++) {
        await network.connect(randomUser).requestUnstake(smallAmount);
      }

      await expect(network.connect(randomUser).requestUnstake(smallAmount))
        .to.be.revertedWithCustomError(network, Errors.MAX_REQUESTS_AMOUNT_REACHED);
    });

    it("Is reverted with 'ZeroAmount' if caller is trying to request 0 SSV", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.requestUnstake(0))
        .to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
    });

    it("Is reverted with 'UnstakeAmountExceedsBalance' if caller is trying to request more SSV than they staked", async function(){
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT)

      await expect(network.connect(randomUser).requestUnstake(STAKE_AMOUNT + 1n))
        .to.be.revertedWithCustomError(network, Errors.UNSTAKE_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'withdrawUnlocked()'", async function(){
    it("Withdraws SSV and emits correct event", async function() {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT)
      await network.connect(randomUser).requestUnstake(STAKE_AMOUNT);

      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
      await networkHelpers.mine();

      const tx = await network.connect(randomUser).withdrawUnlocked();
      const receipt = await tx.wait();
      await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_UNSTAKE]);

      await expect(tx)
        .to.emit(network, Events.UNSTAKE_WITHDRAWN)
        .withArgs(randomUser.address, STAKE_AMOUNT);

      expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(0);
      expect(await ssvToken.balanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);
      expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(0);
    });

    it("Is reverted with 'NothingToWithdraw' if no pending withdrawal", async function() {
      const { network } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await expect(network.withdrawUnlocked())
        .to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);
    });

    it("Is reverted with 'NothingToWithdraw' if cooldown not passed", async function() {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT);
      await network.connect(randomUser).requestUnstake(STAKE_AMOUNT);

      // Don't wait for cooldown
      await expect(network.connect(randomUser).withdrawUnlocked())
        .to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);
    });
  });

  describe("Function 'claimEthRewards()'", async function() {
    it("Is reverted with 'NothingToClaim' if no rewards accrued", async function() {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
      await ssvToken.mint(randomUser.address, STAKE_AMOUNT);
      await network.connect(randomUser).stake(STAKE_AMOUNT);

      // No blocks mined, no rewards
      await expect(network.connect(randomUser).claimEthRewards())
        .to.be.revertedWithCustomError(network, Errors.NOTHING_TO_CLAIM);
    });
  });

  describe("End-to-end cluster lifecycle", async function() {
    it("Full lifecycle: register → operate → liquidate → reactivate", async function() {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Set higher network fee to increase burn rate for faster liquidation
      // With NETWORK_FEE * 100, liquidation occurs within ~50k blocks
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      // 1. Register operators
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

      // 2. Register validator (creates cluster)
      const validatorKey = makePublicKey(97);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.active).to.equal(true);
      expect(cluster.validatorCount).to.equal(1n);

      // 3. Operate for some time (mine blocks)
      await connection.networkHelpers.mine(1000);

      // 4. Verify operators are earning
      const operatorEarnings = await views.getOperatorEarnings(operatorIds[0]);
      expect(operatorEarnings).to.be.greaterThan(0n);

      // 5. Mine until liquidatable
      let isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
      let attempts = 0;
      while (!isLiquidatable && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
        isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
        attempts++;
      }

      expect(isLiquidatable).to.be.equal(true);

      // 6. Liquidate
      await network.connect(randomUser).liquidate(clusterOwner.address, operatorIds, cluster);

      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.active).to.equal(false);

      // 7. Reactivate with fresh deposit
      await network.connect(clusterOwner).reactivate(
        operatorIds,
        0,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE * 2n }
      );

      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.active).to.equal(true);

      // 8. Withdraw some balance
      const newBalance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      await network.connect(clusterOwner).withdraw(operatorIds, newBalance / 4n, cluster);

      // 9. Remove validator
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);

      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.validatorCount).to.equal(0n);
    });
  });
});
