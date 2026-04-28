// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVStaking} from "../../modules/SSVStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../../libraries/storage/SSVStorageProtocol.sol";
import {
    MAX_DELEGATION_SLOTS,
    SSVStorageStaking,
    StorageStaking,
    UnstakeRequest
} from "../../libraries/storage/SSVStorageStaking.sol";
import {SSVStorage, StorageData} from "../../libraries/storage/SSVStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PackedETH} from "../../libraries/SSVCoreTypes.sol";
import {PackedETHLib} from "../../libraries/SSVPackedLib.sol";

contract SSVStakingHarness is SSVStaking {

    constructor(address cssvAddress) SSVStaking(cssvAddress) {}

    // ============ Mock Setters ============

    function mockSetToken(address token) external {
        SSVStorage.load().token = IERC20(token);
    }

    function mockSetCooldownDuration(uint64 duration) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.cooldownDuration = duration;
    }

    function mockSetAccEthPerShare(uint128 value) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.accEthPerShare = value;
    }

    function mockSetStakingEthPoolBalance(uint64 balance) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.stakingEthPoolBalance = PackedETH.wrap(balance);
    }

    function mockSetUserIndex(address user, uint256 index) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.userIndex[user] = index;
    }

    function mockSetUserAccrued(address user, uint256 amount) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.accrued[user] = amount;
    }

    function mockSetWithdrawal(address user, uint192 amount, uint64 unlockTime) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.withdrawalRequests[user].push(UnstakeRequest({amount: amount, unlockTime: unlockTime}));
    }

    function mockSetDefaultOracleIds(uint32[MAX_DELEGATION_SLOTS] calldata oracleIds) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.defaultOracleIds = oracleIds;
    }

    function mockSetOracle(uint32 oracleId, address oracle) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.oracles[oracleId] = oracle;
        if (oracle != address(0)) {
            s.oracleIdOf[oracle] = oracleId;
        }
    }

    function mockSetEthDaoBalance(uint64 balance) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = PackedETH.wrap(balance);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function mockSetEthNetworkFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFee = PackedETH.wrap(fee);
    }

    function mockSetDaoTotalEthVUnits(uint64 vUnits) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.daoTotalEthVUnits = vUnits;
    }

    function mockSetEthNetworkFeeIndex(uint64 index) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFeeIndex = index;
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
    }

    // ============ Getters ============

    function getCooldownDuration() external view returns (uint64) {
        return SSVStorageStaking.load().cooldownDuration;
    }

    function getAccEthPerShare() external view returns (uint128) {
        return SSVStorageStaking.load().accEthPerShare;
    }

    function getStakingEthPoolBalance() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageStaking.load().stakingEthPoolBalance);
    }

    function getUserIndex(address user) external view returns (uint256) {
        return SSVStorageStaking.load().userIndex[user];
    }

    function getUserAccrued(address user) external view returns (uint256) {
        return SSVStorageStaking.load().accrued[user];
    }

    function getWithdrawal(address user) external view returns (uint192 amount, uint64 unlockTime) {
        UnstakeRequest[] storage requests = SSVStorageStaking.load().withdrawalRequests[user];
        if (requests.length == 0) {
            return (0, 0);
        }

        UnstakeRequest memory req = requests[requests.length - 1];
        return (req.amount, req.unlockTime);
    }

    function getWithdrawalRequestsCount(address user) external view returns (uint256) {
        return SSVStorageStaking.load().withdrawalRequests[user].length;
    }

    function getWithdrawalRequest(address user, uint256 index) external view returns (uint192 amount, uint64 unlockTime) {
        UnstakeRequest storage req = SSVStorageStaking.load().withdrawalRequests[user][index];
        return (req.amount, req.unlockTime);
    }

    function getActiveOracleIds() external view returns (uint32[MAX_DELEGATION_SLOTS] memory) {
        return SSVStorageStaking.load().defaultOracleIds;
    }

    function getOracleAddress(uint32 oracleId) external view returns (address) {
        return SSVStorageStaking.load().oracles[oracleId];
    }

    function getOracleId(address oracle) external view returns (uint32) {
        return SSVStorageStaking.load().oracleIdOf[oracle];
    }

    function getEthDaoBalance() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().ethDaoBalance);
    }

    function getEthNetworkFee() external view returns (uint64) {
        return PackedETH.unwrap(SSVStorageProtocol.load().ethNetworkFee);
    }

    function getDaoTotalEthVUnits() external view returns (uint64) {
        return SSVStorageProtocol.load().daoTotalEthVUnits;
    }

    // ============ Receive ETH for testing ============

    receive() external payable {}
}
