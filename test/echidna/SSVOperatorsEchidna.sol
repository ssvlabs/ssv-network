// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageEB.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PackedETHLib, PackedSSVLib, DEDUCTED_DIGITS} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV} from "../../contracts/libraries/SSVCoreTypes.sol";


contract OperatorUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    receive() external payable {}

    function register(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64) {
        return operators.registerOperator(publicKey, fee, setPrivate);
    }

    function remove(uint64 operatorId) external {
        operators.removeOperator(operatorId);
    }

    function declareFee(uint64 operatorId, uint256 fee) external {
        operators.declareOperatorFee(operatorId, fee);
    }

    function executeFee(uint64 operatorId) external {
        operators.executeOperatorFee(operatorId);
    }

    function cancelFee(uint64 operatorId) external {
        operators.cancelDeclaredOperatorFee(operatorId);
    }

    function reduceFee(uint64 operatorId, uint256 fee) external {
        operators.reduceOperatorFee(operatorId, fee);
    }

    function withdraw(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawAll(uint64 operatorId) external {
        operators.withdrawAllOperatorEarnings(operatorId);
    }

    function withdrawAllVersion(uint64 operatorId) external {
        operators.withdrawAllVersionOperatorEarnings(operatorId);
    }

    function withdrawSSV(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarningsSSV(operatorId, amount);
    }

    function withdrawAllSSV(uint64 operatorId) external {
        operators.withdrawAllOperatorEarningsSSV(operatorId);
    }
}

