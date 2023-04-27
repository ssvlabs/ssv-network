// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVOperators.sol";
import "./SSVNetwork.sol";
import "./libraries/Types.sol";
import "./libraries/OperatorLib.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVOperators is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVOperators {
    using Types256 for uint256;
    using Types64 for uint64;
    using OperatorLib for Operator;

    ISSVNetwork _ssvNetwork;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[50] __gap;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(ISSVNetwork ssvNetwork_) external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        _ssvNetwork = ssvNetwork_;
    }

    function removeOperator(Operator memory operator) external view override returns (uint64 currentBalance) {
        _onlyOperatorOwner(operator);

        operator.updateSnapshot();
        currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;
    }

    function declareOperatorFee(
        Operator memory operator,
        uint256 fee,
        uint64 minimalOperatorFee,
        uint64 operatorMaxFeeIncrease,
        uint64 declareOperatorFeePeriod,
        uint64 executeOperatorFeePeriod
    ) external view override returns (OperatorFeeChangeRequest memory feeChangeRequest) {
        _onlyOperatorOwner(operator);

        if (fee != 0 && fee < minimalOperatorFee) revert FeeTooLow();
        uint64 operatorFee = operator.fee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee * (10000 + operatorMaxFeeIncrease)) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        feeChangeRequest = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + declareOperatorFeePeriod,
            uint64(block.timestamp) + declareOperatorFeePeriod + executeOperatorFeePeriod
        );
    }

    function executeOperatorFee(
        Operator memory operator,
        OperatorFeeChangeRequest memory feeChangeRequest
    ) external override returns (Operator memory) {
        _onlyOperatorOwner(operator);

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        operator.updateSnapshot();
        operator.fee = feeChangeRequest.fee;

        return operator;
    }

    function reduceOperatorFee(Operator memory operator, uint256 fee) external override returns (Operator memory) {
        _onlyOperatorOwner(operator);

        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot();
        operator.fee = shrunkAmount;

        return operator;
    }

    function _onlyOperatorOwner(Operator memory operator) private view {
        if (operator.snapshot.block == 0) revert OperatorDoesNotExist();
        if (operator.owner != msg.sender) revert CallerNotOwner();
    }
}
