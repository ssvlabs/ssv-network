// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetwork.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

interface IRegisterAuth {
    struct Authorization {
        bool registerOperator;
        bool registerValidator;
    }
    function setAuth(address targetUser, Authorization calldata auth) external;
    function getAuth(address caller) external view returns (Authorization memory);
}

contract RegisterAuth is IRegisterAuth, UUPSUpgradeable, OwnableUpgradeable {
    ISSVNetwork private ssvNetwork;

    mapping(address => Authorization) private authorization;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(ISSVNetwork _ssvNetwork) external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        ssvNetwork = _ssvNetwork;
    }

    function setAuth(address targetUser, Authorization calldata auth) external override onlyOwner {
        authorization[targetUser] = auth;
    }

    function getAuth(address caller) external override view onlyTrusted returns (Authorization memory) {
        return authorization[caller];
    }

    modifier onlyTrusted() {
        if (_msgSender() != address(ssvNetwork) && _msgSender() != owner()) revert("Call not authorized");
        _;
    }
}
