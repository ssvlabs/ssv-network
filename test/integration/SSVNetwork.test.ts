import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../setup/connection.ts';
import { ssvNetworkFullFixture } from '../setup/fixtures.ts';
import type { NetworkHelpersType, OperatorTuple } from '../common/types.ts';
import {
  calculateInitialBurnRate,
  getCurrentClusterState,
  makeOperatorKey,
  makePublicKey,
  registerOperators,
  whitelistAddresses,
} from '../common/helpers.ts';
import {
  CLUSTER_VERSION_ETH,
  DEFAULT_ETH_EB_PER_VALIDATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER, MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE, PRECISION_FACTOR,
} from '../common/constants.ts';
import { Events } from '../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../common/errors.js';
import { deployContract } from '../../scripts/common/helpers.js';

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

      await expect(await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true))
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

      expect(await network.removeOperator(expectedId))
        .to.emit(network, Events.OPERATOR_REMOVED)
        .withArgs(expectedId)

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

      expect(await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract))
        .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
        .withArgs(operatorIds, contractAddress);

      expect(await views.isWhitelistingContract(contractAddress)).to.be.equal(true);

      await whiteListingContract.addWhitelistedAddress(clusterOwner);

      expect(await views.isAddressWhitelistedInWhitelistingContract(clusterOwner, operatorIds[0], contractAddress))
        .to.be.equal(true);
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

      expect(await network.removeOperatorsWhitelistingContract(operatorIds))
        .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
        .withArgs(operatorIds, connection.ethers.ZeroAddress);
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

  describe("Function 'registerValidator()'", async function () {
    it("For a new cluster, creates it with a passed validator and emits correct event", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

        const validatorKey = makePublicKey(1);
        const operatorIds = await registerOperators(network, operatorOwner, 4);
        await whitelistAddresses(network, operatorIds, [clusterOwner.address]);

        await expect(await network.connect(clusterOwner).registerValidator(
          validatorKey,
          operatorIds,
          DEFAULT_SHARES,
          0,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        )).to.emit(network, Events.VALIDATOR_ADDED);

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
});