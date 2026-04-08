// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVValidators.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVOperatorsWhitelist.sol";
import "../../contracts/interfaces/ISSVValidators.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/interfaces/ISSVOperatorsWhitelist.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/interfaces/external/ISSVWhitelistingContract.sol";
import "../../contracts/test/mocks/MockWhitelistingContract.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/libraries/ValidatorLib.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {
    PackedETH,
    PackedSSV,
    PACKED_ETH_ZERO,
    PACKED_SSV_ZERO,
    ETH_DEDUCTED_DIGITS,
    BPS_DENOMINATOR,
    DEFAULT_OPERATOR_ETH_FEE
} from "../../contracts/libraries/SSVCoreTypes.sol";

contract WhitelistClusterUser {
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

    function bulkRegister(
        bytes[] calldata publicKeys,
        uint64[] calldata operatorIds,
        bytes[] calldata sharesData,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        validators.bulkRegisterValidator{value: msg.value}(publicKeys, operatorIds, sharesData, cluster);
    }
}

contract WhitelistOperatorOwner {
    ISSVOperators public operators;
    ISSVOperatorsWhitelist public operatorsWhitelist;

    constructor(address target) {
        operators = ISSVOperators(target);
        operatorsWhitelist = ISSVOperatorsWhitelist(target);
    }

    function register(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64) {
        return operators.registerOperator(publicKey, fee, setPrivate);
    }

    function whitelist(uint64 operatorId, address whitelistAddress) external {
        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = operatorId;
        address[] memory whitelistAddresses = new address[](1);
        whitelistAddresses[0] = whitelistAddress;
        operatorsWhitelist.setOperatorsWhitelists(operatorIds, whitelistAddresses);
    }

    function whitelistContract(uint64 operatorId, ISSVWhitelistingContract whitelistingContract) external {
        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = operatorId;
        operatorsWhitelist.setOperatorsWhitelistingContract(operatorIds, whitelistingContract);
    }

    function reduceFee(uint64 operatorId, uint256 fee) external {
        operators.reduceOperatorFee(operatorId, fee);
    }
}

