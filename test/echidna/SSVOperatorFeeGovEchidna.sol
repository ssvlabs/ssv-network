// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/interfaces/ISSVOperators.sol";
import "../../contracts/interfaces/ISSVNetworkCore.sol";
import "../../contracts/libraries/storage/SSVStorage.sol";
import "../../contracts/libraries/storage/SSVStorageProtocol.sol";
import "../../contracts/libraries/storage/SSVStorageEB.sol";
import "../../contracts/test/mocks/MockToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import {PackedETHLib, PackedSSVLib, DEDUCTED_DIGITS} from "../../contracts/libraries/SSVPackedLib.sol";
import {PackedETH, PackedSSV, PACKED_ETH_ZERO, PACKED_SSV_ZERO} from "../../contracts/libraries/SSVCoreTypes.sol";

contract FeeGovUser {
    ISSVOperators public operators;

    constructor(ISSVOperators operators_) {
        operators = operators_;
    }

    function declareFee(uint64 operatorId, uint256 fee) external {
        operators.declareOperatorFee(operatorId, fee);
    }

    function executeFee(uint64 operatorId) external {
        operators.executeOperatorFee(operatorId);
    }
}

contract SSVOperatorFeeGovEchidna is SSVOperators(1) {
    using Counters for Counters.Counter;
    using PackedETHLib for PackedETH;
    using PackedSSVLib for PackedSSV;

    uint256 private constant DEFAULT_MIN_OPERATOR_ETH_FEE = 10_000_000;

    MockToken private token;
    FeeGovUser private user1;
    FeeGovUser private user2;

    uint64[] private operatorIds;
    mapping(uint64 => address) private operatorOwner;
    uint64 private lastOperatorId;
    uint64 private constant MAX_OPERATORS = 4;

    bool private legacyDeclarationExecutable;

    constructor() {
        token = new MockToken();
        _mockSetToken(address(token));
        _mockSetOperatorMaxFee(uint64(10 ether));
        _mockSetFeePeriods(10, 100);
        _mockSetOperatorMaxFeeIncrease(10_000);
        _initProtocolDefaults();

        ISSVOperators self = ISSVOperators(address(this));
        user1 = new FeeGovUser(self);
        user2 = new FeeGovUser(self);
    }

    receive() external payable {}

    function action_register(uint256 pkSeed, uint256 feeSeed, uint8 userSeed) external {
        if (operatorIds.length >= MAX_OPERATORS) return;

        FeeGovUser user = userSeed % 2 == 0 ? user1 : user2;
        bytes memory publicKey = abi.encodePacked(pkSeed);
        bytes32 hashedPk = keccak256(publicKey);
        if (SSVStorage.load().operatorsPKs[hashedPk] != 0) return;

        uint256 fee = _boundFee(feeSeed);

        try ISSVOperators(address(this)).registerOperator(publicKey, fee, false) returns (uint64 id) {
            operatorIds.push(id);
            operatorOwner[id] = address(user);
            lastOperatorId = id;
        } catch {}
    }

    function action_plant_and_execute_legacy(uint256 idSeed, uint256 feeSeed) external {
        uint64 operatorId = _pickOperatorId(idSeed);
        if (operatorId == 0) return;
        address ownerAddr = operatorOwner[operatorId];
        if (ownerAddr == address(0)) return;

        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[operatorId];
        if (op.ethSnapshot.block == 0 && op.snapshot.block == 0) return;

        uint256 fee = _boundFee(feeSeed);
        PackedETH shrunkFee = PackedETHLib.pack(fee);

        SSVStorage.load().operatorFeeChangeRequests[operatorId] = ISSVNetworkCore.OperatorFeeChangeRequest({
            fee: PackedETH.unwrap(shrunkFee),
            approvalBeginTime: uint64(UPGRADE_TIMESTAMP),
            approvalEndTime: uint64(block.timestamp) + 10_000
        });

        FeeGovUser owner = FeeGovUser(payable(ownerAddr));
        try owner.executeFee(operatorId) {
            legacyDeclarationExecutable = true;
        } catch {}
    }

    function echidna_execute_rejects_legacy_declarations() external view returns (bool) {
        return !legacyDeclarationExecutable;
    }

    function _pickOperatorId(uint256 seed) internal view returns (uint64) {
        uint256 count = operatorIds.length;
        if (count == 0) return 0;
        return operatorIds[seed % count];
    }

    function _boundFee(uint256 seed) internal view returns (uint256) {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        uint256 maxFeeWei = PackedETHLib.unpack(sp.operatorMaxFee);
        uint256 minFeeWei = PackedETHLib.unpack(sp.minimumOperatorEthFee);
        if (maxFeeWei == 0) return 0;
        uint256 fee = seed % (maxFeeWei + 1);
        if (fee != 0 && fee < minFeeWei) fee = minFeeWei;
        if (fee > maxFeeWei) fee = maxFeeWei;
        return fee;
    }

    function _mockSetToken(address tokenAddress) internal {
        SSVStorage.load().token = IERC20(tokenAddress);
    }

    function _mockSetOperatorMaxFee(uint64 fee) internal {
        SSVStorageProtocol.load().operatorMaxFee = PackedETH.wrap(fee);
    }

    function _mockSetFeePeriods(uint64 declarePeriod, uint64 executePeriod) internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.declareOperatorFeePeriod = declarePeriod;
        sp.executeOperatorFeePeriod = executePeriod;
    }

    function _mockSetOperatorMaxFeeIncrease(uint64 increase) internal {
        SSVStorageProtocol.load().operatorMaxFeeIncrease = increase;
    }

    function _initProtocolDefaults() internal {
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.validatorsPerOperatorLimit = 3000;
        sp.ethNetworkFee = PackedETH.wrap(1);
        sp.ethNetworkFeeIndexBlockNumber = uint32(block.number);
        sp.ethDaoIndexBlockNumber = uint32(block.number);
        sp.operatorMaxFeeSSV = type(uint64).max;
        sp.minimumOperatorEthFee = PackedETHLib.pack(DEFAULT_MIN_OPERATOR_ETH_FEE);
    }
}
