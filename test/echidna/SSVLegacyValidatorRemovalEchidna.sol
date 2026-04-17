// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/interfaces/ISSVValidators.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/ValidatorLib.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVValidators.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO, DEDUCTED_DIGITS} from "../../contracts/libraries/SSVCoreTypes.sol";

contract LegacySSVValidatorRemovalUser {
    ISSVValidators public validators;

    constructor(ISSVValidators validators_) {
        validators = validators_;
    }

    function remove(
        bytes calldata publicKey,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        validators.removeValidator(publicKey, operatorIds, cluster);
    }

    function bulkRemove(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        validators.bulkRemoveValidator(publicKeys, operatorIds, cluster);
    }
}

/// @notice Targeted legacy SSV validator-removal harness for active and already-liquidated clusters.
contract SSVLegacyValidatorRemovalEchidna is SSVClusters, SSVValidators {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;

    uint32 private constant INITIAL_VALIDATOR_COUNT = 2;
    uint256 private constant INITIAL_SSV_BALANCE = 1_000_000_000 * DEDUCTED_DIGITS;
    uint64 private constant DEFAULT_OPERATOR_SSV_FEE = 1;
    uint64 private constant DEFAULT_NETWORK_SSV_FEE = 1;

    MockToken private token;

    LegacySSVValidatorRemovalUser private activeOwner;
    LegacySSVValidatorRemovalUser private liquidatedOwner;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;
    uint64 private op4;
    uint64[] private operatorIds;

    bytes32 private activeClusterId;
    bytes32 private liquidatedClusterId;
    ISSVNetworkCore.Cluster private activeClusterModel;
    ISSVNetworkCore.Cluster private liquidatedClusterModel;

    uint32 private expectedCountedValidators;

    bool private settlementViolation;
    mapping(uint8 => bool) private activeValidatorPresent;
    mapping(uint8 => bool) private liquidatedValidatorPresent;

    constructor() {
        token = new MockToken();
        _mockSetToken(address(token));

        ISSVValidators validatorsSelf = ISSVValidators(address(this));
        activeOwner = new LegacySSVValidatorRemovalUser(validatorsSelf);
        liquidatedOwner = new LegacySSVValidatorRemovalUser(validatorsSelf);

        _initProtocolDefaults();
        _initOperators();
        _initActiveLegacySsvCluster();
        _initLiquidatedLegacySsvCluster();
    }

    receive() external payable {}

    /// @notice No-op step so Echidna can build nonzero SSV accrual before active removals.
    function action_advance_ssv_fees(uint256 seed) external pure {
        seed;
    }

    function action_remove_validator_active(uint256 seed) external {
        if (!activeClusterModel.active || activeClusterModel.validatorCount == 0) return;

        uint8 tag = _pickPresentActiveValidator(seed);
        if (tag == 0) return;

        ISSVNetworkCore.Cluster memory clusterBefore = activeClusterModel;
        ISSVNetworkCore.Cluster memory expectedAfter = _settledActiveCluster(clusterBefore);
        expectedAfter.validatorCount -= 1;

        try activeOwner.remove(_validatorKey(tag), _operatorIds(), clusterBefore) {
            bytes32 firstHash = _validatorHash(tag, address(activeOwner));
            uint32 expectedCountAfter = expectedCountedValidators - 1;
            if (!_postRemovalMatches(activeClusterId, expectedAfter, expectedCountAfter, firstHash, bytes32(0))) {
                settlementViolation = true;
                return;
            }

            expectedCountedValidators = expectedCountAfter;
            activeClusterModel = expectedAfter;
            activeValidatorPresent[tag] = false;
        } catch {}
    }

    function action_bulk_remove_validator_active() external {
        if (!activeClusterModel.active || activeClusterModel.validatorCount < 2) return;
        if (!activeValidatorPresent[1] || !activeValidatorPresent[2]) return;

        ISSVNetworkCore.Cluster memory clusterBefore = activeClusterModel;
        ISSVNetworkCore.Cluster memory expectedAfter = _settledActiveCluster(clusterBefore);
        expectedAfter.validatorCount -= 2;

        bytes[] memory publicKeys = new bytes[](2);
        publicKeys[0] = _validatorKey(1);
        publicKeys[1] = _validatorKey(2);

        try activeOwner.bulkRemove(publicKeys, _operatorIds(), clusterBefore) {
            bytes32 firstHash = _validatorHash(1, address(activeOwner));
            bytes32 secondHash = _validatorHash(2, address(activeOwner));
            uint32 expectedCountAfter = expectedCountedValidators - 2;
            if (!_postRemovalMatches(activeClusterId, expectedAfter, expectedCountAfter, firstHash, secondHash)) {
                settlementViolation = true;
                return;
            }

            expectedCountedValidators = expectedCountAfter;
            activeClusterModel = expectedAfter;
            activeValidatorPresent[1] = false;
            activeValidatorPresent[2] = false;
        } catch {}
    }

    function action_remove_validator_liquidated(uint256 seed) external {
        if (liquidatedClusterModel.active || liquidatedClusterModel.validatorCount == 0) return;

        uint8 tag = _pickPresentLiquidatedValidator(seed);
        if (tag == 0) return;

        ISSVNetworkCore.Cluster memory clusterBefore = liquidatedClusterModel;
        ISSVNetworkCore.Cluster memory expectedAfter = clusterBefore;
        expectedAfter.validatorCount -= 1;

        try liquidatedOwner.remove(_validatorKey(tag), _operatorIds(), clusterBefore) {
            bytes32 firstHash = _validatorHash(tag, address(liquidatedOwner));
            if (!_postRemovalMatches(liquidatedClusterId, expectedAfter, expectedCountedValidators, firstHash, bytes32(0))) {
                settlementViolation = true;
                return;
            }

            liquidatedClusterModel = expectedAfter;
            liquidatedValidatorPresent[tag] = false;
        } catch {}
    }

    function action_bulk_remove_validator_liquidated() external {
        if (liquidatedClusterModel.active || liquidatedClusterModel.validatorCount < 2) return;
        if (!liquidatedValidatorPresent[1] || !liquidatedValidatorPresent[2]) return;

        ISSVNetworkCore.Cluster memory clusterBefore = liquidatedClusterModel;
        ISSVNetworkCore.Cluster memory expectedAfter = clusterBefore;
        expectedAfter.validatorCount -= 2;

        bytes[] memory publicKeys = new bytes[](2);
        publicKeys[0] = _validatorKey(1);
        publicKeys[1] = _validatorKey(2);

        try liquidatedOwner.bulkRemove(publicKeys, _operatorIds(), clusterBefore) {
            bytes32 firstHash = _validatorHash(1, address(liquidatedOwner));
            bytes32 secondHash = _validatorHash(2, address(liquidatedOwner));
            if (!_postRemovalMatches(liquidatedClusterId, expectedAfter, expectedCountedValidators, firstHash, secondHash)) {
                settlementViolation = true;
                return;
            }

            liquidatedClusterModel = expectedAfter;
            liquidatedValidatorPresent[1] = false;
            liquidatedValidatorPresent[2] = false;
        } catch {}
    }

    function echidna_legacy_ssv_counts_match_model() external view returns (bool) {
        if (settlementViolation) return false;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageData storage s = SSVStorage.load();

        if (sp.daoValidatorCount != expectedCountedValidators) return false;
        if (s.operators[op1].validatorCount != expectedCountedValidators) return false;
        if (s.operators[op2].validatorCount != expectedCountedValidators) return false;
        if (s.operators[op3].validatorCount != expectedCountedValidators) return false;
        if (s.operators[op4].validatorCount != expectedCountedValidators) return false;

        return true;
    }

    function echidna_legacy_ssv_cluster_hash_matches_model() external view returns (bool) {
        if (settlementViolation) return false;

        StorageData storage s = SSVStorage.load();
        if (s.clusters[activeClusterId] != activeClusterModel.hashClusterData()) return false;
        if (s.clusters[liquidatedClusterId] != liquidatedClusterModel.hashClusterData()) return false;
        return true;
    }

    function echidna_legacy_ssv_validator_storage_matches_model() external view returns (bool) {
        if (!_validatorStorageMatches(1, address(activeOwner), activeValidatorPresent[1])) return false;
        if (!_validatorStorageMatches(2, address(activeOwner), activeValidatorPresent[2])) return false;
        if (!_validatorStorageMatches(1, address(liquidatedOwner), liquidatedValidatorPresent[1])) return false;
        if (!_validatorStorageMatches(2, address(liquidatedOwner), liquidatedValidatorPresent[2])) return false;
        if (_presentActiveValidatorCount() != activeClusterModel.validatorCount) return false;
        if (_presentLiquidatedValidatorCount() != liquidatedClusterModel.validatorCount) return false;
        return true;
    }

    function _postRemovalMatches(
        bytes32 targetClusterId,
        ISSVNetworkCore.Cluster memory expectedAfter,
        uint32 expectedCountAfter,
        bytes32 firstHash,
        bytes32 secondHash
    ) internal view returns (bool) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageData storage s = SSVStorage.load();

        if (sp.daoValidatorCount != expectedCountAfter) return false;
        if (s.operators[op1].validatorCount != expectedCountAfter) return false;
        if (s.operators[op2].validatorCount != expectedCountAfter) return false;
        if (s.operators[op3].validatorCount != expectedCountAfter) return false;
        if (s.operators[op4].validatorCount != expectedCountAfter) return false;
        if (s.clusters[targetClusterId] != expectedAfter.hashClusterData()) return false;
        if (s.validatorPKs[firstHash] != bytes32(0)) return false;
        if (secondHash != bytes32(0) && s.validatorPKs[secondHash] != bytes32(0)) return false;

        return true;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.networkFee = PackedSSV.wrap(DEFAULT_NETWORK_SSV_FEE);
        sp.networkFeeIndex = 0;
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.daoBalance = PACKED_SSV_ZERO;
        sp.daoIndexBlockNumber = uint32(block.number);
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();
        op1 = _createOperator(s, bytes32(uint256(0x101)));
        op2 = _createOperator(s, bytes32(uint256(0x102)));
        op3 = _createOperator(s, bytes32(uint256(0x103)));
        op4 = _createOperator(s, bytes32(uint256(0x104)));

        operatorIds.push(op1);
        operatorIds.push(op2);
        operatorIds.push(op3);
        operatorIds.push(op4);
    }

    function _initActiveLegacySsvCluster() internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        activeClusterId = keccak256(abi.encodePacked(address(activeOwner), operatorIds));
        token.mint(address(this), INITIAL_SSV_BALANCE);

        activeClusterModel = ISSVNetworkCore.Cluster({
            validatorCount: INITIAL_VALIDATOR_COUNT,
            networkFeeIndex: sp.currentNetworkFeeIndexSSV(),
            index: _currentClusterIndexSsv(),
            active: true,
            balance: INITIAL_SSV_BALANCE
        });

        s.clusters[activeClusterId] = activeClusterModel.hashClusterData();
        sp.updateDAOSSV(true, INITIAL_VALIDATOR_COUNT);

        s.operators[op1].validatorCount = INITIAL_VALIDATOR_COUNT;
        s.operators[op2].validatorCount = INITIAL_VALIDATOR_COUNT;
        s.operators[op3].validatorCount = INITIAL_VALIDATOR_COUNT;
        s.operators[op4].validatorCount = INITIAL_VALIDATOR_COUNT;

        ValidatorLib.registerPublicKey(_validatorKey(1), _operatorIds(), address(activeOwner), s);
        ValidatorLib.registerPublicKey(_validatorKey(2), _operatorIds(), address(activeOwner), s);
        activeValidatorPresent[1] = true;
        activeValidatorPresent[2] = true;

        expectedCountedValidators = INITIAL_VALIDATOR_COUNT;
    }

    function _initLiquidatedLegacySsvCluster() internal {
        StorageData storage s = SSVStorage.load();

        liquidatedClusterId = keccak256(abi.encodePacked(address(liquidatedOwner), operatorIds));
        liquidatedClusterModel = ISSVNetworkCore.Cluster({
            validatorCount: INITIAL_VALIDATOR_COUNT,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        s.clusters[liquidatedClusterId] = liquidatedClusterModel.hashClusterData();

        ValidatorLib.registerPublicKey(_validatorKey(1), _operatorIds(), address(liquidatedOwner), s);
        ValidatorLib.registerPublicKey(_validatorKey(2), _operatorIds(), address(liquidatedOwner), s);
        liquidatedValidatorPresent[1] = true;
        liquidatedValidatorPresent[2] = true;
    }

    function _createOperator(StorageData storage s, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PackedSSV.wrap(DEFAULT_OPERATOR_SSV_FEE),
            owner: address(this),
            snapshot: ISSVNetworkCore.Snapshot({
                block: uint32(block.number),
                index: 0,
                balance: PACKED_SSV_ZERO
            }),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: PackedETH.wrap(0),
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: 0, index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _currentClusterIndexSsv() internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;

        for (uint256 i; i < operatorIds.length; ++i) {
            ISSVNetworkCore.Operator storage op = s.operators[operatorIds[i]];
            uint64 index = op.snapshot.index;
            if (op.snapshot.block != 0) {
                index += uint64(uint32(block.number) - op.snapshot.block) * DEFAULT_OPERATOR_SSV_FEE;
            }
            clusterIndex += index;
        }
        return clusterIndex;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _operatorIds() internal view returns (uint64[] memory ids) {
        ids = new uint64[](operatorIds.length);
        for (uint256 i; i < operatorIds.length; ++i) {
            ids[i] = operatorIds[i];
        }
    }

    function _settledActiveCluster(ISSVNetworkCore.Cluster memory clusterBefore)
        internal
        view
        returns (ISSVNetworkCore.Cluster memory expectedAfter)
    {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        expectedAfter = clusterBefore;
        uint64 clusterIndex = _currentClusterIndexSsv();
        uint64 currentNetworkFeeIndexSSV = sp.currentNetworkFeeIndexSSV();
        expectedAfter.updateBalanceSSV(clusterIndex, currentNetworkFeeIndexSSV);
        expectedAfter.index = clusterIndex;
        expectedAfter.networkFeeIndex = currentNetworkFeeIndexSSV;
    }

    function _pickPresentActiveValidator(uint256 seed) internal view returns (uint8) {
        return _pickPresentValidator(seed, activeValidatorPresent);
    }

    function _pickPresentLiquidatedValidator(uint256 seed) internal view returns (uint8) {
        return _pickPresentValidator(seed, liquidatedValidatorPresent);
    }

    function _pickPresentValidator(uint256 seed, mapping(uint8 => bool) storage present) internal view returns (uint8) {
        uint8 first = uint8((seed % 2) + 1);
        if (present[first]) return first;

        uint8 second = first == 1 ? 2 : 1;
        if (present[second]) return second;

        return 0;
    }

    function _presentActiveValidatorCount() internal view returns (uint32 count) {
        if (activeValidatorPresent[1]) count++;
        if (activeValidatorPresent[2]) count++;
    }

    function _presentLiquidatedValidatorCount() internal view returns (uint32 count) {
        if (liquidatedValidatorPresent[1]) count++;
        if (liquidatedValidatorPresent[2]) count++;
    }

    function _validatorHash(uint8 tag, address owner) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_validatorKey(tag), owner));
    }

    function _validatorStorageMatches(uint8 tag, address owner, bool present) internal view returns (bool) {
        bytes32 stored = SSVStorage.load().validatorPKs[_validatorHash(tag, owner)];
        if (present) return stored != bytes32(0);
        return stored == bytes32(0);
    }

    function _validatorKey(uint8 tag) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(0xA000 + tag)), bytes16(uint128(0xB000 + tag)));
    }
}
