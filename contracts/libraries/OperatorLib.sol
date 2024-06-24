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
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwnerWithData(msg.sender, operator.owner);
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

        for (uint256 i; i < operatorsLength; ++i) {
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
                // Handle bitmap-based whitelisting
                blockIndex = operatorId >> 8;
                if (blockIndex != lastBlockIndex) {
                    currentWhitelistedMask = s.addressWhitelistedForOperators[msg.sender][blockIndex];
                    lastBlockIndex = blockIndex;
                }

                // if msg.sender is not whitelisted via bitmap, check for legacy whitelist/whitelisting contract
                if (currentWhitelistedMask & (1 << (operatorId & 0xFF)) == 0) {
                    address whitelistedAddress = s.operatorsWhitelist[operatorId];
                    if (whitelistedAddress == address(0)) {
                        // msg.sender is not whitelisted via bitmap or legacy whitelist/whitelisting contract
                        revert ISSVNetworkCore.CallerNotWhitelistedWithData(operatorId);
                    }
                    // Legacy address whitelists (EOAs or generic contracts)
                    if (whitelistedAddress != msg.sender) {
                        // Check if msg.sender is whitelisted via whitelisting contract
                        if (!OperatorLib.isWhitelistingContract(whitelistedAddress)) {
                            revert ISSVNetworkCore.InvalidWhitelistingContract(whitelistedAddress);
                        }
                        if (!ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(msg.sender, operatorId)) {
                            revert ISSVNetworkCore.CallerNotWhitelistedWithData(operatorId);
                        }
                    }
                }
            }

            updateSnapshot(operator);
            if ((operator.validatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
            }

            cumulativeFee += operator.fee;
            cumulativeIndex += operator.snapshot.index;

            s.operators[operatorId] = operator;
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

        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];

            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.snapshot.block != 0) {
                updateSnapshotSt(operator);
                if (!increaseValidatorCount) {
                    operator.validatorCount -= deltaValidatorCount;
                } else if ((operator.validatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
                }

                cumulativeFee += operator.fee;
            }
            cumulativeIndex += operator.snapshot.index;
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

        checkOperatorsLength(operatorIds);

        // create the max number of masks that will be updated
        (uint256[] memory masks, uint256 startBlockIndex) = generateBlockMasks(operatorIds, true, s);
        uint256 endBlockIndex = startBlockIndex + masks.length;

        for (uint256 i; i < addressesLength; ++i) {
            address whitelistAddress = whitelistAddresses[i];
            checkZeroAddress(whitelistAddress);

            // If whitelistAddress is a custom contract, reverts only when registering addresses
            if (registerAddresses && isWhitelistingContract(whitelistAddress))
                revert ISSVNetworkCore.AddressIsWhitelistingContract(whitelistAddress);

            for (uint256 blockIndex = startBlockIndex; blockIndex < endBlockIndex; ++blockIndex) {
                // only update storage for updated masks
                uint256 mask = masks[blockIndex - startBlockIndex];
                if (mask != 0) {
                    if (registerAddresses) {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] |= mask;
                    } else {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] &= ~mask;
                    }
                }
            }
        }
    }

    function generateBlockMasks(
        uint64[] calldata operatorIds,
        bool checkOperatorsOwnership,
        StorageData storage s
    ) internal view returns (uint256[] memory masks, uint256 startBlockIndex) {
        uint256 operatorsLength = operatorIds.length;
        startBlockIndex = operatorIds[0] >> 8;

        // Create the masks array from startBlockIndex to the last block index
        masks = new uint256[]((operatorIds[operatorsLength - 1] >> 8) - startBlockIndex + 1);

        uint64 currentOperatorId;
        uint64 prevOperatorId;

        for (uint256 i; i < operatorsLength; ++i) {
            currentOperatorId = operatorIds[i];

            if (checkOperatorsOwnership) {
                checkOwner(s.operators[currentOperatorId]);
            }

            if (i > 0 && currentOperatorId <= prevOperatorId) {
                if (currentOperatorId == prevOperatorId) {
                    revert ISSVNetworkCore.OperatorsListNotUnique();
                }
                revert ISSVNetworkCore.UnsortedOperatorsList();
            }

            (uint256 blockIndex, uint256 bitPosition) = getBitmapIndexes(currentOperatorId);

            masks[blockIndex - startBlockIndex] |= (1 << bitPosition);
            prevOperatorId = currentOperatorId;
        }
    }

    function updatePrivacyStatus(uint64[] calldata operatorIds, bool setPrivate, StorageData storage s) internal {
        uint256 operatorsLength = checkOperatorsLength(operatorIds);

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

    function checkOperatorsLength(uint64[] calldata operatorIds) internal pure returns (uint256 operatorsLength) {
        operatorsLength = operatorIds.length;
        if (operatorsLength == 0) revert ISSVNetworkCore.InvalidOperatorIdsLength();
    }

    function isWhitelistingContract(address whitelistingContract) internal view returns (bool) {
        return ERC165Checker.supportsInterface(whitelistingContract, type(ISSVWhitelistingContract).interfaceId);
    }
}
