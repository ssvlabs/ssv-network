// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVViews} from "../../modules/SSVViews.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {SSVStorage, StorageData} from "../../libraries/storage/SSVStorage.sol";
import {SSVStorageProtocol} from "../../libraries/storage/SSVStorageProtocol.sol";
import {PackedETHLib, PackedSSVLib} from "../../libraries/SSVPackedLib.sol";
import "../../libraries/ClusterLib.sol";

/// @title SSVViewsHarness
/// @author SSV Labs
/// @notice Test-only harness that seeds storage for direct SSVViews unit testing.
contract SSVViewsHarness is SSVViews {
    using ClusterLib for ISSVNetworkCore.Cluster;

    /// @notice Deploys the SSVViews harness.
    /// @param cssv The cSSV token address used by SSVViews.
    constructor(address cssv) SSVViews(cssv) {}

    /// @notice Sets operator accounting fields for ETH and SSV paths.
    /// @param operatorId Operator id to configure.
    /// @param owner Operator owner address.
    /// @param ethFee ETH fee in unpacked units.
    /// @param ssvFee SSV fee in unpacked units.
    /// @param ethValidatorCount ETH validator count.
    /// @param ssvValidatorCount SSV validator count.
    function mockSetOperator(
        uint64 operatorId,
        address owner,
        uint256 ethFee,
        uint256 ssvFee,
        uint32 ethValidatorCount,
        uint32 ssvValidatorCount
    ) external {
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

        operator.owner = owner;
        operator.ethFee = PackedETHLib.pack(ethFee);
        operator.fee = PackedSSVLib.pack(ssvFee);
        operator.ethValidatorCount = ethValidatorCount;
        operator.validatorCount = ssvValidatorCount;
        operator.ethSnapshot.block = uint32(block.number);
        operator.snapshot.block = uint32(block.number);
    }

    /// @notice Sets stored ETH and SSV operator earnings snapshots.
    /// @param operatorId Operator id to configure.
    /// @param ethEarnings ETH earnings in unpacked units.
    /// @param ssvEarnings SSV earnings in unpacked units.
    function mockSetOperatorEarnings(uint64 operatorId, uint256 ethEarnings, uint256 ssvEarnings) external {
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

        operator.ethSnapshot.balance = PackedETHLib.pack(ethEarnings);
        operator.snapshot.balance = PackedSSVLib.pack(ssvEarnings);
        operator.ethSnapshot.block = uint32(block.number);
        operator.snapshot.block = uint32(block.number);
    }

    /// @notice Sets network ETH fee.
    /// @param fee ETH network fee in unpacked units.
    function mockSetNetworkFeeETH(uint256 fee) external {
        SSVStorageProtocol.load().ethNetworkFee = PackedETHLib.pack(fee);
    }

    /// @notice Sets network SSV fee.
    /// @param fee SSV network fee in unpacked units.
    function mockSetNetworkFeeSSV(uint256 fee) external {
        SSVStorageProtocol.load().networkFee = PackedSSVLib.pack(fee);
    }

    /// @notice Inserts an ETH cluster record into storage.
    /// @param clusterOwner Cluster owner address.
    /// @param operatorIds Operator ids composing the cluster.
    /// @param cluster Cluster state to store.
    function mockRegisterETHCluster(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster calldata cluster
    ) external {
        bytes32 hashedCluster = keccak256(abi.encodePacked(clusterOwner, operatorIds));
        SSVStorage.load().ethClusters[hashedCluster] = cluster.hashClusterData();
    }

    /// @notice Inserts an SSV cluster record into storage.
    /// @param clusterOwner Cluster owner address.
    /// @param operatorIds Operator ids composing the cluster.
    /// @param cluster Cluster state to store.
    function mockRegisterSSVCluster(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster calldata cluster
    ) external {
        bytes32 hashedCluster = keccak256(abi.encodePacked(clusterOwner, operatorIds));
        SSVStorage.load().clusters[hashedCluster] = cluster.hashClusterData();
    }
}
