// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVClusters} from "../../interfaces/ISSVClusters.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {ISSVValidators} from "../../interfaces/ISSVValidators.sol";

contract MaliciousUpdateClusterBalance {
    address public immutable ssvNetwork;

    uint64 public blockNum;
    uint32 public effectiveBalance;
    uint64[] public liquidationOps;
    bytes32[] public merkleProof;
    ISSVNetworkCore.Cluster public liquidationCluster;

    uint64[] public withdrawOps;
    uint256 public withdrawAmount;
    ISSVNetworkCore.Cluster public withdrawCluster;

    bool public attemptedReenter;
    bool public reenterSucceeded;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function setLiquidationParams(
        uint64 _blockNum,
        uint64[] memory _ops,
        ISSVNetworkCore.Cluster memory _cluster,
        uint32 _effectiveBalance,
        bytes32[] memory _proof
    ) external {
        blockNum = _blockNum;
        liquidationOps = _ops;
        liquidationCluster = _cluster;
        effectiveBalance = _effectiveBalance;
        merkleProof = _proof;
    }

    function setReentryParams(
        uint64[] memory _ops,
        uint256 _withdrawAmount,
        ISSVNetworkCore.Cluster memory _cluster
    ) external {
        withdrawOps = _ops;
        withdrawAmount = _withdrawAmount;
        withdrawCluster = _cluster;
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        bytes calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        ISSVValidators(ssvNetwork).registerValidator{value: msg.value}(publicKey, operatorIds, sharesData, cluster);
    }

    function attack() external {
        attemptedReenter = false;
        reenterSucceeded = false;

        ISSVClusters(ssvNetwork).updateClusterBalance(
            blockNum,
            address(this),
            liquidationOps,
            liquidationCluster,
            effectiveBalance,
            merkleProof
        );
    }

    receive() external payable {
        if (attemptedReenter) return;
        attemptedReenter = true;

        try ISSVClusters(ssvNetwork).withdraw(withdrawOps, withdrawAmount, withdrawCluster) {
            reenterSucceeded = true;
        } catch {
            reenterSucceeded = false;
        }
    }
}
