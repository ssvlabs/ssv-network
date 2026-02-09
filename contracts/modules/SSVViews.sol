// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVViews} from "../interfaces/ISSVViews.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import "../libraries/ClusterLib.sol";
import "../libraries/OperatorLib.sol";
import "../libraries/CoreLib.sol";
import "../libraries/ProtocolLib.sol";
import {PackedSSV, PackedETH, VERSION_ETH, VERSION_SSV} from "../libraries/SSVCoreTypes.sol";
import {PackedSSVLib, PackedETHLib} from "../libraries/SSVPackedLib.sol";
import {SSVStorage, StorageData} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol, StorageProtocol} from "../libraries/SSVStorageProtocol.sol";
import {SSVStorageStaking, StorageStaking, UnstakeRequest} from "../libraries/SSVStorageStaking.sol";

contract SSVViews is ISSVViews {
    using ClusterLib for Cluster;
    using OperatorLib for Operator;
    using ProtocolLib for StorageProtocol;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    uint256 private constant PRECISION = 1e18;

    address public immutable CSSV_ADDRESS;

    constructor(address _cssv) {
        CSSV_ADDRESS = _cssv;
    }

    /*************************************/
    /* Validator External View Functions */
    /*************************************/

    function getValidator(address clusterOwner, bytes calldata publicKey) external view override returns (bool) {
        bytes32 validatorData = SSVStorage.load().validatorPKs[keccak256(abi.encodePacked(publicKey, clusterOwner))];

        if (validatorData == bytes32(0)) return false;
        bytes32 activeFlag = validatorData & bytes32(uint256(1)); // Retrieve LSB of stored value

        return activeFlag == bytes32(uint256(1));
    }

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view override returns (uint256) {
        return PackedETHLib.unpack(SSVStorage.load().operators[operatorId].ethFee);
    }

    function getOperatorFeeSSV(uint64 operatorId) external view override returns (uint256) {
        return PackedSSVLib.unpack(SSVStorage.load().operators[operatorId].fee);
    }

    function getOperatorDeclaredFee(uint64 operatorId) external view override returns (OperatorDeclaredFeeData memory) {
        StorageData storage s = SSVStorage.load();
        OperatorFeeChangeRequest memory opFeeChangeRequest = s.operatorFeeChangeRequests[operatorId];

        bool isETHOperator = s.operators[operatorId].ethSnapshot.block != 0;

        return OperatorDeclaredFeeData(
            opFeeChangeRequest.approvalBeginTime != 0,
            isETHOperator ? PackedETHLib.unpack(PackedETH.wrap(opFeeChangeRequest.fee)) : PackedSSVLib.unpack(PackedSSV.wrap(opFeeChangeRequest.fee)),
            opFeeChangeRequest.approvalBeginTime,
            opFeeChangeRequest.approvalEndTime
        );
    }

    function getOperatorById(
        uint64 operatorId
    ) external view override returns (OperatorData memory op)
    {
        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];

        op.owner = operator.owner;
        op.fee = PackedETHLib.unpack(operator.ethFee);
        op.validatorCount = operator.ethValidatorCount;
        op.whitelistedAddress = SSVStorage.load().operatorsWhitelist[operatorId];
        op.isPrivate = operator.whitelisted;
        op.isActive = operator.ethSnapshot.block != 0;
    }

    function getOperatorByIdSSV(
        uint64 operatorId
    ) external view override returns (OperatorData memory op)
    {
        ISSVNetworkCore.Operator storage operator = SSVStorage.load().operators[operatorId];

        op.owner = operator.owner;
        op.fee = PackedSSVLib.unpack(operator.fee);
        op.validatorCount = operator.validatorCount;
        op.whitelistedAddress = SSVStorage.load().operatorsWhitelist[operatorId];
        op.isPrivate = operator.whitelisted;
        op.isActive = operator.snapshot.block != 0;
    }

    function getWhitelistedOperators(
        uint64[] calldata operatorIds,
        address addressToCheck
    ) external view override returns (uint64[] memory whitelistedOperatorIds) {
        uint256 operatorsLength = operatorIds.length;
        if (operatorsLength == 0 || addressToCheck == address(0)) return whitelistedOperatorIds;

        StorageData storage s = SSVStorage.load();

        uint256 internalCount;

        // Check whitelisting address for each operator using the internal SSV whitelisting module
        (uint256[] memory masks, uint256 startBlockIndex) = OperatorLib.generateBlockMasks(operatorIds, false, s);
        uint64[] memory internalWhitelistedOperatorIds = new uint64[](operatorsLength);

        uint256 endBlockIndex = startBlockIndex + masks.length;
        // Check whitelisting status for each mask
        for (uint256 blockIndex = startBlockIndex; blockIndex < endBlockIndex; ++blockIndex) {
            uint256 mask = masks[blockIndex - startBlockIndex];
            // Only check blocks that have operator IDs
            if (mask != 0) {
                uint256 whitelistedMask = s.addressWhitelistedForOperators[addressToCheck][blockIndex];

                // This will give the matching whitelisted operators
                uint256 matchedMask = whitelistedMask & mask;

                // Now we need to extract operator IDs from matchedMask
                uint256 blockPointer = blockIndex << 8;
                for (uint256 bit; bit < 256; ++bit) {
                    if (matchedMask & (1 << bit) != 0) {
                        internalWhitelistedOperatorIds[internalCount++] = uint64(blockPointer + bit);
                        if (internalCount == operatorsLength) {
                            return internalWhitelistedOperatorIds; // Early termination
                        }
                    }
                }
            }
        }

        // Resize internalWhitelistedOperatorIds to the actual number of whitelisted operators
        assembly {
            mstore(internalWhitelistedOperatorIds, internalCount)
        }

        // Check if pending operators use an external whitelisting contract and check whitelistedAddress using it
        whitelistedOperatorIds = new uint64[](operatorsLength);
        uint256 internalWhitelistIndex;
        uint256 count;

        for (uint256 operatorIndex; operatorIndex < operatorsLength; ++operatorIndex) {
            uint64 operatorId = operatorIds[operatorIndex];

            // Check if operatorId is already in internalWhitelistedOperatorIds
            if (
                internalWhitelistIndex < internalCount &&
                operatorId == internalWhitelistedOperatorIds[internalWhitelistIndex]
            ) {
                whitelistedOperatorIds[count++] = operatorId;
                ++internalWhitelistIndex;
            } else {
                address whitelistedAddress = s.operatorsWhitelist[operatorId];

                // Legacy address whitelists (EOAs or generic contracts)
                if (
                    whitelistedAddress == addressToCheck ||
                    (OperatorLib.isWhitelistingContract(whitelistedAddress) &&
                        ISSVWhitelistingContract(whitelistedAddress).isWhitelisted(addressToCheck, operatorId))
                ) {
                    whitelistedOperatorIds[count++] = operatorId;
                }
            }
        }

        // Resize whitelistedOperatorIds to the actual number of whitelisted operators
        assembly {
            mstore(whitelistedOperatorIds, count)
        }
    }

    function isWhitelistingContract(address contractAddress) external view override returns (bool) {
        return OperatorLib.isWhitelistingContract(contractAddress);
    }

    function isAddressWhitelistedInWhitelistingContract(
        address addressToCheck,
        uint256 operatorId,
        address whitelistingContract
    ) external view override returns (bool) {
        if (!OperatorLib.isWhitelistingContract(whitelistingContract) || addressToCheck == address(0)) return false;
        return ISSVWhitelistingContract(whitelistingContract).isWhitelisted(addressToCheck, operatorId);
    }

    /***********************************/
    /* Cluster External View Functions */
    /***********************************/

    function isLiquidatable(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        ClusterLib.validateClusterVersion(version, VERSION_ETH);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.ethSnapshot.index + (uint64(block.number) - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);
            burnRate += PackedETH.unwrap(operator.ethFee);
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndex());
        return
            cluster.isLiquidatableWithEB(
                hashedCluster,
                burnRate,
                PackedETH.unwrap(sp.ethNetworkFee),
                sp.minimumBlocksBeforeLiquidation,
                sp.minimumLiquidationCollateral
            );
    }

    function isLiquidatableSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        (, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        ClusterLib.validateClusterVersion(version, VERSION_SSV);

        if (!cluster.active) {
            return false;
        }

        uint64 clusterIndex;
        uint64 burnRate;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * PackedSSV.unwrap(operator.fee);
            burnRate += PackedSSV.unwrap(operator.fee);
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();

        cluster.updateBalance(clusterIndex, sp.currentNetworkFeeIndexSSV());
        return
            cluster.isLiquidatable(
                burnRate,
                PackedSSV.unwrap(sp.networkFee),
                sp.minimumBlocksBeforeLiquidationSSV,
                sp.minimumLiquidationCollateralSSV
            );
    }

    function isLiquidated(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (bool) {
        cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        return !cluster.active;
    }

    function getBurnRate(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        (bytes32 hashedCluster, ) = cluster.validateHashedCluster(
            clusterOwner,
            operatorIds,
            SSVStorage.load()
        );

        PackedETH operatorsFee;
        uint256 len = operatorIds.length;
        for (uint256 i; i < len; ++i) {
            Operator memory op = SSVStorage.load().operators[operatorIds[i]];
            if (op.owner != address(0)) {
                operatorsFee = operatorsFee.add(op.ethFee);
            }
        }

        PackedETH networkFee = SSVStorageProtocol.load().ethNetworkFee;

        uint64 vUnits = SSVStorageEB.load().clusterEB[hashedCluster].vUnits;
        if (vUnits == 0) {
            vUnits = uint64(cluster.validatorCount) * VUNITS_PRECISION;
        }

        return (PackedETHLib.unpack(networkFee.add(operatorsFee)) * uint256(vUnits)) / VUNITS_PRECISION;
    }

    function getBurnRateSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256) {
        (, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());

        if (version != VERSION_SSV) {
            return 0;
        }

        PackedSSV aggregateFee;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            if (operator.owner != address(0)) {
                aggregateFee = aggregateFee.add(operator.fee);
            }
        }

        uint128 burnRate = PackedSSV.unwrap(aggregateFee.add(SSVStorageProtocol.load().networkFee)) * cluster.validatorCount;
        return PackedSSVLib.unpack(PackedSSV.wrap(uint64(burnRate)));
    }

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorage.load().operators[id];

        operator.updateSnapshot(id);
        return PackedETHLib.unpack(operator.ethSnapshot.balance);
    }

    function getOperatorEarningsSSV(uint64 id) external view override returns (uint256) {
        Operator memory operator = SSVStorage.load().operators[id];

        operator.updateSnapshotSSV();
        return PackedSSVLib.unpack(operator.snapshot.balance);
    }

    function getBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256 balance) {
        (bytes32 hashedCluster, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        if (version != VERSION_ETH) {
            return 0;
        }
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.ethSnapshot.index + (uint64(block.number) - operator.ethSnapshot.block) * PackedETH.unwrap(operator.ethFee);
        }

        StorageProtocol storage sp = SSVStorageProtocol.load();
        cluster.updateBalanceWithEB(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
        balance = cluster.balance;
    }

    function getBalanceSSV(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view override returns (uint256 balance) {
        (, uint8 version) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        if (version != VERSION_SSV) {
            return 0;
        }
        cluster.validateClusterIsNotLiquidated();

        uint64 clusterIndex;
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            Operator memory operator = SSVStorage.load().operators[operatorIds[i]];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * PackedSSV.unwrap(operator.fee);
        }

        cluster.updateBalanceSSV(clusterIndex, SSVStorageProtocol.load().currentNetworkFeeIndexSSV());
        balance = cluster.balance;
    }

    function getEffectiveBalance(
        address clusterOwner,
        uint64[] calldata operatorIds,
        Cluster memory cluster
    ) external view returns (uint32 effectiveBalance) {
        (bytes32 hashedCluster, ) = cluster.validateHashedCluster(clusterOwner, operatorIds, SSVStorage.load());
        cluster.validateClusterIsNotLiquidated();

        StorageEB storage seb = SSVStorageEB.load();
        uint64 vUnits = seb.clusterEB[hashedCluster].vUnits;

        if (vUnits == 0) {
            vUnits = cluster.validatorCount * VUNITS_PRECISION;
        }

        return ClusterLib.vUnitsToEB(vUnits);
    }

    function getClusterAssetType(address clusterOwner, uint64[] calldata operatorIds) external view override returns (uint8) {
        StorageData storage s = SSVStorage.load();
        bytes32 hashedCluster = keccak256(abi.encodePacked(clusterOwner, operatorIds));

        if (s.ethClusters[hashedCluster] != bytes32(0)) {
            return VERSION_ETH;
        }
        if (s.clusters[hashedCluster] != bytes32(0)) {
            return VERSION_SSV;
        }

        revert ClusterDoesNotExist();
    }

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view override returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().ethNetworkFee);
    }

    function getNetworkFeeSSV() external view override returns (uint256) {
        return PackedSSVLib.unpack(SSVStorageProtocol.load().networkFee);
    }

    function getNetworkEarnings() external view override returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().networkTotalEarnings());
    }

    function getNetworkEarningsSSV() external view override returns (uint256) {
        return PackedSSVLib.unpack(SSVStorageProtocol.load().networkTotalEarningsSSV());
    }

    function getOperatorFeeIncreaseLimit() external view override returns (uint64) {
        return SSVStorageProtocol.load().operatorMaxFeeIncrease;
    }

    function getMaximumOperatorFee() external view override returns (uint256) {
        return SSVStorageProtocol.load().operatorMaxFee.unpack();
    }

    function getMaximumOperatorFeeSSV() external view override returns (uint64) {
        return SSVStorageProtocol.load().operatorMaxFeeSSV;
    }

    function getMinimumOperatorEthFee() external view override returns (uint256) {
        return SSVStorageProtocol.load().minimumOperatorEthFee.unpack();
    }

    function getOperatorFeePeriods() external view override returns (OperatorFeePeriodsData memory) {
        return OperatorFeePeriodsData(
            SSVStorageProtocol.load().declareOperatorFeePeriod,
            SSVStorageProtocol.load().executeOperatorFeePeriod
        );
    }

    function getLiquidationThresholdPeriod() external view override returns (uint64) {
        return SSVStorageProtocol.load().minimumBlocksBeforeLiquidation;
    }

    function getLiquidationThresholdPeriodSSV() external view override returns (uint64) {
        return SSVStorageProtocol.load().minimumBlocksBeforeLiquidationSSV;
    }

    function getMinimumLiquidationCollateral() external view override returns (uint256) {
        return PackedETHLib.unpack(SSVStorageProtocol.load().minimumLiquidationCollateral);
    }

    function getMinimumLiquidationCollateralSSV() external view override returns (uint256) {
        return PackedSSVLib.unpack(SSVStorageProtocol.load().minimumLiquidationCollateralSSV);
    }

    function getValidatorsPerOperatorLimit() external view override returns (uint32) {
        return SSVStorageProtocol.load().validatorsPerOperatorLimit;
    }

    function getNetworkValidatorsCount() external view override returns (uint32) {
        return SSVStorageProtocol.load().ethDaoValidatorCount;
    }

    function cooldownDuration() external view override returns (uint256) {
        return SSVStorageStaking.load().cooldownDuration;
    }

    function totalStaked() external view override returns (uint256) {
        return ICSSVToken(CSSV_ADDRESS).totalSupply();
    }

    function stakedBalanceOf(address user) external view override returns (uint256) {
        return ICSSVToken(CSSV_ADDRESS).balanceOf(user);
    }

    function pendingUnstake(address user) external view override returns (UnstakeRequestsData[] memory data) {
        StorageStaking storage s = SSVStorageStaking.load();
        UnstakeRequest[] storage requests = s.withdrawalRequests[user];

        uint256 len = requests.length;
        data = new UnstakeRequestsData[](len);

        for (uint256 i = 0; i < len; i++) {
            data[i] = UnstakeRequestsData({
                amount: requests[i].amount,
                unlockTime: requests[i].unlockTime
            });
        }
    }

    function accEthPerShare() external view override returns (uint256) {
        return SSVStorageStaking.load().accEthPerShare;
    }

    function stakingEthPoolBalance() external view override returns (uint256) {
        return SSVStorageStaking.load().stakingEthPoolBalance.unpack();
    }

    function previewClaimableEth(address user) external view override returns (uint256) {
        StorageStaking storage s = SSVStorageStaking.load();
        uint256 idx = _previewAccEthPerShare(s);
        uint256 bal = ICSSVToken(CSSV_ADDRESS).balanceOf(user);
        uint256 delta = idx - s.userIndex[user];
        uint256 pending = (bal * delta) / PRECISION;
        return s.accrued[user] + pending;
    }

    function getOracle(uint32 oracleId) external view override returns (address) {
        return SSVStorageStaking.load().oracles[oracleId];
    }

    function getOracleWeight(uint32 oracleId) external view override returns (uint256) {
        uint256 staked = ICSSVToken(CSSV_ADDRESS).totalSupply();
        return staked / SSVStorageStaking.load().defaultOracleIds.length;
    }

    function getActiveOracleIds() external view override returns (uint32[4] memory) {
        return SSVStorageStaking.load().defaultOracleIds;
    }

    function getQuorumBps() external view override returns (uint16) {
        return SSVStorageStaking.load().quorumBps;
    }

    function getCommittedRoot(uint64 blockNum) external view override returns (bytes32) {
        return SSVStorageEB.load().ebRoots[blockNum];
    }

    function _previewAccEthPerShare(StorageStaking storage s) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        PackedETH current = sp.networkTotalEarnings();

        uint256 idx = s.accEthPerShare;
        PackedETH previous = s.stakingEthPoolBalance;

        uint256 totalStaked_ = ICSSVToken(CSSV_ADDRESS).totalSupply();

        if (current.lte(previous) || totalStaked_ == 0) {
            return idx;
        }

        PackedETH packedNewFees = current.sub(previous);
        uint256 newFeesWei = PackedETHLib.unpack(packedNewFees);
        return idx + (newFeesWei * PRECISION) / totalStaked_;
    }

    function getVersion() external pure override returns (string memory) {
        return CoreLib.getVersion();
    }
}
