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
    /*
    struct Cluster {
        uint64[] operatorIds;
    }
    */

    struct Validator {
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

    mapping(uint64 => OperatorFeeChangeRequest) private _operatorFeeChangeRequests;
    // mapping(bytes32 => Cluster) private _clusters;
    mapping(bytes32 => bytes32) private _operators;
    mapping(bytes32 => bytes32) private _pods;
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
    ) external override {
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        uint32 id = uint32(lastOperatorId.current());
        uint64 currentBlock = uint64(block.number);

        bytes32 hashedId = keccak256(abi.encodePacked(msg.sender, id));
        Operator memory operator = Operator({ hashedId: hashedId, id: id, block: currentBlock, index: 0, balance: 0, validatorCount: 0, fee: fee.shrink()});
        _operators[hashedId] = keccak256(abi.encodePacked(operator.id, operator.block, operator.index, operator.balance, operator.validatorCount, operator.fee));

        emit OperatorAdded(id, msg.sender, encryptionPK, fee);
        emit OperatorMetadataUpdated(id, operator);
    }

    function removeOperator(Operator memory operator) external override {
        bytes32 hashedId = keccak256(abi.encodePacked(msg.sender, operator.id));
        if(_operators[hashedId] == bytes32(0)) {
            revert OperatorWithPublicKeyNotExist();
        }

        operator = _getSnapshot(operator, uint64(block.number));

        if (operator.balance > 0) {
            _transferOperatorBalanceUnsafe(operator.id, operator.balance.expand());
        }

        delete _operators[hashedId];
        emit OperatorRemoved(operator.id);
    }

    function declareOperatorFee(Operator memory operator, uint256 fee) external override {
        _onlyOperatorOwnerOrContractOwner(keccak256(abi.encodePacked(msg.sender, operator.id)));

        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        uint64 shrunkFee = fee.shrink();

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = operator.fee * (10000 + _operatorMaxFeeIncrease) / 10000;
        if (shrunkFee > maxAllowedFee) {
            revert FeeExceedsIncreaseLimit();
        }

        _operatorFeeChangeRequests[operator.id] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + _declareOperatorFeePeriod,
            uint64(block.timestamp) + _declareOperatorFeePeriod + _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclaration(msg.sender, operator.id, block.number, fee);
    }

    function executeOperatorFee(Operator memory operator) external override {
        _onlyOperatorOwnerOrContractOwner(keccak256(abi.encodePacked(msg.sender, operator.id)));

        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operator.id];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        operator = _getSnapshot(operator, uint64(block.number));
        operator.fee = feeChangeRequest.fee;

        emit OperatorFeeExecution(msg.sender, operator.id, block.number, feeChangeRequest.fee.expand());
        emit OperatorMetadataUpdated(operator.id, operator);

        delete _operatorFeeChangeRequests[operator.id];
    }

    function cancelDeclaredOperatorFee(Operator memory operator) external override {
        _onlyOperatorOwnerOrContractOwner(keccak256(abi.encodePacked(msg.sender, operator.id)));

        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operator.id];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        delete _operatorFeeChangeRequests[operator.id];

        emit DeclaredOperatorFeeCancelation(msg.sender, operator.id);
    }

    /********************************/
    /* Validator External Functions */
    /********************************/
    function registerValidator(
        bytes calldata publicKey,
        Operator[] memory operators,
        bytes calldata shares,
        uint256 amount,
        Pod memory pod
    ) external override {
        {
            uint256 startGas = gasleft();
            _validateOperatorsLength(operators);
            _validatePublicKey(publicKey);        
            console.log("validation", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            bytes32 keyHash = keccak256(publicKey);
            if (_validatorPKs[keyHash].owner != address(0)) {
                revert ValidatorAlreadyExists();
            }
            _validatorPKs[keyHash] = Validator({ owner: msg.sender, active: true});
            console.log("validator pk", startGas - gasleft());
        }

        uint64 podIndex;
        uint64 burnRate;
        uint32[] memory operatorIds = new uint32[](operators.length);
        {
            for (uint8 i = 0; i < operators.length; ++i) {
                bytes32 hashedOperatorData = keccak256(abi.encodePacked(operators[i].id, operators[i].block, operators[i].index, operators[i].balance, operators[i].validatorCount, operators[i].fee));
                if (_operators[operators[i].hashedId] == bytes32(0)) {
                    revert OperatorDoesNotExist();
                } else if (_operators[operators[i].hashedId] != hashedOperatorData) {
                    revert OperatorDataIsBroken();
                } else if (i+1 < operators.length) {
                    require(operators[i].id <= operators[i+1].id, "OperatorsListDoesNotSorted");
                }
                operators[i] = _getSnapshot(operators[i], uint64(block.number));
                ++operators[i].validatorCount;
                operatorIds[i] = operators[i].id;
                podIndex += operators[i].index + (uint64(block.number) - operators[i].block) * operators[i].fee;
                burnRate += operators[i].fee;
                _operators[operators[i].hashedId] = keccak256(abi.encodePacked(operators[i].id, operators[i].block, operators[i].index, operators[i].balance, operators[i].validatorCount, operators[i].fee));
                // emit OperatorMetadataUpdated(operators[i].id, operators[i]);
            }
            uint256 startGas = gasleft();
            emit OperatorsMetadataUpdated(operators);
            console.log("emit", startGas - gasleft());
        }

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, operatorIds));
        {
            uint256 startGas = gasleft();
            bytes32 hashedPodData = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            if (_pods[hashedPod] == bytes32(0)) {
                pod = Pod({ validatorCount: 0, networkFee: 0, networkFeeIndex: 0, index: 0, balance: 0, disabled: false });
            } else if (_pods[hashedPod] != hashedPodData) {
                revert PodDataIsBroken();
            }
            console.log("validate pod data", startGas - gasleft());
        }
        
        {
            uint256 startGas = gasleft();
            if (amount > 0) {
                _deposit(msg.sender, hashedPod, amount.shrink());
                pod.balance += amount.shrink();
            }
            console.log("deposit", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            pod = _updatePodData(pod, podIndex, 1);
            console.log("update pod", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            ++dao.validatorCount;
            _dao = dao;
            console.log("dao snapshop", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            if (_liquidatable(pod.balance, pod.validatorCount, burnRate)) {
                revert NotEnoughBalance();
            }
            console.log("is liquidatable", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            console.log("save pod hash", startGas - gasleft());
        }

        {
            uint256 startGas = gasleft();
            emit ValidatorAdded(msg.sender, operatorIds, publicKey, shares);
            emit PodMetadataUpdated(msg.sender, pod);
            console.log("emit events", startGas - gasleft());
        }
    }

    /*
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
            _pods[hashedPod] = _updatePodData(clusterId, 0, hashedPod, -1);

            Cluster memory cluster = _clusters[clusterId];

            for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
                uint64 id = cluster.operatorIds[i];
                Operator memory operator = _operators[id];

                if (operator.owner != address(0)) {
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    --operator.validatorCount;
                    _operators[id] = operator;
                }
            }

            {
                // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }
        }

        delete _validatorPKs[hashedValidator];

        emit ValidatorRemoved(publicKey, clusterId);
    }
    */

    /*
    function transferValidator(
        bytes calldata publicKey,
        bytes32 newClusterId,
        bytes calldata shares
    ) external override {
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
            _pods[hashedPod] = _updatePodData(clusterId, 0, hashedPod, -1);
        }

        {
            _updateOperatorsOnTransfer(_clusters[clusterId].operatorIds, operatorIds, 1);
        }

        {
            Pod memory pod;
            {
                bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, newClusterId));

                pod = _updatePodData(newClusterId, 0, hashedPod, 1);
                _validatorPKs[hashedValidator].clusterId = newClusterId;
                _pods[hashedPod] = pod;
            }

            if (_liquidatable(pod.disabled, _podBalance(pod, _clusterCurrentIndex(newClusterId)), pod.validatorCount, operatorIds)) {
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

        uint32 activeValidatorCount = 0;

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

        _updateOperatorsOnTransfer(oldOperatorIds, newOperatorIds, activeValidatorCount);

        Pod memory pod = _pods[keccak256(abi.encodePacked(msg.sender, fromClusterId))];
        uint64 podIndex = _clusterCurrentIndex(fromClusterId);
        pod.usage.balance = _podBalance(pod, podIndex);
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);
        pod.validatorCount -= activeValidatorCount;

        _pods[keccak256(abi.encodePacked(msg.sender, fromClusterId))] = pod;

        pod = _pods[keccak256(abi.encodePacked(msg.sender, toClusterId))];
        podIndex = _clusterCurrentIndex(toClusterId);
        pod.usage.balance = _podBalance(pod, podIndex);
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);
        pod.validatorCount += activeValidatorCount;

        _pods[keccak256(abi.encodePacked(msg.sender, toClusterId))] = pod;

        if (_liquidatable(pod.disabled, _podBalance(pod, podIndex), pod.validatorCount, newOperatorIds)) {
            revert PodLiquidatable();
        }
    }
    */

    /**************************/
    /* Pod External Functions */
    /**************************/

    /*
    function registerPod(uint64[] memory operatorIds, uint256 amount) external override {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {
            _createClusterUnsafe(clusterId, operatorIds);
        }

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));

        if (_pods[hashedPod].usage.block != 0) {
            revert PodAlreadyExists();
        }

        _pods[hashedPod].usage.block = uint64(block.number);

        emit PodCreated(msg.sender, clusterId);

        _deposit(msg.sender, clusterId, amount.shrink());
    }
    */

    /*
    function liquidate(
        address ownerAddress,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external override {

        bytes32 hashedPod = keccak256(abi.encodePacked(ownerAddress, operatorIds));
        {
            // uint256 startGas = gasleft();
            bytes32 hashedPodData = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            if (_pods[hashedPod] != bytes32(0) && _pods[hashedPod] != hashedPodData) {
                revert PodDataIsBroken();
            } else if (_pods[hashedPod] == bytes32(0)) {
                pod = Pod({ validatorCount: 0, networkFee: 0, networkFeeIndex: 0, index: 0, balance: 0, disabled: false });
            }
            // console.log("validate pod data", startGas - gasleft());
        }

        uint64 podIndex;
        {
            // uint256 startGas = gasleft();
            for (uint8 i = 0; i < operatorIds.length; ++i) {
                Operator memory operator = _operators[operatorIds[i]];
                if (operator.owner != address(0)) {
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    operator.validatorCount -= pod.validatorCount;
                    podIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
                    _operators[operatorIds[i]] = operator;
                }
            }
            // console.log("operator snapshop", startGas - gasleft());
        }

        {
            // uint256 startGas = gasleft();
            if (!_liquidatable(pod.balance, pod.validatorCount, operatorIds)) {
                revert PodNotLiquidatable();
            }

            _token.transfer(msg.sender, pod.balance.expand());

            pod.disabled = true;
            pod.balance = 0;

            // console.log("liquidate and transfer", startGas - gasleft());
        }

        {
            // uint256 startGas = gasleft();
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount -= pod.validatorCount;
            _dao = dao;
            // console.log("dao snapshop", startGas - gasleft());
        }

        {
            // uint256 startGas = gasleft();
            _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            // console.log("save pod hash", startGas - gasleft());
        }

        {
            // uint256 startGas = gasleft();
            emit PodMetadataUpdated(ownerAddress, operatorIds, pod);
            emit PodLiquidated(ownerAddress, operatorIds);
            // console.log("emit events", startGas - gasleft());
        }
    }
    */

    /*
    function reactivatePod(bytes32 clusterId, uint256 amount) external override {
         _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        Pod memory pod = _pods[hashedPod];

        if (!pod.disabled) {
            revert PodAlreadyEnabled();
        }

        _deposit(msg.sender, clusterId, amount.shrink()); // 28k gas usage

        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;

        { // 112k gas usage
            for (uint64 index = 0; index < operatorIds.length; ++index) {
                uint64 id = operatorIds[index];
                Operator memory operator = _operators[id];

                if (operator.owner != address(0)) {
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    operator.validatorCount += pod.validatorCount;
                    _operators[operatorIds[index]] = operator;
                }
            }
        }

        { // 30k gas usage
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount += pod.validatorCount;
            _dao = dao;
        }

        pod.disabled = false;
        pod = _updatePodData(clusterId, 0, hashedPod, 0); // 16k gas usage
        _pods[hashedPod] = pod;

        emit PodEnabled(msg.sender, clusterId);
    }
    */

    /******************************/
    /* Balance External Functions */
    /******************************/

    /*
    function deposit(address owner, bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);

        _deposit(owner, clusterId, amount.shrink());
    }

    function deposit(bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);

        _deposit(msg.sender, clusterId, amount.shrink());
    }
    */

    /*
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

        uint64 operatorBalance = operator.snapshot.balance;

        if (operatorBalance <= 0) {
            revert NotEnoughBalance();
        }

        operator.snapshot.balance -= operatorBalance;

        _operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, operatorBalance.expand());
    }
    */

    /*
    function withdrawPodBalance(bytes32 clusterId, uint256 amount) external override {
        _validateClusterId(clusterId);

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, clusterId));
        uint64[] memory operatorIds = _clusters[clusterId].operatorIds;

        Pod memory pod = _pods[hashedPod];
        uint64 podBalance = _podBalance(pod, _clusterCurrentIndex(clusterId));

        uint64 shrunkAmount = amount.shrink();

        if (podBalance < shrunkAmount || _liquidatable(pod.disabled, podBalance, pod.validatorCount, operatorIds)) {
            revert NotEnoughBalance();
        }

        pod.usage.balance -= shrunkAmount;

        _pods[hashedPod] = pod;

        _token.transfer(msg.sender, amount);

        emit PodFundsWithdrawal(amount, clusterId, msg.sender);
    }
    */

    /**************************/
    /* DAO External Functions */
    /**************************/

    /*
    function updateNetworkFee(uint256 fee) external onlyOwner override {
        DAO memory dao = _dao;
        dao = _updateDAOEarnings(dao);
        _dao = dao;

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

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external onlyOwner override {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;
        emit OperatorFeeIncreaseLimitUpdate(_operatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external onlyOwner override {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;
        emit DeclareOperatorFeePeriodUpdate(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external onlyOwner override {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;
        emit ExecuteOperatorFeePeriodUpdate(newExecuteOperatorFeePeriod);
    }
    */

    /************************************/
    /* Operator External View Functions */
    /************************************/

    /*
    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        Operator memory operator = _operators[operatorId];

        if (operator.owner == address(0)) revert OperatorNotFound();

        return operator.fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (uint256, uint256, uint256) {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        return (feeChangeRequest.fee.expand(), feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }
    */

    /*******************************/
    /* Pod External View Functions */
    /*******************************/

    /*
    function getClusterId(uint64[] memory operatorIds) external view override returns(bytes32) {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_clusters[clusterId].operatorIds.length == 0) {
            revert ClusterNotExists();
        }

        return clusterId;
    }
    */

    /*
    function getPod(uint64[] memory operatorIds) external view override returns(bytes32) {
        _validateOperatorIds(operatorIds);

        bytes32 clusterId = keccak256(abi.encodePacked(operatorIds));

        if (_pods[keccak256(abi.encodePacked(msg.sender, clusterId))].usage.block == 0) {
            revert PodNotExists();
        }

        return clusterId;
    }
    */

    /*
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
    */

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    /*
    function operatorSnapshot(uint64 id) external view override returns (uint64 currentBlock, uint64 index, uint256 balance) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return (s.block, s.index, s.balance.expand());
    }
    */

    /*
    function podBalanceOf(address owner, bytes32 clusterId) external view override returns (uint256) {
        Pod memory pod = _pods[keccak256(abi.encodePacked(owner, clusterId))];
        return _podBalance(pod, _clusterCurrentIndex(clusterId)).expand();
    }
    */

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

    function _onlyOperatorOwnerOrContractOwner(bytes32 hashedId) private view {
        if(_operators[hashedId] == bytes32(0)) {
            revert OperatorWithPublicKeyNotExist();
        } else if(msg.sender != owner()) { // msg.sender != operator.owner && 
            revert CallerNotOwner();
        }
    }

    /*
    function _validateClusterId(bytes32 clusterId) private view {
        if (_clusters[clusterId].operatorIds.length == 0) {
            revert ClusterNotExists();
        }
    }
    */

    function _validatePublicKey(bytes memory publicKey) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
    }

    function _validateOperatorsLength(Operator[] memory operators) private pure {
        if (operators.length < 4 || operators.length > 13 || operators.length % 3 != 1) {
            revert OperatorIdsStructureInvalid();
        }
    }

    /******************************/
    /* Operator Private Functions */
    /******************************/

    /*
    function _updateOperatorsOnTransfer(
        uint64[] memory oldOperatorIds,
        uint64[] memory newOperatorIds,
        uint32 validatorCount
    ) private {
        uint64 oldIndex;
        uint64 newIndex;
        uint64 currentBlock = uint64(block.number);

        while (oldIndex < oldOperatorIds.length && newIndex < newOperatorIds.length) {
            if (oldOperatorIds[oldIndex] < newOperatorIds[newIndex]) {
                Operator memory operator = _operators[oldOperatorIds[oldIndex]];
                if (operator.owner != address(0)) {
                    operator.snapshot = _getSnapshot(operator, currentBlock);
                    operator.validatorCount -= validatorCount;
                    _operators[oldOperatorIds[oldIndex]] = operator;
                }
                ++oldIndex;
            } else if (newOperatorIds[newIndex] < oldOperatorIds[oldIndex]) {
                Operator memory operator = _operators[newOperatorIds[newIndex]];
                if (operator.owner != address(0)) {
                    operator.snapshot = _getSnapshot(operator, currentBlock);
                    operator.validatorCount += validatorCount;
                    _operators[newOperatorIds[newIndex]] = operator;
                }
                ++newIndex;
            } else {
                ++oldIndex;
                ++newIndex;
            }
        }

        while (oldIndex < oldOperatorIds.length) {
            Operator memory operator = _operators[oldOperatorIds[oldIndex]];
            if (operator.owner != address(0)) {
                operator.snapshot = _getSnapshot(operator, currentBlock);
                operator.validatorCount -= validatorCount;
                _operators[oldOperatorIds[oldIndex]] = operator;
            }
            ++oldIndex;
        }

        while (newIndex < newOperatorIds.length) {
            Operator memory operator = _operators[newOperatorIds[newIndex]];
            if (operator.owner != address(0)) {
                operator.snapshot = _getSnapshot(operator, currentBlock);
                operator.validatorCount += validatorCount;
                _operators[newOperatorIds[newIndex]] = operator;
            }
            ++newIndex;
        }
    }
    */

    function _getSnapshot(Operator memory operator, uint64 currentBlock) private view returns (Operator memory) {
        uint64 blockDiffFee = (currentBlock - operator.block) * operator.fee;

        operator.index += blockDiffFee;
        operator.balance += blockDiffFee * operator.validatorCount;
        operator.block = currentBlock;

        return operator;
    }

    function _transferOperatorBalanceUnsafe(uint32 operatorId, uint256 amount) private {
        _token.transfer(msg.sender, amount);
        emit OperatorFundsWithdrawal(amount, operatorId, msg.sender);
    }

    /*************************/
    /* Pod Private Functions */
    /*************************/

    /*
    function _createClusterUnsafe(bytes32 key, uint64[] memory operatorIds) private {
        for (uint64 i = 0; i < operatorIds.length; i++) {
            if (_operators[operatorIds[i]].owner == address(0)) {
                revert OperatorDoesNotExist();
            }
            if (i+1 < operatorIds.length) {
                require(operatorIds[i] <= operatorIds[i+1], "The operators list should be in ascending order");
            }
        }

        _clusters[key] = Cluster({operatorIds: operatorIds});
    }
    */

    function _updatePodData(Pod memory pod, uint64 podIndex, int8 changedTo) private view returns (Pod memory) {
        pod.balance = _podBalance(pod, podIndex);
        pod.index = podIndex;

        pod.networkFee = _podNetworkFee(pod.networkFee, pod.networkFeeIndex, pod.validatorCount);
        pod.networkFeeIndex = _currentNetworkFeeIndex();

        if (changedTo == 1) {
            ++pod.validatorCount;
        } else if (changedTo == -1) {
            --pod.validatorCount;
        }

        return pod;
    }

    function _liquidatable(uint64 balance, uint64 validatorCount, uint64 burnRate) private view returns (bool) {
        return balance < LIQUIDATION_MIN_BLOCKS * (burnRate + _networkFee) * validatorCount;
    }

    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(address owner, bytes32 hashedPod, uint64 amount) private {
        _token.transferFrom(msg.sender, address(this), amount.expand());
        emit FundsDeposit(amount.expand(), hashedPod, owner);
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

    function _podBalance(Pod memory pod, uint64 newIndex) private view returns (uint64) {
        uint64 usage = (newIndex - pod.index) * pod.validatorCount + _podNetworkFee(pod.networkFee, pod.networkFeeIndex, pod.validatorCount);

        if (usage > pod.balance) {
            revert NegativeBalance();
        }

        return pod.balance - usage;
    }

    function _podNetworkFee(uint64 networkFee, uint64 networkFeeIndex, uint32 validatorCount) private view returns (uint64) {
        return networkFee + uint64(_currentNetworkFeeIndex() - networkFeeIndex) * validatorCount;
    }
}
