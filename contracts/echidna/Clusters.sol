// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../token/SSVToken.sol";
import "../modules/SSVClusters.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/ProtocolLib.sol";
import "../libraries/OperatorLib.sol";
import "./EchidnaLib.sol";
import "./Operators.sol";

contract Clusters is SSVClusters {
    using ClusterLib for Cluster;
    using Types64 for uint64;
    using Types256 for uint256;
    using ProtocolLib for StorageProtocol;

    bytes[] publicKeys;
    uint64[] opIds;
    mapping(bytes32 => Cluster) clusters;

    uint64 private constant MINIMAL_OPERATOR_FEE = 100_000_000;
    uint64 private constant MAXIMUM_OPERATOR_FEE = 76_528_650_000_000;
    uint64 private constant MIN_OPERATORS_LENGTH = 4;
    uint64 private constant MAX_OPERATORS_LENGTH = 13;
    uint64 private constant MODULO_OPERATORS_LENGTH = 3;
    uint64 private constant PUBLIC_KEY_LENGTH = 48;
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 214800;
    uint256 private constant MIN_LIQUIDATION_COLLATERAL = 1000000000000000000;
    uint256 private constant TOTAL_SSVTOKEN_BALANCE = 1000000000000000000000;
    uint256 private sault = 0;

    Operators ssvOperators;
    SSVToken ssvToken;

    event AssertionFailed(uint256 amount);

    constructor() {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = MIN_LIQUIDATION_COLLATERAL.shrink();
        sp.validatorsPerOperatorLimit = 500;
        sp.declareOperatorFeePeriod = 604800;
        sp.executeOperatorFeePeriod = 604800;
        sp.operatorMaxFeeIncrease = 1000;
        sp.operatorMaxFee = MAXIMUM_OPERATOR_FEE;
        sp.updateNetworkFee(0);

        ssvOperators = new Operators();
        for (uint256 i; i < MAX_OPERATORS_LENGTH; i++) {
            uint64 operatorId = ssvOperators.helper_createOperator();
            opIds.push(operatorId);
            updateStorage(operatorId, ssvOperators.getOperatorById(operatorId));
        }

        ssvToken = new SSVToken();
        SSVStorage.load().token = ssvToken;
        ssvToken.approve(address(this), TOTAL_SSVTOKEN_BALANCE);
    }

    function updateStorage(uint64 id, ISSVNetworkCore.Operator memory operator) internal {
        StorageData storage s = SSVStorage.load();
        s.operators[id] = operator;
    }

    function check_registerValidator() public {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageData storage s = SSVStorage.load();

        bytes memory publicKey = EchidnaLib.generatePublicKey(sault++);
        bytes memory emptyBytes;

        bytes32 hashedCluster = keccak256(abi.encodePacked(msg.sender, opIds));
        Cluster memory cluster = clusters[hashedCluster];
        cluster.active = true;

        uint64 liquidationThreshold = MIN_BLOCKS_BEFORE_LIQUIDATION * EchidnaLib.getBurnRate(opIds, s);
        uint256 min = liquidationThreshold.expand() > MIN_LIQUIDATION_COLLATERAL
            ? liquidationThreshold.expand()
            : MIN_LIQUIDATION_COLLATERAL;
        uint256 amount = EchidnaLib.generateRandomShrinkable(sault++, min, min * 2);

        try this.registerValidator(publicKey, opIds, emptyBytes, amount, cluster) {
            publicKeys.push(publicKey);

            (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(opIds, true, true, 1, s, sp);
            cluster.balance += amount;
            cluster.updateClusterData(clusterIndex, sp.currentNetworkFeeIndex());
            cluster.validatorCount += 1;

            clusters[hashedCluster] = cluster;
        } catch {
            emit AssertionFailed(amount);
        }
    }

    function check_bulkRegisterValidator(uint256 amount) public {
        bytes[] memory publicKey = new bytes[](4);
        bytes[] memory sharesData = new bytes[](4);
        for (uint256 i; i < publicKey.length; i++) {
            publicKey[i] = EchidnaLib.generatePublicKey(sault++);
        }
        Cluster memory cluster;
        cluster.active = true;

        uint256 minLiquidationCollateral = SSVStorageProtocol.load().minimumLiquidationCollateral.expand();
        require(amount > minLiquidationCollateral, "InsufficientBalance");

        try this.bulkRegisterValidator(publicKey, opIds, sharesData, amount, cluster) {
            for (uint256 i; i < publicKey.length; i++) {
                publicKeys.push(publicKey[i]);
            }
        } catch {
            assert(false);
        }
    }

    function check_validRegisteredOperators() public {
        assert(opIds.length == MAX_OPERATORS_LENGTH);

        for (uint256 i; i < opIds.length; i++) {
            ISSVNetworkCore.Operator memory operator = ssvOperators.getOperatorById(opIds[i]);
            assert(operator.owner != address(0));
        }
    }

    function check_RegisteredValidatorsCount() public {
        assert(sault == 0 || publicKeys.length > 0);
    }
}
