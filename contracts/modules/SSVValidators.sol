// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVValidators} from "../interfaces/ISSVValidators.sol";
import {ClusterLib} from "../libraries/ClusterLib.sol";
import {OperatorLib} from "../libraries/OperatorLib.sol";
import {ProtocolLib} from "../libraries/ProtocolLib.sol";
import {ValidatorLib} from "../libraries/ValidatorLib.sol";
import {VERSION_ETH, VERSION_SSV, BPS_DENOMINATOR} from "../libraries/SSVCoreTypes.sol";
import {SSVStorage, StorageData} from "../libraries/storage/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/storage/SSVStorageProtocol.sol";
import {
    SSVStorageEB,
    StorageEB,
    ClusterEBSnapshot
} from "../libraries/storage/SSVStorageEB.sol";

contract SSVValidators is ISSVValidators {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;

    /**
     * @inheritdoc ISSVValidators
     */
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

    /**
     * @inheritdoc ISSVValidators
     */
    function bulkRegisterValidator(
        bytes[] memory publicKeys,
        uint64[] memory operatorIds,
        bytes[] calldata sharesData,
        Cluster memory cluster
    ) external payable override {
        _bulkRegisterValidator(msg.sender, msg.value, publicKeys, operatorIds, sharesData, cluster);
    }

    /**
     * @inheritdoc ISSVValidators
     */
    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        bytes[] memory publicKeys = new bytes[](1);
        publicKeys[0] = publicKey;

        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster);
    }

    /**
     * @inheritdoc ISSVValidators
     */
    function bulkRemoveValidator(
        bytes[] calldata publicKeys,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        _bulkRemoveValidator(msg.sender, publicKeys, operatorIds, cluster);
    }

    /**
     * @inheritdoc ISSVValidators
     */
    function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external override {
        StorageData storage s = SSVStorage.load();
        _validateExistingValidator(publicKey, msg.sender, ValidatorLib.hashOperatorIds(operatorIds), s);

        emit ValidatorExited(msg.sender, operatorIds, publicKey);
    }

    /**
     * @inheritdoc ISSVValidators
     */
    function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external override {
        if (publicKeys.length == 0) {
            revert ValidatorDoesNotExist();
        }
        StorageData storage s = SSVStorage.load();
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        for (uint i; i < publicKeys.length; ++i) {
            _validateExistingValidator(publicKeys[i], msg.sender, hashedOperatorIds, s);

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
                ebSnapshot.vUnits += uint64(validatorsLength) * BPS_DENOMINATOR;
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
            revert ValidatorDoesNotExist();
        }
        StorageData storage s = SSVStorage.load();

        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(owner, operatorIds, s);
        bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(operatorIds);

        uint32 validatorsRemoved;

        for (uint i; i < validatorsLength; ++i) {
            bytes32 hashedValidator = _validateExistingValidator(publicKeys[i], owner, hashedOperatorIds, s);

            delete s.validatorPKs[hashedValidator];
            validatorsRemoved++;
        }

        if (version == VERSION_ETH) {
            if (cluster.active) {
                StorageProtocol storage sp = SSVStorageProtocol.load();
                // slither-disable-next-line unused-return
                (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
                    operatorIds,
                    false,
                    validatorsRemoved,
                    s,
                    sp
                );

                cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());

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
                    uint64 deltaClusterVUnits = uint64(validatorsRemoved) * BPS_DENOMINATOR;
                    ebSnapshot.vUnits -= deltaClusterVUnits;
                    
                    // When cluster becomes empty, clean up any remaining deviation
                    if (cluster.validatorCount == 0) {
                        uint64 remainingVUnits = ebSnapshot.vUnits;
                        if (remainingVUnits > 0 && cluster.active) {
                            // remainingVUnits is pure deviation (no baseline left since validatorCount=0)
                            // Skip for liquidated clusters: deviation already cleaned up in _executeLiquidation
                            uint256 operatorsLength = operatorIds.length;
                            for (uint256 i; i < operatorsLength; ++i) {
                                if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;
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
        } else if (version == VERSION_SSV) {
            if (cluster.active) {
                StorageProtocol storage sp = SSVStorageProtocol.load();
                // slither-disable-next-line unused-return
                (uint64 clusterIndex, ) = OperatorLib.updateClusterOperatorsSSV(
                    operatorIds,
                    false,
                    validatorsRemoved,
                    s,
                    sp
                );
                uint64 currentNetworkFeeIndexSSV = sp.currentNetworkFeeIndexSSV();
                cluster.updateBalanceSSV(clusterIndex, currentNetworkFeeIndexSSV);
                cluster.index = clusterIndex;
                cluster.networkFeeIndex = currentNetworkFeeIndexSSV;
                sp.updateDAOSSV(false, validatorsRemoved);
            }

            cluster.validatorCount -= validatorsRemoved;

            if (cluster.validatorCount == 0) {
                StorageEB storage seb = SSVStorageEB.load();
                seb.clusterEB[hashedCluster].vUnits = 0;
            }

            s.clusters[hashedCluster] = cluster.hashClusterData();
        } else {
            revert IncorrectClusterVersion();
        }

        for (uint i; i < validatorsLength; ++i) {
            emit ValidatorRemoved(owner, operatorIds, publicKeys[i], cluster);
        }
    }

    function _validateExistingValidator(
        bytes memory publicKey,
        address owner,
        bytes32 hashedOperatorIds,
        StorageData storage s
    ) internal view returns (bytes32 hashedValidator) {
        hashedValidator = keccak256(abi.encodePacked(publicKey, owner));
        bytes32 validatorData = s.validatorPKs[hashedValidator];
        if (validatorData == bytes32(0)) {
            revert ValidatorDoesNotExist();
        }
        if (!ValidatorLib.validateCorrectState(validatorData, hashedOperatorIds)) {
            revert IncorrectValidatorStateWithData(publicKey);
        }
    }

}
