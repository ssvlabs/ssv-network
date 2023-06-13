// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetwork.sol";

contract SSVNetworkBasicUpgrade is SSVNetwork {
    function resetNetworkFee() external onlyOwner {
        CoreLib.delegateCall(
            SSVStorage.load().ssvContracts[SSVModules.SSV_DAO],
            abi.encodeWithSignature("updateNetworkFee(uint256)", 10_000_000)
        );
    }
}
