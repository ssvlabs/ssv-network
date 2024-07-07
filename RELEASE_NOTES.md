# Release Notes

## [v1.2.0] 2024-05-21

### Functions

#### Removed
- `setOperatorWhitelist(uint64 operatorId, address whitelisted)`

#### Added

**SSVNetwork**
- `function setOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses)`
- `function removeOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses)`
- `function setOperatorsWhitelistingContract(uint64[] calldata operatorIds, ISSVWhitelistingContract whitelistingContract)`
- `function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds)`
- `function setOperatorsPublicUnchecked(uint64[] calldata operatorIds)`
- `function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds)`

**SSVNetworkViews**
- `function getWhitelistedOperators(uint64[] calldata operatorIds, address whitelistedAddress) external view returns (uint64[] memory whitelistedOperatorIds)`
- `function isWhitelistingContract(address contractAddress) external view returns (bool)`
- `function isAddressWhitelistedInWhitelistingContract(address addressToCheck, uint256 operatorId, address whitelistingContract) external view returns (bool sWhitelisted)`

#### Modified
- `function registerOperator(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64 id)`

### Errors

#### New
- `error CallerNotOwnerWithData(address caller, address owner); // 0x163678e9`
- `error CallerNotWhitelistedWithData(uint64 operatorId); // 0xb7f529fe`
- `error ExceedValidatorLimitWithData(uint64 operatorId); // 0x8ddf7de4`
- `error TargetModuleDoesNotExistWithData(uint8 moduleId); // 0x208bb85d`
- `error InvalidContractAddress(); // 0xa710429d`
- `error AddressIsWhitelistingContract(address contractAddress); // 0x71cadba7`
- `error InvalidWhitelistingContract(address contractAddress); // 0x886e6a03`
- `error InvalidWhitelistAddressesLength(); // 0xcbb362dc`
- `error ZeroAddressNotAllowed(); // 0x8579befe`

#### Deprecated
- `error CallerNotOwner(); // 0x5cd83192`
- `error CallerNotWhitelisted(); // 0x8c6e5d71`
- `error ExceedValidatorLimit(); // 0x6df5ab76`
- `error TargetModuleDoesNotExist(); // 0x8f9195fb`

### Events

#### Removed
- `event OperatorWhitelistUpdated(uint64 indexed operatorId, address whitelisted);`

#### Added
- `event OperatorMultipleWhitelistUpdated(uint64[] operatorIds, address[] whitelistAddresses);`
- `event OperatorMultipleWhitelistRemoved(uint64[] operatorIds, address[] whitelistAddresses);`
- `event OperatorWhitelistingContractUpdated(uint64[] operatorIds, address whitelistingContract);`
- `event OperatorPrivacyStatusUpdated(uint64[] operatorIds, bool toPrivate);`

### New Interface
- `interface ISSVWhitelistingContract` for whitelisting contracts.