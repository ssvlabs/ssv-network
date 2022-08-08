// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

contract SSVRegistryNew {
    using Counters for Counters.Counter;

    struct Snapshot {
        // block is the last block in which last index was set
        uint64 block;
        // index is the last index calculated by index += (currentBlock - block) * fee
        uint64 index;
        // accumulated is all the accumulated earnings, calculated by accumulated + lastIndex * validatorCount
        // uint64 accumulated;
    }

    struct Operator {
        address owner;
        uint64 fee;
        uint64 validatorCount;

        Snapshot earnings;
    }

    struct DAO {
        uint64 validatorCount;
        uint64 withdrawn;

        Snapshot earnings;
    }

    struct OperatorCollection {
        uint64[] operatorIds;
    }

    struct Group {
        uint64 balance;
        uint64 validatorCount;
        uint64 lastIndex;
    }

    struct Owner {
        uint64 earnRate;
        uint64 validatorCount;

        Snapshot earnings;
    }

    event OperatorAdded(uint64 operatorId, address indexed owner, bytes encryptionPK);
    event OperatorRemoved(uint64 operatorId);
    event ValidatorAdded(bytes validatorPK, bytes32 groupId);

    // global vars
    Counters.Counter private lastOperatorId;
    Counters.Counter private lastGroupId;

    // operator vars
    mapping(uint64 => Operator) private _operators;
    mapping(bytes32 => OperatorCollection) private _operatorCollections;
    mapping(address => mapping(bytes32 => Group)) private _groups;
    mapping(address => uint64) _availableBalances;
    mapping(address => Owner) _owners;

    uint64 private _networkFee;
    uint64 constant LIQUIDATION_MIN_BLOCKS = 50;
    // uint64 constant NETWORK_FEE_PER_BLOCK = 1;

    DAO private _dao;
    IERC20 private _token;

    constructor() public {
    }

    function registerOperator(
        bytes calldata encryptionPK,
        uint64 fee
    ) external returns (uint64 operatorId) {
        require(fee > 0);

        lastOperatorId.increment();
        operatorId = uint64(lastOperatorId.current());
        _operators[operatorId] = Operator({ owner: msg.sender, earnings: Snapshot({ block: uint64(block.number), index: 0}), validatorCount: 0, fee: fee });

        emit OperatorAdded(operatorId, msg.sender, encryptionPK);
    }

    function removeOperator(uint64 operatorId) external {
        Operator memory operator = _operators[operatorId];
        require(operator.owner == msg.sender, "not owner");

        uint64 currentBlock = uint64(block.number);

        Owner memory owner = _owners[operator.owner];
        owner.earnings = _updateOwnerEarnings(owner, currentBlock);
        owner.earnRate -= operator.fee * operator.validatorCount;
        _owners[operator.owner] = owner;

        _operators[operatorId] = _setFee(operator, 0, currentBlock);
        operator.validatorCount = 0;

        emit OperatorRemoved(operatorId);
    }

    function _createOperatorCollection(uint64[] memory operators) private returns (uint64 groupId) {
        for (uint64 index = 0; index < operators.length; ++index) {
            require(_operators[operators[index]].owner != address(0), "operator not found");
        }

        _operatorCollections[keccak256(abi.encodePacked(operators))] = OperatorCollection({ operatorIds: operators });
    }

    function registerValidator(
        uint64[] memory operatorIds,
        bytes calldata validatorPK,
        bytes[] calldata encryptedShares,
        bytes[] calldata sharesPK,
        uint64 amount
    ) external {
        bytes32 groupId;
        {
            Operator[] memory operators;
            {
                OperatorCollection memory operatorCollection;
                (groupId, operatorCollection) = _getOrCreateOperatorCollection(operatorIds);
                 operators = _extractOperators(operatorCollection);
            }

            Group memory group;
            {
                uint64 groupIndex = _groupCurrentIndex(operators);

                _availableBalances[msg.sender] -= amount;

                group = _groups[msg.sender][groupId];

                group.balance = _ownerGroupBalance(group, groupIndex) + amount;
                group.lastIndex = groupIndex;
                ++group.validatorCount;
            }

            uint64 currentBlock = uint64(block.number);
            {
                for (uint64 i = 0; i < operators.length; ++i) {
                    Owner memory owner = _owners[operators[i].owner];
                    owner.earnings = _updateOwnerEarnings(owner, currentBlock);
                    ++owner.validatorCount;
                    owner.earnRate += operators[i].fee;
                    _owners[operators[i].owner] = owner;
                }
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao, uint64(block.number));
                ++dao.validatorCount;
                _dao = dao;
            }

            require(!_liquidatable(group.balance, group.validatorCount, operators), "account liquidatable");

            _groups[msg.sender][groupId] = group;
        }

        emit ValidatorAdded(validatorPK, groupId);
    }

    // function removeValidator(validatorPK)

    function deposit(uint64 amount) public {
        _availableBalances[msg.sender] += amount;
    }

    function _setFee(Operator memory operator, uint64 fee, uint64 currentBlock) private returns (Operator memory) {
        operator.earnings = _updateOperatorIndex(operator, currentBlock);
        operator.fee = fee;

        return operator;
    }

    function _updateOperatorIndex(Operator memory operator, uint64 currentBlock) private returns (Snapshot memory) {
        return Snapshot({ index: _operatorCurrentIndex(operator), block: currentBlock });
    }

    function _getOrCreateOperatorCollection(uint64[] memory operatorIds) private returns (bytes32, OperatorCollection memory) {
        for (uint64 i = 0; i < operatorIds.length - 1;) {
            require(operatorIds[i] <= operatorIds[++i]);
        }

        bytes32 key = keccak256(abi.encodePacked(operatorIds));

        OperatorCollection storage operatorCollection = _operatorCollections[key];
        if (operatorCollection.operatorIds.length == 0) {
            operatorCollection.operatorIds = operatorIds;
        }

        return (key, operatorCollection);
    }

    function _updateOwnerEarnings(Owner memory owner, uint64 currentBlock) private returns (Snapshot memory) {
        owner.earnings.index = _ownerCurrentEarnings(owner, currentBlock);
        owner.earnings.block = currentBlock;

        return owner.earnings;
    }

    function _updateDAOEarnings(DAO memory dao, uint64 currentBlock) private returns (DAO memory) {
        dao.earnings.index = _networkTotalEarnings(dao, currentBlock);
        dao.earnings.block = currentBlock;

        return dao;
    }

    function _ownerCurrentEarnings(Owner memory owner, uint64 currentBlock) private returns (uint64) {
        return owner.earnings.index + (currentBlock - owner.earnings.block) * owner.earnRate;
    }

    function _extractOperators(OperatorCollection memory operatorCollection) private view returns (Operator[] memory) {
        Operator[] memory operators = new Operator[](operatorCollection.operatorIds.length);
        for (uint64 i = 0; i < operatorCollection.operatorIds.length; ++i) {
            operators[i] = _operators[operatorCollection.operatorIds[i]];
        }

        return operators;
    }

    function _networkTotalEarnings(DAO memory dao, uint64 currentBlock) private view returns (uint64) {
        return dao.earnings.index + (currentBlock - dao.earnings.block) * _networkFee * dao.validatorCount;
    }

    function _networkBalance(DAO memory dao, uint64 currentBlock) private view returns (uint64) {
        return _networkTotalEarnings(dao, currentBlock) - dao.withdrawn;
    }

    function _groupCurrentIndex(Operator[] memory operators) private view returns (uint64 groupIndex) {
        for (uint64 i = 0; i < operators.length; ++i) {
            groupIndex += _operatorCurrentIndex(operators[i]);
        }
    }

    function _operatorCurrentIndex(Operator memory operator) private view returns (uint64) {
        return operator.earnings.index + (uint64(block.number) - operator.earnings.block) * operator.fee;
    }

    function _ownerGroupBalance(Group memory group, uint64 currentGroupIndex) private pure returns (uint64) {
        return group.balance - (currentGroupIndex - group.lastIndex) * group.validatorCount;
    }

    function _burnRatePerValidator(Operator[] memory operators) private pure returns (uint64 rate) {
        for (uint64 i = 0; i < operators.length; ++i) {
            rate += operators[i].fee;
        }
    }

    function _liquidatable(uint64 balance, uint64 validatorCount, Operator[] memory operators) private view returns (bool) {
        return balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(operators) + _networkFee) * validatorCount;
    }

    function liquidate(address owner, bytes32 groupId) external {
        OperatorCollection memory operatorCollection = _operatorCollections[groupId];
        Operator[] memory operators = new Operator[](operatorCollection.operatorIds.length);
        for (uint64 i = 0; i < operatorCollection.operatorIds.length; ++i) {
            operators[i] = _operators[operatorCollection.operatorIds[i]];
        }
        uint64 groupIndex = _groupCurrentIndex(operators);
        Group memory group = _groups[owner][groupId];
        uint64 balance = _ownerGroupBalance(group, groupIndex);
        require(_liquidatable(balance, group.validatorCount, operators));
        _availableBalances[msg.sender] += balance;
        uint64 currentBlock = uint64(block.number);
        {
            for (uint64 i = 0; i < operators.length; ++i) {
                Owner memory owner = _owners[operators[i].owner];
                owner.earnings = _updateOwnerEarnings(owner, currentBlock);
                owner.earnRate -= operators[i].fee;
                --owner.validatorCount;
                _owners[operators[i].owner] = owner;
            }
        }
    }

