// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVValidators.sol";
import "../../contracts/interfaces/ISSVValidators.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/ValidatorLib.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";


contract ValidatorUser {
    ISSVValidators public validators;

    constructor(ISSVValidators validators_) {
        validators = validators_;
    }

    receive() external payable {}

    function register(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        bytes calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        validators.registerValidator{value: msg.value}(publicKey, operatorIds, sharesData, cluster);
    }

    function remove(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        validators.removeValidator(publicKey, operatorIds, cluster);
    }

    function exit(bytes calldata publicKey, uint64[] calldata operatorIds) external {
        validators.exitValidator(publicKey, operatorIds);
    }
}

contract SSVValidatorsEchidna is SSVValidators {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;

    uint8 private constant MAX_VALIDATORS = 16;

    ValidatorUser private owner1;
    ValidatorUser private owner2;
    ValidatorUser private attacker;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;
    uint64 private op4;
    uint64 private op5;
    uint64 private op6;
    uint64 private op7;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        uint8 operatorsKey;
        bool exists;
    }

    struct ValidatorRecord {
        bytes publicKey;
        address owner;
        uint8 operatorsKey;
        bool active;
    }

    bytes32[] private clusterIds;
    mapping(bytes32 => ClusterRecord) private clusters;

    uint256[] private validatorIds;
    mapping(uint256 => ValidatorRecord) private validators;
    mapping(bytes32 => uint256) private validatorKeyToId;
    uint256 private nextValidatorId;

    mapping(uint64 => uint32) private expectedOperatorEthValidators;

    uint256 private totalExpectedBalance;

    bool private duplicateValidatorRegistered;
    bool private unauthorizedRemoveSucceeded;
    bool private unauthorizedExitSucceeded;

    constructor() {
        ISSVValidators self = ISSVValidators(address(this));
        owner1 = new ValidatorUser(self);
        owner2 = new ValidatorUser(self);
        attacker = new ValidatorUser(self);

        _initProtocolDefaults();
        _initOperators();
    }

    receive() external payable {}

    function action_fund(uint256 amount) external payable {
        amount;
    }

    function action_register(uint256 seed, uint8 ownerSeed, uint8 operatorsSeed) external {
        if (validatorIds.length >= MAX_VALIDATORS) return;

        address owner = (ownerSeed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = operatorsSeed % 2;
        uint64[] memory operatorIds = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIds));

        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);

        bytes memory publicKey = _makePublicKey(seed);
        bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, owner));
        bytes memory shares = _makeShares(seed);

        uint256 amount = _boundAmount(seed >> 8, _availableBalance());
        ValidatorUser ownerUser = _ownerUser(owner);

        if (validatorKeyToId[validatorKey] != 0) {
            try ownerUser.register{value: amount}(publicKey, operatorIds, shares, cluster) {
                duplicateValidatorRegistered = true;
            } catch {}
            return;
        }

        try ownerUser.register{value: amount}(publicKey, operatorIds, shares, cluster) {
            _recordRegistration(clusterId, owner, operatorsKey, cluster, publicKey, validatorKey, amount, operatorIds);
        } catch {}
    }

    function action_remove(uint256 seed) external {
        uint256 validatorId = _pickValidatorId(seed);
        if (validatorId == 0) return;

        ValidatorRecord storage record = validators[validatorId];
        if (!record.active) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(record.owner, operatorIds));
        ClusterRecord storage clusterRecord = clusters[clusterId];
        if (!clusterRecord.exists) return;

        ISSVNetworkCore.Cluster memory cluster = clusterRecord.cluster;
        ValidatorUser ownerUser = _ownerUser(record.owner);

        try ownerUser.remove(record.publicKey, operatorIds, cluster) {
            record.active = false;
            bytes32 validatorKey = keccak256(abi.encodePacked(record.publicKey, record.owner));
            if (validatorKeyToId[validatorKey] == validatorId) {
                validatorKeyToId[validatorKey] = 0;
            }
            _recordRemoval(clusterRecord, operatorIds);
            _updateExpectedOperatorCounts(operatorIds, false);
        } catch {}
    }

    function action_exit_unauthorized(uint256 seed) external {
        uint256 validatorId = _pickValidatorId(seed);
        if (validatorId == 0) return;

        ValidatorRecord storage record = validators[validatorId];
        if (!record.active) return;
        if (record.owner == address(attacker)) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        try attacker.exit(record.publicKey, operatorIds) {
            unauthorizedExitSucceeded = true;
        } catch {}
    }

    function action_remove_unauthorized(uint256 seed) external {
        uint256 validatorId = _pickValidatorId(seed);
        if (validatorId == 0) return;

        ValidatorRecord storage record = validators[validatorId];
        if (!record.active) return;
        if (record.owner == address(attacker)) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(record.owner, operatorIds));
        ClusterRecord storage clusterRecord = clusters[clusterId];
        if (!clusterRecord.exists) return;

        try attacker.remove(record.publicKey, operatorIds, clusterRecord.cluster) {
            unauthorizedRemoveSucceeded = true;
        } catch {}
    }

    function echidna_validator_hash_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        uint256 count = validatorIds.length;
        for (uint256 i; i < count; ++i) {
            ValidatorRecord storage record = validators[validatorIds[i]];
            bytes32 validatorKey = keccak256(abi.encodePacked(record.publicKey, record.owner));
            bytes32 stored = s.validatorPKs[validatorKey];
            if (record.active) {
                if (stored == bytes32(0)) return false;
                bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(_operatorIdsForKey(record.operatorsKey));
                if (!ValidatorLib.validateCorrectState(stored, hashedOperatorIds)) return false;
            } else {
                if (stored != bytes32(0)) {
                    uint256 activeId = validatorKeyToId[validatorKey];
                    if (activeId == 0) return false;
                    if (activeId == validatorIds[i]) return false;
                    ValidatorRecord storage activeRecord = validators[activeId];
                    if (!activeRecord.active) return false;
                    bytes32 activeKey = keccak256(abi.encodePacked(activeRecord.publicKey, activeRecord.owner));
                    if (activeKey != validatorKey) return false;
                    bytes32 hashedOperatorIds = ValidatorLib.hashOperatorIds(_operatorIdsForKey(activeRecord.operatorsKey));
                    if (!ValidatorLib.validateCorrectState(stored, hashedOperatorIds)) return false;
                }
            }
        }
        return true;
    }

    function echidna_cluster_hash_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[i];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists) return false;
            if (record.owner == address(0)) return false;
            if (s.ethClusters[clusterId] != record.cluster.hashClusterData()) return false;
        }
        return true;
    }

    function echidna_cluster_validator_counts() external view returns (bool) {
        uint256 clustersCount = clusterIds.length;
        for (uint256 i; i < clustersCount; ++i) {
            bytes32 clusterId = clusterIds[i];
            ClusterRecord storage clusterRecord = clusters[clusterId];
            if (!clusterRecord.exists) return false;
            uint32 count = 0;
            uint256 validatorsCount = validatorIds.length;
            for (uint256 j; j < validatorsCount; ++j) {
                ValidatorRecord storage record = validators[validatorIds[j]];
                if (!record.active) continue;
                bytes32 recordCluster = keccak256(
                    abi.encodePacked(record.owner, _operatorIdsForKey(record.operatorsKey))
                );
                if (recordCluster == clusterId) {
                    count += 1;
                }
            }
            if (clusterRecord.cluster.validatorCount != count) return false;
        }
        return true;
    }

    function echidna_operator_validator_counts() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        return s.operators[op1].ethValidatorCount == expectedOperatorEthValidators[op1] &&
            s.operators[op2].ethValidatorCount == expectedOperatorEthValidators[op2] &&
            s.operators[op3].ethValidatorCount == expectedOperatorEthValidators[op3] &&
            s.operators[op4].ethValidatorCount == expectedOperatorEthValidators[op4] &&
            s.operators[op5].ethValidatorCount == expectedOperatorEthValidators[op5] &&
            s.operators[op6].ethValidatorCount == expectedOperatorEthValidators[op6] &&
            s.operators[op7].ethValidatorCount == expectedOperatorEthValidators[op7];
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

    function echidna_no_duplicate_validators() external view returns (bool) {
        return !duplicateValidatorRegistered;
    }

    function echidna_owner_only_remove() external view returns (bool) {
        return !unauthorizedRemoveSucceeded;
    }

    function echidna_owner_only_exit() external view returns (bool) {
        return !unauthorizedExitSucceeded;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 5000;
        sp.ethNetworkFee = PACKED_ETH_ZERO;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = 0;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();
        op1 = _createOperator(s, bytes32(uint256(0x1)));
        op2 = _createOperator(s, bytes32(uint256(0x2)));
        op3 = _createOperator(s, bytes32(uint256(0x3)));
        op4 = _createOperator(s, bytes32(uint256(0x4)));
        op5 = _createOperator(s, bytes32(uint256(0x5)));
        op6 = _createOperator(s, bytes32(uint256(0x6)));
        op7 = _createOperator(s, bytes32(uint256(0x7)));
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
            ethFee: PACKED_ETH_ZERO,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _getClusterForRegistration(bytes32 clusterId) internal view returns (ISSVNetworkCore.Cluster memory cluster) {
        ClusterRecord storage record = clusters[clusterId];
        if (record.exists) {
            return record.cluster;
        }
        return ISSVNetworkCore.Cluster({
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            active: true,
            balance: 0
        });
    }

    function _recordRegistration(
        bytes32 clusterId,
        address owner,
        uint8 operatorsKey,
        ISSVNetworkCore.Cluster memory cluster,
        bytes memory publicKey,
        bytes32 validatorKey,
        uint256 amount,
        uint64[] memory operatorIds
    ) internal {
        ClusterRecord storage record = clusters[clusterId];
        bool existed = record.exists;
        uint256 previousBalance = existed ? record.cluster.balance : 0;

        cluster.balance += amount;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _clusterIndexFromStorage(operatorIds, s);
        uint64 networkFeeIndex = sp.currentNetworkFeeIndex();

        cluster.updateClusterData(clusterIndex, networkFeeIndex);
        cluster.validatorCount += 1;
        cluster.active = true;

        totalExpectedBalance = totalExpectedBalance - previousBalance + cluster.balance;
        _updateExpectedOperatorCounts(operatorIds, true);

        if (!existed) {
            record.owner = owner;
            record.operatorsKey = operatorsKey;
            record.exists = true;
            clusterIds.push(clusterId);
        }
        record.cluster = cluster;

        nextValidatorId += 1;
        validators[nextValidatorId] = ValidatorRecord({
            publicKey: publicKey,
            owner: owner,
            operatorsKey: operatorsKey,
            active: true
        });
        validatorIds.push(nextValidatorId);
        validatorKeyToId[validatorKey] = nextValidatorId;
    }

    function _recordRemoval(ClusterRecord storage record, uint64[] memory operatorIds) internal {
        if (!record.exists) return;

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        uint256 previousBalance = cluster.balance;

        if (cluster.active) {
            StorageData storage s = SSVStorage.load();
            StorageProtocol storage sp = SSVStorageProtocol.load();
            uint64 clusterIndex = _clusterIndexFromStorage(operatorIds, s);
            uint64 networkFeeIndex = sp.currentNetworkFeeIndex();
            cluster.updateClusterData(clusterIndex, networkFeeIndex);
        }

        if (cluster.validatorCount > 0) {
            cluster.validatorCount -= 1;
        }

        record.cluster = cluster;
        totalExpectedBalance = totalExpectedBalance - previousBalance + cluster.balance;
    }

    function _updateExpectedOperatorCounts(uint64[] memory operatorIds, bool increase) internal {
        uint256 len = operatorIds.length;
        for (uint256 i; i < len; ++i) {
            uint64 operatorId = operatorIds[i];
            if (increase) {
                expectedOperatorEthValidators[operatorId] += 1;
            } else if (expectedOperatorEthValidators[operatorId] > 0) {
                expectedOperatorEthValidators[operatorId] -= 1;
            }
        }
    }

    function _operatorIdsForKey(uint8 key) internal view returns (uint64[] memory) {
        if (key == 0) {
            uint64[] memory ids = new uint64[](4);
            ids[0] = op1;
            ids[1] = op2;
            ids[2] = op3;
            ids[3] = op4;
            return ids;
        }
        uint64[] memory ids = new uint64[](7);
        ids[0] = op1;
        ids[1] = op2;
        ids[2] = op3;
        ids[3] = op4;
        ids[4] = op5;
        ids[5] = op6;
        ids[6] = op7;
        return ids;
    }

    function _clusterIndexFromStorage(
        uint64[] memory operatorIds,
        StorageData storage s
    ) internal view returns (uint64) {
        uint256 len = operatorIds.length;
        uint64 clusterIndex = 0;
        for (uint256 i; i < len; ++i) {
            clusterIndex += s.operators[operatorIds[i]].ethSnapshot.index;
        }
        return clusterIndex;
    }

    function _pickValidatorId(uint256 seed) internal view returns (uint256) {
        uint256 count = validatorIds.length;
        if (count == 0) return 0;
        return validatorIds[seed % count];
    }

    function _ownerUser(address owner) internal view returns (ValidatorUser) {
        if (owner == address(owner1)) return owner1;
        if (owner == address(owner2)) return owner2;
        return attacker;
    }

    function _makePublicKey(uint256 seed) internal pure returns (bytes memory) {
        bytes32 h1 = keccak256(abi.encodePacked(seed));
        bytes32 h2 = keccak256(abi.encodePacked(seed, h1));
        bytes memory b1 = abi.encodePacked(h1);
        bytes memory b2 = abi.encodePacked(h2);
        bytes memory pk = new bytes(48);
        for (uint256 i; i < 32; ++i) {
            pk[i] = b1[i];
        }
        for (uint256 i; i < 16; ++i) {
            pk[32 + i] = b2[i];
        }
        return pk;
    }

    function _makeShares(uint256 seed) internal pure returns (bytes memory) {
        return abi.encodePacked(uint64(seed));
    }

    function _availableBalance() internal view returns (uint256) {
        if (address(this).balance <= totalExpectedBalance) return 0;
        return address(this).balance - totalExpectedBalance;
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }
}
