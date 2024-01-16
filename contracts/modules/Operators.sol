// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./SSVOperators.sol";

contract Operators is SSVOperators {
    using Types64 for uint64;
    using Types256 for uint256;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;

    uint64[] opIds;

    event Declared(uint64 maxAllowedFee, uint64 operatorFee);
    event AssertionFailed(uint64 operatorId, bool isWhitelisted);
    event AssertionFailed(uint64 operatorId, uint64 approvalBeginTime);

    constructor() {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = 214800;
        sp.minimumLiquidationCollateral = uint256(1000000000000000000).shrink();
        sp.validatorsPerOperatorLimit = 500;
        sp.declareOperatorFeePeriod = 604800;
        sp.executeOperatorFeePeriod = 604800;
        sp.operatorMaxFeeIncrease = 1000;
    }

    function helper_createOperator(bytes calldata publicKey, uint256 fee) public {
        require(publicKey.length != 0 && publicKey[0] != 0, "invalid publicKey: cannot be empty");
    
        uint256 maxValue = 2 ** 64 * DEDUCTED_DIGITS;

        uint256 minN = (MINIMAL_OPERATOR_FEE + DEDUCTED_DIGITS - 1) / DEDUCTED_DIGITS;
        uint256 maxN = SSVStorageProtocol.load().operatorMaxFee;

        require(fee > minN && fee < maxN, "fee value exceeded");
        fee = fee * DEDUCTED_DIGITS;

        require(SSVStorage.load().operatorsPKs[keccak256(publicKey)] == 0, "Operator exists");

        try this.registerOperator(publicKey, fee) returns (uint64 operatorId) {
            opIds.push(operatorId);
        } catch {
            assert(false);
        }
    }

    function helper_setOperatorWhitelist(uint64 operatorId, address whitelisted) public {
        operatorId = operatorId % uint64(opIds.length);

        this.setOperatorWhitelist(operatorId, whitelisted);
    }

    function helper_declareOperatorFee(uint64 operatorId) public {
        operatorId = operatorId % uint64(opIds.length);

        Operator storage operator = SSVStorage.load().operators[operatorId];
        require(operator.snapshot.block != 0, "operator does not exists");

        uint64 fee = operator.fee;

        uint64 maxAllowedFee = (fee * (PRECISION_FACTOR + SSVStorageProtocol.load().operatorMaxFeeIncrease)) /
            PRECISION_FACTOR;

        this.declareOperatorFee(operatorId, maxAllowedFee.expand());
    }

    function helper_executeOperatorFee(uint64 operatorId) public {
        operatorId = operatorId % uint64(opIds.length);

        this.executeOperatorFee(operatorId);
    }

    function helper_removeOperator(uint64 operatorId) public {
        operatorId = operatorId % uint64(opIds.length);

        this.removeOperator(operatorId);
    }

    /***********
     * Assertions
     ***********/
    function check_removedOperatorNotWhitelisted(uint64 operatorId) public {
        operatorId = operatorId % uint64(opIds.length);

        Operator storage operator = SSVStorage.load().operators[operatorId];

        if ((operator.snapshot.block == 0) && operator.whitelisted)
            emit AssertionFailed(operatorId, operator.whitelisted);
    }

    function check_removedOperatorNoFeeDeclared(uint64 operatorId) public {
        operatorId = 1 + (operatorId % (uint64(opIds.length) - 1));

        Operator storage operator = SSVStorage.load().operators[operatorId];

        if (
            //(operator.owner != address(0)) &&
            (operator.snapshot.block == 0) &&
            (SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime != 0)
        ) {
            emit AssertionFailed(operatorId, SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime);
        }
    }
}
