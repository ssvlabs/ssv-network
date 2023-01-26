// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

contract SSVNetwork is UUPSUpgradeable, OwnableUpgradeable, ISSVNetwork {
    /*************/
    /* Libraries */
    /*************/

    using Types256 for uint256;
    using Types64 for uint64;
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using NetworkLib for DAO;

    using Counters for Counters.Counter;

    /***********/
    /* Structs */
    /***********/

    struct Validator {
        address owner;
        bool active;
    }

    /*************/
    /* Constants */
    /*************/

    uint64 constant MINIMAL_LIQUIDATION_THRESHOLD = 6570;
    uint64 constant MINIMAL_OPERATOR_FEE = 1e8;
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) public _operators;
    mapping(uint64 => OperatorFeeChangeRequest)
        public _operatorFeeChangeRequests;
    mapping(bytes32 => bytes32) public _clusters;
    mapping(bytes32 => Validator) _validatorPKs;

    uint64 public _declareOperatorFeePeriod;
    uint64 public _executeOperatorFeePeriod;
    uint64 public _operatorMaxFeeIncrease;
    uint64 public _minimumBlocksBeforeLiquidation;

    DAO public _dao;
    IERC20 private _token;
    Network public _network;

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
        __SSVNetwork_init_unchained(
            token_,
            operatorMaxFeeIncrease_,
            declareOperatorFeePeriod_,
            executeOperatorFeePeriod_,
            minimumBlocksBeforeLiquidation_
        );
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
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        _operators[id] = Operator({
            owner: msg.sender,
            snapshot: Snapshot({
                block: uint64(block.number),
                index: 0,
                balance: 0
            }),
            validatorCount: 0,
            fee: fee.shrink()
        });
        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }

    function removeOperator(uint64 id) external override {
        Operator memory operator = _operators[id];
        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.getSnapshot();
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        _operators[id] = operator;

        if (currentBalance > 0) {
            _transferOperatorBalanceUnsafe(id, currentBalance.expand());
        }
        emit OperatorRemoved(id);
    }

    function declareOperatorFee(
        uint64 operatorId,
        uint256 fee
    ) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        if (fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();

        uint64 shrunkFee = fee.shrink();

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (_operators[operatorId].fee *
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

        if (feeChangeRequest.fee == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime ||
            block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        Operator memory operator = _operators[operatorId];

        operator.getSnapshot();
        operator.fee = feeChangeRequest.fee;

        _operators[operatorId] = operator;

        delete _operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(
            msg.sender,
            operatorId,
            block.number,
            feeChangeRequest.fee.expand()
        );
    }

    function cancelDeclaredOperatorFee(
        uint64 operatorId
    ) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        if (_operatorFeeChangeRequests[operatorId].fee == 0)
            revert NoFeeDelcared();

        delete _operatorFeeChangeRequests[operatorId];

        emit OperatorFeeCancelationDeclared(msg.sender, operatorId);
    }

    function setFeeRecipientAddress(
        address recipientAddress
    ) external override {
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
    ) external {
        // TODO override
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

        bytes32 hashedCluster = keccak256(
            abi.encodePacked(msg.sender, operatorIds)
        );
        {
            bytes32 hashedClusterData = keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFee,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.disabled
                )
            );
            if (
                _clusters[hashedCluster] != bytes32(0) &&
                _clusters[hashedCluster] != hashedClusterData
            ) {
                revert ClusterLib.IncorrectClusterState();
            }
        }

        uint64 clusterIndex;
        uint64 burnRate;
        {
            if (!cluster.disabled) {
                for (uint i; i < operatorsLength; ) {
                    if (i + 1 < operatorsLength) {
                        if (operatorIds[i] > operatorIds[i + 1]) {
                            revert UnsortedOperatorsList();
                        }
                    }
                    Operator memory operator = _operators[operatorIds[i]];
                    if (operator.snapshot.block == 0) {
                        revert OperatorDoesNotExist();
                    }
                    operator.getSnapshot();
                    if (
                        ++operator.validatorCount >
                        VALIDATORS_PER_OPERATOR_LIMIT
                    ) {
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

        Network memory network = _network;
        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            _network
        );

        cluster.balance += amount.shrink();
        cluster.updateClusterData(
            clusterIndex,
            currentNetworkFeeIndex,
            1
        );

        if (
            cluster.liquidatable(
                burnRate,
                network.networkFee,
                _minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        {
            if (!cluster.disabled) {
                DAO memory dao = _dao;
                dao = dao.updateDAOEarnings(network.networkFee);
                ++dao.validatorCount;
                _dao = dao;
            }
        }

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        if (amount > 0) {
            _deposit(amount.shrink());
        }

        emit ValidatorAdded(
            msg.sender,
            operatorIds,
            publicKey,
            sharesEncrypted,
            cluster
        );
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external {
        // TODO override
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
                for (uint i; i < operatorsLength; ) {
                    Operator memory operator = _operators[operatorIds[i]];
                    if (operator.snapshot.block != 0) {
                        operator.getSnapshot();
                        --operator.validatorCount;
                        _operators[operatorIds[i]] = operator;
                    }

                    clusterIndex += operator.snapshot.index;
                    unchecked {
                        ++i;
                    }
                }
            }
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(
            msg.sender,
            operatorIds,
            this
        );

        cluster.updateClusterData(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(_network),
            -1
        );

        {
            if (!cluster.disabled) {
                DAO memory dao = _dao;
                dao = dao.updateDAOEarnings(_network.networkFee);
                --dao.validatorCount;
                _dao = dao;
            }
        }
        delete _validatorPKs[hashedValidator];

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(
        address owner,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        cluster.validateClusterIsNotLiquidated();

        bytes32 hashedCluster = cluster.validateHashedCluster(
            owner,
            operatorIds,
            this
        );

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];

                if (operator.snapshot.block != 0) {
                    operator.getSnapshot();
                    operator.validatorCount -= cluster.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked {
                    ++i;
                }
            }
        }

        cluster.balance = cluster.clusterBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(_network)
        );

        uint64 networkFee = _network.networkFee;
        if (
            !cluster.liquidatable(
                burnRate,
                networkFee,
                _minimumBlocksBeforeLiquidation
            )
        ) {
            revert ClusterLib.ClusterNotLiquidatable();
        }

        cluster.disabled = true;
        cluster.balance = 0;
        cluster.index = 0;

        {
            DAO memory dao = _dao;
            dao = dao.updateDAOEarnings(networkFee);
            dao.validatorCount -= cluster.validatorCount;
            _dao = dao;
        }

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _token.transfer(msg.sender, cluster.balance.expand());

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(
        uint64[] memory operatorIds,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        if (!cluster.disabled) {
            revert ClusterLib.ClusterAlreadyEnabled();
        }

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                if (operator.snapshot.block != 0) {
                    operator.getSnapshot();
                    operator.validatorCount += cluster.validatorCount;
                    burnRate += operator.fee;
                    _operators[operatorIds[i]] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked {
                    ++i;
                }
            }
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(
            msg.sender,
            operatorIds,
            this
        );

        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            _network
        );

        cluster.balance += amount.shrink();
        cluster.disabled = false;
        cluster.index = clusterIndex;

        cluster.updateClusterData(
            clusterIndex,
            currentNetworkFeeIndex,
            0
        );

        uint64 networkFee = _network.networkFee;

        {
            DAO memory dao = _dao;
            dao = dao.updateDAOEarnings(networkFee);
            dao.validatorCount += cluster.validatorCount;
            _dao = dao;
        }

        if (
            cluster.liquidatable(
                burnRate,
                networkFee,
                _minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

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
        cluster.validateClusterIsNotLiquidated();

        uint64 shrunkAmount = amount.shrink();

        bytes32 hashedCluster = cluster.validateHashedCluster(
            owner,
            operatorIds,
            this
        );

        cluster.balance += shrunkAmount;

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _deposit(shrunkAmount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }

    function _withdrawOperatorEarnings(
        uint64 operatorId,
        uint256 amount
    ) private {
        Operator memory operator = _operators[operatorId];

        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.getSnapshot();

        uint64 shrunkAmount;

        if (amount == 0 && operator.snapshot.balance > 0) {
            shrunkAmount = operator.snapshot.balance;
        } else if (amount > 0 && operator.snapshot.balance >= amount.shrink()) {
            shrunkAmount = amount.shrink();
        } else {
            revert InsufficientBalance();
        }

        operator.snapshot.balance -= shrunkAmount;

        _operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, shrunkAmount.expand());
    }

    function withdrawOperatorEarnings(
        uint64 operatorId,
        uint256 amount
    ) external override {
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
        cluster.validateClusterIsNotLiquidated();

        uint64 shrunkAmount = amount.shrink();

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = _operators[operatorIds[i]];
                clusterIndex +=
                    operator.snapshot.index +
                    (uint64(block.number) - operator.snapshot.block) *
                    operator.fee;
                burnRate += operator.fee;
                unchecked {
                    ++i;
                }
            }
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(
            msg.sender,
            operatorIds,
            this
        );

        cluster.balance = cluster.clusterBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(_network)
        );

        if (
            cluster.balance < shrunkAmount ||
            cluster.liquidatable(
                burnRate,
                _network.networkFee,
                _minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        cluster.balance -= shrunkAmount;

        _clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _token.transfer(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        Network memory network = _network;

        DAO memory dao = _dao;
        dao = dao.updateDAOEarnings(network.networkFee);
        _dao = dao;

        network.networkFeeIndex = NetworkLib.currentNetworkFeeIndex(_network);
        network.networkFeeIndexBlockNumber = uint64(block.number);

        emit NetworkFeeUpdated(network.networkFee.expand(), fee);

        network.networkFee = fee.shrink();
        _network = network;
    }

    function withdrawNetworkEarnings(
        uint256 amount
    ) external override onlyOwner {
        DAO memory dao = _dao;

        uint64 shrunkAmount = amount.shrink();

        if (shrunkAmount > dao.networkBalance(_network.networkFee)) {
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

    function updateLiquidationThresholdPeriod(
        uint64 blocks
    ) external override onlyOwner {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        _minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = _operators[operatorId];

        if (operator.snapshot.block == 0) {
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
        if (
            operatorsLength < 4 ||
            operatorsLength > 13 ||
            operatorsLength % 3 != 1
        ) {
            revert InvalidOperatorIdsLength();
        }
    }

    /******************************/
    /* Operator Private Functions */
    /******************************/

    function _transferOperatorBalanceUnsafe(
        uint64 operatorId,
        uint256 amount
    ) private {
        _token.transfer(msg.sender, amount);
        emit OperatorWithdrawn(amount, operatorId, msg.sender);
    }

    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(uint64 amount) private {
        _token.transferFrom(msg.sender, address(this), amount.expand());
    }
}
