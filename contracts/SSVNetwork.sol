// File: contracts/SSVRegistry.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.2;

import "./ISSVNetwork.sol";

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "hardhat/console.sol";

contract SSVNetwork is OwnableUpgradeable, ISSVNetwork {

    using Counters for Counters.Counter;

    struct Snapshot {
        /// @dev block is the last block in which last index was set
        uint64 block;
        /// @dev index is the last index calculated by index += (currentBlock - block) * fee
        uint64 index;
        /// @dev accumulated is all the accumulated earnings, calculated by accumulated + lastIndex * validatorCount
        uint64 balance;
    }

    struct Operator {
        address owner;
        uint64 fee;
        uint64 validatorCount;

        Snapshot snapshot;
    }

    struct OperatorFeeChangeRequest {
        uint64 fee;
        uint256 approvalBeginTime;
        uint256 approvalEndTime;
    }

    struct DAO {
        uint64 validatorCount;
        uint64 withdrawn;

        Snapshot earnings;
    }

    struct Cluster {
        uint64[] operatorIds;
    }

    struct Pod {
        uint64 balance;
        uint64 validatorCount;
        Snapshot usage;
    }

    struct Validator {
        bytes32 clusterId;
        address owner;
        bool active;
    }

    // global vars
    Counters.Counter private lastOperatorId;
    Counters.Counter private lastPodId;

    // operator vars
    mapping(uint64 => Operator) private _operators;
    mapping(uint64 => OperatorFeeChangeRequest) private _operatorFeeChangeRequests;
    mapping(bytes32 => Cluster) private _clusters;
    mapping(bytes32 => Pod) private _pods;
    mapping(address => uint64) _availableBalances;
    mapping(bytes32 => Validator) _validatorPKs;

    uint64 private _networkFee;
    uint256 private _declareOperatorFeePeriod;
    uint256 private _executeOperatorFeePeriod;
    uint64 private _operatorMaxFeeIncrease;

    uint64 constant LIQUIDATION_MIN_BLOCKS = 50;
    uint64 constant MINIMAL_OPERATOR_FEE = 1000;

    // uint64 constant NETWORK_FEE_PER_BLOCK = 1;


    DAO private _dao;
    IERC20 private _token;

    function initialize(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint256 declareOperatorFeePeriod_,
        uint256 executeOperatorFeePeriod_
    ) external override {
        __SSVNetwork_init(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint256 declareOperatorFeePeriod_,
        uint256 executeOperatorFeePeriod_
    ) internal initializer {
        __Ownable_init_unchained();
        __SSVNetwork_init_unchained(token_, operatorMaxFeeIncrease_, declareOperatorFeePeriod_, executeOperatorFeePeriod_);
    }

    function __SSVNetwork_init_unchained(
        IERC20 token_,
        uint64 operatorMaxFeeIncrease_,
        uint256 declareOperatorFeePeriod_,
        uint256 executeOperatorFeePeriod_
    ) internal onlyInitializing {
        _token = token_;
        _updateOperatorFeeIncreaseLimit(operatorMaxFeeIncrease_);
        _updateDeclareOperatorFeePeriod(declareOperatorFeePeriod_);
        _updateDeclareOperatorFeePeriod(declareOperatorFeePeriod_);
        _updateExecuteOperatorFeePeriod(executeOperatorFeePeriod_);
    }

    modifier onlyOperatorOwnerOrContractOwner(uint64 operatorId) {
        _onlyOperatorOwnerOrContractOwner(operatorId);
        _;
    }

    function registerOperator(
        bytes calldata encryptionPK,
        uint64 fee
    ) external returns (uint64 id) {
        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        lastOperatorId.increment();
        id = uint64(lastOperatorId.current());
        _operators[id] = Operator({ owner: msg.sender, snapshot: Snapshot({ block: uint64(block.number), index: 0, balance: 0}), validatorCount: 0, fee: fee});
        emit OperatorAdded(id, msg.sender, encryptionPK);
    }

    function removeOperator(uint64 operatorId) external {
        Operator memory operator = _operators[operatorId];
        if (operator.owner != msg.sender) revert CallerNotOwner();

        uint64 currentBlock = uint64(block.number);

        operator.snapshot = _getSnapshot(operator, currentBlock);
        operator.fee = 0;
        operator.validatorCount = 0;
        _operators[operatorId] = operator;

        emit OperatorRemoved(operatorId);
    }

    function declareOperatorFee(uint64 operatorId, uint64 fee) onlyOperatorOwnerOrContractOwner(operatorId) external {
        Operator memory operator = _operators[operatorId];

        if (fee < MINIMAL_OPERATOR_FEE) {
            revert FeeTooLow();
        }

        if (fee > operator.fee * (100 + _operatorMaxFeeIncrease) / 100) {
            revert FeeExceedsIncreaseLimit();
        }

        /*
        if (operatorFee <= operator.fee) {
            _updateOperatorFeeUnsafe(operatorId, operatorFee);
        } else {
        */
        _operatorFeeChangeRequests[operatorId] = OperatorFeeChangeRequest(
            fee,
            block.timestamp + _declareOperatorFeePeriod,
            block.timestamp + _declareOperatorFeePeriod + _executeOperatorFeePeriod
        );
        emit OperatorFeeDeclaration(msg.sender, operatorId, block.number, fee);
    }

    function cancelDeclaredOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        delete _operatorFeeChangeRequests[operatorId];

        emit DeclaredOperatorFeeCancelation(msg.sender, operatorId);
    }

    function executeOperatorFee(uint64 operatorId) onlyOperatorOwnerOrContractOwner(operatorId) external {
        OperatorFeeChangeRequest memory feeChangeRequest = _operatorFeeChangeRequests[operatorId];

        if(feeChangeRequest.fee == 0) {
            revert NoPendingFeeChangeRequest();
        }

        if(block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime) {
            revert ApprovalNotWithinTimeframe();
        }

        _updateOperatorFeeUnsafe(operatorId, feeChangeRequest.fee);

        delete _operatorFeeChangeRequests[operatorId];
    }

    function registerValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        uint64 amount
    ) external {
        _validateValidatorParams(
            operatorIds,
            publicKey
        );

        // Operator[] memory operators;
        bytes32 clusterId = _getOrCreateCluster(operatorIds);
        {
            Pod memory pod;
            _availableBalances[msg.sender] -= amount;
            pod = _updatePodData(clusterId, amount, true);

            {
                for (uint64 i = 0; i < operatorIds.length; ++i) {
                    Operator memory operator = _operators[operatorIds[i]];
                    operator.snapshot = _getSnapshot(operator, uint64(block.number));
                    ++operator.validatorCount;
                    _operators[operatorIds[i]] = operator;
                }
            }

            {
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                ++dao.validatorCount;
                _dao = dao;
            }

            require(!_liquidatable(pod.balance, pod.validatorCount, operatorIds), "account liquidatable");

            _pods[keccak256(abi.encodePacked(msg.sender, clusterId))] = pod;
        }

        _validatorPKs[keccak256(publicKey)] = Validator({ owner: msg.sender, clusterId: clusterId, active: true});

        emit ValidatorAdded(publicKey, clusterId, shares);
    }

    function transferValidator(
        bytes calldata publicKey,
        uint64[] memory operatorIds,
        bytes calldata shares,
        uint64 amount
    ) external {
        uint64 currentBlock = uint64(block.number);
        bytes32 clusterId = _validatorPKs[keccak256(publicKey)].clusterId;

        if (_validatorPKs[keccak256(publicKey)].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        {
            _pods[keccak256(abi.encodePacked(msg.sender, clusterId))] = _updatePodData(clusterId, 0, false);
            // if (pod.validatorCount == 0) {
            // _availableBalances[msg.sender] += _ownerPodBalance(pod, podIndex);
            // pod.balance -= _ownerPodBalance(pod, podIndex);
            // }
        }

        {
            Cluster memory cluster = _clusters[clusterId];
            _updateOperatorsValidatorMove(cluster.operatorIds, operatorIds, 1);
        }

        {
            bytes32 newClusterId = _getOrCreateCluster(operatorIds);

            {
                Pod memory pod;
                {
                    _availableBalances[msg.sender] -= amount;

                    _pods[keccak256(abi.encodePacked(msg.sender, newClusterId))] = _updatePodData(newClusterId, amount, true);
                    _validatorPKs[keccak256(publicKey)].clusterId = newClusterId;
                }

                {
                    DAO memory dao = _dao;
                    dao = _updateDAOEarnings(dao);
                    _dao = dao;
                }

                require(!_liquidatable(pod.balance, pod.validatorCount, operatorIds), "account liquidatable");
            }

            emit ValidatorTransferred(publicKey, newClusterId, shares);
        }
    }

    function removeValidator(
        bytes calldata validatorPK
    ) external {
        if (_validatorPKs[keccak256(validatorPK)].owner != msg.sender) {
            revert ValidatorNotOwned();
        }

        bytes32 clusterId = _validatorPKs[keccak256(validatorPK)].clusterId;

        {
            Pod memory pod = _pods[keccak256(abi.encodePacked(msg.sender, clusterId))];
            Cluster memory cluster = _clusters[clusterId];
            uint64 currentBlock = uint64(block.number);

            uint64 podIndex = _clusterCurrentIndex(clusterId);
            pod.balance = _ownerPodBalance(pod, podIndex);
            pod.usage.index = podIndex;
            pod.usage.block = currentBlock;
            --pod.validatorCount;

            if (pod.validatorCount == 0) {
                // _availableBalances[msg.sender] += _ownerPodBalance(pod, podIndex);
                // pod.balance -= _ownerPodBalance(pod, podIndex);
            }


            for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
                uint64 id = cluster.operatorIds[i];
                _operators[id].snapshot = _getSnapshot(_operators[id], uint64(block.number));
                --_operators[id].validatorCount;
            }

            {
                // // update DAO earnings
                DAO memory dao = _dao;
                dao = _updateDAOEarnings(dao);
                --dao.validatorCount;
                _dao = dao;
            }

            _pods[keccak256(abi.encodePacked(msg.sender, clusterId))] = pod;
        }

        emit ValidatorRemoved(validatorPK, clusterId);
    }

    function bulkTransferValidators(
        bytes[] calldata validatorPK,
        bytes32 fromPodId,
        bytes32 toPodId,
        bytes[] calldata shares
    ) external {
        // _validateValidatorParams
        uint64 activeValidatorCount = 0;

        for (uint64 index = 0; index < validatorPK.length; ++index) {
            Validator memory validator = _validatorPKs[keccak256(validatorPK[index])];

            if (validator.owner != msg.sender) {
                revert ValidatorNotOwned();
            }

            validator.clusterId = toPodId;
            _validatorPKs[keccak256(validatorPK[index])] = validator;

            if (validator.active) {
                ++activeValidatorCount;
            }
            // Changing to a single event reducing by 15K gas
        }
        emit BulkValidatorTransferred(validatorPK, toPodId, shares);

        uint64[] memory newOperatorIds = _clusters[toPodId].operatorIds;

        _updateOperatorsValidatorMove(_clusters[fromPodId].operatorIds, newOperatorIds, activeValidatorCount);

        Pod memory pod = _pods[keccak256(abi.encodePacked(msg.sender, fromPodId))];
        pod.usage.index = _clusterCurrentIndex(fromPodId);
        pod.usage.block = uint64(block.number);
        pod.validatorCount -= activeValidatorCount;

        pod = _pods[keccak256(abi.encodePacked(msg.sender, toPodId))];
        pod.usage.index = _clusterCurrentIndex(toPodId);
        pod.usage.block = uint64(block.number);
        pod.validatorCount += activeValidatorCount;

        require(!_liquidatable(pod.balance, pod.validatorCount, newOperatorIds), "account liquidatable");
    }

    // TODO add external functions below to interface

    // @dev external dao functions

    function getOperatorFeeIncreaseLimit() external view returns (uint64) {
        return _operatorMaxFeeIncrease;
    }

    function getExecuteOperatorFeePeriod() external view returns (uint256) {
        return _executeOperatorFeePeriod;
    }

    function getDeclaredOperatorFeePeriod() external view returns (uint256) {
        return _declareOperatorFeePeriod;
    }

    function updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) external onlyOwner {
        _updateOperatorFeeIncreaseLimit(newOperatorMaxFeeIncrease);
    }

    function updateDeclareOperatorFeePeriod(uint256 newDeclareOperatorFeePeriod) external onlyOwner {
        _updateDeclareOperatorFeePeriod(newDeclareOperatorFeePeriod);
    }

    function updateExecuteOperatorFeePeriod(uint256 newExecuteOperatorFeePeriod) external onlyOwner {
        _updateExecuteOperatorFeePeriod(newExecuteOperatorFeePeriod);
    }

    // @dev external operators functions

    function operatorSnapshot(uint64 id) external view returns (uint64 currentBlock, uint64 index, uint64 balance) {
        Snapshot memory s = _getSnapshot(_operators[id], uint64(block.number));
        return (s.block, s.index, s.balance);
    }

    // @dev internal dao functions

    function _updateOperatorFeeIncreaseLimit(uint64 newOperatorMaxFeeIncrease) private {
        _operatorMaxFeeIncrease = newOperatorMaxFeeIncrease;

        emit OperatorFeeIncreaseLimitUpdate(_operatorMaxFeeIncrease);

    }

    function _updateDeclareOperatorFeePeriod(uint256 newDeclareOperatorFeePeriod) private {
        _declareOperatorFeePeriod = newDeclareOperatorFeePeriod;

        emit DeclareOperatorFeePeriodUpdate(newDeclareOperatorFeePeriod);
    }

    function _updateExecuteOperatorFeePeriod(uint256 newExecuteOperatorFeePeriod) private {
        _executeOperatorFeePeriod = newExecuteOperatorFeePeriod;

        emit ExecuteOperatorFeePeriodUpdate(newExecuteOperatorFeePeriod);
    }

    // @dev internal operators functions

    function _getSnapshot(Operator memory operator, uint64 currentBlock) private view returns (Snapshot memory) {
        uint64 blockDiffFee = (currentBlock - operator.snapshot.block)* operator.fee;

        operator.snapshot.index += blockDiffFee;
        operator.snapshot.balance += blockDiffFee * operator.validatorCount;
        operator.snapshot.block = currentBlock;

        return operator.snapshot;
    }

    function _updateOperatorsValidatorMove(
        uint64[] memory oldOperatorIds,
        uint64[] memory newOperatorIds,
        uint64 validatorCount
    ) private {
        uint64 oldIndex;
        uint64 newIndex;
        uint64 currentBlock = uint64(block.number);

        while (oldIndex < oldOperatorIds.length && newIndex < newOperatorIds.length) {
            if (oldOperatorIds[oldIndex] < newOperatorIds[newIndex]) {
                Operator memory operator = _operators[oldOperatorIds[oldIndex]];
                operator.snapshot = _getSnapshot(operator, currentBlock);
                operator.validatorCount -= validatorCount;
                _operators[oldOperatorIds[oldIndex]] = operator;
                ++oldIndex;
            } else if (newOperatorIds[newIndex] < oldOperatorIds[oldIndex]) {
                Operator memory operator = _operators[newOperatorIds[newIndex]];
                operator.snapshot = _getSnapshot(operator, currentBlock);
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
            operator.snapshot = _getSnapshot(operator, currentBlock);
            operator.validatorCount -= validatorCount;
            _operators[oldOperatorIds[oldIndex]] = operator;
            ++oldIndex;
        }

        while (newIndex < newOperatorIds.length) {
            Operator memory operator = _operators[newOperatorIds[newIndex]];
            operator.snapshot = _getSnapshot(operator, currentBlock);
            operator.validatorCount += validatorCount;
            _operators[newOperatorIds[newIndex]] = operator;
            ++newIndex;
        }
    }

    function _setFee(Operator memory operator, uint64 fee) private returns (Operator memory) {
        operator.snapshot = _getSnapshot(operator, uint64(block.number));
        operator.fee = fee;

        return operator;
    }

    function _updateOperatorsData(uint64[] memory operatorIds, bool increase) private {
        uint64 currentBlock = uint64(block.number);
        for (uint64 i = 0; i < operatorIds.length; ++i) {
            Operator memory operator = _operators[operatorIds[i]];
            operator.snapshot = _getSnapshot(operator, uint64(block.number));
            if (increase) {
                ++operator.validatorCount;
            } else {
                --operator.validatorCount;
            }
            _operators[operatorIds[i]] = operator;
        }
    }

    function _updatePodData(bytes32 clusterId, uint64 amount, bool increase) private returns (Pod memory) {
        Pod memory pod = _pods[keccak256(abi.encodePacked(msg.sender, clusterId))];
        uint64 podIndex = _clusterCurrentIndex(clusterId);
        pod.balance = _ownerPodBalance(pod, podIndex) + amount;
        pod.usage.index = podIndex;
        pod.usage.block = uint64(block.number);
        if (increase) {
            ++pod.validatorCount;
        } else {
            --pod.validatorCount;
        }

        if (pod.validatorCount == 0) {
            // _availableBalances[msg.sender] += _ownerPodBalance(pod, podIndex);
            // pod.balance -= _ownerPodBalance(pod, podIndex);
        }
        return pod;
    }

    function podBalanceOf(address owner, bytes32 clusterId) external view returns (uint64) {
        Pod memory pod = _pods[keccak256(abi.encodePacked(owner, clusterId))];
        return _ownerPodBalance(pod, _clusterCurrentIndex(clusterId));
    }

    /**
     * @dev Validates the params for a validator.
     * @param publicKey Validator public key.
     */
    function _validateValidatorParams(
        uint64[] memory operatorIds,
        bytes memory publicKey
    ) private pure {
        if (publicKey.length != 48) {
            revert InvalidPublicKeyLength();
        }
        if (
            operatorIds.length < 4 || operatorIds.length % 3 != 1
        ) {
            revert OessDataStructureInvalid();
        }
    }

    function deposit(uint64 amount) public {
        _availableBalances[msg.sender] += amount;
    }

    function _createCluster(uint64[] memory operators) private returns (uint64 podId) {
        for (uint64 index = 0; index < operators.length; ++index) {
            require(_operators[operators[index]].owner != address(0), "operator not found");
        }

        _clusters[keccak256(abi.encodePacked(operators))] = Cluster({ operatorIds: operators });
    }

    function _getOrCreateCluster(uint64[] memory operatorIds) private returns (bytes32) { // , Cluster memory
        for (uint64 i = 0; i < operatorIds.length - 1;) {
            require(operatorIds[i] <= operatorIds[++i]);
        }

        bytes32 key = keccak256(abi.encodePacked(operatorIds));

        Cluster storage cluster = _clusters[key];
        if (cluster.operatorIds.length == 0) {
            cluster.operatorIds = operatorIds;
        }

        return key;
    }


    function _updateDAOEarnings(DAO memory dao) private returns (DAO memory) {
        dao.earnings.balance = _networkTotalEarnings(dao);
        dao.earnings.block = uint64(block.number);

        return dao;
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

    function _clusterCurrentIndex(bytes32 podId) private view returns (uint64 podIndex) {
        Cluster memory cluster = _clusters[podId];
        uint64 currentBlock = uint64(block.number);
        for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
            Snapshot memory s = _operators[cluster.operatorIds[i]].snapshot;
            podIndex += s.index + (currentBlock - s.block) * _operators[cluster.operatorIds[i]].fee;
        }
    }

    function _ownerPodBalance(Pod memory pod, uint64 currentPodIndex) private view returns (uint64) {
        return pod.balance - (currentPodIndex - pod.usage.index) * pod.validatorCount;
    }

    function _burnRatePerValidator(Operator[] memory operators) private pure returns (uint64 rate) {
        for (uint64 i = 0; i < operators.length; ++i) {
            rate += operators[i].fee;
        }
    }

    function _liquidatable(uint64 balance, uint64 validatorCount, uint64[] memory operatorIds) private view returns (bool) {
        return balance < LIQUIDATION_MIN_BLOCKS * (_burnRatePerValidator(_extractOperators(operatorIds)) + _networkFee) * validatorCount;
    }

    function _updateOperatorFeeUnsafe(uint64 operatorId, uint64 fee) private {
        Operator memory operator = _operators[operatorId];

        _operators[operatorId] = _setFee(operator, fee);

        emit OperatorFeeExecution(msg.sender, operatorId, block.number, fee);
    }

    function _onlyOperatorOwnerOrContractOwner(uint64 operatorId) private view {
        Operator memory operator = _operators[operatorId];

        if(operator.owner == address(0)) {
            revert OperatorWithPublicKeyNotExist();
        }

        if(msg.sender != operator.owner && msg.sender != owner()) {
            revert CallerNotOwner();
        }
    }

    /*
    function liquidate(address owner, bytes32 podId) external {
        Cluster memory cluster = _clusters[podId];
        Operator[] memory operators = new Operator[](cluster.operatorIds.length);
        for (uint64 i = 0; i < cluster.operatorIds.length; ++i) {
            operators[i] = _operators[cluster.operatorIds[i]];
        }
        uint64 podIndex = _clusterCurrentIndex(operators);
        Pod memory pod = _pods[owner][podId];
        uint64 balance = _ownerPodBalance(pod, podIndex);
        require(_liquidatable(balance, pod.validatorCount, operators));
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
