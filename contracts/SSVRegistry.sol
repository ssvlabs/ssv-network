// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./ISSVRegistry.sol";

contract SSVRegistry is Initializable, OwnableUpgradeable, ISSVRegistry {
    using Counters for Counters.Counter;

    struct Operator {
        string name;
        address ownerAddress;
        bytes publicKey;
        uint256 score;
        bool active;
        uint indexInOwner;
    }

    struct Validator {
        address ownerAddress;
        uint256[] operatorIds;
        bool active;
        uint256 indexInOwner;
    }

    struct DistributedKey {
        uint requestTime;
        address ownerAddress;
        uint256[] operatorIds;
        bytes publicKey;
        uint256 confirmations;
        bytes[] sharesPublicKeys;
        bytes[] encryptedKeys;
    }

    struct OperatorFee {
        uint256 blockNumber;
        uint256 fee;
    }

    struct OwnerData {
        uint256 activeValidatorCount;
        bool validatorsDisabled;
    }

    uint256 private _activeValidatorCount;

    Counters.Counter private _lastOperatorId;
    Counters.Counter private _lastDistributedKeyId;

    mapping(uint256 => Operator) private _operators;
    mapping(bytes => Validator) private _validators;
    mapping(uint256 => DistributedKey) private _distributedKeys;
    mapping(uint256 => OperatorFee[]) private _operatorFees;

    mapping(address => uint256[]) private _operatorsByOwnerAddress;
    mapping(address => bytes[]) private _validatorsByOwnerAddress;
    mapping(address => OwnerData) private _owners;

    mapping(uint256 => uint256) internal validatorsPerOperator;
    uint256 public validatorsPerOperatorLimit;
    mapping(bytes => uint256) private _operatorPublicKeyToId;

    /**
     * @dev See {ISSVRegistry-initialize}.
     */
    function initialize(uint256 validatorsPerOperatorLimit_) external override initializer {
        __SSVRegistry_init(validatorsPerOperatorLimit_);
    }

    function __SSVRegistry_init(uint256 validatorsPerOperatorLimit_) internal initializer {
        __Ownable_init_unchained();
        __SSVRegistry_init_unchained(validatorsPerOperatorLimit_);
    }

    function __SSVRegistry_init_unchained(uint256 validatorsPerOperatorLimit_) internal initializer {
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }

    /**
     * @dev See {ISSVRegistry-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        address ownerAddress,
        bytes calldata publicKey,
        uint256 fee
    ) external onlyOwner override returns (uint256 operatorId) {
        require(
            _operatorPublicKeyToId[publicKey] == 0,
            "operator with same public key already exists"
        );

        _lastOperatorId.increment();
        operatorId = _lastOperatorId.current();
        _operators[operatorId] = Operator(name, ownerAddress, publicKey, 0, false, _operatorsByOwnerAddress[ownerAddress].length);
        _operatorsByOwnerAddress[ownerAddress].push(operatorId);
        _operatorPublicKeyToId[publicKey] = operatorId;
        _updateOperatorFeeUnsafe(operatorId, fee);
        _activateOperatorUnsafe(operatorId);

        emit OperatorAdded(operatorId, name, ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-removeOperator}.
     */
    function removeOperator(
        uint256 operatorId
    ) external onlyOwner override {
        require(validatorsPerOperator[operatorId] == 0, "operator has validators");

        Operator storage operator = _operators[operatorId];
        _operatorsByOwnerAddress[operator.ownerAddress][operator.indexInOwner] = _operatorsByOwnerAddress[operator.ownerAddress][_operatorsByOwnerAddress[operator.ownerAddress].length - 1];
        _operators[_operatorsByOwnerAddress[operator.ownerAddress][operator.indexInOwner]].indexInOwner = operator.indexInOwner;
        _operatorsByOwnerAddress[operator.ownerAddress].pop();

        emit OperatorRemoved(operatorId, operator.ownerAddress, operator.publicKey);

        delete validatorsPerOperator[operatorId];
        delete _operatorPublicKeyToId[operator.publicKey];
        delete _operators[operatorId];
    }

    /**
     * @dev See {ISSVRegistry-activateOperator}.
     */
    function activateOperator(uint256 operatorId) external onlyOwner override {
        _activateOperatorUnsafe(operatorId);
    }

    /**
     * @dev See {ISSVRegistry-deactivateOperator}.
     */
    function deactivateOperator(uint256 operatorId) external onlyOwner override {
        _deactivateOperatorUnsafe(operatorId);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(uint256 operatorId, uint256 fee) external onlyOwner override {
        _updateOperatorFeeUnsafe(operatorId, fee);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorScore}.
     */
    function updateOperatorScore(uint256 operatorId, uint256 score) external onlyOwner override {
        Operator storage operator = _operators[operatorId];
        operator.score = score;

        emit OperatorScoreUpdated(operatorId, operator.ownerAddress, operator.publicKey, block.number, score);
    }

    /**
     * @dev See {ISSVRegistry-requestDistributedKey}.
     */
     function requestDistributedKey(
        address ownerAddress,
        uint256[] calldata operatorIds
    ) external override returns (uint256 distributedKeyId) {
        require(operatorIds.length >= 4 && operatorIds.length <= 255, "invalid number of operators");
        _lastDistributedKeyId.increment();
        distributedKeyId = _lastDistributedKeyId.current();
        DistributedKey storage distributedKey = _distributedKeys[distributedKeyId];
        distributedKey.requestTime = block.timestamp;
        distributedKey.ownerAddress = ownerAddress;
        distributedKey.operatorIds = operatorIds;
        emit DistributedKeyRequested(distributedKeyId, ownerAddress, operatorIds);
    }

    /**
     * @dev See {ISSVRegistry-reportDistributedKey}.
     */
    function reportDistributedKey(
        uint256 operatorId,
        uint256 distributedKeyId,
        uint256 operatorIndex,
        bytes calldata publicKey,
        bytes calldata sharePublicKey,
        bytes calldata encryptedKey
    ) external onlyOwner override returns (bool) {
        DistributedKey storage distributedKey = _distributedKeys[distributedKeyId];
        require(distributedKey.operatorIds[operatorIndex - 1] == operatorId, "operatorId mismatch");

        if (distributedKey.publicKey.length == 0) {
            // First report
            distributedKey.publicKey = publicKey;
        } else {
            // Subsequent reports
            require(keccak256(distributedKey.publicKey) == keccak256(publicKey), "disagreement in public key");
        }

        distributedKey.sharesPublicKeys[operatorIndex - 1] = sharePublicKey;
        distributedKey.encryptedKeys[operatorIndex - 1] = encryptedKey;
        distributedKey.confirmations &= 1 << (operatorIndex - 1);
        uint256 requiredConfirmations = (1 << distributedKey.operatorIds.length) - 1;
        return distributedKey.confirmations == requiredConfirmations;
    }

    /**
     * @dev See {ISSVRegistry-activateDistributeKey}.
     */
    function activateDistributeKey(uint256 distributedKeyId) external onlyOwner override{
        DistributedKey memory distributedKey = _distributedKeys[distributedKeyId];
        require(distributedKey.operatorIds.length > 0, "distributed key not found");

        uint256 requiredConfirmations = (1 << distributedKey.operatorIds.length) - 1;
        require(distributedKey.confirmations == requiredConfirmations, "distributed key is not confirmed");

        _addValidator(distributedKey.ownerAddress, distributedKey.publicKey, distributedKey.operatorIds, distributedKey.sharesPublicKeys, distributedKey.encryptedKeys);
    }

    /**
     * @dev See {ISSVRegistry-registerValidator}.
     */
     function registerValidator(
        address ownerAddress,
        bytes calldata publicKey,
        uint256[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorIds,
            sharesPublicKeys,
            encryptedKeys
        );

        _addValidator(ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
    }

    /**
     * @dev See {ISSVRegistry-updateValidator}.
     */
    function updateValidator(
        bytes calldata publicKey,
        uint256[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorIds,
            sharesPublicKeys,
            encryptedKeys
        );
        Validator storage validator = _validators[publicKey];

        for (uint256 index = 0; index < validator.operatorIds.length; ++index) {
            --validatorsPerOperator[validator.operatorIds[index]];
        }

        validator.operatorIds = operatorIds;

        for (uint256 index = 0; index < operatorIds.length; ++index) {
            require(++validatorsPerOperator[operatorIds[index]] <= validatorsPerOperatorLimit, "exceed validator limit");
        }

        emit ValidatorUpdated(validator.ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
    }

    /**
     * @dev See {ISSVRegistry-removeValidator}.
     */
    function removeValidator(
        bytes calldata publicKey
    ) external onlyOwner override {
        Validator storage validator = _validators[publicKey];

        for (uint256 index = 0; index < validator.operatorIds.length; ++index) {
            --validatorsPerOperator[validator.operatorIds[index]];
        }

        _validatorsByOwnerAddress[validator.ownerAddress][validator.indexInOwner] = _validatorsByOwnerAddress[validator.ownerAddress][_validatorsByOwnerAddress[validator.ownerAddress].length - 1];
        _validators[_validatorsByOwnerAddress[validator.ownerAddress][validator.indexInOwner]].indexInOwner = validator.indexInOwner;
        _validatorsByOwnerAddress[validator.ownerAddress].pop();

        --_activeValidatorCount;
        --_owners[validator.ownerAddress].activeValidatorCount;

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

    function isOwnerValidatorsDisabled(address ownerAddress) external view override returns (bool) {
        return _owners[ownerAddress].validatorsDisabled;
    }

    /**
     * @dev See {ISSVRegistry-operators}.
     */
    function operators(uint256 operatorId) external view override returns (string memory, address, bytes memory, uint256, bool) {
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
    function getOperatorsByOwnerAddress(address ownerAddress) external view override returns (uint256[] memory) {
        return _operatorsByOwnerAddress[ownerAddress];
    }

    /**
     * @dev See {ISSVRegistry-getOperatorsByValidator}.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey) external view override returns (uint256[] memory operatorIds) {
        Validator storage validator = _validators[validatorPublicKey];

        return validator.operatorIds;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorOwner}.
     */
    function getOperatorOwner(uint256 operatorId) external override view returns (address) {
        return _operators[operatorId].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(uint256 operatorId) external view override returns (uint256) {
        require(_operatorFees[operatorId].length > 0, "operator not found");
        return _operatorFees[operatorId][_operatorFees[operatorId].length - 1].fee;
    }

    /**
     * @dev See {ISSVRegistry-activeValidatorCount}.
     */
    function activeValidatorCount() external view override returns (uint256) {
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
        return _validatorsByOwnerAddress[ownerAddress];
    }

    /**
     * @dev See {ISSVRegistry-getValidatorOwner}.
     */
    function getValidatorOwner(bytes calldata publicKey) external view override returns (address) {
        return _validators[publicKey].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-setValidatorsPerOperatorLimit}.
     */
    function setValidatorsPerOperatorLimit(uint256 _validatorsPerOperatorLimit) onlyOwner external override {
        validatorsPerOperatorLimit = _validatorsPerOperatorLimit;
    }

    /**
     * @dev See {ISSVRegistry-getValidatorsPerOperatorLimit}.
     */
    function getValidatorsPerOperatorLimit() external view override returns (uint256) {
        return validatorsPerOperatorLimit;
    }

    /**
     * @dev See {ISSVRegistry-validatorsPerOperatorCount}.
     */
    function validatorsPerOperatorCount(uint256 operatorId) external override view returns (uint256) {
        return validatorsPerOperator[operatorId];
    }

    /**
     * @dev See {ISSVRegistry-activateOperator}.
     */
    function _activateOperatorUnsafe(uint256 operatorId) private {
        require(!_operators[operatorId].active, "already active");
        _operators[operatorId].active = true;

        emit OperatorActivated(operatorId, _operators[operatorId].ownerAddress, _operators[operatorId].publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deactivateOperator}.
     */
    function _deactivateOperatorUnsafe(uint256 operatorId) private {
        require(_operators[operatorId].active, "already inactive");
        _operators[operatorId].active = false;

        emit OperatorDeactivated(operatorId, _operators[operatorId].ownerAddress, _operators[operatorId].publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function _updateOperatorFeeUnsafe(uint256 operatorId, uint256 fee) private {
        _operatorFees[operatorId].push(
            OperatorFee(block.number, fee)
        );

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
        uint256[] calldata operatorIds,
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

    function _addValidator(
        address ownerAddress,
        bytes memory publicKey,
        uint256[] memory operatorIds,
        bytes[] memory sharesPublicKeys,
        bytes[] memory encryptedKeys
    ) private {
        require(
            _validators[publicKey].ownerAddress == address(0),
            "validator with same public key already exists"
        );

        _validators[publicKey] = Validator(ownerAddress, operatorIds, true, _validatorsByOwnerAddress[ownerAddress].length);
        _validatorsByOwnerAddress[ownerAddress].push(publicKey);

        for (uint256 index = 0; index < operatorIds.length; ++index) {
            require(++validatorsPerOperator[operatorIds[index]] <= validatorsPerOperatorLimit, "exceed validator limit");
        }

        ++_activeValidatorCount;
        ++_owners[_validators[publicKey].ownerAddress].activeValidatorCount;

        emit ValidatorAdded(ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
    }
}
