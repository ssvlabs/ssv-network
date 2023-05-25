// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkCore.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVNetwork is ISSVNetworkCore {
    /**
     * @dev Registers a new operator.
     * @param publicKey Operator's public key. Used to encrypt secret shares of validators keys.
     * @param fee operator's fee. When fee is set to zero (mostly for private operators), it can not be increased.
     */
    function registerOperator(bytes calldata publicKey, uint256 fee) external returns (uint64);

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external;
}