//    function addOperatorToValidator(
//    function _validateRegistryState(
//        uint64[] memory usedOperators,
//        uint64[] memory validatorCnt,
//    bytes32 root
//    ) private view {
//        require(_registryStateRoot(usedOperators, validatorCnt) == root, "operator registry hash invalid");
//    }
//
//    uint16 constant OPERATORS_INDX = 0;
//    uint16 constant OPERATORS_CNT_INDX = 1;
//    uint16 constant USED_OPERATORS_INDX = 2;
//    uint16 constant SHARES_PK_INDX = 0;
//    uint16 constant ENCRYPTED_SHARES_INDX = 1;
//    function registerValidator(
//        uint64[][] memory db,
//        bytes calldata validatorPK,
//        bytes[][] calldata shares
//    ) external {
//        uint64 currentBlock = uint64(block.number);
//        Validator memory validator = validators[msg.sender];
//        DAO memory _dao = dao;
//
//        _validateRegistryState(db[OPERATORS_INDX], db[OPERATORS_CNT_INDX], validator.operatorRegistryHash);
//
//        for (uint64 index = 0; index < db[USED_OPERATORS_INDX].length; ++index) {
//            uint64 id = db[OPERATORS_INDX][db[USED_OPERATORS_INDX][index]];
//            // update and save operator
//            uint64 operatorLastIndex = _updateOperatorCurrentIndex(id, currentBlock);
//
//            // update operator in use
//            validator.aggregatedIndex.lastIndex += operatorLastIndex;
//            db[1][db[USED_OPERATORS_INDX][index]] ++;
//        }
//        validator.aggregatedIndex.validatorCount ++;
//        validator.operatorRegistryHash = _registryStateRoot(db[OPERATORS_INDX], db[OPERATORS_CNT_INDX]);
//
//        // update DAO earnings
//        uint64 indexChange = (currentBlock - _dao.index.block)*NETWORK_FEE_PER_BLOCK;
//        _dao.index.lastIndex += indexChange;
//        _dao.index.block = currentBlock;
//        _dao.index.accumulated += indexChange * _dao.index.validatorCount;
//        _dao.index.validatorCount++;
//        // update validator DAO debt
//        validator.aggregatedIndex.lastIndex += _dao.index.lastIndex;
//
//        // save to storage
//        validators[msg.sender] = validator;
//        dao = _dao;
//
////        require(_liquidatable(validator, db, _dao.index.lastIndex, currentBlock) == false, "not enough ssv in balance");
//
//        emit ValidatorAdded(validatorPK);
//    }
//
//    function daoCurrentIndex(DAO memory _dao, uint64 currentBlock) private view returns (uint64) {
//        return _dao.index.lastIndex + (currentBlock - _dao.index.block)*NETWORK_FEE_PER_BLOCK;
//    }
//

