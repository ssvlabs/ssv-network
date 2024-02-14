// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../modules/SSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/ProtocolLib.sol";

contract Clusters is SSVClusters {
    using ClusterLib for Cluster;
    using Types64 for uint64;
    using Types256 for uint256;
    using ProtocolLib for StorageProtocol;

    bytes[] publicKeys;
    bytes32[] hashedClusters;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;
    uint256 private sault = 0;

    constructor() {
        // operators = new Operators();
        // for (uint i; i < 4; i++) {
        //     uint64 operatorId = operators.helper_createOperator();
        // }
        // assert(operators.getOperatorBlock(1) == SSVStorage.load().operators[1].snapshot.block);
    }

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

    // function helper_registerValidator(bytes calldata sharesData, uint256 amount, Cluster memory cluster) public {
    //     StorageData storage s = SSVStorage.load();
    //     bytes memory _publicKey = _generatePublicKey();
    //     uint64[] memory _operatorIds = operators.getOperatorIds();

    //     bytes32 _hashedCluster = keccak256(abi.encodePacked(msg.sender, _operatorIds));

    //     bytes32 clusterData = s.clusters[_hashedCluster];
    //     if (clusterData == bytes32(0)) {
    //         cluster.validatorCount = 0;
    //         cluster.networkFeeIndex = 0;
    //         cluster.index = 0;
    //         cluster.balance = 0;
    //         cluster.active = true;
    //     } else {
    //         s.clusters[_hashedCluster] = cluster.hashClusterData();
    //     }

    //     try this.registerValidator(_publicKey, _operatorIds, sharesData, amount, cluster) {
    //         publicKeys.push(_publicKey);
    //         hashedClusters.push(_hashedCluster);
    //     } catch {
    //         assert(false);
    //     }
    // }

    // function check_removeValidator(uint64 publicKeyId, uint64[] calldata operatorIds, Cluster memory cluster) public {
    //     publicKeyId = publicKeyId % uint64(publicKeys.length);

    //     this.removeValidator(publicKeys[publicKeyId], operatorIds, cluster);
    // }

    // function check_invariant_validatorPKs() public {
    //     StorageData storage s = SSVStorage.load();

    //     for (uint64 i = 0; i < hashedClusters.length; i++) {
    //         assert(s.clusters[hashedClusters[i]] == bytes32(0));
    //     }
    // }
}