contract SSVWhitelistValidatorsEchidna is SSVValidators, SSVOperators(0), SSVOperatorsWhitelist {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using ProtocolLib for StorageProtocol;
    using Counters for Counters.Counter;

    uint256 private constant REGISTRATION_AMOUNT = 1 ether;
    uint256 private constant PUBLIC_FEE_1 = 10_000_000;
    uint256 private constant PUBLIC_FEE_2 = 20_000_000;
    uint256 private constant PUBLIC_FEE_3 = 30_000_000;
    uint256 private constant PRIVATE_FEE = 15_000_000;

    WhitelistClusterUser private eoaWhitelistedUser;
    WhitelistClusterUser private eoaWhitelistedBulkUser;
    WhitelistClusterUser private contractWhitelistedUser;
    WhitelistClusterUser private contractWhitelistedBulkUser;
    WhitelistClusterUser private attacker;

    WhitelistOperatorOwner private publicOwner1;
    WhitelistOperatorOwner private publicOwner2;
    WhitelistOperatorOwner private publicOwner3;
    WhitelistOperatorOwner private privateZeroOwner;
    WhitelistOperatorOwner private privateFeeOwner;
    WhitelistOperatorOwner private legacyOwner;

    MockWhitelistingContract private mockWhitelistContract;

    uint64 private publicOp1;
    uint64 private publicOp2;
    uint64 private publicOp3;
    uint64 private privateZeroOp;
    uint64 private privateFeeOp;
    uint64 private legacyPrivateOp;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        uint8 scenario;
        bool exists;
    }

    bytes32[] private clusterIds;
    mapping(bytes32 => ClusterRecord) private clusters;
    mapping(uint64 => uint32) private expectedOperatorEthValidators;

    uint256 private totalExpectedBalance;
    uint32 private expectedTotalValidators;
    bool private unauthorizedPrivateRegistrationSucceeded;
    bool private mixedZeroFeeViolation;
    bool private contractWhitelistViolation;
    bool private legacyWhitelistViolation;
    bool private legacyFeePrepared;
    bool private mixedZeroScenarioDone;
    bool private contractWhitelistScenarioDone;
    bool private legacyScenarioDone;
    bool private mixedZeroBulkScenarioDone;
    bool private contractWhitelistBulkScenarioDone;
    bool private legacyBulkScenarioDone;
    uint256 private nextPkNonce;

    constructor() {
        ISSVValidators validatorsSelf = ISSVValidators(address(this));

        eoaWhitelistedUser = new WhitelistClusterUser(validatorsSelf);
        eoaWhitelistedBulkUser = new WhitelistClusterUser(validatorsSelf);
        contractWhitelistedUser = new WhitelistClusterUser(validatorsSelf);
        contractWhitelistedBulkUser = new WhitelistClusterUser(validatorsSelf);
        attacker = new WhitelistClusterUser(validatorsSelf);

        publicOwner1 = new WhitelistOperatorOwner(address(this));
        publicOwner2 = new WhitelistOperatorOwner(address(this));
        publicOwner3 = new WhitelistOperatorOwner(address(this));
        privateZeroOwner = new WhitelistOperatorOwner(address(this));
        privateFeeOwner = new WhitelistOperatorOwner(address(this));
        legacyOwner = new WhitelistOperatorOwner(address(this));

        address[] memory initialWhitelisted = new address[](1);
        initialWhitelisted[0] = address(contractWhitelistedUser);
        mockWhitelistContract = new MockWhitelistingContract(initialWhitelisted);
        mockWhitelistContract.setWhitelistedAddress(address(contractWhitelistedBulkUser));

        _initProtocolDefaults();
        _initOperators();
    }

    receive() external payable {}

    function action_fund(uint256 amount) external payable {
        amount;
    }

    function action_register_mixed_zero_fee_authorized(uint256 seed) external {
        seed;
        if (mixedZeroScenarioDone) return;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;

        uint64[] memory operatorIds = _mixedZeroFeeOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(eoaWhitelistedUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        bytes memory publicKey = _newPublicKey();
        bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, address(eoaWhitelistedUser)));
        bytes memory shares = _makeShares(nextPkNonce);

        try eoaWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            _recordRegistration(clusterId, address(eoaWhitelistedUser), 0, cluster, REGISTRATION_AMOUNT, operatorIds);
            mixedZeroScenarioDone = true;
            if (!_validatorStoredActive(validatorKey, operatorIds)) mixedZeroFeeViolation = true;
            if (PackedETH.unwrap(SSVStorage.load().operators[privateZeroOp].ethFee) != 0) mixedZeroFeeViolation = true;
        } catch {
            mixedZeroFeeViolation = true;
        }
    }

    function action_register_mixed_zero_fee_unauthorized(uint256 seed) external {
        seed;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;

        uint64[] memory operatorIds = _mixedZeroFeeOperatorIds();
        bytes memory publicKey = _newPublicKey();
        bytes memory shares = _makeShares(nextPkNonce);
        ISSVNetworkCore.Cluster memory cluster = _defaultCluster();

        try contractWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function action_bulk_register_mixed_zero_fee_authorized(uint256 seed) external {
        if (mixedZeroBulkScenarioDone) return;

        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;

        uint64[] memory operatorIds = _mixedZeroFeeOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(eoaWhitelistedBulkUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        (bytes[] memory publicKeys, bytes[] memory sharesData, bytes32[] memory validatorKeys) =
            _newBulkPayload(batchSize, address(eoaWhitelistedBulkUser));

        try eoaWhitelistedBulkUser.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, cluster) {
            _recordBulkRegistration(clusterId, address(eoaWhitelistedBulkUser), 0, cluster, amount, operatorIds, uint32(batchSize));
            mixedZeroBulkScenarioDone = true;
            if (!_validatorsStoredActive(validatorKeys, operatorIds)) mixedZeroFeeViolation = true;
            if (PackedETH.unwrap(SSVStorage.load().operators[privateZeroOp].ethFee) != 0) mixedZeroFeeViolation = true;
        } catch {
            mixedZeroFeeViolation = true;
        }
    }

    function action_bulk_register_mixed_zero_fee_unauthorized(uint256 seed) external {
        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;

        uint64[] memory operatorIds = _mixedZeroFeeOperatorIds();
        (bytes[] memory publicKeys, bytes[] memory sharesData,) = _newBulkPayload(batchSize, address(attacker));

        try attacker.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, _defaultCluster()) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function action_register_contract_whitelist_authorized(uint256 seed) external {
        seed;
        if (contractWhitelistScenarioDone) return;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;

        uint64[] memory operatorIds = _contractWhitelistOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(contractWhitelistedUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        bytes memory publicKey = _newPublicKey();
        bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, address(contractWhitelistedUser)));
        bytes memory shares = _makeShares(nextPkNonce);

        try contractWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            _recordRegistration(clusterId, address(contractWhitelistedUser), 1, cluster, REGISTRATION_AMOUNT, operatorIds);
            contractWhitelistScenarioDone = true;
            if (!_validatorStoredActive(validatorKey, operatorIds)) contractWhitelistViolation = true;
            if (PackedETH.unwrap(SSVStorage.load().operators[privateFeeOp].ethFee) == 0) contractWhitelistViolation = true;
        } catch {
            contractWhitelistViolation = true;
        }
    }

    function action_register_contract_whitelist_unauthorized(uint256 seed) external {
        seed;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;

        uint64[] memory operatorIds = _contractWhitelistOperatorIds();
        bytes memory publicKey = _newPublicKey();
        bytes memory shares = _makeShares(nextPkNonce);
        ISSVNetworkCore.Cluster memory cluster = _defaultCluster();

        try eoaWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function action_bulk_register_contract_whitelist_authorized(uint256 seed) external {
        if (contractWhitelistBulkScenarioDone) return;

        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;

        uint64[] memory operatorIds = _contractWhitelistOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(contractWhitelistedBulkUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        (bytes[] memory publicKeys, bytes[] memory sharesData, bytes32[] memory validatorKeys) =
            _newBulkPayload(batchSize, address(contractWhitelistedBulkUser));

        try contractWhitelistedBulkUser.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, cluster) {
            _recordBulkRegistration(clusterId, address(contractWhitelistedBulkUser), 1, cluster, amount, operatorIds, uint32(batchSize));
            contractWhitelistBulkScenarioDone = true;
            if (!_validatorsStoredActive(validatorKeys, operatorIds)) contractWhitelistViolation = true;
            if (PackedETH.unwrap(SSVStorage.load().operators[privateFeeOp].ethFee) == 0) contractWhitelistViolation = true;
        } catch {
            contractWhitelistViolation = true;
        }
    }

    function action_bulk_register_contract_whitelist_unauthorized(uint256 seed) external {
        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;

        uint64[] memory operatorIds = _contractWhitelistOperatorIds();
        (bytes[] memory publicKeys, bytes[] memory sharesData,) = _newBulkPayload(batchSize, address(attacker));

        try attacker.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, _defaultCluster()) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function action_register_legacy_private_authorized(uint256 seed) external {
        seed;
        if (legacyScenarioDone) return;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;
        if (!_prepareLegacyPrivateZeroFee()) return;

        uint64[] memory operatorIds = _legacyPrivateOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(eoaWhitelistedUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        bytes memory publicKey = _newPublicKey();
        bytes32 validatorKey = keccak256(abi.encodePacked(publicKey, address(eoaWhitelistedUser)));
        bytes memory shares = _makeShares(nextPkNonce);

        try eoaWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            _recordRegistration(clusterId, address(eoaWhitelistedUser), 2, cluster, REGISTRATION_AMOUNT, operatorIds);
            legacyScenarioDone = true;
            ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[legacyPrivateOp];
            if (!_validatorStoredActive(validatorKey, operatorIds)) legacyWhitelistViolation = true;
            if (operator.ethSnapshot.block == 0) legacyWhitelistViolation = true;
            if (PackedETH.unwrap(operator.ethFee) != 0) legacyWhitelistViolation = true;
        } catch {
            legacyWhitelistViolation = true;
        }
    }

    function action_register_legacy_private_unauthorized(uint256 seed) external {
        seed;
        uint256 available = _availableBalance();
        if (available < REGISTRATION_AMOUNT) return;
        if (!_prepareLegacyPrivateZeroFee()) return;

        uint64[] memory operatorIds = _legacyPrivateOperatorIds();
        bytes memory publicKey = _newPublicKey();
        bytes memory shares = _makeShares(nextPkNonce);
        ISSVNetworkCore.Cluster memory cluster = _defaultCluster();

        try contractWhitelistedUser.register{value: REGISTRATION_AMOUNT}(publicKey, operatorIds, shares, cluster) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function action_bulk_register_legacy_private_authorized(uint256 seed) external {
        if (legacyBulkScenarioDone) return;

        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;
        if (!_prepareLegacyPrivateZeroFee()) return;

        uint64[] memory operatorIds = _legacyPrivateOperatorIds();
        bytes32 clusterId = keccak256(abi.encodePacked(address(eoaWhitelistedBulkUser), operatorIds));
        ISSVNetworkCore.Cluster memory cluster = _getClusterForRegistration(clusterId);
        (bytes[] memory publicKeys, bytes[] memory sharesData, bytes32[] memory validatorKeys) =
            _newBulkPayload(batchSize, address(eoaWhitelistedBulkUser));

        try eoaWhitelistedBulkUser.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, cluster) {
            _recordBulkRegistration(clusterId, address(eoaWhitelistedBulkUser), 2, cluster, amount, operatorIds, uint32(batchSize));
            legacyBulkScenarioDone = true;
            ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[legacyPrivateOp];
            if (!_validatorsStoredActive(validatorKeys, operatorIds)) legacyWhitelistViolation = true;
            if (operator.ethSnapshot.block == 0) legacyWhitelistViolation = true;
            if (PackedETH.unwrap(operator.ethFee) != 0) legacyWhitelistViolation = true;
        } catch {
            legacyWhitelistViolation = true;
        }
    }

    function action_bulk_register_legacy_private_unauthorized(uint256 seed) external {
        uint256 batchSize = _bulkBatchSize(seed);
        uint256 amount = batchSize * REGISTRATION_AMOUNT;
        uint256 available = _availableBalance();
        if (available < amount) return;
        if (!_prepareLegacyPrivateZeroFee()) return;

        uint64[] memory operatorIds = _legacyPrivateOperatorIds();
        (bytes[] memory publicKeys, bytes[] memory sharesData,) = _newBulkPayload(batchSize, address(attacker));

        try attacker.bulkRegister{value: amount}(publicKeys, operatorIds, sharesData, _defaultCluster()) {
            unauthorizedPrivateRegistrationSucceeded = true;
        } catch {}
    }

    function echidna_private_registration_access_control() external view returns (bool) {
        return !unauthorizedPrivateRegistrationSucceeded;
    }

    function echidna_private_authorized_paths_consistent() external view returns (bool) {
        return !mixedZeroFeeViolation && !contractWhitelistViolation;
    }

    function echidna_legacy_private_eth_init_preserves_whitelist() external view returns (bool) {
        return !legacyWhitelistViolation;
    }

    function echidna_whitelist_operator_counts_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (s.operators[publicOp1].ethValidatorCount != expectedOperatorEthValidators[publicOp1]) return false;
        if (s.operators[publicOp2].ethValidatorCount != expectedOperatorEthValidators[publicOp2]) return false;
        if (s.operators[publicOp3].ethValidatorCount != expectedOperatorEthValidators[publicOp3]) return false;
        if (s.operators[privateZeroOp].ethValidatorCount != expectedOperatorEthValidators[privateZeroOp]) return false;
        if (s.operators[privateFeeOp].ethValidatorCount != expectedOperatorEthValidators[privateFeeOp]) return false;
        if (s.operators[legacyPrivateOp].ethValidatorCount != expectedOperatorEthValidators[legacyPrivateOp]) return false;

        if (sp.ethDaoValidatorCount != expectedTotalValidators) return false;
        if (sp.daoTotalEthVUnits != uint64(expectedTotalValidators) * BPS_DENOMINATOR) return false;
        return true;
    }

    function echidna_whitelist_cluster_hashes_consistent() external view returns (bool) {
        StorageData storage s = SSVStorage.load();
        uint256 count = clusterIds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 clusterId = clusterIds[i];
            ClusterRecord storage record = clusters[clusterId];
            if (!record.exists) return false;
            if (record.owner == address(0)) return false;
            if (s.ethClusters[clusterId] != record.cluster.hashClusterData()) return false;
        }

        uint64[] memory mixedZeroOperatorIds = _mixedZeroFeeOperatorIds();
        bytes32 eoaMixedClusterId = keccak256(abi.encodePacked(address(contractWhitelistedUser), mixedZeroOperatorIds));
        if (s.ethClusters[eoaMixedClusterId] != 0) return false;

        uint64[] memory contractOperatorIds = _contractWhitelistOperatorIds();
        bytes32 contractUnauthorizedClusterId = keccak256(abi.encodePacked(address(eoaWhitelistedUser), contractOperatorIds));
        if (s.ethClusters[contractUnauthorizedClusterId] != 0) return false;

        uint64[] memory legacyOperatorIds = _legacyPrivateOperatorIds();
        bytes32 legacyUnauthorizedClusterId = keccak256(abi.encodePacked(address(contractWhitelistedUser), legacyOperatorIds));
        if (s.ethClusters[legacyUnauthorizedClusterId] != 0) return false;

        return address(this).balance >= totalExpectedBalance;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 5000;
        sp.ethNetworkFee = PACKED_ETH_ZERO;
        sp.ethNetworkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = 1;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
        sp.operatorMaxFee = PackedETH.wrap(type(uint64).max);
        sp.minimumOperatorEthFee = PackedETH.wrap(uint64(PUBLIC_FEE_1));
        sp.operatorMaxFeeIncrease = 10_000;
        sp.declareOperatorFeePeriod = 1;
        sp.executeOperatorFeePeriod = 10;
    }

    function _initOperators() internal {
        publicOp1 = _createEthOperator(address(publicOwner1), _operatorPk(1), uint64(PUBLIC_FEE_1), false);
        publicOp2 = _createEthOperator(address(publicOwner2), _operatorPk(2), uint64(PUBLIC_FEE_2), false);
        publicOp3 = _createEthOperator(address(publicOwner3), _operatorPk(3), uint64(PUBLIC_FEE_3), false);

        privateZeroOp = _createEthOperator(address(privateZeroOwner), _operatorPk(4), 0, true);
        _whitelistAddress(privateZeroOp, address(eoaWhitelistedUser));
        _whitelistAddress(privateZeroOp, address(eoaWhitelistedBulkUser));

        privateFeeOp = _createEthOperator(address(privateFeeOwner), _operatorPk(5), uint64(PRIVATE_FEE), true);
        _setWhitelistingContract(privateFeeOp, address(mockWhitelistContract));

        legacyPrivateOp = _createLegacyPrivateOperator(address(legacyOwner), _operatorPk(6), 1, true);
        _setLegacyWhitelistAddress(legacyPrivateOp, address(eoaWhitelistedUser));
        _whitelistAddress(legacyPrivateOp, address(eoaWhitelistedBulkUser));
    }

    function _createEthOperator(address owner, bytes memory publicKey, uint64 ethFeeRaw, bool setPrivate)
        internal
        returns (uint64 id)
    {
        StorageData storage s = SSVStorage.load();
        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PACKED_SSV_ZERO,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: 0, index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: setPrivate,
            ethValidatorCount: 0,
            ethFee: PackedETH.wrap(ethFeeRaw),
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(publicKey)] = id;
    }

    function _createLegacyPrivateOperator(address owner, bytes memory publicKey, uint64 ssvFeeRaw, bool setPrivate)
        internal
        returns (uint64 id)
    {
        StorageData storage s = SSVStorage.load();
        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: PackedSSV.wrap(ssvFeeRaw),
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: setPrivate,
            ethValidatorCount: 0,
            ethFee: PACKED_ETH_ZERO,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: 0, index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(publicKey)] = id;
    }

    function _whitelistAddress(uint64 operatorId, address whitelistAddress) internal {
        StorageData storage s = SSVStorage.load();
        uint256 blockIndex = operatorId >> 8;
        uint256 bitPosition = operatorId & 0xFF;
        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] |= (1 << bitPosition);
    }

    function _setWhitelistingContract(uint64 operatorId, address whitelistingContract) internal {
        SSVStorage.load().operatorsWhitelist[operatorId] = whitelistingContract;
    }

    function _setLegacyWhitelistAddress(uint64 operatorId, address whitelistAddress) internal {
        SSVStorage.load().operatorsWhitelist[operatorId] = whitelistAddress;
    }

    function _recordRegistration(
        bytes32 clusterId,
        address owner,
        uint8 scenario,
        ISSVNetworkCore.Cluster memory cluster,
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

        cluster.updateClusterData(clusterId, clusterIndex, networkFeeIndex);
        cluster.validatorCount += 1;
        cluster.active = true;

        totalExpectedBalance = totalExpectedBalance - previousBalance + cluster.balance;
        _updateExpectedOperatorCounts(operatorIds);
        expectedTotalValidators += 1;

        if (!existed) {
            record.owner = owner;
            record.scenario = scenario;
            record.exists = true;
            clusterIds.push(clusterId);
        }

        record.cluster = cluster;
    }

    function _recordBulkRegistration(
        bytes32 clusterId,
        address owner,
        uint8 scenario,
        ISSVNetworkCore.Cluster memory cluster,
        uint256 amount,
        uint64[] memory operatorIds,
        uint32 validatorsAdded
    ) internal {
        ClusterRecord storage record = clusters[clusterId];
        bool existed = record.exists;
        uint256 previousBalance = existed ? record.cluster.balance : 0;

        cluster.balance += amount;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _clusterIndexFromStorage(operatorIds, s);
        uint64 networkFeeIndex = sp.currentNetworkFeeIndex();

        cluster.updateClusterData(clusterId, clusterIndex, networkFeeIndex);
        cluster.validatorCount += validatorsAdded;
        cluster.active = true;

        totalExpectedBalance = totalExpectedBalance - previousBalance + cluster.balance;
        for (uint256 i; i < validatorsAdded; ++i) {
            _updateExpectedOperatorCounts(operatorIds);
        }
        expectedTotalValidators += validatorsAdded;

        if (!existed) {
            record.owner = owner;
            record.scenario = scenario;
            record.exists = true;
            clusterIds.push(clusterId);
        }

        record.cluster = cluster;
    }

    function _updateExpectedOperatorCounts(uint64[] memory operatorIds) internal {
        uint256 len = operatorIds.length;
        for (uint256 i; i < len; ++i) {
            expectedOperatorEthValidators[operatorIds[i]] += 1;
        }
    }

    function _prepareLegacyPrivateZeroFee() internal returns (bool) {
        if (legacyFeePrepared) return true;

        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[legacyPrivateOp];
        if (operator.ethSnapshot.block != 0 && PackedETH.unwrap(operator.ethFee) == 0) {
            legacyFeePrepared = true;
            return true;
        }

        try legacyOwner.reduceFee(legacyPrivateOp, 0) {
            if (operator.ethSnapshot.block == 0) {
                legacyWhitelistViolation = true;
                return false;
            }
            if (PackedETH.unwrap(operator.ethFee) != 0) {
                legacyWhitelistViolation = true;
                return false;
            }
            legacyFeePrepared = true;
            return true;
        } catch {
            legacyWhitelistViolation = true;
            return false;
        }
    }

    function _validatorStoredActive(bytes32 validatorKey, uint64[] memory operatorIds) internal view returns (bool) {
        bytes32 stored = SSVStorage.load().validatorPKs[validatorKey];
        if (stored == bytes32(0)) return false;
        return ValidatorLib.validateCorrectState(stored, ValidatorLib.hashOperatorIds(operatorIds));
    }

    function _validatorsStoredActive(bytes32[] memory validatorKeys, uint64[] memory operatorIds) internal view returns (bool) {
        uint256 len = validatorKeys.length;
        for (uint256 i; i < len; ++i) {
            if (!_validatorStoredActive(validatorKeys[i], operatorIds)) return false;
        }
        return true;
    }

    function _getClusterForRegistration(bytes32 clusterId) internal view returns (ISSVNetworkCore.Cluster memory cluster) {
        ClusterRecord storage record = clusters[clusterId];
        if (record.exists) {
            return record.cluster;
        }
        return _defaultCluster();
    }

    function _defaultCluster() internal pure returns (ISSVNetworkCore.Cluster memory cluster) {
        return ISSVNetworkCore.Cluster({
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            active: true,
            balance: 0
        });
    }

    function _mixedZeroFeeOperatorIds() internal view returns (uint64[] memory operatorIds) {
        operatorIds = new uint64[](4);
        operatorIds[0] = publicOp1;
        operatorIds[1] = publicOp2;
        operatorIds[2] = publicOp3;
        operatorIds[3] = privateZeroOp;
    }

    function _contractWhitelistOperatorIds() internal view returns (uint64[] memory operatorIds) {
        operatorIds = new uint64[](4);
        operatorIds[0] = publicOp1;
        operatorIds[1] = publicOp2;
        operatorIds[2] = publicOp3;
        operatorIds[3] = privateFeeOp;
    }

    function _legacyPrivateOperatorIds() internal view returns (uint64[] memory operatorIds) {
        operatorIds = new uint64[](4);
        operatorIds[0] = publicOp1;
        operatorIds[1] = publicOp2;
        operatorIds[2] = publicOp3;
        operatorIds[3] = legacyPrivateOp;
    }

    function _clusterIndexFromStorage(uint64[] memory operatorIds, StorageData storage s) internal view returns (uint64) {
        uint256 len = operatorIds.length;
        uint64 clusterIndex;
        for (uint256 i; i < len; ++i) {
            ISSVNetworkCore.Operator storage operator = s.operators[operatorIds[i]];
            clusterIndex += operator.ethSnapshot.index + (uint64(block.number) - uint64(operator.ethSnapshot.block)) * PackedETH.unwrap(operator.ethFee);
        }
        return clusterIndex;
    }

    function _availableBalance() internal view returns (uint256) {
        if (address(this).balance <= totalExpectedBalance) return 0;
        return address(this).balance - totalExpectedBalance;
    }

    function _bulkBatchSize(uint256 seed) internal pure returns (uint256) {
        return 2 + (seed % 2);
    }

    function _newPublicKey() internal returns (bytes memory) {
        nextPkNonce += 1;
        return _makePublicKey(nextPkNonce);
    }

    function _newBulkPayload(uint256 batchSize, address owner)
        internal
        returns (bytes[] memory publicKeys, bytes[] memory sharesData, bytes32[] memory validatorKeys)
    {
        publicKeys = new bytes[](batchSize);
        sharesData = new bytes[](batchSize);
        validatorKeys = new bytes32[](batchSize);

        for (uint256 i; i < batchSize; ++i) {
            bytes memory publicKey = _newPublicKey();
            publicKeys[i] = publicKey;
            sharesData[i] = _makeShares(nextPkNonce);
            validatorKeys[i] = keccak256(abi.encodePacked(publicKey, owner));
        }
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

    function _operatorPk(uint256 seed) internal pure returns (bytes memory) {
        return abi.encodePacked(seed);
    }
}
