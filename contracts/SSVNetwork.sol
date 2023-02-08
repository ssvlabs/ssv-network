// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/Types.sol";

contract SSVNetwork is  UUPSUpgradeable, OwnableUpgradeable, ISSVNetwork {
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
    uint64 constant MINIMAL_OPERATOR_FEE = 10_000_000;
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) private _operators;
    mapping(uint64 => OperatorFeeChangeRequest)
        private _operatorFeeChangeRequests;
    // mapping(bytes32 => Cluster) private _clusters;
    mapping(bytes32 => bytes32) private _clusters;
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

    // @dev reserve storage space for future new state variables in base contract
    uint256[50] __gap;

    /*************/
    /* Modifiers */
    /*************/

    modifier onlyOperatorOwnerOrContractOwner(uint64 operatorId) {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        _;
    }

    /****************/
    /* Initializers */
    /****************/

    function initialize(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
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

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata publicKey,
        uint256 fee
    ) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        _operators[id] = Operator({ owner: msg.sender, snapshot: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee.shrink()});
        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }

    function removeOperator(uint64 operatorId) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        Operator memory operator = _operators[operatorId];
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        _operators[operatorId] = operator;

        if (currentBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalance.expand());
        }
        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(
        uint64 operatorId,
        uint256 fee
    ) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();
        uint64 operatorFee = _operators[operatorId].fee;
        uint64 shrunkFee = fee.shrink();
        
        if(operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert ZeroFeeIncreaseNotAllowed();
        }        

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee *
            (10000 + _operatorMaxFeeIncrease)) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        _operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + _declareOperatorFeePeriod,
            uint64(block.timestamp) +
                _declareOperatorFeePeriod +
                _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(
        uint64 operatorId
    ) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        OperatorFeeChangeRequest
            memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.approvalBeginTime == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime ||
            block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        delete _operatorFeeChangeRequests[operatorId];
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        if(_operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDelcared();

        delete _operatorFeeChangeRequests[operatorId];

        emit OperatorFeeCancelationDeclared(msg.sender, operatorId);
    }

    function setFeeRecipientAddress(address recipientAddress) external override {
        emit FeeRecipientAddressUpdated(msg.sender, recipientAddress);
    }

    /********************************/
    /* Validator External Functions */
    /********************************/
    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesEncrypted,
        uint256 amount,
        Cluster memory cluster
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
            _validatorPKs[keccak256(publicKey)] = Validator({
                owner: msg.sender,
                active: true
            });
        }

        uint64 clusterIndex;
        uint64 burnRate;
        {
            if (!cluster.disabled) {
                for (uint i; i < operatorsLength;) {
                    if (i+1 < operatorsLength) {
                        if (operatorIds[i] > operatorIds[i+1]) {
                            revert UnsortedOperatorsList();
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
                    clusterIndex += operator.snapshot.index;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                    unchecked {
                        ++i;
                    }
                }
            }
        }

        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));
        {
            bytes32 hashedClusterData = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));
            if (_clusters[hashedCluster] == bytes32(0)) {
                cluster = Cluster({ validatorCount: 0, networkFee: 0, networkFeeIndex: 0, index: 0, balance: 0, disabled: false });
            } else if (_clusters[hashedCluster] != hashedClusterData) {
                revert IncorrectClusterState();
            }
        }

        cluster.balance += amount.shrink();
        cluster = _updateClusterData(cluster, clusterIndex, 1);

        if (_liquidatable(_clusterBalance(cluster, clusterIndex), cluster.validatorCount, burnRate)) {
            revert InsufficientBalance();
        }

        {
            if (!cluster.disabled) {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                ++dao.validatorCount;
                _dao = dao;
            }
        }

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        if (amount > 0) {
            _deposit(amount.shrink());
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, sharesEncrypted, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        uint operatorsLength = operatorIds.length;

        bytes32 hashedValidator = keccak256(publicKey);
        address owner = _validatorPKs[hashedValidator].owner;
        if (owner == address(0)) {
            revert ValidatorDoesNotExist();
        }
        if (owner != msg.sender) {
            revert ValidatorOwnedByOtherAddress();
        }

        {
            _validateOperatorIds(operatorsLength);
            _validatePublicKey(publicKey);
        }

        uint64 clusterIndex;
        {
            if (!cluster.disabled) {
                for (uint i; i < operatorsLength;) {
                    Operator memory operator = _operators[operatorIds[i]];
                    if (operator.snapshot.block != 0) {
                        operator.snapshot = _getSnapshot(
                            operator,
                            uint64(block.number)
                        );
                        --operator.validatorCount;
                        _operators[operatorIds[i]] = operator;
                    }
                    
                    clusterIndex += operator.snapshot.index;
                    unchecked { ++i; }
                }
            }
        }

        bytes32 hashedCluster = _validateHashedCluster(msg.sender, operatorIds, cluster);

        cluster = _updateClusterData(cluster, clusterIndex, -1);

        {
            if (!cluster.disabled) {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }
        }
        delete _validatorPKs[hashedValidator];

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        _validateClusterIsNotLiquidated(cluster);

        bytes32 hashedCluster = _validateHashedCluster(owner, operatorIds, cluster);

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                uint64 currentBlock = uint64(block.number);
                if (operator.snapshot.block != 0) {
                    operator.snapshot = _getSnapshot(operator, currentBlock);
                    operator.validatorCount -= cluster.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }
                
                clusterIndex += operator.snapshot.index;
                unchecked { ++i; }
            }
        }

        uint64 clusterBalance = _clusterBalance(cluster, clusterIndex);
        if (!_liquidatable(clusterBalance, cluster.validatorCount, burnRate)) {
            revert ClusterNotLiquidatable();
        }

        cluster.disabled = true;
        cluster.balance = 0;
        cluster.index = 0;


        {
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount -= cluster.validatorCount;
            _dao = dao;
        }

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        _token.transfer(msg.sender, clusterBalance.expand());

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {

        if (!cluster.disabled) {
            revert ClusterAlreadyEnabled();
        }

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                if (operator.snapshot.block != 0) {
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    operator.validatorCount += cluster.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked { ++i; }
            }
        }

        bytes32 hashedCluster = _validateHashedCluster(msg.sender, operatorIds, cluster);

        cluster.balance += amount.shrink();
        cluster.disabled = false;
        cluster.index = clusterIndex;

        cluster = _updateClusterData(cluster, clusterIndex, 0);

        {
            DAO memory dao = _dao;
            dao = _updateDAOEarnings(dao);
            dao.validatorCount += cluster.validatorCount;
            _dao = dao;
        }

        if (_liquidatable(_clusterBalance(cluster, clusterIndex), cluster.validatorCount, burnRate)) {
            revert InsufficientBalance();
        }

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        if (amount > 0) {
            _deposit(amount.shrink());
        }

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    /******************************/
    /* Balance External Functions */
    /******************************/

    function deposit(
        address owner,
        uint64[] calldata operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        _validateClusterIsNotLiquidated(cluster);

        uint64 shrunkAmount = amount.shrink();

        bytes32 hashedCluster = _validateHashedCluster(owner, operatorIds, cluster);

        cluster.balance += shrunkAmount;

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        _deposit(shrunkAmount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }


    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount) private  {

        Operator memory operator = _operators[operatorId];

        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.snapshot = _getSnapshot(operator, uint64(block.number));

        uint64 shrunkAmount;

        if(amount == 0 && operator.snapshot.balance > 0) {
            shrunkAmount = operator.snapshot.balance;
        } else if(amount > 0 && operator.snapshot.balance >= amount.shrink()) {
            shrunkAmount = amount.shrink();
        } else {
            revert InsufficientBalance();
        }

        operator.snapshot.balance -= shrunkAmount;

        _operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, shrunkAmount.expand());

    }


    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0);
    }

    function withdraw(
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        _validateClusterIsNotLiquidated(cluster);

        uint64 shrunkAmount = amount.shrink();

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
                burnRate += operator.fee;
                unchecked {
                    ++i;
                }
            }
        }

        bytes32 hashedCluster = _validateHashedCluster(msg.sender, operatorIds, cluster);

        uint64 clusterBalance = _clusterBalance(cluster, clusterIndex);

        if (clusterBalance < shrunkAmount || _liquidatable(clusterBalance, cluster.validatorCount, burnRate)) {
            revert InsufficientBalance();
        }

        cluster.balance -= shrunkAmount;

        _clusters[hashedCluster] = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));

        _token.transfer(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        DAO memory dao = _dao;
        dao = _updateDAOEarnings(dao);
        _dao = dao;

        _updateNetworkFeeIndex();

        emit NetworkFeeUpdated(_networkFee.expand(), fee);

        _networkFee = fee.shrink();
    }

    function withdrawNetworkEarnings(
        uint256 amount
    ) external override onlyOwner {
        DAO memory dao = _dao;

        uint64 shrunkAmount = amount.shrink();

        if(shrunkAmount > _networkBalance(dao)) {
            revert InsufficientBalance();
        }

        dao.withdrawn += shrunkAmount;
        _dao = dao;

        _token.transfer(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(
        uint64 newOperatorMaxFeeIncrease
    ) external override onlyOwner {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;
        emit OperatorFeeIncreaseLimitUpdated(_operatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(
        uint64 newDeclareOperatorFeePeriod
    ) external override onlyOwner {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;
        emit DeclareOperatorFeePeriodUpdated(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(
        uint64 newExecuteOperatorFeePeriod
    ) external override onlyOwner {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;
        emit ExecuteOperatorFeePeriodUpdated(newExecuteOperatorFeePeriod);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external onlyOwner override {
        if(blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        _minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        if (_operators[operatorId].snapshot.block == 0) revert OperatorDoesNotExist();

        return _operators[operatorId].fee.expand();
    }

    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view override returns (uint256, uint256, uint256) {
        OperatorFeeChangeRequest
            memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoFeeDelcared();
        }

        return (
            feeChangeRequest.fee.expand(),
            feeChangeRequest.approvalBeginTime,
            feeChangeRequest.approvalEndTime
        );
    }

    function getOperatorById(uint64 operatorId) external view override returns (address owner, uint256 fee, uint32 validatorCount, bool active) {
        if (_operators[operatorId].owner == address(0)) revert OperatorDoesNotExist();

        if(_operators[operatorId].snapshot.block != 0) {
            active = true;
        }

        return (
            _operators[operatorId].owner,
            _operators[operatorId].fee.expand(),
            _operators[operatorId].validatorCount,
            active
        );
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        uint64 clusterIndex;
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ) {
            Operator memory operator = _operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
            unchecked {
                ++i;
            }
        }

        _validateHashedCluster(owner, operatorIds, cluster);

        return _liquidatable(_clusterBalance(cluster, clusterIndex), cluster.validatorCount, burnRate);
    }

    function isLiquidated(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        _validateHashedCluster(owner, operatorIds, cluster);

        return cluster.disabled;
    }

    function getClusterBurnRate(uint64[] calldata operatorIds) external view override returns (uint256) {
        uint64 burnRate;
        uint operatorsLength = operatorIds.length;
        for (uint i; i < operatorsLength; ) {
            Operator memory operator = _operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                burnRate += operator.fee;
            }
            unchecked {
                ++i;
            }
        }
        return burnRate.expand();
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return s.balance.expand();
    }

    function getBalance(
        address owner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        _validateClusterIsNotLiquidated(cluster);

        uint64 clusterIndex;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
                unchecked { ++i; }
            }
        }

        _validateHashedCluster(owner, operatorIds, cluster);

        return _clusterBalance(cluster, clusterIndex).expand();
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

    function getOperatorFeeIncreaseLimit()
        external
        view
        override
        returns (uint64)
    {
        return _operatorMaxFeeIncrease;
    }

    function getExecuteOperatorFeePeriod()
        external
        view
        override
        returns (uint64)
    {
        return _executeOperatorFeePeriod;
    }

    function getDeclaredOperatorFeePeriod()
        external
        view
        override
        returns (uint64)
    {
        return _declareOperatorFeePeriod;
    }

    function getLiquidationThresholdPeriod()
        external
        view
        override
        returns (uint64)
    {
        return _minimumBlocksBeforeLiquidation;
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = _operators[operatorId];

        if(operator.snapshot.block == 0) {
            revert OperatorDoesNotExist();
        }

        if (msg.sender != operator.owner && msg.sender != owner()) {
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
            revert InvalidOperatorIdsLength();
        }
    }

    function _validateClusterIsNotLiquidated(Cluster memory cluster) private pure {
        if (cluster.disabled) {
            revert ClusterIsLiquidated();
        }
    }

    /******************************/
    /* Operator Private Functions */
    /******************************/

    function _setFee(
        Operator memory operator,
        uint64 fee
    ) private view returns (Operator memory) {
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        operator.fee = fee;

        return operator;
    }

    function _updateOperatorFeeUnsafe(uint64 operatorId, uint64 fee) private {
        Operator memory operator = _operators[operatorId];

        _operators[operatorId] = _setFee(operator, fee);

        emit OperatorFeeExecuted(
            msg.sender,
            operatorId,
            block.number,
            fee.expand()
        );
    }

    function _getSnapshot(
        Operator memory operator,
        uint64 currentBlock
    ) private pure returns (Snapshot memory) {
        uint64 blockDiffFee = (currentBlock - operator.snapshot.block) *
            operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = currentBlock;

        return operator.snapshot;
    }

    function _transferOperatorBalanceUnsafe(
        uint64 operatorId,
        uint256 amount
    ) private {
        _token.transfer(msg.sender, amount);
        emit OperatorWithdrawn(amount, operatorId, msg.sender);
    }

    /*****************************/
    /* Cluster Private Functions */
    /*****************************/

    function _validateHashedCluster(address owner, uint64[] memory operatorIds, Cluster memory cluster) private view returns (bytes32) {
        bytes32 hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        {
            bytes32 hashedClusterData = keccak256(abi.encodePacked(cluster.validatorCount, cluster.networkFee, cluster.networkFeeIndex, cluster.index, cluster.balance, cluster.disabled ));
            if (_clusters[hashedCluster] == bytes32(0)) {
                revert ClusterDoesNotExists();
            } else if (_clusters[hashedCluster] != hashedClusterData) {
                revert IncorrectClusterState();
            }
        }

        return hashedCluster;
    }

    function _updateClusterData(Cluster memory cluster, uint64 clusterIndex, int8 changedTo) private view returns (Cluster memory) {
        if (!cluster.disabled) {
            cluster.balance = _clusterBalance(cluster, clusterIndex);
            cluster.index = clusterIndex;

            cluster.networkFee = _clusterNetworkFee(cluster.networkFee, cluster.networkFeeIndex, cluster.validatorCount);
            cluster.networkFeeIndex = _currentNetworkFeeIndex();
        }

        if (changedTo == 1) {
            ++cluster.validatorCount;
        } else if (changedTo == -1) {
            --cluster.validatorCount;
        }

        return cluster;
    }

    function _liquidatable(
        uint64 balance,
        uint64 validatorCount,
        uint64 burnRate
    ) private view returns (bool) {
        return
            balance <
            _minimumBlocksBeforeLiquidation *
                (burnRate + _networkFee) *
                validatorCount;
    }

    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(uint64 amount) private {
        _token.transferFrom(msg.sender, address(this), amount.expand());
    }

    function _updateNetworkFeeIndex() private {
        _networkFeeIndex = _currentNetworkFeeIndex();
        _networkFeeIndexBlockNumber = uint64(block.number);
    }

    function _updateDAOEarnings(
        DAO memory dao
    ) private view returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao);
        dao.earnings.block = uint64(block.number);

        return dao;
    }

    function _currentNetworkFeeIndex() private view returns (uint64) {
        return
            _networkFeeIndex +
            uint64(block.number - _networkFeeIndexBlockNumber) *
            _networkFee;
    }

    function _networkTotalEarnings(
        DAO memory dao
    ) private view returns (uint64) {
        return
            dao.earnings.balance +
            (uint64(block.number) - dao.earnings.block) *
            _networkFee *
            dao.validatorCount;
    }

    function _networkBalance(DAO memory dao) private view returns (uint64) {
        return _networkTotalEarnings(dao) - dao.withdrawn;
    }

    function _clusterBalance(Cluster memory cluster, uint64 newIndex) private view returns (uint64) {
        uint64 usage = (newIndex - cluster.index) * cluster.validatorCount + _clusterNetworkFee(cluster.networkFee, cluster.networkFeeIndex, cluster.validatorCount);

        if (usage > cluster.balance) {
            revert InsufficientFunds();
        }

        return cluster.balance - usage;
    }

    function _clusterNetworkFee(uint64 networkFee, uint64 networkFeeIndex, uint32 validatorCount) private view returns (uint64) {
        return networkFee + uint64(_currentNetworkFeeIndex() - networkFeeIndex) * validatorCount;
    }
}
