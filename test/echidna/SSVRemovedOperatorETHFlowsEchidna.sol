// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/ValidatorLib.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVValidators.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO, BPS_DENOMINATOR} from "../../contracts/libraries/SSVCoreTypes.sol";

contract SSVRemovedOperatorETHFlowsEchidna is SSVClusters, SSVOperators(0), SSVValidators {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;

    PackedETH private constant DEFAULT_OPERATOR_ETH_FEE = PACKED_ETH_ZERO;
    uint32 private constant EXPLICIT_EFFECTIVE_BALANCE = 64;
    uint32 private constant BASELINE_EFFECTIVE_BALANCE = 32;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;
    uint64 private op4;
    uint64 private removedOperatorId;

    bool private initialized;
    bool private operatorRemoved;
    bool private updateDecreaseViolation;
    bool private updateIncreaseViolation;
    bool private liquidationViolation;
    bool private finalRemovalViolation;

    bytes private validatorPublicKey;
    bytes private validatorShares;
    bytes32 private clusterId;
    ISSVNetworkCore.Cluster private clusterModel;

    constructor() {
        _initProtocolDefaults();
        _initOperators();

        uint64[] memory operatorIds = _operatorIds();
        clusterId = keccak256(abi.encodePacked(address(this), operatorIds));
        removedOperatorId = op1;
        validatorPublicKey = abi.encodePacked(bytes32(uint256(0x1111)), bytes16(uint128(0x2222)));
        validatorShares = hex"01";
        clusterModel = _emptyCluster();
    }

    receive() external payable {}

    function action_bug21_removed_operator_eb_decrease(uint256 seed) external {
        seed;
        if (initialized && (!clusterModel.active || clusterModel.validatorCount == 0)) return;
        if (!_prepareRemovedOperatorExplicitCluster()) {
            updateDecreaseViolation = true;
            return;
        }
        if (!clusterModel.active || clusterModel.validatorCount == 0) {
            updateDecreaseViolation = true;
            return;
        }

        StorageEB storage seb = SSVStorageEB.load();
        uint64 baselineVUnits = uint64(clusterModel.validatorCount) * BPS_DENOMINATOR;
        ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
        if (ebSnapshot.vUnits <= baselineVUnits) {
            updateDecreaseViolation = true;
            return;
        }

        uint64 blockNum = ebSnapshot.lastRootBlockNum + 1;
        _setCommittedRoot(seb, blockNum, _singleLeafRoot(clusterId, BASELINE_EFFECTIVE_BALANCE));
        bytes32[] memory proof = new bytes32[](0);
        uint64[] memory operatorIds = _operatorIds();

        try this.updateClusterBalance(blockNum, address(this), operatorIds, clusterModel, BASELINE_EFFECTIVE_BALANCE, proof) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            if (SSVStorage.load().ethClusters[clusterId] != clusterModel.hashClusterData()) {
                updateDecreaseViolation = true;
            }
            if (seb.clusterEB[clusterId].vUnits != baselineVUnits) {
                updateDecreaseViolation = true;
            }
            if (sp.daoTotalEthVUnits != baselineVUnits) {
                updateDecreaseViolation = true;
            }
            if (!_checkRemovedOperatorState()) {
                updateDecreaseViolation = true;
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                if (seb.operatorEthVUnits[operatorIds[i]] != 0) {
                    updateDecreaseViolation = true;
                }
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                if (operatorIds[i] == removedOperatorId) {
                    if (operator.ethValidatorCount != 0) {
                        updateDecreaseViolation = true;
                    }
                } else if (operator.ethValidatorCount != 1) {
                    updateDecreaseViolation = true;
                }
            }
        } catch {
            updateDecreaseViolation = true;
        }
    }

    function action_bug21_removed_operator_eb_increase(uint256 seed) external {
        seed;
        if (initialized && (!clusterModel.active || clusterModel.validatorCount == 0)) return;
        if (!_prepareRemovedOperatorExplicitCluster()) {
            updateIncreaseViolation = true;
            return;
        }
        if (!clusterModel.active || clusterModel.validatorCount == 0) {
            updateIncreaseViolation = true;
            return;
        }

        StorageEB storage seb = SSVStorageEB.load();
        uint64 expectedVUnits = ClusterLib.ebToVUnits(128);
        if (seb.clusterEB[clusterId].vUnits == expectedVUnits) return;

        uint64 blockNum = seb.clusterEB[clusterId].lastRootBlockNum + 1;
        _setCommittedRoot(seb, blockNum, _singleLeafRoot(clusterId, 128));
        bytes32[] memory proof = new bytes32[](0);
        uint64[] memory operatorIds = _operatorIds();
        uint64 expectedDeviation = expectedVUnits - BPS_DENOMINATOR;

        try this.updateClusterBalance(blockNum, address(this), operatorIds, clusterModel, 128, proof) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            if (SSVStorage.load().ethClusters[clusterId] != clusterModel.hashClusterData()) {
                updateIncreaseViolation = true;
            }
            if (seb.clusterEB[clusterId].vUnits != expectedVUnits) {
                updateIncreaseViolation = true;
            }
            if (sp.daoTotalEthVUnits != expectedVUnits) {
                updateIncreaseViolation = true;
            }
            if (!_checkRemovedOperatorState()) {
                updateIncreaseViolation = true;
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                if (operatorIds[i] == removedOperatorId) {
                    if (seb.operatorEthVUnits[operatorIds[i]] != 0 || operator.ethValidatorCount != 0) {
                        updateIncreaseViolation = true;
                    }
                } else {
                    if (seb.operatorEthVUnits[operatorIds[i]] != expectedDeviation || operator.ethValidatorCount != 1) {
                        updateIncreaseViolation = true;
                    }
                }
            }
        } catch {
            updateIncreaseViolation = true;
        }
    }

    function action_bug21_removed_operator_liquidation(uint256 seed) external {
        seed;
        if (initialized && (!clusterModel.active || clusterModel.validatorCount == 0)) return;
        if (!_prepareRemovedOperatorExplicitCluster()) {
            liquidationViolation = true;
            return;
        }
        if (!clusterModel.active || clusterModel.validatorCount == 0) {
            liquidationViolation = true;
            return;
        }

        uint64[] memory operatorIds = _operatorIds();
        try this.liquidate(address(this), operatorIds, clusterModel) {
            StorageData storage s = SSVStorage.load();
            StorageProtocol storage sp = SSVStorageProtocol.load();
            StorageEB storage seb = SSVStorageEB.load();

            clusterModel.active = false;
            clusterModel.balance = 0;
            clusterModel.index = 0;
            clusterModel.networkFeeIndex = 0;

            if (s.ethClusters[clusterId] != clusterModel.hashClusterData()) {
                liquidationViolation = true;
            }
            if (sp.daoTotalEthVUnits != 0) {
                liquidationViolation = true;
            }
            if (!_checkRemovedOperatorState()) {
                liquidationViolation = true;
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                if (seb.operatorEthVUnits[operatorIds[i]] != 0) {
                    liquidationViolation = true;
                }
                if (s.operators[operatorIds[i]].ethValidatorCount != 0) {
                    liquidationViolation = true;
                }
            }
        } catch {
            liquidationViolation = true;
        }
    }

    function action_bug21_removed_operator_final_removal(uint256 seed) external {
        seed;
        if (initialized && (!clusterModel.active || clusterModel.validatorCount != 1)) return;
        if (!_prepareRemovedOperatorExplicitCluster()) {
            finalRemovalViolation = true;
            return;
        }
        if (!clusterModel.active || clusterModel.validatorCount != 1) {
            finalRemovalViolation = true;
            return;
        }

        uint64[] memory operatorIds = _operatorIds();
        try this.removeValidator(validatorPublicKey, operatorIds, clusterModel) {
            StorageData storage s = SSVStorage.load();
            StorageProtocol storage sp = SSVStorageProtocol.load();
            StorageEB storage seb = SSVStorageEB.load();

            clusterModel.validatorCount = 0;

            if (s.ethClusters[clusterId] != clusterModel.hashClusterData()) {
                finalRemovalViolation = true;
            }
            if (seb.clusterEB[clusterId].vUnits != 0) {
                finalRemovalViolation = true;
            }
            if (sp.daoTotalEthVUnits != 0) {
                finalRemovalViolation = true;
            }
            if (s.validatorPKs[keccak256(abi.encodePacked(validatorPublicKey, address(this)))] != bytes32(0)) {
                finalRemovalViolation = true;
            }
            if (!_checkRemovedOperatorState()) {
                finalRemovalViolation = true;
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                if (seb.operatorEthVUnits[operatorIds[i]] != 0) {
                    finalRemovalViolation = true;
                }
                if (s.operators[operatorIds[i]].ethValidatorCount != 0) {
                    finalRemovalViolation = true;
                }
            }
        } catch {
            finalRemovalViolation = true;
        }
    }

    function echidna_bug21_removed_operator_eb_decrease_safe() external view returns (bool) {
        return !updateDecreaseViolation;
    }

    function echidna_bug21_removed_operator_eb_increase_safe() external view returns (bool) {
        return !updateIncreaseViolation;
    }

    function echidna_bug21_removed_operator_liquidation_safe() external view returns (bool) {
        return !liquidationViolation;
    }

    function echidna_bug21_removed_operator_final_removal_safe() external view returns (bool) {
        return !finalRemovalViolation;
    }

    function _prepareRemovedOperatorExplicitCluster() internal returns (bool) {
        if (!initialized) {
            uint64[] memory operatorIds = _operatorIds();
            try this.registerValidator(validatorPublicKey, operatorIds, validatorShares, _emptyCluster()) {
                initialized = true;
                clusterModel.validatorCount = 1;
                clusterModel.active = true;

                if (SSVStorage.load().ethClusters[clusterId] != clusterModel.hashClusterData()) {
                    return false;
                }
            } catch {
                return false;
            }
        }

        if (!clusterModel.active || clusterModel.validatorCount == 0) {
            return false;
        }

        StorageEB storage seb = SSVStorageEB.load();
        uint64 explicitVUnits = ClusterLib.ebToVUnits(EXPLICIT_EFFECTIVE_BALANCE);
        if (seb.clusterEB[clusterId].vUnits < explicitVUnits) {
            uint64 blockNum = seb.clusterEB[clusterId].lastRootBlockNum + 1;
            _setCommittedRoot(seb, blockNum, _singleLeafRoot(clusterId, EXPLICIT_EFFECTIVE_BALANCE));
            bytes32[] memory proof = new bytes32[](0);
            uint64[] memory operatorIds = _operatorIds();

            try this.updateClusterBalance(blockNum, address(this), operatorIds, clusterModel, EXPLICIT_EFFECTIVE_BALANCE, proof) {
                StorageProtocol storage sp = SSVStorageProtocol.load();
                if (SSVStorage.load().ethClusters[clusterId] != clusterModel.hashClusterData()) {
                    return false;
                }
                if (seb.clusterEB[clusterId].vUnits != explicitVUnits) {
                    return false;
                }
                if (sp.daoTotalEthVUnits != explicitVUnits) {
                    return false;
                }
                for (uint256 i; i < operatorIds.length; ++i) {
                    ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
                    if (operatorIds[i] == removedOperatorId && operatorRemoved) {
                        if (seb.operatorEthVUnits[operatorIds[i]] != 0) {
                            return false;
                        }
                        if (operator.ethValidatorCount != 0) {
                            return false;
                        }
                    } else {
                        if (seb.operatorEthVUnits[operatorIds[i]] != explicitVUnits - BPS_DENOMINATOR) {
                            return false;
                        }
                        if (operator.ethValidatorCount != 1) {
                            return false;
                        }
                    }
                }
            } catch {
                return false;
            }
        }

        uint64[] memory operatorIds = _operatorIds();
        if (!operatorRemoved) {
            StorageProtocol storage spBefore = SSVStorageProtocol.load();
            uint64 daoTotalBefore = spBefore.daoTotalEthVUnits;
            uint64 clusterVUnitsBefore = seb.clusterEB[clusterId].vUnits;
            uint64[] memory deviationsBefore = new uint64[](operatorIds.length);
            for (uint256 i; i < operatorIds.length; ++i) {
                deviationsBefore[i] = seb.operatorEthVUnits[operatorIds[i]];
            }
            try this.removeOperator(removedOperatorId) {
                StorageData storage s = SSVStorage.load();
                StorageEB storage sebLocal = SSVStorageEB.load();
                StorageProtocol storage spAfter = SSVStorageProtocol.load();
                if (s.ethClusters[clusterId] != clusterModel.hashClusterData()) {
                    return false;
                }
                if (!_checkRemovedOperatorState()) {
                    return false;
                }
                if (spAfter.daoTotalEthVUnits != daoTotalBefore) {
                    return false;
                }
                if (sebLocal.clusterEB[clusterId].vUnits != clusterVUnitsBefore) {
                    return false;
                }
                if (sebLocal.operatorEthVUnits[removedOperatorId] != 0) {
                    return false;
                }
                for (uint256 i; i < operatorIds.length; ++i) {
                    uint64 operatorId = operatorIds[i];
                    if (operatorId == removedOperatorId) continue;
                    if (sebLocal.operatorEthVUnits[operatorId] != deviationsBefore[i]) {
                        return false;
                    }
                    if (s.operators[operatorId].ethValidatorCount != 1) {
                        return false;
                    }
                }
                operatorRemoved = true;
            } catch {
                return false;
            }
        }

        return _checkRemovedOperatorState();
    }

    function _checkRemovedOperatorState() internal view returns (bool) {
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[removedOperatorId];
        return operator.ethSnapshot.block == 0 && operator.ethValidatorCount == 0
            && PackedETH.unwrap(operator.ethFee) == 0 && operator.owner == address(this);
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.ethNetworkFee = PACKED_ETH_ZERO;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = 1;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;

        SSVStorageEB.load().minBlocksBetweenUpdates = 0;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();
        op1 = _createOperator(s, bytes32(uint256(0x101)));
        op2 = _createOperator(s, bytes32(uint256(0x102)));
        op3 = _createOperator(s, bytes32(uint256(0x103)));
        op4 = _createOperator(s, bytes32(uint256(0x104)));
    }

    function _createOperator(StorageData storage s, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PACKED_SSV_ZERO,
            owner: address(this),
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _operatorIds() internal view returns (uint64[] memory operatorIds) {
        operatorIds = new uint64[](4);
        operatorIds[0] = op1;
        operatorIds[1] = op2;
        operatorIds[2] = op3;
        operatorIds[3] = op4;
    }

    function _emptyCluster() internal pure returns (ISSVNetworkCore.Cluster memory) {
        return ISSVNetworkCore.Cluster({validatorCount: 0, networkFeeIndex: 0, index: 0, active: true, balance: 0});
    }

    function _singleLeafRoot(bytes32 targetClusterId, uint32 effectiveBalance) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(targetClusterId, effectiveBalance))));
    }

    function _setCommittedRoot(StorageEB storage seb, uint64 blockNum, bytes32 root) internal {
        seb.ebRoots[blockNum] = root;
        seb.latestCommittedBlock = blockNum;
    }
}
