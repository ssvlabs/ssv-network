// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/functions/IFnSSVOperators.sol";
import "../interfaces/events/IEvSSVOperators.sol";
import "../libraries/Types.sol";
import "../libraries/SSVStorage.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";

import "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is IFnSSVOperators, IEvSSVOperators {
    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;

    using Types256 for uint256;
    using Types64 for uint64;
    using Counters for Counters.Counter;
    using OperatorLib for Operator;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert ISSVNetworkCore.FeeTooLow();
        }

        bytes32 hashedPk = keccak256(publicKey);
        if (SSVStorage.load().operatorsPKs[hashedPk] != 0) revert ISSVNetworkCore.OperatorAlreadyExists();

        SSVStorage.load().lastOperatorId.increment();
        id = uint64(SSVStorage.load().lastOperatorId.current());
        SSVStorage.load().operators[id] = Operator({
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint64(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink()
        });
        SSVStorage.load().operatorsPKs[hashedPk] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }

    function removeOperator(uint64 operatorId) external override {
        Operator memory operator = SSVStorage.load().operators[operatorId];
        operator.checkOwner();

        operator.updateSnapshot();
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        SSVStorage.load().operators[operatorId] = operator;

        if (SSVStorage.load().operatorsWhitelist[operatorId] != address(0)) {
            delete SSVStorage.load().operatorsWhitelist[operatorId];
        }

        if (currentBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalance.expand());
        }
        emit OperatorRemoved(operatorId);
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external {
        SSVStorage.load().operators[operatorId].checkOwner();
        SSVStorage.load().operatorsWhitelist[operatorId] = whitelisted;
        emit OperatorWhitelistUpdated(operatorId, whitelisted);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        SSVStorage.load().operators[operatorId].checkOwner();

        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();
        uint64 operatorFee = SSVStorage.load().operators[operatorId].fee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        OperatorFeeConfig memory opFeeConfig = SSVStorage.load().operatorFeeConfig;
        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee * (PRECISION_FACTOR + opFeeConfig.operatorMaxFeeIncrease)) /
            PRECISION_FACTOR;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        SSVStorage.load().operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + opFeeConfig.declareOperatorFeePeriod,
            uint64(block.timestamp) + opFeeConfig.declareOperatorFeePeriod + opFeeConfig.executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        Operator memory operator = SSVStorage.load().operators[operatorId];
        operator.checkOwner();

        OperatorFeeChangeRequest memory feeChangeRequest = SSVStorage.load().operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDeclared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        operator.updateSnapshot();
        operator.fee = feeChangeRequest.fee;
        SSVStorage.load().operators[operatorId] = operator;

        delete SSVStorage.load().operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        SSVStorage.load().operators[operatorId].checkOwner();

        if (SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDeclared();

        delete SSVStorage.load().operatorFeeChangeRequests[operatorId];

        emit OperatorFeeCancellationDeclared(msg.sender, operatorId);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        Operator memory operator = SSVStorage.load().operators[operatorId];
        operator.checkOwner();

        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot();
        operator.fee = shrunkAmount;
        SSVStorage.load().operators[operatorId] = operator;

        if (SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime != 0) delete SSVStorage.load().operatorFeeChangeRequests[operatorId];
        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
    }

    function setFeeRecipientAddress(address recipientAddress) external override {
        emit FeeRecipientAddressUpdated(msg.sender, recipientAddress);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0);
    }

    // private functions
    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount) private {
        Operator memory operator = SSVStorage.load().operators[operatorId];
        operator.checkOwner();
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

        SSVStorage.load().operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
    }

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        CoreLib.transfer(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }
}
