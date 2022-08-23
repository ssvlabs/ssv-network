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
        uint64 balance;
    }

    struct Operator {
        address owner;
        uint64 fee;
        uint64 validatorCount;
        uint64 earnRate;

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
        Snapshot usage;
    }

    event OperatorAdded(uint64 operatorId, address indexed owner, bytes encryptionPK);
    event OperatorRemoved(uint64 operatorId);
    event OperatorFeeUpdated(uint64 operatorId, uint64 fee);
    event ValidatorAdded(bytes validatorPK, bytes32 groupId,bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorTransfered(bytes32 ipfsHash, bytes32 groupId);  // , bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorUpdated(bytes validatorPK, bytes32 groupId, bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorRemoved(bytes validatorPK, bytes32 groupId);

    // global vars
    Counters.Counter private lastOperatorId;
    Counters.Counter private lastGroupId;

    // operator vars
    mapping(uint64 => Operator) private _operators;
    mapping(bytes32 => OperatorCollection) private _operatorCollections;
    mapping(address => mapping(bytes32 => Group)) private _groups;
    mapping(address => uint64) _availableBalances;
    mapping(address => mapping(bytes => bytes32)) private _validatorPKs;

    uint64 private _networkFee;
    uint64 constant LIQUIDATION_MIN_BLOCKS = 50;
    // uint64 constant NETWORK_FEE_PER_BLOCK = 1;

    /** errors */
    error InvalidPublicKeyLength();
    error OessDataStructureInvalid();
    error ValidatorNotExistInGroup();

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
        _operators[operatorId] = Operator({ owner: msg.sender, earnings: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee, earnRate: 0 });
        emit OperatorAdded(operatorId, msg.sender, encryptionPK);
    }

    function removeOperator(uint64 operatorId) external {
        Operator memory operator = _operators[operatorId];
        require(operator.owner == msg.sender, "not owner");

        uint64 currentBlock = uint64(block.number);

        operator.earnings = _updateOperatorEarnings(operator, currentBlock);
        operator.earnRate = 0;
        operator.fee = 0;
        operator.validatorCount = 0;
        _operators[operatorId] = operator;

        emit OperatorRemoved(operatorId);
    }

    function updateOperatorFee(uint64 operatorId, uint64 fee) external {
        Operator memory operator = _operators[operatorId];
        require(operator.owner == msg.sender, "not owner");

        uint64 currentBlock = uint64(block.number);

        _operators[operatorId] = _setFee(operator, fee, currentBlock); 

        emit OperatorFeeUpdated(operatorId, fee);
    }

    /*
    function transferValidator(
        // bytes calldata validatorPK,
        bytes32 ipfsHash,
        bytes32 groupId
        // bytes[] calldata sharesPublicKeys,
        // bytes[] calldata encryptedShares
    ) external {
        for (uint64 i = 0; i < 100; ++i) {
            emit ValidatorTransfered(ipfsHash, groupId);
            // _validatorPKs[msg.sender][validatorPK] = groupId;
        }
    }
    */

    function registerValidator(
        uint64[] memory operatorIds,
        bytes calldata validatorPK,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedShares,
        uint64 amount
    ) external {
        _validateValidatorParams(
            validatorPK,
            operatorIds,
            sharesPublicKeys,
            encryptedShares
        );

        bytes32 groupId = _getOrCreateOperatorCollection(operatorIds);

        {
            Group memory group;
            {
                _availableBalances[msg.sender] -= amount;
                group = _updateGroupData(groupId, amount, true);
                _validatorPKs[msg.sender][validatorPK] = groupId;
            }

            {
                _updateOperatorsData(operatorIds, true);
            }

            {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao, uint64(block.number));
                ++dao.validatorCount;
                _dao = dao;
            }

            require(!_liquidatable(group.balance, group.validatorCount, operatorIds), "account liquidatable");
            _groups[msg.sender][groupId] = group;
        }

        emit ValidatorAdded(validatorPK, groupId, sharesPublicKeys, encryptedShares);
    }

    function updateValidator(
        uint64[] memory operatorIds,
        bytes calldata validatorPK,
        bytes32 groupId,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedShares,
        uint64 amount
    ) external {

        if (_validatorPKs[msg.sender][validatorPK] != groupId) {
            revert ValidatorNotExistInGroup();
        }

        _groups[msg.sender][groupId] = _updateGroupData(groupId, 0, false);

        {
            OperatorCollection memory operatorCollection = _operatorCollections[groupId];
            _updateOperatorsData(operatorCollection.operatorIds, false);
            _updateOperatorsData(operatorIds, true);
        }


        bytes32 newGroupId = _getOrCreateOperatorCollection(operatorIds);
        {
            Group memory group;
            {
                _availableBalances[msg.sender] -= amount;
                group = _updateGroupData(newGroupId, amount, true);
                _validatorPKs[msg.sender][validatorPK] = newGroupId;
            }

            {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao, uint64(block.number));
                _dao = dao;
            }

            require(!_liquidatable(group.balance, group.validatorCount, operatorIds), "account liquidatable");
            _groups[msg.sender][newGroupId] = group;
        }

        emit ValidatorUpdated(validatorPK, newGroupId, sharesPublicKeys, encryptedShares);
    }

    function removeValidator(
        bytes calldata validatorPK,
        bytes32 groupId
    ) external {
        if (_validatorPKs[msg.sender][validatorPK] != groupId) {
            revert ValidatorNotExistInGroup();
        }

        {
            Group memory group = _groups[msg.sender][groupId];
            OperatorCollection memory operatorCollection = _operatorCollections[groupId];
            uint64 currentBlock = uint64(block.number);

            uint64 groupIndex = _groupCurrentIndex(groupId);
            group.balance = _ownerGroupBalance(group, groupIndex);
            group.usage.index = groupIndex;
            group.usage.block = currentBlock;
            --group.validatorCount;

            if (group.validatorCount == 0) {
                // _availableBalances[msg.sender] += _ownerGroupBalance(group, groupIndex);
                // group.balance -= _ownerGroupBalance(group, groupIndex);
            }

            for (uint64 i = 0; i < operatorCollection.operatorIds.length; ++i) {
                uint64 id = operatorCollection.operatorIds[i];
                _operators[id].earnings = _updateOperatorEarnings(_operators[id], currentBlock);
                _operators[id].earnRate -= _operators[id].fee;
                --_operators[id].validatorCount;
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao, uint64(block.number));
                --dao.validatorCount;
                _dao = dao;
            }

            _groups[msg.sender][groupId] = group;
        }

        emit ValidatorRemoved(validatorPK, groupId);
    }

    function _setFee(Operator memory operator, uint64 fee, uint64 currentBlock) private returns (Operator memory) {
        operator.earnings = _updateOperatorEarnings(operator, currentBlock);
        operator.earnRate = operator.validatorCount * fee;
        operator.fee = fee;

        return operator;
    }

    function _updateOperatorsData(uint64[] memory operatorIds, bool increase) private {
        uint64 currentBlock = uint64(block.number);
        for (uint64 i = 0; i < operatorIds.length; ++i) {
            Operator memory operator = _operators[operatorIds[i]];
            operator.earnings = _updateOperatorEarnings(operator, currentBlock);
            if (increase) {
                operator.earnRate += operator.fee;
                ++operator.validatorCount;
            } else {
                operator.earnRate -= operator.fee;
                --operator.validatorCount;
            }
            _operators[operatorIds[i]] = operator;
        }
    }

    function _updateGroupData(bytes32 groupId, uint64 amount, bool increase) private returns (Group memory) {
        Group memory group = _groups[msg.sender][groupId];
        uint64 currentBlock = uint64(block.number);
        uint64 groupIndex = _groupCurrentIndex(groupId);
        group.balance = _ownerGroupBalance(group, groupIndex) + amount;
        group.usage.index = groupIndex;
        group.usage.block = currentBlock;
        if (increase) {
            ++group.validatorCount;
        } else {
            --group.validatorCount;
        }

        if (group.validatorCount == 0) {
            // _availableBalances[msg.sender] += _ownerGroupBalance(group, groupIndex);
            // group.balance -= _ownerGroupBalance(group, groupIndex);
        }
        return group;
    }


    function test_getOperatorsByGroupId(bytes32 groupId) external view returns (uint64[] memory) {
        return _operatorCollections[groupId].operatorIds;
    }

    function test_getOperatorBalance(uint64 operatorId) external view returns (uint64) {
        return _operatorCurrentEarnings(_operators[operatorId], uint64(block.number));
    }

    function test_operatorCurrentIndex(uint64 operatorId) external view returns (uint64) {
        return _operatorCurrentIndex(_operators[operatorId]);
    }

    function test_groupCurrentIndex(bytes32 groupId) external view returns (uint64) {
        return _groupCurrentIndex(groupId);
    }

    function test_groupBalance(bytes32 groupId) external view returns (uint64) {
        Group memory group = _groups[msg.sender][groupId];
        return _ownerGroupBalance(group, _groupCurrentIndex(groupId));
    }

    /**
     * @dev Validates the paramss for a validator.
     * @param publicKey Validator public key.
     * @param operatorIds Operator operatorIds.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function _validateValidatorParams(
        bytes memory publicKey,
        uint64[] memory operatorIds,
        bytes[] memory sharesPublicKeys,
        bytes[] memory encryptedKeys
    ) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
        if (
            operatorIds.length != sharesPublicKeys.length ||
            operatorIds.length != encryptedKeys.length ||
            operatorIds.length < 4 || operatorIds.length % 3 != 1
        ) {
            revert OessDataStructureInvalid();
        }
    }

    function deposit(uint64 amount) public {
        _availableBalances[msg.sender] += amount;
    }

    function _createOperatorCollection(uint64[] memory operators) private returns (uint64 groupId) {
        for (uint64 index = 0; index < operators.length; ++index) {
            require(_operators[operators[index]].owner != address(0), "operator not found");
        }

        _operatorCollections[keccak256(abi.encodePacked(operators))] = OperatorCollection({ operatorIds: operators });
    }

    function _getOrCreateOperatorCollection(uint64[] memory operatorIds) private returns (bytes32) { // , OperatorCollection memory
        for (uint64 i = 0; i < operatorIds.length - 1;) {
            require(operatorIds[i] <= operatorIds[++i]);
        }

        bytes32 key = keccak256(abi.encodePacked(operatorIds));

        OperatorCollection storage operatorCollection = _operatorCollections[key];
        if (operatorCollection.operatorIds.length == 0) {
            operatorCollection.operatorIds = operatorIds;
        }

        return key;
    }

    function _updateOperatorEarnings(Operator memory operator, uint64 currentBlock) private returns (Snapshot memory) {
        operator.earnings.index = _operatorCurrentIndex(operator);
        operator.earnings.balance = _operatorCurrentEarnings(operator, currentBlock);
        operator.earnings.block = currentBlock;

        return operator.earnings;
    }

    function _updateDAOEarnings(DAO memory dao, uint64 currentBlock) private returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao, currentBlock);
        dao.earnings.block = currentBlock;

        return dao;
    }

    function _operatorCurrentEarnings(Operator memory operator, uint64 currentBlock) private view returns (uint64) {
        return operator.earnings.balance + (currentBlock - operator.earnings.block) * operator.earnRate;
    }

    function _extractOperators(uint64[] memory operatorIds) private view returns (Operator[] memory) {
        Operator[] memory operators = new Operator[](operatorIds.length);
        for (uint64 i = 0; i < operatorIds.length; ++i) {
            operators[i] = _operators[operatorIds[i]];
        }
        return operators;
    }

    function _networkTotalEarnings(DAO memory dao, uint64 currentBlock) private view returns (uint64) {
        return dao.earnings.balance + (currentBlock - dao.earnings.block) * _networkFee * dao.validatorCount;
    }

    function _networkBalance(DAO memory dao, uint64 currentBlock) private view returns (uint64) {
        return _networkTotalEarnings(dao, currentBlock) - dao.withdrawn;
    }

    function _groupCurrentIndex(bytes32 groupId) private view returns (uint64 groupIndex) {
        OperatorCollection memory operatorCollection = _operatorCollections[groupId];
        for (uint64 i = 0; i < operatorCollection.operatorIds.length; ++i) {
            groupIndex += _operatorCurrentIndex(_operators[operatorCollection.operatorIds[i]]);
        }
    }

    function _operatorCurrentIndex(Operator memory operator) private view returns (uint64) {
        return operator.earnings.index + (uint64(block.number) - operator.earnings.block) * operator.fee;
    }

    function _ownerGroupBalance(Group memory group, uint64 currentGroupIndex) private view returns (uint64) {
        return group.balance - (currentGroupIndex - group.usage.index) * group.validatorCount;
    }

    function _burnRatePerValidator(Operator[] memory operators) private pure returns (uint64 rate) {
        for (uint64 i = 0; i < operators.length; ++i) {
            rate += operators[i].fee;
        }
    }

    function _liquidatable(uint64 balance, uint64 validatorCount, uint64[] memory operatorIds) private view returns (bool) {
        return balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(_extractOperators(operatorIds)) + _networkFee) * validatorCount;
    }

    /*
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
                operators[i].earnings = _updateOperatorEarnings(operators[i], currentBlock);
                operators[i].earnRate -= operators[i].fee;
                --operators[i].validatorCount;
            }
        }
    }
    */

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