// //    function liquidatable(
// //        address account,
// //        uint64[][] calldata db
// //    ) public view returns (bool) {
// //        Validator memory validator = validators[account];
// //        uint64 currentBlock = uint64(block.number);
// //        uint64 daoIndex = daoCurrentIndex(dao, currentBlock);
// //        return _liquidatable(validator, db, daoIndex, currentBlock);
// //    }
// //
//     function balanceOf() public view returns (uint64) {
//         return 1000000; // hard coded for now
//     }

//     function _validatorLifetimeCost(
//         DebtIndex memory debtIndex,
//         uint64[] memory usedOperators,
//         uint64 validatorCnt,
//         uint64 daoCurrentIndex,
//         uint64 currentBlock
//     ) private view returns (uint64) {
//         uint64 aggregatedCurrentIndex = 0;

//         for (uint256 index = 0; index < usedOperators.length; ++index) {
//             uint64 operatorId = usedOperators[index];
//             Operator memory operator = _operators[usedOperators[index]];
//             aggregatedCurrentIndex += operatorCurrentIndex(operator, currentBlock) * validatorCnt;
//         }

//         aggregatedCurrentIndex += daoCurrentIndex * validatorCnt;
//         uint64 accumulatedCost = debtIndex.accumulated + (aggregatedCurrentIndex - debtIndex.lastIndex);

//         return accumulatedCost;
//     }
}
