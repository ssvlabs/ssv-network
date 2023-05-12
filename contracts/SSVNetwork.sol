// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./RegisterAuth.sol";
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
    uint64 private constant PRECISION_FACTOR = 10_000;

    /********************/
    /* Global Variables */
    /********************/

    Counters.Counter private lastOperatorId;

    /*************/
    /* Variables */
    /*************/

    mapping(uint64 => Operator) public override operators;
    mapping(uint64 => address) public override operatorsWhitelist;
    mapping(uint64 => OperatorFeeChangeRequest) public override operatorFeeChangeRequests;
    mapping(bytes32 => bytes32) public override clusters;
    mapping(bytes32 => Validator) public override validatorPKs;

    bytes32 public override version;

    uint32 public validatorsPerOperatorLimit;
    uint64 public override declareOperatorFeePeriod;
    uint64 public override executeOperatorFeePeriod;
    uint64 public override operatorMaxFeeIncrease;
    uint64 public override minimumBlocksBeforeLiquidation;
    uint64 public override minimumLiquidationCollateral;

    DAO public override dao;
    IERC20 private _token;
    Network public override network;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IRegisterAuth private immutable registerAuth;

    mapping(bytes32 => uint64) public operatorsPKs;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[49] private __gap;

    /*************/
    /* Modifiers */
    /*************/

    modifier onlyOperatorOwner(Operator memory operator) {
        _onlyOperatorOwner(operator);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _registerAuth) {
        registerAuth = IRegisterAuth(_registerAuth);
        _disableInitializers();
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
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_
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
            minimumLiquidationCollateral_,
            validatorsPerOperatorLimit_
        );
    }

    function __SSVNetwork_init_unchained(
        string calldata initialVersion_,
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint256 minimumLiquidationCollateral_,
        uint32 validatorsPerOperatorLimit_
    ) internal onlyInitializing {
        version = bytes32(abi.encodePacked(initialVersion_));
        _token = token_;
        operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        declareOperatorFeePeriod = declareOperatorFeePeriod_;
        executeOperatorFeePeriod = executeOperatorFeePeriod_;
        minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        minimumLiquidationCollateral = minimumLiquidationCollateral_.shrink();
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }

    /*****************/
    /* UUPS required */
    /*****************/

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (!registerAuth.getAuth(msg.sender).registerOperator) revert NotAuthorized();

        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        bytes32 hashedPk = keccak256(publicKey);
        if (operatorsPKs[hashedPk] != 0) revert OperatorAlreadyExists();

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        operators[id] = Operator({
            owner: msg.sender,
            snapshot: Snapshot({block: uint64(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink()
        });
        operatorsPKs[hashedPk] = id;

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
        if (!registerAuth.getAuth(msg.sender).registerValidator) revert NotAuthorized();

        uint operatorsLength = operatorIds.length;
        if (operatorsLength < 4 || operatorsLength > 13 || operatorsLength % 3 != 1) {
            revert InvalidOperatorIdsLength();
        }

        _registerValidatorPublicKey(publicKey);

        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        {
            bytes32 clusterData = clusters[hashedCluster];
            if (clusterData == bytes32(0)) {
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
                clusterData !=
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
        }

        Network memory network_ = network;
        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(network_);

        cluster.balance += amount;

        uint64 burnRate;
        uint64 clusterIndex;

        if (cluster.active) {
            for (uint i; i < operatorsLength; ) {
                {
                    if (i + 1 < operatorsLength) {
                        if (operatorIds[i] > operatorIds[i + 1]) {
                            revert UnsortedOperatorsList();
                        } else if (operatorIds[i] == operatorIds[i + 1]) {
                            revert OperatorsListNotUnique();
                        }
                    }
                    address whitelisted = operatorsWhitelist[operatorIds[i]];
                    if (whitelisted != address(0) && whitelisted != msg.sender) {
                        revert CallerNotWhitelisted();
                    }
                }
                Operator memory operator = operators[operatorIds[i]];
                if (operator.snapshot.block == 0) {
                    revert OperatorDoesNotExist();
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

        {
            if (cluster.active) {
                (uint64 clusterIndex, ) = _updateOperators(operatorIds, false, 1);

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

        (uint64 clusterIndex, uint64 burnRate) = _updateOperators(operatorIds, false, cluster.validatorCount);

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

        (uint64 clusterIndex, uint64 burnRate) = _updateOperators(operatorIds, true, cluster.validatorCount);

        uint64 currentNetworkFeeIndex = NetworkLib.currentNetworkFeeIndex(network);

        cluster.balance += amount;
        cluster.active = true;
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = currentNetworkFeeIndex;

        uint64 networkFee = network.networkFee;

        DAO memory dao_ = dao;
        dao_.updateDAOEarnings(networkFee);
        dao_.validatorCount += cluster.validatorCount;
        dao = dao_;

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

    function _registerValidatorPublicKey(bytes calldata publicKey) private {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }

        bytes32 hashedPk = keccak256(publicKey);
        if (validatorPKs[hashedPk].owner != address(0)) {
            revert ValidatorAlreadyExists();
        }
        validatorPKs[hashedPk] = Validator({owner: msg.sender, active: true});
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

        uint64 shrunkWithdrawn;
        uint64 shrunkAmount = amount.shrink();

        if (amount == 0 && operator.snapshot.balance > 0) {
            shrunkWithdrawn = operator.snapshot.balance;
        } else if (amount > 0 && operator.snapshot.balance >= shrunkAmount) {
            shrunkWithdrawn = shrunkAmount;
        } else {
            revert InsufficientBalance();
        }

        operator.snapshot.balance -= shrunkWithdrawn;

        operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
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
        uint64 maxAllowedFee = (operatorFee * (PRECISION_FACTOR + operatorMaxFeeIncrease)) / PRECISION_FACTOR;

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

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDeclared();

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
        if (operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDeclared();

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

    function _updateOperators(
        uint64[] memory operatorIds,
        bool increaseValidatorCount,
        uint32 deltaValidatorCount
    ) internal returns (uint64 clusterIndex, uint64 burnRate) {
        uint operatorsLength = operatorIds.length;

        for (uint i; i < operatorsLength; ) {
            Operator memory operator = operators[operatorIds[i]];
            if (operator.snapshot.block != 0) {
                operator.updateSnapshot();
                if (increaseValidatorCount) {
                    operator.validatorCount += deltaValidatorCount;
                } else {
                    operator.validatorCount -= deltaValidatorCount;
                }
                burnRate += operator.fee;
                operators[operatorIds[i]] = operator;
            }

            clusterIndex += operator.snapshot.index;
            unchecked {
                ++i;
            }
        }
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
