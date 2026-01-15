// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVOperators} from "../interfaces/ISSVOperators.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is ISSVOperators, SSVReentrancyGuard {
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
        if (fee != 0 && fee < OperatorLib.MINIMAL_OPERATOR_ETH_FEE) {
            revert ISSVNetworkCore.FeeTooLow();
        }
        if (fee > SSVStorageProtocol.load().operatorMaxFee) {
            revert ISSVNetworkCore.FeeTooHigh();
        }

        StorageData storage s = SSVStorage.load();

        bytes32 hashedPk = keccak256(publicKey);
        if (s.operatorsPKs[hashedPk] != 0) revert ISSVNetworkCore.OperatorAlreadyExists();

        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());
        s.operators[id] = Operator({
            validatorCount: 0,
            fee: 0,
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            whitelisted: setPrivate,
            ethValidatorCount: 0,
            ethFee: fee.shrink(),
            ethSnapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0})
        });
        s.operatorsPKs[hashedPk] = id;

        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
        emit OperatorPrivacyStatusUpdated(operatorIds, setPrivate);
    }

    function removeOperator(uint64 operatorId) external override nonReentrant {
        StorageData storage s = SSVStorage.load();

        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

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
        s.operators[operatorId].checkOwner();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (fee != 0 && fee < OperatorLib.MINIMAL_OPERATOR_ETH_FEE) revert FeeTooLow();
        if (fee > sp.operatorMaxFee) revert FeeTooHigh();
        if (s.operators[operatorId].ethSnapshot.block == 0) {
            s.operators[operatorId].ensureETHDefaults();
        }
        uint64 operatorSSVFee = s.operators[operatorId].fee;
        uint64 operatorFee = s.operators[operatorId].ethFee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0 && operatorSSVFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        // todo double check -1, prevision needed for min fee
        uint64 maxAllowedFee = (operatorFee * (PRECISION_FACTOR + sp.operatorMaxFeeIncrease) + PRECISION_FACTOR - 1) / PRECISION_FACTOR;

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

        operator.updateSnapshot(operatorId);
        operator.ethFee = feeChangeRequest.fee;
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

        if (fee != 0 && fee < OperatorLib.MINIMAL_OPERATOR_ETH_FEE) revert FeeTooLow();

        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.ethFee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot(operatorId);
        operator.ethFee = shrunkAmount;
        s.operators[operatorId] = operator;

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

    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_ETH);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_ETH);
    }

    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override nonReentrant {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

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

    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_SSV);
    }

    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_SSV);
    }

    // private functions
    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount, uint8 version) private {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

        if (version == CoreLib.VERSION_ETH) {
            operator.updateSnapshot(operatorId);
        } else {
            operator.updateSnapshotSSV(operatorId);
        }

        uint64 shrunkWithdrawn;
        uint64 shrunkAmount = amount.shrink();

        if (version == CoreLib.VERSION_ETH) {
            if (amount == 0 && operator.ethSnapshot.balance > 0) {
                shrunkWithdrawn = operator.ethSnapshot.balance;
            } else if (amount > 0 && operator.ethSnapshot.balance >= shrunkAmount) {
                shrunkWithdrawn = shrunkAmount;
            } else {
                revert InsufficientBalance();
            }
            operator.ethSnapshot.balance -= shrunkWithdrawn;
        } else if (version == CoreLib.VERSION_SSV) {
            if (amount == 0 && operator.snapshot.balance > 0) {
                shrunkWithdrawn = operator.snapshot.balance;
            } else if (amount > 0 && operator.snapshot.balance >= shrunkAmount) {
                shrunkWithdrawn = shrunkAmount;
            } else {
                revert InsufficientBalance();
            }
            operator.snapshot.balance -= shrunkWithdrawn;
        } else {
            revert ISSVNetworkCore.IncorrectOperatorVersion(version);
        }

        s.operators[operatorId] = operator;

        if (version == CoreLib.VERSION_ETH) {
            _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        } else {
            _transferOperatorTokenBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        }
    }

    function _resetOperatorState(Operator memory operator) private pure returns (Operator memory) {
        operator.ethSnapshot.block = 0;
        operator.ethSnapshot.balance = 0;
        operator.ethValidatorCount = 0;
        operator.ethFee = 0;
        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;
        return operator;
    }

    function _transferOperatorBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        CoreLib.transferBalance(payable(msg.sender), amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }

    function _transferOperatorTokenBalanceUnsafe(uint64 operatorId, uint256 amount) private {
        CoreLib.transferTokenBalance(msg.sender, amount);
        emit OperatorWithdrawn(msg.sender, operatorId, amount);
    }
}
