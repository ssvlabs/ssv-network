// File: contracts/IOperatorRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IOperatorRegistry {
  struct Operator {
    string name;
    address ownerAddress;
    bytes publicKey;
    uint256 score;
  }

  /**
   * @dev Adds a new operator to the list.
   * @param _name Operator's display name.
   * @param _ownerAddress Operator's ethereum address that can collect fees.
   * @param _publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
   */
  function addOperator(string calldata _name, address _ownerAddress, bytes calldata _publicKey) external;

  /**
   * @dev Gets an operator by public key.
   * @param _publicKey Operator's Public Key.
   */
  function operators(bytes calldata _publicKey) external returns (string memory, address, bytes memory, uint256);

  /**
   * @dev Emitted when the operator has been added.
   * @param name Opeator's display name.
   * @param ownerAddress Operator's ethereum address that can collect fees.
   * @param publicKey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
   */
  event OperatorAdded(string name, address ownerAddress, bytes publicKey);
}
