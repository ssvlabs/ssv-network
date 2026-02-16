// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../interfaces/ISSVNetworkCore.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {StorageData} from "./storage/SSVStorage.sol";
import {StorageProtocol} from "./storage/SSVStorageProtocol.sol";
import {PackedETH, PackedSSV, DEFAULT_OPERATOR_ETH_FEE, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../libraries/SSVCoreTypes.sol";
import {PackedETHLib, PackedSSVLib} from "../libraries/SSVPackedLib.sol";
import "./storage/SSVStorageEB.sol";

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/**
 * @title SSV Operator Library
 * @author SSV Labs
 * @notice Library functions for managing SSV operators including snapshot updates, cluster operations, whitelists and validations
 */
library OperatorLib {
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    /**
     * @notice Updates SSV operator snapshot
     * @param operator Operator data
     */
    function updateSnapshotSSV(ISSVNetworkCore.Operator memory operator) internal view {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * PackedSSV.unwrap(operator.fee);

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
        operator.snapshot.block = uint32(block.number);
    }

    /**
     * @notice Updates stored SSV operator snapshot
     * @param operator Operator storage reference
     */
    function updateSnapshotStSSV(ISSVNetworkCore.Operator storage operator) internal {
        uint64 blockDiffFee = (uint32(block.number) - operator.snapshot.block) * PackedSSV.unwrap(operator.fee);

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
        operator.snapshot.block = uint32(block.number);
    }

    /**
     * @notice Updates stored ETH operator snapshot
     * @param operator Operator storage reference
     * @param operatorId Operator ID
     */
    function updateSnapshotSt(
        ISSVNetworkCore.Operator storage operator,
        uint64 operatorId
    ) internal {
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);
        uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);

        // Deviation-only model: effectiveVUnits = baseline + storedDeviation
        // storedDeviation = operatorEthVUnits (only non-default EB contributions)
        // baseline = ethValidatorCount * VUNITS_PRECISION
        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);

        operator.ethSnapshot.index += blockDiffEthFee;
        if (effectiveVUnits != 0 && blockDiffEthFee != 0) {
            uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
            operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
        }
        operator.ethSnapshot.block = currentBlock;
    }

    /**
     * @notice Updates ETH operator snapshot
     * @param operator Operator data
     * @param operatorId Operator ID
     */
    function updateSnapshot(
        ISSVNetworkCore.Operator memory operator,
        uint64 operatorId
    ) internal view {
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);
        uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);

        // Deviation-only model: effectiveVUnits = baseline + storedDeviation
        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);

        operator.ethSnapshot.index += blockDiffEthFee;
        if (effectiveVUnits != 0 && blockDiffEthFee != 0) {
            uint128 delta = (uint128(blockDiffEthFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
            operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
        }
        operator.ethSnapshot.block = currentBlock;
    }

    /**
     * @notice Updates both ETH and SSV operator snapshots
     * @param operator Operator data
     * @param operatorId Operator ID
     */
    function updateSnapshots(ISSVNetworkCore.Operator memory operator, uint64 operatorId) internal view {
        updateSnapshot(operator, operatorId);
        updateSnapshotSSV(operator);
    }

    /**
     * @notice Updates both stored ETH and SSV operator snapshots
     * @param operator Operator storage reference
     * @param operatorId Operator ID
     */
    function updateSnapshotsSt(ISSVNetworkCore.Operator storage operator, uint64 operatorId) internal {
        updateSnapshotSt(operator, operatorId);
        updateSnapshotStSSV(operator);
    }

    /**
     * @notice Returns default ETH fee for operators
     * @return Default ETH fee
     */
    function defaultOperatorEthFee() internal pure returns (PackedETH) {
        return PackedETHLib.pack(DEFAULT_OPERATOR_ETH_FEE);
    }

    /**
     * @notice Checks operator owner
     * @param operator Operator storage reference
     */
    function checkOwner(ISSVNetworkCore.Operator storage operator) internal view {
        if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) {
            revert ISSVNetworkCore.OperatorDoesNotExist();
        }
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwnerWithData(msg.sender, operator.owner);
    }

    /**
     * @notice Ensures ETH defaults for operator
     * @param operator Operator storage reference
     */
    function ensureETHDefaults(ISSVNetworkCore.Operator storage operator) internal {
        if(operator.ethSnapshot.block == 0){
            if (operator.ethSnapshot.block == 0) {
                operator.ethSnapshot.block = uint32(block.number);
                operator.ethSnapshot.balance = PACKED_ETH_ZERO;
            }
            if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)) {
                operator.ethFee = defaultOperatorEthFee();
            }
        }
        // we don't want to revert here because this will block the migration flow
    }

    /**
     * @notice Validates operator state for validator registration
     * @param operator Operator storage reference
     */
    function ensureOperatorExist(ISSVNetworkCore.Operator storage operator) internal view {
        if (operator.owner == address(0) ||
            (operator.ethSnapshot.block == 0 && operator.snapshot.block == 0)) {
            revert ISSVNetworkCore.OperatorDoesNotExist();
        }
    }

    /**
     * @notice Updates cluster operators on registration
     * @param operatorIds Operator IDs
     * @param deltaValidatorCount Validator count delta
     * @param s Storage data
     * @param sp Storage protocol
     * @return cumulativeIndex Cumulative index
     * @return cumulativeFee Cumulative fee
     */
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
            ISSVNetworkCore.Operator storage operatorSt = s.operators[operatorId];
            ensureOperatorExist(operatorSt);

            ensureETHDefaults(operatorSt);
            ISSVNetworkCore.Operator memory operator = operatorSt;
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
            cumulativeFee += PackedETH.unwrap(operator.ethFee);
            cumulativeIndex += operator.ethSnapshot.index;

            s.operators[operatorId] = operator;
        }
    }

    /**
     * @notice Updates ETH cluster operators
     * @param operatorIds Operator IDs
     * @param increaseValidatorCount Increase flag
     * @param deltaValidatorCount Validator count delta
     * @param s Storage data
     * @param sp Storage protocol
     * @return cumulativeIndex Cumulative index
     * @return cumulativeFee Cumulative fee
     */
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

                cumulativeFee += PackedETH.unwrap(operator.ethFee);
            }
            cumulativeIndex += operator.ethSnapshot.index;
        }
    }

    /**
     * @notice Updates cluster operators on reactivation
     * @param operatorIds Operator IDs
     * @param deltaValidatorCount Validator count delta
     * @param clusterDeviation Cluster deviation
     * @param s Storage data
     * @param sp Storage protocol
     * @param seb Storage EB
     * @return cumulativeIndex Cumulative index
     * @return cumulativeFee Cumulative fee
     */
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
                uint64 blockDiffEthFee = (currentBlock - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);

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
                        operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
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

                cumulativeFee += PackedETH.unwrap(operator.ethFee);
            }
            cumulativeIndex += operator.ethSnapshot.index;

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Updates cluster operators on migration
     * @param operatorIds Operator IDs
     * @param validatorCount Validator count
     * @param s Storage data
     * @param sp Storage protocol
     * @param isClusterLiquidated Liquidated flag
     * @return cumulativeIndexSSV Cumulative index SSV
     * @return cumulativeIndexETH Cumulative index ETH
     * @return cumulativeFeeETH Cumulative fee ETH
     */
    function updateClusterOperatorsMigration(
        uint64[] memory operatorIds,
        uint32 validatorCount,
        StorageData storage s,
        StorageProtocol storage sp,
        bool isClusterLiquidated
    ) internal returns (uint64 cumulativeIndexSSV, uint64 cumulativeIndexETH, uint64 cumulativeFeeETH) {
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            // skip removed operators
            if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) {
                continue;
            }

            // update SSV snapshot before validator count changes
            updateSnapshotStSSV(operator);
            cumulativeIndexSSV += operator.snapshot.index;

            // update SSV validator count for both new ETH-initialized and existing ETH-initialized operators
            if (!isClusterLiquidated) {
                operator.validatorCount -= validatorCount;
            }

            if (operator.ethSnapshot.block == 0) {
                // first-time ETH usage or migration
                ensureETHDefaults(operator);

            } else {
                // already ETH operator
                updateSnapshotSt(operator, operatorId);

                cumulativeIndexETH += operator.ethSnapshot.index;
            }

            // update ETH validator count for both new ETH-initialized and existing ETH-initialized operators
            if ((operator.ethValidatorCount += validatorCount) > sp.validatorsPerOperatorLimit) {
                revert ISSVNetworkCore.ExceedValidatorLimitWithData(operatorId);
            }

            cumulativeFeeETH += PackedETH.unwrap(operator.ethFee);
        }
    }

    /**
     * @notice Updates SSV cluster operators
     * @param operatorIds Operator IDs
     * @param increaseValidatorCount Increase flag
     * @param deltaValidatorCount Validator count delta
     * @param s Storage data
     * @param sp Storage protocol
     * @return cumulativeIndex Cumulative index
     * @return cumulativeFee Cumulative fee
     */
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

                cumulativeFee += PackedSSV.unwrap(operator.fee);
            }

            cumulativeIndex += operator.snapshot.index;
        }
    }

    /**
     * @notice Updates multiple whitelists
     * @param whitelistAddresses Whitelist addresses
     * @param operatorIds Operator IDs
     * @param registerAddresses Register flag
     * @param s Storage data
     */
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

    /**
     * @notice Generates block masks for operators
     * @param operatorIds Operator IDs
     * @param checkOperatorsOwnership Ownership check flag
     * @param s Storage data
     * @return masks Block masks
     * @return startBlockIndex Start block index
     */
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

    /**
     * @notice Updates operator privacy status
     * @param operatorIds Operator IDs
     * @param setPrivate Private flag
     * @param s Storage data
     */
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

    /**
     * @notice Gets bitmap indexes for operator
     * @param operatorId Operator ID
     * @return blockIndex Block index
     * @return bitPosition Bit position
     */
    function getBitmapIndexes(uint64 operatorId) internal pure returns (uint256 blockIndex, uint256 bitPosition) {
        blockIndex = operatorId >> 8; // Equivalent to operatorId / 256
        bitPosition = operatorId & 0xFF; // Equivalent to operatorId % 256
    }

    /**
     * @notice Checks for zero address
     * @param whitelistAddress Address to check
     */
    function checkZeroAddress(address whitelistAddress) internal pure {
        if (whitelistAddress == address(0)) revert ISSVNetworkCore.ZeroAddressNotAllowed();
    }

    /**
     * @notice Checks operator IDs length
     * @param operatorIds Operator IDs
     * @return operatorsLength Length
     */
    function checkOperatorsLength(uint64[] calldata operatorIds) internal pure returns (uint256 operatorsLength) {
        operatorsLength = operatorIds.length;
        if (operatorsLength == 0) revert ISSVNetworkCore.InvalidOperatorIdsLength();
    }

    /**
     * @notice Checks if address is whitelisting contract
     * @param whitelistingContract Contract address
     * @return True if whitelisting contract
     */
    function isWhitelistingContract(address whitelistingContract) internal view returns (bool) {
        return ERC165Checker.supportsInterface(whitelistingContract, type(ISSVWhitelistingContract).interfaceId);
    }
}