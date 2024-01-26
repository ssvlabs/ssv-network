// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./SSVClusters.sol";

contract Clusters is SSVClusters {
    constructor() {}

    bytes[] publicKeys;
    bytes32[] hashedClusters;

    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;

    function helper_registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata sharesData,
        uint256 amount,
        Cluster memory cluster
    ) public {
        require(
            operatorIds.length < MIN_OPERATORS_LENGTH ||
                operatorIds.length > MAX_OPERATORS_LENGTH ||
                operatorIds.length % MODULO_OPERATORS_LENGTH != 1,
            "Invalid OperatorIds Length"
        );
        require(publicKey.length == PUBLIC_KEY_LENGTH, "Invalid PublicKey Length");

        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, operatorIds));

        try this.registerValidator(publicKey, operatorIds, sharesData, amount, cluster) {
            publicKeys.push(publicKey);
            hashedClusters.push(hashedCluster);
        } catch {
            assert(false);
        }
    }

    function check_removeValidator(uint64 publicKeyId, uint64[] calldata operatorIds, Cluster memory cluster) public {
        publicKeyId = publicKeyId % uint64(publicKeys.length);

        this.removeValidator(publicKeys[publicKeyId], operatorIds, cluster);
    }

    function check_invariant_validatorPKs() public {
        StorageData storage s = SSVStorage.load();

        for (uint64 i = 0; i < hashedClusters.length; i++) {
            assert(s.clusters[hashedClusters[i]] == bytes32(0));
        }
    }
}
