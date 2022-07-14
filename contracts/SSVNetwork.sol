// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/VersionedContract.sol";
import "./utils/Types.sol";
import "./ISSVNetwork.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork, VersionedContract {
    using Types256 for uint256;
    using Types64 for uint64;

    struct OperatorData {
        uint256 blockNumber;
        uint64 earnings;
        uint64 index;
        uint256 indexBlockNumber;
        uint32 activeValidatorCount;
    }

    struct OwnerData {
        uint64 deposited;
        uint64 withdrawn;
        uint64 used;
        uint64 networkFee;
        uint64 networkFeeIndex;
        uint32 activeValidatorCount;
        bool validatorsDisabled;
    }

    struct OperatorInUse {
        uint64 index;
        uint64 used;
        uint32 validatorCount;
        uint32 indexInArray;
        bool exists;
    }

    struct FeeChangeRequest {
        uint64 fee;
        uint256 approvalBeginTime;
        uint256 approvalEndTime;
    }

    ISSVRegistry private _ssvRegistryContract;
    IERC20 private _token;
    uint64 private _minimumBlocksBeforeLiquidation;
    uint64 private _operatorMaxFeeIncrease;

    uint64 private _networkFee;
    uint64 private _networkFeeIndex;
    uint256 private _networkFeeIndexBlockNumber;
    uint64 private _networkEarnings;
    uint256 private _networkEarningsBlockNumber;
    uint64 private _withdrawnFromTreasury;

    mapping(uint32 => OperatorData) private _operatorDatas;
    mapping(address => OwnerData) private _owners;
    mapping(address => mapping(uint32 => OperatorInUse)) private _operatorsInUseByAddress;
    mapping(address => uint32[]) private _operatorsInUseList;

    uint64 private _declareOperatorFeePeriod;
    uint64 private _executeOperatorFeePeriod;
    mapping(uint32 => FeeChangeRequest) private _feeChangeRequests;

    uint16 constant MINIMAL_OPERATOR_FEE = 10000;

    uint16 constant MANAGING_OPERATORS_PER_ACCOUNT_LIMIT = 50;

    function initialize(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_,
        uint16 registeredOperatorsPerAccountLimit_
    ) external initializer override {
        __SSVNetwork_init(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_, validatorsPerOperatorLimit_, registeredOperatorsPerAccountLimit_);
    }

    function __SSVNetwork_init(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_,
        uint16 registeredOperatorsPerAccountLimit_
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_, validatorsPerOperatorLimit_, registeredOperatorsPerAccountLimit_);
    }

    function __SSVNetwork_init_unchained(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_,
        uint16 registeredOperatorsPerAccountLimit_
    ) internal onlyInitializing {
        _ssvRegistryContract = registryAddress_;
        _token = token_;
        _updateLiquidationThresholdPeriod(minimumBlocksBeforeLiquidation_);
        _updateOperatorFeeIncreaseLimit(operatorMaxFeeIncrease_);
        _updateDeclareOperatorFeePeriod(declareOperatorFeePeriod_);
        _updateExecuteOperatorFeePeriod(executeOperatorFeePeriod_);
        _ssvRegistryContract.initialize(validatorsPerOperatorLimit_, registeredOperatorsPerAccountLimit_);
    }

    modifier onlyValidatorOwnerOrContractOwner(bytes calldata publicKey) {
        address validatorOwner = _ssvRegistryContract.getValidatorOwner(publicKey);
        require(
            validatorOwner != address(0),
            "validator with public key does not exist"
        );
        require(msg.sender == validatorOwner || msg.sender == owner(), "caller is not validator owner");
        _;
    }

    modifier onlyOperatorOwnerOrContractOwner(uint32 operatorId) {
        address operatorOwner = _ssvRegistryContract.getOperatorOwner(operatorId);
        require(
            operatorOwner != address(0),
            "operator with public key does not exist"
        );
        require(msg.sender == operatorOwner || msg.sender == owner(), "caller is not operator owner");
        _;
    }

    modifier ensureMinimalOperatorFee(uint256 fee) {
        require(fee >= MINIMAL_OPERATOR_FEE, "fee is too low");
        _;
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        bytes calldata publicKey,
        uint256 fee
    ) ensureMinimalOperatorFee(fee) external override returns (uint32 operatorId) {
        operatorId = _ssvRegistryContract.registerOperator(
            name,
            msg.sender,
            publicKey,
            fee.shrink()
        );

        _operatorDatas[operatorId] = OperatorData({ blockNumber: block.number, earnings: 0, index: 0, indexBlockNumber: block.number, activeValidatorCount: 0 });
        emit OperatorAdded(operatorId, name, msg.sender, publicKey, fee.shrink().expand());
    }

    /**
     * @dev See {ISSVNetwork-removeOperator}.
     */
    function removeOperator(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        address owner = _ssvRegistryContract.getOperatorOwner(operatorId);

        _updateOperatorFeeUnsafe(operatorId, 0);
        _ssvRegistryContract.removeOperator(operatorId);

        emit OperatorRemoved(operatorId, owner);
    }

    function declareOperatorFee(uint32 operatorId, uint256 fee) onlyOperatorOwnerOrContractOwner(operatorId) ensureMinimalOperatorFee(fee) external override {
        require(fee <= _ssvRegistryContract.getOperatorFee(operatorId) * (100000 + _operatorMaxFeeIncrease) / 100000, "fee exceeds increase limit");
        _feeChangeRequests[operatorId] = FeeChangeRequest(fee.shrink(), block.timestamp + _declareOperatorFeePeriod, block.timestamp + _declareOperatorFeePeriod + _executeOperatorFeePeriod);

        emit OperatorFeeSet(msg.sender, operatorId, block.number, _feeChangeRequests[operatorId].fee.expand());
    }

    function cancelDeclaredOperatorFee(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        delete _feeChangeRequests[operatorId];

        emit OperatorFeeSetCanceled(msg.sender, operatorId);
    }

    function executeOperatorFee(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        require(feeChangeRequest.fee > 0, "no pending fee change request");
        require(block.timestamp >= feeChangeRequest.approvalBeginTime && block.timestamp <= feeChangeRequest.approvalEndTime, "approval not within timeframe");

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        emit OperatorFeeApproved(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());

        delete _feeChangeRequests[operatorId];
    }

    function updateOperatorScore(uint32 operatorId, uint16 score) onlyOwner external override {
        _ssvRegistryContract.updateOperatorScore(operatorId, score);

        emit OperatorScoreUpdated(operatorId, msg.sender, block.number, score);
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    function registerValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external override {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(msg.sender);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorIds, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-updateValidator}.
     */
    function updateValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) onlyValidatorOwnerOrContractOwner(publicKey) external override {
        _removeValidatorUnsafe(msg.sender, publicKey);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorIds, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-removeValidator}.
     */
    function removeValidator(bytes calldata publicKey) onlyValidatorOwnerOrContractOwner(publicKey) external override {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(msg.sender);
        _removeValidatorUnsafe(msg.sender, publicKey);
        _totalBalanceOf(msg.sender); // For assertion
    }

    function deposit(address ownerAddress, uint256 tokenAmount) external override {
        _deposit(ownerAddress, tokenAmount);
    }

    function withdraw(uint256 tokenAmount) external override {
        require(_totalBalanceOf(msg.sender) >= tokenAmount.shrink(), "not enough balance");

        _withdrawUnsafe(tokenAmount.shrink());

        require(!_liquidatable(msg.sender), "not enough balance");
    }

    function withdrawAll() external override {
        require(_burnRate(msg.sender) == 0, "burn rate positive");

        _withdrawUnsafe(_totalBalanceOf(msg.sender));
    }

    function liquidate(address[] calldata ownerAddresses) external override {
        uint64 balanceToTransfer = 0;

        for (uint32 index = 0; index < ownerAddresses.length; ++index) {
            if (_canLiquidate(ownerAddresses[index])) {
                balanceToTransfer += _liquidateUnsafe(ownerAddresses[index]);
            }
        }

        _token.transfer(msg.sender, balanceToTransfer.expand());
    }

    function reactivateAccount(uint256 tokenAmount) external override {
        require(_owners[msg.sender].validatorsDisabled, "account already enabled");

        _deposit(msg.sender, tokenAmount);

        _enableOwnerValidatorsUnsafe(msg.sender);

        require(!_liquidatable(msg.sender), "not enough balance");

        emit AccountEnabled(msg.sender);
    }

    function updateLiquidationThresholdPeriod(uint64 newMinimumBlocksBeforeLiquidation) external onlyOwner override {
        _updateLiquidationThresholdPeriod(newMinimumBlocksBeforeLiquidation);
    }

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external onlyOwner override {
        _updateOperatorFeeIncreaseLimit(newOperatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) external onlyOwner override {
        _updateDeclareOperatorFeePeriod(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) external onlyOwner override {
        _updateExecuteOperatorFeePeriod(newExecuteOperatorFeePeriod);
    }

    /**
     * @dev See {ISSVNetwork-updateNetworkFee}.
     */
    function updateNetworkFee(uint256 fee) external onlyOwner override {
        emit NetworkFeeUpdated(_networkFee.expand(), fee.shrink().expand());
        _updateNetworkEarnings();
        _updateNetworkFeeIndex();
        _networkFee = fee.shrink();
    }

    function withdrawNetworkEarnings(uint256 amount) external onlyOwner override {
        require(amount.shrink() <= _getNetworkTreasury(), "not enough balance");
        _withdrawnFromTreasury += amount.shrink();
        _token.transfer(msg.sender, amount.shrink().expand());

        emit NetworkFeesWithdrawn(amount, msg.sender);
    }

    function getAddressBalance(address ownerAddress) external override view returns (uint256) {
        return _totalBalanceOf(ownerAddress).expand();
    }

    function isLiquidated(address ownerAddress) external view override returns (bool) {
        return _owners[ownerAddress].validatorsDisabled;
    }

    /**
     * @dev See {ISSVNetwork-getOperatorById}.
     */
    function getOperatorById(uint32 operatorId) external view override returns (string memory, address, bytes memory, uint256, uint256, uint256, bool) {
        return _ssvRegistryContract.getOperatorById(operatorId);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorByPublicKey}.
     */
    function getOperatorByPublicKey(bytes memory publicKey) external view override returns (string memory, address, bytes memory, uint256, uint256, uint256, bool) {
        return _ssvRegistryContract.getOperatorByPublicKey(publicKey);
    }

    function getOperatorDeclaredFee(uint32 operatorId) external view override returns (uint256, uint256, uint256) {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        return (feeChangeRequest.fee, feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorFee}.
     */
    function getOperatorFee(uint32 operatorId) external view override returns (uint256) {
        return _ssvRegistryContract.getOperatorFee(operatorId).expand();
    }

    /**
     * @dev See {ISSVNetwork-getOperatorsByValidator}.
     */
    function getOperatorsByValidator(bytes memory publicKey) external view override returns (uint32[] memory) {
        return _ssvRegistryContract.getOperatorsByValidator(publicKey);
    }

    /**
     * @dev See {ISSVNetwork-getValidatorsByAddress}.
     */
    function getValidatorsByOwnerAddress(address ownerAddress) external view override returns (bytes[] memory) {
        return _ssvRegistryContract.getValidatorsByAddress(ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-addressNetworkFee}.
     */
    function addressNetworkFee(address ownerAddress) external view override returns (uint256) {
        return _addressNetworkFee(ownerAddress);
    }

    function getAddressBurnRate(address ownerAddress) external view override returns (uint256) {
        return _burnRate(ownerAddress).expand();
    }

    function isLiquidatable(address ownerAddress) external view override returns (bool) {
        return _liquidatable(ownerAddress);
    }

    function getNetworkFee() external view override returns (uint256) {
        return _networkFee;
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return _getNetworkTreasury().expand();
    }

    function getLiquidationThresholdPeriod() external view override returns (uint256) {
        return _minimumBlocksBeforeLiquidation;
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint256) {
        return _operatorMaxFeeIncrease;
    }

    function getExecuteOperatorFeePeriod() external view override returns (uint256) {
        return _executeOperatorFeePeriod;
    }

    function getDeclaredOperatorFeePeriod() external view override returns (uint256) {
        return _declareOperatorFeePeriod;
    }

    function updateValidatorsPerOperatorLimit(uint16 validatorsPerOperatorLimit_) external onlyOwner {
        _ssvRegistryContract.updateValidatorsPerOperatorLimit(validatorsPerOperatorLimit_);

        emit ValidatorsPerOperatorLimitUpdated(validatorsPerOperatorLimit_);
    }

    function updateRegisteredOperatorsPerAccountLimit(uint16 registeredOperatorsPerAccountLimit_) external onlyOwner {
        _ssvRegistryContract.updateRegisteredOperatorsPerAccountLimit(registeredOperatorsPerAccountLimit_);

        emit RegisteredOperatorsPerAccountLimitUpdated(registeredOperatorsPerAccountLimit_);
    }

    function validatorsPerOperatorCount(uint32 operatorId_) external view returns (uint16) {
        return _ssvRegistryContract.validatorsPerOperatorCount(operatorId_);
    }

    function getValidatorsPerOperatorLimit() external view returns (uint16) {
        return _ssvRegistryContract.getValidatorsPerOperatorLimit();
    }

    function getRegisteredOperatorsPerAccountLimit() external view returns (uint256) {
        return _ssvRegistryContract.getRegisteredOperatorsPerAccountLimit();
    }

    function _deposit(address ownerAddress, uint256 tokenAmount) private {
        _token.transferFrom(msg.sender, address(this), tokenAmount.shrink().expand());
        _owners[ownerAddress].deposited += tokenAmount.shrink();

        emit FundsDeposited(tokenAmount.shrink().expand(), ownerAddress, msg.sender);
    }

    function _withdrawUnsafe(uint64 tokenAmount) private {
        _owners[msg.sender].withdrawn += tokenAmount;
        _token.transfer(msg.sender, tokenAmount.expand());

        emit FundsWithdrawn(tokenAmount.expand(), msg.sender);
    }

    /**
     * @dev Update network fee for the address.
     * @param ownerAddress Owner address.
     */
    function _updateAddressNetworkFee(address ownerAddress) private {
        _owners[ownerAddress].networkFee = _addressNetworkFee(ownerAddress);
        _owners[ownerAddress].networkFeeIndex = _currentNetworkFeeIndex();
    }

    function _updateOperatorIndex(uint32 operatorId) private {
        _operatorDatas[operatorId].index = _operatorIndexOf(operatorId);
    }

    /**
     * @dev Updates operators's balance.
     */
    function _updateOperatorBalance(uint32 operatorId) private {
        OperatorData storage operatorData = _operatorDatas[operatorId];
        operatorData.earnings = _operatorEarningsOf(operatorId);
        operatorData.blockNumber = block.number;
    }

    function _liquidateUnsafe(address ownerAddress) private returns (uint64) {
        _disableOwnerValidatorsUnsafe(ownerAddress);

        uint64 balanceToTransfer = _totalBalanceOf(ownerAddress);

        _owners[ownerAddress].used += balanceToTransfer;

        emit AccountLiquidated(ownerAddress);

        return balanceToTransfer;
    }

    function _updateNetworkEarnings() private {
        _networkEarnings = _getTotalNetworkEarnings();
        _networkEarningsBlockNumber = block.number;
    }

    function _updateNetworkFeeIndex() private {
        _networkFeeIndex = _currentNetworkFeeIndex();
        _networkFeeIndexBlockNumber = block.number;
    }

    function _registerValidatorUnsafe(
        address ownerAddress,
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount) private {

        _ssvRegistryContract.registerValidator(
            ownerAddress,
            publicKey,
            operatorIds,
            sharesPublicKeys,
            encryptedKeys
        );

        OwnerData storage owner = _owners[ownerAddress];

        if (!owner.validatorsDisabled) {
            ++owner.activeValidatorCount;
        }

        for (uint32 index = 0; index < operatorIds.length; ++index) {
            uint32 operatorId = operatorIds[index];
            _updateOperatorBalance(operatorId);

            if (!owner.validatorsDisabled) {
                ++_operatorDatas[operatorId].activeValidatorCount;
            }

            _useOperatorByOwner(ownerAddress, operatorId);
        }
        if (tokenAmount > 0) {
            _deposit(msg.sender, tokenAmount);
        }

        require(!_liquidatable(ownerAddress), "not enough balance");

        emit ValidatorAdded(ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
    }

    function _removeValidatorUnsafe(address ownerAddress, bytes memory publicKey) private {
        _unregisterValidator(ownerAddress, publicKey);
        _ssvRegistryContract.removeValidator(publicKey);

        if (!_owners[ownerAddress].validatorsDisabled) {
            --_owners[ownerAddress].activeValidatorCount;
        }

        emit ValidatorRemoved(ownerAddress, publicKey);
    }

    function _unregisterValidator(address ownerAddress, bytes memory publicKey) private {
        // calculate balances for current operators in use and update their balances
        uint32[] memory currentOperatorIds = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        for (uint32 index = 0; index < currentOperatorIds.length; ++index) {
            uint32 operatorId = currentOperatorIds[index];
            _updateOperatorBalance(operatorId);

            if (!_owners[ownerAddress].validatorsDisabled) {
                --_operatorDatas[operatorId].activeValidatorCount;
            }

            _stopUsingOperatorByOwner(ownerAddress, operatorId);
        }
    }

    function _useOperatorByOwner(address ownerAddress, uint32 operatorId) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorId, true);
    }

    function _stopUsingOperatorByOwner(address ownerAddress, uint32 operatorId) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorId, false);
    }

    function _updateOperatorFeeUnsafe(uint32 operatorId, uint256 fee) private {
        OperatorData storage operatorData = _operatorDatas[operatorId];
        _updateOperatorIndex(operatorId);
        operatorData.indexBlockNumber = block.number;
        _updateOperatorBalance(operatorId);
        _ssvRegistryContract.updateOperatorFee(operatorId, fee.shrink());
    }

    /**
     * @dev Updates the relation between operator and owner
     * @param ownerAddress Owner address.
     * @param increase Change value for validators amount.
     */
    function _updateUsingOperatorByOwner(address ownerAddress, uint32 operatorId, bool increase) private {
        OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorId];

        if (operatorInUseData.exists) {
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorId);

            if (increase) {
                ++operatorInUseData.validatorCount;
            } else {
                if (--operatorInUseData.validatorCount == 0) {
                    _owners[ownerAddress].used += operatorInUseData.used;

                    // remove from mapping and list;

                    _operatorsInUseList[ownerAddress][operatorInUseData.indexInArray] = _operatorsInUseList[ownerAddress][_operatorsInUseList[ownerAddress].length - 1];
                    _operatorsInUseByAddress[ownerAddress][_operatorsInUseList[ownerAddress][operatorInUseData.indexInArray]].indexInArray = operatorInUseData.indexInArray;
                    _operatorsInUseList[ownerAddress].pop();

                    delete _operatorsInUseByAddress[ownerAddress][operatorId];
                }
            }
        } else {
            require(_operatorsInUseList[ownerAddress].length < MANAGING_OPERATORS_PER_ACCOUNT_LIMIT, "exceed managing operators per account limit");

            _operatorsInUseByAddress[ownerAddress][operatorId] = OperatorInUse({ index: _operatorIndexOf(operatorId), validatorCount: 1, used: 0, exists: true, indexInArray: uint32(_operatorsInUseList[ownerAddress].length) });
            _operatorsInUseList[ownerAddress].push(operatorId);
        }
    }

    function _disableOwnerValidatorsUnsafe(address ownerAddress) private {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);

        for (uint32 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            uint32 operatorId = _operatorsInUseList[ownerAddress][index];
            _updateOperatorBalance(operatorId);
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorId];
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorId);
            _operatorDatas[operatorId].activeValidatorCount -= operatorInUseData.validatorCount;
        }

        _ssvRegistryContract.disableOwnerValidators(ownerAddress);

        _owners[ownerAddress].validatorsDisabled = true;
    }

    function _enableOwnerValidatorsUnsafe(address ownerAddress) private {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);

        for (uint32 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            uint32 operatorId = _operatorsInUseList[ownerAddress][index];
            _updateOperatorBalance(operatorId);
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorId];
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorId);
            _operatorDatas[operatorId].activeValidatorCount += operatorInUseData.validatorCount;
        }

        _ssvRegistryContract.enableOwnerValidators(ownerAddress);

        _owners[ownerAddress].validatorsDisabled = false;
    }

    function _updateOperatorUsageByOwner(OperatorInUse storage operatorInUseData, address ownerAddress, uint32 operatorId) private {
        operatorInUseData.used = _operatorInUseUsageOf(operatorInUseData, ownerAddress, operatorId);
        operatorInUseData.index = _operatorIndexOf(operatorId);
    }

    function _updateLiquidationThresholdPeriod(uint64 newMinimumBlocksBeforeLiquidation) private {
        _minimumBlocksBeforeLiquidation = newMinimumBlocksBeforeLiquidation;

        emit LiquidationThresholdPeriodUpdated(_minimumBlocksBeforeLiquidation);
    }

    function _updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) private {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;

        emit OperatorFeeIncreaseLimitUpdated(_operatorMaxFeeIncrease);

    }

    function _updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) private {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;

        emit DeclareOperatorFeePeriodUpdated(newDeclareOperatorFeePeriod);
    }

    function _updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) private {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;

        emit ExecuteOperatorFeePeriodUpdated(newExecuteOperatorFeePeriod);
    }

    function _expensesOf(address ownerAddress) private view returns(uint64) {
        uint64 usage =  _owners[ownerAddress].used + _addressNetworkFee(ownerAddress);
        for (uint32 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][_operatorsInUseList[ownerAddress][index]];
            usage += _operatorInUseUsageOf(operatorInUseData, ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        return usage;
    }

    function _totalEarningsOf(address ownerAddress) private view returns (uint64) {
        uint64 earnings = 0;
        uint32[] memory operatorsByOwner = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
        for (uint32 index = 0; index < operatorsByOwner.length; ++index) {
            earnings += _operatorEarningsOf(operatorsByOwner[index]);
        }

        return earnings;
    }

    function _totalBalanceOf(address ownerAddress) private view returns (uint64) {
        uint64 balance = _owners[ownerAddress].deposited + _totalEarningsOf(ownerAddress);

        uint64 usage = _owners[ownerAddress].withdrawn + _expensesOf(ownerAddress);

        require(balance >= usage, "negative balance");

        return balance - usage;
    }

    function _operatorEarnRate(uint32 operatorId) private view returns (uint64) {
        return _ssvRegistryContract.getOperatorFee(operatorId) * _operatorDatas[operatorId].activeValidatorCount;
    }

    /**
     * @dev See {ISSVNetwork-operatorEarningsOf}.
     */
    function _operatorEarningsOf(uint32 operatorId) private view returns (uint64) {
        return _operatorDatas[operatorId].earnings +
               uint64(block.number - _operatorDatas[operatorId].blockNumber) *
               _operatorEarnRate(operatorId);
    }

    function _addressNetworkFee(address ownerAddress) private view returns (uint64) {
        return _owners[ownerAddress].networkFee +
              uint64(_currentNetworkFeeIndex() - _owners[ownerAddress].networkFeeIndex) *
              _owners[ownerAddress].activeValidatorCount;
    }

    function _burnRate(address ownerAddress) private view returns (uint64 ownerBurnRate) {
        if (_owners[ownerAddress].validatorsDisabled) {
            return 0;
        }

        for (uint32 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            ownerBurnRate += _operatorInUseBurnRateWithNetworkFeeUnsafe(ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        uint32[] memory operatorsByOwner = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);

        for (uint32 index = 0; index < operatorsByOwner.length; ++index) {
            if (ownerBurnRate <= _operatorEarnRate(operatorsByOwner[index])) {
                return 0;
            } else {
                ownerBurnRate -= _operatorEarnRate(operatorsByOwner[index]);
            }
        }
    }

    function _overdue(address ownerAddress) private view returns (bool) {
        return _totalBalanceOf(ownerAddress) < _minimumBlocksBeforeLiquidation * _burnRate(ownerAddress);
    }

    function _liquidatable(address ownerAddress) private view returns (bool) {
        return !_owners[ownerAddress].validatorsDisabled && _overdue(ownerAddress);
    }

    function _canLiquidate(address ownerAddress) private view returns (bool) {
        return !_owners[ownerAddress].validatorsDisabled && (msg.sender == ownerAddress || _overdue(ownerAddress));
    }

    function _getTotalNetworkEarnings() private view returns (uint64) {
        uint256 result = _networkEarnings + (block.number - _networkEarningsBlockNumber) * _networkFee * _ssvRegistryContract.activeValidatorCount();
        return uint64(result);
    }

    function _getNetworkTreasury() private view returns (uint64) {
        return _getTotalNetworkEarnings() - _withdrawnFromTreasury;
    }

    /**
     * @dev Get operator index by address.
     */
    function _operatorIndexOf(uint32 operatorId) private view returns (uint64) {
        return _operatorDatas[operatorId].index +
               _ssvRegistryContract.getOperatorFee(operatorId) *
               uint64(block.number - _operatorDatas[operatorId].indexBlockNumber);
    }

    function _operatorInUseUsageOf(OperatorInUse storage operatorInUseData, address ownerAddress, uint32 operatorId) private view returns (uint64) {
        return operatorInUseData.used + (
                _owners[ownerAddress].validatorsDisabled ? 0 :
                uint64(_operatorIndexOf(operatorId) - operatorInUseData.index) * operatorInUseData.validatorCount
               );
    }

    function _operatorInUseBurnRateWithNetworkFeeUnsafe(address ownerAddress, uint32 operatorId) private view returns (uint64) {
        OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorId];
        return (_ssvRegistryContract.getOperatorFee(operatorId) + _networkFee) * operatorInUseData.validatorCount;
    }

    /**
     * @dev Returns the current network fee index
     */
    function _currentNetworkFeeIndex() private view returns(uint64) {
        return _networkFeeIndex + uint64(block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }

    function version() external pure override returns (uint32) {
        return 1;
    }

    uint256[50] ______gap;
}