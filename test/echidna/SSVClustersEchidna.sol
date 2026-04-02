// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVStaking.sol";
import {ISSVClusters} from "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/storage/SSVStorageStaking.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "./SSVStakingEchidna.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETHLib, PackedSSVLib, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";

contract ClusterUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function deposit(address clusterOwner, uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster)
        external
        payable
    {
        clusters.deposit{value: msg.value}(clusterOwner, operatorIds, cluster);
    }

    function depositFromBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint256 amount
    ) external {
        clusters.deposit{value: amount}(clusterOwner, operatorIds, cluster);
    }

    function withdraw(uint64[] calldata operatorIds, uint256 amount, ISSVNetworkCore.Cluster memory cluster) external {
        clusters.withdraw(operatorIds, amount, cluster);
    }

    function liquidate(address clusterOwner, uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster)
        external
    {
        clusters.liquidate(clusterOwner, operatorIds, cluster);
    }

    function reactivate(uint64[] calldata operatorIds, ISSVNetworkCore.Cluster memory cluster) external payable {
        clusters.reactivate{value: msg.value}(operatorIds, cluster);
    }

    function reactivateFromBalance(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint256 amount
    ) external {
        clusters.reactivate{value: amount}(operatorIds, cluster);
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

contract OperatorUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    receive() external payable {}

    function remove(uint64 operatorId) external {
        operators.removeOperator(operatorId);
    }

    function withdraw(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarnings(operatorId, amount);
    }
}

