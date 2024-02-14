// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../modules/SSVOperators.sol";
import "../libraries/ProtocolLib.sol";

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

        sp.updateNetworkFee(0);
    }

    function getOperatorIds() public view returns (uint64[] memory) {
        return opIds;
    }

    function getOperatorBlock(uint64 operatorId) public view returns (uint256) {
        return SSVStorage.load().operators[operatorId].snapshot.block;
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

    function _generateFee(uint256 min, uint256 max) internal returns (uint256) {
        require(max > min, "Max must be greater than min");
        require(
            min % DEDUCTED_DIGITS == 0 && max % DEDUCTED_DIGITS == 0,
            "Min and Max must be multiples of 10,000,000"
        );

        uint256 randomHash = uint256(keccak256(abi.encodePacked(sault, block.timestamp)));
        sault++;
        uint64 reducedHash = uint64(randomHash);

        // Calculate a fee within the range, ensuring it ends in a multiple of 10,000,000
        uint256 range = (max - min) / DEDUCTED_DIGITS + 1;
        uint256 feeMultiplier = (reducedHash % range) * DEDUCTED_DIGITS;
        uint256 fee = min + feeMultiplier;
        fee = fee - (fee % DEDUCTED_DIGITS);

        return fee;
    }

    function helper_createOperator() public returns (uint64) {
        uint256 minN = minNetworkFee;
        uint256 maxN = SSVStorageProtocol.load().operatorMaxFee;

        bytes memory publicKey = _generatePublicKey();
        uint256 fee = _generateFee(minN, maxN);

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
