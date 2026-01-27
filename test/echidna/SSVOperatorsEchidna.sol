// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageEB.sol";
import "../../contracts/libraries/Types.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    using Types64 for uint64;
    using Types256 for uint256;

    uint256 private constant MINIMAL_OPERATOR_ETH_FEE = 10_000_000;
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
    mapping(uint64 => uint64) private expectedEthBalance;
    mapping(uint64 => uint64) private expectedSsvBalance;

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
            } catch {}
            return;
        }

        try user.register(publicKey, fee, setPrivate) returns (uint64 newId) {
            _trackNewOperator(newId, hashedPk, address(user));
        } catch {}
    }

    function action_declare_fee(uint256 idSeed, uint256 feeSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        uint64 beforeFee = getOperator(operatorId).ethFee;
        OperatorUser owner = OperatorUser(payable(ownerAddr));

        try owner.declareFee(operatorId, _boundFee(feeSeed)) {
            uint64 afterFee = getOperator(operatorId).ethFee;
            if (afterFee != beforeFee) {
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
            !noRequest && request.fee.expand() > SSVStorageProtocol.load().operatorMaxFee;

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

        uint256 currentFee = before.ethFee.expand();
        uint256 newFee = _boundFeeBelow(currentFee, feeSeed);
        OperatorUser owner = OperatorUser(payable(ownerAddr));

        try owner.reduceFee(operatorId, newFee) {
            ISSVNetworkCore.Operator memory operatorAfter = getOperator(operatorId);
            if (operatorAfter.ethFee.expand() >= currentFee) {
                invalidReduceSucceeded = true;
            }
            if (operatorAfter.ethFee != 0 && operatorAfter.ethFee.expand() < MINIMAL_OPERATOR_ETH_FEE) {
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
        SSVStorage.load().operators[operatorId].fee = fee.shrink();
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
        sp.ethNetworkFeeIndex += uint64(blocks) * sp.ethNetworkFee;
        sp.networkFeeIndex += uint64(blocks) * sp.networkFee;
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
        if (newFee == operator.ethFee.expand()) return;

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
        uint64 feeBefore = operator.ethFee;

        _fastForwardSingle(operatorId, blocks);
        uint64 indexAfterOld = operator.ethSnapshot.index;
        if (indexAfterOld < indexBefore || indexAfterOld - indexBefore != uint64(blocks) * feeBefore) {
            feeLatencyMismatch = true;
            return;
        }

        try owner.executeFee(operatorId) {} catch {
            return;
        }

        uint64 feeAfter = operator.ethFee;
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
        uint64 balance = before.ethSnapshot.balance;
        uint64 ssvBalanceBefore = before.snapshot.balance;
        if (balance == 0) return;

        uint64 withdrawShrunk = _boundWithdrawAmount(balance, amountSeed);
        uint256 withdrawAmount = withdrawShrunk.expand();
        if (withdrawAmount > address(this).balance) return;

        uint256 ownerEthBefore = ownerAddr.balance;
        uint256 contractEthBefore = address(this).balance;

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdraw(operatorId, withdrawAmount) {
            uint64 afterBalance = getOperator(operatorId).ethSnapshot.balance;
            if (afterBalance != balance - withdrawShrunk) {
                withdrawConservationBroken = true;
            }
            if (ownerAddr.balance != ownerEthBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (address(this).balance != contractEthBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).snapshot.balance != ssvBalanceBefore) {
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
        uint64 balance = before.ethSnapshot.balance;
        uint64 ssvBalanceBefore = before.snapshot.balance;
        if (balance == 0) return;

        uint256 withdrawAmount = balance.expand();
        if (withdrawAmount > address(this).balance) return;

        uint256 ownerEthBefore = ownerAddr.balance;
        uint256 contractEthBefore = address(this).balance;

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawAll(operatorId) {
            uint64 afterBalance = getOperator(operatorId).ethSnapshot.balance;
            if (afterBalance != 0) {
                withdrawAllNotZero = true;
            }
            if (ownerAddr.balance != ownerEthBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (address(this).balance != contractEthBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).snapshot.balance != ssvBalanceBefore) {
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

        uint64 balance = getOperator(operatorId).ethSnapshot.balance;
        if (balance == type(uint64).max) return;

        uint64 overBalance = balance + 1;
        uint256 withdrawAmount = overBalance.expand();

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
        uint64 balance = before.snapshot.balance;
        uint64 ethBalanceBefore = before.ethSnapshot.balance;
        if (balance == 0) return;

        uint64 withdrawShrunk = _boundWithdrawAmount(balance, amountSeed);
        uint256 withdrawAmount = withdrawShrunk.expand();
        if (withdrawAmount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        uint256 contractBefore = token.balanceOf(address(this));

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawSSV(operatorId, withdrawAmount) {
            uint64 afterBalance = getOperator(operatorId).snapshot.balance;
            if (afterBalance != balance - withdrawShrunk) {
                withdrawConservationBroken = true;
            }
            if (token.balanceOf(ownerAddr) != ownerBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (token.balanceOf(address(this)) != contractBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).ethSnapshot.balance != ethBalanceBefore) {
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
        uint64 balance = before.snapshot.balance;
        uint64 ethBalanceBefore = before.ethSnapshot.balance;
        if (balance == 0) return;

        uint256 withdrawAmount = balance.expand();
        if (withdrawAmount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        uint256 contractBefore = token.balanceOf(address(this));

        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawAllSSV(operatorId) {
            uint64 afterBalance = getOperator(operatorId).snapshot.balance;
            if (afterBalance != 0) {
                withdrawAllNotZero = true;
            }
            if (token.balanceOf(ownerAddr) != ownerBefore + withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (token.balanceOf(address(this)) != contractBefore - withdrawAmount) {
                withdrawPayoutMismatch = true;
            }
            if (getOperator(operatorId).ethSnapshot.balance != ethBalanceBefore) {
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

        uint64 balance = getOperator(operatorId).snapshot.balance;
        if (balance == type(uint64).max) return;

        uint64 overBalance = balance + 1;
        uint256 withdrawAmount = overBalance.expand();

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

        uint64 ethBalance = before.ethSnapshot.balance;
        uint64 ssvBalance = before.snapshot.balance;
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
            _updateExpectedBalances(operatorId, 0, 0);
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
            uint64 balance = getOperator(operatorId).ethSnapshot.balance;
            uint256 withdrawAmount = _boundWithdrawAmount(balance == 0 ? 1 : balance, amountSeed).expand();
            try attacker.withdraw(operatorId, withdrawAmount) {
                unauthorizedActionSucceeded = true;
            } catch {}
        } else {
            uint64 balance = getOperator(operatorId).snapshot.balance;
            uint256 withdrawAmount = _boundWithdrawAmount(balance == 0 ? 1 : balance, amountSeed).expand();
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
        uint64 maxFee = SSVStorageProtocol.load().operatorMaxFee;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;
            if (op.ethFee.expand() > maxFee) return false;
        }
        return true;
    }

    function echidna_eth_fee_minimum() external view returns (bool) {
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            uint64 id = operatorIds[i];
            ISSVNetworkCore.Operator memory op = getOperator(id);
            if (!_operatorExists(op)) continue;
            if (op.ethFee != 0 && op.ethFee.expand() < MINIMAL_OPERATOR_ETH_FEE) return false;
        }
        return true;
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
        SSVStorageProtocol.load().operatorMaxFee = fee;
    }

    function _mockSetFeePeriods(uint64 declarePeriod, uint64 executePeriod) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.declareOperatorFeePeriod = declarePeriod;
        sp.executeOperatorFeePeriod = executePeriod;
    }

    function _mockSetOperatorMaxFeeIncrease(uint64 increase) internal {
        SSVStorageProtocol.load().operatorMaxFeeIncrease = increase;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 3000;
        sp.ethNetworkFee = 1;
        sp.networkFee = 1;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.operatorMaxFeeSSV = type(uint64).max;
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
        uint64 maxFee = SSVStorageProtocol.load().operatorMaxFee;
        uint256 maxUnits = uint256(maxFee) / DEDUCTED_DIGITS;
        if (maxUnits == 0) return 0;

        uint256 units = seed % (maxUnits + 1);
        uint256 fee = units * DEDUCTED_DIGITS;

        if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE) {
            fee = MINIMAL_OPERATOR_ETH_FEE;
        }

        if (fee > maxFee) {
            if (maxFee < MINIMAL_OPERATOR_ETH_FEE) return 0;
            fee = maxUnits * DEDUCTED_DIGITS;
            if (fee < MINIMAL_OPERATOR_ETH_FEE) return 0;
        }

        return fee;
    }

    function _boundFeeSSV(uint256 seed) internal view returns (uint256) {
        uint64 maxFee = SSVStorageProtocol.load().operatorMaxFeeSSV;
        uint256 maxUnits = uint256(maxFee) / DEDUCTED_DIGITS;
        if (maxUnits == 0) return 0;

        uint256 units = seed % (maxUnits + 1);
        return units * DEDUCTED_DIGITS;
    }

    function _boundFeeBelow(uint256 currentFee, uint256 seed) internal pure returns (uint256) {
        if (currentFee == 0) return 0;
        if (currentFee <= MINIMAL_OPERATOR_ETH_FEE) return 0;

        uint256 currentUnits = currentFee / DEDUCTED_DIGITS;
        if (currentUnits <= 1) return 0;

        uint256 units = seed % currentUnits;
        uint256 fee = units * DEDUCTED_DIGITS;

        if (fee != 0 && fee < MINIMAL_OPERATOR_ETH_FEE) {
            fee = MINIMAL_OPERATOR_ETH_FEE;
        }
        if (fee >= currentFee) return 0;

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
            uint64 blockDiffFee = uint64(blockDiff) * operator.ethFee;

            // Deviation-only model: effectiveVUnits = baseline + storedDeviation
            uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
            uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

            operator.ethSnapshot.index += blockDiffFee;
            if (effectiveVUnits != 0 && blockDiffFee != 0) {
                uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                operator.ethSnapshot.balance += uint64(delta);
            }
            operator.ethSnapshot.block = currentBlock;
        }

        if (operator.snapshot.block != 0 && operator.snapshot.block < currentBlock) {
            uint32 blockDiff = currentBlock - operator.snapshot.block;
            uint64 blockDiffFee = uint64(blockDiff) * operator.fee;

            operator.snapshot.index += blockDiffFee;
            operator.snapshot.balance += blockDiffFee * operator.validatorCount;
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
            uint64 blockDiffFee = uint64(blocks) * operator.ethFee;
            // Deviation-only model: effectiveVUnits = baseline + storedDeviation
            uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
            uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);

            operator.ethSnapshot.index += blockDiffFee;
            if (effectiveVUnits != 0 && blockDiffFee != 0) {
                uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                operator.ethSnapshot.balance += uint64(delta);
            }
            operator.ethSnapshot.block = currentBlock;
        }

        if (operator.snapshot.block != 0) {
            uint64 blockDiffFee = uint64(blocks) * operator.fee;

            operator.snapshot.index += blockDiffFee;
            operator.snapshot.balance += blockDiffFee * operator.validatorCount;
            operator.snapshot.block = currentBlock;
        }

        if (operator.ethSnapshot.balance < expectedEthBalance[operatorId]) {
            nonMonotonicEarnings = true;
        }
        if (operator.snapshot.balance < expectedSsvBalance[operatorId]) {
            nonMonotonicEarnings = true;
        }

        expectedEthBalance[operatorId] = operator.ethSnapshot.balance;
        expectedSsvBalance[operatorId] = operator.snapshot.balance;
    }

    function _updateExpectedBalances(uint64 operatorId, uint64 ethBalance, uint64 ssvBalance) internal {
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
            uint256 fee = op.ethFee.expand();
            if (fee > maxFee) {
                maxFee = fee;
            }
        }
        if (maxFee > type(uint64).max) {
            return type(uint64).max;
        }
        return uint64(maxFee);
    }

    function _hasPayoutFunds(uint64 ethBalance, uint64 ssvBalance) internal view returns (bool) {
        if (ethBalance.expand() > address(this).balance) return false;
        if (ssvBalance.expand() > token.balanceOf(address(this))) return false;
        return true;
    }

    function _checkRemovalState(uint64 operatorId, ISSVNetworkCore.Operator memory before) internal {
        ISSVNetworkCore.Operator memory operatorAfter = getOperator(operatorId);
        if (operatorAfter.owner != before.owner) {
            removedStateDirty = true;
        }
        if (operatorAfter.ethFee != 0) removedStateDirty = true;
        if (operatorAfter.ethSnapshot.balance != 0 || operatorAfter.ethSnapshot.block != 0) removedStateDirty = true;
        if (operatorAfter.snapshot.balance != 0 || operatorAfter.snapshot.block != 0) removedStateDirty = true;
        if (operatorAfter.validatorCount != 0 || operatorAfter.ethValidatorCount != 0) removedStateDirty = true;
    }

    function _checkPayouts(
        address ownerAddr,
        uint64 ethBalance,
        uint64 ssvBalance,
        uint256 ownerEthBefore,
        uint256 ownerSsvBefore,
        uint256 contractEthBefore,
        uint256 contractSsvBefore
    ) internal {
        uint256 ethAmount = ethBalance.expand();
        uint256 ssvAmount = ssvBalance.expand();

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
