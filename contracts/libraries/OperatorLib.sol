// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {StorageData} from "./SSVStorage.sol";
import {StorageProtocol} from "./SSVStorageProtocol.sol";
import {Types64, Types256} from "./Types.sol";
import "./SSVStorageEB.sol";

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

library OperatorLib {
    using Types64 for uint64;
    using Types256 for uint256;

    uint256 internal constant MINIMAL_OPERATOR_ETH_FEE = 10_000_000;

    function updateSnapshotSSV(ISSVNetworkCore.Operator memory operator) internal view {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint32(block.number);
    }

    function updateSnapshotStSSV(ISSVNetworkCore.Operator storage operator) internal {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = uint32(block.number);
    }

    function updateSnapshotSt(
        ISSVNetworkCore.Operator storage operator,
        uint64 operatorId
    ) internal {
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);
        uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * operator.ethFee;

        // Deviation-only model: effectiveVUnits = baseline + storedDeviation
        // storedDeviation = operatorEthVUnits (only non-default EB contributions)
        // baseline = ethValidatorCount * VUNITS_PRECISION
        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);

        operator.ethSnapshot.index += blockDiffEthFee;
        if (effectiveVUnits != 0 && blockDiffEthFee != 0) {
            uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
            operator.ethSnapshot.balance += uint64(delta);
        }
        operator.ethSnapshot.block = currentBlock;
    }

    function updateSnapshot(
        ISSVNetworkCore.Operator memory operator,
        uint64 operatorId
    ) internal view {
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);
        uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * operator.ethFee;

        // Deviation-only model: effectiveVUnits = baseline + storedDeviation
        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);

        operator.ethSnapshot.index += blockDiffEthFee;
        if (effectiveVUnits != 0 && blockDiffEthFee != 0) {
            uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
            operator.ethSnapshot.balance += uint64(delta);
        }
        operator.ethSnapshot.block = currentBlock;
    }

    function updateSnapshots(ISSVNetworkCore.Operator memory operator, uint64 operatorId) internal view {
        updateSnapshot(operator, operatorId);
        updateSnapshotSSV(operator);
    }

    function updateSnapshotsSt(ISSVNetworkCore.Operator storage operator, uint64 operatorId) internal {
        updateSnapshotSt(operator, operatorId);
        updateSnapshotStSSV(operator);
    }

    function defaultOperatorEthFee() internal pure returns (uint64) {
        return MINIMAL_OPERATOR_ETH_FEE.shrink();
    }

    function checkOwner(ISSVNetworkCore.Operator storage operator) internal view {
        if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) {
            revert ISSVNetworkCore.OperatorDoesNotExist();
        }
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwnerWithData(msg.sender, operator.owner);
    }

    function ensureETHDefaults(ISSVNetworkCore.Operator storage operator) internal {
        if (operator.ethSnapshot.block == 0) {
            operator.ethSnapshot.block = uint32(block.number);
            operator.ethSnapshot.balance = 0;
        }
        if (operator.ethFee == 0 && operator.fee != 0) {
            operator.ethFee = defaultOperatorEthFee();
        }
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
            ensureETHDefaults(s.operators[operatorId]);
            ISSVNetworkCore.Operator memory operator = s.operators[operatorId];

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
                    // Legacy address & whitelisting contract check
                    if (whitelistedAddress != msg.sender) {
                        // Check if whitelistedAddress is a valid whitelisting contract and if msg.sender is whitelisted by it
                        // For non-whitelisting contracts, check if msg.sender is whitelisted (EOAs or generic contracts)
                        if (
                            !OperatorLib.isWhitelistingContract(whitelistedAddress) ||
                            !ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(msg.sender, operatorId)
                        ) {
                            revert ISSVNetworkCore.CallerNotWhitelistedWithData(operatorId);
                        }
                    }
                }
            }

            updateSnapshot(operator, operatorId);
            if ((operator.ethValidatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
            }
            cumulativeFee += operator.ethFee;
            cumulativeIndex += operator.ethSnapshot.index;

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

            // only update active operators (block != 0)
            // removed operators have block == 0 and contribute their preserved index
            if (operator.ethSnapshot.block != 0) {
                updateSnapshotSt(operator, operatorId);

                if (increaseValidatorCount) {
                    if ((operator.ethValidatorCount += deltaValidatorCount) > sp.validatorsPerOperatorLimit) {
                        revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
                    }
                } else {
                    operator.ethValidatorCount -= deltaValidatorCount;
                }

                cumulativeFee += operator.ethFee;
            }
            cumulativeIndex += operator.ethSnapshot.index;
        }
    }

    function updateClusterOperatorsOnReactivation(
        uint64[] memory operatorIds,
        uint32 deltaValidatorCount,
        uint64 clusterDeviation,
        StorageData storage s,
        StorageProtocol storage sp,
        StorageEB storage seb
    ) internal returns (uint64 cumulativeIndex, uint64 cumulativeFee) {
        uint256 operatorsLength = operatorIds.length;
        uint32 currentBlock = uint32(block.number);
        bool hasDeviation = sp.daoTotalEthVUnits != uint64(sp.ethDaoValidatorCount) * VUNITS_PRECISION;

        for (uint256 i; i < operatorsLength; ) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block != 0) {
                uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * operator.ethFee;

                if (blockDiffEthFee != 0) {
                    operator.ethSnapshot.index += blockDiffEthFee;
                    uint64 effectiveVUnits;

                    if (hasDeviation) {
                        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                        effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);
                    } else {
                        effectiveVUnits = uint64(operator.ethValidatorCount) * VUNITS_PRECISION;
                    }

                    if (effectiveVUnits != 0) {
                        uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                        operator.ethSnapshot.balance += uint64(delta);
                    }
                }
                operator.ethSnapshot.block = currentBlock;

                if (clusterDeviation != 0) {
                    if (hasDeviation) {
                        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                        seb.operatorEthVUnits[operatorId] = storedDeviation + clusterDeviation;
                    } else {
                        seb.operatorEthVUnits[operatorId] = clusterDeviation;
                    }
                }

                operator.ethValidatorCount += deltaValidatorCount;
                if (operator.ethValidatorCount > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
                }

                cumulativeFee += operator.ethFee;
            }
            cumulativeIndex += operator.ethSnapshot.index;

            unchecked {
                ++i;
            }
        }
    }

    function updateClusterOperatorsMigration(
        uint64[] memory operatorIds,
        uint32 validatorCount,
        StorageData storage s,
        StorageProtocol storage sp,
        bool isClusterLiquidated
    ) internal returns (uint64 cumulativeIndex, uint64 cumulativeFee) {
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block == 0) {
                // first-time ETH usage or migration
                updateSnapshotStSSV(operator);

                if (!isClusterLiquidated) {
                    operator.validatorCount -= validatorCount;
                }

                ensureETHDefaults(operator);

                // initialize ETH validator count
                if ((operator.ethValidatorCount += validatorCount) > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
                }
            } else {
                // already ETH operator
                updateSnapshotSt(operator, operatorId);
                if ((operator.ethValidatorCount += validatorCount) > sp.validatorsPerOperatorLimit) {
                    revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
                }
            }

            cumulativeFee += operator.ethFee;
            cumulativeIndex += operator.ethSnapshot.index;
        }
    }

    function updateClusterOperatorsSSV(
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
                updateSnapshotStSSV(operator);
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
