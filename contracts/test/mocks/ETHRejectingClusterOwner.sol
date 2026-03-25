// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISSVValidators} from "../../interfaces/ISSVValidators.sol";
import {ISSVClusters} from "../../interfaces/ISSVClusters.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";

/// @notice Contract without receive() — for testing ETH transfer failure on cluster withdraw.
contract ETHRejectingClusterOwner {
    address public immutable ssvNetwork;

    constructor(address _ssvNetwork) {
        ssvNetwork = _ssvNetwork;
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        bytes calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        ISSVValidators(ssvNetwork).registerValidator{value: msg.value}(
            publicKey, operatorIds, sharesData, cluster
        );
    }

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        ISSVClusters(ssvNetwork).withdraw(operatorIds, amount, cluster);
    }

    // No receive() or fallback() — rejects all incoming ETH
}
