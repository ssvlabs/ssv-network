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

    struct Validator {
        bytes32 operatorCollectionId;
        address owner;
        bool active;
    }

    event OperatorAdded(uint64 operatorId, address indexed owner, bytes encryptionPK);
    event OperatorRemoved(uint64 operatorId);
    event OperatorFeeUpdated(uint64 operatorId, uint64 fee);
    event ValidatorAdded(bytes validatorPK, bytes32 groupId,bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorTransfered(bytes32 validatorPK, bytes32 groupId,bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorTransferedArr(bytes32[] validatorPK, bytes32 groupId,bytes sharesPublicKeys, bytes encryptedShares);
    event ValidatorUpdated(bytes validatorPK, bytes32 groupId, bytes[] sharesPublicKeys, bytes[] encryptedShares);
    event ValidatorRemoved(bytes validatorPK, bytes32 groupId);

    // global vars
    Counters.Counter private lastOperatorId;
    Counters.Counter private lastGroupId;

    // operator vars
    mapping(uint64 => Operator) private _operators;
    mapping(bytes32 => OperatorCollection) private _operatorCollections;
    mapping(bytes32 => Group) private _groups;
    mapping(address => uint64) _availableBalances;
    mapping(bytes32 => Validator) _validatorPKs;

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
        _operators[operatorId] = Operator({ owner: msg.sender, earnings: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee});
        emit OperatorAdded(operatorId, msg.sender, encryptionPK);
    }

    function removeOperator(uint64 operatorId) external {
        Operator memory operator = _operators[operatorId];
        require(operator.owner == msg.sender, "not owner");

        uint64 currentBlock = uint64(block.number);

        operator.earnings = _updateOperatorEarnings(operator);
        operator.fee = 0;
        operator.validatorCount = 0;
        _operators[operatorId] = operator;

        emit OperatorRemoved(operatorId);
    }

    function updateOperatorFee(uint64 operatorId, uint64 fee) external {
        Operator memory operator = _operators[operatorId];
        require(operator.owner == msg.sender, "not owner");

        _operators[operatorId] = _setFee(operator, fee);

        emit OperatorFeeUpdated(operatorId, fee);
    }

    function transferValidators(
        bytes32[] calldata validatorPK,
        bytes32 fromGroupId,
        bytes32 toGroupId,
        bytes calldata sharesPublicKeys,
        bytes calldata encryptedShares
    ) external {
        // _validateValidatorParams
        uint64 activeValidatorCount = 0;

        for (uint64 index = 0; index < validatorPK.length; ++index) {
            Validator memory validator = _validatorPKs[validatorPK[index]];
            validator.operatorCollectionId = toGroupId;
            _validatorPKs[validatorPK[index]] = validator;

            if (validator.active) {
                ++activeValidatorCount;
            }
            // Changing to a single event reducing by 15K gas
        }
        emit ValidatorTransferedArr(validatorPK, toGroupId, sharesPublicKeys, encryptedShares);

        uint64[] memory newOperatorIds = _operatorCollections[toGroupId].operatorIds;

        _updateOperatorsValidatorMove(_operatorCollections[fromGroupId].operatorIds, newOperatorIds, activeValidatorCount);

        Group memory group = _groups[keccak256(abi.encodePacked(msg.sender, fromGroupId))];
        group.usage.index = _groupCurrentIndex(fromGroupId);
        group.usage.block = uint64(block.number);
        group.validatorCount -= activeValidatorCount;

        group = _groups[keccak256(abi.encodePacked(msg.sender, toGroupId))];
        group.usage.index = _groupCurrentIndex(toGroupId);
        group.usage.block = uint64(block.number);
        group.validatorCount += activeValidatorCount;

        require(!_liquidatable(group.balance, group.validatorCount, _extractOperators(newOperatorIds)), "account liquidatable");
    }

    function registerValidator(
        uint64[] memory operatorIds,
        bytes calldata validatorPK,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedShares,
        uint64 amount
    ) external {
        _validateValidatorParams(
            validatorPK,
            sharesPublicKeys,
            encryptedShares
        );

        // Operator[] memory operators;
        bytes32 operatorCollectionId;
        {
            {
                operatorCollectionId = getOrCreateOperatorCollection(operatorIds);
                // operators = _extractOperators(operatorIds);
            }

            Group memory group;
            {
                _availableBalances[msg.sender] -= amount;

                group = _groups[keccak256(abi.encodePacked(msg.sender, operatorCollectionId))];
                uint64 groupIndex = _groupCurrentIndex(operatorCollectionId);
                group.balance = _ownerGroupBalance(group, groupIndex) + amount;
                group.usage.index = groupIndex;
                group.usage.block = uint64(block.number);

                ++group.validatorCount;

                // TODO
                // gas issues
                // without: 352641 max, 336957 avg, 321272 min
                // with that: 442985 max, 427300 avg, 411615 min
                /*
                bytes[] memory extendedGroup = new bytes[](group.validatorCount);
                for (uint64 i = 0; i < group.validatorPKs.length; ++i) {
                    extendedGroup[i] = group.validatorPKs[i];
                }
                extendedGroup[group.validatorCount - 1] = validatorPK;
                group.validatorPKs = extendedGroup;
                */
                // group.validatorPKs[validatorPK] = 1;
                // _validatorPKs[msg.sender][validatorPK] = operatorCollectionId;
                /*
                bytes32[] memory data = new bytes32[](2);
                data[0] = bytes32(abi.encodePacked(msg.sender));
                data[1] = operatorCollectionId;
                bytes32 key = keccak256(abi.encodePacked(data));
                _validatorPKs[key][validatorPK] = 1;
                */
            }

            {
                for (uint64 i = 0; i < operatorIds.length; ++i) {
                    Operator memory operator = _operators[operatorIds[i]];
                    operator.earnings = _updateOperatorEarnings(operator);
                    ++operator.validatorCount;
                    _operators[operatorIds[i]] = operator;
                }
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                ++dao.validatorCount;
                _dao = dao;
            }

            // TODO
            require(!_liquidatable(group.balance, group.validatorCount, _extractOperators(operatorIds)), "account liquidatable");
            // list of operators here makes the gas higher
            // without: 352641 max, 336957 avg, 321272 min
            // with that: 364550 max, 348866 avg, 333181 min

            _groups[keccak256(abi.encodePacked(msg.sender, operatorCollectionId))] = group;
        }

        _validatorPKs[keccak256(validatorPK)] = Validator({ owner: msg.sender, operatorCollectionId: operatorCollectionId, active: true});

        emit ValidatorAdded(validatorPK, operatorCollectionId, sharesPublicKeys, encryptedShares);
    }

    function _updateOperatorsValidatorMove(
        uint64[] memory oldOperatorIds,
        uint64[] memory newOperatorIds,
        uint64 validatorCount
    ) private {
        uint64 oldIndex;
        uint64 newIndex;

        while (oldIndex < oldOperatorIds.length && newIndex < newOperatorIds.length) {
            if (oldOperatorIds[oldIndex] < newOperatorIds[newIndex]) {
                Operator memory operator = _operators[oldOperatorIds[oldIndex]];
                operator.earnings = _updateOperatorEarnings(operator);
                operator.validatorCount -= validatorCount;
                _operators[oldOperatorIds[oldIndex]] = operator;
                ++oldIndex;
            } else if (newOperatorIds[newIndex] < oldOperatorIds[oldIndex]) {
                Operator memory operator = _operators[newOperatorIds[newIndex]];
                operator.earnings = _updateOperatorEarnings(operator);
                operator.validatorCount += validatorCount;
                _operators[newOperatorIds[newIndex]] = operator;
                ++newIndex;
            } else {
                ++oldIndex;
                ++newIndex;
            }
        }

        while (oldIndex < oldOperatorIds.length) {
            Operator memory operator = _operators[oldOperatorIds[oldIndex]];
            operator.earnings = _updateOperatorEarnings(operator);
            operator.validatorCount -= validatorCount;
            _operators[oldOperatorIds[oldIndex]] = operator;
            ++oldIndex;
        }

        while (newIndex < newOperatorIds.length) {
            Operator memory operator = _operators[newOperatorIds[newIndex]];
            operator.earnings = _updateOperatorEarnings(operator);
            operator.validatorCount += validatorCount;
            _operators[newOperatorIds[newIndex]] = operator;
            ++newIndex;
        }
    }

    function updateValidator(
        uint64[] memory operatorIds,
        bytes calldata validatorPK,
        bytes32 currentGroupId,
        bytes[] calldata sharesPublicKeys,
        bytes[] calldata encryptedShares,
        uint64 amount
    ) external {
        uint64 currentBlock = uint64(block.number);
        {
            Group memory group;
            {
                group = _groups[keccak256(abi.encodePacked(msg.sender, currentGroupId))];

                uint64 groupIndex = _groupCurrentIndex(currentGroupId);
                group.balance = _ownerGroupBalance(group, groupIndex);
                group.usage.index = groupIndex;
                group.usage.block = currentBlock;
                --group.validatorCount;

                if (group.validatorCount == 0) {
                    // _availableBalances[msg.sender] += _ownerGroupBalance(group, groupIndex);
                    // group.balance -= _ownerGroupBalance(group, groupIndex);
                }
            }

            OperatorCollection memory operatorCollection = _operatorCollections[currentGroupId];
            _updateOperatorsValidatorMove(operatorCollection.operatorIds, operatorIds, 1);
            _groups[keccak256(abi.encodePacked(msg.sender, currentGroupId))] = group;
        }

        bytes32 newGroupId;
        {
            // Operator[] memory newOperators;
            {
                newGroupId = getOrCreateOperatorCollection(operatorIds);
                // newOperators = _extractOperators(operatorIds);
            }

            Group memory group;
            {
                uint64 groupIndex = _groupCurrentIndex(newGroupId);

                _availableBalances[msg.sender] -= amount;

                group = _groups[keccak256(abi.encodePacked(msg.sender, newGroupId))];
                group.balance = _ownerGroupBalance(group, groupIndex) + amount;
                group.usage.index = groupIndex;
                group.usage.block = currentBlock;

                ++group.validatorCount;
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                _dao = dao;
            }

            // TODO
            // require(!_liquidatable(group.balance, group.validatorCount, newOperators), "account liquidatable");
            // list of operators here makes the gas higher
            // without: 353107 max, 315041 avg, 276974 min
            // with that: 365039 max, 326973 avg, 288906 min

            _groups[keccak256(abi.encodePacked(msg.sender, newGroupId))] = group;
        }

        emit ValidatorUpdated(validatorPK, newGroupId, sharesPublicKeys, encryptedShares);
    }

    function removeValidator(
        bytes calldata validatorPK
    ) public {
        bytes32 groupId = _validatorPKs[keccak256(validatorPK)].operatorCollectionId;
        {
            Group memory group = _groups[keccak256(abi.encodePacked(msg.sender, groupId))];
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
                _operators[id].earnings = _updateOperatorEarnings(_operators[id]);
                --_operators[id].validatorCount;
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }

            _groups[keccak256(abi.encodePacked(msg.sender, groupId))] = group;
        }

        emit ValidatorRemoved(validatorPK, groupId);
    }

    function _setFee(Operator memory operator, uint64 fee) private returns (Operator memory) {
        operator.earnings = _updateOperatorEarnings(operator);
        operator.fee = fee;

        return operator;
    }

    function test_getOperatorsByGroupId(bytes32 groupId) external view returns (uint64[] memory) {
        return _operatorCollections[groupId].operatorIds;
    }

    function test_getOperatorBalance(uint64 operatorId) external view returns (uint64) {
        return _operatorCurrentEarnings(_operators[operatorId]);
    }

    function test_operatorCurrentIndex(uint64 operatorId) external view returns (uint64) {
        return _operatorCurrentIndex(_operators[operatorId]);
    }

    function test_groupCurrentIndex(bytes32 groupId) external view returns (uint64) {
        return _groupCurrentIndex(groupId);
    }

    function test_groupBalance(bytes32 groupId) external view returns (uint64) {
        Group memory group = _groups[keccak256(abi.encodePacked(msg.sender, groupId))];
        return _ownerGroupBalance(group, _groupCurrentIndex(groupId));
    }

    /**
     * @dev Validates the paramss for a validator.
     * @param publicKey Validator public key.
     * @param sharesPublicKeys Shares public keys.
     * @param encryptedKeys Encrypted private keys.
     */
    function _validateValidatorParams(
        bytes memory publicKey,
        bytes[] memory sharesPublicKeys,
        bytes[] memory encryptedKeys
    ) private pure {
        /*
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
        */
    }

    // function removeValidator(validatorPK)

    function deposit(uint64 amount) public {
        _availableBalances[msg.sender] += amount;
    }

    function _createOperatorCollection(uint64[] memory operators) private returns (uint64 groupId) {
        for (uint64 index = 0; index < operators.length; ++index) {
            require(_operators[operators[index]].owner != address(0), "operator not found");
        }

        _operatorCollections[keccak256(abi.encodePacked(operators))] = OperatorCollection({ operatorIds: operators });
    }

    /*
    function _updateOperatorIndex(Operator memory operator, uint64 currentBlock) private returns (Snapshot memory) {
        return Snapshot({ index: _operatorCurrentIndex(operator), block: currentBlock, balance:  });
    }
    */

    function getOrCreateOperatorCollection(uint64[] memory operatorIds) public returns (bytes32) { // , OperatorCollection memory
        for (uint64 i = 0; i < operatorIds.length - 1;) {
            require(operatorIds[i] <= operatorIds[++i]);
        }

        bytes32 key = keccak256(abi.encodePacked(operatorIds));

        OperatorCollection storage operatorCollection = _operatorCollections[key];
        if (operatorCollection.operatorIds.length == 0) {
            operatorCollection.operatorIds = operatorIds;
        }

        return key; // (key, operatorCollection);
    }

    function _updateOperatorEarnings(Operator memory operator) private returns (Snapshot memory) {
        operator.earnings.index = _operatorCurrentIndex(operator);
        operator.earnings.balance = _operatorCurrentEarnings(operator);
        operator.earnings.block = uint64(block.number);

        return operator.earnings;
    }

    function _updateDAOEarnings(DAO memory dao) private returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao);
        dao.earnings.block = uint64(block.number);

        return dao;
    }

    function _operatorCurrentEarnings(Operator memory operator) private view returns (uint64) {
        return operator.earnings.balance + (uint64(block.number) - operator.earnings.block) * operator.validatorCount * operator.fee;
    }

    function _extractOperators(uint64[] memory operatorIds) private view returns (Operator[] memory) {
        Operator[] memory operators = new Operator[](operatorIds.length);
        for (uint64 i = 0; i < operatorIds.length; ++i) {
            operators[i] = _operators[operatorIds[i]];
        }
        return operators;
    }

    function _networkTotalEarnings(DAO memory dao) private view returns (uint64) {
        return dao.earnings.balance + (uint64(block.number) - dao.earnings.block) * _networkFee * dao.validatorCount;
    }

    function _networkBalance(DAO memory dao) private view returns (uint64) {
        return _networkTotalEarnings(dao) - dao.withdrawn;
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

    function _liquidatable(uint64 balance, uint64 validatorCount, Operator[] memory operators) private view returns (bool) {
        return balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(operators) + _networkFee) * validatorCount;
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
