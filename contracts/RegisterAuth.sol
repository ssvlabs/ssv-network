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

    function setAuth(address userAddress, Authorization calldata auth) external;

    function getAuth(address userAddress) external view returns (Authorization memory);

    error CallNotAuthorized();
}

contract RegisterAuth is IRegisterAuth, UUPSUpgradeable, OwnableUpgradeable {
    ISSVNetwork private ssvNetwork;

    mapping(address => Authorization) private authorization;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize() external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
    }

    function setAuth(address userAddress, Authorization calldata auth) external override onlyOwner {
        authorization[userAddress] = auth;
    }

    function getAuth(address userAddress) external view override returns (Authorization memory) {
        return authorization[userAddress];
    }
}
