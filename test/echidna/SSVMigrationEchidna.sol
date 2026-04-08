// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "./SSVStakingEchidna.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETHLib, PackedSSVLib} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVCoreTypes.sol";

contract MigrationClusterUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function migrateToETH(uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster) external payable {
        clusters.migrateClusterToETH{value: msg.value}(operatorIds, cluster);
    }

    function liquidateSSV(uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster) external {
        clusters.liquidateSSV(address(this), operatorIds, cluster);
    }

    function updateClusterBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] calldata merkleProof
    ) external {
        clusters.updateClusterBalance(blockNum, clusterOwner, operatorIds, cluster, effectiveBalance, merkleProof);
    }
}

contract MigrationOperatorUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    receive() external payable {}

    function remove(uint64 operatorId) external {
        operators.removeOperator(operatorId);
    }
}

/// @notice Targeted migration harness for BUG-14 class: removed operators and frozen SSV index accounting.
contract SSVMigrationEchidna is SSVClusters, SSVOperators(0), SSVDAO {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    PackedETH private constant DEFAULT_OPERATOR_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_OPERATOR_SSV_FEE = PackedSSV.wrap(1);
    PackedETH private constant DEFAULT_NETWORK_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_NETWORK_SSV_FEE = PackedSSV.wrap(1);
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint32 private constant INITIAL_VALIDATOR_COUNT = 2;
    uint256 private constant INITIAL_SSV_BALANCE = 1_000 * DEDUCTED_DIGITS;

    MockToken private token;

    MigrationClusterUser private clusterOwner;
    MigrationOperatorUser private opOwner1;
    MigrationOperatorUser private opOwner2;
    MigrationOperatorUser private opOwner3;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;
    uint64[] private operatorIds;

    struct SSVClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        bool exists;
    }

    bytes32 private ssvClusterId;
    SSVClusterRecord private ssvRecord;

    uint256 private unallocatedEth;
    bool private accountingViolation;
    bool private removedEthInitViolation;
    bool private removedStateViolation;
    bool private migrationObserved;
    bool private migrationValidatorShiftViolation;
    bool private liquidatedMigrationViolation;
    bool private liquidatedMigrationObserved;
    bool private ssvEbUpdateViolation;
    uint32 private daoValidatorCountBeforeMigration;
    uint32 private ethDaoValidatorCountBeforeMigration;
    uint32 private migratedValidatorCount;

    mapping(uint64 => bool) private removedTracked;
    mapping(uint64 => bool) private removedBeforeMigration;
    mapping(uint64 => uint64) private removedFrozenIndex;

    constructor() SSVDAO(address(new CSSVTokenMock(address(this)))) {
        token = new MockToken();
        _mockSetToken(address(token));

        ISSVClusters clustersSelf = ISSVClusters(address(this));
        ISSVOperators operatorsSelf = ISSVOperators(address(this));

        clusterOwner = new MigrationClusterUser(clustersSelf);
        opOwner1 = new MigrationOperatorUser(operatorsSelf);
        opOwner2 = new MigrationOperatorUser(operatorsSelf);
        opOwner3 = new MigrationOperatorUser(operatorsSelf);

        _initProtocolDefaults();
        _initOperators();
        _initActiveSSVCluster();
    }

    receive() external payable {}

    function action_fund_eth(uint256 amount) external payable {
        amount;
        if (msg.value == 0) return;
        unallocatedEth += msg.value;
    }

    /// @notice Liquidates the legacy SSV cluster through the self-liquidation path.
    function action_liquidate_ssv() external {
        if (!ssvRecord.exists || !ssvRecord.cluster.active) return;

        _settleSsvCluster();

        ISSVNetworkCore.Cluster memory clusterBefore = ssvRecord.cluster;
        try clusterOwner.liquidateSSV(operatorIds, clusterBefore) {
            ISSVNetworkCore.Cluster memory expectedAfter = ISSVNetworkCore.Cluster({
                validatorCount: clusterBefore.validatorCount,
                networkFeeIndex: 0,
                index: 0,
                active: false,
                balance: 0
            });

            if (SSVStorage.load().clusters[ssvClusterId] != expectedAfter.hashClusterData()) {
                liquidatedMigrationViolation = true;
                return;
            }

            ssvRecord.cluster = expectedAfter;
        } catch {}
    }

    /// @notice Advances SSV operator/network fee indexes without syncing cluster index.
    function action_advance_ssv_without_cluster_sync(uint256 seed) external {
        if (!ssvRecord.exists || !ssvRecord.cluster.active) return;
        uint32 blocks_ = uint32(seed % MAX_ADVANCE_BLOCKS) + 1;
        _fastForwardSSV(blocks_);
    }

    /// @notice Settles SSV cluster state (index + balance) to current operator/network indexes.
    function action_sync_ssv_cluster() external {
        _settleSsvCluster();
    }

    /// @notice Removes one cluster operator and tracks frozen index/state.
    function action_remove_operator(uint256 seed) external {
        if (!ssvRecord.exists) return;

        uint64 operatorId = operatorIds[seed % operatorIds.length];
        address ownerAddr = _operatorOwner(operatorId);
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory before = SSVStorage.load().operators[operatorId];
        if (before.snapshot.block == 0 && before.ethSnapshot.block == 0) return;

        MigrationOperatorUser owner = _operatorUser(ownerAddr);
        try owner.remove(operatorId) {
            ISSVNetworkCore.Operator memory afterOp = SSVStorage.load().operators[operatorId];
            if (afterOp.snapshot.block != 0 || afterOp.ethSnapshot.block != 0) {
                removedStateViolation = true;
                return;
            }

            removedTracked[operatorId] = true;
            removedBeforeMigration[operatorId] = ssvRecord.exists;
            removedFrozenIndex[operatorId] = afterOp.snapshot.index;
        } catch {}
    }

    /// @notice Updates the EB snapshot for a legacy SSV cluster and asserts the path is snapshot-only.
    function action_update_ssv_cluster_balance_valid(uint256 seed) external {
        if (!ssvRecord.exists) return;

        StorageData storage s = SSVStorage.load();
        if (s.clusters[ssvClusterId] != ssvRecord.cluster.hashClusterData()) return;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot memory ebBefore = seb.clusterEB[ssvClusterId];

        if (uint64(block.number) < ebBefore.lastRootBlockNum + 1) return;
        if (ebBefore.lastUpdateBlock != 0 && uint64(block.number) < ebBefore.lastUpdateBlock + seb.minBlocksBetweenUpdates)
        {
            return;
        }

        uint64 minBlockNum = ebBefore.lastRootBlockNum + 1;
        uint64 blockNum = minBlockNum + uint64((seed >> 8) % (uint64(block.number) - minBlockNum + 1));

        uint32 minEb = ssvRecord.cluster.validatorCount * uint32(DEFAULT_EB_PER_VALIDATOR / 1 ether);
        uint32 maxEb = minEb + (ssvRecord.cluster.validatorCount * 16);
        uint32 effectiveBalance = minEb;
        if (maxEb > minEb) {
            effectiveBalance = minEb + uint32((seed >> 24) % (maxEb - minEb + 1));
        }

        bytes32 storedSsvHashBefore = s.clusters[ssvClusterId];
        bytes32 storedEthHashBefore = s.ethClusters[ssvClusterId];
        uint32 daoValidatorCountBefore = sp.daoValidatorCount;
        uint32 ethDaoValidatorCountBefore = sp.ethDaoValidatorCount;
        uint64 daoTotalEthVUnitsBefore = sp.daoTotalEthVUnits;

        uint32[] memory operatorValidatorCountsBefore = new uint32[](operatorIds.length);
        uint32[] memory operatorEthValidatorCountsBefore = new uint32[](operatorIds.length);
        uint64[] memory operatorEthVUnitsBefore = new uint64[](operatorIds.length);
        for (uint256 i; i < operatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[operatorIds[i]];
            operatorValidatorCountsBefore[i] = op.validatorCount;
            operatorEthValidatorCountsBefore[i] = op.ethValidatorCount;
            operatorEthVUnitsBefore[i] = seb.operatorEthVUnits[operatorIds[i]];
        }

        bytes32 root = _singleLeafRoot(ssvClusterId, effectiveBalance);
        _setCommittedRoot(seb, blockNum, root);
        bytes32[] memory proof = new bytes32[](0);

        try clusterOwner.updateClusterBalance(
            blockNum, ssvRecord.owner, operatorIds, ssvRecord.cluster, effectiveBalance, proof
        ) {
            ClusterEBSnapshot storage ebAfter = seb.clusterEB[ssvClusterId];
            if (s.clusters[ssvClusterId] != storedSsvHashBefore) {
                ssvEbUpdateViolation = true;
            }
            if (s.ethClusters[ssvClusterId] != storedEthHashBefore) {
                ssvEbUpdateViolation = true;
            }
            if (sp.daoValidatorCount != daoValidatorCountBefore) {
                ssvEbUpdateViolation = true;
            }
            if (sp.ethDaoValidatorCount != ethDaoValidatorCountBefore) {
                ssvEbUpdateViolation = true;
            }
            if (sp.daoTotalEthVUnits != daoTotalEthVUnitsBefore) {
                ssvEbUpdateViolation = true;
            }
            for (uint256 i; i < operatorIds.length; ++i) {
                ISSVNetworkCore.Operator storage op = s.operators[operatorIds[i]];
                if (op.validatorCount != operatorValidatorCountsBefore[i]) {
                    ssvEbUpdateViolation = true;
                }
                if (op.ethValidatorCount != operatorEthValidatorCountsBefore[i]) {
                    ssvEbUpdateViolation = true;
                }
                if (seb.operatorEthVUnits[operatorIds[i]] != operatorEthVUnitsBefore[i]) {
                    ssvEbUpdateViolation = true;
                }
            }
            if (ebAfter.vUnits != ClusterLib.ebToVUnits(effectiveBalance)) {
                ssvEbUpdateViolation = true;
            }
            if (ebAfter.lastRootBlockNum != blockNum) {
                ssvEbUpdateViolation = true;
            }
            if (ebAfter.lastUpdateBlock != uint64(block.number)) {
                ssvEbUpdateViolation = true;
            }
        } catch {
            ssvEbUpdateViolation = true;
        }
    }

    /// @notice Attempts SSV->ETH migration and checks BUG-14 accounting properties on success.
    function action_migrate_ssv_to_eth(uint256 seed) external {
        if (!ssvRecord.exists || !ssvRecord.cluster.active) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 clusterIndexSSV = _currentClusterIndexSsv();
        uint64 currentNfiSSV = sp.currentNetworkFeeIndexSSV();

        ISSVNetworkCore.Cluster memory clusterBefore = ssvRecord.cluster;
        ISSVNetworkCore.Cluster memory expected = ISSVNetworkCore.Cluster({
            validatorCount: clusterBefore.validatorCount,
            networkFeeIndex: clusterBefore.networkFeeIndex,
            index: clusterBefore.index,
            active: clusterBefore.active,
            balance: clusterBefore.balance
        });
        expected.updateBalanceSSV(clusterIndexSSV, currentNfiSSV);
        uint256 expectedRefund = expected.balance;

        uint256 minRequired = _migrationMinRequired(clusterBefore, sp);

        if (unallocatedEth <= minRequired) return;
        uint256 amount = seed % (unallocatedEth + 1);
        if (amount <= minRequired) amount = minRequired + 1;
        if (amount > unallocatedEth) return;

        uint256 ownerTokenBefore = token.balanceOf(ssvRecord.owner);
        uint32 daoBefore = sp.daoValidatorCount;
        uint32 ethDaoBefore = sp.ethDaoValidatorCount;
        uint32 validatorsMigrated = clusterBefore.validatorCount;
        MigrationClusterUser owner = clusterOwner;
        try owner.migrateToETH{value: amount}(operatorIds, clusterBefore) {
            uint256 ownerTokenAfter = token.balanceOf(ssvRecord.owner);
            uint256 actualRefund = ownerTokenAfter - ownerTokenBefore;
            if (actualRefund != expectedRefund) {
                accountingViolation = true;
            }

            migrationObserved = true;
            daoValidatorCountBeforeMigration = daoBefore;
            ethDaoValidatorCountBeforeMigration = ethDaoBefore;
            migratedValidatorCount = validatorsMigrated;

            uint32 daoAfter = sp.daoValidatorCount;
            uint32 ethDaoAfter = sp.ethDaoValidatorCount;
            if (daoAfter != daoBefore - validatorsMigrated) {
                migrationValidatorShiftViolation = true;
            }
            if (ethDaoAfter != ethDaoBefore + validatorsMigrated) {
                migrationValidatorShiftViolation = true;
            }
            if (uint256(daoAfter) + uint256(ethDaoAfter) != uint256(daoBefore) + uint256(ethDaoBefore)) {
                migrationValidatorShiftViolation = true;
            }

            for (uint256 i; i < operatorIds.length; ++i) {
                uint64 operatorId = operatorIds[i];
                if (!removedBeforeMigration[operatorId]) continue;

                ISSVNetworkCore.Operator memory op = s.operators[operatorId];
                if (op.ethSnapshot.block != 0 || op.ethValidatorCount != 0) {
                    removedEthInitViolation = true;
                }
            }

            ssvRecord.exists = false;
            unallocatedEth -= amount;
        } catch {}
    }

    /// @notice Attempts SSV->ETH migration from an already-liquidated legacy cluster.
    function action_migrate_liquidated_ssv_to_eth(uint256 seed) external {
        if (!ssvRecord.exists || ssvRecord.cluster.active) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        ISSVNetworkCore.Cluster memory clusterBefore = ssvRecord.cluster;

        uint256 minRequired = _migrationMinRequired(clusterBefore, sp);
        if (unallocatedEth <= minRequired) return;

        uint256 amount = seed % (unallocatedEth + 1);
        if (amount <= minRequired) amount = minRequired + 1;
        if (amount > unallocatedEth) return;

        uint256 ownerTokenBefore = token.balanceOf(ssvRecord.owner);
        uint32 daoBefore = sp.daoValidatorCount;
        uint32 ethDaoBefore = sp.ethDaoValidatorCount;
        uint32 validatorsMigrated = clusterBefore.validatorCount;

        try clusterOwner.migrateToETH{value: amount}(operatorIds, clusterBefore) {
            liquidatedMigrationObserved = true;

            uint256 actualRefund = token.balanceOf(ssvRecord.owner) - ownerTokenBefore;
            if (actualRefund != 0) {
                liquidatedMigrationViolation = true;
            }

            if (sp.daoValidatorCount != daoBefore) {
                liquidatedMigrationViolation = true;
            }
            if (sp.ethDaoValidatorCount != ethDaoBefore + validatorsMigrated) {
                liquidatedMigrationViolation = true;
            }

            if (s.clusters[ssvClusterId] != 0) {
                liquidatedMigrationViolation = true;
            }
            if (s.ethClusters[ssvClusterId] == 0) {
                liquidatedMigrationViolation = true;
            }

            ssvRecord.exists = false;
            unallocatedEth -= amount;
        } catch {}
    }

    /// @notice Ensures migration preconditions are reachable and immediately attempts migration.
    function action_prepare_migration_and_attempt(uint256 seed) external payable {
        if (!ssvRecord.exists) return;
        if (msg.value != 0) {
            unallocatedEth += msg.value;
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint256 minRequired = _migrationMinRequired(ssvRecord.cluster, sp);
        if (unallocatedEth <= minRequired) {
            uint256 required = minRequired + 1 - unallocatedEth;
            uint256 freeBalance = address(this).balance > unallocatedEth ? address(this).balance - unallocatedEth : 0;
            if (required > freeBalance) return;
            unallocatedEth += required;
        }

        if (ssvRecord.cluster.active) {
            this.action_migrate_ssv_to_eth(seed);
        } else {
            this.action_migrate_liquidated_ssv_to_eth(seed);
        }
    }

    function echidna_migration_removed_refund_exact() external view returns (bool) {
        return !accountingViolation;
    }

    function echidna_migration_removed_operator_not_eth_initialized() external view returns (bool) {
        return !removedEthInitViolation;
    }

    function echidna_migration_net_zero_validators() external view returns (bool) {
        if (!migrationObserved) return true;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (sp.daoValidatorCount != daoValidatorCountBeforeMigration - migratedValidatorCount) return false;
        if (sp.ethDaoValidatorCount != ethDaoValidatorCountBeforeMigration + migratedValidatorCount) return false;
        if (
            uint256(sp.daoValidatorCount) + uint256(sp.ethDaoValidatorCount) !=
            uint256(daoValidatorCountBeforeMigration) + uint256(ethDaoValidatorCountBeforeMigration)
        ) return false;

        return !migrationValidatorShiftViolation;
    }

    function echidna_removed_operator_state_and_frozen_index_preserved() external view returns (bool) {
        if (removedStateViolation) return false;

        StorageData storage s = SSVStorage.load();
        if (!_checkRemoved(op1, s)) return false;
        if (!_checkRemoved(op2, s)) return false;
        if (!_checkRemoved(op3, s)) return false;
        return true;
    }

    function echidna_liquidated_migration_branch_correct() external view returns (bool) {
        if (!liquidatedMigrationObserved) return true;
        return !liquidatedMigrationViolation;
    }

    function echidna_ssv_eb_update_only_snapshot() external view returns (bool) {
        return !ssvEbUpdateViolation;
    }

    function _checkRemoved(uint64 operatorId, StorageData storage s) internal view returns (bool) {
        if (!removedTracked[operatorId]) return true;

        ISSVNetworkCore.Operator storage op = s.operators[operatorId];
        if (op.snapshot.block != 0 || op.ethSnapshot.block != 0) return false;
        if (op.snapshot.index != removedFrozenIndex[operatorId]) return false;
        return true;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.ethNetworkFee = DEFAULT_NETWORK_ETH_FEE;
        sp.networkFee = DEFAULT_NETWORK_SSV_FEE;
        sp.ethNetworkFeeIndex = 0;
        sp.networkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumBlocksBeforeLiquidationSSV = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
        sp.minimumLiquidationCollateralSSV = PACKED_SSV_ZERO;
        sp.operatorMaxFee = PackedETH.wrap(type(uint64).max);
        sp.operatorMaxFeeSSV = type(uint64).max;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();
        op1 = _createOperator(s, address(opOwner1), bytes32(uint256(0x101)));
        op2 = _createOperator(s, address(opOwner2), bytes32(uint256(0x102)));
        op3 = _createOperator(s, address(opOwner3), bytes32(uint256(0x103)));

        operatorIds.push(op1);
        operatorIds.push(op2);
        operatorIds.push(op3);
    }

    function _initActiveSSVCluster() internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ssvClusterId = keccak256(abi.encodePacked(address(clusterOwner), operatorIds));
        token.mint(address(this), INITIAL_SSV_BALANCE);

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: INITIAL_VALIDATOR_COUNT,
            networkFeeIndex: sp.currentNetworkFeeIndexSSV(),
            index: _currentClusterIndexSsv(),
            active: true,
            balance: INITIAL_SSV_BALANCE
        });

        s.clusters[ssvClusterId] = cluster.hashClusterData();
        sp.updateDAOSSV(true, cluster.validatorCount);

        for (uint256 i; i < operatorIds.length; ++i) {
            s.operators[operatorIds[i]].validatorCount += cluster.validatorCount;
        }

        ssvRecord = SSVClusterRecord({
            cluster: cluster,
            owner: address(clusterOwner),
            exists: true
        });
    }

    function _createOperator(StorageData storage s, address owner, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: DEFAULT_OPERATOR_SSV_FEE,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_SSV_ZERO
            }),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_ETH_ZERO
            })
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _currentClusterIndexSsv() internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;
        for (uint256 i; i < operatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[operatorIds[i]];
            uint64 index = op.snapshot.index;
            if (op.snapshot.block != 0) {
                index += uint64(uint32(block.number) - op.snapshot.block) * PackedSSV.unwrap(op.fee);
            }
            clusterIndex += index;
        }
        return clusterIndex;
    }

    function _predictedMigrationBurnRateEth() internal view returns (uint64 burnRateETH) {
        StorageData storage s = SSVStorage.load();
        for (uint256 i; i < operatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage operator = s.operators[operatorIds[i]];
            if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;
            burnRateETH += PackedETH.unwrap(operator.ethFee);
        }
    }

    function _migrationMinRequired(ISSVNetworkCore.Cluster memory clusterBefore, StorageProtocol storage sp)
        internal
        view
        returns (uint256 minRequired)
    {
        uint64 burnRateETH = _predictedMigrationBurnRateEth();
        uint64 vUnits = ClusterLib.getVUnits(ssvClusterId, clusterBefore.validatorCount);
        uint256 thresholdUnits = (
            uint256(sp.minimumBlocksBeforeLiquidation) *
            uint256(burnRateETH + PackedETH.unwrap(sp.ethNetworkFee)) *
            uint256(vUnits)
        ) / BPS_DENOMINATOR;
        minRequired = thresholdUnits * ETH_DEDUCTED_DIGITS;
        uint256 collateral = PackedETHLib.unpack(sp.minimumLiquidationCollateral);
        if (collateral > minRequired) minRequired = collateral;
    }

    function _settleSsvCluster() internal {
        if (!ssvRecord.exists || !ssvRecord.cluster.active) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint64 clusterIndex = _currentClusterIndexSsv();
        uint64 networkFeeIndex = sp.currentNetworkFeeIndexSSV();

        ISSVNetworkCore.Cluster memory cluster = ssvRecord.cluster;
        cluster.updateBalanceSSV(clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        ssvRecord.cluster = cluster;
        s.clusters[ssvClusterId] = cluster.hashClusterData();
    }

    function _fastForwardSSV(uint32 blocks_) internal {
        if (blocks_ == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 currentBlock = uint32(block.number);

        for (uint256 i; i < operatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage operator = s.operators[operatorIds[i]];
            if (operator.snapshot.block == 0) continue;

            uint64 blockDiffFee = uint64(blocks_) * PackedSSV.unwrap(operator.fee);
            operator.snapshot.index += blockDiffFee;
            operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
            operator.snapshot.block = currentBlock;
        }

        sp.networkFeeIndex += uint64(blocks_) * PackedSSV.unwrap(sp.networkFee);
        sp.networkFeeIndexBlockNumber = currentBlock;
    }

    function _operatorOwner(uint64 operatorId) internal view returns (address) {
        if (operatorId == op1) return address(opOwner1);
        if (operatorId == op2) return address(opOwner2);
        if (operatorId == op3) return address(opOwner3);
        return address(0);
    }

    function _operatorUser(address owner) internal view returns (MigrationOperatorUser) {
        if (owner == address(opOwner1)) return opOwner1;
        if (owner == address(opOwner2)) return opOwner2;
        return opOwner3;
    }

    function _singleLeafRoot(bytes32 clusterId, uint32 effectiveBalance) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(clusterId, effectiveBalance))));
    }

    function _setCommittedRoot(StorageEB storage seb, uint64 blockNum, bytes32 root) internal {
        seb.ebRoots[blockNum] = root;
        seb.latestCommittedBlock = blockNum;
    }
}
