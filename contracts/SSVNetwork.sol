// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "hardhat/console.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork {
    struct OperatorBalanceSnapshot {
        uint256 blockNumber;
        uint256 validatorCount;
        uint256 balance;
        uint256 index;
        uint256 indexBlockNumber;
    }

    struct OwnerData {
        uint256 deposited;
        uint256 withdrawn;
        uint256 earned;
        uint256 used;
        uint256 networkFee;
        uint256 networkFeeIndex;
        uint256 activeValidatorsCount;
    }

    struct OperatorInUse {
        uint256 index;
        uint256 validatorCount;
        uint256 used;
        bool exists;
        uint256 indexInArray;
    }

    ISSVRegistry private _ssvRegistryContract;
    IERC20 private _token;
    uint256 public _minimumBlocksBeforeLiquidation;

    uint256 private _networkFee;
    uint256 private _networkFeeIndex;
    uint256 private _networkFeeIndexBlockNumber;

    mapping(bytes => OperatorBalanceSnapshot) private _operatorBalances;
    mapping(address => OwnerData) private _owners;
    mapping(address => mapping(bytes => OperatorInUse)) private _operatorsInUseByAddress;
    mapping(address => bytes[]) private _operatorsInUseList;

    function initialize(ISSVRegistry registryAddress, IERC20 token, uint256 minimumBlocksBeforeLiquidation) external initializer virtual override {
        __SSVNetwork_init(registryAddress, token, minimumBlocksBeforeLiquidation);
    }

    function __SSVNetwork_init(ISSVRegistry registryAddress, IERC20 token, uint256 minimumBlocksBeforeLiquidation) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(registryAddress, token, minimumBlocksBeforeLiquidation);
    }

    function __SSVNetwork_init_unchained(ISSVRegistry registryAddress, IERC20 token, uint256 minimumBlocksBeforeLiquidation) internal initializer {
        _ssvRegistryContract = registryAddress;
        _token = token;
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation;
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

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata name,
        bytes calldata publicKey,
        uint256 fee
    ) external override {
        _ssvRegistryContract.registerOperator(
            name,
            msg.sender,
            publicKey,
            fee
        );

        _operatorBalances[publicKey] = OperatorBalanceSnapshot(block.number, 0, 0, 0, block.number);
    }

    /**
     * @dev See {ISSVNetwork-deleteOperator}.
     */
    function deleteOperator(bytes calldata publicKey) onlyOperatorOwner(publicKey) external virtual override {
        require(_operatorBalances[publicKey].validatorCount == 0, "operator has validators");
        address owner = _ssvRegistryContract.getOperatorOwner(publicKey);
        _owners[owner].earned += _operatorBalances[publicKey].balance;
        delete _operatorBalances[publicKey];
        _ssvRegistryContract.deleteOperator(msg.sender, publicKey);
    }


    function activateOperator(bytes calldata publicKey) external virtual override {
        _ssvRegistryContract.activateOperator(publicKey);
        _updateAddressNetworkFee(msg.sender);
        ++_owners[msg.sender].activeValidatorsCount;
    }

    function deactivateOperator(bytes calldata publicKey) external virtual override {
        require(_operatorBalances[publicKey].validatorCount == 0, "operator has validators");

        _ssvRegistryContract.deactivateOperator(publicKey);
    }

    function updateOperatorFee(bytes calldata publicKey, uint256 fee) external onlyOperatorOwner(publicKey) virtual override {
        _operatorBalances[publicKey].index = _operatorIndexOf(publicKey);
        _operatorBalances[publicKey].indexBlockNumber = block.number;
        _updateOperatorBalance(publicKey);
        _ssvRegistryContract.updateOperatorFee(publicKey, fee);
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
    ) external virtual override {
        _ssvRegistryContract.registerValidator(
            msg.sender,
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );
        _updateAddressNetworkFee(msg.sender);
        ++_owners[msg.sender].activeValidatorsCount;

        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            bytes calldata operatorPublicKey = operatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);
            ++_operatorBalances[operatorPublicKey].validatorCount;
            _useOperatorByOwner(msg.sender, operatorPublicKey);
        }

        if (tokenAmount > 0) {
            _deposit(tokenAmount);
        }

        require(!_liquidatable(msg.sender), "not enough balance");
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
    ) onlyValidatorOwner(publicKey) external virtual override {
        bytes[] memory currentOperatorPublicKeys = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        // calculate balances for current operators in use
        for (uint256 index = 0; index < currentOperatorPublicKeys.length; ++index) {
            bytes memory operatorPublicKey = currentOperatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);
            --_operatorBalances[operatorPublicKey].validatorCount;

            _stopUsingOperatorByOwner(owner, operatorPublicKey);
        }

        // calculate balances for new operators in use
        for (uint256 index = 0; index < operatorPublicKeys.length; ++index) {
            bytes memory operatorPublicKey = operatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);
            ++_operatorBalances[operatorPublicKey].validatorCount;

            _useOperatorByOwner(owner, operatorPublicKey);
        }

        _ssvRegistryContract.updateValidator(
            publicKey,
            operatorPublicKeys,
            sharesPublicKeys,
            encryptedKeys
        );

        if (tokenAmount > 0) {
            _deposit(tokenAmount);
        }

        require(!_liquidatable(msg.sender), "not enough balance");
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteValidator(bytes calldata publicKey) onlyValidatorOwner(publicKey) external virtual override {
        _unregisterValidator(publicKey);
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        _totalBalanceOf(owner); // For assertion
        _ssvRegistryContract.deleteValidator(msg.sender, publicKey);
        _updateAddressNetworkFee(msg.sender);
        --_owners[msg.sender].activeValidatorsCount;
    }

    function activateValidator(bytes calldata publicKey, uint256 tokenAmount) onlyValidatorOwner(publicKey) external virtual override {
        address owner = _ssvRegistryContract.getValidatorOwner(publicKey);
        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPublicKeys = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        for (uint256 index = 0; index < currentOperatorPublicKeys.length; ++index) {
            bytes memory operatorPublicKey = currentOperatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);
            ++_operatorBalances[operatorPublicKey].validatorCount;
            _useOperatorByOwner(owner, operatorPublicKey);
        }

        _ssvRegistryContract.activateValidator(publicKey);

        if (tokenAmount > 0) {
            _deposit(tokenAmount);
        }

        require(!_liquidatable(msg.sender), "not enough balance");
    }

    function deactivateValidator(bytes calldata publicKey) onlyValidatorOwner(publicKey) external virtual override {
        _deactivateValidator(publicKey, msg.sender);
    }

    function deposit(uint tokenAmount) external override {
        _deposit(tokenAmount);
    }

    function withdraw(uint256 tokenAmount) external virtual override {
        require(_totalBalanceOf(msg.sender) > tokenAmount, "not enough balance");
        _owners[msg.sender].withdrawn += tokenAmount;
        require(!_liquidatable(msg.sender), "not enough balance");
        _token.transfer(msg.sender, tokenAmount);
    }

    function liquidate(address ownerAddress) external virtual override {
        require(_liquidatable(ownerAddress), "owner is not liquidatable");

        _liquidateUnsafe(ownerAddress);
    }

    function liquidateAll(address[] calldata ownerAddresses) external virtual override {
        for (uint256 index = 0; index < ownerAddresses.length; ++index) {
            if (_liquidatable(ownerAddresses[index])) {
                _liquidateUnsafe(ownerAddresses[index]);
            }
        }
    }

    function updateMinimumBlocksBeforeLiquidation(uint256 minimumBlocksBeforeLiquidation) external onlyOwner virtual override {
        _minimumBlocksBeforeLiquidation = minimumBlocksBeforeLiquidation;
    }

    /**
     * @dev See {ISSVNetwork-updateNetworkFee}.
     */
    function updateNetworkFee(uint256 fee) external onlyOwner virtual override {
        _networkFeeIndex = _currentNetworkFeeIndex();
        _networkFee = fee;
        _networkFeeIndexBlockNumber = block.number;
    }

    function totalBalanceOf(address ownerAddress) external override view returns (uint256) {
        return _totalBalanceOf(ownerAddress);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes memory publicKey) external view override returns (uint256) {
        return _operatorBalanceOf(publicKey);
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

    function minimumBlocksBeforeLiquidation() external view override returns (uint256) {
        return _minimumBlocksBeforeLiquidation;
    }

    function _deposit(uint tokenAmount) private {
        _token.transferFrom(msg.sender, address(this), tokenAmount);
        _owners[msg.sender].deposited += tokenAmount;
    }

    /**
     * @dev Update network fee for the address.
     * @param ownerAddress Owner address.
     */
    function _updateAddressNetworkFee(address ownerAddress) private {
        _owners[ownerAddress].networkFee = _addressNetworkFee(ownerAddress);
        _owners[ownerAddress].networkFeeIndex = _currentNetworkFeeIndex();
    }

    /**
     * @dev Updates operators's balance.
     * @param publicKey The operators's public key.
     */
    function _updateOperatorBalance(bytes memory publicKey) private {
        OperatorBalanceSnapshot storage balanceSnapshot = _operatorBalances[publicKey];
        balanceSnapshot.balance = _operatorBalanceOf(publicKey);
        balanceSnapshot.blockNumber = block.number;
    }

    function _liquidateUnsafe(address ownerAddress) private {
        bytes[] memory validators = _ssvRegistryContract.getValidatorsByAddress(ownerAddress);

        for (uint index = 0; index < validators.length; ++index) {
            _deactivateValidator(validators[index], ownerAddress);
        }

        uint256 balanceToTransfer = _totalBalanceOf(ownerAddress);

        _owners[ownerAddress].used += balanceToTransfer;
        _owners[msg.sender].earned += balanceToTransfer;
    }

    function _deactivateValidator(bytes memory publicKey, address ownerAddress) private {
        _unregisterValidator(publicKey);

        _ssvRegistryContract.deactivateValidator(publicKey);

        _updateAddressNetworkFee(ownerAddress);
        --_owners[ownerAddress].activeValidatorsCount;
    }

    function _unregisterValidator(bytes memory publicKey) private {
        address ownerAddress = _ssvRegistryContract.getValidatorOwner(publicKey);

        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPublicKeys = _ssvRegistryContract.getOperatorsByValidator(publicKey);
        for (uint256 index = 0; index < currentOperatorPublicKeys.length; ++index) {
            bytes memory operatorPublicKey = currentOperatorPublicKeys[index];
            _updateOperatorBalance(operatorPublicKey);
            --_operatorBalances[operatorPublicKey].validatorCount;
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
        OperatorInUse storage usageSnapshot = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];

        if (usageSnapshot.exists) {
            usageSnapshot.used = _operatorInUseUsageOf(ownerAddress, operatorPublicKey);
            usageSnapshot.index = _operatorIndexOf(operatorPublicKey);

            if (increase) {
                ++usageSnapshot.validatorCount;
            } else {
                if (--usageSnapshot.validatorCount == 0) {
                    _owners[ownerAddress].used += usageSnapshot.used;

                    // remove from mapping and list;

                    _operatorsInUseList[ownerAddress][usageSnapshot.indexInArray] = _operatorsInUseList[ownerAddress][_operatorsInUseList[ownerAddress].length - 1];
                    _operatorsInUseByAddress[ownerAddress][_operatorsInUseList[ownerAddress][usageSnapshot.indexInArray]].indexInArray = usageSnapshot.indexInArray;
                    _operatorsInUseList[ownerAddress].pop();

                    delete _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
                }
            }
        } else {
            _operatorsInUseByAddress[ownerAddress][operatorPublicKey] = OperatorInUse(_operatorIndexOf(operatorPublicKey), 1, 0, true, _operatorsInUseList[ownerAddress].length);
            _operatorsInUseList[ownerAddress].push(operatorPublicKey);
        }
    }


    function _totalBalanceOf(address ownerAddress) private view returns (uint256) {
        uint balance = _owners[ownerAddress].deposited + _owners[ownerAddress].earned;

        bytes[] memory operators = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);
        for (uint256 index = 0; index < operators.length; ++index) {
            balance += _operatorBalanceOf(operators[index]);
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

    function _operatorEarnRate(bytes memory publicKey) private view returns (uint256) {
        return _ssvRegistryContract.getOperatorCurrentFee(publicKey) * _operatorBalances[publicKey].validatorCount;
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function _operatorBalanceOf(bytes memory publicKey) private view returns (uint256) {
        return _operatorBalances[publicKey].balance +
               (block.number - _operatorBalances[publicKey].blockNumber) *
               _operatorEarnRate(publicKey);
    }

    function _addressNetworkFee(address ownerAddress) private view returns (uint256) {
        return _owners[ownerAddress].networkFee +
              (_currentNetworkFeeIndex() - _owners[ownerAddress].networkFeeIndex) *
              _owners[ownerAddress].activeValidatorsCount;
    }

    function _burnRate(address ownerAddress) private view returns (uint256 burnRate) {
        bytes[] memory operators = _ssvRegistryContract.getOperatorsByOwnerAddress(ownerAddress);

        for (uint256 index = 0; index < _operatorsInUseList[ownerAddress].length; ++index) {
            burnRate += _operatorInUseBurnRate(ownerAddress, _operatorsInUseList[ownerAddress][index]);
        }

        for (uint256 index = 0; index < operators.length; ++index) {
            if (burnRate <= _operatorEarnRate(operators[index])) {
                return 0;
            } else {
                burnRate -= _operatorEarnRate(operators[index]);
            }
        }
    }

    function _liquidatable(address ownerAddress) private view returns (bool) {
        return _totalBalanceOf(ownerAddress) < _minimumBlocksBeforeLiquidation * _burnRate(ownerAddress);
    }

    /**
     * @dev Get operator index by address.
     * @param publicKey Operator's public Key.
     */
    function _operatorIndexOf(bytes memory publicKey) private view returns (uint256) {
        return _operatorBalances[publicKey].index +
               _ssvRegistryContract.getOperatorCurrentFee(publicKey) *
               (block.number - _operatorBalances[publicKey].indexBlockNumber);
    }

    function test_operatorIndexOf(bytes memory publicKey) public view returns (uint256) {
        return _operatorIndexOf(publicKey);
    }

    function _operatorInUseUsageOf(address ownerAddress, bytes memory operatorPublicKey) private view returns (uint256) {
        OperatorInUse storage usageSnapshot = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
        uint256 newUsage = (_operatorIndexOf(operatorPublicKey) - usageSnapshot.index) * usageSnapshot.validatorCount;

        return usageSnapshot.used + newUsage;
    }

    function _operatorInUseBurnRate(address ownerAddress, bytes memory operatorPublicKey) private view returns (uint256) {
        OperatorInUse storage usageSnapshot = _operatorsInUseByAddress[ownerAddress][operatorPublicKey];
        return _ssvRegistryContract.getOperatorCurrentFee(operatorPublicKey) * usageSnapshot.validatorCount;
    }

    /**
     * @dev Returns the current network fee index
     */
    function _currentNetworkFeeIndex() private view returns(uint256) {
        return _networkFeeIndex + (block.number - _networkFeeIndexBlockNumber) * _networkFee;
    }
}