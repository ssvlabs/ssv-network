// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetwork.sol";
import "./libraries/Types.sol";
import "./libraries/ClusterLib.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/NetworkLib.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

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

    uint64 private constant MINIMAL_LIQUIDATION_THRESHOLD = 100_800;
    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) public operators;
    mapping(uint64 => address) public operatorsWhitelist;
    mapping(uint64 => OperatorFeeChangeRequest) public operatorFeeChangeRequests;
    mapping(bytes32 => bytes32) public clusters;
    mapping(bytes32 => Validator) public validatorPKs;

    bytes32 public version;

    uint32 public validatorsPerOperatorLimit;
    uint64 public declareOperatorFeePeriod;
    uint64 public executeOperatorFeePeriod;
    uint64 public operatorMaxFeeIncrease;
    uint64 public minimumBlocksBeforeLiquidation;
    uint64 public minimumLiquidationCollateral;

    DAO public dao;
    IERC20 private _token;
    Network public network;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[50] __gap;

    /*************/
    /* Modifiers */
    /*************/

    modifier onlyOperatorOwner(Operator memory operator) {
        _onlyOperatorOwner(operator);
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
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_
    ) external override initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(
            initialVersion_,
            token_,
            operatorMaxFeeIncrease_,
            declareOperatorFeePeriod_,
            executeOperatorFeePeriod_,
            minimumBlocksBeforeLiquidation_,
            minimumLiquidationCollateral_
        );
    }

    function __SSVNetwork_init_unchained(
        string calldata initialVersion_,
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_
    ) internal onlyInitializing {
        version = bytes32(abi.encodePacked(initialVersion_));
        _token = token_;
        operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        declareOperatorFeePeriod = declareOperatorFeePeriod_;
        executeOperatorFeePeriod = executeOperatorFeePeriod_;
        minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        minimumLiquidationCollateral = minimumLiquidationCollateral_.shrink();
        validatorsPerOperatorLimit = 2_000;
    }

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        operators[id] = Operator({
            owner: msg.sender,
            snapshot: Snapshot({block: uint64(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink()
        });
        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }

    function removeOperator(uint64 operatorId) external override {
        _removeOperator(operatorId, operators[operatorId]);
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external override {
        _setOperatorWhitelist(operatorId, whitelisted, operators[operatorId]);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        _declareOperatorFee(operatorId, operators[operatorId], fee);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        _executeOperatorFee(operatorId, operators[operatorId]);
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        _cancelDeclaredOperatorFee(operatorId, operators[operatorId]);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        _reduceOperatorFee(operatorId, operators[operatorId], fee);
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
        bytes calldata shares,
        uint256 amount,
        Cluster memory cluster
    ) external override {
        uint operatorsLength = operatorIds.length;

        _validateOperatorIds(operatorsLength);
        _validatePublicKey(publicKey);

        if (validatorPKs[keccak256(publicKey)].owner != address(0)) {
            revert ValidatorAlreadyExists();
        }
        validatorPKs[keccak256(publicKey)] = Validator({owner: msg.sender, active: true});

        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        if (clusters[hashedCluster] == bytes32(0)) {
            if (
                cluster.validatorCount != 0 ||
                cluster.networkFeeIndex != 0 ||
                cluster.index != 0 ||
                cluster.balance != 0 ||
                !cluster.active
            ) {
                revert IncorrectClusterState();
            }
        } else if (
            clusters[hashedCluster] !=
            keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            )
        ) {
            revert IncorrectClusterState();
        } else {
            cluster.validateClusterIsNotLiquidated();
        }

        uint64 clusterIndex;
        uint64 burnRate;

        Network memory network_ = network;
        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(network_);

        cluster.balance += amount;

        if (cluster.active) {
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
                if (
                    operatorsWhitelist[operatorIds[i]] != address(0) && operatorsWhitelist[operatorIds[i]] != msg.sender
                ) {
                    revert CallerNotWhitelisted();
                }
                operator.updateSnapshot();
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
            cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

            DAO memory dao_ = dao;
            dao_.updateDAOEarnings(network_.networkFee);
            ++dao_.validatorCount;
            dao = dao_;
        }

        ++cluster.validatorCount;

        if (
            cluster.isLiquidatable(
                burnRate,
                network_.networkFee,
                minimumBlocksBeforeLiquidation,
                minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (amount > 0) {
            _deposit(amount);
        }

        emit ValidatorAdded(msg.sender, operatorIds, publicKey, shares, cluster);
    }

    function removeValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) external override {
        bytes32 hashedValidator = keccak256(publicKey);
        address validatorOwner = validatorPKs[hashedValidator].owner;
        if (validatorOwner == address(0)) {
            revert ValidatorDoesNotExist();
        }
        if (validatorOwner != msg.sender) {
            revert ValidatorOwnedByOtherAddress();
        }

        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, this);
        uint operatorsLength = operatorIds.length;

        {
            _validateOperatorIds(operatorsLength);
            _validatePublicKey(publicKey);
        }

        uint64 clusterIndex;
        {
            if (cluster.active) {
                for (uint i; i < operatorsLength; ) {
                    Operator memory operator = operators[operatorIds[i]];
                    if (operator.snapshot.block != 0) {
                        operator.updateSnapshot();
                        --operator.validatorCount;
                        operators[operatorIds[i]] = operator;
                    }

                    clusterIndex += operator.snapshot.index;
                    unchecked {
                        ++i;
                    }
                }
                cluster.updateClusterData(clusterIndex, NetworkLib.currentNetworkFeeIndex(network));

                DAO memory dao_ = dao;
                dao_.updateDAOEarnings(network.networkFee);
                --dao_.validatorCount;
                dao = dao_;
            }
        }

        --cluster.validatorCount;

        delete validatorPKs[hashedValidator];

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address owner, uint64[] memory operatorIds, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(owner, operatorIds, this);
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = operators[operatorIds[i]];

                if (operator.snapshot.block != 0) {
                    operator.updateSnapshot();
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

        cluster.updateBalance(clusterIndex, NetworkLib.currentNetworkFeeIndex(network));

        uint64 networkFee = network.networkFee;
        uint256 balanceLiquidatable;

        if (
            owner != msg.sender &&
            !cluster.isLiquidatable(burnRate, networkFee, minimumBlocksBeforeLiquidation, minimumLiquidationCollateral)
        ) {
            revert ClusterNotLiquidatable();
        }

        DAO memory dao_ = dao;
        dao_.updateDAOEarnings(networkFee);
        dao_.validatorCount -= cluster.validatorCount;
        dao = dao_;

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (balanceLiquidatable != 0) {
            _transfer(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, this);
        if (cluster.active) revert ClusterAlreadyEnabled();

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator memory operator = operators[operatorIds[i]];
                if (operator.snapshot.block != 0) {
                    operator.updateSnapshot();
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

        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(network);

        cluster.balance += amount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

        uint64 networkFee = network.networkFee;

        {
            DAO memory dao_ = dao;
            dao_.updateDAOEarnings(networkFee);
            dao_.validatorCount += cluster.validatorCount;
            dao = dao_;
        }

        if (
            cluster.isLiquidatable(burnRate, networkFee, minimumBlocksBeforeLiquidation, minimumLiquidationCollateral)
        ) {
            revert InsufficientBalance();
        }

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
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
        bytes32 hashedCluster = cluster.validateHashedCluster(owner, operatorIds, this);

        cluster.balance += amount;

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        _deposit(amount);

        emit ClusterDeposited(owner, operatorIds, amount, cluster);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, operators[operatorId], amount);
    }

    function withdrawOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, operators[operatorId], 0);
    }

    function withdraw(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external override {
        bytes32 hashedCluster = cluster.validateHashedCluster(msg.sender, operatorIds, this);
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        uint64 burnRate;
        {
            uint operatorsLength = operatorIds.length;
            for (uint i; i < operatorsLength; ) {
                Operator storage operator = operators[operatorIds[i]];
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

        cluster.updateClusterData(clusterIndex, NetworkLib.currentNetworkFeeIndex(network));

        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.isLiquidatable(
                burnRate,
                network.networkFee,
                minimumBlocksBeforeLiquidation,
                minimumLiquidationCollateral
            )
        ) {
            revert InsufficientBalance();
        }

        clusters[hashedCluster] = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
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
        dao_.updateDAOEarnings(network.networkFee);
        dao = dao_;

        network_.networkFeeIndex = NetworkLib.currentNetworkFeeIndex(network_);
        network_.networkFeeIndexBlockNumber = uint64(block.number);

        emit NetworkFeeUpdated(network_.networkFee.expand(), fee);

        network_.networkFee = fee.shrink();
        network = network_;
    }

    function withdrawNetworkEarnings(uint256 amount) external override onlyOwner {
        DAO memory dao_ = dao;

        uint64 shrunkAmount = amount.shrink();

        uint64 networkBalance = dao_.networkTotalEarnings(network.networkFee);

        if (shrunkAmount > networkBalance) {
            revert InsufficientBalance();
        }

        dao_.balance = networkBalance - shrunkAmount;
        dao = dao_;

        _transfer(msg.sender, amount);

        emit NetworkEarningsWithdrawn(amount, msg.sender);
    }

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external override onlyOwner {
        operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;
        emit OperatorFeeIncreaseLimitUpdated(operatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external override onlyOwner {
        declareOperatorFeePeriod = newDeclareOperatorFeePeriod;
        emit DeclareOperatorFeePeriodUpdated(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external override onlyOwner {
        executeOperatorFeePeriod = newExecuteOperatorFeePeriod;
        emit ExecuteOperatorFeePeriodUpdated(newExecuteOperatorFeePeriod);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external override onlyOwner {
        if (blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert NewBlockPeriodIsBelowMinimum();
        }

        minimumBlocksBeforeLiquidation = blocks;
        emit LiquidationThresholdPeriodUpdated(blocks);
    }

    function updateMinimumLiquidationCollateral(uint256 amount) external override onlyOwner {
        minimumLiquidationCollateral = amount.shrink();
        emit MinimumLiquidationCollateralUpdated(amount);
    }

    /********************************/
    /* Validation Private Functions */
    /********************************/

    function _onlyOperatorOwner(Operator memory operator) private view {
        if (operator.snapshot.block == 0) revert OperatorDoesNotExist();
        if (operator.owner != msg.sender) revert CallerNotOwner();
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

    /******************************/
    /* Operator Private Functions */
    /******************************/

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        _transfer(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }

    function _withdrawOperatorEarnings(
        uint64 operatorId,
        Operator memory operator,
        uint256 amount
    ) private onlyOperatorOwner(operator) {
        operator.updateSnapshot();

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

    function _removeOperator(uint64 operatorId, Operator memory operator) private onlyOperatorOwner(operator) {
        operator.updateSnapshot();
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        operators[operatorId] = operator;

        if (operatorsWhitelist[operatorId] != address(0)) {
            delete operatorsWhitelist[operatorId];
        }

        if (currentBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalance.expand());
        }
        emit OperatorRemoved(operatorId);
    }

    function _setOperatorWhitelist(
        uint64 operatorId,
        address whitelisted,
        Operator storage operator
    ) private onlyOperatorOwner(operator) {
        operatorsWhitelist[operatorId] = whitelisted;
        emit OperatorWhitelistUpdated(operatorId, whitelisted);
    }

    function _declareOperatorFee(
        uint64 operatorId,
        Operator memory operator,
        uint256 fee
    ) private onlyOperatorOwner(operator) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();
        uint64 operatorFee = operators[operatorId].fee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee * (10000 + operatorMaxFeeIncrease)) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + declareOperatorFeePeriod,
            uint64(block.timestamp) + declareOperatorFeePeriod + executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function _executeOperatorFee(uint64 operatorId, Operator memory operator) private onlyOperatorOwner(operator) {
        OperatorFeeChangeRequest memory feeChangeRequest = operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        operator.updateSnapshot();
        operator.fee = feeChangeRequest.fee;
        operators[operatorId] = operator;

        delete operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());
    }

    function _cancelDeclaredOperatorFee(
        uint64 operatorId,
        Operator memory operator
    ) private onlyOperatorOwner(operator) {
        if (operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDelcared();

        delete operatorFeeChangeRequests[operatorId];

        emit OperatorFeeCancellationDeclared(msg.sender, operatorId);
    }

    function _reduceOperatorFee(
        uint64 operatorId,
        Operator memory operator,
        uint256 fee
    ) private onlyOperatorOwner(operator) {
        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot();
        operator.fee = shrunkAmount;
        operators[operatorId] = operator;

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
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
