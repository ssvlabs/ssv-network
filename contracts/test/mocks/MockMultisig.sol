// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockMultisig {
    function exec(address target, bytes calldata data) external returns (bytes memory) {
        (bool success, bytes memory result) = target.call(data);
        require(success, "MockMultisig: call failed");
        return result;
    }

    receive() external payable {}
}
