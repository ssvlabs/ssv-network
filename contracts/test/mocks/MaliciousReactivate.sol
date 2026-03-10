// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVClusters} from "../../interfaces/ISSVClusters.sol";
import {ISSVValidators} from "../../interfaces/ISSVValidators.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";

contract MaliciousReactivate {
    address public ssvNetwork;
    uint64[] public ops;
    ISSVNetworkCore.Cluster public cl;

    uint64[] public reactivateOps;
    ISSVNetworkCore.Cluster public reactivateCl;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function setParams(
        uint64[] memory _ops,
        ISSVNetworkCore.Cluster memory _cl
    ) external {
        ops = _ops;
        cl = _cl;
    }

    function setReactivateParams(
        uint64[] memory _ops,
        ISSVNetworkCore.Cluster memory _cl
    ) external {
        reactivateOps = _ops;
        reactivateCl = _cl;
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
        ISSVClusters(ssvNetwork).withdraw(ops, 1, cl);
    }

    receive() external payable {
        ISSVClusters(ssvNetwork).reactivate{value: msg.value}(reactivateOps, reactivateCl);
    }
}
