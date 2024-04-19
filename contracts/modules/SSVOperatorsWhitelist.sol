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
        StorageData storage s = SSVStorage.load();
        s.operators[operatorId].checkOwner();

        if (OperatorLib.isWhitelistingContract(whitelistAddress))
            revert AddressIsWhitelistingContract(whitelistAddress);

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
    }

    function removeOperatorMultipleWhitelists(
        uint64[] calldata operatorIds,
        address[] calldata whitelistAddresses
    ) external override {
        OperatorLib.updateMultipleWhitelists(whitelistAddresses, operatorIds, false, SSVStorage.load());
    }

    function setOperatorsWhitelistingContract(
        uint64[] calldata operatorIds,
        ISSVWhitelistingContract whitelistingContract
    ) external {
        uint256 operatorsLength = operatorIds.length;
        if (operatorsLength == 0) revert InvalidOperatorIdsLength();

        StorageData storage s = SSVStorage.load();

        for (uint256 i = 0; i < operatorsLength; ++i) {
            OperatorLib.updateWhitelistingContract(operatorIds[i], whitelistingContract, s);
        }

        // TODO test set event param type to ISSVOperatorsWhitelist
        emit OperatorWhitelistingContractUpdated(operatorIds, address(whitelistingContract));
    }
}
