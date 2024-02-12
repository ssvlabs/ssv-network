// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../modules/SSVClusters.sol";
import "../libraries/ClusterLib.sol";

contract Clusters is SSVClusters {
    using ClusterLib for Cluster;

    constructor() {}

    bytes[] publicKeys;
    bytes32[] hashedClusters;
    uint64[] public operatorIds;

    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;
    uint256 private sault = 0;

    function _generatePublicKey() internal returns (bytes memory) {
        bytes memory randomBytes = new bytes(48);
        for (uint i = 0; i < 48; i++) {
            randomBytes[i] = bytes1(
                uint8(uint(keccak256(abi.encodePacked(sault, block.timestamp, msg.sender, i))) % 256)
            );
        }
        sault++;
        return randomBytes;
    }

    function _generateOperatorIds() internal returns (uint64[] memory operatorIds) {
        uint256 baseLength = (uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender, sault))) %
            MIN_OPERATORS_LENGTH);
        uint256 length = 4 + baseLength * 3; // This will produce lengths 4, 7, 10, or 13
        sault++;

        operatorIds = new uint64[](length);
        for (uint256 i = 0; i < length; i++) {
            uint64 randomId;
            bool unique;
            do {
                sault++; // Ensure a different seed for the random number
                randomId = _generateRandomId();
                unique = !_isDuplicate(randomId);
            } while (!unique);

            // Insert the unique randomId in a sorted position
            uint256 j = i;
            while (j > 0 && operatorIds[j - 1] > randomId) {
                if (j < operatorIds.length) {
                    operatorIds[j] = operatorIds[j - 1]; // Shift larger IDs to the right
                }
                j--;
            }
            operatorIds[j] = randomId; // Insert the new ID in its correct sorted position
        }
        return operatorIds;
    }

    function _generateRandomId() internal returns (uint64) {
        return uint64(uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender, sault))) % 2 ** 64);
    }

    function _isDuplicate(uint64 id) internal view returns (bool) {
        for (uint256 i = 0; i < operatorIds.length; i++) {
            if (operatorIds[i] == id) {
                return true;
            }
        }
        return false;
    }

    function helper_registerValidator(bytes calldata sharesData, uint256 amount, Cluster memory cluster) public {
        StorageData storage s = SSVStorage.load();

        bytes memory _publicKey = _generatePublicKey();
        uint64[] memory _operatorIds = _generateOperatorIds();

        bytes32 _hashedCluster = keccak256(abi.encodePacked(msg.sender, _operatorIds));

        bytes32 clusterData = s.clusters[_hashedCluster];
        if (clusterData == bytes32(0)) {
            cluster.validatorCount = 0;
            cluster.networkFeeIndex = 0;
            cluster.index = 0;
            cluster.balance = 0;
            cluster.active = true;
        } else {
            s.clusters[_hashedCluster] = cluster.hashClusterData();
        }

        try this.registerValidator(_publicKey, _operatorIds, sharesData, amount, cluster) {
            publicKeys.push(_publicKey);
            hashedClusters.push(_hashedCluster);
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
