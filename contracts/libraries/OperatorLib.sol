// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "../interfaces/external/ISSVWhitelistingContract.sol";
import "./CoreLib.sol";
import "./SSVStorage.sol";
import "./SSVStorageProtocol.sol";
import "./Types.sol";

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
                    // Check if the whitelisted address is a custom contract and use its logic to check if msg.sender is whitelisted
                    if (isWhitelistingContract(whitelistedAddress)) {
                        if (!ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(msg.sender, operatorId)) {
                            revert ISSVNetworkCore.CallerNotWhitelisted();
                        }
                    } else {
                        // Legacy address whitelists (EOAs or generic contracts)
                        if (whitelistedAddress != msg.sender) {
                            revert ISSVNetworkCore.CallerNotWhitelisted();
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
                        revert ISSVNetworkCore.CallerNotWhitelisted();
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
        bool addAddresses,
        StorageData storage s
    ) internal {
        uint256 addressesLength = whitelistAddresses.length;
        uint256 operatorsLength = operatorIds.length;

        if (addressesLength == 0) revert ISSVNetworkCore.InvalidWhitelistAddressesLength();
        if (operatorsLength == 0) revert ISSVNetworkCore.InvalidOperatorIdsLength();

        ISSVNetworkCore.Operator storage operator;
        for (uint256 i; i < operatorsLength; ++i) {
            operator = s.operators[operatorIds[i]];

            checkOwner(operator);
            if (addAddresses) {
                if (!operator.whitelisted) {
                    operator.whitelisted = true;
                }
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
                    if (addAddresses) {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] |= masks[blockIndex];
                    } else {
                        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] &= ~masks[blockIndex];
                    }
                }
            }
        }
    }

    function updateWhitelistingContract(
        uint64 operatorId,
        ISSVWhitelistingContract whitelistingContract,
        StorageData storage s
    ) internal {
        checkOwner(s.operators[operatorId]);

        address currentWhitelisted = s.operatorsWhitelist[operatorId];

        // operator already whitelisted? EOA or generic contract
        if (currentWhitelisted != address(0)) {
            (uint256 blockIndex, uint256 bitPosition) = OperatorLib.getBitmapIndexes(operatorId);
            delete s.operatorsWhitelist[operatorId];
            s.addressWhitelistedForOperators[currentWhitelisted][blockIndex] |= (1 << bitPosition);
        } else {
            s.operators[operatorId].whitelisted = true;
        }

        s.operatorsWhitelist[operatorId] = address(whitelistingContract);
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

    function getBitmapIndexes(uint64 operatorId) internal pure returns (uint256 blockIndex, uint256 bitPosition) {
        blockIndex = operatorId >> 8; // Equivalent to operatorId / 256
        bitPosition = operatorId & 0xFF; // Equivalent to operatorId % 256
    }

    function checkZeroAddress(address whitelistAddress) internal pure {
        if (whitelistAddress == address(0)) revert ISSVNetworkCore.ZeroAddressNotAllowed();
    }

    function isWhitelistingContract(address whitelistingContract) internal view returns (bool) {
        return ERC165Checker.supportsInterface(whitelistingContract, type(ISSVWhitelistingContract).interfaceId);
    }
}
