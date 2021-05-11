// File: contracts/OperatorRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './IOperatorRegistry.sol';

contract OperatorRegistry is IOperatorRegistry {
  uint256 public operatorCount;

  struct Operator {
    string name;
    address ownerAddress;
    bytes publicKey;
    uint256 score;
  }

  mapping(bytes => Operator) private operators;

  /**
   * @dev See {IOperatorRegistry-addOperator}.
   */
  function addOperator(string calldata _name, address _ownerAddress, bytes calldata _publicKey) virtual override public {
    require(operators[_publicKey].ownerAddress == address(0), 'Operator with same public key already exists');

    operators[_publicKey] = Operator(_name, _ownerAddress, _publicKey, 0);

    emit OperatorAdded(_name, _ownerAddress, _publicKey);

    operatorCount++;
  }
}