contract SSVOperatorsEchidna is SSVOperators(0) {
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;
    
    uint256 private constant DEFAULT_MIN_OPERATOR_ETH_FEE = 10_000_000;
    uint64 private constant MAX_OPERATORS = 8;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    uint64 private constant MAX_SSV_MINT_UNITS = 1_000_000;

    MockToken private token;

    OperatorUser private user1;
    OperatorUser private user2;
    OperatorUser private user3;
    OperatorUser private attacker;

    uint64[] private operatorIds;
    mapping(uint64 => bool) private operatorTracked;
    mapping(uint64 => address) private operatorOwner;
    mapping(uint64 => bytes32) private operatorPk;
    mapping(bytes32 => uint64) private pkToId;
    mapping(uint64 => PackedETH) private expectedEthBalance;
    mapping(uint64 => PackedSSV) private expectedSsvBalance;

    uint64 private lastOperatorId;

    bool private duplicatePkAllowed;
    bool private nonMonotonicId;
    bool private invalidExecuteSucceeded;
    bool private invalidExecuteFeeSucceeded;
    bool private invalidReduceSucceeded;
    bool private overWithdrawSucceeded;
    bool private withdrawAllNotZero;
    bool private withdrawConservationBroken;
    bool private withdrawPayoutMismatch;
    bool private unauthorizedActionSucceeded;
    bool private removedStateDirty;
    bool private removalPayoutMismatch;
    bool private removalContractBalanceMismatch;
    bool private declareChangedFee;
    bool private nonMonotonicEarnings;
    bool private feeLatencyMismatch;
    bool private ethWithdrawTouchedSSV;
    bool private ssvWithdrawTouchedEth;
    bool private operatorRegisteredBelowMinFee;

    constructor() {
        token = new MockToken();
        _mockSetToken(address(token));
        _mockSetOperatorMaxFee(uint64(10 ether));
        _mockSetFeePeriods(1, 10);
        _mockSetOperatorMaxFeeIncrease(10_000);
        _initProtocolDefaults();

        ISSVOperators self = ISSVOperators(address(this));
        user1 = new OperatorUser(self);
        user2 = new OperatorUser(self);
        user3 = new OperatorUser(self);
        attacker = new OperatorUser(self);
    }

    receive() external payable {}

    function action_fund(uint256 amount) external payable {
        amount;
    }

    function action_fund_ssv(uint256 seed) external {
        uint64 units = uint64(seed % (uint256(MAX_SSV_MINT_UNITS) + 1));
        if (units == 0) return;
        uint256 amount = uint256(units) * DEDUCTED_DIGITS;
        token.mint(address(this), amount);
    }

    function action_set_max_fee(uint256 seed) external {
        uint64 minMax = _maxCurrentFeeRaw();
        uint64 newMax = uint64(seed % (uint256(type(uint64).max) + 1));
        if (newMax < minMax) {
            newMax = minMax;
        }
        _mockSetOperatorMaxFee(newMax);
    }

    function action_set_min_operator_eth_fee(uint256 seed) external {
        uint64 maxFee = PackedETH.unwrap(SSVStorageProtocol.load().operatorMaxFee);
        uint64 newMin = uint64(seed % (uint256(maxFee) + 1));
        _mockSetMinimumOperatorEthFee(newMin);
    }

    function action_register(
        uint256 pkSeed,
        uint256 feeSeed,
        uint8 userSeed,
        bool setPrivate
    ) external {
        if (operatorIds.length >= MAX_OPERATORS) return;

        bytes memory publicKey = abi.encodePacked(pkSeed);
        bytes32 hashedPk = keccak256(publicKey);
        OperatorUser user = _pickUser(userSeed);
        uint256 fee = _boundFee(feeSeed);

        if (pkToId[hashedPk] != 0) {
            try user.register(publicKey, fee, setPrivate) returns (uint64 newId) {
                duplicatePkAllowed = true;
                _trackNewOperator(newId, hashedPk, address(user));
                // Check if operator was registered with fee below minimum
                PackedETH minFee = SSVStorageProtocol.load().minimumOperatorEthFee;
                ISSVNetworkCore.Operator memory op = getOperator(newId);
                if (op.ethFee.neq(PACKED_ETH_ZERO) && op.ethFee.lt(minFee)) {
                    operatorRegisteredBelowMinFee = true;
                }
            } catch {}
            return;
        }

        try user.register(publicKey, fee, setPrivate) returns (uint64 newId) {
            _trackNewOperator(newId, hashedPk, address(user));
            // Check if operator was registered with fee below minimum (should not happen)
            PackedETH minFee = SSVStorageProtocol.load().minimumOperatorEthFee;
            ISSVNetworkCore.Operator memory op = getOperator(newId);
            if (op.ethFee.neq(PACKED_ETH_ZERO) && op.ethFee.lt(minFee)) {
                operatorRegisteredBelowMinFee = true;
            }
        } catch {}
    }

    function action_declare_fee(uint256 idSeed, uint256 feeSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        PackedETH beforeFee = getOperator(operatorId).ethFee;
        OperatorUser owner = OperatorUser(payable(ownerAddr));

        try owner.declareFee(operatorId, _boundFee(feeSeed)) {
            PackedETH afterFee = getOperator(operatorId).ethFee;
            if (afterFee.neq(beforeFee)) {
                declareChangedFee = true;
            }
        } catch {}
    }

    function action_execute_fee(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.OperatorFeeChangeRequest memory request = getOperatorFeeChangeRequest(operatorId);
        bool noRequest = request.approvalBeginTime == 0;
        bool outsideWindow =
            !noRequest &&
            (block.timestamp < request.approvalBeginTime || block.timestamp > request.approvalEndTime);
        bool feeTooHigh =
            !noRequest && PackedETH.wrap(request.fee).gt(SSVStorageProtocol.load().operatorMaxFee);

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.executeFee(operatorId) {
            if (noRequest || outsideWindow) {
                invalidExecuteSucceeded = true;
            }
            if (feeTooHigh) {
                invalidExecuteFeeSucceeded = true;
            }
        } catch {}
    }

    function action_reduce_fee(uint256 idSeed, uint256 feeSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        if (!_operatorExists(before)) return;

        uint256 currentFee = PackedETHLib.unpack(before.ethFee);
        uint256 newFee = _boundFeeBelow(currentFee, feeSeed);
        OperatorUser owner = OperatorUser(payable(ownerAddr));

        try owner.reduceFee(operatorId, newFee) {
            ISSVNetworkCore.Operator memory operatorAfter = getOperator(operatorId);
            if (PackedETHLib.unpack(operatorAfter.ethFee) >= currentFee) {
                invalidReduceSucceeded = true;
            }
            PackedETH minFee = SSVStorageProtocol.load().minimumOperatorEthFee;
            if (operatorAfter.ethFee.neq(PACKED_ETH_ZERO) && operatorAfter.ethFee.lt(minFee)) {
                invalidReduceSucceeded = true;
            }
            if (getOperatorFeeChangeRequest(operatorId).approvalBeginTime != 0) {
                invalidReduceSucceeded = true;
            }
        } catch {}
    }

    function action_set_ssv_fee(uint256 idSeed, uint256 feeSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        if (!_operatorExists(getOperator(operatorId))) return;

        uint256 fee = _boundFeeSSV(feeSeed);
        SSVStorage.load().operators[operatorId].fee = PackedSSVLib.pack(fee);
    }

    function action_assign_validators(uint256 idSeed, uint256 deltaSeed, bool eth) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;

        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageData storage s = SSVStorage.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
        if (!_operatorExists(operator)) return;

        uint32 delta = uint32(deltaSeed % 64) + 1;
        if (eth) {
            if (operator.ethValidatorCount + delta > sp.validatorsPerOperatorLimit) return;
            operator.ethValidatorCount += delta;
        } else {
            if (operator.validatorCount + delta > sp.validatorsPerOperatorLimit) return;
            operator.validatorCount += delta;
        }
    }

    function action_advance_time(uint256 seed) external {
        uint32 blocks = uint32(seed % MAX_ADVANCE_BLOCKS) + 1;
        _fastForwardOperators(blocks);

        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFeeIndex += uint64(blocks) * PackedETH.unwrap(sp.ethNetworkFee);
        sp.networkFeeIndex += uint64(blocks) * PackedSSV.unwrap(sp.networkFee);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
    }

    function action_fee_change_latency(uint256 idSeed, uint256 feeSeed, uint256 blocksSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];
        if (!_operatorExists(operator)) return;

        uint256 newFee = _boundFee(feeSeed);
        if (newFee == PackedETH.unwrap(operator.ethFee)) return;

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.declareFee(operatorId, newFee) {} catch {
            return;
        }

        ISSVNetworkCore.OperatorFeeChangeRequest storage request =
            SSVStorage.load().operatorFeeChangeRequests[operatorId];
        if (request.approvalBeginTime != 0) {
            request.approvalBeginTime = uint64(block.timestamp);
            request.approvalEndTime = uint64(block.timestamp) + 1;
        }

        uint32 blocks = uint32(blocksSeed % MAX_ADVANCE_BLOCKS) + 1;
        uint64 indexBefore = operator.ethSnapshot.index;
        uint64 feeBefore = PackedETH.unwrap(operator.ethFee);

        _fastForwardSingle(operatorId, blocks);
        uint64 indexAfterOld = operator.ethSnapshot.index;
        if (indexAfterOld < indexBefore || indexAfterOld - indexBefore != uint64(blocks) * feeBefore) {
            feeLatencyMismatch = true;
            return;
        }

        try owner.executeFee(operatorId) {} catch {
            return;
        }

        uint64 feeAfter = PackedETH.unwrap(operator.ethFee);
        uint64 indexMid = operator.ethSnapshot.index;

        _fastForwardSingle(operatorId, blocks);
        uint64 indexAfterNew = operator.ethSnapshot.index;
        if (indexAfterNew < indexMid || indexAfterNew - indexMid != uint64(blocks) * feeAfter) {
            feeLatencyMismatch = true;
        }
    }

    function action_withdraw(uint256 idSeed, uint256 amountSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        PackedETH balance = before.ethSnapshot.balance;
        PackedSSV ssvBalanceBefore = before.snapshot.balance;
        if (balance.eq(PACKED_ETH_ZERO)) return;

        uint64 withdrawShrunk = _boundWithdrawAmount(PackedETH.unwrap(balance), amountSeed);
        uint256 withdrawAmount = PackedETHLib.unpack(PackedETH.wrap(withdrawShrunk));
        if (withdrawAmount > address(this).balance) return;

        uint256 ownerEthBefore = ownerAddr.balance;
        uint256 contractEthBefore = address(this).balance;

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdraw(operatorId, withdrawAmount) {
            PackedETH afterBalance = getOperator(operatorId).ethSnapshot.balance;
            if (afterBalance.neq(balance.sub(PackedETH.wrap(withdrawShrunk)))) {
                withdrawConservationBroken = true;
            }
            if (ownerAddr.balance != ownerEthBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (address(this).balance != contractEthBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).snapshot.balance.neq(ssvBalanceBefore)) {
                ethWithdrawTouchedSSV = true;
            }
            _updateExpectedBalances(operatorId, afterBalance, expectedSsvBalance[operatorId]);
        } catch {}
    }

    function action_withdraw_all(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        PackedETH balance = before.ethSnapshot.balance;
        PackedSSV ssvBalanceBefore = before.snapshot.balance;
        if (balance.eq(PACKED_ETH_ZERO)) return;

        uint256 withdrawAmount = PackedETHLib.unpack(balance);
        if (withdrawAmount > address(this).balance) return;

        uint256 ownerEthBefore = ownerAddr.balance;
        uint256 contractEthBefore = address(this).balance;

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawAll(operatorId) {
            PackedETH afterBalance = getOperator(operatorId).ethSnapshot.balance;
            if (afterBalance.neq(PACKED_ETH_ZERO)) {
                withdrawAllNotZero = true;
            }
            if (ownerAddr.balance != ownerEthBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (address(this).balance != contractEthBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).snapshot.balance.neq(ssvBalanceBefore)) {
                ethWithdrawTouchedSSV = true;
            }
            _updateExpectedBalances(operatorId, afterBalance, expectedSsvBalance[operatorId]);
        } catch {}
    }

    function action_withdraw_over(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        PackedETH balance = getOperator(operatorId).ethSnapshot.balance;
        if (balance.eq(PackedETH.wrap(type(uint64).max))) return;

        PackedETH overBalance = balance.add(PackedETH.wrap(1));
        uint256 withdrawAmount = PackedETHLib.unpack(overBalance);

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdraw(operatorId, withdrawAmount) {
            overWithdrawSucceeded = true;
        } catch {}
    }

    function action_withdraw_ssv(uint256 idSeed, uint256 amountSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        PackedSSV balance = before.snapshot.balance;
        PackedETH ethBalanceBefore = before.ethSnapshot.balance;
        if (balance.eq(PACKED_SSV_ZERO)) return;

        uint64 withdrawShrunk = _boundWithdrawAmount(PackedSSV.unwrap(balance), amountSeed);
        uint256 withdrawAmount = PackedSSVLib.unpack(PackedSSV.wrap(withdrawShrunk));
        if (withdrawAmount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        uint256 contractBefore = token.balanceOf(address(this));

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawSSV(operatorId, withdrawAmount) {
            PackedSSV afterBalance = getOperator(operatorId).snapshot.balance;
            if (afterBalance.neq(balance.sub(PackedSSV.wrap(withdrawShrunk)))) {
                withdrawConservationBroken = true;
            }
            if (token.balanceOf(ownerAddr) != ownerBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (token.balanceOf(address(this)) != contractBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).ethSnapshot.balance.neq(ethBalanceBefore)) {
                ssvWithdrawTouchedEth = true;
            }
            _updateExpectedBalances(operatorId, expectedEthBalance[operatorId], afterBalance);
        } catch {}
    }

    function action_withdraw_all_ssv(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        PackedSSV balance = before.snapshot.balance;
        PackedETH ethBalanceBefore = before.ethSnapshot.balance;
        if (balance.eq(PACKED_SSV_ZERO)) return;

        uint256 withdrawAmount = PackedSSVLib.unpack(balance);
        if (withdrawAmount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        uint256 contractBefore = token.balanceOf(address(this));

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawAllSSV(operatorId) {
            PackedSSV afterBalance = getOperator(operatorId).snapshot.balance;
            if (afterBalance.neq(PACKED_SSV_ZERO)) {
                withdrawAllNotZero = true;
            }
            if (token.balanceOf(ownerAddr) != ownerBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (token.balanceOf(address(this)) != contractBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).ethSnapshot.balance.neq(ethBalanceBefore)) {
                ssvWithdrawTouchedEth = true;
            }
            _updateExpectedBalances(operatorId, expectedEthBalance[operatorId], afterBalance);
        } catch {}
    }

    function action_withdraw_over_ssv(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        PackedSSV balance = getOperator(operatorId).snapshot.balance;
        if (balance.eq(PackedSSV.wrap(type(uint64).max))) return;

        PackedSSV overBalance = balance.add(PackedSSV.wrap(1));
        uint256 withdrawAmount = PackedSSVLib.unpack(overBalance);

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawSSV(operatorId, withdrawAmount) {
            overWithdrawSucceeded = true;
        } catch {}
    }

    function action_remove(uint256 idSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        _syncToCurrentBlock(operatorId);

        ISSVNetworkCore.Operator memory before = getOperator(operatorId);
        if (!_operatorExists(before)) return;

        PackedETH ethBalance = before.ethSnapshot.balance;
        PackedSSV ssvBalance = before.snapshot.balance;
        if (!_hasPayoutFunds(ethBalance, ssvBalance)) return;

        uint256 ownerEthBefore = ownerAddr.balance;
        uint256 ownerSsvBefore = token.balanceOf(ownerAddr);
        uint256 contractEthBefore = address(this).balance;
        uint256 contractSsvBefore = token.balanceOf(address(this));

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.remove(operatorId) {
            _checkRemovalState(operatorId, before);
            _checkPayouts(
                ownerAddr,
                ethBalance,
                ssvBalance,
                ownerEthBefore,
                ownerSsvBefore,
                contractEthBefore,
                contractSsvBefore
            );
            _updateExpectedBalances(operatorId, PACKED_ETH_ZERO, PACKED_SSV_ZERO);
        } catch {}
    }

    function action_unauthorized(uint256 idSeed, uint8 actionSeed, uint256 amountSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        if (operatorOwner[operatorId] == address(attacker)) return;

        uint8 choice = actionSeed % 6;
        if (choice == 0) {
            try attacker.remove(operatorId) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else if (choice == 1) {
            try attacker.declareFee(operatorId, _boundFee(amountSeed)) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else if (choice == 2) {
            try attacker.executeFee(operatorId) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else if (choice == 3) {
            try attacker.reduceFee(operatorId, _boundFee(amountSeed)) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else if (choice == 4) {
            uint64 balance = PackedETH.unwrap(getOperator(operatorId).ethSnapshot.balance);
            uint256 withdrawAmount = PackedETHLib.unpack(PackedETH.wrap(_boundWithdrawAmount(balance == 0 ? 1 : balance, amountSeed)));
            try attacker.withdraw(operatorId, withdrawAmount) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else {
            uint64 balance = PackedSSV.unwrap(getOperator(operatorId).snapshot.balance);
            uint256 withdrawAmount = PackedSSVLib.unpack(PackedSSV.wrap(_boundWithdrawAmount(balance == 0 ? 1 : balance, amountSeed)));
            try attacker.withdrawSSV(operatorId, withdrawAmount) {
                unauthorizedActionSucceeded = true;
            } catch {}
        }
    }

    function echidna_unique_active_pubkeys() external view returns (bool) {
        if (duplicatePkAllowed) return false;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;

            bytes32 pk = operatorPk[id];
            if (pk == bytes32(0)) return false;
            if (SSVStorage.load().operatorsPKs[pk] != id) return false;

            for (uint256 j = i + 1; j < count; ++j) {
                uint64 otherId = operatorIds[j];
                ISSVNetworkCore.Operator memory other = getOperator(otherId);
                if (!_operatorExists(other)) continue;
                if (pk == operatorPk[otherId]) return false;
            }
        }
        return true;
    }

    function echidna_id_monotonic() external view returns (bool) {
        return !nonMonotonicId;
    }

    function echidna_registered_owners_non_zero() external view returns (bool) {
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;
            if (op.owner == address(0)) return false;
        }
        return true;
    }

    function echidna_eth_fee_within_max() external view returns (bool) {
        PackedETH maxFee = SSVStorageProtocol.load().operatorMaxFee;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;
            if (op.ethFee.gt(maxFee)) return false;
        }
        return true;
    }

    // Note: This invariant only checks that operators cannot be registered with a fee
    // below the minimum at registration time. Existing operators are grandfathered
    // when the DAO increases the minimum fee, so we track violation at registration.
    function echidna_eth_fee_minimum() external view returns (bool) {
        return !operatorRegisteredBelowMinFee;
    }

    function echidna_declare_does_not_change_fee() external view returns (bool) {
        return !declareChangedFee;
    }

    function echidna_execute_requires_valid_window() external view returns (bool) {
        return !invalidExecuteSucceeded;
    }

    function echidna_execute_rejects_invalid_fee() external view returns (bool) {
        return !invalidExecuteFeeSucceeded;
    }

    function echidna_reduce_fee_decreases() external view returns (bool) {
        return !invalidReduceSucceeded;
    }

    function echidna_withdraw_limit_enforced() external view returns (bool) {
        return !overWithdrawSucceeded;
    }

    function echidna_withdraw_all_clears_balance() external view returns (bool) {
        return !withdrawAllNotZero;
    }

    function echidna_withdraw_conserves_balance() external view returns (bool) {
        return !withdrawConservationBroken && !withdrawPayoutMismatch;
    }

    function echidna_earnings_monotonic() external view returns (bool) {
        return !nonMonotonicEarnings;
    }

    function echidna_fee_change_latency() external view returns (bool) {
        return !feeLatencyMismatch;
    }

    function echidna_eth_withdraw_keeps_ssv() external view returns (bool) {
        return !ethWithdrawTouchedSSV;
    }

    function echidna_ssv_withdraw_keeps_eth() external view returns (bool) {
        return !ssvWithdrawTouchedEth;
    }

    function echidna_owner_only_actions() external view returns (bool) {
        return !unauthorizedActionSucceeded;
    }

    function echidna_remove_cleans_state() external view returns (bool) {
        return !removedStateDirty;
    }

    function echidna_remove_pays_out() external view returns (bool) {
        return !removalPayoutMismatch && !removalContractBalanceMismatch;
    }

    function _pickUser(uint8 seed) internal view returns (OperatorUser) {
        uint8 idx = seed % 3;
        if (idx == 0) return user1;
        if (idx == 1) return user2;
        return user3;
    }

    function _pickOperatorId(uint256 seed) internal view returns (uint64) {
        uint256 count = operatorIds.length;
        if (count == 0) return 0;
        return operatorIds[seed % count];
    }

    function _mockSetOperatorMaxFee(uint64 fee) internal {
        SSVStorageProtocol.load().operatorMaxFee = PackedETH.wrap(fee);
    }

    function _mockSetFeePeriods(uint64 declarePeriod, uint64 executePeriod) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.declareOperatorFeePeriod = declarePeriod;
        sp.executeOperatorFeePeriod = executePeriod;
    }

    function _mockSetOperatorMaxFeeIncrease(uint64 increase) internal {
        SSVStorageProtocol.load().operatorMaxFeeIncrease = increase;
    }

    function _mockSetMinimumOperatorEthFee(uint64 fee) internal {
        SSVStorageProtocol.load().minimumOperatorEthFee = PackedETH.wrap(fee);
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 3000;
        sp.ethNetworkFee = PackedETH.wrap(1);
        sp.networkFee = PackedSSV.wrap(1);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.operatorMaxFeeSSV = type(uint64).max;
        sp.minimumOperatorEthFee = PackedETHLib.pack(DEFAULT_MIN_OPERATOR_ETH_FEE);
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function getOperator(uint64 operatorId) internal view returns (ISSVNetworkCore.Operator memory) {
        return SSVStorage.load().operators[operatorId];
    }

    function getOperatorFeeChangeRequest(
        uint64 operatorId
    ) internal view returns (ISSVNetworkCore.OperatorFeeChangeRequest memory) {
        return SSVStorage.load().operatorFeeChangeRequests[operatorId];
    }

    function _trackNewOperator(uint64 operatorId, bytes32 hashedPk, address ownerAddr) internal {
        if (operatorId == 0) return;
        if (operatorId <= lastOperatorId) {
            nonMonotonicId = true;
        }
        lastOperatorId = operatorId;
        if (!operatorTracked[operatorId]) {
            operatorTracked[operatorId] = true;
            operatorIds.push(operatorId);
        }
        operatorOwner[operatorId] = ownerAddr;
        operatorPk[operatorId] = hashedPk;
        pkToId[hashedPk] = operatorId;
    }

    function _operatorExists(ISSVNetworkCore.Operator memory operator) internal pure returns (bool) {
        return operator.snapshot.block != 0 || operator.ethSnapshot.block != 0;
    }

    function _boundFee(uint256 seed) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        // Unpack packed values to get actual fee amounts
        uint256 maxFeeWei = PackedETHLib.unpack(sp.operatorMaxFee);
        uint256 minFeeWei = PackedETHLib.unpack(sp.minimumOperatorEthFee);
        
        if (maxFeeWei == 0) return 0;
    
        uint256 units = seed % (maxFeeWei + 1);
        uint256 fee = units;
    
        if (fee != 0 && fee < minFeeWei) {
            fee = minFeeWei;
        }
    
        if (fee > maxFeeWei) {
            if (maxFeeWei < minFeeWei) return 0;
            fee = maxFeeWei;
            if (fee < minFeeWei) return 0;
        }
    
        return fee;
    }

   function _boundFeeSSV(uint256 seed) internal view returns (uint256) {
        uint64 maxFee = SSVStorageProtocol.load().operatorMaxFeeSSV;
        if (maxFee == 0) return 0;
        
        uint256 shrunkFee = seed % (uint256(maxFee) + 1);
        return shrunkFee * DEDUCTED_DIGITS;
    }

    function _boundFeeBelow(uint256 currentFee, uint256 seed) internal view returns (uint256) {
        uint256 minFeeWei = PackedETHLib.unpack(SSVStorageProtocol.load().minimumOperatorEthFee);
        if (currentFee == 0) return 0;
        if (currentFee <= minFeeWei) return 0;
        
        uint256 range = currentFee - minFeeWei;
        uint256 fee = minFeeWei + (seed % range);
        
        return fee;
    }

    function _boundWithdrawAmount(uint64 balance, uint256 seed) internal pure returns (uint64) {
        if (balance == 0) return 0;
        return uint64(seed % balance) + 1;
    }

    function _fastForwardOperators(uint32 blocks) internal {
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            _fastForwardSingle(operatorIds[i], blocks);
        }
    }

    function _syncToCurrentBlock(uint64 operatorId) internal {
        StorageData storage s = SSVStorage.load();
        StorageEB storage seb = SSVStorageEB.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
        if (operator.ethSnapshot.block == 0 && operator.snapshot.block == 0) return;

        uint32 currentBlock = uint32(block.number);

        if (operator.ethSnapshot.block != 0 && operator.ethSnapshot.block < currentBlock) {
            uint32 blockDiff = currentBlock - operator.ethSnapshot.block;
            uint64 blockDiffFee = uint64(blockDiff) * PackedETH.unwrap(operator.ethFee);

            // Deviation-only model: effectiveVUnits = baseline + storedDeviation
            uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
            uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

            operator.ethSnapshot.index += blockDiffFee;
            if (effectiveVUnits != 0 && blockDiffFee != 0) {
                uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
            }
            operator.ethSnapshot.block = currentBlock;
        }

        if (operator.snapshot.block != 0 && operator.snapshot.block < currentBlock) {
            uint32 blockDiff = currentBlock - operator.snapshot.block;
            uint64 blockDiffFee = uint64(blockDiff) * PackedSSV.unwrap(operator.fee);

            operator.snapshot.index += blockDiffFee;
            operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
            operator.snapshot.block = currentBlock;
        }

        expectedEthBalance[operatorId] = operator.ethSnapshot.balance;
        expectedSsvBalance[operatorId] = operator.snapshot.balance;
    }

    function _fastForwardSingle(uint64 operatorId, uint32 blocks) internal {
        StorageData storage s = SSVStorage.load();
        StorageEB storage seb = SSVStorageEB.load();
        ISSVNetworkCore.Operator storage operator = s.operators[operatorId];
        if (operator.ethSnapshot.block == 0 && operator.snapshot.block == 0) return;

        uint32 currentBlock = uint32(block.number);
        if (operator.ethSnapshot.block != 0) {
            uint64 blockDiffFee = uint64(blocks) * PackedETH.unwrap(operator.ethFee);
            // Deviation-only model: effectiveVUnits = baseline + storedDeviation
            uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
            uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

            operator.ethSnapshot.index += blockDiffFee;
            if (effectiveVUnits != 0 && blockDiffFee != 0) {
                uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
            }
            operator.ethSnapshot.block = currentBlock;
        }

        if (operator.snapshot.block != 0) {
            uint64 blockDiffFee = uint64(blocks) * PackedSSV.unwrap(operator.fee);

            operator.snapshot.index += blockDiffFee;
            operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
            operator.snapshot.block = currentBlock;
        }

        if (operator.ethSnapshot.balance.lt(expectedEthBalance[operatorId])) {
            nonMonotonicEarnings = true;
        }
        if (operator.snapshot.balance.lt(expectedSsvBalance[operatorId])) {
            nonMonotonicEarnings = true;
        }

        expectedEthBalance[operatorId] = operator.ethSnapshot.balance;
        expectedSsvBalance[operatorId] = operator.snapshot.balance;
    }

    function _updateExpectedBalances(uint64 operatorId, PackedETH ethBalance, PackedSSV ssvBalance) internal {
        expectedEthBalance[operatorId] = ethBalance;
        expectedSsvBalance[operatorId] = ssvBalance;
    }

    function _maxCurrentFeeRaw() internal view returns (uint64) {
        uint256 count = operatorIds.length;
        uint256 maxFee = 0;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;
            uint256 fee = PackedETHLib.unpack(op.ethFee);
            if (fee > maxFee) {
                maxFee = fee;
            }
        }
        if (maxFee > type(uint64).max) {
            return type(uint64).max;
        }
        return uint64(maxFee);
    }

    function _hasPayoutFunds(PackedETH ethBalance, PackedSSV ssvBalance) internal view returns (bool) {
        if (PackedETHLib.unpack(ethBalance) > address(this).balance) return false;
        if (PackedSSVLib.unpack(ssvBalance) > token.balanceOf(address(this))) return false;
        return true;
    }

    function _checkRemovalState(uint64 operatorId, ISSVNetworkCore.Operator memory before) internal {
        ISSVNetworkCore.Operator memory operatorAfter = getOperator(operatorId);
        if (operatorAfter.owner != before.owner) {
            removedStateDirty = true;
        }
        if (operatorAfter.ethFee.neq(PACKED_ETH_ZERO)) removedStateDirty = true;
        if (operatorAfter.ethSnapshot.balance.neq(PACKED_ETH_ZERO) || operatorAfter.ethSnapshot.block != 0) removedStateDirty = true;
        if (operatorAfter.snapshot.balance.neq(PACKED_SSV_ZERO) || operatorAfter.snapshot.block != 0) removedStateDirty = true;
        if (operatorAfter.validatorCount != 0 || operatorAfter.ethValidatorCount != 0) removedStateDirty = true;
    }

    function _checkPayouts(
        address ownerAddr,
        PackedETH ethBalance,
        PackedSSV ssvBalance,
        uint256 ownerEthBefore,
        uint256 ownerSsvBefore,
        uint256 contractEthBefore,
        uint256 contractSsvBefore
    ) internal {
        uint256 ethAmount = PackedETHLib.unpack(ethBalance);
        uint256 ssvAmount = PackedSSVLib.unpack(ssvBalance);

        if (ethAmount > 0) {
            if (ownerAddr.balance != ownerEthBefore + ethAmount) {
                removalPayoutMismatch = true;
            }
            if (address(this).balance != contractEthBefore - ethAmount) {
                removalContractBalanceMismatch = true;
            }
        }

        if (ssvAmount > 0) {
            if (token.balanceOf(ownerAddr) != ownerSsvBefore + ssvAmount) {
                removalPayoutMismatch = true;
            }
            if (token.balanceOf(address(this)) != contractSsvBefore - ssvAmount) {
                removalContractBalanceMismatch = true;
            }
        }
    }
}
