export const Events = {
  VALIDATOR_ADDED: "ValidatorAdded",
  VALIDATOR_REMOVED: "ValidatorRemoved",
  OPERATOR_ADDED: "OperatorAdded",
  OPERATOR_PRIVACY_STATUS_UPDATED: "OperatorPrivacyStatusUpdated",
  OPERATOR_REMOVED: "OperatorRemoved",
  OPERATOR_MULTIPLE_WHITELIST_UPDATED: "OperatorMultipleWhitelistUpdated",
  OPERATOR_MULTIPLE_WHITELIST_REMOVED: "OperatorMultipleWhitelistRemoved",
  OPERATORS_WHITELISTING_CONTRACT_UPDATED: "OperatorWhitelistingContractUpdated",
  OPERATORS_PRIVACY_STATUS_UPDATED: "OperatorPrivacyStatusUpdated",
  OPERATOR_FEE_DECLARED: "OperatorFeeDeclared",
} as const;
