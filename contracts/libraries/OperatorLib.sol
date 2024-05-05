// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {StorageData} from "./SSVStorage.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import {Types64} from "./Types.sol";

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

library OperatorLib {
    using Types64 for uint64;

    function updateSnapshot(ISSVNetworkCore.Operator memory operator) internal view {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint32(block.number);
    }

    function updateSnapshotSt(ISSVNetworkCore.Operator storage operator) internal {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint32(block.number);
    }

    function checkOwner(ISSVNetworkCore.Operator memory operator) internal view {
        if (operator.snapshot.block == 0) revert ISSVNetworkCore.OperatorDoesNotExist();
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwner();
    }

    function updateClusterOperatorsOnRegistration(
        uint64[] memory operatorIds,
        uint32 deltaValidatorCount,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal returns (uint64 cumulativeIndex, uint64 cumulativeFee) {
        uint256 operatorsLength = operatorIds.length;

        uint256 blockIndex;
        uint256 lastBlockIndex = ~uint256(0); // Use an invalid block index as the initial value
        uint256 currentWhitelistedMask;

        for (uint256 i; i < operatorsLength; ) {
            uint64 operatorId = operatorIds[i];

            if (i + 1 < operatorsLength) {
                if (operatorId > operatorIds[i + 1]) {
                    revert ISSVNetworkCore.UnsortedOperatorsList();
                } else if (operatorId == operatorIds[i + 1]) {
                    revert ISSVNetworkCore.OperatorsListNotUnique();
                }
            }
            ISSVNetworkCore.Operator memory operator = s.operators[operatorId];

            if (operator.snapshot.block == 0) {
                revert ISSVNetworkCore.OperatorDoesNotExist();
            }

            // check if the pending operator is whitelisted (must be backward compatible)
            if (operator.whitelisted) {
                address whitelistedAddress = s.operatorsWhitelist[operatorId];
                if (whitelistedAddress != address(0)) {
                    // Legacy address whitelists (EOAs or generic contracts)
                    if (whitelistedAddress != msg.sender) {
                        // Check if msg.sender is whitelisted via whitelisting contract
                        if (!OperatorLib.isWhitelistingContract(whitelistedAddress)) {
                            revert ISSVNetworkCore.InvalidWhitelistingContract(whitelistedAddress);
                        }
                        if (!ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(msg.sender, operatorId)) {
                            revert ISSVNetworkCore.CallerNotWhitelisted(operatorId);
                        }
                    }
                } else {
                    // Handle bitmap-based whitelisting
                    blockIndex = operatorId >> 8;
                    if (blockIndex != lastBlockIndex) {
                        currentWhitelistedMask = s.addressWhitelistedForOperators[msg.sender][blockIndex];
                        lastBlockIndex = blockIndex;
                    }

                    if (currentWhitelistedMask & (1 << (operatorId & 0xFF)) == 0) {
                        revert ISSVNetworkCore.CallerNotWhitelisted(operatorId);
                    }
                }
            }

            updateSnapshot(operator);
            if ((operator.validatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                revert ISSVNetworkCore.ExceedValidatorLimit();
            }

            cumulativeFee += operator.fee;
            cumulativeIndex += operator.snapshot.index;

            s.operators[operatorId] = operator;

            unchecked {
                ++i;
            }
        }
    }

    function updateClusterOperators(
        uint64[] memory operatorIds,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount,
        StorageData storage s,
        StorageProtocol storage sp
    ) internal returns (uint64 cumulativeIndex, uint64 cumulativeFee) {
        uint256 operatorsLength = operatorIds.length;

        for (uint256 i; i < operatorsLength; ) {
            uint64 operatorId = operatorIds[i];

            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.snapshot.block != 0) {
                updateSnapshotSt(operator);
                if (!increaseValidatorCount) {
                    operator.validatorCount -= deltaValidatorCount;
                } else if ((operator.validatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimit();
                }

                cumulativeFee += operator.fee;
            }
            cumulativeIndex += operator.snapshot.index;

            unchecked {
                ++i;
            }
        }
    }

    function updateMultipleWhitelists(
        address[] calldata whitelistAddresses,
        uint64[] calldata operatorIds,
        bool registerAddresses,
        StorageData storage s
    ) internal {
        uint256 addressesLength = whitelistAddresses.length;
        if (addressesLength == 0) revert ISSVNetworkCore.InvalidWhitelistAddressesLength();

        uint256 operatorsLength = getOperatorsLength(operatorIds);

        ISSVNetworkCore.Operator storage operator;
        for (uint256 i; i < operatorsLength; ++i) {
            operator = s.operators[operatorIds[i]];

            checkOwner(operator);
            if (registerAddresses && !operator.whitelisted) {
                operator.whitelisted = true;
            }
        }

        // create the max number of masks that will be updated
        uint256[] memory masks = generateBlockMasks(operatorIds);

        for (uint256 i; i < addressesLength; ++i) {
            address whitelistAddress = whitelistAddresses[i];
            checkZeroAddress(whitelistAddress);

            // If whitelistAddress is a custom contract, revert also when removing
            if (isWhitelistingContract(whitelistAddress))
                revert ISSVNetworkCore.AddressIsWhitelistingContract(whitelistAddress);

            for (uint256 blockIndex; blockIndex < masks.length; ++blockIndex) {
                // only update storage for updated masks
                if (masks[blockIndex] != 0) {
                    if (registerAddresses) {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] |= masks[blockIndex];
                    } else {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] &= ~masks[blockIndex];
                    }
                }
            }
        }
    }

    function generateBlockMasks(uint64[] calldata operatorIds) internal pure returns (uint256[] memory masks) {
        uint256 blockIndex;
        uint256 bitPosition;
        uint64 currentOperatorId;

        uint256 operatorsLength = operatorIds.length;

        // create the max number of masks that will be updated
        masks = new uint256[]((operatorIds[operatorsLength - 1] >> 8) + 1);

        for (uint256 i; i < operatorsLength; ++i) {
            currentOperatorId = operatorIds[i];

            if (i > 0 && currentOperatorId <= operatorIds[i - 1]) {
                if (currentOperatorId == operatorIds[i - 1]) {
                    revert ISSVNetworkCore.OperatorsListNotUnique();
                }
                revert ISSVNetworkCore.UnsortedOperatorsList();
            }

            (blockIndex, bitPosition) = getBitmapIndexes(currentOperatorId);

            masks[blockIndex] |= (1 << bitPosition);
        }
    }

    function updatePrivacyStatus(uint64[] calldata operatorIds, bool setPrivate, StorageData storage s) internal {
        uint256 operatorsLength = getOperatorsLength(operatorIds);

        ISSVNetworkCore.Operator storage operator;
        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];
            operator = s.operators[operatorId];
            checkOwner(operator);

            operator.whitelisted = setPrivate;
        }
    }

    function getBitmapIndexes(uint64 operatorId) internal pure returns (uint256 blockIndex, uint256 bitPosition) {
        blockIndex = operatorId >> 8; // Equivalent to operatorId / 256
        bitPosition = operatorId & 0xFF; // Equivalent to operatorId % 256
    }

    function checkZeroAddress(address whitelistAddress) internal pure {
        if (whitelistAddress == address(0)) revert ISSVNetworkCore.ZeroAddressNotAllowed();
    }

    function getOperatorsLength(uint64[] calldata operatorIds) internal pure returns (uint256 operatorsLength) {
        operatorsLength = operatorIds.length;
        if (operatorsLength == 0) revert ISSVNetworkCore.InvalidOperatorIdsLength();
    }

    function isWhitelistingContract(address whitelistingContract) internal view returns (bool) {
        return ERC165Checker.supportsInterface(whitelistingContract, type(ISSVWhitelistingContract).interfaceId);
    }
}
