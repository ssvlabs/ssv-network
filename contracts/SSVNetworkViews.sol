// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";
import "./ISSVNetwork.sol";
import "./ICluster.sol";
import "./IOperator.sol";
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
    using OperatorLib for Operator;
    using NetworkLib for ISSVNetwork.DAO;

    SSVNetwork _ssvNetwork;

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
        if (snapshot.block == 0) revert OperatorDoesNotExist();

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
            revert NoFeeDelcared();
        }

        return (fee.expand(), approvalBeginTime, approvalEndTime);
    }

    // use getOperatorById(operatorId) direct call?
    function getOperatorById(
        uint64 operatorId
    ) external view returns (address, uint256, uint32) {
        (address owner, uint64 fee, uint32 validatorCount, ) = _ssvNetwork
            ._operators(operatorId);
        if (owner == address(0)) revert OperatorDoesNotExist();

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
        for (uint i; i < operatorsLength; ) {
            (, uint64 fee, , ISSVNetwork.Snapshot memory snapshot) = _ssvNetwork._operators(operatorIds[i]);
            clusterIndex +=
               snapshot.index +
                (uint64(block.number) - snapshot.block) *
                fee;
            burnRate += fee;
            unchecked {
                ++i;
            }
        }

        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        return
            ClusterLib.liquidatable(
                cluster.validatorCount,
                _ssvNetwork._networkFee(),
                cluster.clusterBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(_ssvNetwork)),
                burnRate,
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
        for (uint i; i < operatorsLength; ) {
            (address owner, uint64 fee, , ) = _ssvNetwork._operators(
                operatorIds[i]
            );
            if (owner != address(0)) {
                burnRate += fee;
            }
            unchecked {
                ++i;
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

        Operator memory op = Operator({
            owner: owner,
            fee: fee,
            snapshot: ISSVNetwork.Snapshot({
                block: snapshot.block,
                index: snapshot.index,
                balance: snapshot.balance
            }),
            validatorCount: validatorCount
        });

        ISSVNetwork.Snapshot memory s = op.getSnapshot(uint64(block.number));
        return s.balance.expand();
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
            for (uint i; i < operatorsLength; ) {
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
                unchecked {
                    ++i;
                }
            }
        }

        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        uint64 networkFeeIndex = _ssvNetwork._networkFeeIndex() +
            uint64(block.number - _ssvNetwork._networkFeeIndexBlockNumber()) *
            _ssvNetwork._networkFee();
        return cluster.clusterBalance(clusterIndex, networkFeeIndex).expand();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view returns (uint256) {
        return _ssvNetwork._networkFee().expand();
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
        return dao.networkBalance(_ssvNetwork._networkFee()).expand();
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
