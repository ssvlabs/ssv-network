// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVDAO} from "../../modules/SSVDAO.sol";
import {SSVStorageProtocol, StorageProtocol} from "../../libraries/storage/SSVStorageProtocol.sol";
import {SSVStorageStaking, StorageStaking} from "../../libraries/storage/SSVStorageStaking.sol";
import {SSVStorageEB, StorageEB} from "../../libraries/storage/SSVStorageEB.sol";
import {SSVStorage, StorageData} from "../../libraries/storage/SSVStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PackedETH, PackedSSV} from "../../libraries/SSVCoreTypes.sol";
import {PackedETHLib} from "../../libraries/SSVPackedLib.sol";

contract SSVDAOHarness is SSVDAO {

    constructor(address cssvAddress) SSVDAO(cssvAddress) {}

    function mockSetNetworkFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFee = PackedETHLib.pack(fee);
    }

    function mockSetDaoBalance(uint64 balance) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.daoBalance = PackedSSV.wrap(balance);
        sp.daoIndexBlockNumber = uint32(block.number);
    }

    function mockSetEthDaoBalance(uint64 balance) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = PackedETH.wrap(balance);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function mockSetDaoValidatorCount(uint32 count) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.daoValidatorCount = count;
    }

    function mockSetDaoTotalEthVUnits(uint64 vUnits) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.daoTotalEthVUnits = vUnits;
    }

    function mockSetNetworkFeeIndex(uint64 index) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.networkFeeIndex = index;
        sp.networkFeeIndexBlockNumber = uint32(block.number);
    }

    function mockSetEthNetworkFeeIndex(uint64 index) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFeeIndex = index;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
    }

    function mockSetMinimumBlocksBeforeLiquidation(uint64 blocks) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = blocks;
    }

    function mockSetMinimumBlocksBeforeLiquidationSSV(uint64 blocks) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidationSSV = blocks;
    }

    function mockSetMinimumLiquidationCollateral(uint64 collateral) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumLiquidationCollateral = PackedETH.wrap(collateral);
    }

    function mockSetMinimumLiquidationCollateralSSV(uint64 collateral) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumLiquidationCollateralSSV = PackedSSV.wrap(collateral);
    }

    function mockSetOperatorMaxFee(uint64 maxFee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFee = PackedETHLib.pack(maxFee);
    }

    function mockSetOperatorMaxFeeIncrease(uint64 increase) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFeeIncrease = increase;
    }

    function mockSetDeclareOperatorFeePeriod(uint64 period) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.declareOperatorFeePeriod = period;
    }

    function mockSetExecuteOperatorFeePeriod(uint64 period) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.executeOperatorFeePeriod = period;
    }

    function mockSetOracle(uint32 oracleId, address oracle) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.oracles[oracleId] = oracle;
        if (oracle != address(0)) {
            s.oracleIdOf[oracle] = oracleId;
        }
    }

    function mockSetQuorumBps(uint16 quorum) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.quorumBps = quorum;
    }

    function mockSetCooldownDuration(uint64 duration) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = duration;
    }

    function mockSetLatestCommittedBlock(uint64 blockNum) external {
        StorageEB storage seb = SSVStorageEB.load();
        seb.latestCommittedBlock = blockNum;
    }

    function mockSetEBRoot(uint64 blockNum, bytes32 root) external {
        StorageEB storage seb = SSVStorageEB.load();
        seb.ebRoots[blockNum] = root;
    }

    function mockSetToken(address token) external {
        SSVStorage.load().token = IERC20(token);
    }

    function getNetworkFee() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().ethNetworkFee);
    }

    function getNetworkFeeSSV() external view returns (uint64) {
        return PackedSSV.unwrap(SSVStorageProtocol.load().networkFee);
    }

    function getDaoBalance() external view returns (uint64) {
        return PackedSSV.unwrap(SSVStorageProtocol.load().daoBalance);
    }

    function getEthDaoBalance() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().ethDaoBalance);
    }

    function getOperatorMaxFeeIncrease() external view returns (uint64) {
        return SSVStorageProtocol.load().operatorMaxFeeIncrease;
    }

    function getDeclareOperatorFeePeriod() external view returns (uint64) {
        return SSVStorageProtocol.load().declareOperatorFeePeriod;
    }

    function getExecuteOperatorFeePeriod() external view returns (uint64) {
        return SSVStorageProtocol.load().executeOperatorFeePeriod;
    }

    function getMinimumBlocksBeforeLiquidation() external view returns (uint64) {
        return SSVStorageProtocol.load().minimumBlocksBeforeLiquidation;
    }

    function getMinimumBlocksBeforeLiquidationSSV() external view returns (uint64) {
        return SSVStorageProtocol.load().minimumBlocksBeforeLiquidationSSV;
    }

    function getMinimumLiquidationCollateral() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().minimumLiquidationCollateral);
    }

    function getMinimumLiquidationCollateralSSV() external view returns (uint64) {
        return PackedSSV.unwrap(SSVStorageProtocol.load().minimumLiquidationCollateralSSV);
    }

    function getOperatorMaxFee() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().operatorMaxFee);
    }

    function getMinimumOperatorEthFee() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().minimumOperatorEthFee);
    }

    function getQuorumBps() external view returns (uint16) {
        return SSVStorageStaking.load().quorumBps;
    }

    function getCooldownDuration() external view returns (uint64) {
        return SSVStorageStaking.load().cooldownDuration;
    }

    function getLatestCommittedBlock() external view returns (uint64) {
        return SSVStorageEB.load().latestCommittedBlock;
    }

    function getEBRoot(uint64 blockNum) external view returns (bytes32) {
        return SSVStorageEB.load().ebRoots[blockNum];
    }

    function getOracleAddress(uint32 oracleId) external view returns (address) {
        return SSVStorageStaking.load().oracles[oracleId];
    }

    function getOracleId(address oracle) external view returns (uint32) {
        return SSVStorageStaking.load().oracleIdOf[oracle];
    }

    function getRootCommitmentWeight(bytes32 commitmentKey) external view returns (uint256) {
        return SSVStorageEB.load().rootCommitments[commitmentKey];
    }

    function hasOracleVoted(bytes32 commitmentKey, uint32 oracleId) external view returns (bool) {
        return SSVStorageEB.load().hasVoted[commitmentKey][oracleId];
    }
}
