// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../SSVNetworkViews.sol";

contract SSVNetworkViewsReinitializable is SSVNetworkViews {
   uint64 public validatorsPerOperatorListed;

    function initializeV2(uint64 newValidatorsPerOperatorListed) reinitializer(2) public {
        validatorsPerOperatorListed = newValidatorsPerOperatorListed;
    }
}
