// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVValidators} from "../interfaces/ISSVValidators.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ValidatorLib.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {
    SSVStorageEB,
    StorageEB,
    ClusterEBSnapshot,
    VUNITS_PRECISION
} from "../libraries/SSVStorageEB.sol";
import {Types64} from "../libraries/Types.sol";

contract SSVValidators is ISSVValidators {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    using Types64 for uint64;

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        Cluster memory cluster
    ) external payable override {
        bytes[] memory publicKeys = new bytes[](1);
        publicKeys[0] = publicKey;

        bytes[] memory shares = new bytes[](1);
        shares[0] = sharesData;

        _bulkRegisterValidator(msg.sender, msg.value, publicKeys, operatorIds, shares, cluster);
    }

    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        Cluster memory cluster
    ) external payable override {
        _bulkRegisterValidator(msg.sender, msg.value, publicKeys, operatorIds, sharesData, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        bytes[] memory publicKeys = new bytes[](1);
        publicKeys[0] = publicKey;

        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster);
    }

    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster);
    }

    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        if (
            !ValidatorLib.validateCorrectState(
                SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, msg.sender))],
                ValidatorLib.hashOperatorIds(operatorIds)
            )
        ) revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKey);

        emit ValidatorExited(msg.sender, operatorIds, publicKey);
    }

    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        if (publicKeys.length == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        for (uint i; i < publicKeys.length; ++i) {
            if (
                !ValidatorLib.validateCorrectState(
                    SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKeys[i], msg.sender))],
                    hashedOperatorIds
                )
            ) revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKeys[i]);

            emit ValidatorExited(msg.sender, operatorIds, publicKeys[i]);
        }
    }

    function _bulkRegisterValidator(
        address owner,
        uint256 value,
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] memory sharesData,
        Cluster memory cluster
    ) internal virtual {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) revert EmptyPublicKeysList();
        if (validatorsLength != sharesData.length) revert PublicKeysSharesLengthMismatch();

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ValidatorLib.validateOperatorsLength(operatorIds);

        for (uint i; i < validatorsLength; ++i) {
            ValidatorLib.registerPublicKey(publicKeys[i], operatorIds, owner, s);
        }
        bytes32 hashedCluster = cluster.validateClusterOnRegistration(owner, operatorIds, s);

        cluster.balance += value;

        cluster.updateClusterOnRegistration(operatorIds, hashedCluster, uint32(validatorsLength), s, sp);

        {
            // Deviation-only model: baseline comes from ethValidatorCount (already updated above)
            // Only update ebSnapshot.vUnits for clusters with explicit EB tracking
            // Do NOT update operatorEthVUnits here - deviation unchanged on registration
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            if (ebSnapshot.vUnits > 0) {
                // Cluster has explicit EB tracking - add baseline for new validators
                ebSnapshot.vUnits += uint64(validatorsLength) * VUNITS_PRECISION;
            }
            // operatorEthVUnits NOT updated: deviation doesn't change on registration
        }

        for (uint i; i < validatorsLength; ++i) {
            bytes memory pk = publicKeys[i];
            bytes memory sh = sharesData[i];

            emit ValidatorAdded(owner, operatorIds, pk, sh, cluster);
        }
    }

    function _bulkRemoveValidator(
        address owner,
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) internal virtual {
        uint256 validatorsLength = publicKeys.length;

        if (validatorsLength == 0) {
            revert ISSVNetworkCore.ValidatorDoesNotExist();
        }
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(owner, operatorIds, s);
        ClusterLib.validateClusterVersion(version, CoreLib.VERSION_ETH);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        uint32 validatorsRemoved;

        for (uint i; i < validatorsLength; ++i) {
            bytes32 hashedValidator = keccak256(abi.encodePacked(publicKeys[i], owner));
            bytes32 validatorData = s.validatorPKs[hashedValidator];

            if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds))
                revert ISSVNetworkCore.IncorrectValidatorStateWithData(publicKeys[i]);

            delete s.validatorPKs[hashedValidator];
            validatorsRemoved++;
        }

        if (cluster.active) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
                operatorIds,
                false,
                validatorsRemoved,
                s,
                sp
            );

            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());

            sp.updateDAO(false, validatorsRemoved);
        }

        cluster.validatorCount -= validatorsRemoved;

        {
            // Deviation-only model: baseline removed via ethValidatorCount (already updated above)
            // Do NOT subtract baseline from operatorEthVUnits
            // Only handle deviation cleanup for explicit EB clusters
            StorageEB storage seb = SSVStorageEB.load();
            ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
            
            if (ebSnapshot.vUnits > 0) {
                // Cluster has explicit EB tracking - subtract baseline from snapshot
                uint64 deltaClusterVUnits = uint64(validatorsRemoved) * VUNITS_PRECISION;
                ebSnapshot.vUnits -= deltaClusterVUnits;
                
                // When cluster becomes empty, clean up any remaining deviation
                if (cluster.validatorCount == 0) {
                    uint64 remainingVUnits = ebSnapshot.vUnits;
                    if (remainingVUnits > 0) {
                        // remainingVUnits is pure deviation (no baseline left since validatorCount=0)
                        uint256 operatorsLength = operatorIds.length;
                        for (uint256 i; i < operatorsLength; ++i) {
                            seb.operatorEthVUnits[operatorIds[i]] -= remainingVUnits;
                        }
                        StorageProtocol storage sp = SSVStorageProtocol.load();
                        sp.updateDAOEthVUnits(remainingVUnits, 0);
                    }
                    ebSnapshot.vUnits = 0;
                }
            }
            // For implicit clusters (ebSnapshot.vUnits == 0): nothing to do
            // Baseline removal handled via ethValidatorCount decrement
        }

        s.ethClusters[hashedCluster] = cluster.hashClusterData();

        for (uint i; i < validatorsLength; ++i) {
            emit ValidatorRemoved(owner, operatorIds, publicKeys[i], cluster);
        }
    }
}