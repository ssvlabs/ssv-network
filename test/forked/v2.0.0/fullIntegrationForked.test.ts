import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullForkedFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType, OperatorTuple, UnstakeRequest } from '../../common/types.ts';
import { calculateInitialBurnRate, getCurrentClusterState, makeArrayOfKeysAndShares, getFeeAboveIncreaseLimit, getValidOperatorFeeIncrease, makeOperatorKey, makePublicKey, registerDefaultCluster, registerOperators, whitelistAddresses, setAccountBalance } from '../../helpers/index.ts';
import { CLUSTER_VERSION_ETH, DECLARE_OPERATOR_FEE_PERIOD, DEFAULT_ETH_EB_PER_VALIDATOR, DEFAULT_ETH_REGISTER_VALUE, DEFAULT_ORACLES_IDS, DEFAULT_SHARES, DEFAULT_UNSTAKE_COOLDOWN, EMPTY_CLUSTER, EXECUTE_OPERATOR_FEE_PERIOD, MAXIMUM_OPERATORS_FEE, MINIMAL_LIQUIDATION_THRESHOLD, MINIMAL_OPERATOR_ETH_FEE, MINIMUM_BLOCKS_BEFORE_LIQUIDATION, MINIMUM_LIQUIDATION_PERIOD_COLLATERAL, NETWORK_FEE, OPERATOR_MAX_FEE_INCREASE, OPERATOR_FEE_PRECISION, STAKE_AMOUNT, VALIDATORS_PER_OPERATOR_LIMIT, } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.ts';
import { deployContract } from '../../../scripts/common/helpers.ts';
import { ContractTransactionResponse } from 'ethers';
import { trackGasFromReceipt, GasGroup } from '../../helpers/gas.ts';
import { getForkedConnection } from '../../setup/connection.ts';
import { ForkConfig } from './config.ts';

const RUN_FORK = process.env.RUN_FORK === 'true';
const suite = RUN_FORK ? describe : describe.skip;