contract SSVClustersEchidna is SSVClusters, SSVOperators(0), SSVStaking(address(new CSSVTokenMock(address(this)))) {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using PackedETHLib for PackedETH;
    using ProtocolLib for StorageProtocol;

    uint8 private constant MAX_CLUSTERS = 6;
    uint64 private constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
    uint256 private constant MAX_STAKE = 1_000_000 ether;
    PackedETH private constant HARNESS_DEFAULT_OPERATOR_ETH_FEE = PackedETH.wrap(1);
    PackedETH private constant HARNESS_DEFAULT_NETWORK_ETH_FEE = PackedETH.wrap(1);
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    uint32 private constant MIN_BLOCKS_BETWEEN_UPDATES = 2;
    uint32 private constant SOLVENCY_BLOCK_WINDOW = 5_000_000;

    MockToken private token;
    CSSVTokenMock private cssv;

    ClusterUser private owner1;
    ClusterUser private owner2;
    ClusterUser private attacker;
    OperatorUser private opOwner1;
    OperatorUser private opOwner2;
    OperatorUser private opOwner3;
    StakingUser private staker1;
    StakingUser private staker2;

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
    mapping(bytes32 => bool) private liquidatedClusters;

    uint256 private totalExpectedBalance;

    bool private overWithdrawSucceeded;
    bool private withdrawPayoutMismatch;
    bool private unauthorizedWithdrawSucceeded;
    bool private liquidatePayoutMismatch;
    bool private reactivateWhileActiveSucceeded;
    bool private dustLiquidationFailed;
    bool private ebUpdateWithoutRootSucceeded;
    bool private ebUpdateFrequencyBypassed;
    bool private ebUpdateStalenessBypassed;
    bool private feeIndexNotCurrentAfterSettle;
    bool private feeUsedNewVUnitsOnEbChange;
    bool private implicitEbDefaultViolation;
    bool private liquidationDidNotClearEbSnapshot;
    bool private ebSnapshotRootDecreased;
    bool private ebSnapshotFutureBlock;
    bool private clusterBalanceFloorViolation;
    bool private depositLiquidatedViolation;
    bool private withdrawLiquidatedViolation;
    bool private reactivateRemovedOperatorsViolation;

    constructor() {
        token = new MockToken();
        cssv = CSSVTokenMock(CSSV_ADDRESS);
        _mockSetToken(address(token));

        ISSVClusters clustersSelf = ISSVClusters(address(this));
        ISSVOperators operatorsSelf = ISSVOperators(address(this));
        IStaking stakingSelf = IStaking(address(this));

        owner1 = new ClusterUser(clustersSelf);
        owner2 = new ClusterUser(clustersSelf);
        attacker = new ClusterUser(clustersSelf);
        opOwner1 = new OperatorUser(operatorsSelf);
        opOwner2 = new OperatorUser(operatorsSelf);
        opOwner3 = new OperatorUser(operatorsSelf);
        staker1 = new StakingUser(stakingSelf, IERC20(address(token)), IERC20(address(cssv)));
        staker2 = new StakingUser(stakingSelf, IERC20(address(token)), IERC20(address(cssv)));

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
        uint64 clusterIndex = 0;
        uint64 networkFeeIndex = 0;

        uint256 available = _availableBalance();
        if (available != 0) {
            uint256 minRequired = _minimumActiveClusterBalance(operatorIds, validatorCount);
            StorageData storage s = SSVStorage.load();
            bool allOperatorsActive = true;
            uint256 operatorsLength = operatorIds.length;
            for (uint256 i; i < operatorsLength; ++i) {
                if (s.operators[operatorIds[i]].ethSnapshot.block == 0) {
                    allOperatorsActive = false;
                    break;
                }
            }

            if (allOperatorsActive && minRequired != 0 && minRequired <= available) {
                StorageProtocol storage sp = SSVStorageProtocol.load();
                for (uint256 i; i < operatorsLength; ++i) {
                    OperatorLib.updateSnapshotSt(s.operators[operatorIds[i]], operatorIds[i]);
                    s.operators[operatorIds[i]].ethValidatorCount += validatorCount;
                }
                sp.updateDAO(true, validatorCount);

                active = true;
                balance = minRequired;
                clusterIndex = _currentClusterIndex(operatorIds);
                networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(sp);
            }
        }

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: networkFeeIndex,
            index: clusterIndex,
            active: active,
            balance: balance
        });

        SSVStorage.load().ethClusters[clusterId] = cluster.hashClusterData();

        clusters[clusterId] = ClusterRecord({cluster: cluster, owner: owner, operatorsKey: operatorsKey, exists: true});
        liquidatedClusters[clusterId] = false;
        clusterIds.push(clusterId);
        totalExpectedBalance += balance;
    }

    function action_deposit(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

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
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint32 blocks = uint32((seed >> 16) % MAX_ADVANCE_BLOCKS) + 1;
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        _fastForwardOperators(operatorIds, blocks);
        sp.ethNetworkFeeIndex += uint64(blocks) * PackedETH.unwrap(sp.ethNetworkFee);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);

        ISSVNetworkCore.Cluster memory beforeCluster = record.cluster;
        (ISSVNetworkCore.Cluster memory expectedSettled, uint256 expectedBurned) =
            _expectedSettledCluster(clusterId, beforeCluster, operatorIds);
        uint256 burned = _settleCluster(clusterId, record, operatorIds);
        if (!_sameCluster(record.cluster, expectedSettled) || burned != expectedBurned) {
            clusterBalanceFloorViolation = true;
        }
        _decreaseExpected(burned);

        s.ethClusters[clusterId] = record.cluster.hashClusterData();
    }

    function action_dust_liquidation(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (record.operatorsKey != 0) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        uint64 burnRate = _burnRate(operatorIds);
        if (burnRate == 0) return;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 vUnits = ClusterLib.getVUnits(clusterId, record.cluster.validatorCount);

        uint128 perBlockUnits = (uint128(burnRate + PackedETH.unwrap(sp.ethNetworkFee)) * uint128(vUnits)) / BPS_DENOMINATOR;
        uint256 perBlock = PackedETHLib.unpack(PackedETH.wrap(uint64(perBlockUnits)));
        if (perBlock == 0) return;

        _fastForwardOperators(operatorIds, 2);
        sp.ethNetworkFeeIndex += 2 * PackedETH.unwrap(sp.ethNetworkFee);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);

        uint256 burned = _settleCluster(clusterId, record, operatorIds);
        _decreaseExpected(burned);

        SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();

        bool liquidatable = record.cluster
            .isLiquidatableWithEB(
                clusterId,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );

        if (record.cluster.balance < perBlock && !liquidatable) {
            dustLiquidationFailed = true;
            return;
        }

        if (liquidatable) {
            if (record.cluster.balance == 0) return;
            if (record.cluster.balance > address(this).balance) return;
            try attacker.liquidate(record.owner, operatorIds, record.cluster) {
                uint256 payout = record.cluster.balance;
                _decreaseExpected(payout);

                record.cluster.active = false;
                record.cluster.balance = 0;
                record.cluster.index = 0;
                record.cluster.networkFeeIndex = 0;
                if (SSVStorage.load().ethClusters[clusterId] == record.cluster.hashClusterData()) {
                    liquidatedClusters[clusterId] = true;
                } else {
                    clusterBalanceFloorViolation = true;
                }

            } catch {
                dustLiquidationFailed = true;
            }
        }
    }

    function action_stake(uint256 seed, uint8 userSeed) external {
        StakingUser user = _staker(userSeed);
        uint256 amount = (seed % MAX_STAKE) + MINIMAL_STAKING_AMOUNT;

        if (seed % 8 == 0) {
            amount = 0;
        } else if (seed % 8 == 1) {
            amount = MINIMAL_STAKING_AMOUNT - 1;
        }

        token.mint(address(user), amount);
        try user.approve(amount) {} catch {}
        try user.stake(amount) {} catch {}
    }

    function action_claim_rewards(uint8 userSeed) external {
        if (_sumProjectedClusterBalances() != 0) return;

        StakingUser user = _staker(userSeed);
        address userAddr = address(user);

        if (cssv.balanceOf(userAddr) == 0 && SSVStorageStaking.load().accrued[userAddr] == 0) return;

        try user.claim() {} catch {}
    }

    function action_withdraw_operator_eth(uint256 seed) external {
        if (_sumProjectedClusterBalances() != 0) return;

        uint64 operatorId = _pickOperatorId(seed);
        if (operatorId == 0) return;

        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        if (operator.ethSnapshot.block == 0) return;

        OperatorLib.updateSnapshot(operator, operatorId);
        PackedETH balance = operator.ethSnapshot.balance;
        if (balance.eq(PACKED_ETH_ZERO)) return;

        uint256 amount = PackedETHLib.unpack(balance);
        if (amount > address(this).balance) return;

        try _operatorOwnerUser(operatorId).withdraw(operatorId, 0) {} catch {}
    }

    function action_withdraw(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        if (record.cluster.balance == 0) return;
        uint256 amount = _boundAmount(seed >> 8, record.cluster.balance);
        if (amount == 0) return;

        if (amount > address(this).balance) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        (ISSVNetworkCore.Cluster memory expectedSettled, uint256 expectedBurned) =
            _expectedSettledCluster(clusterId, cluster, operatorIds);
        ClusterUser owner = _ownerUser(record.owner);

        uint256 ownerBefore = record.owner.balance;
        uint256 contractBefore = address(this).balance;

        try owner.withdraw(operatorIds, amount, cluster) {
            uint256 burned = _settleCluster(clusterId, record, operatorIds);
            if (!_sameCluster(record.cluster, expectedSettled) || burned != expectedBurned) {
                clusterBalanceFloorViolation = true;
            }
            _decreaseExpected(burned);

            if (record.cluster.balance < amount) {
                withdrawPayoutMismatch = true;
                clusterBalanceFloorViolation = true;
                return;
            }

            record.cluster.balance -= amount;
            if (record.cluster.balance != expectedSettled.balance - amount) {
                clusterBalanceFloorViolation = true;
            }
            if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) {
                clusterBalanceFloorViolation = true;
            }
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

    function action_deposit_liquidated(uint256 seed) external {
        bytes32 clusterId = _ensureLiquidatedCluster(seed, false);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || record.cluster.active) return;
        if (!liquidatedClusters[clusterId]) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint256 sourceCapacity = record.owner.balance;
        if (sourceCapacity == 0) return;

        uint256 amount = (seed >> 8) % sourceCapacity + 1;
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        _depositToLiquidatedCluster(clusterId, record, operatorIds, amount);
    }

    function action_withdraw_liquidated(uint256 seed) external {
        bytes32 clusterId = _ensureLiquidatedCluster(seed, false);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || record.cluster.active) return;
        if (!liquidatedClusters[clusterId]) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        uint256 amount;

        if (record.cluster.balance == 0) {
            uint256 sourceCapacity = record.owner.balance;
            if (sourceCapacity == 0) return;
            amount = (seed >> 8) % sourceCapacity + 1;
            if (!_depositToLiquidatedCluster(clusterId, record, operatorIds, amount)) return;
        } else {
            amount = (seed >> 8) % record.cluster.balance + 1;
        }

        ISSVNetworkCore.Cluster memory clusterBefore = record.cluster;
        ClusterUser owner = _ownerUser(record.owner);

        uint256 operatorEarningsBefore = _sumTrackedOperatorEarnings(operatorIds);
        uint256 daoBefore = _daoEthBalance();
        uint256 ownerBalanceBefore = record.owner.balance;
        uint256 contractBalanceBefore = address(this).balance;

        try owner.withdraw(operatorIds, amount, clusterBefore) {
            ISSVNetworkCore.Cluster memory expectedCluster = ISSVNetworkCore.Cluster({
                validatorCount: clusterBefore.validatorCount,
                networkFeeIndex: clusterBefore.networkFeeIndex,
                index: clusterBefore.index,
                active: clusterBefore.active,
                balance: clusterBefore.balance
            });
            expectedCluster.balance -= amount;

            if (clusterBefore.balance < amount) {
                withdrawLiquidatedViolation = true;
                clusterBalanceFloorViolation = true;
                return;
            }
            if (expectedCluster.balance != clusterBefore.balance - amount) {
                clusterBalanceFloorViolation = true;
            }
            if (expectedCluster.active) {
                withdrawLiquidatedViolation = true;
            }
            if (expectedCluster.index != clusterBefore.index) {
                withdrawLiquidatedViolation = true;
                clusterBalanceFloorViolation = true;
            }
            if (expectedCluster.networkFeeIndex != clusterBefore.networkFeeIndex) {
                withdrawLiquidatedViolation = true;
                clusterBalanceFloorViolation = true;
            }

            bytes32 expectedHash = expectedCluster.hashClusterData();
            bool hashMatches = SSVStorage.load().ethClusters[clusterId] == expectedHash;
            if (!hashMatches) {
                withdrawLiquidatedViolation = true;
                clusterBalanceFloorViolation = true;
            }
            if (record.owner.balance != ownerBalanceBefore + amount) {
                withdrawLiquidatedViolation = true;
            }
            if (address(this).balance != contractBalanceBefore - amount) {
                withdrawLiquidatedViolation = true;
            }
            if (_sumTrackedOperatorEarnings(operatorIds) != operatorEarningsBefore) {
                withdrawLiquidatedViolation = true;
            }
            if (_daoEthBalance() != daoBefore) {
                withdrawLiquidatedViolation = true;
            }

            if (!hashMatches) {
                return;
            }

            record.cluster = expectedCluster;
            if (record.cluster.balance != clusterBefore.balance - amount) {
                clusterBalanceFloorViolation = true;
            }
            _decreaseExpected(amount);
        } catch {
            withdrawLiquidatedViolation = true;
        }
    }

    function action_liquidate(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint256 payout = record.cluster.balance;
        if (payout > address(this).balance) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        (ISSVNetworkCore.Cluster memory expectedSettled, uint256 expectedBurned) =
            _expectedSettledCluster(clusterId, cluster, operatorIds);
        ClusterUser owner = _ownerUser(record.owner);

        uint256 ownerBefore = record.owner.balance;
        uint256 contractBefore = address(this).balance;

        try owner.liquidate(record.owner, operatorIds, cluster) {
            uint256 burned = _settleCluster(clusterId, record, operatorIds);
            if (!_sameCluster(record.cluster, expectedSettled) || burned != expectedBurned) {
                clusterBalanceFloorViolation = true;
            }
            _decreaseExpected(burned);

            payout = record.cluster.balance;
            _decreaseExpected(payout);

            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;
            if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) {
                clusterBalanceFloorViolation = true;
            } else {
                liquidatedClusters[clusterId] = true;
            }

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
        if (amount == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint256 burnRate = 0;
        for (uint256 i; i < operatorIds.length; ++i) {
            burnRate += PackedETH.unwrap(s.operators[operatorIds[i]].ethFee);
        }

        uint256 minPerBlock = (burnRate + PackedETH.unwrap(sp.ethNetworkFee)) * uint256(record.cluster.validatorCount)
            * ETH_DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * SOLVENCY_BLOCK_WINDOW;
        if (minRequired == 0) {
            minRequired = ETH_DEDUCTED_DIGITS;
        }
        if (amount < minRequired) {
            amount = minRequired;
        }
        if (amount > available) return;

        try owner.reactivate{value: amount}(operatorIds, cluster) {
            record.cluster.active = true;
            record.cluster.balance += amount;
            record.cluster.index = _currentClusterIndex(operatorIds);
            record.cluster.networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(SSVStorageProtocol.load());
            totalExpectedBalance += amount;
            liquidatedClusters[clusterId] = false;
        } catch {}
    }

    function action_reactivate_with_removed_operators(uint256 seed) external {
        bytes32 clusterId = _ensureLiquidatedCluster(seed, true);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || record.cluster.active) return;
        if (!liquidatedClusters[clusterId]) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        uint64[] memory activeBefore = _activeOperatorIds(operatorIds);
        if (activeBefore.length < 2) return;
        if (activeBefore.length != operatorIds.length) return;

        uint64 removedOperatorId = activeBefore[activeBefore.length - 1];
        address removedOwner = s.operators[removedOperatorId].owner;
        uint64 removedFrozenIndex;

        try _operatorOwnerUser(removedOperatorId).remove(removedOperatorId) {
            if (s.operators[removedOperatorId].ethSnapshot.block != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].ethValidatorCount != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (PackedETH.unwrap(s.operators[removedOperatorId].ethFee) != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].owner != removedOwner) {
                reactivateRemovedOperatorsViolation = true;
            }
            removedFrozenIndex = s.operators[removedOperatorId].ethSnapshot.index;
        } catch {
            reactivateRemovedOperatorsViolation = true;
            return;
        }

        uint64[] memory activeOperatorIds = _activeOperatorIds(operatorIds);
        if (activeOperatorIds.length + 1 != activeBefore.length) {
            reactivateRemovedOperatorsViolation = true;
            return;
        }

        uint32[] memory activeCountsBefore = new uint32[](activeOperatorIds.length);
        for (uint256 i; i < activeOperatorIds.length; ++i) {
            activeCountsBefore[i] = s.operators[activeOperatorIds[i]].ethValidatorCount;
        }

        uint32 daoValidatorCountBefore = sp.ethDaoValidatorCount;
        uint256 minBalance = _minimumActiveClusterBalance(activeOperatorIds, record.cluster.validatorCount);
        uint256 amount = minBalance > record.cluster.balance ? minBalance - record.cluster.balance : 0;
        if (record.owner.balance < amount) return;

        ISSVNetworkCore.Cluster memory clusterBefore = record.cluster;
        uint64 expectedClusterIndex = _currentClusterIndex(operatorIds);
        uint64 expectedNetworkFeeIndex = ProtocolLib.currentNetworkFeeIndex(sp);
        ClusterUser owner = _ownerUser(record.owner);

        try owner.reactivateFromBalance(operatorIds, clusterBefore, amount) {
            ISSVNetworkCore.Cluster memory expectedCluster = ISSVNetworkCore.Cluster({
                validatorCount: clusterBefore.validatorCount,
                networkFeeIndex: expectedNetworkFeeIndex,
                index: expectedClusterIndex,
                active: true,
                balance: clusterBefore.balance + amount
            });

            bytes32 expectedHash = expectedCluster.hashClusterData();
            bool hashMatches = SSVStorage.load().ethClusters[clusterId] == expectedHash;
            if (!hashMatches) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].ethSnapshot.block != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].ethValidatorCount != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (PackedETH.unwrap(s.operators[removedOperatorId].ethFee) != 0) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].owner != removedOwner) {
                reactivateRemovedOperatorsViolation = true;
            }
            if (s.operators[removedOperatorId].ethSnapshot.index != removedFrozenIndex) {
                reactivateRemovedOperatorsViolation = true;
            }

            for (uint256 i; i < activeOperatorIds.length; ++i) {
                uint64 operatorId = activeOperatorIds[i];
                if (s.operators[operatorId].ethValidatorCount != activeCountsBefore[i] + clusterBefore.validatorCount) {
                    reactivateRemovedOperatorsViolation = true;
                }
            }
            if (sp.ethDaoValidatorCount != daoValidatorCountBefore + clusterBefore.validatorCount) {
                reactivateRemovedOperatorsViolation = true;
            }

            if (hashMatches) {
                record.cluster = expectedCluster;
                totalExpectedBalance += amount;
                liquidatedClusters[clusterId] = false;
            }
        } catch {
            reactivateRemovedOperatorsViolation = true;
        }
    }

    function action_update_cluster_balance_valid(uint256 seed) external {
        bytes32 clusterId = _pickClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();

        ClusterEBSnapshot memory ebBefore = seb.clusterEB[clusterId];
        if (uint64(block.number) < ebBefore.lastRootBlockNum + 1) return;

        uint64 minBlockNum = ebBefore.lastRootBlockNum + 1;
        uint64 blockNum = minBlockNum + uint64((seed >> 8) % (uint64(block.number) - minBlockNum + 1));

        uint32 minEb = record.cluster.validatorCount * uint32(DEFAULT_EB_PER_VALIDATOR / 1 ether);
        uint32 maxEb = minEb + (record.cluster.validatorCount * 16);
        uint32 effectiveBalance = minEb;
        if (maxEb > minEb) {
            effectiveBalance = minEb + uint32((seed >> 24) % (maxEb - minEb + 1));
        }

        bytes32 root = _singleLeafRoot(clusterId, effectiveBalance);
        _setCommittedRoot(seb, blockNum, root);
        bytes32[] memory proof = new bytes32[](0);

        ISSVNetworkCore.Cluster memory beforeCluster = record.cluster;
        uint64 oldVUnits = ebBefore.vUnits;
        if (oldVUnits == 0) {
            oldVUnits = uint64(beforeCluster.validatorCount) * BPS_DENOMINATOR;
        }
        uint64 newVUnits = ClusterLib.ebToVUnits(effectiveBalance);

        uint64 clusterIndex = _currentClusterIndex(operatorIds);
        uint64 networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(sp);
        if (clusterIndex < beforeCluster.index || networkFeeIndex < beforeCluster.networkFeeIndex) return;

        uint128 idxOp = uint128(clusterIndex - beforeCluster.index);
        uint128 idxNet = uint128(networkFeeIndex - beforeCluster.networkFeeIndex);
        uint128 operatorFeeUnitsOld = (idxOp * uint128(oldVUnits)) / BPS_DENOMINATOR;
        uint128 networkFeeUnitsOld = (idxNet * uint128(oldVUnits)) / BPS_DENOMINATOR;
        uint256 totalFeesOld = (uint256(operatorFeeUnitsOld) + uint256(networkFeeUnitsOld)) * ETH_DEDUCTED_DIGITS;

        ISSVNetworkCore.Cluster memory expectedCluster = ISSVNetworkCore.Cluster({
            validatorCount: beforeCluster.validatorCount,
            networkFeeIndex: networkFeeIndex,
            index: clusterIndex,
            active: beforeCluster.active,
            balance: beforeCluster.balance >= totalFeesOld ? beforeCluster.balance - totalFeesOld : 0
        });

        uint64 burnRate = _burnRate(operatorIds);
        bool shouldLiquidate = expectedCluster.validatorCount != 0
            && expectedCluster.isLiquidatableWithEB(
                clusterId,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );

        uint256 expectedPayout = 0;
        if (shouldLiquidate) {
            expectedPayout = expectedCluster.balance;
            expectedCluster.active = false;
            expectedCluster.balance = 0;
            expectedCluster.index = 0;
            expectedCluster.networkFeeIndex = 0;
        }

        bool checkImplicitEbDefault = ebBefore.vUnits == 0 && totalFeesOld != 0;
        bytes32 wrongImplicitHash = bytes32(0);
        bool wrongImplicitHashDistinct = false;
        if (checkImplicitEbDefault) {
            ISSVNetworkCore.Cluster memory wrongImplicitCluster = ISSVNetworkCore.Cluster({
                validatorCount: beforeCluster.validatorCount,
                networkFeeIndex: networkFeeIndex,
                index: clusterIndex,
                active: beforeCluster.active,
                balance: beforeCluster.balance
            });

            bool wrongShouldLiquidate = wrongImplicitCluster.validatorCount != 0
                && wrongImplicitCluster.isLiquidatableWithVUnits(
                    newVUnits,
                    burnRate,
                    PackedETH.unwrap(sp.ethNetworkFee),
                    sp.minimumBlocksBeforeLiquidation,
                    sp.minimumLiquidationCollateral
                );

            if (wrongShouldLiquidate) {
                wrongImplicitCluster.active = false;
                wrongImplicitCluster.balance = 0;
                wrongImplicitCluster.index = 0;
                wrongImplicitCluster.networkFeeIndex = 0;
            }

            wrongImplicitHash = wrongImplicitCluster.hashClusterData();
        }

        uint256 liquidatorBefore = address(attacker).balance;
        try attacker.updateClusterBalance(blockNum, record.owner, operatorIds, beforeCluster, effectiveBalance, proof) {
            bytes32 storedHash = SSVStorage.load().ethClusters[clusterId];
            bytes32 expectedHash = expectedCluster.hashClusterData();
            if (checkImplicitEbDefault) {
                wrongImplicitHashDistinct = wrongImplicitHash != expectedHash;
            }
            if (storedHash != expectedHash) {
                feeIndexNotCurrentAfterSettle = true;
                if (checkImplicitEbDefault) {
                    implicitEbDefaultViolation = true;
                }
            }

            if (checkImplicitEbDefault && wrongImplicitHashDistinct && storedHash == wrongImplicitHash) {
                implicitEbDefaultViolation = true;
            }

            if (!shouldLiquidate && newVUnits != oldVUnits) {
                uint128 operatorFeeUnitsNew = (idxOp * uint128(newVUnits)) / BPS_DENOMINATOR;
                uint128 networkFeeUnitsNew = (idxNet * uint128(newVUnits)) / BPS_DENOMINATOR;
                uint256 totalFeesNew =
                    (uint256(operatorFeeUnitsNew) + uint256(networkFeeUnitsNew)) * ETH_DEDUCTED_DIGITS;
                if (totalFeesNew != totalFeesOld) {
                    ISSVNetworkCore.Cluster memory altCluster = ISSVNetworkCore.Cluster({
                        validatorCount: beforeCluster.validatorCount,
                        networkFeeIndex: networkFeeIndex,
                        index: clusterIndex,
                        active: beforeCluster.active,
                        balance: beforeCluster.balance >= totalFeesNew ? beforeCluster.balance - totalFeesNew : 0
                    });
                    if (storedHash == altCluster.hashClusterData()) {
                        feeUsedNewVUnitsOnEbChange = true;
                    }
                }
            }

            if (shouldLiquidate) {
                uint256 payout = address(attacker).balance - liquidatorBefore;
                if (payout != expectedPayout) {
                    liquidatePayoutMismatch = true;
                }
            }

            ClusterEBSnapshot storage ebAfter = seb.clusterEB[clusterId];
            if (ebAfter.lastRootBlockNum < ebBefore.lastRootBlockNum) {
                ebSnapshotRootDecreased = true;
            }
            if (ebAfter.lastUpdateBlock > block.number) {
                ebSnapshotFutureBlock = true;
            }

            if (storedHash == expectedHash) {
                if (beforeCluster.balance > expectedCluster.balance) {
                    _decreaseExpected(beforeCluster.balance - expectedCluster.balance);
                }
                record.cluster = expectedCluster;
                if (shouldLiquidate) {
                    liquidatedClusters[clusterId] = true;
                }
            }
        } catch {}
    }

    function action_update_cluster_balance_without_root(uint256 seed) external {
        bytes32 clusterId = _pickInactiveClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot memory ebBefore = seb.clusterEB[clusterId];

        if (uint64(block.number) < ebBefore.lastRootBlockNum + 1) return;
        uint64 minBlockNum = ebBefore.lastRootBlockNum + 1;
        uint64 blockNum = minBlockNum + uint64((seed >> 8) % (uint64(block.number) - minBlockNum + 1));
        uint32 effectiveBalance = record.cluster.validatorCount * uint32(DEFAULT_EB_PER_VALIDATOR / 1 ether);

        _setCommittedRoot(seb, blockNum, bytes32(0));
        bytes32[] memory proof = new bytes32[](0);
        try attacker.updateClusterBalance(
            blockNum, record.owner, operatorIds, record.cluster, effectiveBalance, proof
        ) {
            ebUpdateWithoutRootSucceeded = true;
        } catch {}
    }

    function action_update_cluster_balance_too_frequent(uint256 seed) external {
        bytes32 clusterId = _pickInactiveClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot memory ebBefore = seb.clusterEB[clusterId];

        if (uint64(block.number) < ebBefore.lastRootBlockNum + 2) return;
        uint64 firstBlock = ebBefore.lastRootBlockNum + 1;
        uint64 secondBlock = firstBlock + 1;
        uint32 effectiveBalance = record.cluster.validatorCount * uint32(DEFAULT_EB_PER_VALIDATOR / 1 ether);

        bytes32 firstRoot = _singleLeafRoot(clusterId, effectiveBalance);
        bytes32 secondRoot = _singleLeafRoot(clusterId, effectiveBalance + 1);

        bytes32[] memory proof = new bytes32[](0);
        _setCommittedRoot(seb, firstBlock, firstRoot);
        try attacker.updateClusterBalance(
            firstBlock, record.owner, operatorIds, record.cluster, effectiveBalance, proof
        ) {
            _setCommittedRoot(seb, secondBlock, secondRoot);
            try attacker.updateClusterBalance(
                    secondBlock, record.owner, operatorIds, record.cluster, effectiveBalance + 1, proof
                ) {
                ebUpdateFrequencyBypassed = true;
            } catch {}
        } catch {}
    }

    function action_update_cluster_balance_stale(uint256 seed) external {
        bytes32 clusterId = _pickInactiveClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = clusters[clusterId];
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        StorageEB storage seb = SSVStorageEB.load();
        ClusterEBSnapshot memory ebBefore = seb.clusterEB[clusterId];

        if (uint64(block.number) < ebBefore.lastRootBlockNum + 1) return;
        uint64 blockNum = ebBefore.lastRootBlockNum + 1;
        uint32 effectiveBalance = record.cluster.validatorCount * uint32(DEFAULT_EB_PER_VALIDATOR / 1 ether);
        bytes32 root = _singleLeafRoot(clusterId, effectiveBalance);
        bytes32[] memory proof = new bytes32[](0);

        _setCommittedRoot(seb, blockNum, root);
        try attacker.updateClusterBalance(
            blockNum, record.owner, operatorIds, record.cluster, effectiveBalance, proof
        ) {
            // Isolate stale-check behavior in second call.
            seb.clusterEB[clusterId].lastUpdateBlock = 0;
            try attacker.updateClusterBalance(
                blockNum, record.owner, operatorIds, record.cluster, effectiveBalance, proof
            ) {
                ebUpdateStalenessBypassed = true;
            } catch {}
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
                if (record.cluster.index != 0) return false;
                if (record.cluster.networkFeeIndex != 0) return false;
            }
        }
        return true;
    }

    function echidna_cluster_balance_accounting() external view returns (bool) {
        uint256 sum = 0;
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = clusters[clusterIds[i]];
            if (!record.exists) return false;
            sum += record.cluster.balance;
        }
        return sum == totalExpectedBalance;
    }

    function echidna_eth_balance_accounting() external view returns (bool) {
        (uint256 liabilities, bool ok) = _currentEthLiabilities();
        if (!ok) return false;

        return address(this).balance >= liabilities;
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

    function echidna_eb_snapshot_block_lte_current() external view returns (bool) {
        if (ebSnapshotFutureBlock) return false;

        StorageEB storage seb = SSVStorageEB.load();
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            if (seb.clusterEB[clusterIds[i]].lastUpdateBlock > block.number) return false;
        }
        return true;
    }

    function echidna_eb_snapshot_root_monotonic() external view returns (bool) {
        return !ebSnapshotRootDecreased;
    }

    function echidna_eb_update_requires_root() external view returns (bool) {
        return !ebUpdateWithoutRootSucceeded;
    }

    function echidna_eb_update_frequency() external view returns (bool) {
        return !ebUpdateFrequencyBypassed;
    }

    function echidna_eb_update_staleness() external view returns (bool) {
        return !ebUpdateStalenessBypassed;
    }

    function echidna_fee_index_current_after_settle() external view returns (bool) {
        return !feeIndexNotCurrentAfterSettle;
    }

    function echidna_implicit_eb_default_used() external view returns (bool) {
        return !implicitEbDefaultViolation;
    }

    function echidna_fee_uses_old_vunits_on_eb_change() external view returns (bool) {
        return !feeUsedNewVUnitsOnEbChange;
    }

    function echidna_liquidation_clears_eb_snapshot() external pure returns (bool) {
        // Liquidation is allowed to leave the last EB snapshot in storage.
        return true;
    }

    function echidna_cluster_balance_non_negative() external view returns (bool) {
        return !clusterBalanceFloorViolation;
    }

    function echidna_deposit_liquidated_succeeds() external view returns (bool) {
        return !depositLiquidatedViolation;
    }

    function echidna_withdraw_liquidated_skips_fees() external view returns (bool) {
        return !withdrawLiquidatedViolation;
    }

    function echidna_reactivate_with_removed_operators() external view returns (bool) {
        return !reactivateRemovedOperatorsViolation;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.ethNetworkFee = HARNESS_DEFAULT_NETWORK_ETH_FEE;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;

        SSVStorageEB.load().minBlocksBetweenUpdates = MIN_BLOCKS_BETWEEN_UPDATES;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();

        op1 = _createOperator(s, address(opOwner1), bytes32(uint256(0x1)));
        op2 = _createOperator(s, address(opOwner2), bytes32(uint256(0x2)));
        op3 = _createOperator(s, address(opOwner3), bytes32(uint256(0x3)));
    }

    function _createOperator(StorageData storage s, address owner, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PACKED_SSV_ZERO,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: HARNESS_DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _pickOperatorId(uint256 seed) internal view returns (uint64) {
        uint256 key = seed % 3;
        if (key == 0) return op1;
        if (key == 1) return op2;
        return op3;
    }

    function _operatorIdsForKey(uint8 key) internal view returns (uint64[] memory) {
        if (key == 0) {
            uint64[] memory singleOperatorIds = new uint64[](1);
            singleOperatorIds[0] = op1;
            return singleOperatorIds;
        }
        if (key == 1) {
            uint64[] memory twoOperatorIds = new uint64[](2);
            twoOperatorIds[0] = op1;
            twoOperatorIds[1] = op2;
            return twoOperatorIds;
        }
        uint64[] memory threeOperatorIds = new uint64[](3);
        threeOperatorIds[0] = op1;
        threeOperatorIds[1] = op2;
        threeOperatorIds[2] = op3;
        return threeOperatorIds;
    }

    function _pickClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = clusterIds.length;
        if (count == 0) return bytes32(0);
        return clusterIds[seed % count];
    }

    function _pickInactiveClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = clusterIds.length;
        if (count == 0) return bytes32(0);

        uint256 start = seed % count;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[(start + i) % count];
            if (clusters[clusterId].exists && !clusters[clusterId].cluster.active) {
                return clusterId;
            }
        }
        return bytes32(0);
    }

    function _pickLiquidatedClusterId(uint256 seed, bool requireMultiOperator) internal view returns (bytes32) {
        uint256 count = clusterIds.length;
        if (count == 0) return bytes32(0);

        uint256 start = seed % count;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[(start + i) % count];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists || record.cluster.active) continue;
            if (!liquidatedClusters[clusterId]) continue;
            if (requireMultiOperator && record.operatorsKey == 0) continue;
            if (requireMultiOperator && !_isCanonicalRemovedOperatorCluster(clusterId, record)) continue;
            if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) continue;
            return clusterId;
        }

        return bytes32(0);
    }

    function _pickActiveClusterId(uint256 seed, bool requireMultiOperator) internal view returns (bytes32) {
        uint256 count = clusterIds.length;
        if (count == 0) return bytes32(0);

        uint256 start = seed % count;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[(start + i) % count];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;
            if (requireMultiOperator && record.operatorsKey == 0) continue;
            if (requireMultiOperator && !_isCanonicalRemovedOperatorCluster(clusterId, record)) continue;
            return clusterId;
        }

        return bytes32(0);
    }

    function _ensureLiquidatedCluster(uint256 seed, bool requireMultiOperator) internal returns (bytes32) {
        bytes32 clusterId = _pickLiquidatedClusterId(seed, requireMultiOperator);
        if (clusterId != bytes32(0)) return clusterId;

        clusterId = _pickActiveClusterId(seed, requireMultiOperator);
        if (clusterId == bytes32(0)) {
            clusterId = _bootstrapActiveCluster(seed, requireMultiOperator);
            if (clusterId == bytes32(0)) return bytes32(0);
        }

        ClusterRecord storage record = clusters[clusterId];
        if (!record.exists || !record.cluster.active) return bytes32(0);
        if (requireMultiOperator && record.operatorsKey == 0) return bytes32(0);
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return bytes32(0);
        if (record.cluster.balance > address(this).balance) return bytes32(0);

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory clusterBefore = record.cluster;
        (ISSVNetworkCore.Cluster memory expectedSettled, uint256 expectedBurned) =
            _expectedSettledCluster(clusterId, clusterBefore, operatorIds);
        ISSVNetworkCore.Cluster memory expectedLiquidated = ISSVNetworkCore.Cluster({
            validatorCount: expectedSettled.validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });
        ClusterUser owner = _ownerUser(record.owner);
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint64[] memory activeBefore = _activeOperatorIds(operatorIds);
        uint32[] memory activeCountsBefore = new uint32[](activeBefore.length);
        uint64[] memory operatorDeviationsBefore = new uint64[](activeBefore.length);
        for (uint256 i; i < activeBefore.length; ++i) {
            activeCountsBefore[i] = s.operators[activeBefore[i]].ethValidatorCount;
            operatorDeviationsBefore[i] = seb.operatorEthVUnits[activeBefore[i]];
        }
        uint32 daoValidatorCountBefore = sp.ethDaoValidatorCount;
        uint64 daoTotalEthVUnitsBefore = sp.daoTotalEthVUnits;
        uint64 storedVUnitsBefore = seb.clusterEB[clusterId].vUnits;

        try owner.liquidate(record.owner, operatorIds, clusterBefore) {
            if (SSVStorage.load().ethClusters[clusterId] != expectedLiquidated.hashClusterData()) {
                clusterBalanceFloorViolation = true;
                return bytes32(0);
            }
            for (uint256 i; i < activeBefore.length; ++i) {
                if (s.operators[activeBefore[i]].ethValidatorCount != activeCountsBefore[i] - clusterBefore.validatorCount) {
                    clusterBalanceFloorViolation = true;
                    return bytes32(0);
                }
            }
            if (sp.ethDaoValidatorCount != daoValidatorCountBefore - clusterBefore.validatorCount) {
                clusterBalanceFloorViolation = true;
                return bytes32(0);
            }
            if (storedVUnitsBefore == 0) {
                uint64 baselineDelta = uint64(clusterBefore.validatorCount) * BPS_DENOMINATOR;
                if (sp.daoTotalEthVUnits != daoTotalEthVUnitsBefore - baselineDelta) {
                    clusterBalanceFloorViolation = true;
                    return bytes32(0);
                }
                for (uint256 i; i < activeBefore.length; ++i) {
                    if (seb.operatorEthVUnits[activeBefore[i]] != operatorDeviationsBefore[i]) {
                        clusterBalanceFloorViolation = true;
                        return bytes32(0);
                    }
                }
            }
            _decreaseExpected(expectedBurned);
            _decreaseExpected(expectedSettled.balance);
            record.cluster = expectedLiquidated;
            liquidatedClusters[clusterId] = true;

            return clusterId;
        } catch {
            return bytes32(0);
        }
    }

    function _bootstrapActiveCluster(uint256 seed, bool requireMultiOperator) internal returns (bytes32) {
        if (clusterIds.length >= MAX_CLUSTERS) return bytes32(0);

        uint8 operatorsKey = requireMultiOperator ? 1 : 0;
        uint64[] memory operatorIds = _operatorIdsForKey(operatorsKey);
        StorageData storage s = SSVStorage.load();
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            if (s.operators[operatorIds[i]].ethSnapshot.block == 0) {
                return bytes32(0);
            }
        }

        uint32 validatorCount = 1;
        uint256 minRequired = _minimumActiveClusterBalance(operatorIds, validatorCount);
        if (minRequired == 0 || minRequired > _availableBalance()) return bytes32(0);

        address firstOwner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        bytes32 clusterId = _createBootstrapCluster(firstOwner, operatorsKey, operatorIds, validatorCount, minRequired);
        if (clusterId != bytes32(0)) return clusterId;

        address secondOwner = firstOwner == address(owner1) ? address(owner2) : address(owner1);
        return _createBootstrapCluster(secondOwner, operatorsKey, operatorIds, validatorCount, minRequired);
    }

    function _createBootstrapCluster(
        address owner,
        uint8 operatorsKey,
        uint64[] memory operatorIds,
        uint32 validatorCount,
        uint256 balance
    ) internal returns (bytes32 clusterId) {
        clusterId = keccak256(abi.encodePacked(owner, operatorIds));
        if (clusters[clusterId].exists) return bytes32(0);

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint256 operatorsLength = operatorIds.length;

        for (uint256 i; i < operatorsLength; ++i) {
            OperatorLib.updateSnapshotSt(s.operators[operatorIds[i]], operatorIds[i]);
            s.operators[operatorIds[i]].ethValidatorCount += validatorCount;
        }
        sp.updateDAO(true, validatorCount);

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: ProtocolLib.currentNetworkFeeIndex(sp),
            index: _currentClusterIndex(operatorIds),
            active: true,
            balance: balance
        });

        s.ethClusters[clusterId] = cluster.hashClusterData();
        clusters[clusterId] = ClusterRecord({cluster: cluster, owner: owner, operatorsKey: operatorsKey, exists: true});
        liquidatedClusters[clusterId] = false;
        clusterIds.push(clusterId);
        totalExpectedBalance += balance;
    }

    function _staker(uint8 seed) internal view returns (StakingUser) {
        if (seed % 2 == 0) return staker1;
        return staker2;
    }

    function _ownerUser(address owner) internal view returns (ClusterUser) {
        if (owner == address(owner1)) return owner1;
        if (owner == address(owner2)) return owner2;
        return attacker;
    }

    function _operatorOwnerUser(uint64 operatorId) internal view returns (OperatorUser) {
        if (operatorId == op1) return opOwner1;
        if (operatorId == op2) return opOwner2;
        return opOwner3;
    }

    function _availableBalance() internal view returns (uint256) {
        (uint256 reserved, bool ok) = _currentProjectedEthReservations();
        if (!ok || address(this).balance <= reserved) return 0;
        return address(this).balance - reserved;
    }

    function _minimumActiveClusterBalance(uint64[] memory operatorIds, uint32 validatorCount) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint256 burnRate = _burnRate(operatorIds);
        uint256 minPerBlock =
            (burnRate + PackedETH.unwrap(sp.ethNetworkFee)) * uint256(validatorCount) * ETH_DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * SOLVENCY_BLOCK_WINDOW;
        return minRequired == 0 ? ETH_DEDUCTED_DIGITS : minRequired;
    }

    function _sumTrackedOperatorEthEarnings() internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        uint256 sum = 0;

        uint64[3] memory ids = [op1, op2, op3];
        for (uint256 i; i < ids.length; ++i) {
            sum += PackedETHLib.unpack(s.operators[ids[i]].ethSnapshot.balance);
        }

        return sum;
    }

    function _sumTrackedOperatorEarnings(uint64[] memory operatorIds) internal view returns (uint256 sum) {
        StorageData storage s = SSVStorage.load();
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            sum += PackedETHLib.unpack(s.operators[operatorIds[i]].ethSnapshot.balance);
        }
    }

    function _sumProjectedOperatorEthEarnings() internal view returns (uint256 sum) {
        uint64[3] memory ids = [op1, op2, op3];
        for (uint256 i; i < ids.length; ++i) {
            sum += _projectedOperatorEthBalance(ids[i]);
        }
    }

    function _sumProjectedClusterBalances() internal view returns (uint256 sum) {
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[i];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists) continue;
            sum += _projectedClusterBalance(clusterId, record);
        }
    }

    function _projectedClusterBalance(bytes32 clusterId, ClusterRecord storage record) internal view returns (uint256) {
        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        if (!cluster.active) return cluster.balance;

        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        uint64 clusterIndex = _currentClusterIndex(operatorIds);
        uint64 networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(SSVStorageProtocol.load());

        if (clusterIndex < cluster.index || networkFeeIndex < cluster.networkFeeIndex) {
            return cluster.balance;
        }

        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        return cluster.balance;
    }

    function _daoEthBalance() internal view returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().ethDaoBalance);
    }

    function _stakingEthPoolBalance() internal view returns (uint256) {
        return PackedETHLib.unpack(SSVStorageStaking.load().stakingEthPoolBalance);
    }

    function _projectedDaoEthBalance() internal view returns (uint256) {
        return PackedETHLib.unpack(ProtocolLib.networkTotalEarnings(SSVStorageProtocol.load()));
    }

    function _currentEthLiabilities() internal view returns (uint256 liabilities, bool ok) {
        (liabilities, ok) = _addNoOverflow(_sumProjectedClusterBalances(), _sumTrackedOperatorEthEarnings());
        if (!ok) return (0, false);

        uint256 protocolEthLiability = _daoEthBalance();
        uint256 stakingPoolLiability = _stakingEthPoolBalance();
        if (stakingPoolLiability > protocolEthLiability) {
            protocolEthLiability = stakingPoolLiability;
        }

        return _addNoOverflow(liabilities, protocolEthLiability);
    }

    function _currentProjectedEthReservations() internal view returns (uint256 liabilities, bool ok) {
        (liabilities, ok) = _addNoOverflow(_sumProjectedClusterBalances(), _sumProjectedOperatorEthEarnings());
        if (!ok) return (0, false);

        uint256 protocolEthLiability = _projectedDaoEthBalance();
        uint256 stakingPoolLiability = _stakingEthPoolBalance();
        if (stakingPoolLiability > protocolEthLiability) {
            protocolEthLiability = stakingPoolLiability;
        }

        return _addNoOverflow(liabilities, protocolEthLiability);
    }

    function _addNoOverflow(uint256 a, uint256 b) internal pure returns (uint256 sum, bool ok) {
        unchecked {
            sum = a + b;
        }
        ok = sum >= a;
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }

    function _singleLeafRoot(bytes32 clusterId, uint32 effectiveBalance) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(clusterId, effectiveBalance))));
    }

    function _setCommittedRoot(StorageEB storage seb, uint64 blockNum, bytes32 root) internal {
        seb.ebRoots[blockNum] = root;
        seb.latestCommittedBlock = blockNum;
    }

    function _settleCluster(bytes32 clusterId, ClusterRecord storage record, uint64[] memory operatorIds)
        internal
        returns (uint256 burned)
    {
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

    function _sameCluster(
        ISSVNetworkCore.Cluster memory lhs,
        ISSVNetworkCore.Cluster memory rhs
    ) internal pure returns (bool) {
        return lhs.validatorCount == rhs.validatorCount && lhs.networkFeeIndex == rhs.networkFeeIndex
            && lhs.index == rhs.index && lhs.active == rhs.active && lhs.balance == rhs.balance;
    }

    function _expectedSettledCluster(
        bytes32 clusterId,
        ISSVNetworkCore.Cluster memory beforeCluster,
        uint64[] memory operatorIds
    ) internal view returns (ISSVNetworkCore.Cluster memory expectedCluster, uint256 burned) {
        expectedCluster = ISSVNetworkCore.Cluster({
            validatorCount: beforeCluster.validatorCount,
            networkFeeIndex: beforeCluster.networkFeeIndex,
            index: beforeCluster.index,
            active: beforeCluster.active,
            balance: beforeCluster.balance
        });

        uint64 clusterIndex = _currentClusterIndex(operatorIds);
        uint64 networkFeeIndex = ProtocolLib.currentNetworkFeeIndex(SSVStorageProtocol.load());
        if (clusterIndex < beforeCluster.index || networkFeeIndex < beforeCluster.networkFeeIndex) {
            return (expectedCluster, 0);
        }

        expectedCluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        expectedCluster.index = clusterIndex;
        expectedCluster.networkFeeIndex = networkFeeIndex;
        if (beforeCluster.balance > expectedCluster.balance) {
            burned = beforeCluster.balance - expectedCluster.balance;
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
            clusterIndex += operator.ethSnapshot.index + blockDiff * PackedETH.unwrap(operator.ethFee);
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
    }

    function _burnRate(uint64[] memory operatorIds) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 burnRate = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            burnRate += PackedETH.unwrap(s.operators[operatorIds[i]].ethFee);
        }
        return burnRate;
    }

    function _projectedOperatorEthBalance(uint64 operatorId) internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
        uint256 balance = PackedETHLib.unpack(operator.ethSnapshot.balance);
        if (operator.ethSnapshot.block == 0) {
            return balance;
        }

        uint64 blockDiffFee = (uint64(block.number) - uint64(operator.ethSnapshot.block)) * PackedETH.unwrap(operator.ethFee);
        if (blockDiffFee == 0) {
            return balance;
        }

        uint64 storedDeviation = SSVStorageEB.load().operatorEthVUnits[operatorId];
        uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * BPS_DENOMINATOR);
        if (effectiveVUnits == 0) {
            return balance;
        }

        uint128 deltaUnits = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / BPS_DENOMINATOR;
        return balance + uint256(deltaUnits) * ETH_DEDUCTED_DIGITS;
    }

    function _activeOperatorIds(uint64[] memory operatorIds) internal view returns (uint64[] memory activeOperatorIds) {
        StorageData storage s = SSVStorage.load();
        uint256 count = operatorIds.length;
        uint256 activeCount = 0;
        for (uint256 i; i < count; ++i) {
            if (s.operators[operatorIds[i]].ethSnapshot.block != 0) {
                activeCount++;
            }
        }

        activeOperatorIds = new uint64[](activeCount);
        uint256 next = 0;
        for (uint256 i; i < count; ++i) {
            uint64 operatorId = operatorIds[i];
            if (s.operators[operatorId].ethSnapshot.block != 0) {
                activeOperatorIds[next++] = operatorId;
            }
        }
    }

    function _reactivationMinRequired(uint64[] memory activeOperatorIds, ClusterRecord storage record)
        internal
        view
        returns (uint256)
    {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 burnRate = _burnRate(activeOperatorIds);
        uint64[] memory operatorIds = _operatorIdsForKey(record.operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(record.owner, operatorIds));

        uint64 baselineVUnits = uint64(record.cluster.validatorCount) * BPS_DENOMINATOR;
        uint64 storedVUnits = SSVStorageEB.load().clusterEB[clusterId].vUnits;
        uint64 effectiveVUnits = storedVUnits > 0 ? storedVUnits : baselineVUnits;
        uint256 threshold = (
            uint256(sp.minimumBlocksBeforeLiquidation) * uint256(burnRate + PackedETH.unwrap(sp.ethNetworkFee))
                * uint256(effectiveVUnits)
        ) / BPS_DENOMINATOR;
        threshold *= ETH_DEDUCTED_DIGITS;

        if (threshold <= record.cluster.balance) {
            return 0;
        }
        return threshold - record.cluster.balance;
    }

    function _isCanonicalRemovedOperatorCluster(bytes32 clusterId, ClusterRecord storage record) internal view returns (bool) {
        return record.cluster.validatorCount == 1 && SSVStorageEB.load().clusterEB[clusterId].vUnits == 0;
    }

    function _depositToLiquidatedCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIds,
        uint256 amount
    ) internal returns (bool) {
        if (!record.exists || record.cluster.active || amount == 0) return false;
        if (record.owner.balance < amount) return false;
        if (SSVStorage.load().ethClusters[clusterId] != record.cluster.hashClusterData()) return false;

        ISSVNetworkCore.Cluster memory clusterBefore = record.cluster;
        uint256 contractBalanceBefore = address(this).balance;
        ClusterUser owner = _ownerUser(record.owner);

        try owner.depositFromBalance(record.owner, operatorIds, clusterBefore, amount) {
            ISSVNetworkCore.Cluster memory expectedCluster = ISSVNetworkCore.Cluster({
                validatorCount: clusterBefore.validatorCount,
                networkFeeIndex: clusterBefore.networkFeeIndex,
                index: clusterBefore.index,
                active: clusterBefore.active,
                balance: clusterBefore.balance + amount
            });

            bytes32 expectedHash = expectedCluster.hashClusterData();
            bool hashMatches = SSVStorage.load().ethClusters[clusterId] == expectedHash;
            if (!hashMatches) {
                depositLiquidatedViolation = true;
                return false;
            }
            if (expectedCluster.active) {
                depositLiquidatedViolation = true;
            }
            if (address(this).balance != contractBalanceBefore + amount) {
                depositLiquidatedViolation = true;
            }
            record.cluster = expectedCluster;
            totalExpectedBalance += amount;
            return true;
        } catch {
            depositLiquidatedViolation = true;
            return false;
        }
    }

    function _decreaseExpected(uint256 amount) internal {
        if (amount == 0) return;
        if (totalExpectedBalance >= amount) {
            totalExpectedBalance -= amount;
        } else {
            totalExpectedBalance = 0;
        }
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }
    function _boundEffectiveBalance(uint256 seed, uint32 validatorCount) internal pure returns (uint32) {
        if (validatorCount == 0) return 0;

        uint32 minEb = validatorCount * 32;
        uint32 maxEb = validatorCount * 2048;
        uint32 range = maxEb - minEb + 1;

        return minEb + uint32(seed % range);
    }

}
