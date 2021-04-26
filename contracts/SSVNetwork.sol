// File: contracts/SSVNetwork.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;
 
contract SSVNetwork {
  uint256 public operatorCount;

  struct Operator {
    string name;
    string pubkey;
    uint256 score;
    address paymentAddress;
    bool isExists;
  }

  mapping(string => Operator) private operators;

  /**
   * @dev Emitted when the operator has been added.
   * @param name Opeator's display name.
   * @param pubkey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
   * @param paymentAddress Operator's ethereum address that can collect fees.
   */
  event OperatorAdded(string name, string pubkey, address paymentAddress);

  /**
   * @dev Add new operator to the list.
   * @param _name Opeator's display name.
   * @param _pubkey Operator's Public Key. Will be used to encrypt secret shares of validators keys.
   * @param _paymentAddress Operator's ethereum address that can collect fees.
   */
  function addOperator(string memory _name, string memory _pubkey, address _paymentAddress) public {
    if (operators[_pubkey].isExists) {
      revert('Operator with same public key already exists');
    }
    operators[_pubkey] = Operator(_name, _pubkey, 0, _paymentAddress, true);
    emit OperatorAdded(_name, _pubkey, _paymentAddress);
    operatorCount++;
  }
}