// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/VersionedContract.sol";
import "./ISSVNetwork.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork, VersionedContract {
    struct OperatorData {
        uint256 blockNumber;
        uint256 earnings;
        uint256 index;
        uint256 indexBlockNumber;
        uint256 previousFee;
        uint32 activeValidatorCount;
    }

    struct OwnerData {
        uint256 deposited;
        uint256 withdrawn;
        uint256 earned;
        uint256 used;
        uint256 networkFee;
        uint256 networkFeeIndex;
        uint32 activeValidatorCount;
        bool validatorsDisabled;
    }

    struct OperatorInUse {
        uint256 index;
        uint256 used;
        uint32 validatorCount;
        uint32 indexInArray;
        bool exists;
    }

    struct FeeChangeRequest {
        uint256 fee;
        uint256 approvalBeginTime;
        uint256 approvalEndTime;
    }

    ISSVRegistry private _ssvRegistryContract;
    IERC20 private _token;
    uint256 private _minimumBlocksBeforeLiquidation;
    uint256 private _operatorMaxFeeIncrease;

    uint256 private _networkFee;
    uint256 private _networkFeeIndex;
    uint256 private _networkFeeIndexBlockNumber;
    uint256 private _networkEarnings;
    uint256 private _networkEarningsBlockNumber;
    uint256 private _withdrawnFromTreasury;

    mapping(uint32 => OperatorData) private _operatorDatas;
    mapping(address => OwnerData) private _owners;
    mapping(address => mapping(uint32 => OperatorInUse)) private _operatorsInUseByAddress;
    mapping(address => uint32[]) private _operatorsInUseList;

    uint256 private _setOperatorFeePeriod;
    uint256 private _approveOperatorFeePeriod;
    mapping(uint32 => FeeChangeRequest) private _feeChangeRequests;

    uint256 constant MINIMAL_OPERATOR_FEE = 10000;

    function initialize(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint256 minimumBlocksBeforeLiquidation_,
        uint256 operatorMaxFeeIncrease_,
        uint256 setOperatorFeePeriod_,
        uint256 approveOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_
    ) external initializer override {
        __SSVNetwork_init(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, setOperatorFeePeriod_, approveOperatorFeePeriod_, validatorsPerOperatorLimit_);
    }

    function __SSVNetwork_init(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint256 minimumBlocksBeforeLiquidation_,
        uint256 operatorMaxFeeIncrease_,
        uint256 setOperatorFeePeriod_,
        uint256 approveOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_
    ) internal onlyInitializing {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress_, token_, minimumBlocksBeforeLiquidation_, operatorMaxFeeIncrease_, setOperatorFeePeriod_, approveOperatorFeePeriod_, validatorsPerOperatorLimit_);
    }

    function __SSVNetwork_init_unchained(
        ISSVRegistry registryAddress_,
        IERC20 token_,
        uint256 minimumBlocksBeforeLiquidation_,
        uint256 operatorMaxFeeIncrease_,
        uint256 setOperatorFeePeriod_,
        uint256 approveOperatorFeePeriod_,
        uint16 validatorsPerOperatorLimit_
    ) internal onlyInitializing {
        _ssvRegistryContract = registryAddress_;
        _token = token_;
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation_;
        _operatorMaxFeeIncrease = operatorMaxFeeIncrease_;
        _setOperatorFeePeriod = setOperatorFeePeriod_;
        _approveOperatorFeePeriod = approveOperatorFeePeriod_;
        _ssvRegistryContract.initialize(validatorsPerOperatorLimit_);
    }

    modifier onlyValidatorOwnerOrDAO(bytes calldata publicKey) {
        address validatorOwner = _ssvRegistryContract.getValidatorOwner(publicKey);
        require(
            validatorOwner != address(0),
            "validator with public key does not exist"
        );
        require(msg.sender == validatorOwner || msg.sender == owner(), "caller is not validator owner");
        _;
    }

    modifier onlyOperatorOwnerOrDAO(uint32 operatorId) {
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
            fee
        );

        _operatorDatas[operatorId] = OperatorData({ blockNumber: block.number, earnings: 0, index: 0, indexBlockNumber: block.number, previousFee: 0, activeValidatorCount: 0 });
    }

    /**
     * @dev See {ISSVNetwork-removeOperator}.
     */
    function removeOperator(uint32 operatorId) onlyOperatorOwnerOrDAO(operatorId) external override {
        _updateOperatorFeeUnsafe(operatorId, 0);
        _ssvRegistryContract.removeOperator(operatorId);
    }

    function setOperatorFee(uint32 operatorId, uint256 fee) onlyOperatorOwnerOrDAO(operatorId) ensureMinimalOperatorFee(fee) external override {
        require(fee == _operatorDatas[operatorId].previousFee || fee <= _ssvRegistryContract.getOperatorCurrentFee(operatorId) * (100 + _operatorMaxFeeIncrease) / 100, "fee exceeds increase limit");
        _feeChangeRequests[operatorId] = FeeChangeRequest(fee, block.timestamp + _setOperatorFeePeriod, block.timestamp + _setOperatorFeePeriod + _approveOperatorFeePeriod);

        emit OperatorFeeSet(msg.sender, operatorId, block.number, fee);
    }

    function cancelSetOperatorFee(uint32 operatorId) onlyOperatorOwnerOrDAO(operatorId) external override {
        delete _feeChangeRequests[operatorId];

        emit OperatorFeeSetCanceled(msg.sender, operatorId);
    }

    function approveOperatorFee(uint32 operatorId) onlyOperatorOwnerOrDAO(operatorId) external override {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        require(feeChangeRequest.fee > 0, "no pending fee change request");
        require(block.timestamp >= feeChangeRequest.approvalBeginTime && block.timestamp <= feeChangeRequest.approvalEndTime, "approval not within timeframe");

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        emit OperatorFeeApproved(msg.sender, operatorId, block.number, feeChangeRequest.fee);

        delete _feeChangeRequests[operatorId];
    }

    function updateOperatorScore(uint32 operatorId, uint16 score) onlyOwner external override {
        _ssvRegistryContract.updateOperatorScore(operatorId, score);
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
    ) onlyValidatorOwnerOrDAO(publicKey) external override {
        _removeValidatorUnsafe(msg.sender, publicKey);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorIds, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-removeValidator}.
     */
    function removeValidator(bytes calldata publicKey) onlyValidatorOwnerOrDAO(publicKey) external override {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(msg.sender);
        _removeValidatorUnsafe(msg.sender, publicKey);
        _totalBalanceOf(msg.sender); // For assertion
    }

    function deposit(uint256 tokenAmount) external override {
        _deposit(tokenAmount);
    }

    function withdraw(uint256 tokenAmount) external override {
        require(_totalBalanceOf(msg.sender) >= tokenAmount, "not enough balance");

        _withdrawUnsafe(tokenAmount);

        require(!_liquidatable(msg.sender), "not enough balance");
    }

    function withdrawAll() external override {
        require(_burnRate(msg.sender) == 0, "burn rate positive");

        _withdrawUnsafe(_totalBalanceOf(msg.sender));
    }

    function liquidate(address[] calldata ownerAddresses) external override {
        uint balanceToTransfer = 0;

        for (uint256 index = 0; index < ownerAddresses.length; ++index) {
            if (_canLiquidate(ownerAddresses[index])) {
                balanceToTransfer += _liquidateUnsafe(ownerAddresses[index]);
            }
        }

        _token.transfer(msg.sender, balanceToTransfer);
    }

    function enableAccount(uint256 tokenAmount) external override {
        require(_owners[msg.sender].validatorsDisabled, "account already enabled");

        _deposit(tokenAmount);

        _enableOwnerValidatorsUnsafe(msg.sender);

        require(!_liquidatable(msg.sender), "not enough balance");

        emit AccountEnabled(msg.sender);
    }

    function updateMinimumBlocksBeforeLiquidation(uint256 newMinimumBlocksBeforeLiquidation) external onlyOwner override {
        _minimumBlocksBeforeLiquidation = newMinimumBlocksBeforeLiquidation;
    }

    function updateOperatorMaxFeeIncrease(uint256 newOperatorMaxFeeIncrease) external onlyOwner override {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;
    }

    function updateSetOperatorFeePeriod(uint256 newSetOperatorFeePeriod) external onlyOwner override {
        _setOperatorFeePeriod = newSetOperatorFeePeriod;

        emit SetOperatorFeePeriodUpdated(newSetOperatorFeePeriod);
    }

    function updateApproveOperatorFeePeriod(uint256 newApproveOperatorFeePeriod) external onlyOwner override {
        _approveOperatorFeePeriod = newApproveOperatorFeePeriod;

        emit ApproveOperatorFeePeriodUpdated(newApproveOperatorFeePeriod);
    }

    /**
     * @dev See {ISSVNetwork-updateNetworkFee}.
     */
    function updateNetworkFee(uint256 fee) external onlyOwner override {
        emit NetworkFeeUpdated(_networkFee, fee);
        _updateNetworkEarnings();
        _updateNetworkFeeIndex();
        _networkFee = fee;
    }

    function withdrawNetworkFees(uint256 amount) external onlyOwner override {
        require(amount <= _getNetworkTreasury(), "not enough balance");
        _withdrawnFromTreasury += amount;
        _token.transfer(msg.sender, amount);

        emit NetworkFeesWithdrawn(amount, msg.sender);
    }

    function totalEarningsOf(address ownerAddress) external override view returns (uint256) {
        return _totalEarningsOf(ownerAddress);
    }

    function totalBalanceOf(address ownerAddress) external override view returns (uint256) {
        return _totalBalanceOf(ownerAddress);
    }

    function isOwnerValidatorsDisabled(address ownerAddress) external view override returns (bool) {
        return _owners[ownerAddress].validatorsDisabled;
    }

    /**
     * @dev See {ISSVNetwork-operators}.
     */
    function operators(uint32 operatorId) external view override returns (string memory, address, bytes memory, uint256, bool) {
        return _ssvRegistryContract.operators(operatorId);
    }

    /**
     * @dev See {ISSVNetwork-operatorsByPublicKey}.
     */
    function operatorsByPublicKey(bytes memory publicKey) external view override returns (string memory, address, bytes memory, uint256, bool) {
        return _ssvRegistryContract.operatorsByPublicKey(publicKey);
    }

    function getOperatorFeeChangeRequest(uint32 operatorId) external view override returns (uint256, uint256, uint256) {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[operatorId];

        return (feeChangeRequest.fee, feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(uint32 operatorId) external view override returns (uint256) {
        return _ssvRegistryContract.getOperatorCurrentFee(operatorId);
    }

    /**
     * @dev See {ISSVNetwork-operatorEarningsOf}.
     */
    function operatorEarningsOf(uint32 operatorId) external view override returns (uint256) {
        return _operatorEarningsOf(operatorId);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorsByOwnerAddress}.
     */
    function getOperatorsByOwnerAddress(address ownerAddress) external view override returns (uint32[] memory) {
        return _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
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


    function burnRate(address ownerAddress) external view override returns (uint256) {
        return _burnRate(ownerAddress);
    }

    function liquidatable(address ownerAddress) external view override returns (bool) {
        return _liquidatable(ownerAddress);
    }

    function networkFee() external view override returns (uint256) {
        return _networkFee;
    }

    function getNetworkTreasury() external view override returns (uint256) {
        return _getNetworkTreasury();
    }

    function minimumBlocksBeforeLiquidation() external view override returns (uint256) {
        return _minimumBlocksBeforeLiquidation;
    }

    function operatorMaxFeeIncrease() external view override returns (uint256) {
        return _operatorMaxFeeIncrease;
    }

    function getSetOperatorFeePeriod() external view override returns (uint256) {
        return _setOperatorFeePeriod;
    }

    function getApproveOperatorFeePeriod() external view override returns (uint256) {
        return _approveOperatorFeePeriod;
    }

    function setValidatorsPerOperatorLimit(uint16 validatorsPerOperatorLimit_) external onlyOwner {
        _ssvRegistryContract.setValidatorsPerOperatorLimit(validatorsPerOperatorLimit_);
    }

    function validatorsPerOperatorCount(uint32 operatorId_) external view returns (uint16) {
        return _ssvRegistryContract.validatorsPerOperatorCount(operatorId_);
    }

    function getValidatorsPerOperatorLimit() external view returns (uint16) {
        return _ssvRegistryContract.getValidatorsPerOperatorLimit();
    }

    function _deposit(uint256 tokenAmount) private {
        _token.transferFrom(msg.sender, address(this), tokenAmount);
        _owners[msg.sender].deposited += tokenAmount;

        emit FundsDeposited(tokenAmount, msg.sender);
    }

    function _withdrawUnsafe(uint256 tokenAmount) private {
        _owners[msg.sender].withdrawn += tokenAmount;
        _token.transfer(msg.sender, tokenAmount);

        emit FundsWithdrawn(tokenAmount, msg.sender);
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

    function _liquidateUnsafe(address ownerAddress) private returns (uint256) {
        _disableOwnerValidatorsUnsafe(ownerAddress);

        uint256 balanceToTransfer = _totalBalanceOf(ownerAddress);

        _owners[ownerAddress].used += balanceToTransfer;

        emit AccountLiquidated(ownerAddress);

        return balanceToTransfer;
    }

    function _updateNetworkEarnings() private {
        _networkEarnings = _getNetworkEarnings();
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

        for (uint256 index = 0; index < operatorIds.length; ++index) {
            uint32 operatorId = operatorIds[index];
            _updateOperatorBalance(operatorId);

            if (!owner.validatorsDisabled) {
                ++_operatorDatas[operatorId].activeValidatorCount;
            }

            _useOperatorByOwner(ownerAddress, operatorId);
        }

        if (tokenAmount > 0) {
            _deposit(tokenAmount);
        }

        require(!_liquidatable(ownerAddress), "not enough balance");
    }

    function _removeValidatorUnsafe(address ownerAddress, bytes memory publicKey) private {
        _unregisterValidator(ownerAddress, publicKey);
        _ssvRegistryContract.removeValidator(publicKey);

        if (!_owners[ownerAddress].validatorsDisabled) {
            --_owners[ownerAddress].activeValidatorCount;
        }
    }

    function _unregisterValidator(address ownerAddress, bytes memory publicKey) private {
        // calculate balances for current operators in use and update their balances
        uint32[] memory currentOperatorIds = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        for (uint256 index = 0; index < currentOperatorIds.length; ++index) {
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
        operatorData.previousFee = _ssvRegistryContract.getOperatorCurrentFee(operatorId);
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
            _operatorsInUseByAddress[ownerAddress][operatorId] = OperatorInUse({index: _operatorIndexOf(operatorId), used: 0, exists: true, validatorCount: 1, indexInArray: uint32(_operatorsInUseList[ownerAddress].length)});
            _operatorsInUseList[ownerAddress].push(operatorId);
        }
    }

    function _disableOwnerValidatorsUnsafe(address ownerAddress) private {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
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

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
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

    function _expensesOf(address ownerAddress) private view returns(uint256) {
        uint256 usage =  _owners[ownerAddress].used + _addressNetworkFee(ownerAddress);
        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][_operatorsInUseList[ownerAddress][index]];
            usage += _operatorInUseUsageOf(operatorInUseData, ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        return usage;
    }

    function _totalEarningsOf(address ownerAddress) private view returns (uint256) {
        uint256 balance = _owners[ownerAddress].earned;

        uint32[] memory operatorsByOwner = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
        for (uint256 index = 0; index < operatorsByOwner.length; ++index) {
            balance += _operatorEarningsOf(operatorsByOwner[index]);
        }

        return balance;
    }

    function _totalBalanceOf(address ownerAddress) private view returns (uint256) {
        uint256 balance = _owners[ownerAddress].deposited + _totalEarningsOf(ownerAddress);

        uint256 usage = _owners[ownerAddress].withdrawn + _expensesOf(ownerAddress);

        require(balance >= usage, "negative balance");

        return balance - usage;
    }

    function _operatorEarnRate(uint32 operatorId) private view returns (uint256) {
        return _ssvRegistryContract.getOperatorCurrentFee(operatorId) * _operatorDatas[operatorId].activeValidatorCount;
    }

    /**
     * @dev See {ISSVNetwork-operatorEarningsOf}.
     */
    function _operatorEarningsOf(uint32 operatorId) private view returns (uint256) {
        return _operatorDatas[operatorId].earnings +
               (block.number - _operatorDatas[operatorId].blockNumber) *
               _operatorEarnRate(operatorId);
    }

    function _addressNetworkFee(address ownerAddress) private view returns (uint256) {
        return _owners[ownerAddress].networkFee +
              (_currentNetworkFeeIndex() - _owners[ownerAddress].networkFeeIndex) *
              _owners[ownerAddress].activeValidatorCount;
    }

    function _burnRate(address ownerAddress) private view returns (uint256 ownerBurnRate) {
        if (_owners[ownerAddress].validatorsDisabled) {
            return 0;
        }

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            ownerBurnRate += _operatorInUseBurnRateWithNetworkFeeUnsafe(ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        uint32[] memory operatorsByOwner = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);

        for (uint256 index = 0; index < operatorsByOwner.length; ++index) {
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

    function _getNetworkEarnings() private view returns (uint256) {
        return _networkEarnings + (block.number - _networkEarningsBlockNumber) * _networkFee * _ssvRegistryContract.activeValidatorCount();
    }

    function _getNetworkTreasury() private view returns (uint256) {
        return  _getNetworkEarnings() - _withdrawnFromTreasury;
    }

    /**
     * @dev Get operator index by address.
     */
    function _operatorIndexOf(uint32 operatorId) private view returns (uint256) {
        return _operatorDatas[operatorId].index +
               _ssvRegistryContract.getOperatorCurrentFee(operatorId) *
               (block.number - _operatorDatas[operatorId].indexBlockNumber);
    }

    function _operatorInUseUsageOf(OperatorInUse storage operatorInUseData, address ownerAddress, uint32 operatorId) private view returns (uint256) {
        return operatorInUseData.used + (
                _owners[ownerAddress].validatorsDisabled ? 0 :
                (_operatorIndexOf(operatorId) - operatorInUseData.index) * operatorInUseData.validatorCount
               );
    }

    function _operatorInUseBurnRateWithNetworkFeeUnsafe(address ownerAddress, uint32 operatorId) private view returns (uint256) {
        OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorId];
        return (_ssvRegistryContract.getOperatorCurrentFee(operatorId) + _networkFee) * operatorInUseData.validatorCount;
    }

    /**
     * @dev Returns the current network fee index
     */
    function _currentNetworkFeeIndex() private view returns(uint256) {
        return _networkFeeIndex + (block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }

    function version() external pure override returns (uint32) {
        return 1;
    }

    uint256[50] ______gap;
}