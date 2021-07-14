// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "hardhat/console.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork {
    ISSVRegistry public ssvRegistryContract;
    IERC20 public token;

    mapping(bytes => OperatorBalanceSnapshot) internal operatorBalances;
    mapping(bytes => ValidatorUsageSnapshot) internal validatorUsages;

    mapping(address => Balance) public addressBalances;

    function initialize(ISSVRegistry _SSVRegistryAddress, IERC20 _token) public virtual override initializer {
        __SSVNetwork_init(_SSVRegistryAddress, _token);
    }

    function __SSVNetwork_init(ISSVRegistry _SSVRegistryAddress, IERC20 _token) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(_SSVRegistryAddress, _token);
    }

    function __SSVNetwork_init_unchained(ISSVRegistry _SSVRegistryAddress, IERC20 _token) internal initializer {
        ssvRegistryContract = _SSVRegistryAddress;
        token = _token;
        ssvRegistryContract.initialize();
    }

    modifier onlyValidator(bytes calldata _publicKey) {
        address owner = ssvRegistryContract.getValidatorOwner(_publicKey);
        require(
            owner != address(0),
            "validator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not validator owner");
        _;
    }

    modifier onlyOperator(bytes calldata _publicKey) {
        address owner = ssvRegistryContract.getOperatorOwner(_publicKey);
        require(
            owner != address(0),
            "operator with public key does not exist"
        );
        require(msg.sender == owner, "caller is not operator owner");
        _;
    }

    // uint256 minValidatorBlockSubscription;

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata _pubKey, uint256 _fee) public onlyOperator(_pubKey) virtual override {
        updateOperatorBalance(_pubKey);
        ssvRegistryContract.updateOperatorFee(_pubKey, _fee);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes memory _pubKey) public view override returns (uint256) {
        return operatorBalances[_pubKey].balance +
               ssvRegistryContract.getOperatorCurrentFee(_pubKey) *
               (block.number - operatorBalances[_pubKey].blockNumber) *
               operatorBalances[_pubKey].validatorCount;
    }

    /**
     * @dev See {ISSVNetwork-updateOperatorBalance}.
     */
    function updateOperatorBalance(bytes memory _pubKey) public override {
        OperatorBalanceSnapshot storage balanceSnapshot = operatorBalances[_pubKey];
        balanceSnapshot.balance = operatorBalanceOf(_pubKey);
        balanceSnapshot.blockNumber = block.number;
    }

    function totalBalanceOf(address _ownerAddress) public override view returns (uint256) {
        bytes[] memory validators = ssvRegistryContract.getValidatorsByAddress(_ownerAddress);
        bytes[] memory operators = ssvRegistryContract.getOperatorsByAddress(_ownerAddress);
        uint balance = addressBalances[_ownerAddress].deposited + addressBalances[_ownerAddress].earned;

        for (uint256 index = 0; index < operators.length; ++index) {
            balance += operatorBalanceOf(operators[index]);
        }

        uint256 usage = addressBalances[_ownerAddress].withdrawn + addressBalances[_ownerAddress].used;

        for (uint256 index = 0; index < validators.length; ++index) {
            usage += validatorUsageOf(validators[index]);
        }

        require(balance >= usage, "negative balance");


        return balance - usage;
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey,
        uint256 _fee
    ) public override {
        ssvRegistryContract.registerOperator(
            _name,
            msg.sender,
            _publicKey,
            _fee
        );
        // trigger update operator fee function
        operatorBalances[_publicKey] = OperatorBalanceSnapshot(block.number, 0, 0);
    }

    /**
     * @dev See {ISSVNetwork-validatorUsageOf}.
     */
    function validatorUsageOf(bytes memory _pubKey) public view override returns (uint256) {
        ValidatorUsageSnapshot storage balanceSnapshot = validatorUsages[_pubKey];
        (,, bool active,) = ssvRegistryContract.validators(_pubKey);
        if (!active) {
            return balanceSnapshot.balance;
        }

        return balanceSnapshot.balance + ssvRegistryContract.getValidatorUsage(_pubKey, balanceSnapshot.blockNumber, block.number);
    }

    /**
     * @dev See {ISSVNetwork-updateValidatorUsage}.
     */
    function updateValidatorUsage(bytes memory _pubKey) public override {
        ValidatorUsageSnapshot storage usageSnapshot = validatorUsages[_pubKey];
        usageSnapshot.balance = validatorUsageOf(_pubKey);
        usageSnapshot.blockNumber = block.number;
    }

    /**
     * @dev See {ISSVNetwork-registerValidator}.
     */
    // TODO: add transfer tokens logic here based on passed value in function params
    function registerValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys,
        uint256 _tokenAmount
    ) public virtual override {
        ssvRegistryContract.registerValidator(
            msg.sender,
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );
        validatorUsages[_publicKey] = ValidatorUsageSnapshot(block.number, 0);

        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes calldata operatorPubKey = _operatorPublicKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }

        deposit(_tokenAmount);
    }

    function deposit(uint _tokenAmount) public override {
        token.transferFrom(msg.sender, address(this), _tokenAmount);
        addressBalances[msg.sender].deposited += _tokenAmount;
    }

    /**
     * @dev See {ISSVNetwork-updateValidator}.
     */
    function updateValidator(
        bytes calldata _publicKey,
        bytes[] calldata _operatorPublicKeys,
        bytes[] calldata _sharesPublicKeys,
        bytes[] calldata _encryptedKeys,
        uint256 _tokenAmount
    ) onlyValidator(_publicKey) public virtual override {
        updateValidatorUsage(_publicKey);
        bytes[] memory currentOperatorPubKeys = ssvRegistryContract.getOperatorPubKeysInUse(_publicKey);
        // calculate balances for current operators in use
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }

        // calculate balances for new operators in use
        for (uint256 index = 0; index < _operatorPublicKeys.length; ++index) {
            bytes memory operatorPubKey = _operatorPublicKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }

        ssvRegistryContract.updateValidator(
            _publicKey,
            _operatorPublicKeys,
            _sharesPublicKeys,
            _encryptedKeys
        );

        deposit(_tokenAmount);
    }

    function unregisterValidator(bytes calldata _publicKey) internal {
        updateValidatorUsage(_publicKey);

        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = ssvRegistryContract.getOperatorPubKeysInUse(_publicKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteValidator(bytes calldata _publicKey) onlyValidator(_publicKey) public virtual override {
        unregisterValidator(_publicKey);
        address owner = ssvRegistryContract.getValidatorOwner(_publicKey);
        totalBalanceOf(owner); // For assertion
        addressBalances[owner].used += validatorUsageOf(_publicKey);
        delete validatorUsages[_publicKey];
        ssvRegistryContract.deleteValidator(msg.sender, _publicKey);
    }

    /**
     * @dev See {ISSVNetwork-deleteOperator}.
     */
    function deleteOperator(bytes calldata _publicKey) onlyOperator(_publicKey) public virtual override {
        require(operatorBalances[_publicKey].validatorCount == 0, "operator has validators");
        address owner = ssvRegistryContract.getOperatorOwner(_publicKey);
        addressBalances[owner].earned += operatorBalances[_publicKey].balance;
        delete operatorBalances[_publicKey];
        ssvRegistryContract.deleteOperator(msg.sender, _publicKey);
    }

    function activateValidator(bytes calldata _pubKey) external override {
        validatorUsages[_pubKey].blockNumber = block.number;
        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = ssvRegistryContract.getOperatorPubKeysInUse(_pubKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }

        ssvRegistryContract.activateValidator(_pubKey);
    }

    function deactivateValidator(bytes calldata _pubKey) external override {
        unregisterValidator(_pubKey);

        ssvRegistryContract.deactivateValidator(_pubKey);
    }

    function activateOperator(bytes calldata _pubKey) external override {
        ssvRegistryContract.activateOperator(_pubKey);
    }

    function deactivateOperator(bytes calldata _pubKey) external override {
        require(operatorBalances[_pubKey].validatorCount == 0, "operator has validators");

        ssvRegistryContract.deactivateOperator(_pubKey);
    }

    function withdraw(uint256 _tokenAmount) public override {
        require(totalBalanceOf(msg.sender) > _tokenAmount, "not enough balance");
        addressBalances[msg.sender].withdrawn += _tokenAmount;
        token.transfer(msg.sender, _tokenAmount);
    }
}