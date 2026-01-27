// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVStaking} from "../../modules/SSVStaking.sol";
import {SSVStorageProtocol, StorageProtocol} from "../../libraries/SSVStorageProtocol.sol";
import {SSVStorageStaking, StorageStaking, UnstakeRequest, Delegation} from "../../libraries/SSVStorageStaking.sol";
import {SSVStorage, StorageData} from "../../libraries/SSVStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SSVStakingHarness is SSVStaking {
    // ============ Mock Setters ============

    function mockSetToken(address token) external {
        SSVStorage.load().token = IERC20(token);
    }

    function mockSetCSSVToken(address cssvToken) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.cssv = cssvToken;
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
        s.stakingEthPoolBalance = balance;
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

    function mockSetDefaultOracleIds(uint32[4] calldata oracleIds) external {
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

    function mockSetOracleWeight(uint32 oracleId, uint256 weight) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.oracleWeights[oracleId] = weight;
    }

    function mockSetUserDelegation(address user, uint32[4] calldata oracleIds, uint256[4] calldata amounts) external {
        StorageStaking storage s = SSVStorageStaking.load();
        s.userDelegations[user].oracleIds = oracleIds;
        s.userDelegations[user].amounts = amounts;
    }

    function mockSetEthDaoBalance(uint64 balance) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethDaoBalance = balance;
        sp.ethDaoIndexBlockNumber = uint32(block.number);
    }

    function mockSetEthNetworkFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.ethNetworkFee = fee;
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

    function getCSSVToken() external view returns (address) {
        return SSVStorageStaking.load().cssv;
    }

    function getCooldownDuration() external view returns (uint64) {
        return SSVStorageStaking.load().cooldownDuration;
    }

    function getAccEthPerShare() external view returns (uint128) {
        return SSVStorageStaking.load().accEthPerShare;
    }

    function getStakingEthPoolBalance() external view returns (uint64) {
        return SSVStorageStaking.load().stakingEthPoolBalance;
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

    function getActiveOracleIds() external view returns (uint32[4] memory) {
        return SSVStorageStaking.load().defaultOracleIds;
    }

    function getOracleAddress(uint32 oracleId) external view returns (address) {
        return SSVStorageStaking.load().oracles[oracleId];
    }

    function getOracleId(address oracle) external view returns (uint32) {
        return SSVStorageStaking.load().oracleIdOf[oracle];
    }

    function getOracleWeight(uint32 oracleId) external view returns (uint256) {
        return SSVStorageStaking.load().oracleWeights[oracleId];
    }

    function getUserDelegation(
        address user
    ) external view returns (uint32[4] memory oracleIds, uint256[4] memory amounts) {
        Delegation storage d = SSVStorageStaking.load().userDelegations[user];
        return (d.oracleIds, d.amounts);
    }

    function getEthDaoBalance() external view returns (uint64) {
        return SSVStorageProtocol.load().ethDaoBalance;
    }

    function getEthNetworkFee() external view returns (uint64) {
        return SSVStorageProtocol.load().ethNetworkFee;
    }

    function getDaoTotalEthVUnits() external view returns (uint64) {
        return SSVStorageProtocol.load().daoTotalEthVUnits;
    }

    // ============ Receive ETH for testing ============

    receive() external payable {}
}
