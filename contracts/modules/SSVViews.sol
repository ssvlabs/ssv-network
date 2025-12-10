// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVViews} from "../interfaces/ISSVViews.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {Types64} from "../libraries/Types.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ProtocolLib.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";

contract SSVViews is ISSVViews {
    using Types64 for uint64;

    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address clusterOwner, bytes calldata publicKey) external view override returns (bool) {
        bytes32 validatorData = SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, clusterOwner))];

        if (validatorData == bytes32(0)) return false;
        bytes32 activeFlag = validatorData & bytes32(uint256(1)); // Retrieve LSB of stored value

        return activeFlag == bytes32(uint256(1));
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        return SSVStorage.load().operators[operatorId].ethFee.expand();
    }

    function getOperatorFeeSSV(uint64 operatorId) external view override returns (uint256) {
        return SSVStorage.load().operators[operatorId].fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (bool, uint256, uint64, uint64) {
        OperatorFeeChangeRequest memory opFeeChangeRequest = SSVStorage.load().operatorFeeChangeRequests[operatorId];

        return (
            opFeeChangeRequest.approvalBeginTime != 0,
            opFeeChangeRequest.fee.expand(),
            opFeeChangeRequest.approvalBeginTime,
            opFeeChangeRequest.approvalEndTime
        );
    }

    function getOperatorById(
        uint64 operatorId
    )
        external
        view
        override
        returns (
            address owner,
            uint256 ethFee,
            uint32 ethValidatorCount,
            address whitelistedAddress,
            bool isPrivate,
            bool isActive
        )
    {
        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];

        owner = operator.owner;
        ethFee = operator.ethFee.expand();
        ethValidatorCount = operator.ethValidatorCount;
        whitelistedAddress = SSVStorage.load().operatorsWhitelist[operatorId];
        isPrivate = operator.whitelisted;
        isActive = operator.ethSnapshot.block != 0;
    }

    function getOperatorByIdSSV(
        uint64 operatorId
    )
        external
        view
        override
        returns (
            address owner,
            uint256 fee,
            uint32 validatorCount,
            address whitelistedAddress,
            bool isPrivate,
            bool isActive
        )
    {
        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];

        owner = operator.owner;
        fee = operator.fee.expand();
        validatorCount = operator.validatorCount;
        whitelistedAddress = SSVStorage.load().operatorsWhitelist[operatorId];
        isPrivate = operator.whitelisted;
        isActive = operator.snapshot.block != 0;
    }

    function getWhitelistedOperators(
        uint64[] calldata operatorIds,
        address addressToCheck
    ) external view override returns (uint64[] memory whitelistedOperatorIds) {
        uint256 operatorsLength = operatorIds.length;
        if (operatorsLength == 0 || addressToCheck == address(0)) return whitelistedOperatorIds;

        StorageData storage s = SSVStorage.load();

        uint256 internalCount;

        // Check whitelisting address for each operator using the internal SSV whitelisting module
        (uint256[] memory masks, uint256 startBlockIndex) = OperatorLib.generateBlockMasks(operatorIds, false, s);
        uint64[] memory internalWhitelistedOperatorIds = new uint64[](operatorsLength);

        uint256 endBlockIndex = startBlockIndex + masks.length;
        // Check whitelisting status for each mask
        for (uint256 blockIndex = startBlockIndex; blockIndex < endBlockIndex; ++blockIndex) {
            uint256 mask = masks[blockIndex - startBlockIndex];
            // Only check blocks that have operator IDs
            if (mask != 0) {
                uint256 whitelistedMask = s.addressWhitelistedForOperators[addressToCheck][blockIndex];

                // This will give the matching whitelisted operators
                uint256 matchedMask = whitelistedMask & mask;

                // Now we need to extract operator IDs from matchedMask
                uint256 blockPointer = blockIndex << 8;
                for (uint256 bit; bit < 256; ++bit) {
                    if (matchedMask & (1 << bit) != 0) {
                        internalWhitelistedOperatorIds[internalCount++] = uint64(blockPointer + bit);
                        if (internalCount == operatorsLength) {
                            return internalWhitelistedOperatorIds; // Early termination
                        }
                    }
                }
            }
        }

        // Resize internalWhitelistedOperatorIds to the actual number of whitelisted operators
        assembly {
            mstore(internalWhitelistedOperatorIds, internalCount)
        }

        // Check if pending operators use an external whitelisting contract and check whitelistedAddress using it
        whitelistedOperatorIds = new uint64[](operatorsLength);
        uint256 internalWhitelistIndex;
        uint256 count;

        for (uint256 operatorIndex; operatorIndex < operatorsLength; ++operatorIndex) {
            uint64 operatorId = operatorIds[operatorIndex];

            // Check if operatorId is already in internalWhitelistedOperatorIds
            if (
                internalWhitelistIndex < internalCount &&
                operatorId == internalWhitelistedOperatorIds[internalWhitelistIndex]
            ) {
                whitelistedOperatorIds[count++] = operatorId;
                ++internalWhitelistIndex;
            } else {
                address whitelistedAddress = s.operatorsWhitelist[operatorId];

                // Legacy address whitelists (EOAs or generic contracts)
                if (
                    whitelistedAddress == addressToCheck ||
                    (OperatorLib.isWhitelistingContract(whitelistedAddress) &&
                        ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(addressToCheck, operatorId))
                ) {
                    whitelistedOperatorIds[count++] = operatorId;
                }
            }
        }

        // Resize whitelistedOperatorIds to the actual number of whitelisted operators
        assembly {
            mstore(whitelistedOperatorIds, count)
        }
    }

    function isWhitelistingContract(address contractAddress) external view override returns (bool) {
        return OperatorLib.isWhitelistingContract(contractAddress);
    }

    function isAddressWhitelistedInWhitelistingContract(
        address addressToCheck,
        uint256 operatorId,
        address whitelistingContract
    ) external view override returns (bool) {
        if (!OperatorLib.isWhitelistingContract(whitelistingContract) || addressToCheck == address(0)) return false;
        return ISSVWhitelistingContract(whitelistingContract).isWhitelisted(addressToCheck, operatorId);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        (, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.ethSnapshot.index + (uint64(block.number) - operator.ethSnapshot.block) * operator.ethFee;
            burnRate += operator.ethFee;
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndex());
        return
            cluster.isLiquidatable(
                burnRate,
                sp.ethNetworkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );
    }

    function isLiquidatableSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        (, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_SSV);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndexSSV());
        return
            cluster.isLiquidatable(
                burnRate,
                sp.networkFee,
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );
    }

    function isLiquidated(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        return !cluster.active;
    }

    function getBurnRate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());

        uint64 aggregateFee;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                aggregateFee += operator.ethFee;
            }
        }

        uint64 burnRate = (aggregateFee + SSVStorageProtocol.load().ethNetworkFee) * cluster.validatorCount;
        return burnRate.expand();
    }

    function getBurnRateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());

        uint64 aggregateFee;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                aggregateFee += operator.fee;
            }
        }

        uint64 burnRate = (aggregateFee + SSVStorageProtocol.load().networkFee) * cluster.validatorCount;
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorage.load().operators[id];

        operator.updateSnapshot(id);
        return operator.ethSnapshot.balance.expand();
    }

    function getOperatorEarningsSSV(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorage.load().operators[id];

        operator.updateSnapshotSSV(id);
        return operator.snapshot.balance.expand();
    }

    function getBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256 balance, uint256 effectiveBalance) {

        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint256 operatorsLength = operatorIds.length;
            for (uint256 i; i < operatorsLength; ++i) {
                Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
                clusterIndex +=
                    operator.ethSnapshot.index +
                    (uint64(block.number) - operator.ethSnapshot.block) *
                    operator.ethFee;
            }
        }

        cluster.updateBalance(clusterIndex, SSVStorageProtocol.load().currentNetworkFeeIndex());
        balance = cluster.balance;

        bytes32 clusterId = keccak256(abi.encodePacked(clusterOwner, operatorIds));
        StorageEB storage seb = SSVStorageEB.load();
        uint64 vUnits = seb.clusterEB[clusterId].vUnits;

        if (vUnits == 0) {
            vUnits = cluster.validatorCount * VUNITS_PRECISION;
        }

        effectiveBalance = (uint256(vUnits) * 32 ether) / VUNITS_PRECISION;
    }

    function getBalanceSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint256 operatorsLength = operatorIds.length;
            for (uint256 i; i < operatorsLength; ++i) {
                Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
                clusterIndex +=
                    operator.snapshot.index +
                    (uint64(block.number) - operator.snapshot.block) *
                    operator.fee;
            }
        }

        cluster.updateBalance(clusterIndex, SSVStorageProtocol.load().currentNetworkFeeIndexSSV());

        return cluster.balance;
    }

    function getClusterVersion(address clusterOwner, uint64[] calldata operatorIds) external view override returns (uint8) {
        StorageData storage s = SSVStorage.load();
        bytes32 hashedCluster = keccak256(abi.encodePacked(clusterOwner, operatorIds));

        if (s.ethClusters[hashedCluster] != bytes32(0)) {
            return CoreLib.VERSION_ETH;
        }
        if (s.clusters[hashedCluster] != bytes32(0)) {
            return CoreLib.VERSION_SSV;
        }

        revert ClusterDoesNotExists();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return SSVStorageProtocol.load().ethNetworkFee.expand();
    }

    function getNetworkFeeSSV() external view override returns (uint256) {
        return SSVStorageProtocol.load().networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return SSVStorageProtocol.load().networkTotalEarnings().expand();
    }

    function getNetworkEarningsSSV() external view override returns (uint256) {
        return SSVStorageProtocol.load().networkTotalEarningsSSV().expand();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64) {
        return SSVStorageProtocol.load().operatorMaxFeeIncrease;
    }

    function getMaximumOperatorFee() external view override returns (uint64) {
        return SSVStorageProtocol.load().operatorMaxFee;
    }

    function getOperatorFeePeriods() external view override returns (uint64, uint64) {
        return (SSVStorageProtocol.load().declareOperatorFeePeriod, SSVStorageProtocol.load().executeOperatorFeePeriod);
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return SSVStorageProtocol.load().minimumBlocksBeforeLiquidation;
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return SSVStorageProtocol.load().minimumLiquidationCollateral.expand();
    }

    function getValidatorsPerOperatorLimit() external view override returns (uint32) {
        return SSVStorageProtocol.load().validatorsPerOperatorLimit;
    }

    function getNetworkValidatorsCount() external view override returns (uint32) {
        return SSVStorageProtocol.load().ethDaoValidatorCount;
    }

    function getVersion() external pure override returns (string memory) {
        return CoreLib.getVersion();
    }
}
