// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {SSVOperators} from "../../modules/SSVOperators.sol";
import {SSVStorageProtocol, StorageProtocol} from "../../libraries/storage/SSVStorageProtocol.sol";
import {SSVStorage, StorageData} from "../../libraries/storage/SSVStorage.sol";
import {ISSVNetworkCore} from "../../interfaces/ISSVNetworkCore.sol";
import {ISSVOperators} from "../../interfaces/ISSVOperators.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PackedETH, PackedSSV} from "../../libraries/SSVCoreTypes.sol";
import {PackedETHLib} from "../../libraries/SSVPackedLib.sol";

contract SSVOperatorsHarness is SSVOperators {

    constructor(uint256 upgradeTimestamp) SSVOperators(upgradeTimestamp) {
  
    }

    function mockSetOperatorMaxFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFee = PackedETHLib.pack(fee);
    }

    function mockSetFeePeriods(uint64 declarePeriod, uint64 executePeriod) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.declareOperatorFeePeriod = declarePeriod;
        sp.executeOperatorFeePeriod = executePeriod;
    }

    function mockSetOperatorMaxFeeIncrease(uint64 increase) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFeeIncrease = increase;
    }

    function mockSetMinimumOperatorEthFee(uint64 fee) external {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumOperatorEthFee = PackedETHLib.pack(fee);
    }

    function getOperator(uint64 operatorId) external view returns (Operator memory) {
        return SSVStorage.load().operators[operatorId];
    }

    function getOperatorFeeChangeRequest(uint64 operatorId) external view returns (OperatorFeeChangeRequest memory) {
        return SSVStorage.load().operatorFeeChangeRequests[operatorId];
    }

    function getOperatorWhitelist(uint64 operatorId) external view returns (address) {
        return SSVStorage.load().operatorsWhitelist[operatorId];
    }

    function mockSetOperator(
        uint64 operatorId,
        ISSVNetworkCore.Operator memory operator
    ) external {
        SSVStorage.load().operators[operatorId] = operator;
    }

    function mockSetOperatorBalances(
        uint64 operatorId,
        uint64 ethSnapshotBalance,
        uint64 ssvSnapshotBalance
    ) external {
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].ethSnapshot.balance = PackedETH.wrap(ethSnapshotBalance);
        s.operators[operatorId].snapshot.balance = PackedSSV.wrap(ssvSnapshotBalance);
    }

    function mockSetToken(address token) external {
        SSVStorage.load().token = IERC20(token);
    }

    function mockSetOperatorFeeChangeRequest(
        uint64 operatorId,
        uint64 fee,
        uint64 approvalBeginTime,
        uint64 approvalEndTime
    ) external {
        SSVStorage.load().operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            fee,
            approvalBeginTime,
            approvalEndTime
        );
    }

    function getUpgradeTimestamp() external view returns (uint256) {
        return UPGRADE_TIMESTAMP;
    }
}
