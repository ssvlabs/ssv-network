# Gas Optimization Changelog

**Date:** 2026-01-27  
**Branch:** ssv-staking  

---

## Summary

This changelog documents gas optimization attempts and the final changes that were kept.

### Important Note: Lazy vUnits Tracking Was Reverted

The initial optimization attempt implemented "lazy vUnits tracking" to skip storage writes for default clusters. However, this was **reverted** because it broke the intentional fee accounting behavior introduced in PR #371.

**Reason for revert:** The current implementation always updates `operatorEthVUnits` on registration to ensure clusters are charged fees from the moment of registration, rather than waiting for the EB oracle to report. This is a correctness requirement.

---

## Optimizations Kept

### 1. Storage Caching Functions

Added overloaded snapshot update functions that accept a cached `StorageEB` pointer to avoid redundant `SSVStorageEB.load()` calls in loops.

#### Changes in `contracts/libraries/OperatorLib.sol`

**Added Functions:**
- `updateSnapshotStWithSeb(operator, operatorId, seb)` - Storage operator version with cached seb
- `updateSnapshotWithSeb(operator, operatorId, seb)` - Memory operator version with cached seb

**Modified Loop Functions to Use Caching:**
- `updateClusterOperators()` - Caches `StorageEB` before loop
- `updateClusterOperatorsMigration()` - Same pattern  
- `updateClusterOperatorsOnRegistration()` - Caches storage pointer

**Gas Savings:** ~100-200 gas per operator in loop operations

---

### 2. Batch Migration Function

Added a function to pre-initialize operator ETH fields for legacy operators.

#### Changes in `contracts/modules/SSVDAO.sol`

**Added Function:**
```solidity
function batchInitializeOperatorETHFields(uint64[] calldata operatorIds) external {
    StorageData storage s = SSVStorage.load();
    uint256 length = operatorIds.length;
    for (uint256 i; i < length; ++i) {
        OperatorLib.ensureETHDefaults(s.operators[operatorIds[i]]);
    }
    emit OperatorsETHFieldsInitialized(operatorIds.length);
}
```

**Added Event:**
```solidity
event OperatorsETHFieldsInitialized(uint256 count);
```

**Gas Savings:** Eliminates ~5k gas per operator on first ETH cluster interaction when used to pre-warm storage.

---

## Optimizations Reverted

### Lazy vUnits Tracking (REVERTED)

**Original Proposal:** Store only deviations from the default 32 ETH baseline in `operatorEthVUnits`, computing effective vUnits at read time as:
```
effectiveVUnits = storedDeviation + (ethValidatorCount × VUNITS_PRECISION)
```

**Why It Was Reverted:**
1. Broke existing tests that verify `operatorEthVUnits` is updated on registration
2. The current behavior is intentional (PR #371) to ensure proper fee charging from registration
3. Without immediate writes, there could be a window where fees are not properly tracked

**Tests That Would Fail:**
- `"Updates operatorEthVUnits even when cluster EB snapshot is not set"`
- `"Keeps stored EB snapshot unset when registering into an existing cluster without an explicit EB snapshot"`
- `"Increments stored EB snapshot vUnits when cluster EB snapshot is set"`

---

## Files Modified

1. `contracts/libraries/OperatorLib.sol` - Added storage caching overloads
2. `contracts/modules/SSVDAO.sol` - Added batch migration function

---

## Future Optimization Considerations

The gas overhead from writing `operatorEthVUnits` on every registration is an intentional trade-off for correctness. Potential future approaches:

1. **Batched writes** - Accumulate changes and write once per transaction (complex)
2. **Different storage layout** - Use a more gas-efficient data structure
3. **Pre-initialize operators** - Use `batchInitializeOperatorETHFields()` to reduce first-time cold storage costs

---

## Test Verification

All tests pass after the changes:
```
132 passing (6s)
```

---

## References

- Original Gas Comparison Report: `ssv-network-gas-comparison-v2.md`
- PR #371: "Enforce SSV Cluster Accounting with ValidatorCount & Charge Fees from Registration"
