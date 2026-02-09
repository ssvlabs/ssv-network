// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageEB.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";


contract ClusterUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function liquidate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.liquidate(clusterOwner, operatorIds, cluster);
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        clusters.reactivate{value: msg.value}(operatorIds, cluster);
    }
}

contract SSVEdgeCasesEchidna is SSVClusters {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    PackedETH private constant DEFAULT_OPERATOR_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_OPERATOR_SSV_FEE = PackedSSV.wrap(1);
    PackedETH private constant DEFAULT_ETH_NETWORK_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_SSV_NETWORK_FEE = PackedSSV.wrap(1);
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    uint32 private constant YOYO_LOOPS = 3;

    ClusterUser private owner;
    ClusterUser private liquidator;

    uint64 private op1;
    uint64 private op2;
    uint64 private opSpam;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        bool exists;
    }

    ClusterRecord private record;
    bytes32 private clusterId;

    bool private yoyoLiquidationFailed;
    bool private reactivationVUnitsMismatch;
    bool private validatorSpamFailed;
    bool private feeIndexOverflowMissed;
    bool private feeIndexOverflowSSVMissed;

    constructor() {
        ISSVClusters self = ISSVClusters(address(this));
        owner = new ClusterUser(self);
        liquidator = new ClusterUser(self);

        _initProtocolDefaults();
        _initOperators();
        _initCluster();
    }

    receive() external payable {}

    function action_fund(uint256 amount) external payable {
        amount;
    }

    function action_yoyo_liquidation(uint256 seed) external {
        if (!record.exists) return;

        uint64[] memory operatorIds = _clusterOperatorIds();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (!record.cluster.active) {
            if (address(this).balance == 0) return;
            uint256 amount = _boundAmount(seed, address(this).balance);
            if (amount == 0) amount = 1;

            ISSVNetworkCore.Cluster memory cluster = record.cluster;
            try owner.reactivate{value: amount}(operatorIds, cluster) {
                record.cluster.active = true;
                record.cluster.balance += amount;
                record.cluster.index = _currentClusterIndex(operatorIds);
                record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
                SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
            } catch {
                return;
            }
        }

        for (uint32 i; i < YOYO_LOOPS; ++i) {
            uint64 burnRate = _burnRate(operatorIds);
            if (burnRate == 0) return;

            uint64 vUnits = ClusterLib.getVUnits(clusterId, record.cluster.validatorCount);
            uint128 perBlockUnits = (uint128(burnRate + PackedETH.unwrap(sp.ethNetworkFee)) * uint128(vUnits)) / VUNITS_PRECISION;
            uint256 perBlock = PackedETHLib.unpack(PackedETH.wrap(uint64(perBlockUnits)));
            if (perBlock == 0) return;

            if (record.cluster.balance > perBlock) {
                record.cluster.balance = perBlock;
                SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
            }

            _fastForwardOperators(operatorIds, 2);
            sp.ethNetworkFeeIndex += 2 * PackedETH.unwrap(sp.ethNetworkFee);
            sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);

            _settleCluster(operatorIds);

            bool liquidatable = record.cluster.isLiquidatableWithEB(
                clusterId,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );

            if (!liquidatable) {
                yoyoLiquidationFailed = true;
                return;
            }

            ISSVNetworkCore.Cluster memory cluster = record.cluster;
            try liquidator.liquidate(record.owner, operatorIds, cluster) {
                record.cluster.active = false;
                record.cluster.balance = 0;
                record.cluster.index = 0;
                record.cluster.networkFeeIndex = 0;
                SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
            } catch {
                yoyoLiquidationFailed = true;
                return;
            }

            uint256 available = address(this).balance;
            if (available == 0) return;
            uint256 amount = _boundAmount(seed >> 8, available);
            if (amount == 0) amount = 1;

            cluster = record.cluster;
            try owner.reactivate{value: amount}(operatorIds, cluster) {
                record.cluster.active = true;
                record.cluster.balance += amount;
                record.cluster.index = _currentClusterIndex(operatorIds);
                record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
                SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
            } catch {
                yoyoLiquidationFailed = true;
                return;
            }
        }
    }

    function action_reactivation_vunits(uint256 seed) external {
        if (!record.exists) return;

        uint64[] memory operatorIds = _clusterOperatorIds();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (!record.cluster.active) {
            if (address(this).balance == 0) return;
            uint256 amount = _boundAmount(seed, address(this).balance);
            if (amount == 0) amount = 1;

            ISSVNetworkCore.Cluster memory cluster = record.cluster;
            try owner.reactivate{value: amount}(operatorIds, cluster) {
                record.cluster.active = true;
                record.cluster.balance += amount;
                record.cluster.index = _currentClusterIndex(operatorIds);
                record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
                SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
            } catch {
                return;
            }
        }

        StorageEB storage seb = SSVStorageEB.load();
        uint64 baseline = uint64(record.cluster.validatorCount) * VUNITS_PRECISION;
        if (baseline == 0) return;
        
        // Deviation-only model: set up a valid scenario with POSITIVE deviation
        // (e.g., 48 ETH per validator = 16 ETH deviation per validator)
        // vUnits = baseline + deviation (must be >= baseline due to 32 ETH floor)
        uint64 deviation = baseline / 4; // 25% deviation above baseline
        uint64 clusterVUnits = baseline + deviation;

        // Set cluster EB snapshot with positive deviation
        seb.clusterEB[clusterId].vUnits = clusterVUnits;
        
        // In deviation-only model, operatorEthVUnits stores ONLY the deviation, not full vUnits
        // Record the deviation we're adding to operators
        for (uint256 i; i < operatorIds.length; ++i) {
            seb.operatorEthVUnits[operatorIds[i]] = deviation;
        }

        record.cluster.balance = 0;
        SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        try liquidator.liquidate(record.owner, operatorIds, cluster) {
            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {
            return;
        }

        if (address(this).balance == 0) return;
        uint256 reactivateAmount = _boundAmount(seed >> 8, address(this).balance);
        if (reactivateAmount == 0) reactivateAmount = 1;

        cluster = record.cluster;
        try owner.reactivate{value: reactivateAmount}(operatorIds, cluster) {
            record.cluster.active = true;
            record.cluster.balance += reactivateAmount;
            record.cluster.index = _currentClusterIndex(operatorIds);
            record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {
            return;
        }

        // In deviation-only model:
        // - Liquidation subtracts the cluster's deviation from operatorEthVUnits
        // - clusterEB.vUnits is reset to 0 during liquidation
        // - Reactivation with clusterEB.vUnits == 0 means clusterDeviation = 0, so nothing added
        // Expected: operatorEthVUnits should be 0 after liquidation removed the deviation
        for (uint256 i; i < operatorIds.length; ++i) {
            uint64 opVUnits = seb.operatorEthVUnits[operatorIds[i]];
            // After liquidation + reactivation, deviation should be removed (= 0)
            // because this was the only cluster contributing deviation
            if (opVUnits != 0) {
                reactivationVUnitsMismatch = true;
            }
        }
    }

    function action_validator_spam(uint256 seed) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[opSpam];
        if (operator.ethSnapshot.block == 0) return;

        PackedETH fee = sp.operatorMaxFee.eq(PACKED_ETH_ZERO) ? DEFAULT_OPERATOR_ETH_FEE : sp.operatorMaxFee;
        operator.ethFee = fee;
        operator.ethValidatorCount = sp.validatorsPerOperatorLimit;

        uint32 blocks = uint32(seed % MAX_ADVANCE_BLOCKS) + 1;
        uint64 indexBefore = operator.ethSnapshot.index;
        PackedETH balanceBefore = operator.ethSnapshot.balance;

        _fastForwardOperator(opSpam, blocks);

        if (operator.ethSnapshot.index < indexBefore) {
            validatorSpamFailed = true;
            return;
        }
        if (operator.ethSnapshot.balance.lt(balanceBefore)) {
            validatorSpamFailed = true;
            return;
        }
        if (operator.ethSnapshot.index - indexBefore != uint64(blocks) * PackedETH.unwrap(fee)) {
            validatorSpamFailed = true;
        }
    }

    function action_fee_index_overflow() external {
        try this.probe_fee_index_overflow_eth() {
            feeIndexOverflowMissed = true;
        } catch {}

        try this.probe_fee_index_overflow_ssv() {
            feeIndexOverflowSSVMissed = true;
        } catch {}
    }

    function probe_fee_index_overflow_eth() external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 currentBlock = uint32(block.number);
        if (currentBlock == 0) return;

        uint64 oldIndex = sp.ethNetworkFeeIndex;
        PackedETH oldFee = sp.ethNetworkFee;
        uint32 oldBlock = sp.ethNetworkFeeIndexBlockNumber;

        sp.ethNetworkFeeIndex = type(uint64).max - 1;
        sp.ethNetworkFee = PackedETH.wrap(type(uint64).max);
        sp.ethNetworkFeeIndexBlockNumber = currentBlock - 1;

        ProtocolLib.currentNetworkFeeIndex(sp);

        sp.ethNetworkFeeIndex = oldIndex;
        sp.ethNetworkFee = oldFee;
        sp.ethNetworkFeeIndexBlockNumber = oldBlock;
    }

    function probe_fee_index_overflow_ssv() external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 currentBlock = uint32(block.number);
        if (currentBlock == 0) return;

        uint64 oldIndex = sp.networkFeeIndex;
        PackedSSV oldFee = sp.networkFee;
        uint32 oldBlock = sp.networkFeeIndexBlockNumber;

        sp.networkFeeIndex = type(uint64).max - 1;
        sp.networkFee = PackedSSV.wrap(type(uint64).max);
        sp.networkFeeIndexBlockNumber = currentBlock - 1;

        ProtocolLib.currentNetworkFeeIndexSSV(sp);

        sp.networkFeeIndex = oldIndex;
        sp.networkFee = oldFee;
        sp.networkFeeIndexBlockNumber = oldBlock;
    }

    function echidna_yoyo_liquidation_reactivates() external view returns (bool) {
        return !yoyoLiquidationFailed;
    }

    function echidna_reactivation_restores_vunits() external view returns (bool) {
        return !reactivationVUnitsMismatch;
    }

    function echidna_validator_spam_safe() external view returns (bool) {
        return !validatorSpamFailed;
    }

    function echidna_fee_index_overflow_protected() external view returns (bool) {
        return !feeIndexOverflowMissed && !feeIndexOverflowSSVMissed;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 3000;
        sp.ethNetworkFee = DEFAULT_ETH_NETWORK_FEE;
        sp.networkFee = DEFAULT_SSV_NETWORK_FEE;
        sp.ethNetworkFeeIndex = 0;
        sp.networkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
        sp.minimumBlocksBeforeLiquidationSSV = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateralSSV = PACKED_SSV_ZERO;
        sp.operatorMaxFee = PackedETH.wrap(type(uint64).max);
        sp.operatorMaxFeeSSV = type(uint64).max;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();

        op1 = _createOperator(s, address(owner), bytes32(uint256(0x1)));
        op2 = _createOperator(s, address(owner), bytes32(uint256(0x2)));
        opSpam = _createOperator(s, address(this), bytes32(uint256(0x3)));
    }

    function _createOperator(StorageData storage s, address ownerAddr, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: DEFAULT_OPERATOR_SSV_FEE,
            owner: ownerAddr,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _initCluster() internal {
        uint64[] memory operatorIds = _clusterOperatorIds();
        clusterId = keccak256(abi.encodePacked(address(owner), operatorIds));

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: 4,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        SSVStorage.load().ethClusters[clusterId] = cluster.hashClusterData();
        record = ClusterRecord({cluster: cluster, owner: address(owner), exists: true});
    }

    function _clusterOperatorIds() internal view returns (uint64[] memory) {
        uint64[] memory ids = new uint64[](2);
        ids[0] = op1;
        ids[1] = op2;
        return ids;
    }

    function _currentClusterIndex(uint64[] memory operatorIds) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 currentBlock = uint64(block.number);
        uint64 clusterIndex;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            ISSVNetworkCore.Operator storage operator = s.operators[operatorIds[i]];
            uint64 blockDiff = currentBlock - uint64(operator.ethSnapshot.block);
            clusterIndex += operator.ethSnapshot.index + blockDiff * PackedETH.unwrap(operator.ethFee);
        }
        return clusterIndex;
    }

    function _burnRate(uint64[] memory operatorIds) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 burnRate;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            burnRate += PackedETH.unwrap(s.operators[operatorIds[i]].ethFee);
        }
        return burnRate;
    }

    function _fastForwardOperators(uint64[] memory operatorIds, uint32 blocks) internal {
        for (uint256 i; i < operatorIds.length; ++i) {
            _fastForwardOperator(operatorIds[i], blocks);
        }
    }

    function _fastForwardOperator(uint64 operatorId, uint32 blocks) internal {
        StorageData storage s = SSVStorage.load();
        StorageEB storage seb = SSVStorageEB.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
        if (operator.ethSnapshot.block == 0) return;

        uint32 currentBlock = uint32(block.number);
        uint64 blockDiffFee = uint64(blocks) * PackedETH.unwrap(operator.ethFee);
        
        // Deviation-only model: effectiveVUnits = baseline + storedDeviation
        uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

        operator.ethSnapshot.index += blockDiffFee;
        if (effectiveVUnits != 0 && blockDiffFee != 0) {
            uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
            operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
        }
        operator.ethSnapshot.block = currentBlock;
    }

    function _settleCluster(uint64[] memory operatorIds) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _currentClusterIndex(operatorIds);
        uint64 networkFeeIndex = sp.currentNetworkFeeIndex();

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;
        SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }
}
