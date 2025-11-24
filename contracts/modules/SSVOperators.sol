// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVOperators} from "../interfaces/ISSVOperators.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is ISSVOperators {
    uint64 private constant MINIMAL_OPERATOR_FEE = 1_000_000_000;
    uint64 private constant MINIMAL_OPERATOR_ETH_FEE = 1_000_000_000;
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
        if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE) {
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
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            ethSnapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: 0,
            ethFee: fee.shrink(),
            whitelisted: setPrivate,
            version: CoreLib.VERSION_ETH
        });
        s.operatorsPKs[hashedPk] = id;

        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
        emit OperatorPrivacyStatusUpdated(operatorIds, setPrivate);
    }

    function removeOperator(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();

        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();

        operator.updateSnapshots();
        uint64 currentBalance = operator.snapshot.balance;
        uint64 currentEthBalance = operator.ethSnapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;

        operator.ethSnapshot.block = 0;
        operator.ethSnapshot.balance = 0;

        operator.validatorCount = 0;

        operator.fee = 0;
        operator.ethFee = 0;

        s.operators[operatorId] = operator;

        delete s.operatorsWhitelist[operatorId];
        ///TODO: Shall we delete the operator from s.operators or we don't want to break the id counter?

        if (currentEthBalance > 0) {
            _transferOperatorBalanceUnsafe(operatorId, currentEthBalance);
        }
        if (currentBalance > 0) {
            _transferOperatorTokenBalanceUnsafe(operatorId, currentBalance);
        }
        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        _declareOperatorFee(operatorId, fee, CoreLib.VERSION_SSV);
    }

    function declareOperatorEthFee(uint64 operatorId, uint256 fee) external override {
        _declareOperatorFee(operatorId, fee, CoreLib.VERSION_ETH);
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

        if (operator.version != feeChangeRequest.version) {
            revert IncorrectOperatorVersion(feeChangeRequest.version);
        }

        if (feeChangeRequest.version == CoreLib.VERSION_ETH) {
            operator.updateETHSnapshot();
            operator.ethFee = feeChangeRequest.fee;
        } else if (feeChangeRequest.version == CoreLib.VERSION_SSV) {
            operator.updateSnapshot();
            operator.fee = feeChangeRequest.fee;
        } else {
            revert IncorrectOperatorVersion(feeChangeRequest.version);
        }
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
        if (operator.version == CoreLib.VERSION_ETH) {
            if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE) revert FeeTooLow();

            uint64 shrunkAmount = fee.shrink();
            if (shrunkAmount >= operator.ethFee) revert FeeIncreaseNotAllowed();

            operator.updateETHSnapshot();
            operator.ethFee = shrunkAmount;
            s.operators[operatorId] = operator;
        } else if (operator.version == CoreLib.VERSION_SSV) {
            if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) revert FeeTooLow();

            uint64 shrunkAmount = fee.shrink();
            if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

            operator.updateSnapshot();
            operator.fee = shrunkAmount;
            s.operators[operatorId] = operator;
        } else {
            revert IncorrectOperatorVersion(operator.version);
        }
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
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_SSV);
    }

    function withdrawAllOperatorEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_SSV);
    }

    function withdrawOperatorETHEarnings(uint64 operatorId, uint256 amount) external override {
        _withdrawOperatorEarnings(operatorId, amount, CoreLib.VERSION_ETH);
    }

    function withdrawAllOperatorETHEarnings(uint64 operatorId) external override {
        _withdrawOperatorEarnings(operatorId, 0, CoreLib.VERSION_ETH);
    }

    function migrateToEth(uint64 operatorId, uint256 fee) external {
        StorageData storage s = SSVStorage.load();
        Operator storage operator = s.operators[operatorId];
        operator.checkOwner();

        if (operator.version == CoreLib.VERSION_ETH) {
            revert IncorrectOperatorVersion(operator.version);
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();
        if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE) revert FeeTooLow();
        if (fee > sp.operatorMaxFee) revert FeeTooHigh();

        operator.updateSnapshot();

        uint64 shrunkFee = fee.shrink();

        operator.fee = 0;
        operator.ethFee = shrunkFee;
        operator.version = CoreLib.VERSION_ETH;
        operator.ethSnapshot.block = uint32(block.number);

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorMigratedToEth(msg.sender, operatorId, block.number, fee);
    }

    function _declareOperatorFee(uint64 operatorId, uint256 fee, uint8 version) internal virtual {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        StorageProtocol storage sp = SSVStorageProtocol.load();
        CoreLib.validateVersion(version);

        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE && version == CoreLib.VERSION_SSV) revert FeeTooLow();
        if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE && version == CoreLib.VERSION_ETH) revert FeeTooLow();
        if (fee > sp.operatorMaxFee) revert FeeTooHigh();

        uint64 operatorFee = version == CoreLib.VERSION_ETH
            ? s.operators[operatorId].ethFee
            : s.operators[operatorId].fee;

        uint64 shrunkFee = fee.shrink();

        bool allowInitialEthFee = version == CoreLib.VERSION_ETH && s.operators[operatorId].ethSnapshot.block == 0;

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0 && !allowInitialEthFee) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        if (!allowInitialEthFee) {
            uint64 maxAllowedFee = (operatorFee * (PRECISION_FACTOR + sp.operatorMaxFeeIncrease)) / PRECISION_FACTOR;

            if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();
        }

        s.operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + sp.declareOperatorFeePeriod,
            uint64(block.timestamp) + sp.declareOperatorFeePeriod + sp.executeOperatorFeePeriod,
            version
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    // private functions
    function _withdrawOperatorEarnings(uint64 operatorId, uint256 amount, uint8 version) private {
        StorageData storage s = SSVStorage.load();
        Operator memory operator = s.operators[operatorId];
        operator.checkOwner();
        CoreLib.validateVersion(version);

        if (version == CoreLib.VERSION_ETH) {
            operator.updateETHSnapshot();
        } else {
            operator.updateSnapshot();
        }

        uint64 shrunkWithdrawn;
        uint64 shrunkAmount = amount.shrink();

        bool isEth = version == CoreLib.VERSION_ETH;
        Snapshot memory snapshot = isEth ? operator.ethSnapshot : operator.snapshot;
        if (amount == 0 && snapshot.balance > 0) {
            shrunkWithdrawn = snapshot.balance;
        } else if (amount > 0 && snapshot.balance >= shrunkAmount) {
            shrunkWithdrawn = shrunkAmount;
        } else {
            revert InsufficientBalance();
        }

        snapshot.balance -= shrunkWithdrawn;
        if (isEth) {
            operator.ethSnapshot = snapshot;
        } else {
            operator.snapshot = snapshot;
        }
        s.operators[operatorId] = operator;
        if (isEth) {
            _transferOperatorBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        } else {
            _transferOperatorTokenBalanceUnsafe(operatorId, shrunkWithdrawn.expand());
        }
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
