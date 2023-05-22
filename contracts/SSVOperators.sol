// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVOperators.sol";
import "./ISSVOperators.sol";
import "./libraries/Types.sol";
import "./libraries/SSVStorage.sol";

import "@openzeppelin/contracts/utils/Counters.sol";

contract SSVOperators is ISSVOperators {
    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;

    using Types256 for uint256;
    using Counters for Counters.Counter;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(bytes calldata publicKey, uint256 fee) external override returns (uint64 id) {
        if (fee != 0 && fee < MINIMAL_OPERATOR_FEE) {
            revert ISSVNetworkCore.FeeTooLow();
        }

        bytes32 hashedPk = keccak256(publicKey);
        if (SSVStorage.getStorage().operatorsPKs[hashedPk] != 0) revert ISSVNetworkCore.OperatorAlreadyExists();

        SSVStorage.getStorage().lastOperatorId.increment();
        id = uint64(SSVStorage.getStorage().lastOperatorId.current());
        SSVStorage.getStorage().operators[id] = Operator({
            owner: msg.sender,
            snapshot: ISSVNetworkCore.Snapshot({block: uint64(block.number), index: 0, balance: 0}),
            validatorCount: 0,
            fee: fee.shrink()
        });
        SSVStorage.getStorage().operatorsPKs[hashedPk] = id;

        emit OperatorAdded(id, msg.sender, publicKey, fee);
    }
}
