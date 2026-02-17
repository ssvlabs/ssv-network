# Bug: `ensureETHDefaults` Overwritten by Stale Memory Copy

**Branch:** ssv-staking (commit a613f61)
**Severity:** HIGH
**Status:** Confirmed on Hoodi testnet
**Reported by:** Jordan (SSV Labs) — observed via [tx 0x6ddd3c…80b2](https://hoodi.etherscan.io/tx/0x6ddd3c5f8338406ef09058112e5e74a8846cf55b9a370449cd66f6d9eb8a80b2)

---

## Summary

When registering validators against pre-upgrade operators (operators that existed before the ETH fee system), the default ETH fee is correctly written to storage by `ensureETHDefaults` but immediately overwritten by a stale memory copy. The operators end up with `ethFee = 0` permanently, charging nothing for ETH cluster operations.

---

## Root Cause

In `OperatorLib.updateClusterOperatorsOnRegistration` (OperatorLib.sol:162-241):

```solidity
// Line 185: Copy operator from storage into MEMORY
ISSVNetworkCore.Operator memory operator = s.operators[operatorId];
// operator.ethFee = 0 (pre-upgrade operator, never had ETH fee)

// ... validation checks ...

// Line 201: Write default ETH fee to STORAGE
ensureETHDefaults(s.operators[operatorId]);
// s.operators[operatorId].ethFee is now 1770_000_000 in STORAGE ✓

// ... whitelist checks ...

// Line 232: Update snapshots using MEMORY copy (ethFee still 0)
updateSnapshot(operator, operatorId);

// Line 236: Accumulate fee from MEMORY copy → adds 0
cumulativeFee += PackedETH.unwrap(operator.ethFee);  // 0!

// Line 239: Write MEMORY copy back to STORAGE → overwrites the default fee!
s.operators[operatorId] = operator;
// s.operators[operatorId].ethFee is now 0 again ✗
```

`ensureETHDefaults` correctly sets `ethFee = defaultOperatorEthFee()` in **storage**, but the function already holds a **memory** copy from line 185 that still has `ethFee = 0`. When the memory copy is written back to storage on line 239, it clobbers the fix.

---

## Conditions

The bug triggers when **all** of the following are true:

1. The operator was created **before** the ETH fee upgrade (has `ethSnapshot.block == 0` and `ethFee == 0`)
2. The operator has a non-zero SSV fee (`fee != 0`) — required for `ensureETHDefaults` to trigger
3. A user calls `registerValidator` / `bulkRegisterValidator` using this operator
4. The cluster is an ETH cluster (pays with native ETH)

Public or private status doesn't matter. Any pre-upgrade operator with an SSV fee is affected.

---

## Concrete Example (Hoodi Testnet)

Jordan registered validators using pre-upgrade operators 71, 85, 158, 171. On-chain query confirms:

| Operator | SSV Fee | ETH Fee (should be 1,770,000,000) | ETH Validators |
|----------|---------|------|----------------|
| 71 | 95,660,000,000 | **0** | 3 |
| 85 | 382,640,000,000 | **0** | 3 |
| 158 | 573,960,000,000 | **0** | 3 |
| 171 | 191,320,000,000 | **0** | 7 |

All four have non-zero SSV fees but zero ETH fees. The default ETH fee (`DEFAULT_OPERATOR_ETH_FEE = 1,770,000,000`) was never applied.

---

## Impact

### 1. Operators earn zero ETH fees
Pre-upgrade operators in ETH clusters receive no ETH earnings. Their `ethFee = 0` means `ethSnapshot.index` never accumulates, and `withdrawOperatorEarnings` yields nothing for ETH-based work.

### 2. Clusters pay zero operator ETH fees
The cluster's burn rate for these operators is 0. The cluster balance only decreases by the network fee, not operator fees. This means:
- Cluster owners get a discount (only pay network fee)
- Operators provide service for free
- The fee model is broken for these operators

### 3. The bug is persistent
Every subsequent `registerValidator` call against these operators re-triggers the same bug — `ensureETHDefaults` writes the default, then the stale memory copy overwrites it. The operators can never get a non-zero ETH fee through this path.

### 4. `declareOperatorFee` is a workaround
The operator owner can call `declareOperatorFee` → `executeOperatorFee` to manually set an ETH fee. That path (SSVOperators.sol:108-109) calls `ensureETHDefaults` without the memory/storage conflict. But operators may not realize they need to do this.

---

## Affected Code Path

```
registerValidator / bulkRegisterValidator
  → _bulkRegisterValidator (SSVValidators.sol:115)
    → cluster.updateClusterOnRegistration (ClusterLib.sol:234)
      → OperatorLib.updateClusterOperatorsOnRegistration (OperatorLib.sol:162) ← BUG HERE
```

**Not affected:**
- `migrateClusterToETH` → uses `updateClusterOperators` (line 395) which calls `ensureETHDefaults` after its own memory copy and doesn't overwrite
- `declareOperatorFee` → calls `ensureETHDefaults` on storage directly without a conflicting memory copy

---

## Fix

Move `ensureETHDefaults` **before** the memory copy, or reload the memory copy after calling it:

**Option A — call before copy (cleanest):**
```solidity
ensureETHDefaults(s.operators[operatorId]);
ISSVNetworkCore.Operator memory operator = s.operators[operatorId];
```

**Option B — reload after:**
```solidity
ISSVNetworkCore.Operator memory operator = s.operators[operatorId];
// ... validation ...
ensureETHDefaults(s.operators[operatorId]);
operator = s.operators[operatorId];  // reload
```

Option A is preferred — it avoids the unnecessary double storage read.

---

## Existing Operator Remediation

Operators already affected on testnet (or mainnet post-upgrade) need to either:
1. Call `declareOperatorFee` → `executeOperatorFee` to manually set their ETH fee
2. Or a contract upgrade must retroactively fix their `ethFee` in storage
