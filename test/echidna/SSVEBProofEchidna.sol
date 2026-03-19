// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";
import {PackedETHLib, PackedSSVLib} from "../../contracts/libraries/SSVPackedLib.sol";

contract EBUpdateUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    function updateBalance(
        uint64 blockNum,
        address clusterOwner,
        uint64[] memory operatorIds,
        ISSVNetworkCore.Cluster memory cluster,
        uint32 effectiveBalance,
        bytes32[] memory merkleProof
    ) external {
        clusters.updateClusterBalance(blockNum, clusterOwner, operatorIds, cluster, effectiveBalance, merkleProof);
    }
}

contract SSVEBProofEchidna is SSVClusters {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using PackedETHLib for PackedETH;

    uint32 private constant VALIDATOR_COUNT = 4;
    uint32 private constant MIN_EB_PER_VALIDATOR = 32;
    uint32 private constant MAX_EB_PER_VALIDATOR_ETH = 2048;

    EBUpdateUser private updateUser;

    address private clusterOwner;
    uint64 private op1;
    uint64[] private clusterOperatorIds;
    ISSVNetworkCore.Cluster private clusterRecord;
    bytes32 private clusterId;

    bool private invalidProofAccepted;
    bool private ebOutOfBoundsAccepted;
    bool private snapshotFieldsMismatch;

    struct LastUpdate {
        uint64 blockNum;
        uint32 effectiveBalance;
        bool occurred;
    }
    LastUpdate private lastUpdate;

    constructor() {
        _initProtocolDefaults();
        _initOperatorAndCluster();
        updateUser = new EBUpdateUser(ISSVClusters(address(this)));
    }

    receive() external payable {}

    function _computeLeaf(bytes32 _clusterId, uint32 effectiveBalance) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(_clusterId, effectiveBalance))));
    }

    function _boundEB(uint32 seed) internal pure returns (uint32) {
        uint32 minEB = VALIDATOR_COUNT * MIN_EB_PER_VALIDATOR;
        uint32 maxEB = VALIDATOR_COUNT * MAX_EB_PER_VALIDATOR_ETH;
        uint32 range = maxEB - minEB + 1;
        return minEB + (seed % range);
    }

    function action_update_with_eb(uint32 effectiveBalance) external {
        StorageEB storage seb = SSVStorageEB.load();
        uint64 blockNum = uint64(block.number);

        if (
            seb.clusterEB[clusterId].lastRootBlockNum != 0 &&
            blockNum <= seb.clusterEB[clusterId].lastRootBlockNum
        ) return;

        if (
            seb.clusterEB[clusterId].lastUpdateBlock != 0 &&
            block.number < seb.clusterEB[clusterId].lastUpdateBlock + seb.minBlocksBetweenUpdates
        ) return;

        bytes32 leaf = _computeLeaf(clusterId, effectiveBalance);
        seb.ebRoots[blockNum] = leaf;

        bool inBounds =
            effectiveBalance >= (VALIDATOR_COUNT * MIN_EB_PER_VALIDATOR) &&
            effectiveBalance <= (VALIDATOR_COUNT * MAX_EB_PER_VALIDATOR_ETH);

        bytes32[] memory emptyProof = new bytes32[](0);

        try updateUser.updateBalance(
            blockNum,
            clusterOwner,
            clusterOperatorIds,
            clusterRecord,
            effectiveBalance,
            emptyProof
        ) {
            if (!inBounds) {
                ebOutOfBoundsAccepted = true;
            }

            ClusterEBSnapshot memory snap = seb.clusterEB[clusterId];
            uint64 expectedVUnits = ClusterLib.ebToVUnits(effectiveBalance);
            if (snap.vUnits != expectedVUnits)           snapshotFieldsMismatch = true;
            if (snap.lastRootBlockNum != blockNum)       snapshotFieldsMismatch = true;
            if (snap.lastUpdateBlock != uint64(block.number)) snapshotFieldsMismatch = true;

            lastUpdate = LastUpdate(blockNum, effectiveBalance, true);
        } catch {}
    }

    function action_update_tampered_eb(uint32 correctEB, uint32 tamperedEB) external {
        StorageEB storage seb = SSVStorageEB.load();
        uint64 blockNum = uint64(block.number);

        if (
            seb.clusterEB[clusterId].lastRootBlockNum != 0 &&
            blockNum <= seb.clusterEB[clusterId].lastRootBlockNum
        ) return;

        uint32 validEB = _boundEB(correctEB);

        uint32 wrongEB = tamperedEB;
        if (wrongEB == validEB) {
            wrongEB = (validEB == type(uint32).max) ? validEB - 1 : validEB + 1;
        }
        if (wrongEB == validEB) return;

        bytes32 leaf = _computeLeaf(clusterId, validEB);
        seb.ebRoots[blockNum] = leaf;

        bytes32[] memory emptyProof = new bytes32[](0);
        try updateUser.updateBalance(
            blockNum,
            clusterOwner,
            clusterOperatorIds,
            clusterRecord,
            wrongEB,
            emptyProof
        ) {
            invalidProofAccepted = true;
        } catch {}
    }

    function echidna_eb_merkle_proof_verified() external view returns (bool) {
        return !invalidProofAccepted;
    }

    function echidna_eb_bounds_enforced() external view returns (bool) {
        return !ebOutOfBoundsAccepted;
    }

    function echidna_eb_snapshot_fields_exact() external view returns (bool) {
        return !snapshotFieldsMismatch;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFee = PACKED_ETH_ZERO;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = 0;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
        sp.validatorsPerOperatorLimit = 3000;

        SSVStorageEB.load().minBlocksBetweenUpdates = 0;
    }

    function _initOperatorAndCluster() internal {
        StorageData storage s = SSVStorage.load();

        s.lastOperatorId.increment();
        op1 = uint64(s.lastOperatorId.current());
        s.operators[op1] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PACKED_SSV_ZERO,
            owner: address(this),
            snapshot: ISSVNetworkCore.Snapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_SSV_ZERO
            }),
            whitelisted: false,
            ethValidatorCount: VALIDATOR_COUNT,
            ethFee: PACKED_ETH_ZERO,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_ETH_ZERO
            })
        });
        s.operatorsPKs[keccak256(abi.encodePacked(bytes32(uint256(0x1))))] = op1;

        clusterOwner = address(this);
        uint64[] memory ids = new uint64[](1);
        ids[0] = op1;
        clusterOperatorIds = ids;
        clusterId = keccak256(abi.encodePacked(clusterOwner, ids));

        clusterRecord = ISSVNetworkCore.Cluster({
            validatorCount: VALIDATOR_COUNT,
            networkFeeIndex: 0,
            index: 0,
            active: true,
            balance: 1000 ether
        });
        s.ethClusters[clusterId] = clusterRecord.hashClusterData();
    }
}
