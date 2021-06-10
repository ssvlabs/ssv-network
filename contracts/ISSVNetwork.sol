// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

interface ISSVNetwork {
    struct BalanceInfo {
        uint256 balance;
        uint256 blockNumber;
        uint256 numValidators;
    }

    /**
     * @dev Get operator balance by address.
     * @param _operatorAddress The operators's ethereum address that is the owner of created operators.
     */
    function balanceOf(address _operatorAddress) external;

    /**
     * @dev Registers a new operator.
     * @param _name Operator's display name.
     * @param _ownerAddress Operator's ethereum address that can collect fees.
     * @param _publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
     */
    function registerOperator(
        string calldata _name,
        address _ownerAddress,
        bytes calldata _publicKey
    ) external;


    /**
     * @dev Get operator's fee by address.
     * @param _operatorAddress The operators's ethereum address.
     */
    function getOperatorFee(address _operatorAddress) external returns (uint256);

    /**
     * @dev Updates operator's fee by address.
     * @param _operatorAddress The operators's ethereum address.
     * @param _fee The operators's updated fee.
     */
    function updateOperatorFee(address _operatorAddress, uint256 _fee) external;

    /**
     * @dev Emitted when the operator has been updated the fee.
     * @param operatorAddress The operators's ethereum addres.
     * @param fee The operators's updated fee.
     */
    event OperatorFeeUpdated(address operatorAddress, uint256 fee);
}
