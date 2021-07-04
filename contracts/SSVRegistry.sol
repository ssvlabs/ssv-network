// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./ISSVRegistry.sol";

contract SSVRegistry is ISSVRegistry {
    uint256 public operatorCount;
    uint256 public validatorCount;

    mapping(bytes => Operator) public override operators;
    mapping(bytes => Validator) internal validators;

    mapping(bytes => OperatorFee[]) private operatorFees; // override

    mapping(address => bytes[]) public override operatorsByAddress; //TODO Adam array bytes[] not working with override
    mapping(address => bytes[]) public override validatorsByAddress; //TODO Adam array bytes[] not working with override

    modifier onlyValidator(bytes calldata _publicKey, address _ownerAddress) {
        require(
            validators[_publicKey].ownerAddress != address(0),
            "Validator with public key is not exists"
        );
        require(_ownerAddress == validators[_publicKey].ownerAddress, "Caller is not validator owner");
        _;
    }

    modifier onlyOperator(bytes calldata _publicKey, address _ownerAddress) {
        require(
            operators[_publicKey].ownerAddress != address(0),
            "Operator with public key is not exists"
        );
        require(_ownerAddress == operators[_publicKey].ownerAddress, "Caller is not operator owner");
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
     * @dev See {ISSVRegistry-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) public virtual override {
        require(
            operators[_publicKey].ownerAddress == address(0),
            "Operator with same public key already exists"
        );
        operators[_publicKey] = Operator(_name, _ownerAddress, _publicKey, 0);
        operatorsByAddress[_ownerAddress].push(_publicKey);
        emit OperatorAdded(_name, _ownerAddress, _publicKey);
        operatorCount++;
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
        validatorsByAddress[_ownerAddress].push(_publicKey);
        validatorCount++;
        emit ValidatorAdded(_ownerAddress, _publicKey, validatorItem.oess);
    }

    /**
     * @dev See {ISSVRegistry-updateValidator}.
     */
    function updateValidator(
        address _ownerAddress,
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys
    ) onlyValidator(_publicKey, _ownerAddress) public virtual override {
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
    ) onlyValidator(_publicKey, _ownerAddress) public virtual override {
        address ownerAddress = validators[_publicKey].ownerAddress;
        delete validators[_publicKey];

        // delete from validatorsByAddress
        // TODO: Adam please review
        uint pos = 0;
        while (validatorsByAddress[_ownerAddress][pos] != _publicKey) {
            pos++;
        }
        delete validatorsByAddress[_ownerAddress][pos];

        validatorCount--;
        emit ValidatorDeleted(ownerAddress, _publicKey);
    }

    /**
     * @dev See {ISSVRegistry-deleteOperator}.
     */
    function deleteOperator(
        address _ownerAddress,
        bytes calldata _publicKey
    ) onlyOperator(_publicKey, _ownerAddress) public virtual override {
        string memory name = operators[_publicKey].name;
        delete operators[_publicKey];

        // delete from operatorsByAddress
        // TODO: Adam please review
        uint pos = 0;
        while (operatorsByAddress[_ownerAddress][pos] != _publicKey) {
            pos++;
        }
        delete operatorsByAddress[_ownerAddress][pos];

        operatorCount--;
        emit OperatorDeleted(name, _publicKey);
    }

    /**
     * @dev See {ISSVRegistry-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(bytes calldata _operatorPubKey) public view override returns (uint256) {
        require(operatorFees[_operatorPubKey].length > 0, "Operator fees not found");
        return operatorFees[_operatorPubKey][operatorFees[_operatorPubKey].length - 1].fee;
    }

    /**
     * @dev See {ISSVRegistry-getValidatorUsage}.
     */
    function getValidatorUsage(bytes calldata _pubKey, uint256 _fromBlockNumber, uint256 _toBlockNumber) public view override returns (uint256 usage) {
        uint256 usage = 0;
        for (uint256 index = 0; index < validators[_pubKey].oess.length; ++index) {
            Oess memory oessItem = validators[_pubKey].oess[index];
            uint256 lastBlockNumber = _toBlockNumber;
            uint oldestFeeUsed = 0;
            for (uint256 feeIndex = operatorFees[oessItem.operatorPublicKey].length - 1; feeIndex >= 0; feeIndex--) {
                if (oldestFeeUsed == 0 && operatorFees[oessItem.operatorPublicKey][feeIndex].blockNumber < lastBlockNumber) {
                    uint256 startBlockNumber = _fromBlockNumber;
                    if (operatorFees[oessItem.operatorPublicKey][feeIndex].blockNumber > _fromBlockNumber) {
                        startBlockNumber = operatorFees[oessItem.operatorPublicKey][feeIndex].blockNumber;
                    }
                    usage += (lastBlockNumber - startBlockNumber) * operatorFees[oessItem.operatorPublicKey][feeIndex].fee;
                    lastBlockNumber = startBlockNumber;
                    if (startBlockNumber == _fromBlockNumber) {
                        oldestFeeUsed = 1;
                    }
                }
            }
        }
    }

    /**
     * @dev See {ISSVRegistry-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata _pubKey, uint256 blockNumber, uint256 fee) public virtual override {
        OperatorFee[] storage fees = operatorFees[_pubKey];
        fees.push(
            OperatorFee(block.number, fee)
        );
        emit OperatorFeeUpdated(_pubKey, blockNumber, fee);
    }

    function getOperatorPubKeysInUse(bytes calldata _validatorPubKey) public virtual override returns (bytes[] memory operatorPubKeys) {
        Validator storage validatorItem = validators[_validatorPubKey];

        bytes[] memory operatorPubKeys = new bytes[](validatorItem.oess.length);
        for (uint256 index = 0; index < validatorItem.oess.length; ++index) {
            operatorPubKeys[index] = validatorItem.oess[index].operatorPublicKey;
        }
    }
}
