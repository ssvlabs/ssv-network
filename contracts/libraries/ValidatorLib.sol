// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "./SSVStorage.sol";

library ValidatorLib {
    function validateState(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedValidator) {
        hashedValidator = keccak256(abi.encodePacked(publicKey, msg.sender));
        bytes32 validatorData = s.validatorPKs[hashedValidator];

        if (validatorData == bytes32(0)) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        bytes32 mask = ~bytes32(uint256(1)); // All bits set to 1 except LSB

        bytes32 hashedOperatorIds = keccak256(abi.encodePacked(operatorIds)) & mask; // Clear LSB of provided operator ids
        if ((validatorData & mask) != hashedOperatorIds) {
            // Clear LSB of stored validator data and compare
            revert ISSVNetworkCore.IncorrectValidatorState();
        }
    }
}
