// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/ISSVOperators.sol";
import "../../libraries/Types.sol";
import "../../libraries/SSVStorage.sol";
import "../../libraries/SSVStorageProtocol.sol";
import "../../libraries/OperatorLib.sol";
import "../../libraries/CoreLib.sol";

import "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperatorsUpdate is ISSVOperators {
    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;

    using Types256 for uint256;
    using Types64 for uint64;
    using Counters for Counters.Counter;
    using OperatorLib for Operator;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert ISSVNetworkCore.FeeTooLow();
        }
        StorageData storage s = SSVStorage.load();

        bytes32 hashedPk = keccak256(publicKey);
        if (s.operatorsPKs[hashedPk] != 0) revert ISSVNetworkCore.OperatorAlreadyExists();

        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());
        s.operators[id] = Operator({
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink(),
            whitelisted: setPrivate,
            ethValidatorCount: 0,
            ethFee: 0,
            ethSnapshot: ISSVNetworkCore.Snapshot({block: 0, index: 0, balance: 0})
        });
        s.operatorsPKs[hashedPk] = id;

        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
        emit OperatorPrivacyStatusUpdated(operatorIds, setPrivate);
    }

    function removeOperator(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        Operator memory operator = s.operators[operatorId];
        operator.updateSnapshots(operatorId);
        uint64 currentBalanceETH = operator.ethSnapshot.balance;
        uint64 currentBalanceSSV = operator.snapshot.balance;

        operator = _resetOperatorState(operator);

        s.operators[operatorId] = operator;

        delete s.operatorsWhitelist[operatorId];

        if (currentBalanceETH > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentBalanceETH.expand());
        }
        if (currentBalanceSSV > 0) {
            _transferOperatorTokenBalanceUnsafe(operatorId, currentBalanceSSV.expand());
        }
        emit OperatorRemoved(operatorId);
    }
    
    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        Operator storage operator = s.operators[operatorId];
        operator.checkOwner();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();
        if (fee > sp.operatorMaxFee) revert FeeTooHigh();

        uint64 operatorFee = operator.fee;
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
        Operator storage operator = s.operators[operatorId];
        if (operator.owner != msg.sender) revert ISSVNetworkCore.CallerNotOwnerWithData(msg.sender, operator.owner);

        OperatorFeeChangeRequest memory feeChangeRequest = s.operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDeclared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        if (operator.ethSnapshot.block != 0) {
            operator.updateSnapshotSt(operatorId);
            operator.ethFee = feeChangeRequest.fee;
        } else {
            operator.updateSnapshotStSSV();
            operator.ethFee = feeChangeRequest.fee;
            operator.ethValidatorCount = 0;
            operator.ethSnapshot = ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0});
            operator.fee = 0;
        }

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, feeChangeRequest.fee.expand());
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        SSVStorage.load().operators[operatorId].checkOwner();

        if (SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDeclared();

        delete SSVStorage.load().operatorFeeChangeRequests[operatorId];

        emit OperatorFeeDeclarationCancelled(msg.sender, operatorId);
    }

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        Operator memory operator = s.operators[operatorId];
        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot(operatorId);
        operator.fee = shrunkAmount;
        s.operators[operatorId] = operator;

        if (s.operatorFeeChangeRequests[operatorId].approvalBeginTime != 0)
            delete s.operatorFeeChangeRequests[operatorId];
        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
    }

    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, true, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, true);
    }

    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, false, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, false);
    }

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_ETH);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_ETH);
    }

    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        
        s.operators[operatorId].checkOwner();

        Operator memory operator = s.operators[operatorId];
        operator.updateSnapshots(operatorId);

        uint64 ethBalance = operator.ethSnapshot.balance;
        uint64 ssvBalance = operator.snapshot.balance;

        operator.ethSnapshot.balance = 0;
        operator.snapshot.balance = 0;

        s.operators[operatorId] = operator;

        if (ethBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, ethBalance.expand());
        }
        if (ssvBalance > 0) {
            _transferOperatorTokenBalanceUnsafe(operatorId, ssvBalance.expand());
        }
    }

    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_SSV);
    }

    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_SSV);
    }

    // private functions
    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount, uint8 expectedVersion) private {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();
        
        Operator memory operator = s.operators[operatorId];

        if (expectedVersion == CoreLib.VERSION_ETH) {
            operator.updateSnapshot(operatorId);
        } else {
            operator.updateSnapshotSSV();
        }

        uint64 shrunkWithdrawn;
        uint64 shrunkAmount = amount.shrink();

        if (expectedVersion == CoreLib.VERSION_ETH) {
            if (amount == 0 && operator.ethSnapshot.balance > 0) {
                shrunkWithdrawn = operator.ethSnapshot.balance;
            } else if (amount > 0 && operator.ethSnapshot.balance >= shrunkAmount) {
                shrunkWithdrawn = shrunkAmount;
            } else {
                revert InsufficientBalance();
            }
            operator.ethSnapshot.balance -= shrunkWithdrawn;
        } else if (expectedVersion == CoreLib.VERSION_SSV) {
            if (amount == 0 && operator.snapshot.balance > 0) {
                shrunkWithdrawn = operator.snapshot.balance;
            } else if (amount > 0 && operator.snapshot.balance >= shrunkAmount) {
                shrunkWithdrawn = shrunkAmount;
            } else {
                revert InsufficientBalance();
            }
            operator.snapshot.balance -= shrunkWithdrawn;
        } else {
            revert ISSVNetworkCore.IncorrectOperatorVersion(expectedVersion);
        }

        s.operators[operatorId] = operator;

        if (expectedVersion == CoreLib.VERSION_ETH) {
            _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        } else if (expectedVersion == CoreLib.VERSION_SSV) {
            _transferOperatorTokenBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        } else {
            revert ISSVNetworkCore.IncorrectOperatorVersion(expectedVersion);
        }
    }

    function _resetOperatorState(Operator memory operator) private pure returns (Operator memory) {
        operator.ethSnapshot = ISSVNetworkCore.Snapshot({block: 0, index: 0, balance: 0});
        operator.ethValidatorCount = 0;
        operator.ethFee = 0;
        operator.snapshot = ISSVNetworkCore.Snapshot({block: 0, index: 0, balance: 0});
        operator.validatorCount = 0;
        operator.fee = 0;
        return operator;
    }

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        CoreLib.transferBalance(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }

    function _transferOperatorTokenBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        CoreLib.transferTokenBalance(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }
}
