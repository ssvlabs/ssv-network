// File: contracts/IValidatorRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IValidatorRegistry {
  struct Oess {
    uint index;
    bytes operatorPublicKey;
    bytes sharedPublicKey;
    bytes encryptedKey;
  }

  /**
   * @dev Add new validator to the list.
   * @param _ownerAddress The user's ethereum address that is the owner of the validator.
   * @param _publicKey Validator public key.
   * @param _operatorPublicKeys Operator public keys.
   * @param _sharesPublicKeys Shares public keys.
   * @param _encryptedKeys Encrypted private keys.
   */
  function addValidator(address _ownerAddress, bytes calldata _publicKey, bytes[] calldata _operatorPublicKeys, bytes[] calldata _sharesPublicKeys, bytes[] calldata _encryptedKeys) external;

  /**
   * @dev Emitted when the validator has been added.
   * @param ownerAddress The user's ethereum address that is the owner of the validator.
   * @param publicKey The public key of a validator.
   * @param oessList The OESS list for this validator.
   */
  event ValidatorAdded(address ownerAddress, bytes publicKey, Oess[] oessList);

  /**
   * @param validatorPublicKey The public key of a validator.
   * @param index Operator index.
   * @param operatorPublicKey Operator public key.
   * @param sharedPublicKey Share public key.
   * @param encryptedKey Encrypted private key.
   */
  event OessAdded(bytes validatorPublicKey, uint index, bytes operatorPublicKey, bytes sharedPublicKey, bytes encryptedKey);
}
