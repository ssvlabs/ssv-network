// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/interfaces/ISSVClusters.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageEB.sol";
import "../../contracts/libraries/ClusterLib.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/ProtocolLib.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PackedETHLib, PackedSSVLib, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";

contract ClusterUser {
    ISSVClusters public clusters;

    constructor(ISSVClusters clusters_) {
        clusters = clusters_;
    }

    receive() external payable {}

    function withdraw(
        uint64[] calldata operatorIds,
        uint256 amount,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.withdraw(operatorIds, amount, cluster);
    }

    function liquidate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.liquidate(clusterOwner, operatorIds, cluster);
    }

    function liquidateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external {
        clusters.liquidateSSV(clusterOwner, operatorIds, cluster);
    }

    function reactivate(
        uint64[] calldata operatorIds,
        ISSVNetworkCore.Cluster memory cluster
    ) external payable {
        clusters.reactivate{value: msg.value}(operatorIds, cluster);
    }
}

contract OperatorUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    receive() external payable {}

    function withdraw(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarnings(operatorId, amount);
    }

    function withdrawAll(uint64 operatorId) external {
        operators.withdrawAllOperatorEarnings(operatorId);
    }

    function withdrawSSV(uint64 operatorId, uint256 amount) external {
        operators.withdrawOperatorEarningsSSV(operatorId, amount);
    }

    function withdrawAllSSV(uint64 operatorId) external {
        operators.withdrawAllOperatorEarningsSSV(operatorId);
    }
}

