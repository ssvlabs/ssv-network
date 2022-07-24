// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/VersionedContract.sol";
import "./utils/Types.sol";
import "./ISSVNetwork.sol";

contract SSVNetwork is OwnableUpgradeable, ISSVNetwork, VersionedContract {
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

    uint16 constant private MINIMAL_OPERATOR_FEE = 1000;
    uint16 constant private MANAGING_OPERATORS_PER_ACCOUNT_LIMIT = 50;
    uint16 constant private MINIMAL_LIQUIDATION_THRESHOLD = 6570;

    function initialize(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) external initializer override {
        __SSVNetwork_init(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init_unchained(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint64 minimumBlocksBeforeLiquidation_,
        uint64 operatorMaxFeeIncrease_,
        uint64 declareOperatorFeePeriod_,
        uint64 executeOperatorFeePeriod_
    ) internal onlyInitializing {
        _ssvRegistryContract = registryAddress_;
        _token = token_;
        _updateLiquidationThresholdPeriod(minimumBlocksBeforeLiquidation_);
        _updateOperatorFeeIncreaseLimit(operatorMaxFeeIncrease_);
        _updateDeclareOperatorFeePeriod(declareOperatorFeePeriod_);
        _updateExecuteOperatorFeePeriod(executeOperatorFeePeriod_);
        _ssvRegistryContract.initialize();
    }

    modifier onlyValidatorOwnerOrContractOwner(bytes calldata publicKey) {
        _onlyValidatorOwnerOrContractOwner(publicKey);
        _;
    }

    modifier onlyOperatorOwnerOrContractOwner(uint32 operatorId) {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        _;
    }

    modifier ensureMinimalOperatorFee(uint256 fee) {
        _ensureMinimalOperatorFee(fee.shrink());
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
        emit OperatorRegistration(operatorId, name, msg.sender, publicKey, fee.shrink().expand());
    }

    /**
     * @dev See {ISSVNetwork-removeOperator}.
     */
    function removeOperator(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        address owner = _ssvRegistryContract.getOperatorOwner(operatorId);

        _updateOperatorFeeUnsafe(operatorId, 0);
        _ssvRegistryContract.removeOperator(operatorId);

        emit OperatorRemoval(operatorId, owner);
    }

    function declareOperatorFee(uint32 operatorId, uint256 operatorFee) onlyOperatorOwnerOrContractOwner(operatorId) ensureMinimalOperatorFee(operatorFee) external override {
        if (operatorFee.shrink() > _ssvRegistryContract.getOperatorFee(operatorId) * (10000 + _operatorMaxFeeIncrease) / 10000) {
            revert FeeExceedsIncreaseLimit();
        }
        _feeChangeRequests[operatorId] = FeeChangeRequest(operatorFee.shrink(), block.timestamp + _declareOperatorFeePeriod, block.timestamp + _declareOperatorFeePeriod + _executeOperatorFeePeriod);

        emit OperatorFeeDeclaration(msg.sender, operatorId, block.number, operatorFee);
    }

    function cancelDeclaredOperatorFee(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        delete _feeChangeRequests[operatorId];

        emit DeclaredOperatorFeeCancelation(msg.sender, operatorId);
    }

    function executeOperatorFee(uint32 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external override {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }
        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        emit OperatorFeeExecution(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());

        delete _feeChangeRequests[operatorId];
    }

    function updateOperatorScore(uint32 operatorId, uint32 score) onlyOwner external override {
        _ssvRegistryContract.updateOperatorScore(operatorId, score);

        emit OperatorScoreUpdate(operatorId, msg.sender, block.number, score);
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    function registerValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata sharesEncrypted,
        uint256 amount
    ) external override {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(msg.sender);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorIds, sharesPublicKeys, sharesEncrypted, amount);
    }

    /**
     * @dev See {ISSVNetwork-updateValidator}.
     */
    function updateValidator(
        bytes calldata publicKey,
        uint32[] calldata operatorIds,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata sharesEncrypted,
        uint256 amount
    ) onlyValidatorOwnerOrContractOwner(publicKey) external override {
        _removeValidatorUnsafe(msg.sender, publicKey);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorIds, sharesPublicKeys, sharesEncrypted, amount);
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

    function deposit(address ownerAddress, uint256 amount) external override {
        _deposit(ownerAddress, amount);
    }

    function withdraw(uint256 amount) external override {
        if(_totalBalanceOf(msg.sender) < amount.shrink()) {
            revert NotEnoughBalance();
        }

        _withdrawUnsafe(amount.shrink());

        if(_liquidatable(msg.sender)) {
            revert NotEnoughBalance();
        }
    }

    function withdrawAll() external override {
        if(_burnRate(msg.sender) > 0) {
            revert BurnRatePositive();
        }

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

    function reactivateAccount(uint256 amount) external override {
        if (!_owners[msg.sender].validatorsDisabled) {
            revert AccountAlreadyEnabled();
        }

        _deposit(msg.sender, amount);

        _enableOwnerValidatorsUnsafe(msg.sender);

        if(_liquidatable(msg.sender)) {
            revert NotEnoughBalance();
        }

        emit AccountEnable(msg.sender);
    }

    function updateLiquidationThresholdPeriod(uint64 blocks) external onlyOwner override {
        if(blocks < MINIMAL_LIQUIDATION_THRESHOLD) {
            revert BelowMinimumBlockPeriod();
        }

        _updateLiquidationThresholdPeriod(blocks);
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
        emit NetworkFeeUpdate(_networkFee.expand(), fee);
        _updateNetworkEarnings();
        _updateNetworkFeeIndex();
        _networkFee = fee.shrink();
    }

    function withdrawNetworkEarnings(uint256 amount) external onlyOwner override {
        if(amount.shrink() > _getNetworkEarnings()) {
            revert NotEnoughBalance();
        }

        _withdrawnFromTreasury += amount.shrink();
        _token.transfer(msg.sender, amount);

        emit NetworkFeesWithdrawal(amount, msg.sender);
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

    function getOperatorDeclaredFee(uint32 operatorId) external view override returns (uint256, uint256, uint256) {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        return (feeChangeRequest.fee.expand(), feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
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
        return _networkFee.expand();
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return _getNetworkEarnings().expand();
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

    function validatorsPerOperatorCount(uint32 operatorId) external view returns (uint32) {
        return _ssvRegistryContract.validatorsPerOperatorCount(operatorId);
    }

    function _deposit(address ownerAddress, uint256 amount) private {
        _token.transferFrom(msg.sender, address(this), amount);
        _owners[ownerAddress].deposited += amount.shrink();

        emit FundsDeposit(amount, ownerAddress, msg.sender);
    }

    function _withdrawUnsafe(uint64 amount) private {
        _owners[msg.sender].withdrawn += amount;
        _token.transfer(msg.sender, amount.expand());

        emit FundsWithdrawal(amount.expand(), msg.sender);
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

        emit AccountLiquidation(ownerAddress);

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

        if(_liquidatable(ownerAddress)) {
            revert NotEnoughBalance();
        }

        emit ValidatorRegistration(ownerAddress, publicKey, operatorIds, sharesPublicKeys, encryptedKeys);
    }

    function _removeValidatorUnsafe(address ownerAddress, bytes memory publicKey) private {
        _unregisterValidator(ownerAddress, publicKey);
        _ssvRegistryContract.removeValidator(publicKey);

        if (!_owners[ownerAddress].validatorsDisabled) {
            --_owners[ownerAddress].activeValidatorCount;
        }

        emit ValidatorRemoval(ownerAddress, publicKey);
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

    function _updateOperatorFeeUnsafe(uint32 operatorId, uint64 fee) private {
        OperatorData storage operatorData = _operatorDatas[operatorId];
        _updateOperatorIndex(operatorId);
        operatorData.indexBlockNumber = block.number;
        _updateOperatorBalance(operatorId);
        _ssvRegistryContract.updateOperatorFee(operatorId, fee);
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
            if (_operatorsInUseList[ownerAddress].length > MANAGING_OPERATORS_PER_ACCOUNT_LIMIT) {
                revert ExceedManagingOperatorsPerAccountLimit();
            }

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

        emit LiquidationThresholdPeriodUpdate(_minimumBlocksBeforeLiquidation);
    }

    function _updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) private {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;

        emit OperatorFeeIncreaseLimitUpdate(_operatorMaxFeeIncrease);

    }

    function _updateDeclareOperatorFeePeriod(uint64 newDeclareOperatorFeePeriod) private {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;

        emit DeclareOperatorFeePeriodUpdate(newDeclareOperatorFeePeriod);
    }

    function _updateExecuteOperatorFeePeriod(uint64 newExecuteOperatorFeePeriod) private {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;

        emit ExecuteOperatorFeePeriodUpdate(newExecuteOperatorFeePeriod);
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

        if(balance < usage) {
            revert NegativeBalance();
        }

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

        ownerBurnRate += _owners[ownerAddress].activeValidatorCount * _networkFee;

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

    function _getNetworkEarnings() private view returns (uint64) {
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
        return _ssvRegistryContract.getOperatorFee(operatorId) * operatorInUseData.validatorCount;
    }

    /**
     * @dev Returns the current network fee index
     */
    function _currentNetworkFeeIndex() private view returns(uint64) {
        return _networkFeeIndex + uint64(block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }

    function _onlyValidatorOwnerOrContractOwner(bytes calldata publicKey) private view {
        address validatorOwner = _ssvRegistryContract.getValidatorOwner(publicKey);
        if (validatorOwner == address(0)) {
            revert ValidatorWithPublicKeyNotExist();
        }
        if (msg.sender != validatorOwner && msg.sender != owner()) {
            revert CallerNotValidatorOwner();
        }
    }

    function _onlyOperatorOwnerOrContractOwner(uint32 operatorId) private view {
        address operatorOwner = _ssvRegistryContract.getOperatorOwner(operatorId);

        if(operatorOwner == address(0)) {
            revert OperatorWithPublicKeyNotExist();
        }

        if(msg.sender != operatorOwner && msg.sender != owner()) {
            revert CallerNotOperatorOwner();
        }
    }

    function _ensureMinimalOperatorFee(uint64 fee) private pure {
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }
    }

    function version() external pure override returns (uint32) {
        return 20000;
    }

    uint256[50] ______gap;
}