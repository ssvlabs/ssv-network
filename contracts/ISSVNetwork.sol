


interface ISSVNetwork {
    /**
    * @dev Emitted when a new operator has been added.
    * @param id operator's ID.
    * @param owner Operator's ethereum address that can collect fees.
    * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
    * @param fee Operator's initial fee.
    */
    event OperatorAdded(
        uint64 id,
        address indexed owner,
        bytes publicKey
    );

    /**
     * @dev Emitted when operator has been removed.
     * @param id operator's ID.
     */
    event OperatorRemoved(uint64 id);


    /**
     * @dev Emitted when operator changed fee.
     * @param id operator's ID.
     * @param fee operator's new fee.
     */
    event OperatorFeeSet(uint64 operatorId, uint64 fee);


    /**
     * @dev Emitted when the validator has been added.
     * @param publicKey The public key of a validator.
     * @param podId The pod id the validator been added to.
     * @param shares snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorAdded(
        bytes publicKey,
        bytes32 podId,
        bytes shares
    );

    /**
     * @dev Emitted when validator was transferred between pods.
     * @param publicKeys An array of transferred public keys .
     * @param podId The validator's new pod id.
     * @param shares an array of snappy compressed shares(a set of encrypted and public shares).
     */
    event ValidatorTransferred(
        bytes publicKey,
        bytes32 podId,
        bytes shares
    );

    /**
     * @dev Emitted when validators were transferred between pods.
     * @param publicKeys An array of transferred public keys.
     * @param podId The validators new pod id.
     * @param shares an array of snappy compressed shares(a set of encrypted and public shares).
     */
    event BulkValidatorTransferred(
        bytes[] publicKeys,
        bytes32 podId,
        bytes[] shares
    );

    /**
     * @dev Emitted when the validator is removed.
     * @param publicKey The public key of a validator.
     * @param podId The pod id the validator has been removed from.
     */
    event ValidatorRemoved(bytes publicKey, bytes32 podId);

}