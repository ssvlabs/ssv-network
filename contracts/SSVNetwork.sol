// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "./libraries/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

contract SSVNetwork is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVNetwork {
    /*************/
    /* Libraries */
    /*************/

    using Types256 for uint256;
    using Types64 for uint64;
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using NetworkLib for DAO;

    using Counters for Counters.Counter;

    /*************/
    /* Constants */
    /*************/

    uint64 constant MINIMAL_LIQUIDATION_THRESHOLD = 6_570;
    uint64 constant MINIMAL_OPERATOR_FEE = 100_000_000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) public operators;
    mapping(uint64 => OperatorFeeChangeRequest)
        public operatorFeeChangeRequests;
    mapping(bytes32 => bytes32) public clusters;
    mapping(bytes32 => Validator) private _validatorPKs;

    bytes32 public version;

    uint32 public validatorsPerOperatorLimit;
    uint64 public declareOperatorFeePeriod;
    uint64 public executeOperatorFeePeriod;
    uint64 public operatorMaxFeeIncrease;
    uint64 public minimumBlocksBeforeLiquidation;

    DAO public dao;
    IERC20 private _token;
    Network public network;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
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
        string calldata initialVersion_,
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(
            initialVersion_,
            token_,
            operatorMaxFeeIncrease_,
            declareOperatorFeePeriod_,
            executeOperatorFeePeriod_,
            minimumBlocksBeforeLiquidation_
        );
    }

    function __SSVNetwork_init_unchained(
        string calldata initialVersion_,
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_
    ) internal onlyInitializing {
        version = bytes32(abi.encodePacked(initialVersion_));
        _token = token_;
        operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        declareOperatorFeePeriod = declareOperatorFeePeriod_;
        executeOperatorFeePeriod = executeOperatorFeePeriod_;
        minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        validatorsPerOperatorLimit = 2_000;
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
        operators[id] = Operator({
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
        Operator memory operator = operators[id];
        if (operator.owner != msg.sender) revert CallerNotOwner();

        operator.getSnapshot();
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        operators[id] = operator;

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
        uint64 maxAllowedFee = (operators[operatorId].fee *
            (10000 + operatorMaxFeeIncrease)) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + declareOperatorFeePeriod,
            uint64(block.timestamp) +
                declareOperatorFeePeriod +
                executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(
        uint64 operatorId
    ) external override onlyOperatorOwnerOrContractOwner(operatorId) {
        OperatorFeeChangeRequest
            memory feeChangeRequest = operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.fee == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime ||
            block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        Operator memory operator = operators[operatorId];

        operator.getSnapshot();
        operator.fee = feeChangeRequest.fee;

        operators[operatorId] = operator;

        delete operatorFeeChangeRequests[operatorId];

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
        if (operatorFeeChangeRequests[operatorId].fee == 0)
            revert NoFeeDelcared();

        delete operatorFeeChangeRequests[operatorId];

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
                clusters[hashedCluster] != bytes32(0) &&
                clusters[hashedCluster] != hashedClusterData
            ) {
                revert IncorrectClusterState();
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
                    Operator memory operator = operators[operatorIds[i]];
                    if (operator.snapshot.block == 0) {
                        revert OperatorDoesNotExist();
                    }
                    operator.getSnapshot();
                    if (++operator.validatorCount > validatorsPerOperatorLimit) {
                        revert ExceedValidatorLimit();
                    }
                    clusterIndex += operator.snapshot.index;
                    burnRate += operator.fee;
                    operators[operatorIds[i]] = operator;
                    unchecked {
                        ++i;
                    }
                }
            }
        }

        Network memory network_ = network;
        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(
            network_
        );

        cluster.balance += amount;
        cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex, 1);

        if (
            cluster.liquidatable(
                burnRate,
                network_.networkFee,
                minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        {
            if (!cluster.disabled) {
                DAO memory dao_ = dao;
                dao_ = dao_.updateDAOEarnings(network_.networkFee);
                ++dao_.validatorCount;
                dao = dao_;
            }
        }

        clusters[hashedCluster] = keccak256(
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
            _deposit(amount);
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
        address validatorOwner = _validatorPKs[hashedValidator].owner;
        if (validatorOwner == address(0)) {
            revert ValidatorDoesNotExist();
        }
        if (validatorOwner != msg.sender) {
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
                    Operator memory operator = operators[operatorIds[i]];
                    if (operator.snapshot.block != 0) {
                        operator.getSnapshot();
                        --operator.validatorCount;
                        operators[operatorIds[i]] = operator;
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
            NetworkLib.currentNetworkFeeIndex(network),
            -1
        );

        {
            if (!cluster.disabled) {
                DAO memory dao_ = dao;
                dao_ = dao_.updateDAOEarnings(network.networkFee);
                --dao_.validatorCount;
                dao = dao_;
            }
        }
        delete _validatorPKs[hashedValidator];

        clusters[hashedCluster] = keccak256(
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
                Operator memory operator = operators[operatorIds[i]];

                if (operator.snapshot.block != 0) {
                    operator.getSnapshot();
                    operator.validatorCount -= cluster.validatorCount;
                    burnRate += operator.fee;
                    operators[operatorIds[i]] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked {
                    ++i;
                }
            }
        }

        cluster.balance = cluster.clusterBalance(
            clusterIndex,
            NetworkLib.currentNetworkFeeIndex(network)
        );

        uint64 networkFee = network.networkFee;

        if (owner != msg.sender &&
            !cluster.liquidatable(
                burnRate,
                networkFee,
                minimumBlocksBeforeLiquidation)) 
        {
            revert ClusterNotLiquidatable();
        }

        cluster.disabled = true;
        cluster.balance = 0;
        cluster.index = 0;

        {
            DAO memory dao_ = dao;
            dao_ = dao_.updateDAOEarnings(networkFee);
            dao_.validatorCount -= cluster.validatorCount;
            dao = dao_;
        }

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _transfer(msg.sender, cluster.balance);

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
                Operator memory operator = operators[operatorIds[i]];
                if (operator.snapshot.block != 0) {
                    operator.getSnapshot();
                    operator.validatorCount += cluster.validatorCount;
                    burnRate += operator.fee;
                    operators[operatorIds[i]] = operator;
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
            network
        );

        cluster.balance += amount;
        cluster.disabled = false;
        cluster.index = clusterIndex;

        cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex, 0);

        uint64 networkFee = network.networkFee;

        {
            DAO memory dao_ = dao;
            dao_ = dao_.updateDAOEarnings(networkFee);
            dao_.validatorCount += cluster.validatorCount;
            dao = dao_;
        }

        if (
            cluster.liquidatable(
                burnRate,
                networkFee,
                minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        clusters[hashedCluster] = keccak256(
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
            _deposit(amount);
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

        bytes32 hashedCluster = cluster.validateHashedCluster(
            owner,
            operatorIds,
            this
        );

        cluster.balance += amount;

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _deposit(amount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }

    function _withdrawOperatorEarnings(
        uint64 operatorId,
        uint256 amount
    ) private {
        Operator memory operator = operators[operatorId];

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

        operators[operatorId] = operator;

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

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = operators[operatorIds[i]];
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
            NetworkLib.currentNetworkFeeIndex(network)
        );

        if (
            cluster.balance < amount ||
            cluster.liquidatable(
                burnRate,
                network.networkFee,
                minimumBlocksBeforeLiquidation
            )
        ) {
            revert InsufficientBalance();
        }

        cluster.balance -= amount;

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFee,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.disabled
            )
        );

        _transfer(msg.sender, amount);

        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/

    function updateNetworkFee(uint256 fee) external override onlyOwner {
        Network memory network_ = network;

        DAO memory dao_ = dao;
        dao_ = dao_.updateDAOEarnings(network.networkFee);
        dao = dao_;

        network_.networkFeeIndex = NetworkLib.currentNetworkFeeIndex(network_);
        network_.networkFeeIndexBlockNumber = uint64(block.number);

        emit NetworkFeeUpdated(network_.networkFee.expand(), fee);

        network_.networkFee = fee.shrink();
        network = network_;
    }

    function withdrawNetworkEarnings(
        uint256 amount
    ) external override onlyOwner {
        DAO memory dao_ = dao;

        uint64 shrunkAmount = amount.shrink();

        if (shrunkAmount > dao_.networkBalance(network.networkFee)) {
            revert InsufficientBalance();
        }

        dao_.withdrawn += shrunkAmount;
        dao = dao_;

        _transfer(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(
        uint64 newOperatorMaxFeeIncrease
    ) external override onlyOwner {
        operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;
        emit OperatorFeeIncreaseLimitUpdated(operatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(
        uint64 newDeclareOperatorFeePeriod
    ) external override onlyOwner {
        declareOperatorFeePeriod = newDeclareOperatorFeePeriod;
        emit DeclareOperatorFeePeriodUpdated(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(
        uint64 newExecuteOperatorFeePeriod
    ) external override onlyOwner {
        executeOperatorFeePeriod = newExecuteOperatorFeePeriod;
        emit ExecuteOperatorFeePeriodUpdated(newExecuteOperatorFeePeriod);
    }

    function updateLiquidationThresholdPeriod(
        uint64 blocks
    ) external override onlyOwner {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = operators[operatorId];

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
        _transfer(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }

    /*****************************/
    /* Balance Private Functions */
    /*****************************/

    function _deposit(uint256 amount) private {
        if (!_token.transferFrom(msg.sender, address(this), amount)) {
            revert TokenTransferFailed();
        }
    }

    function _transfer(address to, uint256 amount) private {
        if (!_token.transfer(to, amount)) {
            revert TokenTransferFailed();
        }
    }
}
