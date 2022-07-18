// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/VersionedContract.sol";
import "./utils/Types.sol";
import "./ISSVRegistry.sol";

contract SSVRegistry is Initializable, OwnableUpgradeable, ISSVRegistry, VersionedContract {
    using Counters for Counters.Counter;
    using Types256 for uint256;
    using Types64 for uint64;

    struct Operator {
        string name;
        bytes publicKey;
        uint64 fee;
        address ownerAddress;
        uint32 score;
        uint32 indexInOwner;
        uint32 validatorCount;
        bool active;
    }

    struct Validator {
        uint32[] operatorIds;
        address ownerAddress;
        uint32 indexInOwner;
        bool active;
    }

    struct OwnerData {
        uint32 activeValidatorCount;
        bool validatorsDisabled;
        bytes[] validators;
    }


    Counters.Counter private _lastOperatorId;

    mapping(uint32 => Operator) private _operators;
    mapping(bytes => Validator) private _validators;
    mapping(address => uint32[]) private _operatorsByOwnerAddress;
    mapping(address => OwnerData) private _owners;

    uint32 private _activeValidatorCount;

    uint32 constant private VALIDATORS_PER_OPERATOR_LIMIT = 2000;
    uint32 constant private REGISTERED_OPERATORS_PER_ACCOUNT_LIMIT = 10;

    /**
     * @dev See {ISSVRegistry-initialize}.
     */
    function initialize() external override initializer {
        __SSVRegistry_init();
    }

    function __SSVRegistry_init() internal onlyInitializing {
        __Ownable_init_unchained();
        __SSVRegistry_init_unchained();
    }

    function __SSVRegistry_init_unchained() internal onlyInitializing {
    }

    /**
     * @dev See {ISSVRegistry-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        address ownerAddress,
        bytes calldata publicKey,
        uint64 fee
    ) external onlyOwner override returns (uint32 operatorId) {

        if (_operatorsByOwnerAddress[ownerAddress].length >= REGISTERED_OPERATORS_PER_ACCOUNT_LIMIT) {
            revert ExceedRegisteredOperatorsByAccountLimit();
        }

        _lastOperatorId.increment();
        operatorId = uint32(_lastOperatorId.current());
        _operators[operatorId] = Operator({name: name, ownerAddress: ownerAddress, publicKey: publicKey, score: 0, fee: 0, active: true, indexInOwner: uint32(_operatorsByOwnerAddress[ownerAddress].length), validatorCount: 0});
        _operatorsByOwnerAddress[ownerAddress].push(operatorId);
        _updateOperatorFeeUnsafe(operatorId, fee);
    }

    /**
     * @dev See {ISSVRegistry-removeOperator}.
     */
    function removeOperator(
        uint32 operatorId
    ) external onlyOwner override {
        Operator storage operator = _operators[operatorId];

        if (!operator.active) {
            revert OperatorDeleted();
        }

        operator.active = false;
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(uint32 operatorId, uint64 fee) external onlyOwner override {
        _updateOperatorFeeUnsafe(operatorId, fee);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorScore}.
     */
    function updateOperatorScore(uint32 operatorId, uint32 score) external onlyOwner override {
        Operator storage operator = _operators[operatorId];
        operator.score = score;
    }

    /**
     * @dev See {ISSVRegistry-registerValidator}.
     */
    function registerValidator(
        address ownerAddress,
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata sharesEncrypted
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorIds,
            sharesPublicKeys,
            sharesEncrypted
        );

        if (_validators[publicKey].ownerAddress != address(0)) {
            revert ValidatorAlreadyExists();
        }

        _validators[publicKey] = Validator({
            operatorIds: operatorIds,
            ownerAddress: ownerAddress,
            indexInOwner: uint32(_owners[ownerAddress].validators.length),
            active: true
        });

        _owners[ownerAddress].validators.push(publicKey);

        for (uint32 index = 0; index < operatorIds.length; ++index) {
            if (!_operators[operatorIds[index]].active) {
                revert OperatorDeleted();
            }

            if (++_operators[operatorIds[index]].validatorCount > VALIDATORS_PER_OPERATOR_LIMIT) {
                revert ExceedValidatorLimit();
            }
        }
        ++_activeValidatorCount;
    }

    /**
     * @dev See {ISSVRegistry-removeValidator}.
     */
    function removeValidator(
        bytes calldata publicKey
    ) external onlyOwner override {
        Validator storage validator = _validators[publicKey];

        for (uint32 index = 0; index < validator.operatorIds.length; ++index) {
            --_operators[validator.operatorIds[index]].validatorCount;
        }

        bytes[] storage ownerValidators = _owners[validator.ownerAddress].validators;

        ownerValidators[validator.indexInOwner] = ownerValidators[ownerValidators.length - 1];
        _validators[ownerValidators[validator.indexInOwner]].indexInOwner = validator.indexInOwner;
        ownerValidators.pop();

        --_activeValidatorCount;

        delete _validators[publicKey];
    }

    function enableOwnerValidators(address ownerAddress) external onlyOwner override {
        _activeValidatorCount += _owners[ownerAddress].activeValidatorCount;
        _owners[ownerAddress].validatorsDisabled = false;
    }

    function disableOwnerValidators(address ownerAddress) external onlyOwner override {
        _activeValidatorCount -= _owners[ownerAddress].activeValidatorCount;
        _owners[ownerAddress].validatorsDisabled = true;
    }

    function isLiquidated(address ownerAddress) external view override returns (bool) {
        return _owners[ownerAddress].validatorsDisabled;
    }

    /**
     * @dev See {ISSVRegistry-operators}.
     */
    function getOperatorById(uint32 operatorId) external view override returns (string memory, address, bytes memory, uint256, uint256, uint256, bool) {
        Operator storage operator = _operators[operatorId];
        return (operator.name, operator.ownerAddress, operator.publicKey, _operators[operatorId].validatorCount, operator.fee.expand(), operator.score, operator.active);
    }

    /**
     * @dev See {ISSVRegistry-getOperatorsByOwnerAddress}.
     */
    function getOperatorsByOwnerAddress(address ownerAddress) external view override returns (uint32[] memory) {
        return _operatorsByOwnerAddress[ownerAddress];
    }

    /**
     * @dev See {ISSVRegistry-getOperatorsByValidator}.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey) external view override returns (uint32[] memory operatorIds) {
        Validator storage validator = _validators[validatorPublicKey];

        return validator.operatorIds;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorOwner}.
     */
    function getOperatorOwner(uint32 operatorId) external view override returns (address) {
        return _operators[operatorId].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorFee}.
     */
    function getOperatorFee(uint32 operatorId) external view override returns (uint64) {
        if (_operators[operatorId].ownerAddress == address(0)) {
            revert OperatorNotFound();
        }
        return _operators[operatorId].fee;
    }

    /**
     * @dev See {ISSVRegistry-activeValidatorCount}.
     */
    function activeValidatorCount() external view override returns (uint32) {
        return _activeValidatorCount;
    }

    /**
     * @dev See {ISSVRegistry-validators}.
     */
    function validators(bytes calldata publicKey) external view override returns (address, bytes memory, bool) {
        Validator storage validator = _validators[publicKey];

        return (validator.ownerAddress, publicKey, validator.active);
    }

    /**
     * @dev See {ISSVRegistry-getValidatorsByAddress}.
     */
    function getValidatorsByAddress(address ownerAddress) external view override returns (bytes[] memory) {
        return _owners[ownerAddress].validators;
    }

    /**
     * @dev See {ISSVRegistry-getValidatorOwner}.
     */
    function getValidatorOwner(bytes calldata publicKey) external view override returns (address) {
        return _validators[publicKey].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-validatorsPerOperatorCount}.
     */
    function validatorsPerOperatorCount(uint32 operatorId) external view override returns (uint32) {
        return _operators[operatorId].validatorCount;
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function _updateOperatorFeeUnsafe(uint32 operatorId, uint64 fee) private {
        _operators[operatorId].fee = fee;
    }

    /**
     * @dev Validates the paramss for a validator.
     * @param publicKey Validator public key.
     * @param operatorIds Operator operatorIds.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function _validateValidatorParams(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
        if (
            operatorIds.length != sharesPublicKeys.length ||
            operatorIds.length != encryptedKeys.length ||
            operatorIds.length < 4 || operatorIds.length % 3 != 1
        ) {
            revert OessDataStructureInvalid();
        }
    }

    function version() external pure override returns (uint32) {
        return 1;
    }

    uint256[50] ______gap;
}
