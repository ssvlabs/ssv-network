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

    uint256 public override operatorCount;
    uint256 public override validatorCount;

    mapping(bytes => Operator) public override operators;
    mapping(bytes => Validator) public override validators;

    mapping(bytes => OperatorFee[]) private operatorFees;

    mapping(address => bytes[]) private operatorsByOwnerAddress;
    mapping(address => bytes[]) private validatorsByAddress;

    function initialize() public virtual override initializer {
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
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey,
        uint256 _fee
    ) onlyOwner public virtual override {
        require(
            operators[_publicKey].ownerAddress == address(0),
            "operator with same public key already exists"
        );
        operators[_publicKey] = Operator(_name, _ownerAddress, _publicKey, 0, false, operatorsByOwnerAddress[_ownerAddress].length);
        operatorsByOwnerAddress[_ownerAddress].push(_publicKey);
        emit OperatorAdded(_name, _ownerAddress, _publicKey);
        operatorCount++;
        updateOperatorFee(_publicKey, _fee);
        activateOperator(_publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deleteOperator}.
     */
    function deleteOperator(
        address _ownerAddress,
        bytes calldata _publicKey
    ) onlyOwner public virtual override {
        Operator storage operatorItem = operators[_publicKey];
        string memory name = operatorItem.name;
        operatorsByOwnerAddress[_ownerAddress][operatorItem.index] = operatorsByOwnerAddress[_ownerAddress][operatorsByOwnerAddress[_ownerAddress].length - 1];
        operators[operatorsByOwnerAddress[_ownerAddress][operatorItem.index]].index = operatorItem.index;
        operatorsByOwnerAddress[_ownerAddress].pop();
        delete operators[_publicKey];

        --operatorCount;

        emit OperatorDeleted(name, _publicKey);
    }

    function activateOperator(bytes calldata _publicKey) onlyOwner override public {
        require(!operators[_publicKey].active, "already active");
        operators[_publicKey].active = true;

        emit OperatorActive(operators[_publicKey].ownerAddress, _publicKey);
    }

    function deactivateOperator(bytes calldata _publicKey) onlyOwner override external {
        require(operators[_publicKey].active, "already inactive");
        operators[_publicKey].active = false;

        emit OperatorInactive(operators[_publicKey].ownerAddress, _publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata publicKey, uint256 fee) onlyOwner public virtual override {
        operatorFees[publicKey].push(
            OperatorFee(block.number, fee)
        );
        emit OperatorFeeUpdated(publicKey, block.number, fee);
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorScore}.
     */
    function updateOperatorScore(bytes calldata publicKey, uint256 score) onlyOwner public virtual override {
        Operator storage operatorItem = operators[publicKey];
        operatorItem.score = score;
        emit OperatorScoreUpdated(publicKey, block.number, score);
    }

    /**
     * @dev See {ISSVRegistry-registerValidator}.
     */
    function registerValidator(
        address _ownerAddress,
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) onlyOwner public virtual override {
        _validateValidatorParams(
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        require(_ownerAddress != address(0), "owner address invalid");
        require(
            validators[_publicKey].ownerAddress == address(0),
            "validator with same public key already exists"
        );

        Validator storage validatorItem = validators[_publicKey];
        validatorItem.publicKey = _publicKey;
        validatorItem.ownerAddress = _ownerAddress;

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            validatorItem.oess.push(
                Oess(
                    index,
                    _operatorPublicKeys[index],
                    _sharesPublicKeys[index],
                    _encryptedKeys[index]
                )
            );
        }
        validatorItem.index = validatorsByAddress[_ownerAddress].length;
        validatorsByAddress[_ownerAddress].push(_publicKey);
        validatorCount++;
        emit ValidatorAdded(_ownerAddress, _publicKey, validatorItem.oess);
        activateValidator(_publicKey);
    }

    /**
     * @dev See {ISSVRegistry-updateValidator}.
     */
    function updateValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) onlyOwner public virtual override {
        _validateValidatorParams(
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        Validator storage validatorItem = validators[_publicKey];
        delete validatorItem.oess;

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            validatorItem.oess.push(
                Oess(
                    index,
                    _operatorPublicKeys[index],
                    _sharesPublicKeys[index],
                    _encryptedKeys[index]
                )
            );
        }

        emit ValidatorUpdated(validatorItem.ownerAddress, _publicKey, validatorItem.oess);
    }

    /**
     * @dev See {ISSVRegistry-deleteValidator}.
     */
    function deleteValidator(
        address _ownerAddress,
        bytes calldata _publicKey
    ) onlyOwner public virtual override {
        Validator storage validatorItem = validators[_publicKey];
        validatorsByAddress[_ownerAddress][validatorItem.index] = validatorsByAddress[_ownerAddress][validatorsByAddress[_ownerAddress].length - 1];
        validators[validatorsByAddress[_ownerAddress][validatorItem.index]].index = validatorItem.index;
        validatorsByAddress[_ownerAddress].pop();
        delete validators[_publicKey];
        --validatorCount;
        emit ValidatorDeleted(_ownerAddress, _publicKey);
    }

    function activateValidator(bytes calldata _publicKey) onlyOwner override public {
        require(!validators[_publicKey].active, "already active");
        validators[_publicKey].active = true;

        emit ValidatorActive(validators[_publicKey].ownerAddress, _publicKey);
    }

    function deactivateValidator(bytes calldata _publicKey) onlyOwner override external {
        require(validators[_publicKey].active, "already inactive");
        validators[_publicKey].active = false;

        emit ValidatorInactive(validators[_publicKey].ownerAddress, _publicKey);
    }

    function getOperatorsByOwnerAddress(address _ownerAddress) onlyOwner external view virtual override returns (bytes[] memory) {
        return operatorsByOwnerAddress[_ownerAddress];
    }

    function getOperatorsByValidator(bytes calldata _validatorPublicKey) onlyOwner external view virtual override returns (bytes[] memory operatorPublicKeys) {
        Validator storage validatorItem = validators[_validatorPublicKey];

        operatorPublicKeys = new bytes[](validatorItem.oess.length);
        for (uint256 index = 0; index < validatorItem.oess.length; ++index) {
            operatorPublicKeys[index] = validatorItem.oess[index].operatorPublicKey;
        }
    }

    function getOperatorOwner(bytes calldata _publicKey) onlyOwner external override view returns (address) {
        return operators[_publicKey].ownerAddress;
    }

    /**
     * @dev See {ISSVRegistry-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(bytes calldata _operatorPublicKey) public view override returns (uint256) {
        require(operatorFees[_operatorPublicKey].length > 0, "operator not found");
        return operatorFees[_operatorPublicKey][operatorFees[_operatorPublicKey].length - 1].fee;
    }


    function getValidatorOwner(bytes calldata _publicKey) onlyOwner external override view returns (address) {
        return validators[_publicKey].ownerAddress;
    }

    function _validateValidatorParams(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) private pure {
        require(_publicKey.length == 48, "invalid public key length");
        require(
            _operatorPublicKeys.length == _sharesPublicKeys.length &&
                _operatorPublicKeys.length == _encryptedKeys.length,
            "OESS data structure is not valid"
        );
    }

    function getValidatorsByAddress(address _ownerAddress) onlyOwner external view virtual override returns (bytes[] memory) {
        return validatorsByAddress[_ownerAddress];
    }
}