suite("SSVNetwork full integration tests made on forked contract", () => {
    let connection: NetworkConnection<"generic">;
    let networkHelpers: NetworkHelpersType;
    let operatorOwner: HardhatEthersSigner;
    let clusterOwner: HardhatEthersSigner;
    let randomUser: HardhatEthersSigner;

    before(async function () {
        ({ connection, networkHelpers } = await getForkedConnection());
        [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();

        for (const signer of [operatorOwner, clusterOwner, randomUser]) {
            await connection.ethers.provider.send("hardhat_impersonateAccount", [signer.address]);
            await setAccountBalance(connection.ethers.provider, signer.address, BigInt("0x56bc75e2d63100000"));
        }

        operatorOwner = await connection.ethers.getSigner(operatorOwner.address);
        clusterOwner = await connection.ethers.getSigner(clusterOwner.address);
        randomUser = await connection.ethers.getSigner(randomUser.address);
    });

    const deployFullSSVNetworkForkFixture = async () => {
        return ssvNetworkFullForkedFixture(connection);
    };

    describe("Constructor, initializer and upgrades", async function () {
        it("Configures SSVNetwork correctly", async function () {
            const { network, views, cssvToken, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(await network.getAddress()).to.be.equal(ForkConfig.SSV_NETWORK_ADDRESS);
            await expect(await views.getAddress()).to.be.equal(ForkConfig.SSV_NETWORK_VIEWS);
            await expect(await ssvToken.getAddress()).to.be.equal(ForkConfig.SSV_TOKEN);

            const version = await network.getVersion();

            await expect(version).to.be.a("string").and.not.empty;
            await expect(await views.getMinimumLiquidationCollateralSSV()).to.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
            await expect(await views.getValidatorsPerOperatorLimit()).to.equal(VALIDATORS_PER_OPERATOR_LIMIT);
            await expect(await views.getOperatorFeePeriods()).to.deep.equal([DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD]);
            await expect(await views.getOperatorFeeIncreaseLimit()).to.equal(OPERATOR_MAX_FEE_INCREASE);
            await expect(await views.getActiveOracleIds()).to.deep.equal(DEFAULT_ORACLES_IDS);
            await expect(await views.getNetworkFeeSSV()).to.equal(NETWORK_FEE);
            await expect(await views.cooldownDuration()).to.equal(DEFAULT_UNSTAKE_COOLDOWN);
            await expect(await views.getNetworkEarnings()).to.equal(0n);
            await expect(await views.totalStaked()).to.equal(0n);
        });
    });

    describe("Function 'registerOperator()'", async function () {
        it("Creates new operator and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            const tx = await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            const receipt = await tx.wait();

            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_OPERATOR]);

            await expect(tx)
                .to.emit(network, Events.OPERATOR_ADDED).withArgs(expectedId, operatorOwner.address, operatorKey, MINIMAL_OPERATOR_ETH_FEE)
                .and.to.emit(network, Events.OPERATOR_PRIVACY_STATUS_UPDATED).withArgs([expectedId], true);

            await expect(await views.getOperatorFee(expectedId)).to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
            await expect(await views.getOperatorFeeSSV(expectedId)).to.be.equal(0);
            await expect(await views.getOperatorDeclaredFee(expectedId)).to.be.deep.equal([false, 0n, 0n, 0n]);
            await expect(await views.getOperatorById(expectedId)).to.be.deep.equal([
                operatorOwner.address,
                MINIMAL_OPERATOR_ETH_FEE,
                0,
                connection.ethers.ZeroAddress,
                true,
                true
            ]);

            await expect(await views.getOperatorByIdSSV(expectedId)).to.be.deep.equal([
                operatorOwner.address,
                0,
                0,
                connection.ethers.ZeroAddress,
                true,
                false
            ]);
        });

        it("Is reverted with 'FeeTooLow' if the provided fee is less than minimal allowed", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE - 1n, true))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
        });

        it("Is reverted with 'FeeTooHigh' if the provided fee is higher than maximum allowed", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            await expect(network.registerOperator(operatorKey, MAXIMUM_OPERATORS_FEE + 1n, true))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
        });

        it("Is reverted with 'OperatorAlreadyExists' if the public key is already registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_ALREADY_EXISTS);
        });
    });

    describe("Function 'removeOperator()'", async function () {
        it("Deactivates the operator and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            const tx = await network.removeOperator(expectedId);

            await expect(tx)
                .to.emit(network, Events.OPERATOR_REMOVED)
                .withArgs(expectedId);

            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR]);
            const operator: OperatorTuple = await views.getOperatorById(expectedId);

            await expect(operator[5]).to.be.equal(false);
            await expect(await views.getOperatorFee(expectedId)).to.be.equal(0);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator with passed id is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperator(12345n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.connect(randomUser).removeOperator(expectedId))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'setOperatorsWhitelists()'", async function () {
        it("Whitelists addresses and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

            await expect(await network.setOperatorsWhitelists([expectedId], [clusterOwner]))
                .to.emit(network, Events.OPERATOR_MULTIPLE_WHITELIST_UPDATED)
                .withArgs([expectedId], [clusterOwner]);
            await expect(await views.getWhitelistedOperators([expectedId], clusterOwner)).to.be.deep.equal([expectedId]);
        });

        it("Whitelists multiple operators for multiple addresses", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 10);
            const whitelistAddresses = Array(10).fill(clusterOwner.address);

            const tx = await network.setOperatorsWhitelists(operatorIds, whitelistAddresses);
            const receipt = await tx.wait();

            await trackGasFromReceipt(receipt, [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10]);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsWhitelists([], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'InvalidWhitelistAddressesLength' if the array of addresses is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsWhitelists([123], []))
                .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELIST_ADDRESSES_LENGTH);
        });

        it("Is reverted with 'ZeroAddressNotAllowed' if one of addresses is zero address", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.setOperatorsWhitelists([expectedId], [connection.ethers.ZeroAddress]))
                .to.be.revertedWithCustomError(network, Errors.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsWhitelists([123456789], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);

            await expect(network.connect(randomUser).setOperatorsWhitelists([expectedId], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicate", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.setOperatorsWhitelists([expectedId, expectedId], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
        });

        it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            const lastOp = operatorIds.pop();
            operatorIds.unshift(lastOp!);
            await expect(network.setOperatorsWhitelists(operatorIds, [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
        });
    });

    describe("Function 'removeOperatorsWhitelists()'", async function () {
        it("Removes addresses from the whitelist and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.setOperatorsWhitelists([expectedId], [clusterOwner]);
            await expect(await network.removeOperatorsWhitelists([expectedId], [clusterOwner]))
                .to.emit(network, Events.OPERATOR_MULTIPLE_WHITELIST_REMOVED)
                .withArgs([expectedId], [clusterOwner]);
            await expect(await views.getWhitelistedOperators([expectedId], clusterOwner)).to.be.deep.equal([]);
        });

        it("Removes multiple operators for multiple addresses", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 10);
            const whitelistAddresses = Array(10).fill(clusterOwner.address);
            await network.setOperatorsWhitelists(operatorIds, whitelistAddresses);
            const tx = await network.removeOperatorsWhitelists(operatorIds, whitelistAddresses);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10]);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperatorsWhitelists([], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'InvalidWhitelistAddressesLength' if the array of addresses is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperatorsWhitelists([123], []))
                .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELIST_ADDRESSES_LENGTH);
        });

        it("Is reverted with 'ZeroAddressNotAllowed' if one of addresses is zero address", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.removeOperatorsWhitelists([expectedId], [connection.ethers.ZeroAddress]))
                .to.be.revertedWithCustomError(network, Errors.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperatorsWhitelists([123456789], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.connect(randomUser).removeOperatorsWhitelists([expectedId], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicate", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await expect(network.removeOperatorsWhitelists([expectedId, expectedId], [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
        });

        it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            const lastOp = operatorIds.pop();
            operatorIds.unshift(lastOp!);
            await expect(network.removeOperatorsWhitelists(operatorIds, [clusterOwner]))
                .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
        });
    });

    describe("Function 'setOperatorsWhitelistingContract()'", async function () {
        it("Registers whitelisting contract, emits correct event and allows to whitelist addresses via contract", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            const { contract: whiteListingContract, address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            const tx = await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT]);
            await expect(tx)
                .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
                .withArgs(operatorIds, contractAddress);
            await expect(await views.isWhitelistingContract(contractAddress)).to.be.equal(true);
            await whiteListingContract.addWhitelistedAddress(clusterOwner);
            await expect(await views.isAddressWhitelistedInWhitelistingContract(clusterOwner, operatorIds[0], contractAddress))
                .to.be.equal(true);
        });

        it("Updates whitelisting contract for operators", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            const { contract: firstContract, address: firstAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            const { contract: secondContract, address: secondAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            await network.setOperatorsWhitelistingContract(operatorIds, firstContract);
            const tx = await network.setOperatorsWhitelistingContract(operatorIds, secondContract);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.UPDATE_OPERATOR_WHITELISTING_CONTRACT]);
            await expect(tx)
                .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
                .withArgs(operatorIds, secondAddress);
            await expect(firstAddress).to.not.equal(secondAddress);
        });

        it("Registers whitelisting contract for 10 operators", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 10);
            const { contract: whiteListingContract } = await deployContract(connection.ethers, "BasicWhitelisting");
            const tx = await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT_10]);
        });

        it("Is reverted with 'InvalidWhitelistingContract' if the contract does not support required interface", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { address: contractAddress } = await deployContract(connection.ethers, "SSVOperatorsWhitelist");
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            await expect(network.setOperatorsWhitelistingContract(operatorIds, contractAddress))
                .to.be.revertedWithCustomError(network, Errors.INVALID_WHITELISTING_CONTRACT)
                .withArgs(contractAddress);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' is the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            await expect(network.setOperatorsWhitelistingContract([], contractAddress))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            await expect(network.setOperatorsWhitelistingContract([12345n], contractAddress))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is the the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { address: contractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            await expect(network.connect(randomUser).setOperatorsWhitelistingContract(operatorIds, contractAddress))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'removeOperatorsWhitelistingContract()'", async function () {
        it("Removes whitelisting address and emits correct event", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 3);
            const { contract: whiteListingContract } = await deployContract(connection.ethers, "BasicWhitelisting");
            await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
            const tx = await network.removeOperatorsWhitelistingContract(operatorIds);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT]);
            await expect(tx)
                .to.emit(network, Events.OPERATORS_WHITELISTING_CONTRACT_UPDATED)
                .withArgs(operatorIds, connection.ethers.ZeroAddress);
        });

        it("Removes whitelisting contract for 10 operators", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 10);
            const { contract: whiteListingContract } = await deployContract(connection.ethers, "BasicWhitelisting");
            await network.setOperatorsWhitelistingContract(operatorIds, whiteListingContract);
            const tx = await network.removeOperatorsWhitelistingContract(operatorIds);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT_10]);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperatorsWhitelistingContract([]))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.removeOperatorsWhitelistingContract([12345n]))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(randomUser).removeOperatorsWhitelistingContract(operatorIds))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'setOperatorsPrivateUnchecked()'", async function () {
        it("Changes privacy status and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(await network.setOperatorsPrivateUnchecked(operatorIds))
                .to.emit(network, Events.OPERATORS_PRIVACY_STATUS_UPDATED)
                .withArgs(operatorIds, true);
            const operator: OperatorTuple = await views.getOperatorById(operatorIds[0]);
            await expect(operator[4]).to.be.equal(true);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsPrivateUnchecked([]))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsPrivateUnchecked([12345n]))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.connect(randomUser).setOperatorsPrivateUnchecked(operatorIds))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'setOperatorsPublicUnchecked()'", async function () {
        it("Changes privacy status and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(await network.setOperatorsPublicUnchecked(operatorIds))
                .to.emit(network, Events.OPERATORS_PRIVACY_STATUS_UPDATED)
                .withArgs(operatorIds, false);
            const operator: OperatorTuple = await views.getOperatorById(operatorIds[0]);
            await expect(operator[4]).to.be.equal(false);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the array of operators is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsPublicUnchecked([]))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'OperatorDoesNotExist' if one of operators is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.setOperatorsPublicUnchecked([12345n]))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.connect(randomUser).setOperatorsPublicUnchecked(operatorIds))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'declareOperatorFee()'", async function () {
        it("Declares new fee and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const [declarePeriod, executePeriod] = await views.getOperatorFeePeriods();
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            const tx: ContractTransactionResponse = await network.declareOperatorFee(operatorIds[0], newFee);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.DECLARE_OPERATOR_FEE]);
            const block = await tx.getBlock();
            const expectedBegin = BigInt(block!.timestamp) + declarePeriod;
            const expectedEnd = expectedBegin + executePeriod;
            await expect(tx)
                .to.emit(network, Events.OPERATOR_FEE_DECLARED)
                .withArgs(operatorOwner.address, operatorIds[0], tx.blockNumber, newFee);
            await expect(await views.getOperatorDeclaredFee(operatorIds[0]))
                .to.be.deep.equal([
                true,
                newFee,
                expectedBegin,
                expectedEnd
            ]);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
            await expect(network.declareOperatorFee(12345n, newFee))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await expect(network.connect(randomUser).declareOperatorFee(operatorIds[0], newFee))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'FeeTooLow' is the passed fee is less than minimal", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE - 1n))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
        });

        it("Is reverted with 'SameFeeChangeNotAllowed' is the passed value is the same as current one", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE))
                .to.be.revertedWithCustomError(network, Errors.SAME_FEE_CHANGE_NOW_ALLOWED);
        });

        it("Is reverted with 'FeeTooHigh' if the new fee is higher than allowed", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.declareOperatorFee(operatorIds[0], MAXIMUM_OPERATORS_FEE + 1n))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
        });

        it("Is reverted with 'FeeExceedsIncreaseLimit' if the new fee exceeds the allowed limit", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const exceedingFee = await getFeeAboveIncreaseLimit(views, operatorIds[0]);
            await expect(network.declareOperatorFee(operatorIds[0], exceedingFee))
                .to.be.revertedWithCustomError(network, Errors.FEE_EXCEEDS_INCREASE_LIMIT);
        });

        it("Is reverted with 'FeeIncreaseNotAllowed' if operators current fee is zero", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const expectedId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, 0, true);
            await expect(network.declareOperatorFee(expectedId, MINIMAL_OPERATOR_ETH_FEE))
                .to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
        });
    });

    describe("Function 'cancelDeclaredOperatorFee()'", async function () {
        it("Cancels declared fee and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.declareOperatorFee(operatorIds[0], newFee);
            const tx = await network.cancelDeclaredOperatorFee(operatorIds[0]);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.CANCEL_OPERATOR_FEE]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_FEE_DECLARATION_CANCELLED)
                .withArgs(operatorOwner, operatorIds[0]);
            await expect(await views.getOperatorDeclaredFee(operatorIds[0]))
                .to.be.deep.equal([
                false,
                0n,
                0n,
                0n
            ]);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.cancelDeclaredOperatorFee(12345n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.declareOperatorFee(operatorIds[0], newFee);
            await expect(network.connect(randomUser).cancelDeclaredOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'NoFeeDeclared' if no declarations were done before", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.cancelDeclaredOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
        });
    });

    describe("Function 'executeOperatorFee()'", async function () {
        it("Updates operator fee according to a declared one and emits the correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.declareOperatorFee(operatorIds[0], newFee);
            const [isActive, declaredFee, begin, end] = await views.getOperatorDeclaredFee(operatorIds[0]);
            await connection.networkHelpers.time.increaseTo(begin + 1n);
            await connection.networkHelpers.mine();
            const tx = await network.executeOperatorFee(operatorIds[0]);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.EXECUTE_OPERATOR_FEE]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_FEE_EXECUTED);
            await expect(await views.getOperatorFee(operatorIds[0])).to.be.equal(newFee);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.executeOperatorFee(12345n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.declareOperatorFee(operatorIds[0], newFee);
            await expect(network.connect(randomUser).executeOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'NoFeeDeclared' if no declarations were done before", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            await expect(network.executeOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
        });

        it("Is reverted with 'ApprovalNotWithinTimeframe' if execution period is not started or ended", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.declareOperatorFee(operatorIds[0], newFee);
            await expect(network.executeOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);
            const [declarePeriod, executePeriod] = await views.getOperatorFeePeriods();
            const [isActive, declaredFee, begin, end] = await views.getOperatorDeclaredFee(operatorIds[0]);
            await connection.networkHelpers.time.increaseTo(end + 1n);
            await connection.networkHelpers.mine();
            await expect(network.executeOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);
        });

        it("Is reverted with 'FeeTooHigh' if the maximum fee changed during the execution period", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 1);
            const newFee = await getValidOperatorFeeIncrease(views, operatorIds[0]);
            await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);
            const [isActive, declaredFee, begin, end] = await views.getOperatorDeclaredFee(operatorIds[0]);
            await network.connect(daoSigner).updateMaximumOperatorFee(newFee - OPERATOR_FEE_PRECISION);
            await connection.networkHelpers.time.increaseTo(begin + 1n);
            await connection.networkHelpers.mine();
            await expect(network.connect(operatorOwner).executeOperatorFee(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
        });
    });

    describe("Function 'updateMaximumOperatorFee()'", async function () {
        it("Updates maximum fee and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const tx = await network.connect(daoSigner)
                .updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE * 2n);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_MAXIMUM_FEE_UPDATED);
            await expect(await views.getMaximumOperatorFee())
                .to.be.equal(MAXIMUM_OPERATORS_FEE * 2n);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if the caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE * 2n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'reduceOperatorFee()'", async function () {
        it("Decreases fee and emits the correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);
            const tx = await network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REDUCE_OPERATOR_FEE]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_FEE_EXECUTED);
            await expect(await views.getOperatorFee(operatorId))
                .to.be.equal(MINIMAL_OPERATOR_ETH_FEE);
        });

        it("Is reverted with 'OperatorDoesNotExist' if the operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.reduceOperatorFee(12345n, MINIMAL_OPERATOR_ETH_FEE))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if the caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);
            await expect(network.connect(randomUser).reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'FeeTooLow' if the passed fee is less than minimum allowed", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);
            await expect(network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE - 1n))
                .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
        });

        it("Is reverted with 'FeeIncreaseNotAllowed' if caller is trying to increase the fee", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorKey = makeOperatorKey(1);
            const operatorId = await network.registerOperator.staticCall(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
            await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);
            await expect(network.reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE * 3n))
                .to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
        });
    });

    describe("Function 'withdrawOperatorEarnings()'", async function () {
        it("Withdraws operators earnings, update balances and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            const registrationDeposit = requiredDeposit + DEFAULT_ETH_REGISTER_VALUE;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (registrationDeposit + 10n ** 18n));
            const earningsPeriod = 100n;
            await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: registrationDeposit });
            await connection.networkHelpers.mine(earningsPeriod);
            const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
            const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);
            await expect(expectedEarnings).to.be.equal(earnings);
            const withdrawAmount = earnings + MINIMAL_OPERATOR_ETH_FEE;
            const tx = await network.connect(operatorOwner).withdrawOperatorEarnings(operatorIds[0], withdrawAmount);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_WITHDRAWN)
                .withArgs(operatorOwner.address, operatorIds[0], withdrawAmount);
            await expect(await views.getOperatorEarnings(operatorIds[0]))
                .to.be.equal(0n);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.withdrawOperatorEarnings(12345n, 9999n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(randomUser).withdrawOperatorEarnings(operatorIds[0], 9999n))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });

        it("Is reverted with 'InsufficientBalance' if the amount is less than operator earnings", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.withdrawOperatorEarnings(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE))
                .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
        });
    });

    describe("Function 'withdrawAllOperatorEarnings()'", async function () {
        it("Withdraws all operators earnings, update balances and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            const registrationDeposit = requiredDeposit + DEFAULT_ETH_REGISTER_VALUE;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (registrationDeposit + 10n ** 18n));
            const earningsPeriod = 100n;
            await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: registrationDeposit });
            await connection.networkHelpers.mine(earningsPeriod);
            const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
            const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);
            await expect(expectedEarnings).to.be.equal(earnings);
            await expect(network.connect(operatorOwner).withdrawAllOperatorEarnings(operatorIds[0]))
                .to.emit(network, Events.OPERATOR_WITHDRAWN)
                .withArgs(operatorOwner.address, operatorIds[0], earnings + MINIMAL_OPERATOR_ETH_FEE);
            await expect(await views.getOperatorEarnings(operatorIds[0]))
                .to.be.equal(0);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.withdrawAllOperatorEarnings(12345n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(randomUser).withdrawAllOperatorEarnings(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'withdrawAllVersionOperatorEarnings()'", async function () {
        it("Withdraws all operators earnings and emits correct events", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            const registrationDeposit = requiredDeposit + DEFAULT_ETH_REGISTER_VALUE;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (registrationDeposit + 10n ** 18n));
            const earningsPeriod = 100n;
            await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: registrationDeposit });
            await connection.networkHelpers.mine(earningsPeriod);
            const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
            const earnings: bigint = await views.getOperatorEarnings(operatorIds[0]);
            await expect(expectedEarnings).to.be.equal(earnings);
            await expect(network.connect(operatorOwner).withdrawAllVersionOperatorEarnings(operatorIds[0]))
                .to.emit(network, Events.OPERATOR_WITHDRAWN)
                .withArgs(operatorOwner.address, operatorIds[0], earnings + MINIMAL_OPERATOR_ETH_FEE);
            await expect(await views.getOperatorEarnings(operatorIds[0]))
                .to.be.equal(0);
        });

        it("Is reverted with 'OperatorDoesNotExist' if operator is not registered", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.withdrawAllVersionOperatorEarnings(12345n))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
        });

        it("Is reverted with 'CallerNotOwnerWithData' if caller is not the operator owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(randomUser).withdrawAllVersionOperatorEarnings(operatorIds[0]))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_OWNER)
                .withArgs(randomUser.address, operatorOwner.address);
        });
    });

    describe("Function 'setFeeRecipientAddress()'", async function () {
        it("Emits the correct event with the correct input data", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).setFeeRecipientAddress(clusterOwner.address))
                .to.emit(network, Events.FEE_RECIPIENT_ADDRESS_UPDATED)
                .withArgs(randomUser.address, clusterOwner.address);
        });
    });

    describe("Function 'updateOperatorFeeIncreaseLimit()'", async function () {
        it("Changes fee increase limit and emits the correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const tx = await network.connect(daoSigner)
                .updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE + 1n);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT]);
            await expect(tx)
                .to.emit(network, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
                .withArgs(OPERATOR_MAX_FEE_INCREASE + 1n);
            await expect(await views.getOperatorFeeIncreaseLimit()).to.be.equal(OPERATOR_MAX_FEE_INCREASE + 1n);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE + 1n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateDeclareOperatorFeePeriod()'", async function () {
        it("Changes the fee declare period and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const tx = await network.connect(daoSigner)
                .updateDeclareOperatorFeePeriod(DECLARE_OPERATOR_FEE_PERIOD + 1n);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD]);
            await expect(tx)
                .to.emit(network, Events.DECLARE_OPERATOR_FEE_PERIOD_UPDATED)
                .withArgs(DECLARE_OPERATOR_FEE_PERIOD + 1n);
            await expect(await views.getOperatorFeePeriods())
                .to.be.deep.equal([DECLARE_OPERATOR_FEE_PERIOD + 1n, EXECUTE_OPERATOR_FEE_PERIOD]);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateDeclareOperatorFeePeriod(DECLARE_OPERATOR_FEE_PERIOD + 1n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateExecuteOperatorFeePeriod()'", async function () {
        it("Changes the fee execute period and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const [initialDeclarePeriod, initialExecutePeriod] = await views.getOperatorFeePeriods();
            const newExecutePeriod = initialExecutePeriod + 1n;
            const tx = await network.connect(daoSigner)
                .updateExecuteOperatorFeePeriod(newExecutePeriod);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD]);
            await expect(tx)
                .to.emit(network, Events.EXECUTE_OPERATOR_FEE_PERIOD_UPDATED)
                .withArgs(newExecutePeriod);
            await expect(await views.getOperatorFeePeriods())
                .to.be.deep.equal([initialDeclarePeriod, newExecutePeriod]);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateExecuteOperatorFeePeriod(EXECUTE_OPERATOR_FEE_PERIOD + 1n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateLiquidationThresholdPeriod()'", async function () {
        it("Changes the period and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const newThreshold = MINIMAL_LIQUIDATION_THRESHOLD + 1n;
            const tx = await network.connect(daoSigner)
                .updateLiquidationThresholdPeriod(newThreshold);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.CHANGE_LIQUIDATION_THRESHOLD_PERIOD]);
            await expect(tx)
                .to.emit(network, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
                .withArgs(newThreshold);
            await expect(await views.getLiquidationThresholdPeriod())
                .to.be.equal(newThreshold);
        });

        it("Is reverted 'NewBlockPeriodIsBelowMinimum' if the passed threshold is less than minimum allowed", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(daoSigner).updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD - 1n))
                .to.be.revertedWithCustomError(network, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const newThreshold = MINIMAL_LIQUIDATION_THRESHOLD + 1n;
            await expect(network.connect(randomUser).updateLiquidationThresholdPeriod(newThreshold))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateLiquidationThresholdPeriodSSV()'", async function () {
        it("Changes the period and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const newThreshold = MINIMAL_LIQUIDATION_THRESHOLD + 1n;
            await expect(network.connect(daoSigner).updateLiquidationThresholdPeriodSSV(newThreshold))
                .to.emit(network, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED_SSV)
                .withArgs(newThreshold);
            await expect(await views.getLiquidationThresholdPeriodSSV())
                .to.be.equal(newThreshold);
        });

        it("Is reverted 'NewBlockPeriodIsBelowMinimum' if the passed threshold is less than minimum allowed", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(daoSigner).updateLiquidationThresholdPeriodSSV(MINIMAL_LIQUIDATION_THRESHOLD - 1n))
                .to.be.revertedWithCustomError(network, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const newThreshold = MINIMAL_LIQUIDATION_THRESHOLD + 1n;
            await expect(network.connect(randomUser).updateLiquidationThresholdPeriodSSV(newThreshold))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateMinimumLiquidationCollateral()'", async function () {
        it("Changes collateral and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const tx = await network.connect(daoSigner)
                .updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.CHANGE_MINIMUM_COLLATERAL]);
            await expect(tx)
                .to.emit(network, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED)
                .withArgs(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
            await expect(await views.getMinimumLiquidationCollateral())
                .to.be.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'updateMinimumLiquidationCollateralSSV()'", async function () {
        it("Changes collateral and emits correct event", async function () {
            const { network, views, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(daoSigner).updateMinimumLiquidationCollateralSSV(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
                .to.emit(network, Events.MINIMUM_LIQUIDATION_COLLATERAL_UPDATED_SSV)
                .withArgs(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
            await expect(await views.getMinimumLiquidationCollateralSSV())
                .to.be.equal(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n);
        });

        it("Is reverted with 'Ownable: caller is not the owner' if caller is not the owner", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.connect(randomUser).updateMinimumLiquidationCollateralSSV(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL * 2n))
                .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
        });
    });

    describe("Function 'registerValidator()'", async function () {
        it("For a new cluster, creates it with a passed validator and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
            await expect(tx).to.emit(network, Events.VALIDATOR_ADDED);
            const expectedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            await expect(await views.getValidator(clusterOwner, validatorKey)).to.equal(true);
            await expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(false);
            await expect(await views.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(false);
            await expect(await views.getBurnRate(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(await calculateInitialBurnRate(views, operatorIds, expectedCluster));
            await expect(await views.getBalance(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(requiredDeposit);
            await expect(await views.getEffectiveBalance(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(DEFAULT_ETH_EB_PER_VALIDATOR);
            await expect(await views.getClusterAssetType(clusterOwner, operatorIds))
                .to.be.equal(CLUSTER_VERSION_ETH);
            await expect(views.isLiquidatableSSV(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
            await expect(await views.getBurnRateSSV(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(0);
            await expect(await views.getBalanceSSV(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(0);
        });

        it("Registers a validator for a new ETH cluster using whitelisting contract", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            const { contract: whitelistingContract, address: whitelistingContractAddress } = await deployContract(connection.ethers, "BasicWhitelisting");
            await whitelistingContract.addWhitelistedAddress(clusterOwner.address);
            await network.setOperatorsWhitelistingContract(operatorIds, whitelistingContractAddress);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTING_CONTRACT_4]);
        });

        it("Registers a validator for a new ETH cluster with one whitelisted operator", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await network.setOperatorsPublicUnchecked([operatorIds[1], operatorIds[2], operatorIds[3]]);
            await network.setOperatorsWhitelists([operatorIds[0]], [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4]);
        });

        it("Registers a validator for a new ETH cluster with four whitelisted operators", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await network.setOperatorsWhitelists(operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4]);
        });

        it("Registers a validator into an existing ETH cluster with four whitelisted operators", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await network.setOperatorsWhitelists(operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const perValidatorBurn = sumOpFees + networkFee;
            const thresholdForOne = perValidatorBurn * 1n * minBlocks;
            const requiredForOne = thresholdForOne > minCollateral ? thresholdForOne : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredForOne + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredForOne });
            const existingCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            const currentBalance = await views.getBalance(clusterOwner.address, operatorIds, existingCluster);
            const newValidatorCount = BigInt(existingCluster.validatorCount) + 1n;
            const newThreshold = perValidatorBurn * newValidatorCount * minBlocks;
            const newRequired = newThreshold > minCollateral ? newThreshold : minCollateral;
            let additionalDeposit = newRequired > currentBalance ? newRequired - currentBalance : 0n;
            additionalDeposit += perValidatorBurn * 2n;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (additionalDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(2), operatorIds, DEFAULT_SHARES, existingCluster, { value: additionalDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4]);
        });

        it("Registers a validator into an existing ETH cluster", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const perValidatorBurn = sumOpFees + networkFee;
            const thresholdForOne = perValidatorBurn * 1n * minBlocks;
            const requiredForOne = thresholdForOne > minCollateral ? thresholdForOne : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredForOne + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredForOne });
            const existingCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            const currentBalance = await views.getBalance(clusterOwner.address, operatorIds, existingCluster);
            const newValidatorCount = BigInt(existingCluster.validatorCount) + 1n;
            const newThreshold = perValidatorBurn * newValidatorCount * minBlocks;
            const newRequired = newThreshold > minCollateral ? newThreshold : minCollateral;
            let additionalDeposit = newRequired > currentBalance ? newRequired - currentBalance : 0n;
            additionalDeposit += perValidatorBurn * 2n;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (additionalDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(2), operatorIds, DEFAULT_SHARES, existingCluster, { value: additionalDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_EXISTING_ETH_CLUSTER]);
        });

        it("Registers a validator into a prefunded ETH cluster with zero additional deposit", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const perValidatorBurn = sumOpFees + networkFee;
            const thresholdForTwo = perValidatorBurn * 2n * minBlocks;
            const requiredForTwo = thresholdForTwo > minCollateral ? thresholdForTwo : minCollateral;
            const initialDeposit = requiredForTwo + perValidatorBurn * 2n;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (initialDeposit + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: initialDeposit });
            const existingCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            const tx = await network.connect(clusterOwner).registerValidator(makePublicKey(2), operatorIds, DEFAULT_SHARES, existingCluster, { value: 0 });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the amount of operators is not the allowed one", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 5);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'InvalidPublicKeyLength' if the public key is not 48 bytes", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const invalidLengthPublicKey = makePublicKey(1) + "11";
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await expect(network.connect(clusterOwner).registerValidator(invalidLengthPublicKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INVALID_PUBLIC_KEYS_LENGTH);
        });

        it("Is reverted with 'ValidatorAlreadyExistsWithData' if the public key is already registered", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit * 2n + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit }))
                .to.be.revertedWithCustomError(network, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA)
                .withArgs(validatorKey);
        });

        it("Is reverted with 'IncorrectClusterState' for the new cluster is the cluster data is not consisting from zeroes", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const invalidCluster = { ...EMPTY_CLUSTER, validatorCount: 123n };
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, invalidCluster, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
        });

        it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const lastOp = operatorIds.pop();
            operatorIds.unshift(lastOp!);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
        });

        it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicates", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            operatorIds.pop();
            operatorIds.unshift(operatorIds[0]);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
        });

        it("Is reverted with 'CallerNotWhitelistedWithData' if one of operators did not whitelist the caller", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED)
                .withArgs(operatorIds[0]);
        });

        it("Is reverted with 'ExceedValidatorLimitWithData' if one of operators will exceed the network limit", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkValidatorsPerOperatorUpgrade");
            const factory = await connection.ethers.getContractFactory("SSVNetworkValidatorsPerOperatorUpgrade");
            const initData = factory.interface.encodeFunctionData("initializev2", [0]);
            await network.connect(daoSigner).upgradeToAndCall(upgradeImplAddr, initData);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED)
                .withArgs(operatorIds[0]);
        });

        it("Is reverted with 'InsufficientBalance' if msg value is not enough to cover the validator", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const validatorKey = makePublicKey(1);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await network.connect(daoSigner).updateMinimumLiquidationCollateral(100000n);
            await expect(network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: 0 }))
                .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
        });
    });

    describe("Function bulkRegisterValidator()", async function () {
        it("Registers bulk of validators, creates a new cluster with the expected data and emits correct events", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const numValidators = BigInt(keys.length);
            const threshold = burnRate * numValidators * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            const tx = await network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: requiredDeposit });
            await tx.wait();
            const expectedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            for (let i = 0; i < keys.length; i++) {
                await expect(await views.getValidator(clusterOwner, keys[i])).to.equal(true);
            }
            await expect(await views.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(false);
            await expect(await views.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(false);
            await expect(await views.getBurnRate(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(await calculateInitialBurnRate(views, operatorIds, expectedCluster));
            await expect(await views.getBalance(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(requiredDeposit);
            await expect(await views.getEffectiveBalance(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(DEFAULT_ETH_EB_PER_VALIDATOR * numValidators);
            await expect(await views.getClusterAssetType(clusterOwner, operatorIds))
                .to.be.equal(CLUSTER_VERSION_ETH);
            await expect(views.isLiquidatableSSV(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);
            await expect(await views.getBurnRateSSV(clusterOwner.address, operatorIds, expectedCluster))
                .to.be.equal(0);
            await expect(await views.getBalanceSSV(clusterOwner, operatorIds, expectedCluster))
                .to.be.equal(0);
        });

        it("Registers bulk of validators into an existing cluster with one whitelisting contract operator", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await network.setOperatorsPublicUnchecked([operatorIds[1], operatorIds[2], operatorIds[3]]);
            const { contract: whitelistingContract } = await deployContract(connection.ethers, "BasicWhitelisting");
            await whitelistingContract.addWhitelistedAddress(clusterOwner.address);
            await network.setOperatorsWhitelistingContract([operatorIds[0]], whitelistingContract);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const perValidatorBurn = sumOpFees + networkFee;
            const thresholdForOne = perValidatorBurn * 1n * minBlocks;
            const requiredForOne = thresholdForOne > minCollateral ? thresholdForOne : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredForOne + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredForOne });
            const existingCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            const currentBalance = await views.getBalance(clusterOwner.address, operatorIds, existingCluster);
            const newValidatorCount = BigInt(existingCluster.validatorCount) + 10n;
            const newThreshold = perValidatorBurn * newValidatorCount * minBlocks;
            const newRequired = newThreshold > minCollateral ? newThreshold : minCollateral;
            let additionalDeposit = newRequired > currentBalance ? newRequired - currentBalance : 0n;
            additionalDeposit += perValidatorBurn * 2n;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (additionalDeposit + 10n ** 18n));
            const keys = Array.from({ length: 10 }, (_, i) => makePublicKey(i + 2));
            const shares = Array(10).fill(DEFAULT_SHARES);
            const tx = await network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, existingCluster, { value: additionalDeposit });
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4]);
        });

        it("Is reverted with 'InvalidOperatorIdsLength' if the amount of operators is not the allowed one", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 5);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INVALID_OPERATOR_IDS_LENGTH);
        });

        it("Is reverted with 'InvalidPublicKeyLength' if one of public keys is not 48 bytes", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const invalidLengthPublicKey = makePublicKey(1) + "11";
            keys.shift();
            keys.unshift(invalidLengthPublicKey);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INVALID_PUBLIC_KEYS_LENGTH);
        });

        it("Is reverted with 'ValidatorAlreadyExistsWithData' if one of public keys is already registered", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const networkFee = await views.getNetworkFee();
            const minBlocks = await views.getLiquidationThresholdPeriod();
            const minCollateral = await views.getMinimumLiquidationCollateral();
            let sumOpFees = 0n;
            for (const id of operatorIds) {
                sumOpFees += await views.getOperatorFee(id);
            }
            const burnRate = sumOpFees + networkFee;
            const threshold = burnRate * minBlocks;
            const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
            await setAccountBalance(connection.ethers.provider, clusterOwner.address, (requiredDeposit + 10n ** 18n));
            await network.connect(clusterOwner).registerValidator(keys[7], operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: requiredDeposit });
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: requiredDeposit }))
                .to.be.revertedWithCustomError(network, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA)
                .withArgs(keys[7]);
        });

        it("Is reverted with 'IncorrectClusterState' for the new cluster is the cluster data is not consisting from zeroes", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const invalidCluster = { ...EMPTY_CLUSTER, validatorCount: 123n };
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, invalidCluster, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
        });

        it("Is reverted with 'UnsortedOperatorsList' if operators are not sorted in increasing order", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const lastOp = operatorIds.pop();
            operatorIds.unshift(lastOp!);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.UNSORTED_OPERATORS_LIST);
        });

        it("Is reverted with 'OperatorsListNotUnique' if the array of operators has any duplicates", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            operatorIds.pop();
            operatorIds.unshift(operatorIds[0]);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.OPERATORS_LIST_NOT_UNIQUE);
        });

        it("Is reverted with 'CallerNotWhitelistedWithData' if one of operators did not whitelist the caller", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED)
                .withArgs(operatorIds[0]);
        });

        it("Is reverted with 'ExceedValidatorLimitWithData' if one of operators will exceed the network limit", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkValidatorsPerOperatorUpgrade");
            const factory = await connection.ethers.getContractFactory("SSVNetworkValidatorsPerOperatorUpgrade");
            const initData = factory.interface.encodeFunctionData("initializev2", [0]);
            await network.connect(daoSigner).upgradeToAndCall(upgradeImplAddr, initData);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED)
                .withArgs(operatorIds[0]);
        });

        it("Is reverted with 'InsufficientBalance' if msg value is not enough to cover new validators", async function () {
            const { network, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await network.connect(daoSigner).updateMinimumLiquidationCollateral(100000n);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, EMPTY_CLUSTER, { value: 0 }))
                .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
        });

        it("Is reverted with 'EmptyPublicKeysList' if the array of public keys is empty", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            await expect(network.connect(clusterOwner).bulkRegisterValidator([], operatorIds, shares, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.EMPTY_PUBLIC_KEYS_LIST);
        });

        it("Is reverted with 'PublicKeysSharesLengthMismatch' if the array of keys and array of shares have different length", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { keys, shares } = makeArrayOfKeysAndShares(1, 10);
            const operatorIds = await registerOperators(network, operatorOwner, 4);
            await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
            const sharesWithMismatch = shares.slice(0, shares.length - 1);
            await expect(network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, sharesWithMismatch, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }))
                .to.be.revertedWithCustomError(network, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
        });
    });

    describe("Function 'removeValidator()'", async function () {
        it("Removes validator and emits correct event", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            const tx = await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REMOVE_VALIDATOR]);
            await expect(tx)
                .to.emit(network, Events.VALIDATOR_REMOVED);
            const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            await expect(clusterAfter.validatorCount).to.equal(0n);
            await expect(clusterAfter.active).to.equal(true);
            await expect(await views.getValidator(clusterOwner.address, validatorKey)).to.be.equal(false);
        });

        it("Is reverted with 'ClusterDoesNotExists' if the cluster with this owner and operators does not exist", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            await expect(network.connect(randomUser).removeValidator(validatorKey, operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
        });

        it("Is reverted with 'IncorrectClusterState' if the cluster data is incorrect", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            cluster.validatorCount += 1n;
            await expect(network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
        });

        it("Is reverted with 'ValidatorDoesNotExist' if the validator was never registered", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            const incorrectValidator: string = validatorKey + "11";
            await expect(network.connect(clusterOwner).removeValidator(incorrectValidator, operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
        });

        it("Is reveted with 'ValidatorDoesNotExist' if validator is already removed", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
            const updatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            await expect(network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, updatedCluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
        });
    });

    describe("Function 'bulkRemoveValidator()'", async function () {
        it("Is reverted with 'ClusterDoesNotExists' if the cluster with this owner and operators does not exist", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            await expect(network.connect(randomUser).bulkRemoveValidator([validatorKey], operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
        });

        it("Is reverted with 'IncorrectClusterState' if the cluster data is incorrect", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            cluster.validatorCount += 1n;
            await expect(network.connect(clusterOwner).bulkRemoveValidator([validatorKey], operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
        });

        it("Is reverted with 'IncorrectValidatorStateWithData' if the validator was never registered", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            const incorrectValidator: string = validatorKey + "11";
            await expect(network.connect(clusterOwner).bulkRemoveValidator([incorrectValidator], operatorIds, cluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE)
                .withArgs(incorrectValidator);
        });

        it("Is reveted with 'ValidatorDoesNotExist' if validator is already removed", async function () {
            const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            const { cluster, validatorKey, operatorIds } = await registerDefaultCluster(connection, network, views, operatorOwner, clusterOwner);
            await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
            const updatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
            await expect(network.connect(clusterOwner).bulkRemoveValidator([validatorKey], operatorIds, updatedCluster))
                .to.be.revertedWithCustomError(network, Errors.INCORRECT_VALIDATOR_STATE);
        });
    });

    describe("Function stake()", async function () {
        it("Stakes SSV, mints CSSV to the staker and creates delegation weight", async function () {
            const { network, views, ssvToken, cssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            const tx = await network.connect(randomUser).stake(STAKE_AMOUNT);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.STAKE_SSV]);
            await expect(tx)
                .to.emit(network, Events.STAKED)
                .withArgs(randomUser.address, STAKE_AMOUNT);
            await expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);
            await expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);
        });

        it("Is reverted with 'StakeTooLow' if the amount to stake is smaller than minimum allowed", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.stake(1))
                .to.be.revertedWithCustomError(network, Errors.STAKE_TOO_LOW);
        });

        it("Is reverted with 'ZeroAmount' is caller is trying to stake 0 SSV", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.stake(0))
                .to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
        });
    });

    describe("Function requestUnstake()", async function () {
        it("For full amount, creates unstake request, burns CSSV and removes delegation", async function () {
            const { network, views, ssvToken, cssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            await network.connect(randomUser).stake(STAKE_AMOUNT);
            const tx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT);
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.REQUEST_UNSTAKE]);
            const block = await tx.getBlock();
            await expect(tx)
                .to.emit(network, Events.UNSTAKE_REQUESTED)
                .withArgs(randomUser.address, STAKE_AMOUNT, BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            const requests: UnstakeRequest[] = await views.pendingUnstake(randomUser.address);
            await expect(requests.length).to.be.equal(1);
            await expect(requests[0].amount).to.be.equal(STAKE_AMOUNT);
            await expect(requests[0].unlockTime).to.be.equal(BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            await expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(0);
            await expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(0);
        });

        it("For partial amount, creates unstake request, burns CSSV and removes delegation", async function () {
            const { network, views, ssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            await network.connect(randomUser).stake(STAKE_AMOUNT);
            const tx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT / 2n);
            await tx.wait();
            const block = await tx.getBlock();
            await expect(tx)
                .to.emit(network, Events.UNSTAKE_REQUESTED)
                .withArgs(randomUser.address, STAKE_AMOUNT / 2n, BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            let requests: UnstakeRequest[] = await views.pendingUnstake(randomUser.address);
            await expect(requests.length).to.be.equal(1);
            await expect(requests[0].amount).to.be.equal(STAKE_AMOUNT / 2n);
            await expect(requests[0].unlockTime).to.be.equal(BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            const secondTx = await network.connect(randomUser).requestUnstake(STAKE_AMOUNT / 2n);
            await secondTx.wait();
            const secondBlock = await secondTx.getBlock();
            await expect(secondTx)
                .to.emit(network, Events.UNSTAKE_REQUESTED)
                .withArgs(randomUser.address, STAKE_AMOUNT / 2n, BigInt(secondBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            requests = await views.pendingUnstake(randomUser.address);
            await expect(requests.length).to.be.equal(2);
            await expect(requests[0].amount).to.be.equal(STAKE_AMOUNT / 2n);
            await expect(requests[0].unlockTime).to.be.equal(BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
            await expect(requests[1].amount).to.be.equal(STAKE_AMOUNT / 2n);
            await expect(requests[1].unlockTime).to.be.equal(BigInt(secondBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN);
        });

        it("Is reverted with 'MaxRequestsAmountReached' if more than 2000 pending requests", async function () {
            const { network, ssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            await network.connect(randomUser).stake(STAKE_AMOUNT);
            const smallAmount = STAKE_AMOUNT / 2001n;
            for (let i = 0; i < 2000; i++) {
                await network.connect(randomUser).requestUnstake(smallAmount);
            }
            await expect(network.connect(randomUser).requestUnstake(smallAmount))
                .to.be.revertedWithCustomError(network, Errors.MAX_REQUESTS_AMOUNT_REACHED);
        });

        it("Is reverted with 'ZeroAmount' if caller is trying to request 0 SSV", async function () {
            const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await expect(network.requestUnstake(0))
                .to.be.revertedWithCustomError(network, Errors.ZERO_AMOUNT);
        });

        it("Is reverted with 'UnstakeAmountExceedsBalance' if caller is trying to request more SSV than they staked", async function () {
            const { network, ssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            await network.connect(randomUser).stake(STAKE_AMOUNT);
            await expect(network.connect(randomUser).requestUnstake(STAKE_AMOUNT + 1n))
                .to.be.revertedWithCustomError(network, Errors.UNSTAKE_AMOUNT_EXCEEDS_BALANCE);
        });
    });

    describe("Function 'withdrawUnlocked()'", async function () {
        it("Withdraws SSV and emits correct event", async function () {
            const { network, views, ssvToken, cssvToken, daoSigner } = await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);
            await ssvToken.connect(randomUser).approve(await network.getAddress(), connection.ethers.MaxUint256);
            await ssvToken.connect(daoSigner).mint(randomUser.address, STAKE_AMOUNT);
            await network.connect(randomUser).stake(STAKE_AMOUNT);
            await network.connect(randomUser).requestUnstake(STAKE_AMOUNT);
            await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
            await networkHelpers.mine();
            const tx = await network.connect(randomUser).withdrawUnlocked();
            const receipt = await tx.wait();
            await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_UNSTAKE]);
            await expect(tx)
                .to.emit(network, Events.UNSTAKE_WITHDRAWN)
                .withArgs(randomUser.address, STAKE_AMOUNT);
            await expect(await cssvToken.balanceOf(randomUser.address)).to.be.equal(0);
            await expect(await ssvToken.balanceOf(randomUser.address)).to.be.equal(STAKE_AMOUNT);
            await expect(await views.stakedBalanceOf(randomUser.address)).to.be.equal(0);
        });
    });
});
