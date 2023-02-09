// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";
import "./ISSVNetworkViews.sol";
import "./libraries/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract SSVNetworkViews is
    UUPSUpgradeable,
    OwnableUpgradeable,
    ISSVNetworkViews
{
    using Types256 for uint256;
    using Types64 for uint64;
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using NetworkLib for DAO;

    SSVNetwork _ssvNetwork;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[50] __gap;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(SSVNetwork ssvNetwork_) external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        _ssvNetwork = ssvNetwork_;
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(
        uint64 operatorId
    ) external view override returns (uint256) {
        (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork.operators(
            operatorId
        );
        if (snapshot.block == 0) revert OperatorDoesNotExist();

        return fee.expand();
    }

    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view override returns (uint256, uint256, uint256) {
        (
            uint64 fee,
            uint64 approvalBeginTime,
            uint64 approvalEndTime
        ) = _ssvNetwork.operatorFeeChangeRequests(operatorId);

        if (fee == 0) {
            revert NoFeeDelcared();
        }

        return (fee.expand(), approvalBeginTime, approvalEndTime);
    }

    function getOperatorById(
        uint64 operatorId
    ) external view override returns (address, uint256, uint32) {
        (
            address operatorOwner,
            uint64 fee,
            uint32 validatorCount,

        ) = _ssvNetwork.operators(operatorId);
        if (operatorOwner == address(0)) revert OperatorDoesNotExist();

        return (operatorOwner, fee.expand(), validatorCount);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork.operators(
                operatorIds[i]
            );
            clusterIndex +=
                snapshot.index +
                (uint64(block.number) - snapshot.block) *
                fee;
            burnRate += fee;
        }

        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        (
            uint64 networkFee,
            uint64 networkFeeIndex,
            uint64 networkFeeIndexBlockNumber
        ) = _ssvNetwork.network();

        cluster.balance = cluster.clusterBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(
                Network(networkFee, networkFeeIndex, networkFeeIndexBlockNumber)
            )
        );
        return
            cluster.liquidatable(
                burnRate,
                networkFee,
                _ssvNetwork.minimumBlocksBeforeLiquidation()
            );
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        return cluster.disabled;
    }

    function getClusterBurnRate(
        uint64[] calldata operatorIds
    ) external view returns (uint256) {
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (address operatorOwner, uint64 fee, , ) = _ssvNetwork.operators(
                operatorIds[i]
            );
            if (operatorOwner != address(0)) {
                burnRate += fee;
            }
        }
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(
        uint64 id
    ) external view override returns (uint256) {
        (
            address operatorOwner,
            uint64 fee,
            uint32 validatorCount,
            Snapshot memory snapshot
        ) = _ssvNetwork.operators(id);

        Operator memory operator = Operator({
            owner: operatorOwner,
            fee: fee,
            snapshot: Snapshot({
                block: snapshot.block,
                index: snapshot.index,
                balance: snapshot.balance
            }),
            validatorCount: validatorCount
        });

        operator.getSnapshot();
        return operator.snapshot.balance.expand();
    }

    function getBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ++i) {
                (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork
                    .operators(operatorIds[i]);
                clusterIndex +=
                    snapshot.index +
                    (uint64(block.number) - snapshot.block) *
                    fee;
            }
        }

        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        (
            uint64 networkFee,
            uint64 networkFeeIndex,
            uint64 networkFeeIndexBlockNumber
        ) = _ssvNetwork.network();

        uint64 currrentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            Network(networkFee, networkFeeIndex, networkFeeIndexBlockNumber)
        );

        return
            cluster
                .clusterBalance(clusterIndex, currrentNetworkFeeIndex)
                .expand();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        (uint64 networkFee, , ) = _ssvNetwork.network();
        return networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        (
            uint32 validatorCount,
            uint64 withdrawn,
            Snapshot memory snapshot
        ) = _ssvNetwork.dao();

        DAO memory dao = DAO({
            validatorCount: validatorCount,
            withdrawn: withdrawn,
            earnings: Snapshot({
                block: snapshot.block,
                index: snapshot.index,
                balance: snapshot.balance
            })
        });
        (uint64 networkFee, , ) = _ssvNetwork.network();

        return dao.networkBalance(networkFee).expand();
    }

    function getOperatorFeeIncreaseLimit()
        external
        view
        override
        returns (uint64)
    {
        return _ssvNetwork.operatorMaxFeeIncrease();
    }

    function getExecuteOperatorFeePeriod()
        external
        view
        override
        returns (uint64)
    {
        return _ssvNetwork.executeOperatorFeePeriod();
    }

    function getDeclaredOperatorFeePeriod()
        external
        view
        override
        returns (uint64)
    {
        return _ssvNetwork.declareOperatorFeePeriod();
    }

    function getLiquidationThresholdPeriod()
        external
        view
        override
        returns (uint64)
    {
        return _ssvNetwork.minimumBlocksBeforeLiquidation();
    }
}
