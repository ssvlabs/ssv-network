// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/Types.sol";

// import "hardhat/console.sol";

contract SSVNetwork is OwnableUpgradeable, ISSVNetwork {
    /*************/
    /* Libraries */
    /*************/

    using Types256 for uint256;
    using Types64 for uint64;

    using Counters for Counters.Counter;


    /***********/
    /* Structs */
    /***********/

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
        uint32 validatorCount;

        Snapshot snapshot;
    }

    struct OperatorFeeChangeRequest {
        uint64 fee;
        uint64 approvalBeginTime;
        uint64 approvalEndTime;
    }

    struct DAO {
        uint32 validatorCount;
        uint64 withdrawn;

        Snapshot earnings;
    }

    struct Cluster {
        uint24[] operatorIds; // max operatorId value is 16777216
    }

    struct Pod {
        uint32 validatorCount;

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

    /*************/
    /* Constants */
    /*************/

    uint64 constant LIQUIDATION_MIN_BLOCKS = 50;
    uint64 constant MINIMAL_OPERATOR_FEE = 100000000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

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


    DAO private _dao;
    IERC20 private _token;

    /****************/
    /* Initializers */
    /****************/

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
        _operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        _declareOperatorFeePeriod = declareOperatorFeePeriod_;
        _executeOperatorFeePeriod = executeOperatorFeePeriod_;
    }

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata encryptionPK,
        uint256 fee
    ) external override returns (uint64 id) {
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        _operators[id] = Operator({ owner: msg.sender, snapshot: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee.shrink()});
        emit OperatorAdded(id, msg.sender, encryptionPK, fee);
    }

    function removeOperator(uint64 operatorId) external override {
        Operator memory operator = _operators[operatorId];
        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.snapshot = _getSnapshot(operator, uint64(block.number));

        if (operator.snapshot.balance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, operator.snapshot.balance.expand());
        }

        delete _operators[operatorId];
        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        _onlyOperatorOwnerOrContractOwner(operatorId);

        Operator memory operator = _operators[operatorId];

        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        uint64 shrunkFee = fee.shrink();

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = operator.fee * (10000 + _operatorMaxFeeIncrease) / 10000;
        if (shrunkFee > maxAllowedFee) {
            revert FeeExceedsIncreaseLimit();
        }

        _operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + _declareOperatorFeePeriod,
            uint64(block.timestamp) + _declareOperatorFeePeriod + _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclaration(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        _operators[operatorId] = _setFee(_operators[operatorId], feeChangeRequest.fee);

        emit OperatorFeeExecution(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());

        delete _operatorFeeChangeRequests[operatorId];
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        delete _operatorFeeChangeRequests[operatorId];

        emit DeclaredOperatorFeeCancelation(msg.sender, operatorId);
    }

    /********************************/
    /* Validator External Functions */
    /********************************/

    function registerValidator(
        bytes calldata publicKey,
        bytes32 clusterId,
        bytes calldata shares
    ) external override {
        _validateClusterId(clusterId);
        _validatePublicKey(publicKey);

        uint24[] memory operatorIds = _clusters[clusterId].operatorIds;

        bytes32 hashedValidator = keccak256(publicKey);
        if (_validatorPKs[hashedValidator].clusterId > 0) {
            revert ValidatorAlreadyExists();
        }

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        {
            Pod memory pod = _pods[hashedPod];

            uint64 podIndex; // = _clusterCurrentIndex(clusterId);
            {
                if (!pod.disabled) {
                    podIndex = _updateOperators(operatorIds, 1);
                }
            }

            {
                if (!pod.disabled) {
                    DAO memory dao = _updateDAOEarnings(_dao);
                    ++dao.validatorCount;
                    _dao = dao;
                }
            }

            pod = _updatePodData(pod, podIndex, 1);


            if (_liquidatable(pod.disabled, pod.usage.balance, pod.validatorCount, operatorIds)) {
                revert NotEnoughBalance();
            }

            _pods[hashedPod] = pod;
        }

        _validatorPKs[hashedValidator] = Validator({ owner: msg.sender, clusterId: clusterId, active: true});

        emit ValidatorAdded(publicKey, clusterId, shares);
    }

    function removeValidator(
        bytes calldata publicKey
    ) external override {
        _validatePublicKey(publicKey);

        bytes32 hashedValidator = keccak256(publicKey);
        if (_validatorPKs[hashedValidator].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        bytes32 clusterId = _validatorPKs[hashedValidator].clusterId;
        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));

        {
            Cluster memory cluster = _clusters[clusterId];

            uint64 podIndex = _updateOperators(cluster.operatorIds, -1);

            {
                // update DAO earnings
                DAO memory dao = _updateDAOEarnings(_dao);
                --dao.validatorCount;
                _dao = dao;
            }
            _pods[hashedPod] = _updatePodData(_pods[hashedPod], podIndex, -1);

        }

        delete _validatorPKs[hashedValidator];

        emit ValidatorRemoved(publicKey, clusterId);
    }

    function transferValidator(
        bytes calldata publicKey,
        bytes32 newClusterId,
        bytes calldata shares
    ) external override {
        _validateClusterId(newClusterId);
        _validatePublicKey(publicKey);

        uint24[] memory operatorIds = _clusters[newClusterId].operatorIds;

        bytes32 hashedValidator = keccak256(publicKey);
        bytes32 clusterId = _validatorPKs[hashedValidator].clusterId;

        if (_validatorPKs[hashedValidator].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        { 
            bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
            _pods[hashedPod] = _updatePodData(_pods[hashedPod], _clusterCurrentIndex(clusterId), -1);
        }

        {
            _updateOperatorsOnTransfer(_clusters[clusterId].operatorIds, operatorIds, 1);
        }

        {
            Pod memory pod;
            {
                bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, newClusterId));

                pod = _updatePodData(_pods[hashedPod], _clusterCurrentIndex(newClusterId), 1);
                _validatorPKs[hashedValidator].clusterId = newClusterId;
                _pods[hashedPod] = pod;
            }

            if (_liquidatable(pod.disabled, pod.usage.balance, pod.validatorCount, operatorIds)) {
                revert NotEnoughBalance();
            }

            emit ValidatorTransferred(publicKey, newClusterId, shares);
        }
    }

    function bulkTransferValidators(
        bytes[] calldata publicKeys,
        bytes32 fromClusterId,
        bytes32 toClusterId,
        bytes[] calldata shares
    ) external override {
        _validateClusterId(fromClusterId);
        _validateClusterId(toClusterId);

        if (publicKeys.length != shares.length) {
            revert ParametersMismatch();
        }

        uint16 activeValidatorCount = 0;

        for (uint16 index = 0; index < publicKeys.length; ++index) { // max 65 536 public keys
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

        uint24[] memory oldOperatorIds = _clusters[fromClusterId].operatorIds;
        uint24[] memory newOperatorIds = _clusters[toClusterId].operatorIds;

        _updateOperatorsOnTransfer(oldOperatorIds, newOperatorIds, activeValidatorCount);

        {
            bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, fromClusterId));
            Pod memory pod = _updatePodData(_pods[hashedPod], _clusterCurrentIndex(fromClusterId), 0);
            pod.validatorCount -= activeValidatorCount;
            _pods[hashedPod] = pod;
        }

        {
            bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, toClusterId));
            Pod memory pod = _updatePodData(_pods[hashedPod], _clusterCurrentIndex(toClusterId), 0);
            pod.validatorCount += activeValidatorCount;
            _pods[hashedPod] = pod;

            if (_liquidatable(pod.disabled, pod.usage.balance, pod.validatorCount, newOperatorIds)) {
                revert PodLiquidatable();
            }
        }
    }

    /**************************/
    /* Pod External Functions */
    /**************************/

    function registerPod(uint24[] memory operatorIds, uint256 amount) external override {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {

            for (uint8 i = 0; i < operatorIds.length; i++) {
                if (_operators[operatorIds[i]].owner == address(0)) {
                    revert OperatorNotFound();
                }
                if (i+1 < operatorIds.length) {
                    require(operatorIds[i] <= operatorIds[i+1], "The operators list should be in ascending order");
                }
            }

            _clusters[clusterId] = Cluster({operatorIds: operatorIds});
        }

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));

        if (_pods[hashedPod].usage.block != 0) {
            revert PodAlreadyExists();
        }

        _pods[hashedPod].usage.block = uint64(block.number);
        _pods[hashedPod].usage.balance += amount.shrink();

        emit PodCreated(msg.sender, clusterId);

        _deposit(msg.sender, clusterId, amount);
    }

    function liquidate(address ownerAddress, bytes32 clusterId) external override {
        _validateClusterId(clusterId);

        uint24[] memory operatorIds = _clusters[clusterId].operatorIds;
        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        Pod memory pod = _pods[hashedPod];
        uint64 podBalance = _podBalance(pod, _clusterCurrentIndex(clusterId)); // 4k gas usage
        {
            if (!_liquidatable(pod.disabled, podBalance, pod.validatorCount, operatorIds)) {
                revert PodNotLiquidatable();
            }

            _updateOperators(operatorIds, -int32(pod.validatorCount));

            {
                // update DAO earnings
                DAO memory dao = _updateDAOEarnings(_dao);
                dao.validatorCount -= pod.validatorCount;
                _dao = dao;
            }

            _token.transfer(msg.sender, podBalance.expand());
        }

        pod.disabled = true;
        pod.usage.balance = 0;
        emit PodLiquidated(ownerAddress, clusterId);

        _pods[hashedPod] = pod;

    }

    function reactivatePod(bytes32 clusterId, uint256 amount) external override {
         _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        Pod memory pod = _pods[hashedPod];

        if (!pod.disabled) {
            revert PodAlreadyEnabled();
        }

        _deposit(msg.sender, clusterId, amount);

        uint24[] memory operatorIds = _clusters[clusterId].operatorIds;

        uint64 podIndex = _updateOperators(operatorIds, int32(pod.validatorCount));

        {
            DAO memory dao = _updateDAOEarnings(_dao);
            dao.validatorCount += pod.validatorCount;
            _dao = dao;
        }

        pod.usage.index = podIndex;
        pod.usage.balance += amount.shrink();
        pod.disabled = false;
         _pods[hashedPod] = _updatePodData(pod, podIndex, 0);
        if (_liquidatable(pod.disabled, pod.usage.balance, pod.validatorCount, operatorIds)) {
            revert PodLiquidatable();
        }

        emit PodEnabled(msg.sender, clusterId);
    }

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(address owner, bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);
         _pods[keccak256(abi.encodePacked(msg.sender, clusterId))].usage.balance += amount.shrink();

        _deposit(owner, clusterId, amount);
    }

    function deposit(bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);
         _pods[keccak256(abi.encodePacked(msg.sender, clusterId))].usage.balance += amount.shrink();

        _deposit(msg.sender, clusterId, amount);
    }

    function withdrawOperatorBalance(uint64 operatorId, uint256 amount) external override {
        Operator memory operator = _operators[operatorId];

        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.snapshot = _getSnapshot(operator, uint64(block.number));

        uint64 shrunkAmount = amount.shrink();

        if (operator.snapshot.balance < shrunkAmount) {
            revert NotEnoughBalance();
        }

        operator.snapshot.balance -= shrunkAmount;

        _operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, amount);
    }

    function withdrawOperatorBalance(uint64 operatorId) external override {
        Operator memory operator = _operators[operatorId];

        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.snapshot = _getSnapshot(operator, uint64(block.number));

        if (operator.snapshot.balance <= 0) {
            revert NotEnoughBalance();
        }
        _transferOperatorBalanceUnsafe(operatorId, operator.snapshot.balance.expand());

        operator.snapshot.balance = 0;
        _operators[operatorId] = operator;
    }

    function withdrawPodBalance(bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        uint24[] memory operatorIds = _clusters[clusterId].operatorIds;

        Pod memory pod = _pods[hashedPod];
        uint64 balance = _podBalance(pod, _clusterCurrentIndex(clusterId));

        uint64 shrunkAmount = amount.shrink();

        if (balance < shrunkAmount || _liquidatable(pod.disabled, balance, pod.validatorCount, operatorIds)) {
            revert NotEnoughBalance();
        }

        pod.usage.balance -= shrunkAmount;

        _pods[hashedPod] = pod;

        _token.transfer(msg.sender, amount);

        emit PodFundsWithdrawal(amount, clusterId, msg.sender);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external onlyOwner override {
        _dao = _updateDAOEarnings(_dao);

        _updateNetworkFeeIndex();

        emit NetworkFeeUpdate(_networkFee.expand(), fee);

        _networkFee = fee.shrink();
    }

    function withdrawDAOEarnings(uint256 amount) external onlyOwner override {
        DAO memory dao = _dao;

        uint64 shrunkAmount = amount.shrink();

        if(shrunkAmount > _networkBalance(dao)) {
            revert NotEnoughBalance();
        }

        dao.withdrawn += shrunkAmount;
        _dao = dao;

        _token.transfer(msg.sender, amount);

        emit NetworkFeesWithdrawal(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(uint64 newValue) external onlyOwner override {
        _operatorMaxFeeIncrease = newValue;
        emit OperatorFeeIncreaseLimitUpdate(newValue);
    }

    function updateDeclareOperatorFeePeriod(uint64 newValue) external onlyOwner override {
        _declareOperatorFeePeriod = newValue;
        emit DeclareOperatorFeePeriodUpdate(newValue);
    }

    function updateExecuteOperatorFeePeriod(uint64 newValue) external onlyOwner override {
        _executeOperatorFeePeriod = newValue;
        emit ExecuteOperatorFeePeriodUpdate(newValue);
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint24 operatorId) external view override returns (uint256) {
        Operator memory operator = _operators[operatorId];

        if (operator.owner == address(0)) revert OperatorNotFound();

        return operator.fee.expand();
    }

    function getOperatorDeclaredFee(uint24 operatorId) external view override returns (uint256, uint256, uint256) {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        return (feeChangeRequest.fee.expand(), feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    /*******************************/
    /* Pod External View Functions */
    /*******************************/

    function getClusterId(uint24[] memory operatorIds) external view override returns(bytes32) {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {
            revert ClusterNotExists();
        }

        return clusterId;
    }

    function getPod(uint24[] memory operatorIds) external view override returns(bytes32) {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_pods[keccak256(abi.encodePacked(msg.sender, clusterId))].usage.block == 0) {
            revert PodNotExists();
        }

        return clusterId;
    }

    function isLiquidatable(address ownerAddress, bytes32 clusterId) external view override returns (bool) {
        _validateClusterId(clusterId);

        uint24[] memory operatorIds = _clusters[clusterId].operatorIds;
        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        Pod memory pod = _pods[hashedPod];

        return _liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(clusterId)), pod.validatorCount, operatorIds);
    }

    function isLiquidated(address ownerAddress, bytes32 clusterId) external view override returns (bool) {
        _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, clusterId));

        return _pods[hashedPod].disabled;
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function operatorSnapshot(uint64 id) external view override returns (uint64 currentBlock, uint64 index, uint256 balance) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return (s.block, s.index, s.balance.expand());
    }

    function podBalanceOf(address owner, bytes32 clusterId) external view override returns (uint256) {
        return _podBalance(_pods[keccak256(abi.encodePacked(owner, clusterId))], _clusterCurrentIndex(clusterId)).expand();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return _networkFee.expand();
    }

    function getNetworkBalance() external view onlyOwner override returns (uint256) {
        DAO memory dao = _dao;
        return _networkBalance(dao).expand();
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64) {
        return _operatorMaxFeeIncrease;
    }

    function getExecuteOperatorFeePeriod() external view override returns (uint64) {
        return _executeOperatorFeePeriod;
    }

    function getDeclaredOperatorFeePeriod() external view override returns (uint64) {
        return _declareOperatorFeePeriod;
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

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

    function _validateOperatorIds(uint24[] memory operatorIds) private pure {
        if (operatorIds.length < 4 || operatorIds.length > 13 || operatorIds.length % 3 != 1) {
            revert OperatorIdsStructureInvalid();
        }
    }

    /******************************/
    /* Operator Private Functions */
    /******************************/

    function _updateOperator(uint24 id, int32 validatorCount) private returns (uint64) {
        uint64 blockNumber = uint64(block.number);
        Operator memory operator = _operators[id];

        if (operator.owner != address(0)) {
            operator.snapshot = _getSnapshot(operator, blockNumber);
            if (validatorCount < 0) {
                operator.validatorCount -= uint32(-validatorCount);
            } else {
                operator.validatorCount += uint32(validatorCount);
            }
            _operators[id] = operator;
        }

        return operator.snapshot.index + (blockNumber - operator.snapshot.block) * operator.fee;
    }

    function _updateOperators(uint24[] memory operatorIds, int32 validatorCount) private returns (uint64 podIndex) {
        for (uint8 i = 0; i < operatorIds.length; ++i) {
            podIndex += _updateOperator(operatorIds[i], validatorCount);
        }
    }

    function _updateOperatorsOnTransfer(
        uint24[] memory oldOperatorIds,
        uint24[] memory newOperatorIds,
        uint32 validatorCount
    ) private {
        uint64 oldIndex;
        uint64 newIndex;

        while (oldIndex < oldOperatorIds.length && newIndex < newOperatorIds.length) {
            if (oldOperatorIds[oldIndex] < newOperatorIds[newIndex]) {
                _updateOperator(oldOperatorIds[oldIndex], -int32(validatorCount));
                ++oldIndex;
            } else if (newOperatorIds[newIndex] < oldOperatorIds[oldIndex]) {
                _updateOperator(newOperatorIds[newIndex], int32(validatorCount));
                ++newIndex;
            } else {
                ++oldIndex;
                ++newIndex;
            }
        }

        while (oldIndex < oldOperatorIds.length) {
            _updateOperator(oldOperatorIds[oldIndex], -int32(validatorCount));
            ++oldIndex;
        }

        while (newIndex < newOperatorIds.length) {
            _updateOperator(newOperatorIds[newIndex], int32(validatorCount));
            ++newIndex;
        }
    }

    function _setFee(Operator memory operator, uint64 fee) private view returns (Operator memory) {
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        operator.fee = fee;

        return operator;
    }

    function _getSnapshot(Operator memory operator, uint64 currentBlock) private pure returns (Snapshot memory) {
        uint64 blockDiffFee = (currentBlock - operator.snapshot.block) * operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = currentBlock;

        return operator.snapshot;
    }

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        _token.transfer(msg.sender, amount);
        emit OperatorFundsWithdrawal(amount, operatorId, msg.sender);
    }

    /*************************/
    /* Pod Private Functions */
    /*************************/

    function _updatePodData(Pod memory pod, uint64 podIndex, int8 changedTo) private view returns (Pod memory) {
        pod.usage.balance = _podBalance(pod, podIndex);
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);

        pod.networkFee = _podNetworkFee(pod);
        pod.networkFeeIndex = _currentNetworkFeeIndex();

        if (changedTo == 1) {
            ++pod.validatorCount;
        } else if (changedTo == -1) {
            --pod.validatorCount;
        }

        return pod;
    }

    function _liquidatable(bool disabled, uint64 balance, uint64 validatorCount, uint24[] memory operatorIds) private view returns (bool) {
        return !disabled && balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(operatorIds) + _networkFee) * validatorCount;
    }


    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(address owner, bytes32 clusterId, uint256 amount) private {
        _token.transferFrom(msg.sender, address(this), amount);
        emit FundsDeposit(amount, clusterId, owner);
    }

    function _updateNetworkFeeIndex() private {
        _networkFeeIndex = _currentNetworkFeeIndex();
        _networkFeeIndexBlockNumber = uint64(block.number);
    }

    function _updateDAOEarnings(DAO memory dao) private view returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao);
        dao.earnings.block = uint64(block.number);

        return dao;
    }

    function _currentNetworkFeeIndex() private view returns (uint64) {
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
        for (uint8 i = 0; i < cluster.operatorIds.length; ++i) {
            Operator memory operator = _operators[cluster.operatorIds[i]];
            podIndex += operator.snapshot.index + (currentBlock - operator.snapshot.block) * operator.fee;
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

    function _burnRatePerValidator(uint24[] memory operatorIds) private view returns (uint64 rate) {
        for (uint8 i = 0; i < operatorIds.length; ++i) {
            rate += _operators[operatorIds[i]].fee;
        }
    }
}
