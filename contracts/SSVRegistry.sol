// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/VersionedContract.sol";
import "./ISSVRegistry.sol";

contract SSVRegistry is Initializable, OwnableUpgradeable, ISSVRegistry, VersionedContract {
    using Counters for Counters.Counter;

    struct Operator {
        string name;
        bytes publicKey;
        uint256 fee;
        address ownerAddress;
        uint16 score;
        uint16 indexInOwner;
        uint16 validatorCount;
        bool active;
    }

    struct Validator {
        uint32[] operatorIds;
        address ownerAddress;
        uint16 indexInOwner;
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

    uint16 public validatorsPerOperatorLimit;
    uint32 private _activeValidatorCount;
    mapping(bytes => uint32) private _operatorPublicKeyToId;

    /**
     * @dev See {ISSVRegistry-initialize}.
     */
    function initialize(uint16 validatorsPerOperatorLimit_) external override initializer {
        __SSVRegistry_init(validatorsPerOperatorLimit_);
    }

    function __SSVRegistry_init(uint16 validatorsPerOperatorLimit_) internal onlyInitializing {
        __Ownable_init_unchained();
        __SSVRegistry_init_unchained(validatorsPerOperatorLimit_);
    }

    function __SSVRegistry_init_unchained(uint16 validatorsPerOperatorLimit_) internal onlyInitializing {
        _setValidatorsPerOperatorLimit(validatorsPerOperatorLimit_);
    }

    /**
     * @dev See {ISSVRegistry-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        address ownerAddress,
        bytes calldata publicKey,
        uint256 fee
    ) external onlyOwner override returns (uint32 operatorId) {
        require(
            _operatorPublicKeyToId[publicKey] == 0,
            "operator with same public key already exists"
        );

        _lastOperatorId.increment();
        operatorId = uint32(_lastOperatorId.current());
        _operators[operatorId] = Operator({name: name, ownerAddress: ownerAddress, publicKey: publicKey, score: 0, fee: 0, active: true, indexInOwner: uint16(_operatorsByOwnerAddress[ownerAddress].length), validatorCount: 0});
        _operatorsByOwnerAddress[ownerAddress].push(operatorId);
        _operatorPublicKeyToId[publicKey] = operatorId;
        _updateOperatorFeeUnsafe(operatorId, fee);

        emit OperatorAdded(operatorId, name, ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-removeOperator}.
     */
    function removeOperator(
        uint32 operatorId
    ) external onlyOwner override {
        Operator storage operator = _operators[operatorId];
        require(operator.active, "SSVRegistry: operator deleted");

        operator.active = false;

        emit OperatorRemoved(operatorId, operator.ownerAddress, operator.publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(uint32 operatorId, uint256 fee) external onlyOwner override {
        _updateOperatorFeeUnsafe(operatorId, fee);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorScore}.
     */
    function updateOperatorScore(uint32 operatorId, uint16 score) external onlyOwner override {
        Operator storage operator = _operators[operatorId];
        operator.score = score;

        emit OperatorScoreUpdated(operatorId, operator.ownerAddress, operator.publicKey, block.number, score);
    }

    /**
     * @dev See {ISSVRegistry-registerValidator}.
     */
    function registerValidator(
        address ownerAddress,
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorIds,
            sharesPublicKeys,
            encryptedKeys
        );

        require(
            _validators[publicKey].ownerAddress == address(0),
            "validator with same public key already exists"
        );

        _validators[publicKey] = Validator({
            operatorIds: operatorIds,
            ownerAddress: ownerAddress,
            indexInOwner: uint16(_owners[ownerAddress].validators.length),
            active: true
        });

        _owners[ownerAddress].validators.push(publicKey);

        for (uint32 index = 0; index < operatorIds.length; ++index) {
            require(_operators[operatorIds[index]].active, "SSVRegistry: operator deleted");
            require(++_operators[operatorIds[index]].validatorCount <= validatorsPerOperatorLimit, "SSVRegistry: exceed validator limit");
        }

        ++_activeValidatorCount;

        emit ValidatorAdded(ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
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

        emit ValidatorRemoved(validator.ownerAddress, publicKey);

        delete _validators[publicKey];
    }

    function enableOwnerValidators(address ownerAddress) external onlyOwner override {
        _activeValidatorCount += _owners[ownerAddress].activeValidatorCount;
        _owners[ownerAddress].validatorsDisabled = false;

        emit OwnerValidatorsEnabled(ownerAddress);
    }

    function disableOwnerValidators(address ownerAddress) external onlyOwner override {
        _activeValidatorCount -= _owners[ownerAddress].activeValidatorCount;
        _owners[ownerAddress].validatorsDisabled = true;

        emit OwnerValidatorsDisabled(ownerAddress);
    }

    /**
     * @dev See {ISSVRegistry-setValidatorsPerOperatorLimit}.
     */
    function setValidatorsPerOperatorLimit(uint16 _validatorsPerOperatorLimit) onlyOwner external override {
        _setValidatorsPerOperatorLimit(_validatorsPerOperatorLimit);
    }

    function isOwnerValidatorsDisabled(address ownerAddress) external view override returns (bool) {
        return _owners[ownerAddress].validatorsDisabled;
    }

    /**
     * @dev See {ISSVRegistry-operators}.
     */
    function operators(uint32 operatorId) external view override returns (string memory, address, bytes memory, uint256, bool) {
        Operator storage operator = _operators[operatorId];
        return (operator.name, operator.ownerAddress, operator.publicKey, operator.score, operator.active);
    }

    /**
     * @dev See {ISSVRegistry-operatorsByPublicKey}.
     */
    function operatorsByPublicKey(bytes memory publicKey) external view override returns (string memory, address, bytes memory, uint256, bool) {
        Operator storage operator = _operators[_operatorPublicKeyToId[publicKey]];
        return (operator.name, operator.ownerAddress, operator.publicKey, operator.score, operator.active);
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
     * @dev See {ISSVRegistry-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(uint32 operatorId) external view override returns (uint256) {
        require(_operators[operatorId].ownerAddress != address(0), "SSVRegistry: operator not found");
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
     * @dev See {ISSVRegistry-getValidatorsPerOperatorLimit}.
     */
    function getValidatorsPerOperatorLimit() external view override returns (uint16) {
        return validatorsPerOperatorLimit;
    }

    /**
     * @dev See {ISSVRegistry-validatorsPerOperatorCount}.
     */
    function validatorsPerOperatorCount(uint32 operatorId) external view override returns (uint16) {
        return _operators[operatorId].validatorCount;
    }

    function _setValidatorsPerOperatorLimit(uint16 _validatorsPerOperatorLimit) private {
        validatorsPerOperatorLimit = _validatorsPerOperatorLimit;
        emit ValidatorsPerOperatorLimitSet(validatorsPerOperatorLimit);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function _updateOperatorFeeUnsafe(uint32 operatorId, uint256 fee) private {
        _operators[operatorId].fee = fee;

        emit OperatorFeeUpdated(operatorId, _operators[operatorId].ownerAddress, _operators[operatorId].publicKey, block.number, fee);
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
        require(publicKey.length == 48, "invalid public key length");
        require(
            operatorIds.length == sharesPublicKeys.length &&
            operatorIds.length == encryptedKeys.length &&
            operatorIds.length >= 4 && operatorIds.length % 3 == 1,
            "OESS data structure is not valid"
        );
    }

    function version() external pure override returns (uint32) {
        return 1;
    }

    uint256[50] ______gap;
}
