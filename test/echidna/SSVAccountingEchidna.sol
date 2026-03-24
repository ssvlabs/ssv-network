// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/interfaces/ISSVValidators.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVValidators.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "./SSVStakingEchidna.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETHLib, PackedSSVLib} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVCoreTypes.sol";

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

    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.liquidateSSV(clusterOwner, operatorIds, cluster);
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        clusters.reactivate{value: msg.value}(operatorIds, cluster);
    }

    function migrate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        clusters.migrateClusterToETH{value: msg.value}(operatorIds, cluster);
    }
}

contract OperatorUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    receive() external payable {}

    function withdraw(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawAll(uint64 operatorId) external {
        operators.withdrawAllOperatorEarnings(operatorId);
    }

    function withdrawSSV(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarningsSSV(operatorId, amount);
    }

    function withdrawAllSSV(uint64 operatorId) external {
        operators.withdrawAllOperatorEarningsSSV(operatorId);
    }
}

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

contract SSVAccountingEchidna is SSVClusters, SSVOperators(0), SSVDAO, SSVValidators {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    uint8 private constant MAX_ETH_CLUSTERS = 6;
    uint8 private constant MAX_SSV_CLUSTERS = 6;
    uint8 private constant MAX_LIFECYCLE_VALIDATORS = 24;
    uint8 private constant LIFECYCLE_OPERATORS_KEY = 2;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    PackedETH private constant DEFAULT_OPERATOR_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_OPERATOR_SSV_FEE = PackedSSV.wrap(1);
    PackedETH private constant DEFAULT_NETWORK_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_NETWORK_SSV_FEE = PackedSSV.wrap(1);
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint64 private constant MAX_SSV_MINT_UNITS = 1_000_000;

    MockToken private token;

    ClusterUser private owner1;
    ClusterUser private owner2;
    ClusterUser private liquidator;

    OperatorUser private opOwner1;
    OperatorUser private opOwner2;
    OperatorUser private opOwner3;
    ValidatorUser private validatorOwner;
    ValidatorUser private validatorAttacker;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        uint8 operatorsKey;
        bool exists;
    }

    bytes32[] private ethClusterIds;
    bytes32[] private ssvClusterIds;
    mapping(bytes32 => ClusterRecord) private ethClusters;
    mapping(bytes32 => ClusterRecord) private ssvClusters;

    uint64[] private operatorIds;
    mapping(uint64 => address) private operatorOwner;

    uint256 private totalEthIn;
    uint256 private totalEthOut;
    uint256 private totalSsvIn;
    uint256 private totalSsvOut;
    uint256 private unallocatedEth;
    uint256 private unallocatedSsv;

    bytes32[] private migratedClusterIds;
    mapping(bytes32 => bool) private migratedSet;
    bool private ssvAccrualCorrupted;
    bytes32 private lifecycleClusterId;
    bool private lifecycleClusterInitialized;
    bool private lifecycleStateViolation;
    bool private lifecycleUnauthorizedSucceeded;

    struct LifecycleValidatorRecord {
        bytes publicKey;
        bool active;
    }

    uint256[] private lifecycleValidatorIds;
    mapping(uint256 => LifecycleValidatorRecord) private lifecycleValidators;
    mapping(bytes32 => uint256) private lifecycleValidatorKeyToId;
    uint256 private nextLifecycleValidatorId;

    constructor() SSVDAO(address(new CSSVTokenMock(address(this)))) {
        token = new MockToken();
        _mockSetToken(address(token));

        ISSVClusters clustersSelf = ISSVClusters(address(this));
        ISSVOperators operatorsSelf = ISSVOperators(address(this));
        ISSVValidators validatorsSelf = ISSVValidators(address(this));

        owner1 = new ClusterUser(clustersSelf);
        owner2 = new ClusterUser(clustersSelf);
        liquidator = new ClusterUser(clustersSelf);

        opOwner1 = new OperatorUser(operatorsSelf);
        opOwner2 = new OperatorUser(operatorsSelf);
        opOwner3 = new OperatorUser(operatorsSelf);
        validatorOwner = new ValidatorUser(validatorsSelf);
        validatorAttacker = new ValidatorUser(validatorsSelf);

        _initProtocolDefaults();
        _initOperators();
    }

    receive() external payable {}

    function action_fund_eth(uint256 amount) external payable {
        amount;
        if (msg.value == 0) return;
        totalEthIn += msg.value;
        unallocatedEth += msg.value;
    }

    function action_fund_ssv(uint256 seed) external {
        uint64 units = uint64(seed % (uint256(MAX_SSV_MINT_UNITS) + 1));
        if (units == 0) return;
        uint256 amount = uint256(units) * DEDUCTED_DIGITS;
        token.mint(address(this), amount);
        totalSsvIn += amount;
        unallocatedSsv += amount;
    }

    function action_create_eth_cluster(uint256 seed) external {
        _settleTime();
        if (ethClusterIds.length >= MAX_ETH_CLUSTERS) return;

        address owner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = uint8((seed >> 8) % 3);
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIdsLocal));

        if (ethClusters[clusterId].exists || ssvClusters[clusterId].exists || migratedSet[clusterId]) return;

        uint32 validatorCount = uint32((seed >> 16) % 6) + 1;

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        SSVStorage.load().ethClusters[clusterId] = cluster.hashClusterData();

        ethClusters[clusterId] = ClusterRecord({
            cluster: cluster,
            owner: owner,
            operatorsKey: operatorsKey,
            exists: true
        });
        ethClusterIds.push(clusterId);
    }

    function action_create_ssv_cluster(uint256 seed) external {
        _settleTime();
        if (ssvClusterIds.length >= MAX_SSV_CLUSTERS) return;

        address owner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = uint8((seed >> 8) % 3);
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIdsLocal));

        if (ssvClusters[clusterId].exists || ethClusters[clusterId].exists || migratedSet[clusterId]) return;

        uint32 validatorCount = uint32((seed >> 16) % 6) + 1;

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        SSVStorage.load().clusters[clusterId] = cluster.hashClusterData();

        ssvClusters[clusterId] = ClusterRecord({
            cluster: cluster,
            owner: owner,
            operatorsKey: operatorsKey,
            exists: true
        });
        ssvClusterIds.push(clusterId);
    }

    function action_register_validator_lifecycle(uint256 seed) external {
        _settleTime();

        if (lifecycleValidatorIds.length >= MAX_LIFECYCLE_VALIDATORS) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(LIFECYCLE_OPERATORS_KEY);
        bytes32 clusterId = _lifecycleClusterHash(operatorIdsLocal);
        ClusterRecord storage record = ethClusters[clusterId];

        ISSVNetworkCore.Cluster memory cluster = record.exists
            ? record.cluster
            : ISSVNetworkCore.Cluster({
                validatorCount: 0,
                networkFeeIndex: 0,
                index: 0,
                active: true,
                balance: 0
            });

        bytes memory publicKey = _makePublicKey(seed);
        bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, address(validatorOwner)));
        bytes memory shares = _makeShares(seed);
        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);

        if (lifecycleValidatorKeyToId[validatorKey] != 0) {
            try validatorOwner.register{value: amount}(publicKey, operatorIdsLocal, shares, cluster) {
                lifecycleStateViolation = true;
            } catch {}
            return;
        }

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 daoBefore = sp.ethDaoValidatorCount;
        uint32 op1Before = s.operators[op1].ethValidatorCount;
        uint32 op2Before = s.operators[op2].ethValidatorCount;
        uint32 op3Before = s.operators[op3].ethValidatorCount;

        try validatorOwner.register{value: amount}(publicKey, operatorIdsLocal, shares, cluster) {
            ISSVNetworkCore.Cluster memory nextCluster = cluster;
            nextCluster.balance += amount;
            uint64 clusterIndex = _currentClusterIndexEth(operatorIdsLocal);
            uint64 networkFeeIndex = sp.currentNetworkFeeIndex();
            nextCluster.updateClusterData(clusterId, clusterIndex, networkFeeIndex);
            nextCluster.validatorCount += 1;
            nextCluster.active = true;

            record.cluster = nextCluster;
            record.owner = address(validatorOwner);
            record.operatorsKey = LIFECYCLE_OPERATORS_KEY;
            record.exists = true;

            lifecycleClusterInitialized = true;
            lifecycleClusterId = clusterId;

            if (amount != 0) {
                unallocatedEth -= amount;
            }

            nextLifecycleValidatorId += 1;
            lifecycleValidators[nextLifecycleValidatorId] = LifecycleValidatorRecord({
                publicKey: publicKey,
                active: true
            });
            lifecycleValidatorIds.push(nextLifecycleValidatorId);
            lifecycleValidatorKeyToId[validatorKey] = nextLifecycleValidatorId;

            if (sp.ethDaoValidatorCount != daoBefore + 1) {
                lifecycleStateViolation = true;
            }
            if (
                s.operators[op1].ethValidatorCount != op1Before + 1 ||
                s.operators[op2].ethValidatorCount != op2Before + 1 ||
                s.operators[op3].ethValidatorCount != op3Before + 1
            ) {
                lifecycleStateViolation = true;
            }
        } catch {}
    }

    function action_remove_validator_lifecycle(uint256 seed) external {
        _settleTime();

        uint256 validatorId = _pickActiveLifecycleValidatorId(seed);
        if (validatorId == 0 || !lifecycleClusterInitialized) return;

        ClusterRecord storage record = ethClusters[lifecycleClusterId];
        if (!record.exists) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(LIFECYCLE_OPERATORS_KEY);
        bytes memory publicKey = lifecycleValidators[validatorId].publicKey;
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 daoBefore = sp.ethDaoValidatorCount;
        uint32 op1Before = s.operators[op1].ethValidatorCount;
        uint32 op2Before = s.operators[op2].ethValidatorCount;
        uint32 op3Before = s.operators[op3].ethValidatorCount;

        try validatorOwner.remove(publicKey, operatorIdsLocal, cluster) {
            ISSVNetworkCore.Cluster memory nextCluster = cluster;
            if (nextCluster.active) {
                uint64 clusterIndex = _currentClusterIndexEth(operatorIdsLocal);
                uint64 networkFeeIndex = sp.currentNetworkFeeIndex();
                nextCluster.updateClusterData(lifecycleClusterId, clusterIndex, networkFeeIndex);
            }
            if (nextCluster.validatorCount == 0) {
                lifecycleStateViolation = true;
                return;
            }
            nextCluster.validatorCount -= 1;
            record.cluster = nextCluster;

            lifecycleValidators[validatorId].active = false;
            bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, address(validatorOwner)));
            if (lifecycleValidatorKeyToId[validatorKey] == validatorId) {
                lifecycleValidatorKeyToId[validatorKey] = 0;
            }

            if (daoBefore == 0 || sp.ethDaoValidatorCount != daoBefore - 1) {
                lifecycleStateViolation = true;
            }
            if (
                op1Before == 0 ||
                op2Before == 0 ||
                op3Before == 0 ||
                s.operators[op1].ethValidatorCount != op1Before - 1 ||
                s.operators[op2].ethValidatorCount != op2Before - 1 ||
                s.operators[op3].ethValidatorCount != op3Before - 1
            ) {
                lifecycleStateViolation = true;
            }
        } catch {}
    }

    function action_exit_validator_lifecycle(uint256 seed) external {
        _settleTime();

        uint256 validatorId = _pickActiveLifecycleValidatorId(seed);
        if (validatorId == 0) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(LIFECYCLE_OPERATORS_KEY);
        bytes memory publicKey = lifecycleValidators[validatorId].publicKey;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 daoBefore = sp.ethDaoValidatorCount;
        uint32 op1Before = s.operators[op1].ethValidatorCount;
        uint32 op2Before = s.operators[op2].ethValidatorCount;
        uint32 op3Before = s.operators[op3].ethValidatorCount;

        try validatorOwner.exit(publicKey, operatorIdsLocal) {
            if (sp.ethDaoValidatorCount != daoBefore) {
                lifecycleStateViolation = true;
            }
            if (
                s.operators[op1].ethValidatorCount != op1Before ||
                s.operators[op2].ethValidatorCount != op2Before ||
                s.operators[op3].ethValidatorCount != op3Before
            ) {
                lifecycleStateViolation = true;
            }
        } catch {}
    }

    function action_remove_validator_unauthorized(uint256 seed) external {
        _settleTime();

        uint256 validatorId = _pickActiveLifecycleValidatorId(seed);
        if (validatorId == 0 || !lifecycleClusterInitialized) return;

        ClusterRecord storage record = ethClusters[lifecycleClusterId];
        if (!record.exists) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(LIFECYCLE_OPERATORS_KEY);
        bytes memory publicKey = lifecycleValidators[validatorId].publicKey;
        try validatorAttacker.remove(publicKey, operatorIdsLocal, record.cluster) {
            lifecycleUnauthorizedSucceeded = true;
        } catch {}
    }

    function action_exit_validator_unauthorized(uint256 seed) external {
        _settleTime();

        uint256 validatorId = _pickActiveLifecycleValidatorId(seed);
        if (validatorId == 0) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(LIFECYCLE_OPERATORS_KEY);
        bytes memory publicKey = lifecycleValidators[validatorId].publicKey;
        try validatorAttacker.exit(publicKey, operatorIdsLocal) {
            lifecycleUnauthorizedSucceeded = true;
        } catch {}
    }

    function action_reactivate_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || record.cluster.active) return;

        if (unallocatedEth == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);

        PackedETH burnRate;
        for (uint256 i; i < operatorIdsLocal.length; ++i) {
            burnRate = burnRate.add(s.operators[operatorIdsLocal[i]].ethFee);
        }
        uint256 minPerBlock = uint256(PackedETH.unwrap(burnRate) + PackedETH.unwrap(sp.ethNetworkFee)) * uint64(record.cluster.validatorCount) * ETH_DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * (MAX_ADVANCE_BLOCKS + 2);
        if (minRequired == 0) minRequired = ETH_DEDUCTED_DIGITS;

        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);
        if (amount < minRequired) amount = minRequired;
        if (amount > unallocatedEth) return;

        ClusterUser owner = _clusterOwnerUser(record.owner);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try owner.reactivate{value: amount}(operatorIdsLocal, cluster) {
            record.cluster.active = true;
            record.cluster.balance += amount;
            record.cluster.index = _currentClusterIndexEth(operatorIdsLocal);
            record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
            unallocatedEth -= amount;

            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_activate_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || record.cluster.active) return;

        if (unallocatedSsv == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);

        PackedSSV burnRate;
        for (uint256 i; i < operatorIdsLocal.length; ++i) {
            burnRate = burnRate.add(s.operators[operatorIdsLocal[i]].fee);
        }
        uint256 minPerBlock = uint256(PackedSSV.unwrap(burnRate) + PackedSSV.unwrap(sp.networkFee)) * uint64(record.cluster.validatorCount) * DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * (MAX_ADVANCE_BLOCKS + 2);
        if (minRequired == 0) minRequired = DEDUCTED_DIGITS;

        uint256 amount = _boundAmount(seed >> 8, unallocatedSsv);
        if (amount < minRequired) amount = minRequired;
        if (amount > unallocatedSsv) return;
        if (token.balanceOf(address(this)) < amount) return;

        (uint64 clusterIndex, ) = OperatorLib.updateClusterOperatorsSSV(
            operatorIdsLocal,
            true,
            record.cluster.validatorCount,
            s,
            sp
        );

        record.cluster.balance += amount;
        record.cluster.active = true;
        record.cluster.index = clusterIndex;
        record.cluster.networkFeeIndex = sp.currentNetworkFeeIndexSSV();

        sp.updateDAOSSV(true, record.cluster.validatorCount);

        s.clusters[clusterId] = record.cluster.hashClusterData();
        unallocatedSsv -= amount;
    }

    function action_deposit_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        if (unallocatedEth == 0) return;
        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);
        if (amount == 0) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try this.deposit{value: amount}(record.owner, operatorIdsLocal, cluster) {
            record.cluster.balance += amount;
            unallocatedEth -= amount;
        } catch {}
    }

    function action_deposit_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        if (unallocatedSsv == 0) return;
        uint256 amount = _boundAmount(seed >> 8, unallocatedSsv);
        if (amount == 0) return;
        if (token.balanceOf(address(this)) < amount) return;

        record.cluster.balance += amount;
        SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        unallocatedSsv -= amount;
    }

    function action_withdraw_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (record.cluster.balance == 0) return;

        uint256 amount = _boundAmount(seed >> 8, record.cluster.balance);
        if (amount == 0) return;
        if (amount > address(this).balance) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ClusterUser owner = _clusterOwnerUser(record.owner);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 ownerBefore = record.owner.balance;
        try owner.withdraw(operatorIdsLocal, amount, cluster) {
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            if (record.cluster.balance >= amount) {
                record.cluster.balance -= amount;
            } else {
                record.cluster.balance = 0;
            }
            totalEthOut += record.owner.balance - ownerBefore;

            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_liquidate_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 liquidatorBefore = address(liquidator).balance;
        try liquidator.liquidate(record.owner, operatorIdsLocal, cluster) {
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;
            totalEthOut += address(liquidator).balance - liquidatorBefore;
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_liquidate_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 liquidatorBefore = token.balanceOf(address(liquidator));
        try liquidator.liquidateSSV(record.owner, operatorIdsLocal, cluster) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            _settleSsvCluster(clusterId, record, operatorIdsLocal);
            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;

            totalSsvOut += token.balanceOf(address(liquidator)) - liquidatorBefore;
            SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_withdraw_operator_eth(uint256 seed) external {
        _settleTime();
        uint64 operatorId = _pickOperatorId(seed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        PackedETH balance = operator.ethSnapshot.balance;
        if (balance.eq(PACKED_ETH_ZERO)) return;

        PackedETH withdrawShrunk = PackedETH.wrap(uint64(seed % PackedETH.unwrap(balance)) + 1);
        uint256 amount = PackedETHLib.unpack(withdrawShrunk);
        if (amount > address(this).balance) return;

        uint256 ownerBefore = ownerAddr.balance;
        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdraw(operatorId, amount) {
            totalEthOut += ownerAddr.balance - ownerBefore;
        } catch {}
    }

    function action_withdraw_operator_ssv(uint256 seed) external {
        _settleTime();
        uint64 operatorId = _pickOperatorId(seed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        PackedSSV balance = operator.snapshot.balance;
        if (balance.eq(PACKED_SSV_ZERO)) return;

        PackedSSV withdrawShrunk = PackedSSV.wrap(uint64(seed % PackedSSV.unwrap(balance)) + 1);
        uint256 amount = PackedSSVLib.unpack(withdrawShrunk);
        if (amount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawSSV(operatorId, amount) {
            totalSsvOut += token.balanceOf(ownerAddr) - ownerBefore;
        } catch {}
    }

    function action_withdraw_dao_ssv(uint256 seed) external {
        _settleTime();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        PackedSSV available = sp.daoBalance;
        if (available.eq(PACKED_SSV_ZERO)) return;
        PackedSSV withdrawUnits = PackedSSV.wrap(uint64(seed % (PackedSSV.unwrap(available) + 1)));
        if (withdrawUnits.eq(PACKED_SSV_ZERO)) return;

        uint256 amount = PackedSSVLib.unpack(withdrawUnits);
        if (amount > token.balanceOf(address(this))) return;

        uint256 before = token.balanceOf(address(this));
        try this.withdrawNetworkSSVEarnings(amount) {
            totalSsvOut += before - token.balanceOf(address(this));
        } catch {}
    }

    function action_update_network_fee(uint256 seed) external {
        _settleTime();
        uint64 units = uint64(seed % 10);
        uint256 fee = uint256(units) * ETH_DEDUCTED_DIGITS;
        try this.updateNetworkFee(fee) {} catch {}
    }

    function action_update_network_fee_ssv(uint256 seed) external {
        _settleTime();
        uint64 units = uint64(seed % 10);
        uint256 fee = uint256(units) * DEDUCTED_DIGITS;
        try this.updateNetworkFeeSSV(fee) {} catch {}
    }

    function action_advance_time(uint256 seed) external {
        _settleTime();
        uint32 blocks = uint32(seed % MAX_ADVANCE_BLOCKS) + 1;
        _fastForward(blocks);
        _syncClusters();
    }

    function echidna_eth_conservation() external view returns (bool) {
        return address(this).balance + totalEthOut >= totalEthIn;
    }

    function echidna_ssv_conservation() external view returns (bool) {
        return token.balanceOf(address(this)) <= totalSsvIn;
    }

    function echidna_eth_solvency() external view returns (bool) {
        return address(this).balance >= totalEthIn - totalEthOut;
    }

    function action_migrate_ssv_cluster(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (unallocatedEth == 0) return;

        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);
        if (amount == 0) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ClusterUser clusterOwner = _clusterOwnerUser(record.owner);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint256 ownerSsvBefore = token.balanceOf(record.owner);
        try clusterOwner.migrate{value: amount}(operatorIdsLocal, cluster) {
            ISSVNetworkCore.Cluster memory migratedCluster = cluster;
            migratedCluster.balance = amount;
            migratedCluster.active = true;
            migratedCluster.index = _currentClusterIndexEth(operatorIdsLocal);
            migratedCluster.networkFeeIndex = sp.currentNetworkFeeIndex();

            ClusterRecord storage ethRecord = ethClusters[clusterId];
            if (!ethRecord.exists) {
                ethClusterIds.push(clusterId);
            }
            ethRecord.cluster = migratedCluster;
            ethRecord.owner = record.owner;
            ethRecord.operatorsKey = record.operatorsKey;
            ethRecord.exists = true;

            if (!migratedSet[clusterId]) {
                migratedSet[clusterId] = true;
                migratedClusterIds.push(clusterId);
            }
            record.exists = false;
            unallocatedEth -= amount;
            totalSsvOut += token.balanceOf(record.owner) - ownerSsvBefore;
        } catch {}
    }

    function action_probe_max_ssv_accrual(uint256 seed) external {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        ISSVNetworkCore.Operator storage operator = s.operators[op1];
        if (operator.snapshot.block == 0) return;

        uint64 testFee = uint64(sp.operatorMaxFeeSSV);
        uint32 testValidators = sp.validatorsPerOperatorLimit;

        operator.fee = PackedSSV.wrap(testFee);
        operator.validatorCount = testValidators;

        PackedSSV balanceBefore = operator.snapshot.balance;
        uint32 blocks = uint32(seed % 8) + 1;
        uint32 currentBlock = uint32(block.number);

        uint64 blockDiffFee = uint64(blocks) * testFee;
        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * uint64(testValidators)));
        operator.snapshot.block = currentBlock;

        if (operator.snapshot.balance.lt(balanceBefore)) {
            ssvAccrualCorrupted = true;
        }
    }

    function echidna_operator_vunits_matches_clusters() external view returns (bool) {
        StorageEB storage seb = SSVStorageEB.load();

        for (uint256 i; i < operatorIds.length; ++i) {
            uint64 opId = operatorIds[i];
            uint64 opDeviation = seb.operatorEthVUnits[opId];

            uint64 expectedDeviation;
            for (uint256 j; j < ethClusterIds.length; ++j) {
                bytes32 cId = ethClusterIds[j];
                ClusterRecord storage record = ethClusters[cId];
                if (!record.exists || !record.cluster.active) continue;

                uint64[] memory ops = _operatorIdsForKey(record.operatorsKey);
                bool hasOp = false;
                for (uint256 k; k < ops.length; ++k) {
                    if (ops[k] == opId) { hasOp = true; break; }
                }
                if (!hasOp) continue;

                uint64 clusterVUnits = seb.clusterEB[cId].vUnits;
                if (clusterVUnits > 0) {
                    uint64 baseline = uint64(record.cluster.validatorCount) * BPS_DENOMINATOR;
                    if (clusterVUnits > baseline) {
                        expectedDeviation += clusterVUnits - baseline;
                    }
                }
            }

            if (opDeviation != expectedDeviation) return false;
        }
        return true;
    }

    function echidna_dao_validator_count_consistent() external view returns (bool) {
        return uint256(SSVStorageProtocol.load().ethDaoValidatorCount) == uint256(_expectedEthDaoValidatorCount());
    }

    function echidna_cluster_version_exclusive() external view returns (bool) {
        StorageData storage s = SSVStorage.load();

        for (uint256 i; i < ethClusterIds.length; ++i) {
            bytes32 clusterId = ethClusterIds[i];
            ClusterRecord storage record = ethClusters[clusterId];
            if (!record.exists) continue;
            if (s.ethClusters[clusterId] == 0) return false;
            if (s.clusters[clusterId] != 0) return false;
        }

        for (uint256 i; i < ssvClusterIds.length; ++i) {
            bytes32 clusterId = ssvClusterIds[i];
            ClusterRecord storage record = ssvClusters[clusterId];
            if (!record.exists) continue;
            if (s.clusters[clusterId] == 0) return false;
            if (s.ethClusters[clusterId] != 0) return false;
        }

        for (uint256 i; i < migratedClusterIds.length; ++i) {
            bytes32 clusterId = migratedClusterIds[i];
            if (s.ethClusters[clusterId] == 0) return false;
            if (s.clusters[clusterId] != 0) return false;
        }

        return true;
    }

    function echidna_operator_total_validators_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();

        for (uint256 i; i < operatorIds.length; ++i) {
            uint64 operatorId = operatorIds[i];
            (uint32 expectedSsv, uint32 expectedEth) = _expectedOperatorCounts(operatorId);

            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
            if (operator.validatorCount != expectedSsv) return false;
            if (operator.ethValidatorCount != expectedEth) return false;
            if (
                uint256(operator.validatorCount) + uint256(operator.ethValidatorCount) !=
                uint256(expectedSsv) + uint256(expectedEth)
            ) return false;
        }

        return true;
    }

    function echidna_validator_lifecycle_consistent() external view returns (bool) {
        return !lifecycleStateViolation && !lifecycleUnauthorizedSucceeded;
    }

    function echidna_migration_one_way() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        for (uint256 i; i < migratedClusterIds.length; ++i) {
            bytes32 cId = migratedClusterIds[i];
            if (s.clusters[cId] != 0) return false;
            if (s.ethClusters[cId] == 0) return false;
        }
        return true;
    }

    function echidna_ssv_accrual_no_overflow() external view returns (bool) {
        return !ssvAccrualCorrupted;
    }

    function echidna_vunits_deviation_consistent() external view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        uint256 expected;
        uint256 count = ethClusterIds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = ethClusterIds[i];
            ClusterRecord storage record = ethClusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;

            uint64 vUnits = seb.clusterEB[clusterId].vUnits;
            if (vUnits == 0) {
                vUnits = uint64(record.cluster.validatorCount) * BPS_DENOMINATOR;
            }

            expected += vUnits;
        }

        if (lifecycleClusterInitialized && !_isTrackedEthCluster(lifecycleClusterId)) {
            ClusterRecord storage lifecycleRecord = ethClusters[lifecycleClusterId];
            if (lifecycleRecord.exists && lifecycleRecord.cluster.active) {
                uint64 vUnits = seb.clusterEB[lifecycleClusterId].vUnits;
                if (vUnits == 0) {
                    vUnits = uint64(lifecycleRecord.cluster.validatorCount) * BPS_DENOMINATOR;
                }
                expected += vUnits;
            }
        }

        // Migrated clusters are no longer in ethClusterIds but their validators
        // are counted in daoTotalEthVUnits after migrateClusterToETH calls updateDAO.
        uint256 migratedCount = migratedClusterIds.length;
        for (uint256 i; i < migratedCount; ++i) {
            bytes32 cId = migratedClusterIds[i];
            if (_isTrackedEthCluster(cId)) continue;

            uint64 vUnits = seb.clusterEB[cId].vUnits;
            if (vUnits == 0) {
                ClusterRecord storage record = ethClusters[cId];
                if (record.exists) {
                    vUnits = uint64(record.cluster.validatorCount) * BPS_DENOMINATOR;
                } else {
                    vUnits = uint64(ssvClusters[cId].cluster.validatorCount) * BPS_DENOMINATOR;
                }
            }
            expected += vUnits;
        }

        return uint256(sp.daoTotalEthVUnits) == expected;
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

        op1 = _createOperator(s, address(opOwner1), bytes32(uint256(0x1)));
        op2 = _createOperator(s, address(opOwner2), bytes32(uint256(0x2)));
        op3 = _createOperator(s, address(opOwner3), bytes32(uint256(0x3)));

        operatorIds.push(op1);
        operatorIds.push(op2);
        operatorIds.push(op3);

        operatorOwner[op1] = address(opOwner1);
        operatorOwner[op2] = address(opOwner2);
        operatorOwner[op3] = address(opOwner3);
    }

    function _createOperator(StorageData storage s, address owner, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: DEFAULT_OPERATOR_SSV_FEE,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _pickOperatorId(uint256 seed) internal view returns (uint64) {
        uint256 count = operatorIds.length;
        if (count == 0) return 0;
        return operatorIds[seed % count];
    }

    function _operatorIdsForKey(uint8 key) internal view returns (uint64[] memory) {
        uint64[] memory ids;
        if (key == 0) {
            ids = new uint64[](1);
            ids[0] = op1;
            return ids;
        }
        if (key == 1) {
            ids = new uint64[](2);
            ids[0] = op1;
            ids[1] = op2;
            return ids;
        }
        ids = new uint64[](3);
        ids[0] = op1;
        ids[1] = op2;
        ids[2] = op3;
        return ids;
    }

    function _clusterContainsOperator(uint8 operatorsKey, uint64 operatorId) internal view returns (bool) {
        uint64[] memory ids = _operatorIdsForKey(operatorsKey);
        for (uint256 i; i < ids.length; ++i) {
            if (ids[i] == operatorId) return true;
        }
        return false;
    }

    function _isTrackedEthCluster(bytes32 clusterId) internal view returns (bool) {
        uint256 count = ethClusterIds.length;
        for (uint256 i; i < count; ++i) {
            if (ethClusterIds[i] == clusterId) return true;
        }
        return false;
    }

    function _expectedEthDaoValidatorCount() internal view returns (uint32 expected) {
        for (uint256 i; i < ethClusterIds.length; ++i) {
            ClusterRecord storage record = ethClusters[ethClusterIds[i]];
            if (!record.exists || !record.cluster.active) continue;
            expected += record.cluster.validatorCount;
        }

        if (lifecycleClusterInitialized && !_isTrackedEthCluster(lifecycleClusterId)) {
            ClusterRecord storage lifecycleRecord = ethClusters[lifecycleClusterId];
            if (lifecycleRecord.exists && lifecycleRecord.cluster.active) {
                expected += lifecycleRecord.cluster.validatorCount;
            }
        }

        for (uint256 i; i < migratedClusterIds.length; ++i) {
            bytes32 clusterId = migratedClusterIds[i];
            if (_isTrackedEthCluster(clusterId)) continue;
            ClusterRecord storage record = ethClusters[clusterId];
            if (record.exists) {
                if (record.cluster.active) {
                    expected += record.cluster.validatorCount;
                }
                continue;
            }
            expected += ssvClusters[clusterId].cluster.validatorCount;
        }
    }

    function _expectedOperatorCounts(uint64 operatorId) internal view returns (uint32 expectedSsv, uint32 expectedEth) {
        for (uint256 i; i < ssvClusterIds.length; ++i) {
            ClusterRecord storage record = ssvClusters[ssvClusterIds[i]];
            if (!record.exists || !record.cluster.active) continue;
            if (!_clusterContainsOperator(record.operatorsKey, operatorId)) continue;
            expectedSsv += record.cluster.validatorCount;
        }

        for (uint256 i; i < ethClusterIds.length; ++i) {
            ClusterRecord storage record = ethClusters[ethClusterIds[i]];
            if (!record.exists || !record.cluster.active) continue;
            if (!_clusterContainsOperator(record.operatorsKey, operatorId)) continue;
            expectedEth += record.cluster.validatorCount;
        }

        if (lifecycleClusterInitialized && !_isTrackedEthCluster(lifecycleClusterId)) {
            ClusterRecord storage lifecycleRecord = ethClusters[lifecycleClusterId];
            if (
                lifecycleRecord.exists &&
                lifecycleRecord.cluster.active &&
                _clusterContainsOperator(lifecycleRecord.operatorsKey, operatorId)
            ) {
                expectedEth += lifecycleRecord.cluster.validatorCount;
            }
        }

        for (uint256 i; i < migratedClusterIds.length; ++i) {
            bytes32 clusterId = migratedClusterIds[i];
            if (_isTrackedEthCluster(clusterId)) continue;
            ClusterRecord storage ethRecord = ethClusters[clusterId];
            if (ethRecord.exists) {
                if (!_clusterContainsOperator(ethRecord.operatorsKey, operatorId)) continue;
                expectedEth += ethRecord.cluster.validatorCount;
                continue;
            }
            ClusterRecord storage ssvRecord = ssvClusters[clusterId];
            if (!_clusterContainsOperator(ssvRecord.operatorsKey, operatorId)) continue;
            expectedEth += ssvRecord.cluster.validatorCount;
        }
    }

    function _pickEthClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = ethClusterIds.length;
        if (count == 0) return bytes32(0);
        return ethClusterIds[seed % count];
    }

    function _pickSsvClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = ssvClusterIds.length;
        if (count == 0) return bytes32(0);
        return ssvClusterIds[seed % count];
    }

    function _clusterOwnerUser(address owner) internal view returns (ClusterUser) {
        if (owner == address(owner1)) return owner1;
        if (owner == address(owner2)) return owner2;
        return liquidator;
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }

    function _lifecycleClusterHash(uint64[] memory operatorIdsLocal) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(address(validatorOwner), operatorIdsLocal));
    }

    function _pickActiveLifecycleValidatorId(uint256 seed) internal view returns (uint256) {
        uint256 count = lifecycleValidatorIds.length;
        if (count == 0) return 0;
        uint256 start = seed % count;
        for (uint256 i; i < count; ++i) {
            uint256 id = lifecycleValidatorIds[(start + i) % count];
            if (lifecycleValidators[id].active) return id;
        }
        return 0;
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

    function _currentClusterIndexEth(uint64[] memory operatorIdsLocal) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;
        uint256 count = operatorIdsLocal.length;
        for (uint256 i; i < count; ++i) {
            clusterIndex += s.operators[operatorIdsLocal[i]].ethSnapshot.index;
        }
        return clusterIndex;
    }

    function _currentClusterIndexSsv(uint64[] memory operatorIdsLocal) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;
        uint256 count = operatorIdsLocal.length;
        for (uint256 i; i < count; ++i) {
            clusterIndex += s.operators[operatorIdsLocal[i]].snapshot.index;
        }
        return clusterIndex;
    }

    function _settleEthCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIdsLocal
    ) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _currentClusterIndexEth(operatorIdsLocal);
        uint64 networkFeeIndex = sp.ethNetworkFeeIndex;

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;
    }

    function _settleSsvCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIdsLocal
    ) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _currentClusterIndexSsv(operatorIdsLocal);
        uint64 networkFeeIndex = sp.networkFeeIndex;

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;
    }

    function _settleTime() internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);

        uint256 operatorCount = operatorIds.length;
        for (uint256 i; i < operatorCount; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block != 0) {
                uint32 diff = currentBlock - operator.ethSnapshot.block;
                if (diff != 0) {
                    uint64 blockDiffFee = uint64(diff) * PackedETH.unwrap(operator.ethFee);
                    // Deviation-only model: effectiveVUnits = baseline + storedDeviation
                    uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                    uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * BPS_DENOMINATOR);
                    operator.ethSnapshot.index += blockDiffFee;
                    if (effectiveVUnits != 0 && blockDiffFee != 0) {
                        uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / BPS_DENOMINATOR;
                        operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
                    }
                    operator.ethSnapshot.block = currentBlock;
                }
            }

            if (operator.snapshot.block != 0) {
                uint32 diff = currentBlock - operator.snapshot.block;
                if (diff != 0) {
                    uint64 blockDiffFee = uint64(diff) * PackedSSV.unwrap(operator.fee);
                    operator.snapshot.index += blockDiffFee;
                    operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
                    operator.snapshot.block = currentBlock;
                }
            }
        }

        uint64 ethIndex = sp.currentNetworkFeeIndex();
        uint64 ssvIndex = sp.currentNetworkFeeIndexSSV();
        sp.ethNetworkFeeIndex = ethIndex;
        sp.networkFeeIndex = ssvIndex;
        sp.ethNetworkFeeIndexBlockNumber = currentBlock;
        sp.networkFeeIndexBlockNumber = currentBlock;

        sp.updateDAOEarnings();
        sp.updateDAOEarningsSSV();

        _syncClusters();
    }

    function _fastForward(uint32 blocks) internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);

        if (blocks == 0) return;

        uint256 operatorCount = operatorIds.length;
        for (uint256 i; i < operatorCount; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block != 0) {
                uint64 blockDiffFee = uint64(blocks) * PackedETH.unwrap(operator.ethFee);
                // Deviation-only model: effectiveVUnits = baseline + storedDeviation
                uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * BPS_DENOMINATOR);
                operator.ethSnapshot.index += blockDiffFee;
                if (effectiveVUnits != 0 && blockDiffFee != 0) {
                    uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / BPS_DENOMINATOR;
                    operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
                }
                operator.ethSnapshot.block = currentBlock;
            }

            if (operator.snapshot.block != 0) {
                uint64 blockDiffFee = uint64(blocks) * PackedSSV.unwrap(operator.fee);
                operator.snapshot.index += blockDiffFee;
                operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
                operator.snapshot.block = currentBlock;
            }
        }

        sp.ethNetworkFeeIndex += uint64(blocks) * PackedETH.unwrap(sp.ethNetworkFee);
        sp.networkFeeIndex += uint64(blocks) * PackedSSV.unwrap(sp.networkFee);
        sp.ethNetworkFeeIndexBlockNumber = currentBlock;
        sp.networkFeeIndexBlockNumber = currentBlock;

        if (sp.daoTotalEthVUnits != 0 && sp.ethNetworkFee.neq(PACKED_ETH_ZERO)) {
            uint128 earned = (uint128(blocks) * uint128(PackedETH.unwrap(sp.ethNetworkFee)) * uint128(sp.daoTotalEthVUnits)) /
                BPS_DENOMINATOR;
            sp.ethDaoBalance = sp.ethDaoBalance.add(PackedETH.wrap(uint64(earned)));
        }

        if (sp.daoValidatorCount != 0 && sp.networkFee.neq(PACKED_SSV_ZERO)) {
            uint64 earned = uint64(blocks) * PackedSSV.unwrap(sp.networkFee) * sp.daoValidatorCount;
            sp.daoBalance = sp.daoBalance.add(PackedSSV.wrap(earned));
        }
        sp.ethDaoIndexBlockNumber = currentBlock;
        sp.daoIndexBlockNumber = currentBlock;
    }

    function _syncClusters() internal {
        uint256 ethCount = ethClusterIds.length;
        for (uint256 i; i < ethCount; ++i) {
            bytes32 clusterId = ethClusterIds[i];
            ClusterRecord storage record = ethClusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;
            uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        }

        uint256 ssvCount = ssvClusterIds.length;
        for (uint256 i; i < ssvCount; ++i) {
            bytes32 clusterId = ssvClusterIds[i];
            ClusterRecord storage record = ssvClusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;
            uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
            _settleSsvCluster(clusterId, record, operatorIdsLocal);
            SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        }
    }

    function _sumEthClusterBalances() internal view returns (uint256) {
        uint256 sum = 0;
        uint256 count = ethClusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = ethClusters[ethClusterIds[i]];
            if (!record.exists) continue;
            sum += record.cluster.balance;
        }
        return sum;
    }

    function _sumSsvClusterBalances() internal view returns (uint256) {
        uint256 sum = 0;
        uint256 count = ssvClusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = ssvClusters[ssvClusterIds[i]];
            if (!record.exists) continue;
            sum += record.cluster.balance;
        }
        return sum;
    }

    function _sumOperatorEthEarnings() internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        uint256 sum = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            sum += PackedETHLib.unpack(s.operators[operatorIds[i]].ethSnapshot.balance);
        }
        return sum;
    }

    function _sumOperatorSsvEarnings() internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        uint256 sum = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            sum += PackedSSVLib.unpack(s.operators[operatorIds[i]].snapshot.balance);
        }
        return sum;
    }

    function _daoEthEarnings() internal view returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().ethDaoBalance);
    }

    function _daoSsvEarnings() internal view returns (uint256) {
        return PackedSSVLib.unpack(SSVStorageProtocol.load().daoBalance);
    }
}
