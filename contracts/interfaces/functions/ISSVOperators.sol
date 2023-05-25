// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./../ISSVNetworkCore.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISSVOperators is ISSVNetworkCore {
    /**
     * @dev Registers a new operator.
     * @param publicKey Operator's public key. Used to encrypt secret shares of validators keys.
     * @param fee operator's fee. When fee is set to zero (mostly for private operators), it can not be increased.
     */
    function registerOperator(bytes calldata publicKey, uint256 fee) external returns (uint64);

    /**
     * @dev Removes an operator.
     * @param operatorId Operator's id.
     */
    function removeOperator(uint64 operatorId) external;

    function setOperatorWhitelist(uint64 operatorId, address whitelisted) external;

    function declareOperatorFee(uint64 operatorId, uint256 fee) external;

    function executeOperatorFee(uint64 operatorId) external;

    function cancelDeclaredOperatorFee(uint64 operatorId) external;

    function reduceOperatorFee(uint64 operatorId, uint256 fee) external;

    function setFeeRecipientAddress(address feeRecipientAddress) external;

    function withdrawOperatorEarnings(uint64 operatorId, uint256 tokenAmount) external;

    function withdrawOperatorEarnings(uint64 operatorId) external;
}
