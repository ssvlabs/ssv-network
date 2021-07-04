// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract SSVNetwork is Initializable, OwnableUpgradeable, ISSVNetwork {
    ISSVRegistry private SSVRegistryContract;
    IERC20 token;

    mapping(bytes => OperatorBalanceSnapshot) internal operatorBalances;
    mapping(bytes => ValidatorUsageSnapshot) internal validatorUsages;

    mapping(address => Balance) public addressBalances;

    bool initialized;

    function initialize(ISSVRegistry _SSVRegistryAddress, IERC20 _token) public virtual override initializer {
        __SSVNetwork_init(_SSVRegistryAddress, _token);
    }

    function __SSVNetwork_init(ISSVRegistry _SSVRegistryAddress, IERC20 _token) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(_SSVRegistryAddress, _token);
    }

    function __SSVNetwork_init_unchained(ISSVRegistry _SSVRegistryAddress, IERC20 _token) internal initializer {
        SSVRegistryContract = _SSVRegistryAddress;
        token = _token;
        SSVRegistryContract.initialize();
    }


    // uint256 minValidatorBlockSubscription;

    /**
     * @dev See {ISSVNetwork-updateOperatorFee}.
     */
    function updateOperatorFee(bytes calldata _pubKey, uint256 _fee) public virtual override {
        updateOperatorBalance(_pubKey);
        SSVRegistryContract.updateOperatorFee(_pubKey, _fee);
    }

    /**
     * @dev See {ISSVNetwork-operatorBalanceOf}.
     */
    function operatorBalanceOf(bytes memory _pubKey) public view override returns (uint256) {
        return operatorBalances[_pubKey].balance +
               SSVRegistryContract.getOperatorCurrentFee(_pubKey) *
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
        bytes[] memory validators = SSVRegistryContract.getValidatorsByAddress(_ownerAddress);
        bytes[] memory operators = SSVRegistryContract.getOperatorsByAddress(_ownerAddress);
        uint balance = addressBalances[_ownerAddress].deposited;

        for (uint256 index = 0; index < operators.length; ++index) {
            balance += operatorBalanceOf(operators[index]);
        }

        balance -= addressBalances[_ownerAddress].withdrawn + addressBalances[_ownerAddress].used;

        for (uint256 index = 0; index < validators.length; ++index) {
            balance -= validatorUsageOf(validators[index]);
        }

        return balance;
    }

    /**
     * @dev See {ISSVNetwork-registerOperator}.
     */
    function registerOperator(
        string calldata _name,
        bytes calldata _publicKey,
        uint256 _fee
    ) public override {
        SSVRegistryContract.registerOperator(
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
        return balanceSnapshot.balance + SSVRegistryContract.getValidatorUsage(_pubKey, balanceSnapshot.blockNumber, block.number);
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
        // TODO: tokensAmount validation based on calculation operator pub key and minimum period of time
        // for each operatorPubKey: minValidatorBlockSubscription * (fee1 + fee2 + fee3)
        SSVRegistryContract.registerValidator(
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
    ) public virtual override {
        updateValidatorUsage(_publicKey);
        bytes[] memory currentOperatorPubKeys = SSVRegistryContract.getOperatorPubKeysInUse(_publicKey);
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

        SSVRegistryContract.updateValidator(
            msg.sender,
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
        bytes[] memory currentOperatorPubKeys = SSVRegistryContract.getOperatorPubKeysInUse(_publicKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount--;
        }
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteValidator(bytes calldata _publicKey) public virtual override {
        unregisterValidator(_publicKey);

        address owner = SSVRegistryContract.getValidatorOwner(_publicKey);

        require(totalBalanceOf(owner) > validatorUsageOf(_publicKey), "Not enough balance");

        addressBalances[owner].used += validatorUsageOf(_publicKey);

        delete validatorUsages[_publicKey];

        SSVRegistryContract.deleteValidator(msg.sender, _publicKey);
    }

    /**
     * @dev See {ISSVNetwork-deleteValidator}.
     */
    function deleteOperator(bytes calldata _publicKey) public virtual override {
        updateOperatorBalance(_publicKey);
        SSVRegistryContract.deleteOperator(msg.sender, _publicKey);
    }

    function deactivate(bytes calldata _pubKey) override external {
        unregisterValidator(_pubKey);

        SSVRegistryContract.deactivate(_pubKey);
    }

    function activate(bytes calldata _pubKey) override external {
        validatorUsages[_pubKey].blockNumber = block.number;
        // calculate balances for current operators in use and update their balances
        bytes[] memory currentOperatorPubKeys = SSVRegistryContract.getOperatorPubKeysInUse(_pubKey);
        for (uint256 index = 0; index < currentOperatorPubKeys.length; ++index) {
            bytes memory operatorPubKey = currentOperatorPubKeys[index];
            updateOperatorBalance(operatorPubKey);
            operatorBalances[operatorPubKey].validatorCount++;
        }

        SSVRegistryContract.activate(_pubKey);
    }

    function withdraw(uint256 _tokenAmount) override public {
        require(totalBalanceOf(msg.sender) > _tokenAmount, "not enough balance");
        addressBalances[msg.sender].withdrawn += _tokenAmount;
        token.transfer(msg.sender, _tokenAmount);
    }
}