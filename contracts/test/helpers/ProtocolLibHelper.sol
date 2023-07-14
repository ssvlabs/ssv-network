// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../../libraries/ProtocolLib.sol";

contract ProtocolLibHelper {
    function testUpdateDAOoveflow(uint32 daoValidatorCount) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.daoValidatorCount = daoValidatorCount;

        ProtocolLib.updateDAO(sp, true, 2);
    }
}
