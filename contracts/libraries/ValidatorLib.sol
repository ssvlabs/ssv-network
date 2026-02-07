// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {StorageData} from "./storage/SSVStorage.sol";

/**
 * @title SSV Validator Library
 * @author SSV Labs
 * @notice Library functions for managing SSV validators including operator validations, public key registrations and state checks
 */
library ValidatorLib {
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    /**
     * @notice Validates operator IDs array length
     * @param operatorIds Operator IDs
     */
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

    /**
     * @notice Registers validator public key
     * @param publicKey Validator public key
     * @param operatorIds Operator IDs
     * @param owner Validator owner
     * @param s Storage data
     */
    function registerPublicKey(
        bytes memory publicKey,
        uint64[] memory operatorIds,
        address owner,
        StorageData storage s
    ) internal {
        if (publicKey.length != PUBLIC_KEY_LENGTH) {
            revert ISSVNetworkCore.InvalidPublicKeyLength();
        }

        bytes32 hashedPk = keccak256(abi.encodePacked(publicKey, owner));

        if (s.validatorPKs[hashedPk] != bytes32(0)) {
            revert ISSVNetworkCore.ValidatorAlreadyExistsWithData(publicKey);
        }

        s.validatorPKs[hashedPk] = bytes32(uint256(keccak256(abi.encodePacked(operatorIds))) | uint256(0x01)); // set LSB to 1
    }

    /**
     * @notice Hashes operator IDs
     * @param operatorIds Operator IDs
     * @return Hashed operator IDs
     */
    function hashOperatorIds(uint64[] memory operatorIds) internal pure returns (bytes32) {
        bytes32 mask = ~bytes32(uint256(1)); // All bits set to 1 except LSB
        return keccak256(abi.encodePacked(operatorIds)) & mask; // Clear LSB of provided operator ids
    }

    /**
     * @notice Validates validator state
     * @param validatorData Validator data
     * @param hashedOperatorIds Hashed operator IDs
     * @return True if state is correct
     */
    function validateCorrectState(bytes32 validatorData, bytes32 hashedOperatorIds) internal pure returns (bool) {
        // All bits set to 1 except LSB
        // Clear LSB of stored validator data and compare
        return (validatorData & ~bytes32(uint256(1))) == hashedOperatorIds;
    }
}
