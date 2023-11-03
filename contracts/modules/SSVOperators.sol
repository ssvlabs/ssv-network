// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVOperators.sol";
import "../libraries/Types.sol";
import "../libraries/SSVStorage.sol";
import "../libraries/SSVStorageProtocol.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";

import "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is ISSVOperators {
    using Types256 for uint256;
    using Types64 for uint64;
    using OperatorLib for Operator;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert ISSVNetworkCore.FeeTooLow();
        }
        if (fee > SSVStorageProtocol.load().operatorMaxFee) {
            revert ISSVNetworkCore.FeeTooHigh();
        }

        StorageData storage s = SSVStorage.load();

        id = OperatorLib.fetchOperatorId(publicKey, s);

        s.operators[id] = Operator({
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink(),
            whitelisted: false
        });

        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }

    function removeOperator(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

        operator.updateSnapshot();
        uint64 currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;

        s.operators[operatorId] = operator;

        delete s.operatorsWhitelist[operatorId];

        if (currentBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalance.expand(), s.token);
        }
        emit OperatorRemoved(operatorId);
    }

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        if (whitelisted == address(0)) {
            s.operators[operatorId].whitelisted = false;
        } else {
            s.operators[operatorId].whitelisted = true;
        }

        s.operatorsWhitelist[operatorId] = whitelisted;
        emit OperatorWhitelistUpdated(operatorId, whitelisted);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();
        if (fee > sp.operatorMaxFee) revert FeeTooHigh();

        uint64 operatorFee = s.operators[operatorId].fee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee * (PRECISION_FACTOR + sp.operatorMaxFeeIncrease)) / PRECISION_FACTOR;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        s.operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + sp.declareOperatorFeePeriod,
            uint64(block.timestamp) + sp.declareOperatorFeePeriod + sp.executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    function executeOperatorFee(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

        OperatorFeeChangeRequest memory feeChangeRequest = s.operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDeclared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        if (feeChangeRequest.fee.expand() > SSVStorageProtocol.load().operatorMaxFee) revert FeeTooHigh();

        operator.updateSnapshot();
        operator.fee = feeChangeRequest.fee;
        s.operators[operatorId] = operator;

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        if (s.operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDeclared();

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeDeclarationCancelled(msg.sender, operatorId);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot();
        operator.fee = shrunkAmount;
        s.operators[operatorId] = operator;

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0);
    }

    // private functions
    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount) private {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
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

        s.operators[operatorId] = operator;

        _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand(), s.token);
    }

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount, IERC20 token) private {
        CoreLib.transferBalance(msg.sender, amount, token);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }
}
