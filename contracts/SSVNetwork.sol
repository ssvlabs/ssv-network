// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetwork.sol";
import "./ISSVNetworkLogic.sol";
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

    ISSVNetworkLogic ssvLogic;

    function setSSVLogic(ISSVNetworkLogic _ssvLogic) external onlyOwner {
        ssvLogic = _ssvLogic;
    }

    /*************/
    /* Modifiers */
    /*************/

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
    /*
    function getOperator(uint64 operatorId) external view returns (Operator memory operator) {
        operator = operators[operatorId];
    }
*/
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
        uint64 currentBalance = ssvLogic.removeOperator(operators[operatorId], msg.sender);
        if (operatorsWhitelist[operatorId] != address(0)) {
            delete operatorsWhitelist[operatorId];
        }

        if (currentBalance != 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalance.expand());
        }
        emit OperatorRemoved(operatorId);
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external override {
        operators[operatorId].checkOwner(msg.sender);

        operatorsWhitelist[operatorId] = whitelisted;
        emit OperatorWhitelistUpdated(operatorId, whitelisted);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        operatorFeeChangeRequests[operatorId] = ssvLogic.declareOperatorFee(
            operators[operatorId],
            msg.sender,
            fee,
            MINIMAL_OPERATOR_FEE,
            operatorMaxFeeIncrease,
            declareOperatorFeePeriod,
            executeOperatorFeePeriod
        );

        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        Operator memory operator = ssvLogic.executeOperatorFee(
            operators[operatorId],
            msg.sender,
            operatorFeeChangeRequests[operatorId]
        );
        operators[operatorId] = operator;

        delete operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, operator.fee.expand());
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        operators[operatorId].checkOwner(msg.sender);
        if (operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDelcared();

        delete operatorFeeChangeRequests[operatorId];

        emit OperatorFeeCancellationDeclared(msg.sender, operatorId);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        operators[operatorId] = ssvLogic.reduceOperatorFee(operators[operatorId], msg.sender, fee);

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
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

        (bytes32 hashedCluster, Operator[] memory _operators) = _precheck(
            msg.sender,
            hashedValidator,
            operatorIds,
            cluster
        );

        (Operator[] memory processedOperators, bytes32 hashedClusterData) = ssvLogic.removeValidator(
            _operators,
            cluster,
            NetworkLib.currentNetworkFeeIndex(network)
        );

        _updateOnClusterChange(
            processedOperators,
            operatorIds,
            false,
            1,
            cluster.active,
            hashedCluster,
            hashedClusterData
        );

        delete validatorPKs[hashedValidator];

        emit ValidatorRemoved(msg.sender, operatorIds, publicKey, cluster);
    }

    function liquidate(address owner, uint64[] memory operatorIds, Cluster memory cluster) external override {
        (bytes32 hashedCluster, Operator[] memory _operators) = _precheck(msg.sender, bytes32(0), operatorIds, cluster);
        cluster.validateClusterIsNotLiquidated();

        Network memory _network = network;
        (Operator[] memory processedOperators, bytes32 hashedClusterData, uint256 balanceLiquidatable) = ssvLogic
            .liquidate(
                _operators,
                cluster,
                owner,
                msg.sender,
                _network.networkFee,
                NetworkLib.currentNetworkFeeIndex(_network),
                minimumBlocksBeforeLiquidation,
                minimumLiquidationCollateral
            );

        _updateOnClusterChange(
            processedOperators,
            operatorIds,
            false,
            cluster.validatorCount,
            true,
            hashedCluster,
            hashedClusterData
        );

        if (balanceLiquidatable != 0) {
            _transfer(msg.sender, balanceLiquidatable);
        }

        emit ClusterLiquidated(owner, operatorIds, cluster);
    }

    function reactivate(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external override {
        (bytes32 hashedCluster, Operator[] memory _operators) = _precheck(msg.sender, bytes32(0), operatorIds, cluster);
        if (cluster.active) revert ClusterAlreadyEnabled();

        Network memory _network = network;
        (Operator[] memory processedOperators, bytes32 hashedClusterData) = ssvLogic.reactivate(
            _operators,
            cluster,
            amount,
            _network.networkFee,
            NetworkLib.currentNetworkFeeIndex(_network),
            minimumBlocksBeforeLiquidation,
            minimumLiquidationCollateral
        );

        _updateOnClusterChange(
            processedOperators,
            operatorIds,
            true,
            cluster.validatorCount,
            true,
            hashedCluster,
            hashedClusterData
        );

        if (amount != 0) {
            _deposit(amount);
        }

        emit ClusterReactivated(msg.sender, operatorIds, cluster);
    }

    /******************************/
    /* Balance External Functions */
    /******************************/
    /*
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
 */
    function withdrawOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount);
    }

    function withdraw(uint64[] memory operatorIds, uint256 amount, Cluster memory cluster) external override {
        (bytes32 hashedCluster, Operator[] memory _operators) = _precheck(msg.sender, bytes32(0), operatorIds, cluster);
        cluster.validateClusterIsNotLiquidated();

        Network memory _network = network;

        clusters[hashedCluster] = ssvLogic.withdraw(
            _operators,
            cluster,
            amount,
            _network.networkFee,
            NetworkLib.currentNetworkFeeIndex(_network),
            minimumBlocksBeforeLiquidation,
            minimumLiquidationCollateral
        );

        _transfer(msg.sender, amount);
        emit ClusterWithdrawn(msg.sender, operatorIds, amount, cluster);
    }

    /**************************/
    /* DAO External Functions */
    /**************************/
    /*
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
*/
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

    function _updateOnClusterChange(
        Operator[] memory processedOperators,
        uint64[] memory operatorIds,
        bool addValidators,
        uint32 clusterValidatorCount,
        bool updateDAO,
        bytes32 hashedCluster,
        bytes32 hashedClusterData
    ) private {
        for (uint i; i < processedOperators.length; ++i) {
            Operator memory operator = processedOperators[i];
            if (operator.snapshot.block != 0) {
                operators[operatorIds[i]] = operator;
            }
        }
        if (updateDAO) {
            DAO memory dao_ = dao;
            dao_.updateDAOEarnings(network.networkFee);
            addValidators == true
                ? dao_.validatorCount += clusterValidatorCount
                : dao_.validatorCount -= clusterValidatorCount;
            dao = dao_;
        }

        clusters[hashedCluster] = hashedClusterData;
    }

    function _precheck(
        address owner,
        bytes32 hashedValidator,
        uint64[] memory operatorIds,
        Cluster memory cluster
    ) private view returns (bytes32 hashedCluster, Operator[] memory processedOperators) {
        if (hashedValidator != bytes32(0)) {
            address validatorOwner = validatorPKs[hashedValidator].owner;
            if (validatorOwner == address(0)) {
                revert ValidatorDoesNotExist();
            }
            if (validatorOwner != msg.sender) {
                revert ValidatorOwnedByOtherAddress();
            }
        }
        hashedCluster = keccak256(abi.encodePacked(owner, operatorIds));
        bytes32 hashedClusterData = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        if (clusters[hashedCluster] == bytes32(0)) {
            revert ISSVNetworkCore.ClusterDoesNotExists();
        } else if (clusters[hashedCluster] != hashedClusterData) {
            revert ISSVNetworkCore.IncorrectClusterState();
        }

        processedOperators = new Operator[](operatorIds.length);
        for (uint i; i < operatorIds.length; ++i) {
            processedOperators[i] = operators[operatorIds[i]];
        }
    }

    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount) private {
        Operator memory operator = operators[operatorId];
        operator.checkOwner(msg.sender);

        ssvLogic.withdrawOperatorEarnings(operator, msg.sender, amount);
        operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, operator.snapshot.balance.expand());
    }
}
