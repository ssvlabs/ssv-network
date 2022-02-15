// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "hardhat/console.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork {
    struct OperatorData {
        uint256 blockNumber;
        uint256 activeValidatorCount;
        uint256 earnings;
        uint256 index;
        uint256 indexBlockNumber;
        uint256 previousFee;
    }

    struct OwnerData {
        uint256 deposited;
        uint256 withdrawn;
        uint256 earned;
        uint256 used;
        uint256 networkFee;
        uint256 networkFeeIndex;
        uint256 activeValidatorCount;
        bool validatorsDisabled;
    }

    struct OperatorInUse {
        uint256 index;
        uint256 validatorCount;
        uint256 used;
        bool exists;
        uint256 indexInArray;
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

    mapping(bytes => OperatorData) private _operatorDatas;
    mapping(address => OwnerData) private _owners;
    mapping(address => mapping(bytes => OperatorInUse)) private _operatorsInUseByAddress;
    mapping(address => bytes[]) private _operatorsInUseList;
    mapping(bytes => uint256) private _lastOperatorUpdateNetworkFeeRun;

    uint256 private _setOperatorFeePeriod;
    uint256 private _approveOperatorFeePeriod;
    mapping(bytes => FeeChangeRequest) private _feeChangeRequests;

    uint256 constant MINIMAL_OPERATOR_FEE = 10000;

    function initialize(
        ISSVRegistry registryAddress,
        IERC20 token,
        uint256 minimumBlocksBeforeLiquidation,
        uint256 operatorMaxFeeIncrease,
        uint256 setOperatorFeePeriod,
        uint256 approveOperatorFeePeriod
    ) external initializer override {
        __SSVNetwork_init(registryAddress, token, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod);
    }

    function __SSVNetwork_init(
        ISSVRegistry registryAddress,
        IERC20 token,
        uint256 minimumBlocksBeforeLiquidation,
        uint256 operatorMaxFeeIncrease,
        uint256 setOperatorFeePeriod,
        uint256 approveOperatorFeePeriod
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress, token, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod);
    }

    function __SSVNetwork_init_unchained(
        ISSVRegistry registryAddress,
        IERC20 token,
        uint256 minimumBlocksBeforeLiquidation,
        uint256 operatorMaxFeeIncrease,
        uint256 setOperatorFeePeriod,
        uint256 approveOperatorFeePeriod
    ) internal initializer {
        _ssvRegistryContract = registryAddress;
        _token = token;
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation;
        _operatorMaxFeeIncrease = operatorMaxFeeIncrease;
        _setOperatorFeePeriod = setOperatorFeePeriod;
        _approveOperatorFeePeriod = approveOperatorFeePeriod;
        _ssvRegistryContract.initialize();
    }

    modifier onlyValidatorOwner(bytes calldata publicKey) {
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        require(
            owner != address(0),
            "validator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not validator owner");
        _;
    }

    modifier onlyOperatorOwner(bytes calldata publicKey) {
        address owner = _ssvRegistryContract.getOperatorOwner(publicKey);
        require(
            owner != address(0),
            "operator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not operator owner");
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
    ) ensureMinimalOperatorFee(fee) external override {
        _ssvRegistryContract.registerOperator(
            name,
            msg.sender,
            publicKey,
            fee
        );

        _operatorDatas[publicKey] = OperatorData(block.number, 0, 0, 0, block.number, block.timestamp);

        emit OperatorAdded(name, msg.sender, publicKey);
    }

    function batchRegisterOperator(
        string[] calldata name,
        address[] calldata ownerAddress,
        bytes[] calldata publicKey,
        uint256[] calldata fee
    ) external {
        require(name.length == publicKey.length && publicKey.length == fee.length && fee.length == ownerAddress.length);
        for (uint256 index = 0; index < name.length; ++index) {
            _ssvRegistryContract.registerOperator(
                name[index],
                ownerAddress[index],
                publicKey[index],
                fee[index]
            );
            _operatorDatas[publicKey[index]] = OperatorData(block.number, 0, 0, 0, block.number, block.timestamp);

            emit OperatorAdded(name[index], ownerAddress[index], publicKey[index]);
        }
    }

    /**
     * @dev See {ISSVNetwork-removeOperator}.
     */
    function removeOperator(bytes calldata publicKey) onlyOperatorOwner(publicKey) external override {
        require(_operatorDatas[publicKey].activeValidatorCount == 0, "operator has validators");
        address owner = _ssvRegistryContract.getOperatorOwner(publicKey);
        _owners[owner].earned += _operatorDatas[publicKey].earnings;
        delete _operatorDatas[publicKey];
        _ssvRegistryContract.removeOperator(publicKey);

        emit OperatorRemoved(owner, publicKey);
    }

    function activateOperator(bytes calldata publicKey) onlyOperatorOwner(publicKey) external override {
        _ssvRegistryContract.activateOperator(publicKey);
        _updateAddressNetworkFee(msg.sender);

        emit OperatorActivated(msg.sender, publicKey);
    }

    function deactivateOperator(bytes calldata publicKey) onlyOperatorOwner(publicKey) external override {
        require(_operatorDatas[publicKey].activeValidatorCount == 0, "operator has validators");

        _ssvRegistryContract.deactivateOperator(publicKey);

        emit OperatorDeactivated(msg.sender, publicKey);
    }

    function setOperatorFee(bytes calldata publicKey, uint256 fee) onlyOperatorOwner(publicKey) ensureMinimalOperatorFee(fee) external override {
        require(fee == _operatorDatas[publicKey].previousFee || fee <= _ssvRegistryContract.getOperatorCurrentFee(publicKey) * (100 + _operatorMaxFeeIncrease) / 100, "fee exceeds increase limit");
        _feeChangeRequests[publicKey] = FeeChangeRequest(fee, block.timestamp + _setOperatorFeePeriod, block.timestamp + _setOperatorFeePeriod + _approveOperatorFeePeriod);

        emit OperatorFeeSet(msg.sender, publicKey, block.number, fee);
    }

    function cancelSetOperatorFee(bytes calldata publicKey) onlyOperatorOwner(publicKey) external override {
        delete _feeChangeRequests[publicKey];

        emit OperatorFeeSetCanceled(msg.sender, publicKey);
    }

    function approveOperatorFee(bytes calldata publicKey) onlyOperatorOwner(publicKey) external override {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[publicKey];

        require(feeChangeRequest.fee > 0, "no pending fee change request");
        require(block.timestamp >= feeChangeRequest.approvalBeginTime && block.timestamp <= feeChangeRequest.approvalEndTime, "approval not within timeframe");

        _updateOperatorIndex(publicKey);
        _operatorDatas[publicKey].indexBlockNumber = block.number;
        _updateOperatorBalance(publicKey);
        _operatorDatas[publicKey].previousFee = _ssvRegistryContract.getOperatorCurrentFee(publicKey);
        _ssvRegistryContract.updateOperatorFee(publicKey, feeChangeRequest.fee);

        emit OperatorFeeApproved(msg.sender, publicKey, block.number, feeChangeRequest.fee);

        delete _feeChangeRequests[publicKey];
    }

    function updateOperatorScore(bytes calldata publicKey, uint256 score) onlyOwner external override {
        _ssvRegistryContract.updateOperatorScore(publicKey, score);

        emit OperatorScoreUpdated(msg.sender, publicKey, block.number, score);
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    function registerValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external override {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(msg.sender);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorPublicKeys, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    function batchRegisterValidator(
        address ownerAddress,
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);
        _registerValidatorUnsafe(ownerAddress, publicKey, operatorPublicKeys, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-updateValidator}.
     */
    function updateValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) onlyValidatorOwner(publicKey) external override {
        _removeValidatorUnsafe(msg.sender, publicKey);
        _registerValidatorUnsafe(msg.sender, publicKey, operatorPublicKeys, sharesPublicKeys, encryptedKeys, tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-removeValidator}.
     */
    function removeValidator(bytes calldata publicKey) onlyValidatorOwner(publicKey) external override {
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

    function updateMinimumBlocksBeforeLiquidation(uint256 minimumBlocksBeforeLiquidation) external onlyOwner override {
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation;
    }

    function updateOperatorMaxFeeIncrease(uint256 operatorMaxFeeIncrease) external onlyOwner override {
        _operatorMaxFeeIncrease = operatorMaxFeeIncrease;
    }

    function updateSetOperatorFeePeriod(uint256 setOperatorFeePeriod) external onlyOwner override {
        _setOperatorFeePeriod = setOperatorFeePeriod;

        emit SetOperatorFeePeriodUpdated(setOperatorFeePeriod);
    }

    function updateApproveOperatorFeePeriod(uint256 approveOperatorFeePeriod) external onlyOwner override {
        _approveOperatorFeePeriod = approveOperatorFeePeriod;

        emit ApproveOperatorFeePeriodUpdated(approveOperatorFeePeriod);
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
    function operators(bytes calldata publicKey) external view override returns (string memory, address, bytes memory, uint256, bool, uint256) {
        return _ssvRegistryContract.operators(publicKey);
    }

    function getOperatorFeeChangeRequest(bytes calldata publicKey) external view override returns (uint256, uint256, uint256) {
        FeeChangeRequest storage feeChangeRequest = _feeChangeRequests[publicKey];

        return (feeChangeRequest.fee, feeChangeRequest.approvalBeginTime, feeChangeRequest.approvalEndTime);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorCurrentFee}.
     */
    function getOperatorCurrentFee(bytes calldata operatorPublicKey) external view override returns (uint256) {
        return _ssvRegistryContract.getOperatorCurrentFee(operatorPublicKey);
    }

    /**
     * @dev See {ISSVNetwork-operatorEarningsOf}.
     */
    function operatorEarningsOf(bytes memory publicKey) external view override returns (uint256) {
        return _operatorEarningsOf(publicKey);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorsByOwnerAddress}.
     */
    function getOperatorsByOwnerAddress(address ownerAddress) external view override returns (bytes[] memory) {
        return _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-getOperatorsByValidator}.
     */
    function getOperatorsByValidator(bytes memory publicKey) external view override returns (bytes[] memory) {
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

    function _updateOperatorIndex(bytes calldata publicKey) private {
        _operatorDatas[publicKey].index = _operatorIndexOf(publicKey);
    }

    /**
     * @dev Updates operators's balance.
     * @param publicKey The operators's public key.
     */
    function _updateOperatorBalance(bytes memory publicKey) private {
        OperatorData storage operatorData = _operatorDatas[publicKey];
        operatorData.earnings = _operatorEarningsOf(publicKey);
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
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount) private {
        _ssvRegistryContract.registerValidator(
            ownerAddress,
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );

        if (!_owners[ownerAddress].validatorsDisabled) {
            ++_owners[ownerAddress].activeValidatorCount;
        }

        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            bytes calldata operatorPublicKey = operatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);

            if (!_owners[ownerAddress].validatorsDisabled) {
                ++_operatorDatas[operatorPublicKey].activeValidatorCount;
            }

            _useOperatorByOwner(ownerAddress, operatorPublicKey);
        }

        if (tokenAmount > 0) {
            _deposit(tokenAmount);
        }

        require(!_liquidatable(ownerAddress), "not enough balance");


        emit ValidatorAdded(ownerAddress, publicKey, operatorPublicKeys, sharesPublicKeys, encryptedKeys);
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
        bytes[] memory currentOperatorPublicKeys = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        for (uint256 index = 0; index < currentOperatorPublicKeys.length; ++index) {
            bytes memory operatorPublicKey = currentOperatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);

            if (!_owners[msg.sender].validatorsDisabled) {
                --_operatorDatas[operatorPublicKey].activeValidatorCount;
            }

            _stopUsingOperatorByOwner(ownerAddress, operatorPublicKey);
        }
    }

    function _useOperatorByOwner(address ownerAddress, bytes memory operatorPublicKey) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorPublicKey, true);
    }

    function _stopUsingOperatorByOwner(address ownerAddress, bytes memory operatorPublicKey) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorPublicKey, false);
    }

    /**
     * @dev Updates the relation between operator and owner
     * @param ownerAddress Owner address.
     * @param operatorPublicKey The operator's public key.
     * @param increase Change value for validators amount.
     */
    function _updateUsingOperatorByOwner(address ownerAddress, bytes memory operatorPublicKey, bool increase) private {
        OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];

        if (operatorInUseData.exists) {
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorPublicKey);

            if (increase) {
                ++operatorInUseData.validatorCount;
            } else {
                if (--operatorInUseData.validatorCount == 0) {
                    _owners[ownerAddress].used += operatorInUseData.used;

                    // remove from mapping and list;

                    _operatorsInUseList[ownerAddress][operatorInUseData.indexInArray] = _operatorsInUseList[ownerAddress][_operatorsInUseList[ownerAddress].length - 1];
                    _operatorsInUseByAddress[ownerAddress][_operatorsInUseList[ownerAddress][operatorInUseData.indexInArray]].indexInArray = operatorInUseData.indexInArray;
                    _operatorsInUseList[ownerAddress].pop();

                    delete _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
                }
            }
        } else {
            _operatorsInUseByAddress[ownerAddress][operatorPublicKey] = OperatorInUse(_operatorIndexOf(operatorPublicKey), 1, 0, true, _operatorsInUseList[ownerAddress].length);
            _operatorsInUseList[ownerAddress].push(operatorPublicKey);
        }
    }

    function _disableOwnerValidatorsUnsafe(address ownerAddress) private {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            bytes memory operatorPublicKey = _operatorsInUseList[ownerAddress][index];
            _updateOperatorBalance(operatorPublicKey);
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorPublicKey);
            _operatorDatas[operatorPublicKey].activeValidatorCount -= operatorInUseData.validatorCount;
        }

        _ssvRegistryContract.disableOwnerValidators(ownerAddress);

        _owners[ownerAddress].validatorsDisabled = true;
    }

    function _enableOwnerValidatorsUnsafe(address ownerAddress) private {
        _updateNetworkEarnings();
        _updateAddressNetworkFee(ownerAddress);

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            bytes memory operatorPublicKey = _operatorsInUseList[ownerAddress][index];
            _updateOperatorBalance(operatorPublicKey);
            OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
            _updateOperatorUsageByOwner(operatorInUseData, ownerAddress, operatorPublicKey);
            _operatorDatas[operatorPublicKey].activeValidatorCount += operatorInUseData.validatorCount;
        }

        _ssvRegistryContract.enableOwnerValidators(ownerAddress);

        _owners[ownerAddress].validatorsDisabled = false;
    }

    function _updateOperatorUsageByOwner(OperatorInUse storage operatorInUseData, address ownerAddress, bytes memory operatorPublicKey) private {
        operatorInUseData.used = _operatorInUseUsageOf(operatorInUseData, ownerAddress, operatorPublicKey);
        operatorInUseData.index = _operatorIndexOf(operatorPublicKey);
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

        bytes[] memory operators = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
        for (uint256 index = 0; index < operators.length; ++index) {
            balance += _operatorEarningsOf(operators[index]);
        }

        return balance;
    }

    function _totalBalanceOf(address ownerAddress) private view returns (uint256) {
        uint256 balance = _owners[ownerAddress].deposited + _totalEarningsOf(ownerAddress);

        uint256 usage = _owners[ownerAddress].withdrawn + _expensesOf(ownerAddress);

        require(balance >= usage, "negative balance");

        return balance - usage;
    }

    function _operatorEarnRate(bytes memory publicKey) private view returns (uint256) {
        return _ssvRegistryContract.getOperatorCurrentFee(publicKey) * _operatorDatas[publicKey].activeValidatorCount;
    }

    /**
     * @dev See {ISSVNetwork-operatorEarningsOf}.
     */
    function _operatorEarningsOf(bytes memory publicKey) private view returns (uint256) {
        return _operatorDatas[publicKey].earnings +
               (block.number - _operatorDatas[publicKey].blockNumber) *
               _operatorEarnRate(publicKey);
    }

    function _addressNetworkFee(address ownerAddress) private view returns (uint256) {
        return _owners[ownerAddress].networkFee +
              (_currentNetworkFeeIndex() - _owners[ownerAddress].networkFeeIndex) *
              _owners[ownerAddress].activeValidatorCount;
    }

    function _burnRate(address ownerAddress) private view returns (uint256 burnRate) {
        if (_owners[ownerAddress].validatorsDisabled) {
            return 0;
        }

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            burnRate += _operatorInUseBurnRateWithNetworkFeeUnsafe(ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        bytes[] memory operators = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);

        for (uint256 index = 0; index < operators.length; ++index) {
            if (burnRate <= _operatorEarnRate(operators[index])) {
                return 0;
            } else {
                burnRate -= _operatorEarnRate(operators[index]);
            }
        }
    }

    function _overdue(address ownerAddress) private view returns (bool) {
        return _totalBalanceOf(ownerAddress) < _minimumBlocksBeforeLiquidation * _burnRate(ownerAddress);
    }

    function _liquidatable(address ownerAddress) private view returns (bool) {
        return !_owners[msg.sender].validatorsDisabled && _overdue(ownerAddress);
    }

    function _canLiquidate(address ownerAddress) private view returns (bool) {
        return !_owners[msg.sender].validatorsDisabled && (msg.sender == ownerAddress || _overdue(ownerAddress));
    }

    function _getNetworkEarnings() private view returns (uint256) {
        return _networkEarnings + (block.number - _networkEarningsBlockNumber) * _networkFee * _ssvRegistryContract.activeValidatorCount();
    }

    function _getNetworkTreasury() private view returns (uint256) {
        return  _getNetworkEarnings() - _withdrawnFromTreasury;
    }

    /**
     * @dev Get operator index by address.
     * @param publicKey Operator's public Key.
     */
    function _operatorIndexOf(bytes memory publicKey) private view returns (uint256) {
        return _operatorDatas[publicKey].index +
               _ssvRegistryContract.getOperatorCurrentFee(publicKey) *
               (block.number - _operatorDatas[publicKey].indexBlockNumber);
    }

    function test_operatorIndexOf(bytes memory publicKey) public view returns (uint256) {
        return _operatorIndexOf(publicKey);
    }

    function _operatorInUseUsageOf(OperatorInUse storage operatorInUseData, address ownerAddress, bytes memory operatorPublicKey) private view returns (uint256) {
        return operatorInUseData.used + (
                _owners[ownerAddress].validatorsDisabled ? 0 :
                (_operatorIndexOf(operatorPublicKey) - operatorInUseData.index) * operatorInUseData.validatorCount
               );
    }

    function _operatorInUseBurnRateWithNetworkFeeUnsafe(address ownerAddress, bytes memory operatorPublicKey) private view returns (uint256) {
        OperatorInUse storage operatorInUseData = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
        return (_ssvRegistryContract.getOperatorCurrentFee(operatorPublicKey) + _networkFee) * operatorInUseData.validatorCount;
    }

    /**
     * @dev Returns the current network fee index
     */
    function _currentNetworkFeeIndex() private view returns(uint256) {
        return _networkFeeIndex + (block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }
}