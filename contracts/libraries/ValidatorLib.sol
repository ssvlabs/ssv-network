// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "./SSVStorage.sol";

library ValidatorLib {
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    function validateOperatorsLength(uint64[] memory operatorIds) internal pure {
        uint256 operatorsLength = operatorIds.length;

        if (
            operatorsLength < MIN_OPERATORS_LENGTH ||
            operatorsLength > MAX_OPERATORS_LENGTH ||
            operatorsLength % MODULO_OPERATORS_LENGTH != 1
        ) {
            revert ISSVNetworkCore.InvalidOperatorIdsLength();
        }
    }

    function registerPublicKeys(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal {
        for (uint i; i < publicKeys.length; ++i) {
            resgisterPublicKey(publicKeys[i], operatorIds, s);
        }
    }

    function resgisterPublicKey(bytes memory publicKey, uint64[] memory operatorIds, StorageData storage s) internal {
        if (publicKey.length != PUBLIC_KEY_LENGTH) {
            revert ISSVNetworkCore.InvalidPublicKeyLength();
        }

        bytes32 hashedPk = keccak256(abi.encodePacked(publicKey, msg.sender));

        if (s.validatorPKs[hashedPk] != bytes32(0)) {
            revert ISSVNetworkCore.ValidatorAlreadyExists();
        }

        s.validatorPKs[hashedPk] = bytes32(uint256(keccak256(abi.encodePacked(operatorIds))) | uint256(0x01)); // set LSB to 1
    }

    function hashOperatorIds(uint64[] calldata operatorIds) internal pure returns (bytes32) {
        bytes32 mask = ~bytes32(uint256(1)); // All bits set to 1 except LSB
        return keccak256(abi.encodePacked(operatorIds)) & mask; // Clear LSB of provided operator ids
    }

    function validateStates(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        StorageData storage s
    ) internal view returns (bytes32[] memory hashedValidator) {
        if (publicKeys.length == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        hashedValidator = new bytes32[](publicKeys.length);
        bytes32 hashedOperatorIds = hashOperatorIds(operatorIds);

        for (uint i; i < publicKeys.length; ++i) {
            hashedValidator[i] = validateState(publicKeys[i], hashedOperatorIds, s);
        }
    }

    function validateState(
        bytes calldata publicKey,
        bytes32 hashedOperatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedValidator) {
        hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));
        bytes32 validatorData = s.validatorPKs[hashedValidator];

        if (validatorData == bytes32(0)) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }

        if ((validatorData & ~bytes32(uint256(1))) != hashedOperatorIds) {
            // All bits set to 1 except LSB
            // Clear LSB of stored validator data and compare
            revert ISSVNetworkCore.IncorrectValidatorState();
        }
    }
}
