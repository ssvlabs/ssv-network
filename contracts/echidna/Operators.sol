// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../modules/SSVOperators.sol";
import "../libraries/ProtocolLib.sol";
import "./EchidnaLib.sol";

contract Operators is SSVOperators {
    using Types64 for uint64;
    using Types256 for uint256;
    using ProtocolLib for StorageProtocol;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant MAXIMUM_OPERATOR_FEE = 76_528_650_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;
    uint64[] public opIds;
    uint256 private sault;
    uint64 private minNetworkFee;

    event AssertionFailed(uint64 operatorId, bool isWhitelisted);
    event AssertionFailed(uint64 operatorId, uint64 approvalBeginTime);

    constructor() {
        minNetworkFee = MINIMAL_OPERATOR_FEE;
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = 214800;
        sp.minimumLiquidationCollateral = uint256(1000000000000000000).shrink();
        sp.validatorsPerOperatorLimit = 500;
        sp.declareOperatorFeePeriod = 604800;
        sp.executeOperatorFeePeriod = 604800;
        sp.operatorMaxFeeIncrease = 1000;
        sp.operatorMaxFee = MAXIMUM_OPERATOR_FEE;
        sp.validatorsPerOperatorLimit = 50;

        sp.updateNetworkFee(0);
    }

    function getOperatorById(uint64 id) public view returns (ISSVNetworkCore.Operator memory operator) {
        return SSVStorage.load().operators[id];
    }

    function helper_createOperator() public returns (uint64) {
        uint256 minN = minNetworkFee;
        uint256 maxN = SSVStorageProtocol.load().operatorMaxFee;

        bytes memory publicKey = EchidnaLib.generatePublicKey(sault++);
        uint256 fee = EchidnaLib.generateRandomShrinkable(sault++, minN, maxN);

        try this.registerOperator(publicKey, fee) returns (uint64 operatorId) {
            opIds.push(operatorId);
            return operatorId;
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

        Operator memory operator = SSVStorage.load().operators[operatorId];

        if ((operator.snapshot.block == 0) && operator.whitelisted)
            emit AssertionFailed(operatorId, operator.whitelisted);
    }

    function check_removedOperatorNoFeeDeclared(uint64 operatorId) public {
        operatorId = operatorId % uint64(opIds.length);

        Operator memory operator = SSVStorage.load().operators[operatorId];

        if (
            (operator.snapshot.block == 0) &&
            (SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime != 0)
        ) {
            emit AssertionFailed(operatorId, SSVStorage.load().operatorFeeChangeRequests[operatorId].approvalBeginTime);
        }
    }

    function check_removedOperatorBalances() public {
        for (uint256 i; i < opIds.length; i++) {
            Operator memory operator = SSVStorage.load().operators[opIds[i]];
            assert(operator.validatorCount > 0 || operator.snapshot.balance == 0);
        }
    }

    function check_operatorEarningsWithBalance() public {
        StorageProtocol memory sp = SSVStorageProtocol.load();
        uint64 earnings;
        for (uint256 i; i < opIds.length; i++) {
            Operator memory operator = SSVStorage.load().operators[opIds[i]];
            earnings += operator.snapshot.balance;
        }
        assert(sp.daoBalance == earnings);
    }
}
