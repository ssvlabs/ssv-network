// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "../../interfaces/ISSVClusters.sol";
import "./BeneficiaryContract.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract AttackerContract {
    address private ssvContract;

    constructor(address _ssvContract) {
        ssvContract = _ssvContract;
    }

    function startAttack(
        bytes calldata _publicKey,
        uint64[] memory _operatorIds,
        bytes calldata _sharesData,
        uint256 _amount,
        ISSVNetworkCore.Cluster memory _cluserData
    ) external {
        ISSVClusters(ssvContract).registerValidator(_publicKey, _operatorIds, _sharesData, _amount, _cluserData);
    }
}
