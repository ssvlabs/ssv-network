// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../interfaces/ISSVNetworkCore.sol";

import "../../libraries/OperatorLib.sol";
import "../../libraries/SSVStorage.sol";
import "../../libraries/SSVStorageProtocol.sol";

contract OperatorLibHelper {
    function testValidatorsPerOperatorLimit(
        uint32 operatorValidatorCount,
        uint32 deltaValidatorCount,
        uint32 validatorsPerOperatorLimit) external {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();

        sp.validatorsPerOperatorLimit = validatorsPerOperatorLimit;

        s.operators[1] = ISSVNetworkCore.Operator({
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: 0}),
            validatorCount: operatorValidatorCount,
            fee: 0,
            whitelisted: false
        });

        uint64[] memory operatorIds = new uint64[](1);
        operatorIds[0] = 1;

        OperatorLib.updateOperators(operatorIds, true, deltaValidatorCount, s);
    }
}
