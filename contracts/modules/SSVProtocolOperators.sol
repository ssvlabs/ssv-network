// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVProtocolOperators.sol";

import {Types64, Types256} from "../libraries/Types.sol";
import {CoreLib} from "../libraries/CoreLib.sol";
import {OperatorLib} from "../libraries/OperatorLib.sol";

import {SSVStorage, StorageData, IERC20} from "../libraries/SSVStorage.sol";
import {SSVStorageProtocol} from "../libraries/SSVStorageProtocol.sol";

import "@openzeppelin/contracts/utils/Counters.sol";

contract SSVProtocolOperators is ISSVProtocolOperators {
    using Types64 for uint64;
    using Types256 for uint256;

    IERC20 public immutable lidoToken;
    address public immutable lidoModuleAddress;

    constructor(IERC20 lidoTokenAddress_, address lidoModuleAddress_) {
        lidoToken = lidoTokenAddress_;
        lidoModuleAddress = lidoModuleAddress_;
    }

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function registerOperator(
        bytes calldata publicKey,
        ProtocolType protocolType,
        uint256 bond,
        address rewardAddress
    ) external override returns (uint64 id) {
        // TODO no on-chain check for the bond amount
        if (rewardAddress != address(0)) revert EmptyRewardAddress();

        uint8 protocolTypeId = uint8(protocolType);
        uint64 shrunkBond = bond.shrink();

        StorageData storage s = SSVStorage.load();

        // In the Webapp, an estimation of the bond required to deposit
        // is made providing an estimation of the number of validators
        // the operator is expecting to manage.
        // But on-chain, the required bond is the minimum to manage 1 validator
        if (shrunkBond < SSVStorageProtocol.load().protocolRequiredBonds[protocolTypeId]) {
            revert ISSVNetworkCore.BondTooLow();
        }

        // A protocol operator can use the same public key
        id = OperatorLib.fetchOperatorId(publicKey, protocolType, s);

        // register the operator
        s.protocolOperators[id][protocolTypeId] = ProtocolOperator({owner: msg.sender, rewardAddress: rewardAddress});

        // register the bond
        s.protocolOperatorBonds[id][protocolTypeId] = Bond({balance: shrunkBond});

        // set the whitelisted address as the protocol's module address
        // and deposit the bond
        if (protocolType == ProtocolType.LIDO) {
            s.operatorsWhitelist[id] = lidoModuleAddress;
            SSVStorageProtocol.load().protocolBondDeposits[protocolTypeId] += shrunkBond;
            CoreLib.deposit(bond, lidoToken);
        }

        emit ProtocolOperatorAdded(id, msg.sender, publicKey, protocolType, bond, rewardAddress);
    }

    function removeOperator(uint64 operatorId, ProtocolType protocolType) external override {
        StorageData storage s = SSVStorage.load();

        // check if the caller is the owner of the operator
        // TODO add check for unexisting operator
        if (s.protocolOperators[operatorId][uint8(protocolType)].owner != msg.sender)
            revert ISSVNetworkCore.CallerNotOwner();

        uint64 currentBalance = s.protocolOperatorBonds[operatorId][uint8(protocolType)].balance;

        // TODO check if we need to maintain the id like with SSV Operators
        delete s.protocolOperators[operatorId][uint8(protocolType)];
        delete s.protocolOperatorBonds[operatorId][uint8(protocolType)];
        delete s.operatorsWhitelist[operatorId];

        if (currentBalance > 0) {
            SSVStorageProtocol.load().protocolBondDeposits[uint8(protocolType)] -= currentBalance;
            _transferBond(operatorId, protocolType, currentBalance.expand());
        }
        emit ProtocolOperatorRemoved(operatorId, protocolType);
    }

    function depositBond(uint64 operatorId, ProtocolType protocolType, uint256 bond) external {
        // check if the caller is the owner of the operator
        // TODO add check for unexisting operator
        if (SSVStorage.load().protocolOperators[operatorId][uint8(protocolType)].owner != msg.sender)
            revert ISSVNetworkCore.CallerNotOwner();

        CoreLib.deposit(bond, _getProtocolToken(protocolType));

        emit ProtocolBondDeposited(operatorId, msg.sender, protocolType, bond);
    }

    function slashBond(uint64 operatorId, ProtocolType protocolType) external override {
        // TODO check auth, who can perform slashing?

        StorageData storage s = SSVStorage.load();

        if (s.protocolOperators[operatorId][uint8(protocolType)].owner == address(0))
            revert ISSVNetworkCore.OperatorDoesNotExist();

        uint64 bond = s.protocolOperatorBonds[operatorId][uint8(protocolType)].balance;

        // TODO determine rules to get slashed
        // and who gets the slashed amount.
        // In this case, as the bond was transferred to the contract,
        // removing the entry from the protocolOperatorBonds means
        // the operator is slashed.
        delete s.protocolOperatorBonds[operatorId][uint8(protocolType)];
        // TODO if we add ProtocolOperator.slashed property
        // s.protocolOperators[operatorId][uint8(protocolType)].slashed = true;
        emit ProtocolOperatorSlashed(operatorId, protocolType, bond.expand());
    }

    function _transferBond(uint64 operatorId, ProtocolType protocolType, uint256 amount) private {
        CoreLib.transferBalance(msg.sender, amount, _getProtocolToken(protocolType));
        emit ProtocolOperatorWithdrawn(operatorId, msg.sender, protocolType, amount);
    }

    function _getProtocolToken(ProtocolType protocolType) private view returns (IERC20 token) {
        if (protocolType == ProtocolType.LIDO) {
            token = lidoToken;
        }
    }
}