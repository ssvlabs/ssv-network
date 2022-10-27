// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/Types.sol";

import "hardhat/console.sol";

contract SSVNetwork is OwnableUpgradeable, ISSVNetwork {
    using Types256 for uint256;
    using Types64 for uint64;

    using Counters for Counters.Counter;

    struct Snapshot {
        /// @dev block is the last block in which last index was set
        uint64 block;
        /// @dev index is the last index calculated by index += (currentBlock - block) * fee
        uint64 index;
        /// @dev accumulated is all the accumulated earnings, calculated by accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    struct Operator {
        address owner;
        uint64 fee;
        uint64 validatorCount;

        Snapshot snapshot;
    }

    struct OperatorFeeChangeRequest {
        uint64 fee;
        uint64 approvalBeginTime;
        uint64 approvalEndTime;
    }

    struct DAO {
        uint64 validatorCount;
        uint64 withdrawn;

        Snapshot earnings;
    }

    struct Cluster {
        uint64[] operatorIds;
    }

    struct Pod {
        uint64 validatorCount;
        uint64 networkFee;
        uint64 networkFeeIndex;
        Snapshot usage;
        bool disabled;
    }

    struct Validator {
        bytes32 clusterId;
        address owner;
        bool active;
    }

    // global vars
    Counters.Counter private lastOperatorId;
    Counters.Counter private lastPodId;

    // operator vars
    mapping(uint64 => Operator) private _operators;
    mapping(uint64 => OperatorFeeChangeRequest) private _operatorFeeChangeRequests;
    mapping(bytes32 => Cluster) private _clusters;
    mapping(bytes32 => Pod) private _pods;
    mapping(bytes32 => Validator) _validatorPKs;

    uint64 private _networkFee;
    uint64 private _networkFeeIndex;
    uint64 private _networkFeeIndexBlockNumber;

    uint64 private _declareOperatorFeePeriod;
    uint64 private _executeOperatorFeePeriod;
    uint64 private _operatorMaxFeeIncrease;

    uint64 constant LIQUIDATION_MIN_BLOCKS = 50;
    uint64 constant MINIMAL_OPERATOR_FEE = 100000000;

    // uint64 constant NETWORK_FEE_PER_BLOCK = 1;


    DAO private _dao;
    IERC20 private _token;

    function initialize(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) external override {
        __SSVNetwork_init(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) internal onlyInitializing {
        _token = token_;
        _updateOperatorFeeIncreaseLimit(operatorMaxFeeIncrease_);
        _updateDeclareOperatorFeePeriod(declareOperatorFeePeriod_);
        _updateExecuteOperatorFeePeriod(executeOperatorFeePeriod_);
    }

    modifier onlyOperatorOwnerOrContractOwner(uint64 operatorId) {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        _;
    }

    function registerOperator(
        bytes calldata encryptionPK,
        uint256 fee
    ) external returns (uint64 id) {
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        _operators[id] = Operator({ owner: msg.sender, snapshot: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee.shrink()});
        emit OperatorAdded(id, msg.sender, encryptionPK, fee.shrinkable());
    }

    function removeOperator(uint64 operatorId) external {
        Operator memory operator = _operators[operatorId];
        if (operator.owner != msg.sender) revert CallerNotOwner();

        // TODO withdraw remaining balance before delete

        delete _operators[operatorId];
        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) onlyOperatorOwnerOrContractOwner(operatorId) external {
        Operator memory operator = _operators[operatorId];

        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = operator.fee * (10000 + _operatorMaxFeeIncrease) / 10000;
        if (fee.shrink() > maxAllowedFee) {
            revert FeeExceedsIncreaseLimit();
        }

        _operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            fee.shrink(),
            uint64(block.timestamp) + _declareOperatorFeePeriod,
            uint64(block.timestamp) + _declareOperatorFeePeriod + _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclaration(msg.sender, operatorId, block.number, fee.shrinkable());
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        delete _operatorFeeChangeRequests[operatorId];

        emit DeclaredOperatorFeeCancelation(msg.sender, operatorId);
    }

    function executeOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        delete _operatorFeeChangeRequests[operatorId];
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view returns (uint256, uint256, uint256) {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        return (feeChangeRequest.fee.expand(), feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    function getOperatorFee(uint64 operatorId) external view returns (uint256) {
        Operator memory operator = _operators[operatorId];

        if (operator.owner == address(0)) revert OperatorNotFound();

        return operator.fee.expand();
    }

    function registerValidator(
        bytes calldata publicKey,
        bytes32 clusterId,
        bytes calldata shares
    ) external {
        _validateClusterId(clusterId);
        _validatePublicKey(publicKey);

        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;

        // Operator[] memory operators;
        bytes32 hashedValidator = keccak256(publicKey);
        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        {
            Pod memory pod;

            pod = _updatePodData(clusterId, 0, hashedPod, true);

            {
                for (uint64 i = 0; i < operatorIds.length; ++i) {
                    Operator memory operator = _operators[operatorIds[i]];
                    if (!pod.disabled) {
                        operator.snapshot = _getSnapshot(operator, uint64(block.number));
                        ++operator.validatorCount;
                        _operators[operatorIds[i]] = operator;
                    }
                }
            }

            {
                if (!pod.disabled) {
                    DAO memory dao = _dao;
                    dao = _updateDAOEarnings(dao);
                    ++dao.validatorCount;
                    _dao = dao;
                }
            }

            if (_liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(clusterId)), pod.validatorCount, operatorIds)) {
                revert NotEnoughBalance();
            }

            _pods[hashedPod] = pod;
        }

        if (_validatorPKs[hashedValidator].clusterId > 0) {
            revert ValidatorAlreadyExists();
        }
        _validatorPKs[hashedValidator] = Validator({ owner: msg.sender, clusterId: clusterId, active: true});

        emit ValidatorAdded(publicKey, clusterId, shares);
    }

    function transferValidator(
        bytes calldata publicKey,
        bytes32 newClusterId,
        bytes calldata shares
    ) external {
        _validateClusterId(newClusterId);
        _validatePublicKey(publicKey);
    
        uint64[] memory operatorIds = _clusters[newClusterId].operatorIds;

        bytes32 hashedValidator = keccak256(publicKey);
        bytes32 clusterId = _validatorPKs[hashedValidator].clusterId;

        if (_validatorPKs[hashedValidator].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        {
            bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
            _pods[hashedPod] = _updatePodData(clusterId, 0, hashedPod, false);
            // if (pod.validatorCount == 0) {
            // _availableBalances[msg.sender] += _ownerPodBalance(pod, podIndex);
            // pod.usage.balance -= _ownerPodBalance(pod, podIndex);
            // }
        }

        {
            _updateOperatorsValidatorMove(_clusters[clusterId].operatorIds, operatorIds, 1);
        }

        {
            Pod memory pod;
            {
                bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, newClusterId));

                pod = _updatePodData(newClusterId, 0, hashedPod, true);
                _validatorPKs[hashedValidator].clusterId = newClusterId;
                _pods[hashedPod] = pod;
            }

            {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                _dao = dao;
            }

            if (_liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(newClusterId)), pod.validatorCount, operatorIds)) {
                revert NotEnoughBalance();
            }

            emit ValidatorTransferred(publicKey, newClusterId, shares);
        }
    }

    function removeValidator(
        bytes calldata publicKey
    ) external {
        _validatePublicKey(publicKey);

        bytes32 hashedValidator = keccak256(publicKey);
        if (_validatorPKs[hashedValidator].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        bytes32 clusterId = _validatorPKs[hashedValidator].clusterId;
        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));

        {
            _pods[hashedPod] = _updatePodData(clusterId, 0, hashedPod, false);

            Cluster memory cluster = _clusters[clusterId];

            for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
                uint64 id = cluster.operatorIds[i];
                _operators[id].snapshot = _getSnapshot(_operators[id], uint64(block.number));
                --_operators[id].validatorCount;
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }
        }

        delete _validatorPKs[hashedValidator];

        emit ValidatorRemoved(publicKey, clusterId);
    }

    function deposit(address owner, bytes32 clusterId, uint256 amount) external {
        _validateClusterId(clusterId);
        _deposit(owner, clusterId, amount.shrink());
    }

    function deposit(bytes32 clusterId, uint256 amount) external {
        _validateClusterId(clusterId);
        _deposit(msg.sender, clusterId, amount.shrink());
    }

    function getClusterId(uint64[] memory operatorIds) external view returns(bytes32) {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {
            revert ClusterNotExists();
        }

        return clusterId;
    }

    function registerPod(uint64[] memory operatorIds, uint256 amount) external {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {
            _createClusterUnsafe(clusterId, operatorIds);
        }

        _deposit(msg.sender, clusterId, amount.shrink());
    }

    function liquidate(address ownerAddress, bytes32 clusterId) external {
        _validateClusterId(clusterId);

        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;
        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        {
            Pod memory pod = _pods[hashedPod];

            if (!_liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(clusterId)), pod.validatorCount, operatorIds)) {
                revert PodNotLiquidatable();
            }

            for (uint64 index = 0; index < operatorIds.length; ++index) {
                _operators[operatorIds[index]].validatorCount -= pod.validatorCount;
            }

            _dao.validatorCount -= pod.validatorCount;
        }

        // _token.transfer(msg.sender, pod.usage.balance);

        _pods[hashedPod].disabled = true;

        emit PodLiquidated(ownerAddress, clusterId);
    }

    function isLiquidatable(address ownerAddress, bytes32 clusterId) external view override returns (bool) {
        _validateClusterId(clusterId);

        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;
        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        Pod memory pod = _pods[hashedPod];

        return _liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(clusterId)), pod.validatorCount, operatorIds);
    }

    function isLiquidated(address ownerAddress, bytes32 clusterId) external view override returns (bool) {
        _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        return _pods[hashedPod].disabled;
    }

    function reactivatePod(bytes32 clusterId, uint256 amount) external override {
         _validateClusterId(clusterId);
       
        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;
        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));

        Pod memory pod = _pods[hashedPod];

        if (!pod.disabled) {
            revert PodAlreadyEnabled();
        }

        _deposit(msg.sender, clusterId, amount.shrink());

        {
            for (uint64 index = 0; index < operatorIds.length; ++index) {
                Operator memory operator = _operators[operatorIds[index]];
                operator.snapshot = _getSnapshot(operator, uint64(block.number));
                operator.validatorCount += pod.validatorCount;
                _operators[operatorIds[index]] = operator;
            }
        }

        {
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount += pod.validatorCount;
            _dao = dao;
        }

        pod.disabled = false;

        if(_liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(clusterId)), pod.validatorCount, operatorIds)) {
            revert NotEnoughBalance();
        }

        _pods[hashedPod] = pod;

        emit PodEnabled(msg.sender, clusterId);
    }

    function bulkTransferValidators(
        bytes[] calldata publicKeys,
        bytes32 fromClusterId,
        bytes32 toClusterId,
        bytes[] calldata shares
    ) external {
        _validateClusterId(fromClusterId);
        _validateClusterId(toClusterId);

        if (publicKeys.length != shares.length) {
            revert ParametersMismatch();
        }

        uint64 activeValidatorCount = 0;

        for (uint64 index = 0; index < publicKeys.length; ++index) {
            _validatePublicKey(publicKeys[index]);

            bytes32 hashedValidator = keccak256(publicKeys[index]);
            Validator memory validator = _validatorPKs[hashedValidator];

            if (validator.owner != msg.sender) {
                revert ValidatorNotOwned();
            }

            validator.clusterId = toClusterId;
            _validatorPKs[hashedValidator] = validator;

            if (validator.active) {
                ++activeValidatorCount;
            }
            // Changing to a single event reducing by 15K gas
        }
        emit BulkValidatorTransferred(publicKeys, toClusterId, shares);

        uint64[] memory oldOperatorIds = _clusters[fromClusterId].operatorIds;
        uint64[] memory newOperatorIds = _clusters[toClusterId].operatorIds;

        if (oldOperatorIds.length == 0 || newOperatorIds.length == 0) {
            revert InvalidCluster();
        }

        _updateOperatorsValidatorMove(oldOperatorIds, newOperatorIds, activeValidatorCount);

        Pod memory pod = _pods[keccak256(abi.encodePacked(msg.sender, fromClusterId))];
        uint64 podIndex = _clusterCurrentIndex(fromClusterId);
        pod.usage.balance = _podBalance(pod, podIndex);
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);
        pod.validatorCount -= activeValidatorCount;

        pod = _pods[keccak256(abi.encodePacked(msg.sender, toClusterId))];
        podIndex = _clusterCurrentIndex(toClusterId);
        pod.usage.balance = _podBalance(pod, podIndex);
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);
        pod.validatorCount += activeValidatorCount;

        if (_liquidatable(pod.disabled, _podBalance(pod, podIndex), pod.validatorCount, newOperatorIds)) {
            revert PodLiquidatable();
        }
    }

    // TODO add external functions below to interface

    // @dev external dao functions

    function getOperatorFeeIncreaseLimit() external view returns (uint64) {
        return _operatorMaxFeeIncrease;
    }

    function getExecuteOperatorFeePeriod() external view returns (uint64) {
        return _executeOperatorFeePeriod;
    }

    function getDeclaredOperatorFeePeriod() external view returns (uint64) {
        return _declareOperatorFeePeriod;
    }

    function getNetworkFee() external view returns (uint256) {
        return _networkFee.expand();
    }

    function getNetworkBalance() external onlyOwner view returns (uint256) {
        DAO memory dao = _dao;
        return _networkBalance(dao).expand();
    }

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external onlyOwner {
        _updateOperatorFeeIncreaseLimit(newOperatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external onlyOwner {
        _updateDeclareOperatorFeePeriod(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external onlyOwner {
        _updateExecuteOperatorFeePeriod(newExecuteOperatorFeePeriod);
    }

    function updateNetworkFee(uint256 fee) external onlyOwner {
        DAO memory dao = _dao;
        dao = _updateDAOEarnings(dao);
        _dao = dao;

        _updateNetworkFeeIndex();

        emit NetworkFeeUpdate(_networkFee.expand(), fee);

        _networkFee = fee.shrink();
    }

    function withdrawDAOEarnings(uint256 amount) external onlyOwner {
        DAO memory dao = _dao;

        if(amount.shrink() > _networkBalance(dao)) {
            revert NotEnoughBalance();
        }

        dao.withdrawn += amount.shrink();
        _dao = dao;

        _token.transfer(msg.sender, amount);

        emit NetworkFeesWithdrawal(amount, msg.sender);
    }

    // @dev external operators functions

    function operatorSnapshot(uint64 id) external view returns (uint64 currentBlock, uint64 index, uint256 balance) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return (s.block, s.index, s.balance.expand());
    }

    // @dev internal dao functions

    function _updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) private {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;

        emit OperatorFeeIncreaseLimitUpdate(_operatorMaxFeeIncrease);

    }

    function _updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) private {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;

        emit DeclareOperatorFeePeriodUpdate(newDeclareOperatorFeePeriod);
    }

    function _updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) private {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;

        emit ExecuteOperatorFeePeriodUpdate(newExecuteOperatorFeePeriod);
    }

    // @dev internal operators functions

    function _getSnapshot(Operator memory operator, uint64 currentBlock) private pure returns (Snapshot memory) {
        uint64 blockDiffFee = (currentBlock - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = currentBlock;

        return operator.snapshot;
    }

    function _updateOperatorsValidatorMove(
        uint64[] memory oldOperatorIds,
        uint64[] memory newOperatorIds,
        uint64 validatorCount
    ) private {
        uint64 oldIndex;
        uint64 newIndex;
        uint64 currentBlock = uint64(block.number);

        while (oldIndex < oldOperatorIds.length && newIndex < newOperatorIds.length) {
            if (oldOperatorIds[oldIndex] < newOperatorIds[newIndex]) {
                Operator memory operator = _operators[oldOperatorIds[oldIndex]];
                operator.snapshot = _getSnapshot(operator, currentBlock);
                operator.validatorCount -= validatorCount;
                _operators[oldOperatorIds[oldIndex]] = operator;
                ++oldIndex;
            } else if (newOperatorIds[newIndex] < oldOperatorIds[oldIndex]) {
                Operator memory operator = _operators[newOperatorIds[newIndex]];
                operator.snapshot = _getSnapshot(operator, currentBlock);
                operator.validatorCount += validatorCount;
                _operators[newOperatorIds[newIndex]] = operator;
                ++newIndex;
            } else {
                ++oldIndex;
                ++newIndex;
            }
        }

        while (oldIndex < oldOperatorIds.length) {
            Operator memory operator = _operators[oldOperatorIds[oldIndex]];
            operator.snapshot = _getSnapshot(operator, currentBlock);
            operator.validatorCount -= validatorCount;
            _operators[oldOperatorIds[oldIndex]] = operator;
            ++oldIndex;
        }

        while (newIndex < newOperatorIds.length) {
            Operator memory operator = _operators[newOperatorIds[newIndex]];
            operator.snapshot = _getSnapshot(operator, currentBlock);
            operator.validatorCount += validatorCount;
            _operators[newOperatorIds[newIndex]] = operator;
            ++newIndex;
        }
    }

    function _setFee(Operator memory operator, uint64 fee) private view returns (Operator memory) {
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        operator.fee = fee;

        return operator;
    }

    function _updatePodData(bytes32 clusterId, uint64 amount, bytes32 hashedPod, bool increase) private view returns (Pod memory) {
        Pod memory pod = _pods[hashedPod];
        uint64 podIndex = _clusterCurrentIndex(clusterId);
        pod.usage.balance = _podBalance(pod, podIndex) + amount;
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);

        pod.networkFee = _podNetworkFee(pod);
        pod.networkFeeIndex = _currentNetworkFeeIndex();

        if (increase) {
            ++pod.validatorCount;
        } else {
            --pod.validatorCount;
        }

        if (pod.validatorCount == 0) {
            // _availableBalances[msg.sender] += _ownerPodBalance(pod, podIndex);
            // pod.usage.balance -= _ownerPodBalance(pod, podIndex);
        }
        return pod;
    }

    function podBalanceOf(address owner, bytes32 clusterId) external view returns (uint256) {
        Pod memory pod = _pods[keccak256(abi.encodePacked(owner, clusterId))];
        return _podBalance(pod, _clusterCurrentIndex(clusterId)).expand();
    }

    function _deposit(address owner, bytes32 clusterId, uint64 amount) private {
        Pod storage pod = _pods[keccak256(abi.encodePacked(owner, clusterId))];
        if (pod.usage.block == 0) {
            pod.usage.block = uint64(block.number);
            emit PodCreated(owner, clusterId);
        }
        if (amount > 0) {
            pod.usage.balance += amount;
        }
    }

    function _createClusterUnsafe(bytes32 key, uint64[] memory operatorIds) private {
        for (uint64 i = 0; i < operatorIds.length - 1;) {
            if (_operators[operatorIds[i]].owner == address(0)) {
                revert OperatorDoesNotExist();
            }

            require(operatorIds[i] <= operatorIds[++i]);
        }

        _clusters[key] = Cluster({operatorIds: operatorIds});

        emit ClusterCreated(key);
    }

    function _getOrCreateCluster(uint64[] memory operatorIds) private returns (bytes32) { // , Cluster memory
        bytes32 key = keccak256(abi.encodePacked(operatorIds));

        Cluster storage cluster = _clusters[key];
        if (cluster.operatorIds.length == 0) {
            _createClusterUnsafe(key, operatorIds);
        }

        return key;
    }

    function _updateDAOEarnings(DAO memory dao) private view returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao);
        dao.earnings.block = uint64(block.number);

        return dao;
    }

    function _updateNetworkFeeIndex() private {
        _networkFeeIndex = _currentNetworkFeeIndex();
        _networkFeeIndexBlockNumber = uint64(block.number);
    }

    function _currentNetworkFeeIndex() private view returns(uint64) {
        return _networkFeeIndex + uint64(block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }

    function _networkTotalEarnings(DAO memory dao) private view returns (uint64) {
        return dao.earnings.balance + (uint64(block.number) - dao.earnings.block) * _networkFee * dao.validatorCount;
    }

    function _networkBalance(DAO memory dao) private view returns (uint64) {
        return _networkTotalEarnings(dao) - dao.withdrawn;
    }

    function _clusterCurrentIndex(bytes32 podId) private view returns (uint64 podIndex) {
        Cluster memory cluster = _clusters[podId];
        uint64 currentBlock = uint64(block.number);
        for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
            Snapshot memory s = _operators[cluster.operatorIds[i]].snapshot;
            podIndex += s.index + (currentBlock - s.block) * _operators[cluster.operatorIds[i]].fee;
        }
    }

    function _podBalance(Pod memory pod, uint64 currentPodIndex) private view returns (uint64) {
        uint64 usage = (currentPodIndex - pod.usage.index) * pod.validatorCount + _podNetworkFee(pod);

        if (usage > pod.usage.balance) {
            revert NegativeBalance();
        }

        return pod.usage.balance - usage;
    }

    function _podNetworkFee(Pod memory pod) private view returns (uint64) {
        return pod.networkFee + uint64(_currentNetworkFeeIndex() - pod.networkFeeIndex) * pod.validatorCount;
    }

    function _burnRatePerValidator(uint64[] memory operatorIds) private view returns (uint64 rate) {
        for (uint64 i = 0; i < operatorIds.length; ++i) {
            rate += _operators[operatorIds[i]].fee;
        }
    }

    function _liquidatable(bool disabled, uint64 balance, uint64 validatorCount, uint64[] memory operatorIds) private view returns (bool) {
        return !disabled && balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(operatorIds) + _networkFee) * validatorCount;
    }

    function _updateOperatorFeeUnsafe(uint64 operatorId, uint64 fee) private {
        Operator memory operator = _operators[operatorId];

        _operators[operatorId] = _setFee(operator, fee);

        emit OperatorFeeExecution(msg.sender, operatorId, block.number, fee.expand());
    }

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = _operators[operatorId];

        if(operator.owner == address(0)) {
            revert OperatorWithPublicKeyNotExist();
        }

        if(msg.sender != operator.owner && msg.sender != owner()) {
            revert CallerNotOwner();
        }
    }

    function _validateClusterId(bytes32 clusterId) private view {
        if (_clusters[clusterId].operatorIds.length == 0) {
            revert ClusterNotExists();
        }
    }

    function _validatePublicKey(bytes memory publicKey) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
    }

    function _validateOperatorIds(uint64[] memory operatorIds) private pure {
        if (operatorIds.length < 4 || operatorIds.length > 13 || operatorIds.length % 3 != 1) {
            revert OperatorIdsStructureInvalid();
        }
    }
}
