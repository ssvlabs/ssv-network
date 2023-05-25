// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./../ISSVNetworkCore.sol";

interface ISSVClusters is ISSVNetworkCore {
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) external;

    function removeValidator(bytes calldata publicKey, uint64[] memory operatorIds, Cluster memory cluster) external;

    /**************************/
    /* Cluster External Functions */
    /**************************/

    function liquidate(address owner, uint64[] memory operatorIds, Cluster memory cluster) external;

    function reactivate(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external;

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(address owner, uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external;

    function withdraw(uint64[] memory operatorIds, uint256 tokenAmount, Cluster memory cluster) external;
}
