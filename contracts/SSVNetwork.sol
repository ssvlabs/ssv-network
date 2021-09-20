// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "hardhat/console.sol";


contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork {
    ISSVRegistry private _ssvRegistryContract;
    IERC20 private _token;

    uint256 private _networkFee;
    uint256 private _networkFeePrevIndex;
    uint256 private _networkFeePrevBlockNumber;

    mapping(bytes => OperatorBalanceSnapshot) private _operatorBalances;
    mapping(bytes => ValidatorUsageSnapshot) private _validatorUsages;
    mapping(address => OwnerData) private _owners;
    mapping(address => mapping(bytes => OperatorInUse)) private _operatorsInUseByAddress;
    mapping(address => bytes[]) private _operatorsInUseList;
    // uint256 minValidatorBlockSubscription;

    function initialize(ISSVRegistry registryAddress, IERC20 token) external initializer virtual override {
        __SSVNetwork_init(registryAddress, token);
    }

    function __SSVNetwork_init(ISSVRegistry registryAddress, IERC20 token) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress, token);
    }

    function __SSVNetwork_init_unchained(ISSVRegistry registryAddress, IERC20 token) internal initializer {
        _ssvRegistryContract = registryAddress;
        _token = token;
        _ssvRegistryContract.initialize();
    }

    modifier onlyValidator(bytes calldata publicKey) {
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        require(
            owner != address(0),
            "validator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not validator owner");
        _;
    }

    modifier onlyOperator(bytes calldata publicKey) {
        address owner = _ssvRegistryContract.getOperatorOwner(publicKey);
        require(
            owner != address(0),
            "operator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not operator owner");
        _;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata publicKey, uint256 fee) external onlyOperator(publicKey) virtual override {
        // console.log("update fee operator block", block.number);
        _operatorBalances[publicKey].index = _operatorIndexOf(publicKey);
        _operatorBalances[publicKey].indexBlockNumber = block.number;
        _updateOperatorBalance(publicKey);
        _ssvRegistryContract.updateOperatorFee(publicKey, fee);
    }

    /**
     * @dev See {ISSVNetwork-updateNetworkFee}.
     */
    function updateNetworkFee(uint256 networkFee) external onlyOwner virtual override {
        // console.log("set new fee", block.number, networkFee);
        _networkFeePrevIndex = _currentNetworkFeeIndex();
        _networkFee = networkFee;
        _networkFeePrevBlockNumber = block.number;
    }

    function _currentNetworkFeeIndex() private view returns(uint256) {
        return _networkFeePrevIndex + (block.number - _networkFeePrevBlockNumber) * _networkFee;
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey,
        uint256 _fee
    ) external override {
        _ssvRegistryContract.registerOperator(
            _name,
            msg.sender,
            _publicKey,
            _fee
        );
        // trigger update operator fee function
        // console.log("reg o block", block.number);
        _operatorBalances[_publicKey] = OperatorBalanceSnapshot(block.number, 0, 0, 0, block.number);
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    // TODO: add transfer tokens logic here based on passed value in function params
    function registerValidator(
        bytes calldata publicKey,
        bytes[] calldata operatorPublicKeys,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedKeys,
        uint256 tokenAmount
    ) external virtual override {
        // console.log("reg v block", block.number);
        _ssvRegistryContract.registerValidator(
            msg.sender,
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );
        _updateAddressNetworkFee(msg.sender);
        _owners[msg.sender].activeValidatorsCount++;

        _validatorUsages[publicKey] = ValidatorUsageSnapshot(block.number, 0);
        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            bytes calldata operatorPubKey = operatorPublicKeys[index];
            _updateOperatorBalance(operatorPubKey);
            _operatorBalances[operatorPubKey].validatorCount++;
            _useOperatorByOwner(msg.sender, operatorPubKey);
        }

        deposit(tokenAmount);
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
    ) onlyValidator(publicKey) external virtual override {
        updateValidatorUsage(publicKey);
        bytes[] memory currentOperatorPubKeys = _ssvRegistryContract.getOperatorPubKeysInUse(publicKey);
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        // calculate balances for current operators in use
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            _updateOperatorBalance(operatorPubKey);
            _operatorBalances[operatorPubKey].validatorCount--;

            _stopUsingOperatorByOwner(owner, operatorPubKey);
        }

        // calculate balances for new operators in use
        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            bytes memory operatorPubKey = operatorPublicKeys[index];
            _updateOperatorBalance(operatorPubKey);
            ++_operatorBalances[operatorPubKey].validatorCount;

            _useOperatorByOwner(owner, operatorPubKey);
        }

        _ssvRegistryContract.updateValidator(
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );

        deposit(tokenAmount);
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteValidator(bytes calldata publicKey) onlyValidator(publicKey) external virtual override {
        _unregisterValidator(publicKey);
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        totalBalanceOf(owner); // For assertion
        // _owners[owner].used += validatorUsageOf(publicKey);
        // delete _validatorUsages[publicKey];
        _ssvRegistryContract.deleteValidator(msg.sender, publicKey);
        _updateAddressNetworkFee(msg.sender);
        _owners[msg.sender].activeValidatorsCount--;
    }

    /**
     * @dev See {ISSVNetwork-deleteOperator}.
     */
    function deleteOperator(bytes calldata publicKey) onlyOperator(publicKey) external virtual override {
        require(_operatorBalances[publicKey].validatorCount == 0, "operator has validators");
        address owner = _ssvRegistryContract.getOperatorOwner(publicKey);
        _owners[owner].earned += _operatorBalances[publicKey].balance;
        delete _operatorBalances[publicKey];
        _ssvRegistryContract.deleteOperator(msg.sender, publicKey);
    }

    function activateValidator(bytes calldata publicKey) external virtual override {
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        _validatorUsages[publicKey].blockNumber = block.number;
        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = _ssvRegistryContract.getOperatorPubKeysInUse(publicKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            _updateOperatorBalance(operatorPubKey);
            _operatorBalances[operatorPubKey].validatorCount++;
            _useOperatorByOwner(owner, operatorPubKey);
        }

        _ssvRegistryContract.activateValidator(publicKey);
    }

    function deactivateValidator(bytes calldata publicKey) external virtual override {
        _unregisterValidator(publicKey);

        _ssvRegistryContract.deactivateValidator(publicKey);

        _updateAddressNetworkFee(msg.sender);
        _owners[msg.sender].activeValidatorsCount--;
    }

    function activateOperator(bytes calldata publicKey) external virtual override {
        _ssvRegistryContract.activateOperator(publicKey);
        _updateAddressNetworkFee(msg.sender);
        _owners[msg.sender].activeValidatorsCount++;
    }

    function deactivateOperator(bytes calldata publicKey) external virtual override {
        require(_operatorBalances[publicKey].validatorCount == 0, "operator has validators");

        _ssvRegistryContract.deactivateOperator(publicKey);
    }

    function withdraw(uint256 tokenAmount) external virtual override {
        require(totalBalanceOf(msg.sender) > tokenAmount, "not enough balance");
        _owners[msg.sender].withdrawn += tokenAmount;
        _token.transfer(msg.sender, tokenAmount);
    }

    function deposit(uint tokenAmount) public override {
        _token.transferFrom(msg.sender, address(this), tokenAmount);
        _owners[msg.sender].deposited += tokenAmount;
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes memory publicKey) public view override returns (uint256) {
        return _operatorBalances[publicKey].balance +
               _ssvRegistryContract.getOperatorCurrentFee(publicKey) *
               (block.number - _operatorBalances[publicKey].blockNumber) *
               _operatorBalances[publicKey].validatorCount;
    }

    /**
     * @dev See {ISSVNetwork-addressNetworkFeeIndex}.
     */
    function addressNetworkFee(address _ownerAddress) public view override returns (uint256) {
        return _owners[_ownerAddress].networkFee +
            (_currentNetworkFeeIndex() - _owners[_ownerAddress].networkFeePrevIndex) * _owners[_ownerAddress].activeValidatorsCount;
    }

    function totalBalanceOf(address ownerAddress) public override view returns (uint256) {
        uint balance = _owners[ownerAddress].deposited + _owners[ownerAddress].earned;

        bytes[] memory operators = _ssvRegistryContract.getOperatorsByAddress(ownerAddress);
        for (uint256 index = 0; index < operators.length; ++index) {
            balance += operatorBalanceOf(operators[index]);
        }

        uint256 usage = _owners[ownerAddress].withdrawn +
                _owners[ownerAddress].used +
                _owners[ownerAddress].networkFee;

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            usage += _operatorInUseUsageOf(ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        require(balance >= usage, "negative balance");

        return balance - usage;
    }

    /**
     * @dev See {ISSVNetwork-validatorUsageOf}.
     */
    function validatorUsageOf(bytes memory publicKey) public view override returns (uint256) {
        ValidatorUsageSnapshot storage balanceSnapshot = _validatorUsages[publicKey];
        (,, bool active,) = _ssvRegistryContract.validators(publicKey);
        if (!active) {
            return balanceSnapshot.balance;
        }

        return balanceSnapshot.balance + _ssvRegistryContract.getValidatorUsage(publicKey, balanceSnapshot.blockNumber, block.number);
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorUsage}.
     */
    function updateValidatorUsage(bytes memory publicKey) public override {
        ValidatorUsageSnapshot storage usageSnapshot = _validatorUsages[publicKey];
        usageSnapshot.balance = validatorUsageOf(publicKey);
        usageSnapshot.blockNumber = block.number;
    }

    /**
     * @dev Update network fee for the address.
     * @param _ownerAddress Owner address.
     */
    function _updateAddressNetworkFee(address _ownerAddress) private {
        _owners[_ownerAddress].networkFee = addressNetworkFee(_ownerAddress);
        _owners[_ownerAddress].networkFeePrevIndex = _currentNetworkFeeIndex();
    }

    /**
     * @dev Updates operators's balance.
     * @param _publicKey The operators's public key.
     */
    function _updateOperatorBalance(bytes memory _publicKey) private {
        OperatorBalanceSnapshot storage balanceSnapshot = _operatorBalances[_publicKey];
        balanceSnapshot.balance = operatorBalanceOf(_publicKey);
        balanceSnapshot.blockNumber = block.number;
    }

    /**
     * @dev Get operator index by address.
     * @param publicKey Operator's Public Key.
     */
    function _operatorIndexOf(bytes memory publicKey) private view returns (uint256) {
        return _operatorBalances[publicKey].index +
               _ssvRegistryContract.getOperatorCurrentFee(publicKey) *
               (block.number - _operatorBalances[publicKey].indexBlockNumber);
    }

    function test_operatorIndexOf(bytes memory publicKey) public view returns (uint256) {
        return _operatorIndexOf(publicKey);
    }

    function _unregisterValidator(bytes calldata publicKey) private {
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        updateValidatorUsage(publicKey);

        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = _ssvRegistryContract.getOperatorPubKeysInUse(publicKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            _updateOperatorBalance(operatorPubKey);
            _operatorBalances[operatorPubKey].validatorCount--;
            _stopUsingOperatorByOwner(owner, operatorPubKey);
        }
    }

    function _operatorInUseUsageOf(address ownerAddress, bytes memory operatorPublicKey) private view returns (uint256) {
        OperatorInUse storage usageSnapshot = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
        uint256 newUsage = (_operatorIndexOf(operatorPublicKey) - usageSnapshot.index) * usageSnapshot.validatorCount;

        return usageSnapshot.used + newUsage;
    }

    function _useOperatorByOwner(address ownerAddress, bytes memory operatorPubKey) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorPubKey, true);
    }

    function _stopUsingOperatorByOwner(address ownerAddress, bytes memory operatorPubKey) private {
        _updateUsingOperatorByOwner(ownerAddress, operatorPubKey, false);
    }

    /**
     * @dev updates owner and ope
     * @param ownerAddress Owner address.
     * @param operatorPublicKey The operator's public key.
     * @param increase Change value for validators amount.
     */
    function _updateUsingOperatorByOwner(address ownerAddress, bytes memory operatorPublicKey, bool increase) private {
        OperatorInUse storage usageSnapshot = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];

        if (usageSnapshot.exists) {
            usageSnapshot.used = _operatorInUseUsageOf(ownerAddress, operatorPublicKey);
            usageSnapshot.index = _operatorIndexOf(operatorPublicKey);

            if (increase) {
                ++usageSnapshot.validatorCount;
            } else {
                --usageSnapshot.validatorCount;
            }
        } else {
            _operatorsInUseByAddress[ownerAddress][operatorPublicKey] = OperatorInUse(_operatorIndexOf(operatorPublicKey), 1, 0, true);
            _operatorsInUseList[ownerAddress].push(operatorPublicKey);
        }
    }
}