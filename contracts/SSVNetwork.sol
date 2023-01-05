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

    uint64 constant MINIMAL_LIQUIDATION_THRESHOLD = 6570;
    uint64 constant MINIMAL_OPERATOR_FEE = 100000000;
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) private _operators;
    mapping(uint64 => OperatorFeeChangeRequest) private _operatorFeeChangeRequests;
    // mapping(bytes32 => Cluster) private _clusters;
    mapping(bytes32 => bytes32) private _pods;
    mapping(bytes32 => Validator) _validatorPKs;

    uint64 private _networkFee;
    uint64 private _networkFeeIndex;
    uint64 private _networkFeeIndexBlockNumber;

    uint64 private _declareOperatorFeePeriod;
    uint64 private _executeOperatorFeePeriod;
    uint64 private _operatorMaxFeeIncrease;
    uint64 private _minimumBlocksBeforeLiquidation;

    DAO private _dao;
    IERC20 private _token;

    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) external override {
        __SSVNetwork_init(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_, minimumBlocksBeforeLiquidation_);
    }

    function __SSVNetwork_init(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_, minimumBlocksBeforeLiquidation_);
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) internal onlyInitializing {
        _token = token_;
        _operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        _declareOperatorFeePeriod = declareOperatorFeePeriod_;
        _executeOperatorFeePeriod = executeOperatorFeePeriod_;
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
    }

    /*************/
    /* Modifiers */
    /*************/

    modifier onlyOperatorOwnerOrContractOwner(uint64 operatorId) {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        _;
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

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        _operators[operatorId] = operator;
        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        if (fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();

        uint64 shrunkFee = fee.shrink();

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = _operators[operatorId].fee * (10000 + _operatorMaxFeeIncrease) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        _operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + _declareOperatorFeePeriod,
            uint64(block.timestamp) + _declareOperatorFeePeriod + _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclaration(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) revert NoPendingFeeChangeRequest();

        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        delete _operatorFeeChangeRequests[operatorId];
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        if(_operatorFeeChangeRequests[operatorId].fee == 0) revert NoPendingFeeChangeRequest();

        delete _operatorFeeChangeRequests[operatorId];

        emit DeclaredOperatorFeeCancelation(msg.sender, operatorId);
    }

    function feeRecipientAddress(address recipientAddress) external override {
        emit FeeRecipientAddressAdded(msg.sender, recipientAddress);
    }

    /********************************/
    /* Validator External Functions */
    /********************************/
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        uint256 amount,
        Pod memory pod
    ) external override {
        uint operatorsLength = operatorIds.length;

        {
            _validateOperatorIds(operatorsLength);
            _validatePublicKey(publicKey);
        }

        {
            if (_validatorPKs[keccak256(publicKey)].owner != address(0)) {
                revert ValidatorAlreadyExists();
            }
            _validatorPKs[keccak256(publicKey)] = Validator({ owner: msg.sender, active: true});
        }

        uint64 podIndex;
        uint64 burnRate;
        {
            if (!pod.disabled) {
                for (uint i; i < operatorsLength;) {
                    if (i+1 < operatorsLength) {
                        if (operatorIds[i] > operatorIds[i+1]) {
                            revert OperatorsListDoesNotSorted();
                        }
                    }
                    Operator memory operator = _operators[operatorIds[i]];
                    if (operator.snapshot.block == 0) {
                        revert OperatorDoesNotExist();
                    }
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    if (++operator.validatorCount > VALIDATORS_PER_OPERATOR_LIMIT) {
                        revert ExceedValidatorLimit();
                    }
                    podIndex += operator.snapshot.index;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                    unchecked { ++i; }
                }
            }
        }

        bytes32 hashedPod = keccak256(abi.encodePacked(msg.sender, operatorIds));
        {
            bytes32 hashedPodData = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            if (_pods[hashedPod] == bytes32(0)) {
                pod = Pod({ validatorCount: 0, networkFee: 0, networkFeeIndex: 0, index: 0, balance: 0, disabled: false });
            } else if (_pods[hashedPod] != hashedPodData) {
                revert PodDataIsBroken();
            }
        }

        pod.balance += amount.shrink();
        pod = _updatePodData(pod, podIndex, 1);

        if (_liquidatable(_podBalance(pod, podIndex), pod.validatorCount, burnRate)) {
            revert NotEnoughBalance();
        }

        {
            if (!pod.disabled) {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                ++dao.validatorCount;
                _dao = dao;
            }
        }

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        if (amount > 0) {
            _deposit(msg.sender, operatorIds, amount.shrink());
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, shares, pod);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external override {
        uint operatorsLength = operatorIds.length;

        {
            _validateOperatorIds(operatorsLength);
            _validatePublicKey(publicKey);
        }

        bytes32 hashedValidator = keccak256(publicKey);
        if (_validatorPKs[hashedValidator].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        uint64 podIndex;
        {
            if (!pod.disabled) {
                for (uint i; i < operatorsLength;) {
                    Operator memory operator = _operators[operatorIds[i]];
                    if (operator.snapshot.block != 0) {
                        operator.snapshot = _getSnapshot(operator, uint64(block.number));
                        --operator.validatorCount;
                        _operators[operatorIds[i]] = operator;
                    }
                    
                    podIndex += operator.snapshot.index;
                    unchecked { ++i; }
                }
            }
        }

        bytes32 hashedPod = _validateHashedPod(msg.sender, operatorIds, pod);

        pod = _updatePodData(pod, podIndex, -1);

        {
            if (!pod.disabled) {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }
        }
        delete _validatorPKs[hashedValidator];

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, pod);
    }

    function liquidatePod(
        address owner,
        uint64[] memory operatorIds,
        Pod memory pod
    ) external override {
        _validatePodIsNotLiquidated(pod);

        bytes32 hashedPod = _validateHashedPod(owner, operatorIds, pod);

        uint64 podIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength;) {
                Operator memory operator = _operators[operatorIds[i]];
                uint64 currentBlock = uint64(block.number);
                if (operator.snapshot.block != 0) {
                    operator.snapshot = _getSnapshot(operator, currentBlock);
                    operator.validatorCount -= pod.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }
                
                podIndex += operator.snapshot.index;
                unchecked { ++i; }
            }
        }

        {
            uint64 podBalance = _podBalance(pod, podIndex);
            if (!_liquidatable(podBalance, pod.validatorCount, burnRate)) {
                revert PodNotLiquidatable();
            }

            _token.transfer(msg.sender, podBalance.expand());

            pod.disabled = true;
            pod.balance = 0;
            pod.index = 0;
        }

        {
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount -= pod.validatorCount;
            _dao = dao;
        }

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        emit PodLiquidated(owner, operatorIds, pod);
    }

    function reactivatePod(
        uint64[] memory operatorIds,
        uint256 amount,
        Pod memory pod
    ) external override {

        if (!pod.disabled) {
            revert PodAlreadyEnabled();
        }

        uint64 podIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength;) {
                Operator memory operator = _operators[operatorIds[i]];
                if (operator.snapshot.block != 0) {
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    operator.validatorCount += pod.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }

                podIndex += operator.snapshot.index;
                unchecked { ++i; }
            }
        }

        bytes32 hashedPod = _validateHashedPod(msg.sender, operatorIds, pod);

        pod.balance += amount.shrink();
        pod.disabled = false;
        pod.index = podIndex;

        pod = _updatePodData(pod, podIndex, 0);

        {
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount += pod.validatorCount;
            _dao = dao;
        }

        if (_liquidatable(_podBalance(pod, podIndex), pod.validatorCount, burnRate)) {
            revert NotEnoughBalance();
        }

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        if (amount > 0) {
            _deposit(msg.sender, operatorIds, amount.shrink());
        }

        emit PodEnabled(msg.sender, operatorIds, pod);
    }

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(
        address owner,
        uint64[] calldata operatorIds,
        uint256 amount,
        Pod memory pod
    ) external override {
        _validatePodIsNotLiquidated(pod);

        uint64 shrunkAmount = amount.shrink();

        bytes32 hashedPod = _validateHashedPod(owner, operatorIds, pod);

        pod.balance += shrunkAmount;

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        _deposit(owner, operatorIds, shrunkAmount);

        emit PodDeposited(owner, operatorIds, amount, pod);
    }

    function deposit(
        uint64[] calldata operatorIds,
        uint256 amount,
        Pod memory pod
    ) external override {
        _validatePodIsNotLiquidated(pod);

        uint64 shrunkAmount = amount.shrink();

        bytes32 hashedPod = _validateHashedPod(msg.sender, operatorIds, pod);

        pod.balance += shrunkAmount;

        _deposit(msg.sender, operatorIds, shrunkAmount);

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        emit PodDeposited(msg.sender, operatorIds, amount, pod);
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

        uint64 operatorBalance = operator.snapshot.balance;

        if (operatorBalance <= 0) {
            revert NotEnoughBalance();
        }

        operator.snapshot.balance -= operatorBalance;

        _operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, operatorBalance.expand());
    }

    function withdrawPodBalance(
        uint64[] memory operatorIds,
        uint256 amount,
        Pod memory pod
    ) external override {
        _validatePodIsNotLiquidated(pod);

        uint64 shrunkAmount = amount.shrink();

        uint64 podIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength;) {
                Operator memory operator = _operators[operatorIds[i]];
                podIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
                burnRate += operator.fee;
                unchecked { ++i; }
            }
        }

        bytes32 hashedPod = _validateHashedPod(msg.sender, operatorIds, pod);

        uint64 podBalance = _podBalance(pod, podIndex);

        if (podBalance < shrunkAmount || _liquidatable(podBalance, pod.validatorCount, burnRate)) {
            revert NotEnoughBalance();
        }

        pod.balance -= shrunkAmount;

        _pods[hashedPod] = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));

        _token.transfer(msg.sender, amount);

        emit PodFundsWithdrawal(msg.sender, operatorIds, amount, pod);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external onlyOwner override {
        DAO memory dao = _dao;
        dao = _updateDAOEarnings(dao);
        _dao = dao;

        _updateNetworkFeeIndex();

        emit NetworkFeeUpdate(_networkFee.expand(), fee);

        _networkFee = fee.shrink();
    }

    function withdrawNetworkEarnings(uint256 amount) external onlyOwner override {
        DAO memory dao = _dao;

        uint64 shrunkAmount = amount.shrink();

        if(shrunkAmount > _networkBalance(dao)) {
            revert NotEnoughBalance();
        }

        dao.withdrawn += shrunkAmount;
        _dao = dao;

        _token.transfer(msg.sender, amount);

        emit NetworkEarningsWithdrawal(amount, msg.sender);
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

    function updateLiquidationThresholdPeriod(uint64 blocks) external onlyOwner override {
        if(blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert BelowMinimumBlockPeriod();
        }

        _minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdate(blocks);
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        if (_operators[operatorId].snapshot.block == 0) revert OperatorNotFound();

        return _operators[operatorId].fee.expand();
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (uint256, uint256, uint256) {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        return (feeChangeRequest.fee.expand(), feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    function getOperatorById(uint64 operatorId) external view override returns (address owner, uint256 fee, uint32 validatorCount) {
        if (_operators[operatorId].owner == address(0)) revert OperatorNotFound();

        return (_operators[operatorId].owner, _operators[operatorId].fee.expand(), _operators[operatorId].validatorCount);
    }

    /*******************************/
    /* Pod External View Functions */
    /*******************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Pod memory pod
    ) external view override returns (bool) {
        uint64 podIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength;) {
            Operator memory operator = _operators[operatorIds[i]];
            podIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
            unchecked { ++i; }
        }

        _validateHashedPod(owner, operatorIds, pod);

        return _liquidatable(_podBalance(pod, podIndex), pod.validatorCount, burnRate);
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Pod memory pod
    ) external view override returns (bool) {
        _validateHashedPod(owner, operatorIds, pod);

        return pod.disabled;
    }

    function getPodBurnRate(uint64[] calldata operatorIds) external view override returns (uint256) {
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength;) {
            Operator memory operator = _operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                burnRate += operator.fee;
            }
            unchecked { ++i; }
        }
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function operatorSnapshot(uint64 id) external view override returns (uint64 currentBlock, uint64 index, uint256 balance) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return (s.block, s.index, s.balance.expand());
    }

    function podBalanceOf(
        address owner,
        uint64[] calldata operatorIds,
        Pod memory pod
    ) external view override returns (uint256) {
        _validatePodIsNotLiquidated(pod);

        uint64 podIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength;) {
                Operator memory operator = _operators[operatorIds[i]];
                podIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
                unchecked { ++i; }
            }
        }

        _validateHashedPod(owner, operatorIds, pod);

        return _podBalance(pod, podIndex).expand();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return _networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
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

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return _minimumBlocksBeforeLiquidation;
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = _operators[operatorId];

        if(operator.snapshot.block == 0) {
            revert OperatorWithPublicKeyNotExist();
        }

        if(msg.sender != operator.owner && msg.sender != owner()) {
            revert CallerNotOwner();
        }
    }

    function _validatePublicKey(bytes calldata publicKey) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
    }

    function _validateOperatorIds(uint operatorsLength) private pure {
        if (operatorsLength < 4 || operatorsLength > 13 || operatorsLength % 3 != 1) {
            revert OperatorIdsStructureInvalid();
        }
    }

    function _validatePodIsNotLiquidated(Pod memory pod) private pure {
        if (pod.disabled) {
            revert PodIsLiquidated();
        }
    }

    /******************************/
    /* Operator Private Functions */
    /******************************/

    function _setFee(Operator memory operator, uint64 fee) private view returns (Operator memory) {
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        operator.fee = fee;

        return operator;
    }

    function _updateOperatorFeeUnsafe(uint64 operatorId, uint64 fee) private {
        Operator memory operator = _operators[operatorId];

        _operators[operatorId] = _setFee(operator, fee);

        emit OperatorFeeExecution(msg.sender, operatorId, block.number, fee.expand());
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

    function _validateHashedPod(address owner, uint64[] memory operatorIds, Pod memory pod) private view returns (bytes32) {
        bytes32 hashedPod = keccak256(abi.encodePacked(owner, operatorIds));
        {
            bytes32 hashedPodData = keccak256(abi.encodePacked(pod.validatorCount, pod.networkFee, pod.networkFeeIndex, pod.index, pod.balance, pod.disabled ));
            if (_pods[hashedPod] == bytes32(0)) {
                revert PodNotExists();
            } else if (_pods[hashedPod] != hashedPodData) {
                revert PodDataIsBroken();
            }
        }

        return hashedPod;
    }

    function _updatePodData(Pod memory pod, uint64 podIndex, int8 changedTo) private view returns (Pod memory) {
        if (!pod.disabled) {
            pod.balance = _podBalance(pod, podIndex);
            pod.index = podIndex;

            pod.networkFee = _podNetworkFee(pod.networkFee, pod.networkFeeIndex, pod.validatorCount);
            pod.networkFeeIndex = _currentNetworkFeeIndex();
        }

        if (changedTo == 1) {
            ++pod.validatorCount;
        } else if (changedTo == -1) {
            --pod.validatorCount;
        }

        return pod;
    }

    function _liquidatable(uint64 balance, uint64 validatorCount, uint64 burnRate) private view returns (bool) {
        return balance < _minimumBlocksBeforeLiquidation * (burnRate + _networkFee) * validatorCount;
    }

    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(address owner, uint64[] memory operatorIds, uint64 amount) private {
        _token.transferFrom(msg.sender, address(this), amount.expand());
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