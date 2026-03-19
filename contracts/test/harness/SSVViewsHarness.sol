// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVViews} from "../../modules/SSVViews.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {SSVStorage, StorageData} from "../../libraries/storage/SSVStorage.sol";
import {SSVStorageProtocol} from "../../libraries/storage/SSVStorageProtocol.sol";
import {SSVStorageEB} from "../../libraries/storage/SSVStorageEB.sol";
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

    /// @notice Returns SSV snapshot and fee raw values for an operator.
    /// @param operatorId Operator id to query.
    /// @return feeRaw Packed SSV fee raw value.
    /// @return index SSV snapshot index raw value.
    /// @return blockNumber SSV snapshot block number.
    /// @return balanceRaw Packed SSV snapshot balance raw value.
    function getOperatorSSVSnapshot(
        uint64 operatorId
    ) external view returns (uint64 feeRaw, uint64 index, uint32 blockNumber, uint64 balanceRaw) {
        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];
        return (
            PackedSSV.unwrap(operator.fee),
            operator.snapshot.index,
            operator.snapshot.block,
            PackedSSV.unwrap(operator.snapshot.balance)
        );
    }

    /// @notice Returns SSV network fee and fee-index state.
    /// @return feeRaw Packed SSV network fee raw value.
    /// @return index SSV network fee index raw value.
    /// @return indexBlockNumber SSV network fee index block number.
    function getNetworkFeeStateSSV() external view returns (uint64 feeRaw, uint64 index, uint32 indexBlockNumber) {
        return (
            PackedSSV.unwrap(SSVStorageProtocol.load().networkFee),
            SSVStorageProtocol.load().networkFeeIndex,
            SSVStorageProtocol.load().networkFeeIndexBlockNumber
        );
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

    /// @notice Seeds the EB snapshot vUnits for a cluster (ETH or SSV) in SSVStorageEB.
    /// @param clusterOwner Cluster owner address.
    /// @param operatorIds Operator ids composing the cluster.
    /// @param vUnits vUnits value to store (0 = implicit EB fallback to validatorCount * BPS_DENOMINATOR).
    function mockSetClusterEB(
        address clusterOwner,
        uint64[] calldata operatorIds,
        uint64 vUnits
    ) external {
        bytes32 hashedCluster = keccak256(abi.encodePacked(clusterOwner, operatorIds));
        SSVStorageEB.load().clusterEB[hashedCluster].vUnits = vUnits;
    }
}
