// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "./storage/SSVStorage.sol";

/**
 * @title SSV Core Library
 * @author SSV Labs
 * @notice Library with core utility functions for SSV network including transfers, contract checks and module upgrades
 */
library CoreLib {
    /**
     * @dev Emitted when a module is upgraded
     * @param moduleId The module ID
     * @param moduleAddress The new module address
     */
    event ModuleUpgraded(SSVModules indexed moduleId, address moduleAddress);

    /**
     * @notice Returns the contract version
     * @return Version string
     */
    function getVersion() internal pure returns (string memory) {
        return "v2.0.0";
    }

    /**
     * @notice Transfers ETH to recipient
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function transferBalance(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if(!success){
            revert ISSVNetworkCore.ETHTransferFailed();
        }
    }

    /**
     * @notice Transfers tokens to recipient
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function transferTokenBalance(address to, uint256 amount) internal {
        if (!SSVStorage.load().token.transfer(to, amount)) {
            revert ISSVNetworkCore.TokenTransferFailed();
        }
    }

    /**
     * @dev Returns true if `account` is a contract.
     *
     * [IMPORTANT]
     * ====
     * It is unsafe to assume that an address for which this function returns
     * false is an externally-owned account (EOA) and not a contract.
     *
     * Among others, `isContract` will return false for the following
     * types of addresses:
     *
     *  - an externally-owned account
     *  - a contract in construction
     *  - an address where a contract will be created
     *  - an address where a contract lived, but was destroyed
     * ====
     */
    function isContract(address account) internal view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        // This method relies on extcodesize, which returns 0 for contracts in
        // construction, since the code is only stored at the end of the
        // constructor execution.

        uint256 size;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }

    /**
     * @notice Sets contract address for a module
     * @param moduleId Module ID
     * @param moduleAddress New module address
     */
    function setModuleContract(SSVModules moduleId, address moduleAddress) internal {
        if (!isContract(moduleAddress)) revert ISSVNetworkCore.TargetModuleDoesNotExistWithData(uint8(moduleId));

        SSVStorage.load().ssvContracts[moduleId] = moduleAddress;
        emit ModuleUpgraded(moduleId, moduleAddress);
    }
}
