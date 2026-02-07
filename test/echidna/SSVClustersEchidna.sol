// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/Types.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract ClusterUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.withdraw(operatorIds, amount, cluster);
    }

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

contract SSVClustersEchidna is SSVClusters {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using Types64 for uint64;

    uint8 private constant MAX_CLUSTERS = 6;
    uint64 private constant DEFAULT_OPERATOR_FEE = 1;
    uint64 private constant DEFAULT_NETWORK_FEE = 1;
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;

    ClusterUser private owner1;
    ClusterUser private owner2;
    ClusterUser private attacker;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        uint8 operatorsKey;
        bool exists;
    }

    bytes32[] private clusterIds;
    mapping(bytes32 => ClusterRecord) private clusters;

    uint256 private totalExpectedBalance;

    bool private overWithdrawSucceeded;
    bool private withdrawPayoutMismatch;
    bool private unauthorizedWithdrawSucceeded;
    bool private liquidatePayoutMismatch;
    bool private reactivateWhileActiveSucceeded;
    bool private dustLiquidationFailed;

    constructor() {
        ISSVClusters self = ISSVClusters(address(this));
        owner1 = new ClusterUser(self);
        owner2 = new ClusterUser(self);
        attacker = new ClusterUser(self);

        _initProtocolDefaults();
        _initOperators();
    }

    receive() external payable {}

    function action_fund(uint256 amount) external payable {
        amount;
    }

    function action_create_cluster(uint256 seed) external {
        if (clusterIds.length >= MAX_CLUSTERS) return;

        address owner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = uint8((seed >> 8) % 3);
        uint64[] memory operatorIds = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIds));

        if (clusters[clusterId].exists) return;

        uint32 validatorCount = uint32((seed >> 16) % 8) + 1;
        bool active = false;
        uint256 balance = 0;

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: active,
            balance: balance
        });

        SSVStorage.load().ethClusters[clusterId] = cluster.hashClusterData();

        clusters[clusterId] = ClusterRecord({
            cluster: cluster,
            owner: owner,
            operatorsKey: operatorsKey,
            exists: true
        });
        clusterIds.push(clusterId);
        totalExpectedBalance += balance;
    }

    function action_deposit(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint256 available = _availableBalance();
        if (available == 0) return;

        uint256 amount = _boundAmount(seed >> 8, available);
        if (amount == 0) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try this.deposit{value: amount}(record.owner, operatorIds, cluster) {
            record.cluster.balance += amount;
            totalExpectedBalance += amount;
        } catch {}
    }

    function action_advance_time(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint32 blocks = uint32((seed >> 16) % MAX_ADVANCE_BLOCKS) + 1;
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        _fastForwardOperators(operatorIds, blocks);
        sp.ethNetworkFeeIndex += uint64(blocks) * sp.ethNetworkFee;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);

        uint256 burned = _settleCluster(clusterId, record, operatorIds);
        _decreaseExpected(burned);

        s.ethClusters[clusterId] = record.cluster.hashClusterData();
    }

    function action_dust_liquidation(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        uint64 burnRate = _burnRate(operatorIds);
        if (burnRate == 0) return;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 vUnits = ClusterLib.getVUnits(clusterId, record.cluster.validatorCount);

        uint128 perBlockUnits = (uint128(burnRate + sp.ethNetworkFee) * uint128(vUnits)) / VUNITS_PRECISION;
        uint256 perBlock = uint64(perBlockUnits).expand();
        if (perBlock == 0) return;

        _fastForwardOperators(operatorIds, 2);
        sp.ethNetworkFeeIndex += 2 * sp.ethNetworkFee;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);

        uint256 burned = _settleCluster(clusterId, record, operatorIds);
        _decreaseExpected(burned);

        SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();

        bool liquidatable = record.cluster.isLiquidatableWithEB(
            clusterId,
            burnRate,
            sp.ethNetworkFee,
            sp.minimumBlocksBeforeLiquidation,
            sp.minimumLiquidationCollateral
        );

        if (record.cluster.balance < perBlock && !liquidatable) {
            dustLiquidationFailed = true;
            return;
        }

        if (liquidatable) {
            try attacker.liquidate(record.owner, operatorIds, record.cluster) {} catch {
                dustLiquidationFailed = true;
            }
        }
    }

    function action_withdraw(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        if (record.cluster.balance == 0) return;
        uint256 amount = _boundAmount(seed >> 8, record.cluster.balance);
        if (amount == 0) return;

        if (amount > address(this).balance) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        ClusterUser owner = _ownerUser(record.owner);

        uint256 ownerBefore = record.owner.balance;
        uint256 contractBefore = address(this).balance;

        try owner.withdraw(operatorIds, amount, cluster) {
            uint256 burned = _settleCluster(clusterId, record, operatorIds);
            _decreaseExpected(burned);

            if (record.cluster.balance < amount) {
                withdrawPayoutMismatch = true;
                return;
            }

            record.cluster.balance -= amount;
            _decreaseExpected(amount);

            if (record.owner.balance != ownerBefore + amount) {
                withdrawPayoutMismatch = true;
            }
            if (address(this).balance != contractBefore - amount) {
                withdrawPayoutMismatch = true;
            }
        } catch {}
    }

    function action_withdraw_over(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (record.cluster.balance == type(uint256).max) return;

        uint256 amount = record.cluster.balance + 1;
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        ClusterUser owner = _ownerUser(record.owner);

        try owner.withdraw(operatorIds, amount, cluster) {
            overWithdrawSucceeded = true;
        } catch {}
    }

    function action_unauthorized_withdraw(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (record.cluster.balance == 0) return;

        uint256 amount = _boundAmount(seed >> 8, record.cluster.balance);
        if (amount == 0) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try attacker.withdraw(operatorIds, amount, cluster) {
            unauthorizedWithdrawSucceeded = true;
        } catch {}
    }

    function action_liquidate(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint256 payout = record.cluster.balance;
        if (payout > address(this).balance) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        ClusterUser owner = _ownerUser(record.owner);

        uint256 ownerBefore = record.owner.balance;
        uint256 contractBefore = address(this).balance;

        try owner.liquidate(record.owner, operatorIds, cluster) {
            uint256 burned = _settleCluster(clusterId, record, operatorIds);
            _decreaseExpected(burned);

            payout = record.cluster.balance;
            _decreaseExpected(payout);

            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;

            if (record.owner.balance != ownerBefore + payout) {
                liquidatePayoutMismatch = true;
            }
            if (address(this).balance != contractBefore - payout) {
                liquidatePayoutMismatch = true;
            }
        } catch {}
    }

    function action_reactivate(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        ClusterUser owner = _ownerUser(record.owner);

        if (record.cluster.active) {
            try owner.reactivate(operatorIds, cluster) {
                reactivateWhileActiveSucceeded = true;
            } catch {}
            return;
        }

        uint256 available = _availableBalance();
        uint256 amount = _boundAmount(seed >> 8, available);

        try owner.reactivate{value: amount}(operatorIds, cluster) {
            record.cluster.active = true;
            record.cluster.balance += amount;
            record.cluster.index = _currentClusterIndex(operatorIds);
            record.cluster.networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(SSVStorageProtocol.load());
            totalExpectedBalance += amount;
        } catch {}
    }

    function echidna_cluster_hash_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[i];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists) return false;
            if (s.ethClusters[clusterId] != record.cluster.hashClusterData()) return false;
            if (record.owner == address(0)) return false;
        }
        return true;
    }

    function echidna_inactive_clusters_zeroed() external view returns (bool) {
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = clusters[clusterIds[i]];
            if (!record.exists) return false;
            if (!record.cluster.active) {
                if (record.cluster.balance != 0) return false;
                if (record.cluster.index != 0) return false;
                if (record.cluster.networkFeeIndex != 0) return false;
            }
        }
        return true;
    }

    function echidna_cluster_balance_accounting() external view returns (bool) {
        if (address(this).balance < totalExpectedBalance) return false;
        uint256 sum = 0;
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = clusters[clusterIds[i]];
            if (!record.exists) return false;
            sum += record.cluster.balance;
        }
        return sum == totalExpectedBalance;
    }

    function echidna_withdraw_limit_enforced() external view returns (bool) {
        return !overWithdrawSucceeded;
    }

    function echidna_withdraw_conserves_balance() external view returns (bool) {
        return !withdrawPayoutMismatch;
    }

    function echidna_owner_withdraw_only() external view returns (bool) {
        return !unauthorizedWithdrawSucceeded;
    }

    function echidna_liquidation_cleans_state() external view returns (bool) {
        return !liquidatePayoutMismatch;
    }

    function echidna_reactivate_requires_inactive() external view returns (bool) {
        return !reactivateWhileActiveSucceeded;
    }

    function echidna_dust_liquidation_reachable() external view returns (bool) {
        return !dustLiquidationFailed;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.ethNetworkFee = DEFAULT_NETWORK_FEE;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = 0;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();

        op1 = _createOperator(s, address(owner1), bytes32(uint256(0x1)));
        op2 = _createOperator(s, address(owner2), bytes32(uint256(0x2)));
        op3 = _createOperator(s, address(this), bytes32(uint256(0x3)));
    }

    function _createOperator(StorageData storage s, address owner, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: 0,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_FEE,
            ethSnapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _operatorIdsForKey(uint8 key) internal view returns (uint64[] memory) {
        if (key == 0) {
            uint64[] memory ids = new uint64[](1);
            ids[0] = op1;
            return ids;
        }
        if (key == 1) {
            uint64[] memory ids = new uint64[](2);
            ids[0] = op1;
            ids[1] = op2;
            return ids;
        }
        uint64[] memory ids = new uint64[](3);
        ids[0] = op1;
        ids[1] = op2;
        ids[2] = op3;
        return ids;
    }

    function _pickClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = clusterIds.length;
        if (count == 0) return bytes32(0);
        return clusterIds[seed % count];
    }

    function _ownerUser(address owner) internal view returns (ClusterUser) {
        if (owner == address(owner1)) return owner1;
        if (owner == address(owner2)) return owner2;
        return attacker;
    }

    function _availableBalance() internal view returns (uint256) {
        if (address(this).balance <= totalExpectedBalance) return 0;
        return address(this).balance - totalExpectedBalance;
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }

    function _settleCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIds
    ) internal returns (uint256 burned) {
        uint256 beforeBalance = record.cluster.balance;
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint64 clusterIndex = _currentClusterIndex(operatorIds);
        uint64 networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(SSVStorageProtocol.load());

        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;

        if (beforeBalance > cluster.balance) {
            burned = beforeBalance - cluster.balance;
        }
    }

    function _currentClusterIndex(uint64[] memory operatorIds) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 currentBlock = uint64(block.number);
        uint64 clusterIndex = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            ISSVNetworkCore.Operator storage operator = s.operators[operatorIds[i]];
            uint64 blockDiff = currentBlock - uint64(operator.ethSnapshot.block);
            clusterIndex += operator.ethSnapshot.index + blockDiff * operator.ethFee;
        }
        return clusterIndex;
    }

    function _fastForwardOperators(uint64[] memory operatorIds, uint32 blocks) internal {
        StorageData storage s = SSVStorage.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);

        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
            if (operator.ethSnapshot.block == 0) continue;

            uint64 blockDiffFee = uint64(blocks) * operator.ethFee;
            // Deviation-only model: effectiveVUnits = baseline + storedDeviation
            uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
            uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

            operator.ethSnapshot.index += blockDiffFee;
            if (effectiveVUnits != 0 && blockDiffFee != 0) {
                uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                operator.ethSnapshot.balance += uint64(delta);
            }
            operator.ethSnapshot.block = currentBlock;
        }
    }

    function _burnRate(uint64[] memory operatorIds) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 burnRate = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            burnRate += s.operators[operatorIds[i]].ethFee;
        }
        return burnRate;
    }

    function _decreaseExpected(uint256 amount) internal {
        if (amount == 0) return;
        if (totalExpectedBalance >= amount) {
            totalExpectedBalance -= amount;
        } else {
            totalExpectedBalance = 0;
        }
    }
}
