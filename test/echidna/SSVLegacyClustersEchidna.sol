// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PackedSSV, PackedETH, PACKED_SSV_ZERO, PACKED_ETH_ZERO, VERSION_SSV} from
    "../../contracts/libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib, DEDUCTED_DIGITS} from "../../contracts/libraries/SSVPackedLib.sol";

contract SSVLiquidatorUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.liquidateSSV(clusterOwner, operatorIds, cluster);
    }
}

contract SSVLegacyClustersEchidna is SSVClusters {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using PackedSSVLib for PackedSSV;

    uint32 private constant MIN_BLOCKS_BEFORE_LIQ_SSV = 2;
    uint32 private constant VALIDATOR_COUNT = 2;
    PackedSSV private constant OPERATOR_SSV_FEE = PackedSSV.wrap(10);
    uint256 private constant INITIAL_CLUSTER_BALANCE_SSV = 1_000 * DEDUCTED_DIGITS;

    MockToken private token;
    SSVLiquidatorUser private liquidator;

    uint64 private op1;
    uint64 private op2;
    uint64[] private clusterOperatorIds;

    struct SSVClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        bool exists;
    }

    SSVClusterRecord private record;
    bytes32 private clusterId;

    bool private liquidationStateDirty;
    bool private liquidationPayoutMismatch;

    constructor() {
        token = new MockToken();
        _mockSetToken(address(token));
        _initProtocolDefaults();
        _initOperators();
        _initSSVCluster();
    }

    receive() external payable {}

    function action_advance_time(uint256 blocksSeed) external {
        if (!record.exists || !record.cluster.active) return;

        uint32 blocks = uint32(blocksSeed % 8) + 1;
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        uint32 currentBlock = uint32(block.number);
        for (uint256 i; i < clusterOperatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[clusterOperatorIds[i]];
            if (op.snapshot.block == 0) continue;
            uint64 blockDiffFee = uint64(blocks) * PackedSSV.unwrap(op.fee);
            op.snapshot.index += blockDiffFee;
            op.snapshot.balance = op.snapshot.balance.add(
                PackedSSV.wrap(blockDiffFee * op.validatorCount)
            );
            op.snapshot.block = currentBlock;
        }

        sp.networkFeeIndex += uint64(blocks) * PackedSSV.unwrap(sp.networkFee);
        sp.networkFeeIndexBlockNumber = currentBlock;

        uint64 clusterIndex = _currentSSVClusterIndex();
        uint64 networkFeeIndex = sp.networkFeeIndex;
        ISSVNetworkCore.Cluster memory c = record.cluster;
        ClusterLib.updateBalanceSSV(c, clusterIndex, networkFeeIndex);
        c.index = clusterIndex;
        c.networkFeeIndex = networkFeeIndex;
        record.cluster = c;
        s.clusters[clusterId] = c.hashClusterData();
    }

    function action_liquidate_ssv() external {
        if (!record.exists || !record.cluster.active) return;

        // Settle harness state to current block so record.cluster.balance
        // matches what the contract will compute inside liquidateSSV.
        _syncToCurrentBlock();

        uint256 clusterBalance = record.cluster.balance;
        uint256 liquidatorTokenBefore = token.balanceOf(address(liquidator));
        uint256 contractTokenBefore = token.balanceOf(address(this));

        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try liquidator.liquidateSSV(address(liquidator), clusterOperatorIds, cluster) {
            StorageData storage s = SSVStorage.load();
            bytes32 storedHash = s.clusters[clusterId];

            ISSVNetworkCore.Cluster memory expectedAfter = ISSVNetworkCore.Cluster({
                validatorCount: cluster.validatorCount,
                networkFeeIndex: 0,
                index: 0,
                active: false,
                balance: 0
            });

            if (storedHash != expectedAfter.hashClusterData()) {
                liquidationStateDirty = true;
            }

            uint256 liquidatorTokenAfter = token.balanceOf(address(liquidator));
            uint256 contractTokenAfter = token.balanceOf(address(this));
            uint256 paid = liquidatorTokenAfter - liquidatorTokenBefore;

            if (paid != clusterBalance) {
                liquidationPayoutMismatch = true;
            }
            if (contractTokenBefore - contractTokenAfter != paid) {
                liquidationPayoutMismatch = true;
            }

            record.cluster = expectedAfter;
        } catch {}
    }

    function action_deposit_ssv(uint256 seed) external {
        if (!record.exists || !record.cluster.active) return;

        uint256 amount = (seed % 1_000 + 1) * DEDUCTED_DIGITS;
        token.mint(address(this), amount);
        record.cluster.balance += amount;
        SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
    }

    function echidna_ssv_liquidation_resets_and_pays() external view returns (bool) {
        return !liquidationStateDirty && !liquidationPayoutMismatch;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 3000;
        sp.networkFee = PackedSSV.wrap(1);
        sp.networkFeeIndex = 0;
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidationSSV = MIN_BLOCKS_BEFORE_LIQ_SSV;
        sp.minimumLiquidationCollateralSSV = PACKED_SSV_ZERO;
        sp.operatorMaxFeeSSV = type(uint64).max;
    }

    function _initOperators() internal {
        liquidator = new SSVLiquidatorUser(ISSVClusters(address(this)));

        StorageData storage s = SSVStorage.load();

        s.lastOperatorId.increment();
        op1 = uint64(s.lastOperatorId.current());
        s.operators[op1] = ISSVNetworkCore.Operator({
            validatorCount: VALIDATOR_COUNT,
            fee: OPERATOR_SSV_FEE,
            owner: address(liquidator),
            snapshot: ISSVNetworkCore.Snapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_SSV_ZERO
            }),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: PACKED_ETH_ZERO,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: 0, index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(bytes32(uint256(0x10))))] = op1;

        s.lastOperatorId.increment();
        op2 = uint64(s.lastOperatorId.current());
        s.operators[op2] = ISSVNetworkCore.Operator({
            validatorCount: VALIDATOR_COUNT,
            fee: OPERATOR_SSV_FEE,
            owner: address(liquidator),
            snapshot: ISSVNetworkCore.Snapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_SSV_ZERO
            }),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: PACKED_ETH_ZERO,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: 0, index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(bytes32(uint256(0x11))))] = op2;

        uint64[] memory ids = new uint64[](2);
        ids[0] = op1;
        ids[1] = op2;
        clusterOperatorIds = ids;
    }

    function _initSSVCluster() internal {
        StorageData storage s = SSVStorage.load();

        clusterId = keccak256(abi.encodePacked(address(liquidator), clusterOperatorIds));

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: VALIDATOR_COUNT,
            networkFeeIndex: 0,
            index: 0,
            active: true,
            balance: INITIAL_CLUSTER_BALANCE_SSV
        });

        s.clusters[clusterId] = cluster.hashClusterData();
        record = SSVClusterRecord({cluster: cluster, owner: address(liquidator), exists: true});

        token.mint(address(this), INITIAL_CLUSTER_BALANCE_SSV);

        SSVStorageProtocol.load().daoValidatorCount += VALIDATOR_COUNT;
    }

    function _syncToCurrentBlock() internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint32 currentBlock = uint32(block.number);

        for (uint256 i; i < clusterOperatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[clusterOperatorIds[i]];
            if (op.snapshot.block == 0 || op.snapshot.block >= currentBlock) continue;
            uint64 blockDiff = uint64(currentBlock - op.snapshot.block);
            uint64 blockDiffFee = blockDiff * PackedSSV.unwrap(op.fee);
            op.snapshot.index += blockDiffFee;
            op.snapshot.balance = op.snapshot.balance.add(
                PackedSSV.wrap(blockDiffFee * op.validatorCount)
            );
            op.snapshot.block = currentBlock;
        }

        if (sp.networkFeeIndexBlockNumber < currentBlock) {
            uint64 netDiff = uint64(currentBlock - sp.networkFeeIndexBlockNumber);
            sp.networkFeeIndex += netDiff * PackedSSV.unwrap(sp.networkFee);
            sp.networkFeeIndexBlockNumber = currentBlock;
        }

        uint64 clusterIndex = _currentSSVClusterIndex();
        uint64 networkFeeIndex = sp.networkFeeIndex;
        ISSVNetworkCore.Cluster memory c = record.cluster;
        ClusterLib.updateBalanceSSV(c, clusterIndex, networkFeeIndex);
        c.index = clusterIndex;
        c.networkFeeIndex = networkFeeIndex;
        record.cluster = c;
        s.clusters[clusterId] = c.hashClusterData();
    }

    function _currentSSVClusterIndex() internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 currentBlock = uint64(block.number);
        uint64 clusterIndex;
        for (uint256 i; i < clusterOperatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[clusterOperatorIds[i]];
            uint64 blockDiff = currentBlock - uint64(op.snapshot.block);
            clusterIndex += op.snapshot.index + blockDiff * PackedSSV.unwrap(op.fee);
        }
        return clusterIndex;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }
}
