// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.24;

import {ISSVNetworkCore} from "../interfaces/ISSVNetworkCore.sol";
import {SSVStorage} from "./storage/SSVStorage.sol";
import {SSVStorageProtocol} from "./storage/SSVStorageProtocol.sol";
import {Types256} from "./Types256.sol";

library ProtocolLib {
    using Types256 for uint256;
    using SSVStorageProtocol for SSVStorage.Data;

    error ProtocolAlreadyExists();
    error ProtocolDoesNotExist();
    error ProtocolNotUpgradable();
    error InvalidProtocolVersion();

    event ProtocolUpgraded(bytes32 indexed protocolId, uint64 version);
    event ProtocolUpgradedBatch(bytes32[] protocolIds);

    function upgradeProtocol(SSVStorage.Data storage s, bytes32 protocol, uint64 newVersion) internal {
        if (!s.protocolExists(protocol)) revert ProtocolDoesNotExist();
        if (!s.isProtocolUpgradable(protocol)) revert ProtocolNotUpgradable();
        if (newVersion == 0) revert InvalidProtocolVersion();
        s.upgradeProtocolVersion(protocol, newVersion);
        emit ProtocolUpgraded(protocol, newVersion);
    }

    function upgradeProtocols(SSVStorage.Data storage s, bytes32[] memory protocols, uint64[] memory newVersions) internal {
        uint256 length = protocols.length;
        if (length != newVersions.length) revert InvalidProtocolVersion();
        
        for (uint256 i; i < length;) {
            if (!s.protocolExists(protocols[i])) revert ProtocolDoesNotExist();
            if (!s.isProtocolUpgradable(protocols[i])) revert ProtocolNotUpgradable();
            if (newVersions[i] == 0) revert InvalidProtocolVersion();
            
            for (uint256 j; j < i; ++j) {
                if (protocols[i] == protocols[j]) revert ProtocolAlreadyExists();
            }
            
            s.upgradeProtocolVersion(protocols[i], newVersions[i]);
            unchecked { ++i; }
        }
        emit ProtocolUpgradedBatch(protocols);
    }

    function deleteProtocol(SSVStorage.Data storage s, bytes32 protocol) internal {
        if (!s.protocolExists(protocol)) revert ProtocolDoesNotExist();
        s.deleteProtocol(protocol);
    }

    function getProtocolVersion(SSVStorage.Data storage s, bytes32 protocol) internal view returns (uint256) {
        if (!s.protocolExists(protocol)) revert ProtocolDoesNotExist();
        return s.getProtocolVersion(protocol);
    }

    function protocolExists(SSVStorage.Data storage s, bytes32 protocol) internal view returns (bool) {
        return s.protocolExists(protocol);
    }
}
