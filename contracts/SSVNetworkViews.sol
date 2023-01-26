// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";
import "./ISSVNetwork.sol";
import "./utils/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract SSVNetworkViews is UUPSUpgradeable, OwnableUpgradeable {
    using Types256 for uint256;
    using Types64 for uint64;
    using ClusterLib for ISSVNetwork.Cluster;
    using OperatorLib for ISSVNetwork.Operator;
    using NetworkLib for ISSVNetwork.DAO;

    SSVNetwork _ssvNetwork;

    // @dev reserve storage space for future new state variables in base contract
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

    function getOperatorFee(uint64 operatorId) external view returns (uint256) {
        (, uint64 fee, , ISSVNetwork.Snapshot memory snapshot) = _ssvNetwork
            ._operators(operatorId);
        if (snapshot.block == 0) revert ISSVNetwork.OperatorDoesNotExist();

        return fee.expand();
    }

    // use _operatorFeeChangeRequests(operatorId) direct call?
    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view returns (uint256, uint256, uint256) {
        (
            uint64 fee,
            uint64 approvalBeginTime,
            uint64 approvalEndTime
        ) = _ssvNetwork._operatorFeeChangeRequests(operatorId);

        if (fee == 0) {
            revert ISSVNetwork.NoFeeDelcared();
        }

        return (fee.expand(), approvalBeginTime, approvalEndTime);
    }

    function getOperatorById(
        uint64 operatorId
    ) external view returns (address, uint256, uint32) {
        (address owner, uint64 fee, uint32 validatorCount, ) = _ssvNetwork
            ._operators(operatorId);
        if (owner == address(0)) revert ISSVNetwork.OperatorDoesNotExist();

        return (owner, fee.expand(), validatorCount);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (bool) {
        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (, uint64 fee, , ISSVNetwork.Snapshot memory snapshot) = _ssvNetwork
                ._operators(operatorIds[i]);
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
        ) = _ssvNetwork._network();

        cluster.balance = cluster.clusterBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(
                ISSVNetwork.Network(
                    networkFee,
                    networkFeeIndex,
                    networkFeeIndexBlockNumber
                )
            )
        );
        return
            cluster.liquidatable(
                burnRate,
                networkFee,
                _ssvNetwork._minimumBlocksBeforeLiquidation()
            );
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        return cluster.disabled;
    }

    function getClusterBurnRate(
        uint64[] calldata operatorIds
    ) external view returns (uint256) {
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (address owner, uint64 fee, , ) = _ssvNetwork._operators(
                operatorIds[i]
            );
            if (owner != address(0)) {
                burnRate += fee;
            }
        }
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view returns (uint256) {
        (
            address owner,
            uint64 fee,
            uint32 validatorCount,
            ISSVNetwork.Snapshot memory snapshot
        ) = _ssvNetwork._operators(id);

        ISSVNetwork.Operator memory operator = ISSVNetwork.Operator({
            owner: owner,
            fee: fee,
            snapshot: ISSVNetwork.Snapshot({
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
        ISSVNetwork.Cluster memory cluster
    ) external view returns (uint256) {
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ++i) {
                (
                    ,
                    uint64 fee,
                    ,
                    ISSVNetwork.Snapshot memory snapshot
                ) = _ssvNetwork._operators(operatorIds[i]);
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
        ) = _ssvNetwork._network();

        uint64 currrentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            ISSVNetwork.Network(
                networkFee,
                networkFeeIndex,
                networkFeeIndexBlockNumber
            )
        );

        return
            cluster
                .clusterBalance(clusterIndex, currrentNetworkFeeIndex)
                .expand();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view returns (uint256) {
        (uint64 networkFee, , ) = _ssvNetwork._network();
        return networkFee.expand();
    }

    function getNetworkEarnings() external view returns (uint256) {
        (
            uint32 validatorCount,
            uint64 withdrawn,
            ISSVNetwork.Snapshot memory snapshot
        ) = _ssvNetwork._dao();

        ISSVNetwork.DAO memory dao = ISSVNetwork.DAO({
            validatorCount: validatorCount,
            withdrawn: withdrawn,
            earnings: ISSVNetwork.Snapshot({
                block: snapshot.block,
                index: snapshot.index,
                balance: snapshot.balance
            })
        });
        (uint64 networkFee, , ) = _ssvNetwork._network();

        return dao.networkBalance(networkFee).expand();
    }

    function getOperatorFeeIncreaseLimit() external view returns (uint64) {
        return _ssvNetwork._operatorMaxFeeIncrease();
    }

    function getExecuteOperatorFeePeriod() external view returns (uint64) {
        return _ssvNetwork._executeOperatorFeePeriod();
    }

    function getDeclaredOperatorFeePeriod() external view returns (uint64) {
        return _ssvNetwork._declareOperatorFeePeriod();
    }

    function getLiquidationThresholdPeriod() external view returns (uint64) {
        return _ssvNetwork._minimumBlocksBeforeLiquidation();
    }
}