contract SSVAccountingEchidna is SSVClusters, SSVOperators(0), SSVDAO {
    using ClusterLib for ISSVNetworkCore.Cluster;
    using Counters for Counters.Counter;
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    uint8 private constant MAX_ETH_CLUSTERS = 6;
    uint8 private constant MAX_SSV_CLUSTERS = 6;
    uint32 private constant MAX_ADVANCE_BLOCKS = 8;
    PackedETH private constant DEFAULT_OPERATOR_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_OPERATOR_SSV_FEE = PackedSSV.wrap(1);
    PackedETH private constant DEFAULT_NETWORK_ETH_FEE = PackedETH.wrap(1);
    PackedSSV private constant DEFAULT_NETWORK_SSV_FEE = PackedSSV.wrap(1);
    uint64 private constant MIN_BLOCKS_BEFORE_LIQUIDATION = 2;
    uint64 private constant MAX_SSV_MINT_UNITS = 1_000_000;

    MockToken private token;

    ClusterUser private owner1;
    ClusterUser private owner2;
    ClusterUser private liquidator;

    OperatorUser private opOwner1;
    OperatorUser private opOwner2;
    OperatorUser private opOwner3;

    uint64 private op1;
    uint64 private op2;
    uint64 private op3;

    struct ClusterRecord {
        ISSVNetworkCore.Cluster cluster;
        address owner;
        uint8 operatorsKey;
        bool exists;
    }

    bytes32[] private ethClusterIds;
    bytes32[] private ssvClusterIds;
    mapping(bytes32 => ClusterRecord) private ethClusters;
    mapping(bytes32 => ClusterRecord) private ssvClusters;

    uint64[] private operatorIds;
    mapping(uint64 => address) private operatorOwner;

    uint256 private totalEthIn;
    uint256 private totalEthOut;
    uint256 private totalSsvIn;
    uint256 private totalSsvOut;
    uint256 private unallocatedEth;
    uint256 private unallocatedSsv;

    constructor() {
        token = new MockToken();
        _mockSetToken(address(token));

        ISSVClusters clustersSelf = ISSVClusters(address(this));
        ISSVOperators operatorsSelf = ISSVOperators(address(this));

        owner1 = new ClusterUser(clustersSelf);
        owner2 = new ClusterUser(clustersSelf);
        liquidator = new ClusterUser(clustersSelf);

        opOwner1 = new OperatorUser(operatorsSelf);
        opOwner2 = new OperatorUser(operatorsSelf);
        opOwner3 = new OperatorUser(operatorsSelf);

        _initProtocolDefaults();
        _initOperators();
    }

    receive() external payable {}

    function action_fund_eth(uint256 amount) external payable {
        amount;
        if (msg.value == 0) return;
        totalEthIn += msg.value;
        unallocatedEth += msg.value;
    }

    function action_fund_ssv(uint256 seed) external {
        uint64 units = uint64(seed % (uint256(MAX_SSV_MINT_UNITS) + 1));
        if (units == 0) return;
        uint256 amount = uint256(units) * DEDUCTED_DIGITS;
        token.mint(address(this), amount);
        totalSsvIn += amount;
        unallocatedSsv += amount;
    }

    function action_create_eth_cluster(uint256 seed) external {
        _settleTime();
        if (ethClusterIds.length >= MAX_ETH_CLUSTERS) return;

        address owner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = uint8((seed >> 8) % 3);
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIdsLocal));

        if (ethClusters[clusterId].exists) return;

        uint32 validatorCount = uint32((seed >> 16) % 6) + 1;

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        SSVStorage.load().ethClusters[clusterId] = cluster.hashClusterData();

        ethClusters[clusterId] = ClusterRecord({
            cluster: cluster,
            owner: owner,
            operatorsKey: operatorsKey,
            exists: true
        });
        ethClusterIds.push(clusterId);
    }

    function action_create_ssv_cluster(uint256 seed) external {
        _settleTime();
        if (ssvClusterIds.length >= MAX_SSV_CLUSTERS) return;

        address owner = (seed % 2 == 0) ? address(owner1) : address(owner2);
        uint8 operatorsKey = uint8((seed >> 8) % 3);
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(operatorsKey);
        bytes32 clusterId = keccak256(abi.encodePacked(owner, operatorIdsLocal));

        if (ssvClusters[clusterId].exists) return;

        uint32 validatorCount = uint32((seed >> 16) % 6) + 1;

        ISSVNetworkCore.Cluster memory cluster = ISSVNetworkCore.Cluster({
            validatorCount: validatorCount,
            networkFeeIndex: 0,
            index: 0,
            active: false,
            balance: 0
        });

        SSVStorage.load().clusters[clusterId] = cluster.hashClusterData();

        ssvClusters[clusterId] = ClusterRecord({
            cluster: cluster,
            owner: owner,
            operatorsKey: operatorsKey,
            exists: true
        });
        ssvClusterIds.push(clusterId);
    }

    function action_reactivate_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || record.cluster.active) return;

        if (unallocatedEth == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);

        PackedETH burnRate;
        for (uint256 i; i < operatorIdsLocal.length; ++i) {
            burnRate = burnRate.add(s.operators[operatorIdsLocal[i]].ethFee);
        }
        uint256 minPerBlock = uint256(PackedETH.unwrap(burnRate) + PackedETH.unwrap(sp.ethNetworkFee)) * uint64(record.cluster.validatorCount) * ETH_DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * (MAX_ADVANCE_BLOCKS + 2);
        if (minRequired == 0) minRequired = ETH_DEDUCTED_DIGITS;

        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);
        if (amount < minRequired) amount = minRequired;
        if (amount > unallocatedEth) return;

        ClusterUser owner = _clusterOwnerUser(record.owner);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try owner.reactivate{value: amount}(operatorIdsLocal, cluster) {
            record.cluster.active = true;
            record.cluster.balance += amount;
            record.cluster.index = _currentClusterIndexEth(operatorIdsLocal);
            record.cluster.networkFeeIndex = sp.currentNetworkFeeIndex();
            sp.daoTotalEthVUnits += uint64(record.cluster.validatorCount) * VUNITS_PRECISION;
            unallocatedEth -= amount;

            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_activate_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || record.cluster.active) return;

        if (unallocatedSsv == 0) return;

        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);

        PackedSSV burnRate;
        for (uint256 i; i < operatorIdsLocal.length; ++i) {
            burnRate = burnRate.add(s.operators[operatorIdsLocal[i]].fee);
        }
        uint256 minPerBlock = uint256(PackedSSV.unwrap(burnRate) + PackedSSV.unwrap(sp.networkFee)) * uint64(record.cluster.validatorCount) * DEDUCTED_DIGITS;
        uint256 minRequired = minPerBlock * (MAX_ADVANCE_BLOCKS + 2);
        if (minRequired == 0) minRequired = DEDUCTED_DIGITS;

        uint256 amount = _boundAmount(seed >> 8, unallocatedSsv);
        if (amount < minRequired) amount = minRequired;
        if (amount > unallocatedSsv) return;
        if (token.balanceOf(address(this)) < amount) return;

        (uint64 clusterIndex, ) = OperatorLib.updateClusterOperatorsSSV(
            operatorIdsLocal,
            true,
            record.cluster.validatorCount,
            s,
            sp
        );

        record.cluster.balance += amount;
        record.cluster.active = true;
        record.cluster.index = clusterIndex;
        record.cluster.networkFeeIndex = sp.currentNetworkFeeIndexSSV();

        sp.updateDAOSSV(true, record.cluster.validatorCount);

        s.clusters[clusterId] = record.cluster.hashClusterData();
        unallocatedSsv -= amount;
    }

    function action_deposit_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        if (unallocatedEth == 0) return;
        uint256 amount = _boundAmount(seed >> 8, unallocatedEth);
        if (amount == 0) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        try this.deposit{value: amount}(record.owner, operatorIdsLocal, cluster) {
            record.cluster.balance += amount;
            unallocatedEth -= amount;
        } catch {}
    }

    function action_deposit_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        if (unallocatedSsv == 0) return;
        uint256 amount = _boundAmount(seed >> 8, unallocatedSsv);
        if (amount == 0) return;
        if (token.balanceOf(address(this)) < amount) return;

        record.cluster.balance += amount;
        SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        unallocatedSsv -= amount;
    }

    function action_withdraw_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;
        if (record.cluster.balance == 0) return;

        uint256 amount = _boundAmount(seed >> 8, record.cluster.balance);
        if (amount == 0) return;
        if (amount > address(this).balance) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ClusterUser owner = _clusterOwnerUser(record.owner);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 ownerBefore = record.owner.balance;
        try owner.withdraw(operatorIdsLocal, amount, cluster) {
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            if (record.cluster.balance >= amount) {
                record.cluster.balance -= amount;
            } else {
                record.cluster.balance = 0;
            }
            totalEthOut += record.owner.balance - ownerBefore;

            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_liquidate_eth(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickEthClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ethClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 liquidatorBefore = address(liquidator).balance;
        try liquidator.liquidate(record.owner, operatorIdsLocal, cluster) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;

            uint64 deltaVUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
            if (sp.daoTotalEthVUnits >= deltaVUnits) {
                sp.daoTotalEthVUnits -= deltaVUnits;
            } else {
                sp.daoTotalEthVUnits = 0;
            }
            totalEthOut += address(liquidator).balance - liquidatorBefore;
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_liquidate_ssv(uint256 seed) external {
        _settleTime();
        bytes32 clusterId = _pickSsvClusterId(seed);
        if (clusterId == bytes32(0)) return;

        ClusterRecord storage record = ssvClusters[clusterId];
        if (!record.exists || !record.cluster.active) return;

        uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
        ISSVNetworkCore.Cluster memory cluster = record.cluster;

        uint256 liquidatorBefore = token.balanceOf(address(liquidator));
        try liquidator.liquidateSSV(record.owner, operatorIdsLocal, cluster) {
            StorageProtocol storage sp = SSVStorageProtocol.load();
            _settleSsvCluster(clusterId, record, operatorIdsLocal);
            record.cluster.active = false;
            record.cluster.balance = 0;
            record.cluster.index = 0;
            record.cluster.networkFeeIndex = 0;

            totalSsvOut += token.balanceOf(address(liquidator)) - liquidatorBefore;
            SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        } catch {}
    }

    function action_withdraw_operator_eth(uint256 seed) external {
        _settleTime();
        uint64 operatorId = _pickOperatorId(seed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        PackedETH balance = operator.ethSnapshot.balance;
        if (balance.eq(PACKED_ETH_ZERO)) return;

        PackedETH withdrawShrunk = PackedETH.wrap(uint64(seed % PackedETH.unwrap(balance)) + 1);
        uint256 amount = PackedETHLib.unpack(withdrawShrunk);
        if (amount > address(this).balance) return;

        uint256 ownerBefore = ownerAddr.balance;
        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdraw(operatorId, amount) {
            totalEthOut += ownerAddr.balance - ownerBefore;
        } catch {}
    }

    function action_withdraw_operator_ssv(uint256 seed) external {
        _settleTime();
        uint64 operatorId = _pickOperatorId(seed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory operator = SSVStorage.load().operators[operatorId];
        PackedSSV balance = operator.snapshot.balance;
        if (balance.eq(PACKED_SSV_ZERO)) return;

        PackedSSV withdrawShrunk = PackedSSV.wrap(uint64(seed % PackedSSV.unwrap(balance)) + 1);
        uint256 amount = PackedSSVLib.unpack(withdrawShrunk);
        if (amount > token.balanceOf(address(this))) return;

        uint256 ownerBefore = token.balanceOf(ownerAddr);
        OperatorUser owner = OperatorUser(payable(ownerAddr));
        try owner.withdrawSSV(operatorId, amount) {
            totalSsvOut += token.balanceOf(ownerAddr) - ownerBefore;
        } catch {}
    }

    function action_withdraw_dao_ssv(uint256 seed) external {
        _settleTime();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        PackedSSV available = sp.daoBalance;
        if (available.eq(PACKED_SSV_ZERO)) return;
        PackedSSV withdrawUnits = PackedSSV.wrap(uint64(seed % (PackedSSV.unwrap(available) + 1)));
        if (withdrawUnits.eq(PACKED_SSV_ZERO)) return;

        uint256 amount = PackedSSVLib.unpack(withdrawUnits);
        if (amount > token.balanceOf(address(this))) return;

        uint256 before = token.balanceOf(address(this));
        try this.withdrawNetworkSSVEarnings(amount) {
            totalSsvOut += before - token.balanceOf(address(this));
        } catch {}
    }

    function action_update_network_fee(uint256 seed) external {
        _settleTime();
        uint64 units = uint64(seed % 10);
        uint256 fee = uint256(units) * ETH_DEDUCTED_DIGITS;
        try this.updateNetworkFee(fee) {} catch {}
    }

    function action_update_network_fee_ssv(uint256 seed) external {
        _settleTime();
        uint64 units = uint64(seed % 10);
        uint256 fee = uint256(units) * DEDUCTED_DIGITS;
        try this.updateNetworkFeeSSV(fee) {} catch {}
    }

    function action_advance_time(uint256 seed) external {
        _settleTime();
        uint32 blocks = uint32(seed % MAX_ADVANCE_BLOCKS) + 1;
        _fastForward(blocks);
        _syncClusters();
    }

    function echidna_eth_conservation() external view returns (bool) {
        return address(this).balance + totalEthOut >= totalEthIn;
    }

    function echidna_ssv_conservation() external view returns (bool) {
        return token.balanceOf(address(this)) <= totalSsvIn;
    }

    function echidna_eth_solvency() external view returns (bool) {
        return address(this).balance >= totalEthIn - totalEthOut;
    }

    function echidna_ssv_solvency() external view returns (bool) {
        return token.balanceOf(address(this)) <= totalSsvIn;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 1000;
        sp.ethNetworkFee = DEFAULT_NETWORK_ETH_FEE;
        sp.networkFee = DEFAULT_NETWORK_SSV_FEE;
        sp.ethNetworkFeeIndex = 0;
        sp.networkFeeIndex = 0;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.networkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.daoIndexBlockNumber = uint32(block.number);
        sp.minimumBlocksBeforeLiquidation = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumBlocksBeforeLiquidationSSV = MIN_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = PACKED_ETH_ZERO;
        sp.minimumLiquidationCollateralSSV = PACKED_SSV_ZERO;
        sp.operatorMaxFee = PackedETH.wrap(type(uint64).max);
        sp.operatorMaxFeeSSV = type(uint64).max;
    }

    function _initOperators() internal {
        StorageData storage s = SSVStorage.load();

        op1 = _createOperator(s, address(opOwner1), bytes32(uint256(0x1)));
        op2 = _createOperator(s, address(opOwner2), bytes32(uint256(0x2)));
        op3 = _createOperator(s, address(opOwner3), bytes32(uint256(0x3)));

        operatorIds.push(op1);
        operatorIds.push(op2);
        operatorIds.push(op3);

        operatorOwner[op1] = address(opOwner1);
        operatorOwner[op2] = address(opOwner2);
        operatorOwner[op3] = address(opOwner3);
    }

    function _createOperator(StorageData storage s, address owner, bytes32 pk) internal returns (uint64) {
        s.lastOperatorId.increment();
        uint64 id = uint64(s.lastOperatorId.current());

        s.operators[id] = ISSVNetworkCore.Operator({
            validatorCount: 0,
            fee: DEFAULT_OPERATOR_SSV_FEE,
            owner: owner,
            snapshot: ISSVNetworkCore.Snapshot({block: uint32(block.number), index: 0, balance: PACKED_SSV_ZERO}),
            whitelisted: false,
            ethValidatorCount: 0,
            ethFee: DEFAULT_OPERATOR_ETH_FEE,
            ethSnapshot: ISSVNetworkCore.EthSnapshot({block: uint32(block.number), index: 0, balance: PACKED_ETH_ZERO})
        });
        s.operatorsPKs[keccak256(abi.encodePacked(pk))] = id;
        return id;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _pickOperatorId(uint256 seed) internal view returns (uint64) {
        uint256 count = operatorIds.length;
        if (count == 0) return 0;
        return operatorIds[seed % count];
    }

    function _operatorIdsForKey(uint8 key) internal view returns (uint64[] memory) {
        uint64[] memory ids;
        if (key == 0) {
            ids = new uint64[](1);
            ids[0] = op1;
            return ids;
        }
        if (key == 1) {
            ids = new uint64[](2);
            ids[0] = op1;
            ids[1] = op2;
            return ids;
        }
        ids = new uint64[](3);
        ids[0] = op1;
        ids[1] = op2;
        ids[2] = op3;
        return ids;
    }

    function _pickEthClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = ethClusterIds.length;
        if (count == 0) return bytes32(0);
        return ethClusterIds[seed % count];
    }

    function _pickSsvClusterId(uint256 seed) internal view returns (bytes32) {
        uint256 count = ssvClusterIds.length;
        if (count == 0) return bytes32(0);
        return ssvClusterIds[seed % count];
    }

    function _clusterOwnerUser(address owner) internal view returns (ClusterUser) {
        if (owner == address(owner1)) return owner1;
        if (owner == address(owner2)) return owner2;
        return liquidator;
    }

    function _boundAmount(uint256 seed, uint256 maxValue) internal pure returns (uint256) {
        if (maxValue == 0) return 0;
        return seed % (maxValue + 1);
    }

    function _currentClusterIndexEth(uint64[] memory operatorIdsLocal) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;
        uint256 count = operatorIdsLocal.length;
        for (uint256 i; i < count; ++i) {
            clusterIndex += s.operators[operatorIdsLocal[i]].ethSnapshot.index;
        }
        return clusterIndex;
    }

    function _currentClusterIndexSsv(uint64[] memory operatorIdsLocal) internal view returns (uint64) {
        StorageData storage s = SSVStorage.load();
        uint64 clusterIndex;
        uint256 count = operatorIdsLocal.length;
        for (uint256 i; i < count; ++i) {
            clusterIndex += s.operators[operatorIdsLocal[i]].snapshot.index;
        }
        return clusterIndex;
    }

    function _settleEthCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIdsLocal
    ) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _currentClusterIndexEth(operatorIdsLocal);
        uint64 networkFeeIndex = sp.ethNetworkFeeIndex;

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;
    }

    function _settleSsvCluster(
        bytes32 clusterId,
        ClusterRecord storage record,
        uint64[] memory operatorIdsLocal
    ) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint64 clusterIndex = _currentClusterIndexSsv(operatorIdsLocal);
        uint64 networkFeeIndex = sp.networkFeeIndex;

        ISSVNetworkCore.Cluster memory cluster = record.cluster;
        cluster.updateBalanceWithEB(clusterId, clusterIndex, networkFeeIndex);
        cluster.index = clusterIndex;
        cluster.networkFeeIndex = networkFeeIndex;
        record.cluster = cluster;
    }

    function _settleTime() internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);

        uint256 operatorCount = operatorIds.length;
        for (uint256 i; i < operatorCount; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block != 0) {
                uint32 diff = currentBlock - operator.ethSnapshot.block;
                if (diff != 0) {
                    uint64 blockDiffFee = uint64(diff) * PackedETH.unwrap(operator.ethFee);
                    // Deviation-only model: effectiveVUnits = baseline + storedDeviation
                    uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                    uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);
                    operator.ethSnapshot.index += blockDiffFee;
                    if (effectiveVUnits != 0 && blockDiffFee != 0) {
                        uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                        operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
                    }
                    operator.ethSnapshot.block = currentBlock;
                }
            }

            if (operator.snapshot.block != 0) {
                uint32 diff = currentBlock - operator.snapshot.block;
                if (diff != 0) {
                    uint64 blockDiffFee = uint64(diff) * PackedSSV.unwrap(operator.fee);
                    operator.snapshot.index += blockDiffFee;
                    operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
                    operator.snapshot.block = currentBlock;
                }
            }
        }

        uint64 ethIndex = sp.currentNetworkFeeIndex();
        uint64 ssvIndex = sp.currentNetworkFeeIndexSSV();
        sp.ethNetworkFeeIndex = ethIndex;
        sp.networkFeeIndex = ssvIndex;
        sp.ethNetworkFeeIndexBlockNumber = currentBlock;
        sp.networkFeeIndexBlockNumber = currentBlock;

        sp.updateDAOEarnings();
        sp.updateDAOEarningsSSV();

        _syncClusters();
    }

    function _fastForward(uint32 blocks) internal {
        StorageData storage s = SSVStorage.load();
        StorageProtocol storage sp = SSVStorageProtocol.load();
        StorageEB storage seb = SSVStorageEB.load();
        uint32 currentBlock = uint32(block.number);

        if (blocks == 0) return;

        uint256 operatorCount = operatorIds.length;
        for (uint256 i; i < operatorCount; ++i) {
            uint64 operatorId = operatorIds[i];
            ISSVNetworkCore.Operator storage operator = s.operators[operatorId];

            if (operator.ethSnapshot.block != 0) {
                uint64 blockDiffFee = uint64(blocks) * PackedETH.unwrap(operator.ethFee);
                // Deviation-only model: effectiveVUnits = baseline + storedDeviation
                uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
                uint64 effectiveVUnits = storedDeviation + (operator.ethValidatorCount * VUNITS_PRECISION);
                operator.ethSnapshot.index += blockDiffFee;
                if (effectiveVUnits != 0 && blockDiffFee != 0) {
                    uint128 delta = (uint128(blockDiffFee) * uint128(effectiveVUnits)) / VUNITS_PRECISION;
                    operator.ethSnapshot.balance = operator.ethSnapshot.balance.add(PackedETH.wrap(uint64(delta)));
                }
                operator.ethSnapshot.block = currentBlock;
            }

            if (operator.snapshot.block != 0) {
                uint64 blockDiffFee = uint64(blocks) * PackedSSV.unwrap(operator.fee);
                operator.snapshot.index += blockDiffFee;
                operator.snapshot.balance = operator.snapshot.balance.add(PackedSSV.wrap(blockDiffFee * operator.validatorCount));
                operator.snapshot.block = currentBlock;
            }
        }

        sp.ethNetworkFeeIndex += uint64(blocks) * PackedETH.unwrap(sp.ethNetworkFee);
        sp.networkFeeIndex += uint64(blocks) * PackedSSV.unwrap(sp.networkFee);
        sp.ethNetworkFeeIndexBlockNumber = currentBlock;
        sp.networkFeeIndexBlockNumber = currentBlock;

        if (sp.daoTotalEthVUnits != 0 && sp.ethNetworkFee.eq(PACKED_ETH_ZERO)) {
            uint128 earned = (uint128(blocks) * uint128(PackedETH.unwrap(sp.ethNetworkFee)) * uint128(sp.daoTotalEthVUnits)) /
                VUNITS_PRECISION;
            sp.ethDaoBalance = sp.ethDaoBalance.add(PackedETH.wrap(uint64(earned)));
        }

        if (sp.daoValidatorCount != 0 && sp.networkFee.neq(PACKED_SSV_ZERO)) {
            uint64 earned = uint64(blocks) * PackedSSV.unwrap(sp.networkFee) * sp.daoValidatorCount;
            sp.daoBalance = sp.daoBalance.add(PackedSSV.wrap(earned));
        }
        sp.ethDaoIndexBlockNumber = currentBlock;
        sp.daoIndexBlockNumber = currentBlock;
    }

    function _syncClusters() internal {
        uint256 ethCount = ethClusterIds.length;
        for (uint256 i; i < ethCount; ++i) {
            bytes32 clusterId = ethClusterIds[i];
            ClusterRecord storage record = ethClusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;
            uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
            _settleEthCluster(clusterId, record, operatorIdsLocal);
            SSVStorage.load().ethClusters[clusterId] = record.cluster.hashClusterData();
        }

        uint256 ssvCount = ssvClusterIds.length;
        for (uint256 i; i < ssvCount; ++i) {
            bytes32 clusterId = ssvClusterIds[i];
            ClusterRecord storage record = ssvClusters[clusterId];
            if (!record.exists || !record.cluster.active) continue;
            uint64[] memory operatorIdsLocal = _operatorIdsForKey(record.operatorsKey);
            _settleSsvCluster(clusterId, record, operatorIdsLocal);
            SSVStorage.load().clusters[clusterId] = record.cluster.hashClusterData();
        }
    }

    function _sumEthClusterBalances() internal view returns (uint256) {
        uint256 sum = 0;
        uint256 count = ethClusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = ethClusters[ethClusterIds[i]];
            if (!record.exists) continue;
            sum += record.cluster.balance;
        }
        return sum;
    }

    function _sumSsvClusterBalances() internal view returns (uint256) {
        uint256 sum = 0;
        uint256 count = ssvClusterIds.length;
        for (uint256 i; i < count; ++i) {
            ClusterRecord storage record = ssvClusters[ssvClusterIds[i]];
            if (!record.exists) continue;
            sum += record.cluster.balance;
        }
        return sum;
    }

    function _sumOperatorEthEarnings() internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        uint256 sum = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            sum += PackedETHLib.unpack(s.operators[operatorIds[i]].ethSnapshot.balance);
        }
        return sum;
    }

    function _sumOperatorSsvEarnings() internal view returns (uint256) {
        StorageData storage s = SSVStorage.load();
        uint256 sum = 0;
        uint256 count = operatorIds.length;
        for (uint256 i; i < count; ++i) {
            sum += PackedSSVLib.unpack(s.operators[operatorIds[i]].snapshot.balance);
        }
        return sum;
    }

    function _daoEthEarnings() internal view returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().ethDaoBalance);
    }

    function _daoSsvEarnings() internal view returns (uint256) {
        return PackedSSVLib.unpack(SSVStorageProtocol.load().daoBalance);
    }
}
