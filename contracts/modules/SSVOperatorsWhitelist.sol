// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ISSVOperatorsWhitelist} from "../interfaces/ISSVOperatorsWhitelist.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {StorageData, SSVStorage} from "../libraries/storage/SSVStorage.sol";
import {OperatorLib} from "../libraries/OperatorLib.sol";

contract SSVOperatorsWhitelist is ISSVOperatorsWhitelist {
    using OperatorLib for Operator;

    /**
     * @inheritdoc ISSVOperatorsWhitelist
     */
    function setOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        OperatorLib.updateMultipleWhitelists(whitelistAddresses, operatorIds, true, SSVStorage.load());
        emit OperatorMultipleWhitelistUpdated(operatorIds, whitelistAddresses);
    }

    /**
     * @inheritdoc ISSVOperatorsWhitelist
     */
    function removeOperatorsWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        OperatorLib.updateMultipleWhitelists(whitelistAddresses, operatorIds, false, SSVStorage.load());
        emit OperatorMultipleWhitelistRemoved(operatorIds, whitelistAddresses);
    }

    /**
     * @inheritdoc ISSVOperatorsWhitelist
     */
    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external {
        // Reverts also when whitelistingContract == address(0)
        if (!OperatorLib.isWhitelistingContract(address(whitelistingContract)))
            revert InvalidWhitelistingContract(address(whitelistingContract));

        uint256 operatorsLength = OperatorLib.checkOperatorsLength(operatorIds);

        StorageData storage s = SSVStorage.load();
        Operator storage operator;

        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];

            operator = s.operators[operatorId];
            operator.checkOwner();

            address currentWhitelisted = s.operatorsWhitelist[operatorId];

            // operator already whitelisted?
            // if EOA or generic contract, move it to SSV whitelisting module
            if (currentWhitelisted != address(0) && !OperatorLib.isWhitelistingContract(currentWhitelisted)) {
                (uint256 blockIndex, uint256 bitPosition) = OperatorLib.getBitmapIndexes(operatorId);

                s.addressWhitelistedForOperators[currentWhitelisted][blockIndex] |= (1 << bitPosition);
            }

            s.operatorsWhitelist[operatorId] = address(whitelistingContract);
        }

        emit OperatorWhitelistingContractUpdated(operatorIds, address(whitelistingContract));
    }

    /**
     * @inheritdoc ISSVOperatorsWhitelist
     */
    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external {
        uint256 operatorsLength = OperatorLib.checkOperatorsLength(operatorIds);

        StorageData storage s = SSVStorage.load();
        Operator storage operator;

        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];
            operator = s.operators[operatorId];

            operator.checkOwner();

            s.operatorsWhitelist[operatorId] = address(0);
        }

        emit OperatorWhitelistingContractUpdated(operatorIds, address(0));
    }
}
