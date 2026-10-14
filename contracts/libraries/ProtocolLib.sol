// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.24;

import {ISSVNetworkCore} from "../interfaces/ISSVNetworkCore.sol";
import {SSVStorage, SSVStorageProtocol} from "./storage/SSVStorageProtocol.sol";
import {Types256} from "./Types256.sol";

library ProtocolLib {
    using Types256 for uint256;
    using SSVStorageProtocol for SSVStorage;

    error ProtocolAlreadyExists();
    error ProtocolDoesNotExist();
    error ProtocolNotUpgradable();
    error InvalidProtocolVersion();

    event ProtocolUpgraded(bytes32 indexed protocolId, uint64 version);
    event ProtocolUpgradedBatch(bytes32[] protocolIds);

    function upgradeProtocol(SSVStorage storage s, bytes32 protocolId) internal {
        if (!s.protocolExists(protocolId)) revert ProtocolDoesNotExist();
        s.upgradeProtocolVersion(protocolId);
        emit ProtocolUpgraded(protocolId, s.getProtocolVersion(protocolId));
    }

    function upgradeProtocols(SSVStorage storage s, bytes32[] memory protocolIds) internal {
        uint256 length = protocolIds.length;
        for (uint256 i; i < length; ) {
            if (!s.protocolExists(protocolIds[i])) revert ProtocolDoesNotExist();
            s.upgradeProtocolVersion(protocolIds[i]);
            unchecked { ++i; }
        }
        emit ProtocolUpgradedBatch(protocolIds);
    }

    function deleteProtocol(SSVStorage storage s, bytes32 protocolId) internal {
        if (!s.protocolExists(protocolId)) revert ProtocolDoesNotExist();
        s.deleteProtocol(protocolId);
    }

    function getProtocolVersion(SSVStorage storage s, bytes32 protocolId) internal view returns (uint64) {
        if (!s.protocolExists(protocolId)) revert ProtocolDoesNotExist();
        return s.getProtocolVersion(protocolId);
    }

    function protocolExists(SSVStorage storage s, bytes32 protocolId) internal view returns (bool) {
        return s.protocolExists(protocolId);
    }
}
