// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVClusters} from "../../interfaces/ISSVClusters.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {ISSVValidators} from "../../interfaces/ISSVValidators.sol";

contract MaliciousLiquidate {
    address public ssvNetwork;
    address public targetOwner;
    uint64[] public ops;
    ISSVNetworkCore.Cluster public cl;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function setParams(uint64[] memory _ops, ISSVNetworkCore.Cluster memory _cl) external {
        ops = _ops;
        cl = _cl;
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
        ISSVClusters(ssvNetwork).liquidate(address(this), ops, cl);
    }

    receive() external payable {
        ISSVClusters(ssvNetwork).liquidate(address(this), ops, cl);
    }
}