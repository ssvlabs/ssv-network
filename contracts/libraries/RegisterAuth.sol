// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

struct Authorization {
    bool registerOperator;
    bool registerValidator;
}

library RegisterAuth {
    uint256 constant private SSV_STORAGE_POSITION = uint256(keccak256("ssv.network.storage.auth")) - 1;

    struct AuthData {
        mapping(address => Authorization) authorization;
    }

    function load() internal pure returns (AuthData storage ad) {
        uint256 position = SSV_STORAGE_POSITION;
        assembly {
            ad.slot := position
        }
    }
}
