// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./SSVOperators.sol";
import "../libraries/ProtocolLib.sol";

contract Operators is SSVOperators {
    using Types64 for uint64;
    using Types256 for uint256;
    using ProtocolLib for StorageProtocol;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant PRECISION_FACTOR = 10_000;
    uint64[] opIds;
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
        sp.operatorMaxFee = minNetworkFee * 2;

        sp.updateNetworkFee(0);
    }

    function _generatePublicKey() internal returns (bytes memory) {
        bytes memory randomBytes = new bytes(48);
        for (uint i = 0; i < 48; i++) {
            randomBytes[i] = bytes1(
                uint8(uint(keccak256(abi.encodePacked(sault, block.timestamp, msg.sender, i))) % 256)
            );
        }
        sault++;
        return randomBytes;
    }

    function _generateFee(uint64 min, uint64 max) public returns (uint64) {
        require(max > min, "Max must be greater than min");
        uint256 randomHash = uint256(keccak256(abi.encodePacked(sault, block.timestamp)));
        sault++;
        uint64 reducedHash = uint64(randomHash);
        return (reducedHash % (max - min + 1)) + min;
    }

    function helper_createOperator() public {
        uint64 minN = minNetworkFee;
        uint64 maxN = SSVStorageProtocol.load().operatorMaxFee;

        bytes memory publicKey = _generatePublicKey();
        uint64 fee = _generateFee(minN, maxN);

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
