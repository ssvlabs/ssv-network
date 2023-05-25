// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/IFnSSVViews.sol";
import "../libraries/Types.sol";
import "../libraries/NetworkLib.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "./libraries/CoreLib.sol";
import {SSVStorage as SSVStorageUpgrade} from "./libraries/SSVStorage.sol";

contract SSVViews is IFnSSVViews {
    using Types64 for uint64;

    using NetworkLib for DAO;
    using ClusterLib for Cluster;
    using OperatorLib for Operator;

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address owner, bytes calldata publicKey) external view override returns (bool active) {
        return SSVStorageUpgrade.load().validatorPKs[keccak256(abi.encodePacked(publicKey, owner))].active;
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256 fee) {
        Operator memory operator = SSVStorageUpgrade.load().operators[operatorId];
        if (operator.snapshot.block == 0) revert OperatorDoesNotExist();

        fee = operator.fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (uint256, uint64, uint64) {
        OperatorFeeChangeRequest memory opFeeChangeRequest = SSVStorageUpgrade.load().operatorFeeChangeRequests[operatorId];

        if (opFeeChangeRequest.fee == 0) {
            revert NoFeeDeclared();
        }

        return (
            opFeeChangeRequest.fee.expand(),
            opFeeChangeRequest.approvalBeginTime,
            opFeeChangeRequest.approvalEndTime
        );
    }

    function getOperatorById(uint64 operatorId) external view returns (address, uint256, uint32, address, bool, bool) {
        ISSVNetworkCore.Operator memory operator = SSVStorageUpgrade.load().operators[operatorId];
        address whitelisted = SSVStorageUpgrade.load().operatorsWhitelist[operatorId];
        bool isPrivate = whitelisted == address(0) ? false : true;
        bool isActive = operator.snapshot.block == 0 ? false : true;

        return (operator.owner, operator.fee.expand(), operator.validatorCount, whitelisted, isPrivate, isActive);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorageUpgrade.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
        }

        Network storage network = SSVStorageUpgrade.load().network;

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(network));
        return
            cluster.isLiquidatable(
                burnRate,
                network.networkFee,
                SSVStorageUpgrade.load().minimumBlocksBeforeLiquidation,
                SSVStorageUpgrade.load().minimumLiquidationCollateral
            );
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds);
        return !cluster.active;
    }

    function getBurnRate(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint256) {
        cluster.validateHashedCluster(owner, operatorIds);

        uint64 aggregateFee;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorageUpgrade.load().operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                aggregateFee += operator.fee;
            }
        }

        uint64 burnRate = (aggregateFee + SSVStorageUpgrade.load().network.networkFee) * cluster.validatorCount;
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorageUpgrade.load().operators[id];

        operator.updateSnapshot();
        return operator.snapshot.balance.expand();
    }

    function getBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateHashedCluster(owner, operatorIds);
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ++i) {
                Operator memory operator = SSVStorageUpgrade.load().operators[operatorIds[i]];
                clusterIndex +=
                    operator.snapshot.index +
                    (uint64(block.number) - operator.snapshot.block) *
                    operator.fee;
            }
        }

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(SSVStorageUpgrade.load().network));

        return cluster.balance;
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return SSVStorageUpgrade.load().network.networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return SSVStorageUpgrade.load().dao.networkTotalEarnings(SSVStorageUpgrade.load().network.networkFee).expand();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64 operatorMaxFeeIncrease) {
        return SSVStorageUpgrade.load().operatorFeeConfig.operatorMaxFeeIncrease;
    }

    function getOperatorFeePeriods()
        external
        view
        override
        returns (uint64 declareOperatorFeePeriod, uint64 executeOperatorFeePeriod)
    {
        OperatorFeeConfig memory opFeeConfig = SSVStorageUpgrade.load().operatorFeeConfig;
        return (opFeeConfig.declareOperatorFeePeriod, opFeeConfig.executeOperatorFeePeriod);
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return SSVStorageUpgrade.load().minimumBlocksBeforeLiquidation;
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return SSVStorageUpgrade.load().minimumLiquidationCollateral.expand();
    }

    function getVersion() external pure returns (string memory version) {
        return CoreLib.getVersion();
    }

    function getMinOperatorsPerCluster() external view returns (uint64) {
        return SSVStorageUpgrade.load().minOperatorsPerCluster;
    }
}
