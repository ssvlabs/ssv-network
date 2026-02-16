// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVOperators} from "../interfaces/ISSVOperators.sol";
import {PackedSSV, PackedETH, VERSION_ETH, VERSION_SSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib} from "../libraries/SSVPackedLib.sol";
import {SSVStorage, StorageData} from "../libraries/storage/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/storage/SSVStorageProtocol.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";
import {SSVReentrancyGuard} from "../abstract/SSVReentrancyGuard.sol";

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is ISSVOperators, SSVReentrancyGuard {
    uint64 private constant PRECISION_FACTOR = 10_000;
    uint256 public immutable UPGRADE_TIMESTAMP;

    using Counters for Counters.Counter;
    using OperatorLib for Operator;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    constructor(uint256 upgradeTimestamp) {
        UPGRADE_TIMESTAMP = upgradeTimestamp;
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function registerOperator(
        bytes calldata publicKey,
        uint256 fee,
        bool setPrivate
    ) external override returns (uint64 id) {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (fee != 0 && fee < PackedETHLib.unpack(sp.minimumOperatorEthFee)) {
            revert ISSVNetworkCore.FeeTooLow();
        }
        if (fee > PackedETHLib.unpack(sp.operatorMaxFee)) {
            revert ISSVNetworkCore.FeeTooHigh();
        }

        StorageData storage s = SSVStorage.load();

        bytes32 hashedPk = keccak256(publicKey);
        if (s.operatorsPKs[hashedPk] != 0) revert ISSVNetworkCore.OperatorAlreadyExists();

        s.lastOperatorId.increment();
        id = uint64(s.lastOperatorId.current());
        Operator storage op = s.operators[id];

        op.owner = msg.sender;
        op.whitelisted = setPrivate;
        op.ethFee = PackedETHLib.pack(fee);

        op.ethSnapshot.block = uint32(block.number);
        s.operatorsPKs[hashedPk] = id;

        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
        emit OperatorPrivacyStatusUpdated(operatorIds, setPrivate);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function removeOperator(uint64 operatorId) external override nonReentrant {
        StorageData storage s = SSVStorage.load();
        Operator storage operator = s.operators[operatorId];

        operator.checkOwner();

        OperatorLib.updateSnapshotsSt(operator, operatorId);

        PackedETH currentBalanceETH = operator.ethSnapshot.balance;
        PackedSSV currentBalanceSSV = operator.snapshot.balance;

        _resetOperatorState(operator);

        delete s.operatorsWhitelist[operatorId];

        if (PackedETHLib.raw(currentBalanceETH) > 0) {
            _transferOperatorBalanceUnsafe(operatorId, PackedETHLib.unpack(currentBalanceETH));
        }
        if (PackedSSVLib.raw(currentBalanceSSV) > 0) {
            _transferOperatorTokenBalanceUnsafe(operatorId, PackedSSVLib.unpack(currentBalanceSSV));
        }
        emit OperatorRemoved(operatorId);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function declareOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        StorageProtocol storage sp = SSVStorageProtocol.load();

        if (fee != 0 && fee < PackedETHLib.unpack(sp.minimumOperatorEthFee)) revert FeeTooLow();
        if (fee > PackedETHLib.unpack(sp.operatorMaxFee)) revert FeeTooHigh();
        if (s.operators[operatorId].ethSnapshot.block == 0) {
            s.operators[operatorId].ensureETHDefaults();
        }
        PackedSSV operatorSSVFee = s.operators[operatorId].fee;
        PackedETH operatorFee = s.operators[operatorId].ethFee;
        PackedETH shrunkFee = PackedETHLib.pack(fee);

        if (operatorFee.eq(shrunkFee)) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee.raw() != 0 && operatorFee.raw() == 0 && operatorSSVFee.raw() == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee.raw() * (PRECISION_FACTOR + sp.operatorMaxFeeIncrease) + PRECISION_FACTOR - 1) / PRECISION_FACTOR;

        if (shrunkFee.raw() > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        s.operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            PackedETH.unwrap(shrunkFee),
            uint64(block.timestamp) + sp.declareOperatorFeePeriod,
            uint64(block.timestamp) + sp.declareOperatorFeePeriod + sp.executeOperatorFeePeriod
        );
        emit OperatorFeeDeclared(msg.sender, operatorId, block.number, fee);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function executeOperatorFee(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        OperatorFeeChangeRequest memory feeChangeRequest = s.operatorFeeChangeRequests[operatorId];

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDeclared();

        if (feeChangeRequest.approvalBeginTime <= UPGRADE_TIMESTAMP) {
            revert LegacyOperatorFeeDeclarationInvalid();
        }

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        if (PackedETH.wrap(feeChangeRequest.fee).gt(SSVStorageProtocol.load().operatorMaxFee)) revert FeeTooHigh();

        Operator storage operator = s.operators[operatorId];
        OperatorLib.updateSnapshotSt(operator, operatorId);
        operator.ethFee = PackedETH.wrap(feeChangeRequest.fee);

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, PackedETHLib.unpack(PackedETH.wrap(feeChangeRequest.fee)));
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function cancelDeclaredOperatorFee(uint64 operatorId) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        if (s.operatorFeeChangeRequests[operatorId].approvalBeginTime == 0) revert NoFeeDeclared();

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeDeclarationCancelled(msg.sender, operatorId);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function reduceOperatorFee(uint64 operatorId, uint256 fee) external override {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        if (fee != 0 && fee < PackedETHLib.unpack(SSVStorageProtocol.load().minimumOperatorEthFee)) revert FeeTooLow();

        Operator memory operator = s.operators[operatorId]; 

        PackedETH shrunkAmount = PackedETHLib.pack(fee);
        if (shrunkAmount.gte(operator.ethFee)) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot(operatorId);
        operator.ethFee = shrunkAmount;
        s.operators[operatorId] = operator;

        delete s.operatorFeeChangeRequests[operatorId];

        emit OperatorFeeExecuted(msg.sender, operatorId, block.number, fee);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, true, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, true);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, false, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, false);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, amount, VERSION_ETH);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function withdrawAllOperatorEarnings(uint64 operatorId) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, 0, VERSION_ETH);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function withdrawAllVersionOperatorEarnings(uint64 operatorId) external override nonReentrant {
        StorageData storage s = SSVStorage.load();        
        s.operators[operatorId].checkOwner();

        Operator memory operator = s.operators[operatorId]; 

        operator.updateSnapshots(operatorId);

        PackedETH ethBalance = operator.ethSnapshot.balance;
        PackedSSV ssvBalance = operator.snapshot.balance;

        operator.ethSnapshot.balance = PACKED_ETH_ZERO;
        operator.snapshot.balance = PACKED_SSV_ZERO;

        s.operators[operatorId] = operator;

        if (PackedETHLib.raw(ethBalance) > 0) {
            _transferOperatorBalanceUnsafe(operatorId, PackedETHLib.unpack(ethBalance));
        }
        if (PackedSSVLib.raw(ssvBalance) > 0) {
            _transferOperatorTokenBalanceUnsafe(operatorId, PackedSSVLib.unpack(ssvBalance));
        }
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, amount, VERSION_SSV);
    }

    /**
     * @inheritdoc ISSVOperators
     */
    function withdrawAllOperatorEarningsSSV(uint64 operatorId) external override nonReentrant {
        _withdrawOperatorEarnings(operatorId, 0, VERSION_SSV);
    }

    // private functions
    function _withdrawOperatorEarnings(
        uint64 operatorId,
        uint256 amount,
        uint8 version
    ) private {
        StorageData storage s = SSVStorage.load();
        Operator storage operator = s.operators[operatorId];

        operator.checkOwner();

        if (version == VERSION_ETH) {
            PackedETH shrunkWithdrawn;
            PackedETH shrunkAmount = PackedETHLib.pack(amount);
            OperatorLib.updateSnapshotSt(operator, operatorId);

            PackedETH balance = operator.ethSnapshot.balance;

            if (amount == 0) {
                if (PackedETHLib.raw(balance) == 0) revert InsufficientBalance();
                shrunkWithdrawn = balance;
            } else {
                if (PackedETHLib.raw(balance) < PackedETHLib.raw(shrunkAmount)) revert InsufficientBalance();
                shrunkWithdrawn = shrunkAmount;
            }

            operator.ethSnapshot.balance = balance.sub(shrunkWithdrawn);
            _transferOperatorBalanceUnsafe(operatorId, PackedETHLib.unpack(shrunkWithdrawn));

        } else if (version == VERSION_SSV) {
            PackedSSV shrunkWithdrawn;
            PackedSSV shrunkAmount = PackedSSVLib.pack(amount);
            OperatorLib.updateSnapshotStSSV(operator);

            PackedSSV balance = operator.snapshot.balance;

            if (amount == 0) {
                if (PackedSSVLib.raw(balance) == 0) revert InsufficientBalance();
                shrunkWithdrawn = balance;
            } else {
                if (PackedSSVLib.raw(balance) < PackedSSVLib.raw(shrunkAmount)) revert InsufficientBalance();
                shrunkWithdrawn = shrunkAmount;
            }

            operator.snapshot.balance = balance.sub(shrunkWithdrawn);
            _transferOperatorTokenBalanceUnsafe(operatorId, PackedSSVLib.unpack(shrunkWithdrawn));

        } else {
            revert ISSVNetworkCore.IncorrectOperatorVersion(version);
        }
    }

    function _resetOperatorState(Operator storage operator) private returns (Operator memory) {
        operator.ethSnapshot.block = 0;
        operator.ethSnapshot.balance = PACKED_ETH_ZERO;
        operator.ethFee = PACKED_ETH_ZERO;
        operator.snapshot.block = 0;
        operator.snapshot.balance = PACKED_SSV_ZERO;
        operator.fee = PACKED_SSV_ZERO;
        operator.ethValidatorCount = 0;
        operator.validatorCount = 0;
        
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
