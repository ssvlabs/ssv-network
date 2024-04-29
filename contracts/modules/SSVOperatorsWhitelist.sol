// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import {ISSVOperatorsWhitelist} from "../interfaces/ISSVOperatorsWhitelist.sol";
import {ISSVWhitelistingContract} from "../interfaces/external/ISSVWhitelistingContract.sol";
import {Types64, Types256} from "../libraries/Types.sol";
import {StorageData, SSVStorage} from "../libraries/SSVStorage.sol";
import {OperatorLib} from "../libraries/OperatorLib.sol";

contract SSVOperatorsWhitelist is ISSVOperatorsWhitelist {
    using Types256 for uint256;
    using Types64 for uint64;
    using OperatorLib for Operator;

    /*******************************/
    /* Operator External Functions */
    /*******************************/

    function setOperatorWhitelist(uint64 operatorId, address whitelistAddress) external override {
        OperatorLib.checkZeroAddress(whitelistAddress);

        if (OperatorLib.isWhitelistingContract(whitelistAddress))
            revert AddressIsWhitelistingContract(whitelistAddress);

        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        // Set the bit at bitPosition for the operatorId in the corresponding uint256 blockIndex
        (uint256 blockIndex, uint256 bitPosition) = OperatorLib.getBitmapIndexes(operatorId);

        s.addressWhitelistedForOperators[whitelistAddress][blockIndex] |= (1 << bitPosition);

        if (!s.operators[operatorId].whitelisted) s.operators[operatorId].whitelisted = true;

        emit OperatorWhitelistUpdated(operatorId, whitelistAddress);
    }

    function setOperatorMultipleWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        OperatorLib.updateMultipleWhitelists(whitelistAddresses, operatorIds, true, SSVStorage.load());
        emit OperatorMultipleWhitelistUpdated(operatorIds, whitelistAddresses);
    }

    function removeOperatorMultipleWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        OperatorLib.updateMultipleWhitelists(whitelistAddresses, operatorIds, false, SSVStorage.load());
        emit OperatorMultipleWhitelistRemoved(operatorIds, whitelistAddresses);
    }

    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external {
        // Reverts also when whitelistingContract == address(0)
        if (!OperatorLib.isWhitelistingContract(address(whitelistingContract))) revert InvalidWhitelistingContract();

        uint256 operatorsLength = OperatorLib.getOperatorsLength(operatorIds);

        StorageData storage s = SSVStorage.load();
        Operator storage operator;

        for (uint256 i; i < operatorsLength; ++i) {
            uint64 operatorId = operatorIds[i];

            operator = s.operators[operatorId];
            operator.checkOwner();

            address currentWhitelisted = s.operatorsWhitelist[operatorId];

            // operator already whitelisted? EOA or generic contract
            if (currentWhitelisted != address(0)) {
                (uint256 blockIndex, uint256 bitPosition) = OperatorLib.getBitmapIndexes(operatorId);
                delete s.operatorsWhitelist[operatorId];
                s.addressWhitelistedForOperators[currentWhitelisted][blockIndex] |= (1 << bitPosition);
            } else {
                operator.whitelisted = true;
            }

            s.operatorsWhitelist[operatorId] = address(whitelistingContract);
        }

        emit OperatorWhitelistingContractUpdated(operatorIds, address(whitelistingContract));
    }

    function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external {
        uint256 operatorsLength = OperatorLib.getOperatorsLength(operatorIds);

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

    function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, true, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, true);
    }

    function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external override {
        OperatorLib.updatePrivacyStatus(operatorIds, false, SSVStorage.load());
        emit OperatorPrivacyStatusUpdated(operatorIds, false);
    }
}
