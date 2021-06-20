// File: contracts/SSVRegister.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./ISSVRegister.sol";

contract SSVRegister is ISSVRegister {
    uint256 public operatorCount;
    uint256 public validatorCount;

    mapping(bytes => Operator) public override operators;
    mapping(bytes => Validator) internal validators;

    mapping(address => OperatorFee[]) public override operatorFees;

    modifier onlyValidator(bytes calldata _publicKey) {
        require(
            validators[_publicKey].ownerAddress != address(0),
            "Validator with public key is not exists"
        );
        require(msg.sender == validators[_publicKey].ownerAddress, "Caller is not validator owner");
        _;
    }

    modifier onlyOperator(bytes calldata _publicKey) {
        require(
            operators[_publicKey].ownerAddress != address(0),
            "Operator with public key is not exists"
        );
        require(msg.sender == operators[_publicKey].ownerAddress, "Caller is not operator owner");
        _;
    }

    function _validateValidatorParams(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) private view {
        require(_publicKey.length == 48, "Invalid public key length");
        require(
            _operatorPublicKeys.length == _sharesPublicKeys.length &&
                _operatorPublicKeys.length == _encryptedKeys.length,
            "OESS data structure is not valid"
        );
    }

    /**
     * @dev See {ISSVRegister-addOperator}.
     */
    function addOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) public virtual override {
        require(
            operators[_publicKey].ownerAddress == address(0),
            "Operator with same public key already exists"
        );
        operators[_publicKey] = Operator(_name, _ownerAddress, _publicKey, 0);
        emit OperatorAdded(_name, _ownerAddress, _publicKey);
        operatorCount++;
    }

    /**
     * @dev See {ISSVRegister-addValidator}.
     */
    function addValidator(
        address _ownerAddress,
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) public virtual override {
        _validateValidatorParams(
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        require(_ownerAddress != address(0), "Owner address invalid");
        require(
            validators[_publicKey].ownerAddress == address(0),
            "Validator with same public key already exists"
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

        validatorCount++;
        emit ValidatorAdded(_ownerAddress, _publicKey, validatorItem.oess);
    }

    /**
     * @dev See {ISSVRegister-updateValidator}.
     */
    function updateValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) onlyValidator(_publicKey) public virtual override {
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
     * @dev See {ISSVRegister-deleteValidator}.
     */
    function deleteValidator(
        bytes calldata _publicKey
    ) onlyValidator(_publicKey) public virtual override {
        address ownerAddress = validators[_publicKey].ownerAddress;
        delete validators[_publicKey];
        validatorCount--;
        emit ValidatorDeleted(ownerAddress, _publicKey);
    }

    /**
     * @dev See {ISSVRegister-deleteOperator}.
     */
    function deleteOperator(
        bytes calldata _publicKey
    ) onlyOperator(_publicKey) public virtual override {
        string memory name = operators[_publicKey].name;
        delete operators[_publicKey];
        operatorCount--;
        emit OperatorDeleted(name, _publicKey);
    }

    /**
     * @dev See {ISSVRegister-updateOperatorFee}.
     */
    function updateOperatorFee(address _ownerAddress, uint256 blockNumber, uint256 fee) public override {
        OperatorFee[] storage fees = operatorFees[_ownerAddress];
        fees.push(
            OperatorFee(block.number, fee)
        );
        emit OperatorFeeUpdated(_ownerAddress, blockNumber, fee);
    }
}
