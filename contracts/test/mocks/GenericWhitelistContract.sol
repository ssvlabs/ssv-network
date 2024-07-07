// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/ISSVClusters.sol";
import "../../interfaces/ISSVNetworkCore.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GenericWhitelistContract {
    ISSVClusters private ssvContract;
    IERC20 private ssvToken;

    constructor(ISSVClusters _ssvContract, IERC20 _ssvToken) {
        ssvContract = _ssvContract;
        ssvToken = _ssvToken;
    }

    function registerValidatorSSV(
        bytes calldata _publicKey,
        uint64[] memory _operatorIds,
        bytes calldata _sharesData,
        uint256 _amount,
        ISSVNetworkCore.Cluster memory _cluserData
    ) external {
        ssvToken.approve(address(ssvContract), _amount);
        ssvContract.registerValidator(_publicKey, _operatorIds, _sharesData, _amount, _cluserData);
    }
}
