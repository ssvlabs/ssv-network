// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./ISSVRegistry.sol";

contract SSVRegistry is Initializable, OwnableUpgradeable, ISSVRegistry {
    struct Operator {
        string name;
        address ownerAddress;
        bytes publicKey;
        uint256 score;
        bool active;
        uint256 index;
    }

    struct Validator {
        address ownerAddress;
        bytes publicKey;
        Oess[] oess;
        bool active;
        uint256 index;
    }

    struct OperatorFee {
        uint256 blockNumber;
        uint256 fee;
    }

    struct OwnerData {
        uint256 activeValidatorCount;
        bool validatorsDisabled;
    }

    uint256 private _operatorCount;
    uint256 private _validatorCount;
    uint256 private _activeValidatorCount;

    mapping(bytes => Operator) private _operators;
    mapping(bytes => Validator) private _validators;

    mapping(bytes => OperatorFee[]) private _operatorFees;

    mapping(address => bytes[]) private _operatorsByOwnerAddress;
    mapping(address => bytes[]) private _validatorsByAddress;
    mapping(address => OwnerData) private _owners;

    /**
     * @dev See {ISSVRegistry-initialize}.
     */
    function initialize() external override initializer {
        __SSVRegistry_init();
    }

    function __SSVRegistry_init() internal initializer {
        __Ownable_init_unchained();
        __SSVRegistry_init_unchained();
    }

    function __SSVRegistry_init_unchained() internal initializer {
    }

    /**
     * @dev See {ISSVRegistry-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        address ownerAddress,
        bytes calldata publicKey,
        uint256 fee
    ) external onlyOwner override {
        require(
            _operators[publicKey].ownerAddress == address(0),
            "operator with same public key already exists"
        );
        _operators[publicKey] = Operator(name, ownerAddress, publicKey, 0, false, _operatorsByOwnerAddress[ownerAddress].length);
        _operatorsByOwnerAddress[ownerAddress].push(publicKey);
        _updateOperatorFeeUnsafe(publicKey, fee);
        _activateOperatorUnsafe(publicKey);

        emit OperatorAdded(name, ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deleteOperator}.
     */
    function deleteOperator(
        bytes calldata publicKey
    ) external onlyOwner override {
        Operator storage operator = _operators[publicKey];
        _operatorsByOwnerAddress[operator.ownerAddress][operator.index] = _operatorsByOwnerAddress[operator.ownerAddress][_operatorsByOwnerAddress[operator.ownerAddress].length - 1];
        _operators[_operatorsByOwnerAddress[operator.ownerAddress][operator.index]].index = operator.index;
        _operatorsByOwnerAddress[operator.ownerAddress].pop();

        emit OperatorDeleted(operator.ownerAddress, publicKey);

        delete _operators[publicKey];
        --_operatorCount;

    }

    /**
     * @dev See {ISSVRegistry-activateOperator}.
     */
    function activateOperator(bytes calldata publicKey) external onlyOwner override {
        _activateOperatorUnsafe(publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deactivateOperator}.
     */
    function deactivateOperator(bytes calldata publicKey) external onlyOwner override {
        _deactivateOperatorUnsafe(publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata publicKey, uint256 fee) external onlyOwner override {
        _updateOperatorFeeUnsafe(publicKey, fee);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorScore}.
     */
    function updateOperatorScore(bytes calldata publicKey, uint256 score) external onlyOwner override {
        Operator storage operator = _operators[publicKey];
        operator.score = score;

        emit OperatorScoreUpdated(operator.ownerAddress, publicKey, block.number, score);
    }

    /**
     * @dev See {ISSVRegistry-registerValidator}.
     */
    function registerValidator(
        address ownerAddress,
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );
        require(ownerAddress != address(0), "owner address invalid");
        require(
            _validators[publicKey].ownerAddress == address(0),
            "validator with same public key already exists"
        );

        Validator storage validator = _validators[publicKey];
        validator.publicKey = publicKey;
        validator.ownerAddress = ownerAddress;

        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            validator.oess.push(
                Oess(
                    operatorPublicKeys[index],
                    sharesPublicKeys[index],
                    encryptedKeys[index]
                )
            );
        }

        validator.index = _validatorsByAddress[ownerAddress].length;
        _validatorsByAddress[ownerAddress].push(publicKey);

        ++_validatorCount;

        _activateValidatorUnsafe(publicKey);

        emit ValidatorAdded(ownerAddress, publicKey, validator.oess);
    }

    /**
     * @dev See {ISSVRegistry-updateValidator}.
     */
    function updateValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) external onlyOwner override {
        _validateValidatorParams(
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );
        Validator storage validator = _validators[publicKey];
        delete validator.oess;

        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            validator.oess.push(
                Oess(
                    operatorPublicKeys[index],
                    sharesPublicKeys[index],
                    encryptedKeys[index]
                )
            );
        }

        emit ValidatorUpdated(validator.ownerAddress, publicKey, validator.oess);
    }

    /**
     * @dev See {ISSVRegistry-deleteValidator}.
     */
    function deleteValidator(
        bytes calldata publicKey
    ) external onlyOwner override {
        Validator storage validator = _validators[publicKey];
        _validatorsByAddress[validator.ownerAddress][validator.index] = _validatorsByAddress[validator.ownerAddress][_validatorsByAddress[validator.ownerAddress].length - 1];
        _validators[_validatorsByAddress[validator.ownerAddress][validator.index]].index = validator.index;
        _validatorsByAddress[validator.ownerAddress].pop();

        --_validatorCount;
        --_activeValidatorCount;
        --_owners[validator.ownerAddress].activeValidatorCount;

        emit ValidatorDeleted(validator.ownerAddress, publicKey);

        delete _validators[publicKey];
    }

    /**
     * @dev See {ISSVRegistry-activateValidator}.
     */
    function activateValidator(bytes calldata publicKey) external onlyOwner override {
        _activateValidatorUnsafe(publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deactivateValidator}.
     */
    function deactivateValidator(bytes calldata publicKey) external onlyOwner override {
        _deactivateValidatorUnsafe(publicKey);
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
     * @dev See {ISSVRegistry-operatorCount}.
     */
    function operatorCount() external view override returns (uint256) {
        return _operatorCount;
    }

    /**
     * @dev See {ISSVRegistry-operators}.
     */
    function operators(bytes calldata publicKey) external view override returns (string memory, address, bytes memory, uint256, bool, uint256) {
        Operator storage operator = _operators[publicKey];
        return (operator.name, operator.ownerAddress, operator.publicKey, operator.score, operator.active, operator.index);
    }

    /**
     * @dev See {ISSVRegistry-getOperatorsByOwnerAddress}.
     */
    function getOperatorsByOwnerAddress(address ownerAddress) external view override returns (bytes[] memory) {
        return _operatorsByOwnerAddress[ownerAddress];
    }

    /**
     * @dev See {ISSVRegistry-getOperatorsByValidator}.
     */
    function getOperatorsByValidator(bytes calldata validatorPublicKey) external view override returns (bytes[] memory operatorPublicKeys) {
        Validator storage validator = _validators[validatorPublicKey];

        operatorPublicKeys = new bytes[](validator.oess.length);
        for (uint256 index = 0; index < validator.oess.length; ++index) {
            operatorPublicKeys[index] = validator.oess[index].operatorPublicKey;
        }
    }

    /**
     * @dev See {ISSVRegistry-getOperatorOwner}.
     */
    function getOperatorOwner(bytes calldata publicKey) onlyOwner external override view returns (address) {
        return _operators[publicKey].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(bytes calldata operatorPublicKey) external view override returns (uint256) {
        require(_operatorFees[operatorPublicKey].length > 0, "operator not found");
        return _operatorFees[operatorPublicKey][_operatorFees[operatorPublicKey].length - 1].fee;
    }

    /**
     * @dev See {ISSVRegistry-validatorCount}.
     */
    function validatorCount() external view override returns (uint256) {
        return _validatorCount;
    }

    /**
     * @dev See {ISSVRegistry-validatorCount}.
     */
    function activeValidatorCount() external view override returns (uint256) {
        return _activeValidatorCount;
    }

    /**
     * @dev See {ISSVRegistry-validators}.
     */
    function validators(bytes calldata publicKey) external view override returns (address, bytes memory, bool, uint256) {
        Validator storage validator = _validators[publicKey];

        return (validator.ownerAddress, validator.publicKey, validator.active, validator.index);
    }

    /**
     * @dev See {ISSVRegistry-getValidatorsByAddress}.
     */
    function getValidatorsByAddress(address ownerAddress) external view override returns (bytes[] memory) {
        return _validatorsByAddress[ownerAddress];
    }

    /**
     * @dev See {ISSVRegistry-getValidatorOwner}.
     */
    function getValidatorOwner(bytes calldata publicKey) external view override returns (address) {
        return _validators[publicKey].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-activateOperator}.
     */
    function _activateOperatorUnsafe(bytes calldata publicKey) private {
        require(!_operators[publicKey].active, "already active");
        _operators[publicKey].active = true;
        ++_operatorCount;

        emit OperatorActivated(_operators[publicKey].ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deactivateOperator}.
     */
    function _deactivateOperatorUnsafe(bytes calldata publicKey) private {
        require(_operators[publicKey].active, "already inactive");
        _operators[publicKey].active = false;
        --_operatorCount;

        emit OperatorDeactivated(_operators[publicKey].ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function _updateOperatorFeeUnsafe(bytes calldata publicKey, uint256 fee) private {
        _operatorFees[publicKey].push(
            OperatorFee(block.number, fee)
        );

        emit OperatorFeeUpdated(_operators[publicKey].ownerAddress, publicKey, block.number, fee);
    }

    /**
     * @dev See {ISSVRegistry-activateValidator}.
     */
    function _activateValidatorUnsafe(bytes calldata publicKey) private {
        require(!_validators[publicKey].active, "already active");
        _validators[publicKey].active = true;
        ++_activeValidatorCount;
        ++_owners[_validators[publicKey].ownerAddress].activeValidatorCount;

        emit ValidatorActivated(_validators[publicKey].ownerAddress, publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deactivateValidator}.
     */
    function _deactivateValidatorUnsafe(bytes calldata publicKey) private {
        require(_validators[publicKey].active, "already inactive");
        _validators[publicKey].active = false;
        --_activeValidatorCount;
        --_owners[_validators[publicKey].ownerAddress].activeValidatorCount;

        emit ValidatorDeactivated(_validators[publicKey].ownerAddress, publicKey);
    }

    /**
     * @dev Validates the paramss for a validator.
     * @param publicKey Validator public key.
     * @param operatorPublicKeys Operator public keys.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function _validateValidatorParams(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys
    ) private pure {
        require(publicKey.length == 48, "invalid public key length");
        require(
            operatorPublicKeys.length == sharesPublicKeys.length &&
            operatorPublicKeys.length == encryptedKeys.length &&
            operatorPublicKeys.length >= 4 && operatorPublicKeys.length % 3 == 1,
            "OESS data structure is not valid"
        );
    }
}
