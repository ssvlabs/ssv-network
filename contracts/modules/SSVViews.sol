// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/ISSVViews.sol";
import "../libraries/Types.sol";
import "../libraries/NetworkLib.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/SSVStorage.sol";

contract SSVViews is ISSVViews {
    using Types64 for uint64;

    using NetworkLib for DAO;
    using ClusterLib for Cluster;
    using OperatorLib for Operator;

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address owner, bytes calldata publicKey) external view override returns (bool active) {
        return SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, owner))].active;
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256 fee) {
        Operator memory operator = SSVStorage.load().operators[operatorId];
        if (operator.snapshot.block == 0) revert OperatorDoesNotExist();

        fee = operator.fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (uint256, uint64, uint64) {
        OperatorFeeChangeRequest memory opFeeChangeRequest = SSVStorage.load().operatorFeeChangeRequests[operatorId];

        if (opFeeChangeRequest.fee == 0) {
            revert NoFeeDeclared();
        }

        return (
            opFeeChangeRequest.fee.expand(),
            opFeeChangeRequest.approvalBeginTime,
            opFeeChangeRequest.approvalEndTime
        );
    }

    function getOperatorById(uint64 operatorId) external view returns (address, uint256, uint32, bool, bool) {
        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        bool isPrivate = SSVStorage.load().operatorsWhitelist[operatorId] == address(0) ? false : true;
        bool isActive = operator.snapshot.block == 0 ? false : true;

        return (operator.owner, operator.fee.expand(), operator.validatorCount, isPrivate, isActive);
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
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
        }

        Network memory network = SSVStorage.load().network;

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(network));
        return
            cluster.isLiquidatable(
                burnRate,
                network.networkFee,
                SSVStorage.load().minimumBlocksBeforeLiquidation,
                SSVStorage.load().minimumLiquidationCollateral
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
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                aggregateFee += operator.fee;
            }
        }

        uint64 burnRate = (aggregateFee + SSVStorage.load().network.networkFee) * cluster.validatorCount;
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorage.load().operators[id];

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
                Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
                clusterIndex +=
                    operator.snapshot.index +
                    (uint64(block.number) - operator.snapshot.block) *
                    operator.fee;
            }
        }

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(SSVStorage.load().network));

        return cluster.balance;
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return SSVStorage.load().network.networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return SSVStorage.load().dao.networkTotalEarnings(SSVStorage.load().network.networkFee).expand();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64 operatorMaxFeeIncrease) {
        return SSVStorage.load().operatorFeeConfig.operatorMaxFeeIncrease;
    }

    function getOperatorFeePeriods()
        external
        view
        override
        returns (uint64 declareOperatorFeePeriod, uint64 executeOperatorFeePeriod)
    {
        OperatorFeeConfig memory opFeeConfig = SSVStorage.load().operatorFeeConfig;
        return (opFeeConfig.declareOperatorFeePeriod, opFeeConfig.executeOperatorFeePeriod);
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return SSVStorage.load().minimumBlocksBeforeLiquidation;
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return SSVStorage.load().minimumLiquidationCollateral.expand();
    }

    function getVersion() external view returns (string memory version) {
        bytes memory currentVersion = abi.encodePacked(SSVStorage.load().version);

        uint8 i;
        while (i < 32 && currentVersion[i] != 0) {
            version = string(abi.encodePacked(version, currentVersion[i]));
            i++;
        }
    }
}
