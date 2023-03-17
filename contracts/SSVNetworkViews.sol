// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkViews.sol";
import "./SSVNetwork.sol";
import "./libraries/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetworkViews is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVNetworkViews {
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

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(bytes calldata publicKey) external view override returns (address, bool) {
        (address owner, bool active) = _ssvNetwork.validatorPKs(keccak256(publicKey));
        return (owner, active);
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork.operators(operatorId);
        if (snapshot.block == 0) revert OperatorDoesNotExist();

        return fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (uint256, uint256, uint256) {
        (uint64 fee, uint64 approvalBeginTime, uint64 approvalEndTime) = _ssvNetwork.operatorFeeChangeRequests(
            operatorId
        );

        if (fee == 0) {
            revert NoFeeDelcared();
        }

        return (fee.expand(), approvalBeginTime, approvalEndTime);
    }

    function getOperatorById(uint64 operatorId) external view override returns (address, uint256, uint32, bool, bool) {
        (address operatorOwner, uint64 fee, uint32 validatorCount, Snapshot memory snapshot) = _ssvNetwork.operators(
            operatorId
        );
        bool isPrivate = _ssvNetwork.operatorsWhitelist(operatorId) == address(0) ? false : true;
        bool isActive = snapshot.block == 0 ? false : true;

        return (operatorOwner, fee.expand(), validatorCount, isPrivate, isActive);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork.operators(operatorIds[i]);
            clusterIndex += snapshot.index + (uint64(block.number) - snapshot.block) * fee;
            burnRate += fee;
        }

        (uint64 networkFee, uint64 networkFeeIndex, uint64 networkFeeIndexBlockNumber) = _ssvNetwork.network();

        cluster.updateBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(Network(networkFee, networkFeeIndex, networkFeeIndexBlockNumber))
        );
        return
            cluster.isLiquidatable(
                burnRate,
                networkFee,
                _ssvNetwork.minimumBlocksBeforeLiquidation(),
                _ssvNetwork.minimumLiquidationCollateral()
            );
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        return !cluster.active;
    }

    function getBurnRate(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint256) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);

        uint64 aggregateFee;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ++i) {
            (address operatorOwner, uint64 fee, , ) = _ssvNetwork.operators(operatorIds[i]);
            if (operatorOwner != address(0)) {
                aggregateFee += fee;
            }
        }

        (uint64 networkFee, , ) = _ssvNetwork.network();

        uint64 burnRate = (aggregateFee + networkFee) * cluster.validatorCount;
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        (address operatorOwner, uint64 fee, uint32 validatorCount, Snapshot memory snapshot) = _ssvNetwork.operators(
            id
        );

        Operator memory operator = Operator({
            owner: operatorOwner,
            fee: fee,
            snapshot: Snapshot({block: snapshot.block, index: snapshot.index, balance: snapshot.balance}),
            validatorCount: validatorCount
        });

        operator.updateSnapshot();
        return operator.snapshot.balance.expand();
    }

    function getBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        cluster.validateHashedCluster(owner, operatorIds, _ssvNetwork);
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ++i) {
                (, uint64 fee, , Snapshot memory snapshot) = _ssvNetwork.operators(operatorIds[i]);
                clusterIndex += snapshot.index + (uint64(block.number) - snapshot.block) * fee;
            }
        }

        (uint64 networkFee, uint64 networkFeeIndex, uint64 networkFeeIndexBlockNumber) = _ssvNetwork.network();

        uint64 currrentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            Network(networkFee, networkFeeIndex, networkFeeIndexBlockNumber)
        );

        cluster.updateBalance(clusterIndex, currrentNetworkFeeIndex);

        return cluster.balance;
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        (uint64 networkFee, , ) = _ssvNetwork.network();
        return networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        (uint32 validatorCount_, uint64 balance_, uint64 block_) = _ssvNetwork.dao();

        DAO memory dao = DAO({validatorCount: validatorCount_, balance: balance_, block: block_});
        (uint64 networkFee, , ) = _ssvNetwork.network();

        return dao.networkTotalEarnings(networkFee).expand();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64) {
        return _ssvNetwork.operatorMaxFeeIncrease();
    }

    function getExecuteOperatorFeePeriod() external view override returns (uint64) {
        return _ssvNetwork.executeOperatorFeePeriod();
    }

    function getDeclaredOperatorFeePeriod() external view override returns (uint64) {
        return _ssvNetwork.declareOperatorFeePeriod();
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return _ssvNetwork.minimumBlocksBeforeLiquidation();
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return _ssvNetwork.minimumLiquidationCollateral().expand();
    }

    function getVersion() external view returns (string memory version) {
        bytes memory currentVersion = abi.encodePacked(_ssvNetwork.version());

        uint8 i;
        while (i < 32 && currentVersion[i] != 0) {
            version = string(abi.encodePacked(version, currentVersion[i]));
            i++;
        }
    }
}
