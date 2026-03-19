---
title: Validator Registration — All State Combinations

---

# Validator Registration — All State Combinations

**Scope:** `registerValidator` / `bulkRegisterValidator` → `_bulkRegisterValidator`
**Date:** Feb 16, 2026

The registration path executes these checks in order:
1. Input validation (publicKeys length, sharesData length, operatorIds length)
2. Public key registration (`ValidatorLib.registerPublicKey`)
3. Cluster validation (`validateClusterOnRegistration`)
4. Balance update (`cluster.balance += msg.value`)
5. Operator loop (`updateClusterOperatorsOnRegistration`):
   - Sorted/unique check
   - `ensureOperatorExist(operatorSt)` ← `isExistingCluster` param removed ✅
   - `ensureETHDefaults(operatorSt)` ← writes to storage
   - `operator = operatorSt` ← memory copy AFTER defaults
   - Whitelist check (if private)
   - `updateSnapshot(operator, operatorId)` ← memory
   - `ethValidatorCount += delta` (limit check)
   - Accumulate fee + index
   - `s.operators[operatorId] = operator` ← write back full struct
7. Cluster data update + fee deduction (`updateClusterData` → `updateBalanceWithEB`)
8. DAO update (`sp.updateDAO`)
9. Liquidation check (`isLiquidatableWithEB`)
10. Store cluster hash (`s.ethClusters[hashedCluster]`)
11. EB snapshot update (if explicit tracking)

---

## A. Operator State Combinations

### Operator States (per operator in the cluster)

| # | State | `owner` | `snapshot.block` | `ethSnapshot.block` | `fee` (SSV) | `ethFee` | `ethValidatorCount` | How created |
|---|-------|---------|-------------------|---------------------|-------------|----------|---------------------|-------------|
| O1 | **Post-upgrade operator** (normal) | ≠ 0 | **0** | > 0 | 0 | > 0 | any | `registerOperator` now only sets `ethSnapshot.block`. `snapshot.block` stays 0 — new operators are ETH-only. |
| O2 | **Post-upgrade free operator** | ≠ 0 | **0** | > 0 | 0 | 0 | any | `registerOperator(fee=0)`. `snapshot.block` stays 0. |
| O3 | **Pre-upgrade operator (never migrated)** | ≠ 0 | > 0 | **0** | > 0 | **0** | 0 | Created before ETH upgrade; never had ETH interaction |
| O4 | **Pre-upgrade free operator (never migrated)** | ≠ 0 | > 0 | **0** | 0 | **0** | 0 | Created before ETH upgrade with fee=0 |
| O5 | **Pre-upgrade, partially migrated** | ≠ 0 | > 0 | > 0 | > 0 | > 0 | ≥ 0 | Had `ensureETHDefaults` called once (via prior registration or `declareOperatorFee`) |
| O6 | **Removed operator** | **≠ 0** ⚠️ | **0** | **0** | 0 | 0 | 0 | `removeOperator` → `_resetOperatorState` zeros fees/blocks/counts but **NOT owner** |
| O7 | **Never existed** | **0** | **0** | **0** | 0 | 0 | 0 | Default storage (operatorId never registered) |
| O8 | **Removed but had preserved index** | **≠ 0** ⚠️ | **0** | **0** | 0 | 0 | 0 | Same as O6 — `_resetOperatorState` zeros fees/blocks/counts but **NOT owner**; `ethSnapshot.index` preserved from `updateSnapshotsSt` call before reset |

### What happens to each operator state during registration

| Operator State | `ensureOperatorExist` | `ensureETHDefaults` | `updateSnapshot` (memory) | Net Result | Issues |
|---|---|---|---|---|---|
| **O1** New (snapshot = 0, ethSnapshot > 0, ethFee > 0) | ✅ Pass (`owner ≠ 0`, `ethSnapshot.block > 0`) | Outer guard: `ethSnapshot.block == 0 \|\| snapshot.block == 0` → **true** (snapshot = 0). Inner `ethSnapshot.block == 0` → false, skips init. Fee check: `ethFee == 0` → false (ethFee > 0), skips. **No-op but enters function body every time.** | Normal ETH snapshot update. `blockDiff * ethFee` accrued. | ✅ Correct but wasteful | `ensureETHDefaults` outer guard always true for O1/O2 — minor gas waste |
| **O2** New free (snapshot = 0, ethSnapshot > 0, ethFee = 0) | ✅ Pass | Same as O1 — outer guard true, inner checks skip. | `blockDiffEthFee = 0`. No accrual. | ✅ Correct but wasteful | Same as O1 |
| **O3** Pre-upgrade (snapshot > 0, ethSnapshot = 0, fee > 0, ethFee = 0) | ✅ Pass (`owner ≠ 0`, `snapshot.block > 0`) | Outer guard: `ethSnapshot.block == 0` → **true**. Inner: sets `ethSnapshot.block = block.number`, `ethSnapshot.balance = 0`. Fee check: `ethFee == 0 && fee != 0` → sets `ethFee = defaultOperatorEthFee()`. **Written to storage.** | Memory copy happens AFTER defaults. Gets correct `ethSnapshot.block` and `ethFee`. Normal snapshot from current block (blockDiff = 0, no accrual). | ✅ Correct — this is the intended migration path | None |
| **O4** Pre-upgrade free (snapshot > 0, ethSnapshot = 0, fee = 0, ethFee = 0) | ✅ Pass | Outer guard → true. Inner: sets `ethSnapshot.block`. Fee check: `ethFee == 0 && fee == 0` → **skips fee assignment**. `ethFee` stays 0. | Memory copy gets `ethFee = 0`. No accrual. | ✅ Correct — free operator stays free | None |
| **O5** Partially migrated (both blocks > 0, ethFee > 0) | ✅ Pass | Outer guard → false (both blocks > 0). Skips. | Normal snapshot update. | ✅ Correct | None |
| **O6** Removed (owner ≠ 0, both blocks = 0) | ❌ **REVERT** `OperatorDoesNotExist` via Check 2 (`ethSnapshot.block == 0 && snapshot.block == 0`). Note: Check 1 (`owner == address(0)`) does **NOT** fire because owner is preserved. | Never reached | Never reached | Registration fails | ⚠️ Correct outcome, but relies solely on Check 2. Check 1 is useless here — `owner ≠ 0` for removed operators. |
| **O7** Never existed (owner = 0, all zeros) | ❌ **REVERT** `OperatorDoesNotExist` via `owner == address(0)` OR both blocks == 0. | Never reached | Never reached | Registration fails | ✅ Correct behavior |
| **O8** Removed with preserved index | ❌ **REVERT** `OperatorDoesNotExist` via Check 2 (both blocks = 0). `owner ≠ 0` so Check 1 does not fire. | Never reached | Never reached | Registration fails | ⚠️ Same as O6 — correct outcome but Check 1 is dead |

### Edge case: `ensureETHDefaults` re-entry on subsequent registrations

| Operator State | 1st Registration | 2nd Registration (same operator, different cluster) |
|---|---|---|
| **O3** Pre-upgrade | `ensureETHDefaults` initializes `ethSnapshot.block` and `ethFee`. After write-back: state becomes O5. | `ensureETHDefaults` outer guard → false (both blocks > 0). Skips. Normal path. ✅ |
| **O4** Pre-upgrade free | `ensureETHDefaults` initializes `ethSnapshot.block`. `ethFee` stays 0. After write-back: both blocks > 0, ethFee = 0. | Outer guard → false. Skips. ✅ |

### ⚠️ `snapshot.block == 0` is now the normal state for new operators

After removing `op.snapshot.block = blockNum` from `registerOperator`, **all new post-upgrade operators have `snapshot.block == 0` and `ethSnapshot.block > 0`**. This is intentional — new operators are ETH-only and should never participate in SSV clusters.

**Paths that create `ethSnapshot.block > 0, snapshot.block == 0`:**

| Path | Creates this state? | Explanation |
|---|---|---|
| `registerOperator` (current) | **YES** ✅ | Only sets `ethSnapshot.block`. This is the new normal for O1/O2. |
| `ensureETHDefaults` (on O3/O4) | **YES** | Sets `ethSnapshot.block` on storage. Caller writes back memory struct preserving original `snapshot.block > 0`, so for pre-upgrade operators this doesn't create the mismatch. But `declareOperatorFee` calls it on storage directly. |

**Impact of `snapshot.block == 0` on `ensureETHDefaults` outer guard:**

The guard `ethSnapshot.block == 0 || snapshot.block == 0` is now **always true** for new operators (O1/O2). This means `ensureETHDefaults` enters its body on every registration call for new operators, even though both inner checks (`ethSnapshot.block == 0` and `ethFee == 0 && fee != 0`) evaluate to false and skip. This is a minor gas waste.

**Suggested simplification:** Change the outer guard to only check `ethSnapshot.block == 0`:
```solidity
if (operator.ethSnapshot.block == 0) {
    operator.ethSnapshot.block = uint32(block.number);
    operator.ethSnapshot.balance = PACKED_ETH_ZERO;
    if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)) {
        operator.ethFee = defaultOperatorEthFee();
    }
}
```
This is sufficient because:
- For O3/O4 (pre-upgrade): `ethSnapshot.block == 0` → enters, initializes correctly
- For O1/O2 (new): `ethSnapshot.block > 0` → skips entirely (correct, already initialized)
- For O5 (migrated): both blocks > 0 → skips (correct)
- The `|| snapshot.block == 0` condition only served to catch a state that didn't exist before; now it catches O1/O2 needlessly

---

## B. Cluster State Combinations

### Cluster States

| # | State | `s.ethClusters[hash]` | `s.clusters[hash]` | `cluster.active` | `cluster.validatorCount` | Description |
|---|-------|----------------------|--------------------|--------------------|--------------------------|-------------|
| C1 | **New cluster (never existed)** | 0 | 0 | true (required) | 0 (required) | First-time registration |
| C2 | **Existing active ETH cluster** | ≠ 0 | 0 | true | > 0 | Adding validators to existing ETH cluster |
| C3 | **Existing active ETH cluster (0 validators)** | ≠ 0 | 0 | true | 0 | All validators removed but cluster not liquidated |
| C4 | **Liquidated ETH cluster** | ≠ 0 | 0 | **false** | any | Cluster was liquidated |
| C5 | **Existing SSV cluster (active)** | 0 | ≠ 0 | true | > 0 | Legacy SSV cluster, not migrated |
| C6 | **Existing SSV cluster (liquidated)** | 0 | ≠ 0 | false | any | Legacy SSV cluster, liquidated |
| C7 | **Both exist** | ≠ 0 | ≠ 0 | — | — | Should never happen (INV-G3) |

### What happens to each cluster state during registration

| Cluster State | `validateClusterOnRegistration` | `updateClusterOnRegistration` | Result | Issues |
|---|---|---|---|---|
| **C1** New (both = 0) | `clusterData == 0 && clusterDataSSV == 0`. Checks: `validatorCount == 0`, `networkFeeIndex == 0`, `index == 0`, `balance == 0`, `active == true`. Must all pass. | Operators get `ensureOperatorExist(op)`. Normal path. | ✅ New ETH cluster created | None |
| **C2** Active ETH (ethClusters ≠ 0) | `clusterData ≠ 0`. Checks `clusterData == hashClusterData(cluster)` (state must match). Then `validateClusterIsNotLiquidated` (must be active). | Normal fee settlement + validator addition. | ✅ Validators added | None |
| **C3** Active ETH, 0 validators | Same as C2. Hash must match. Must be active. | Fee settlement (no fees since 0 validators). Adds validators. | ✅ Re-populating empty cluster | None |
| **C4** Liquidated ETH | `clusterData ≠ 0`. Hash check passes. Then `validateClusterIsNotLiquidated` → **`active == false`** | — | ❌ **REVERT** `ClusterIsLiquidated` | ✅ Correct — must reactivate first |
| **C5** Active SSV cluster | `clusterData == 0 && clusterDataSSV ≠ 0` → **REVERT** `IncorrectClusterVersion` | — | ❌ **REVERT** `IncorrectClusterVersion` | ✅ Correct — must migrate first |
| **C6** Liquidated SSV cluster | Same as C5 — `clusterData == 0 && clusterDataSSV ≠ 0` | — | ❌ **REVERT** `IncorrectClusterVersion` | ✅ Correct |
| **C7** Both exist | `clusterData ≠ 0` (ETH checked first). Hash check + active check. | Would proceed as C2. | ⚠️ Shouldn't happen. If it does, SSV data is orphaned. | INV-G3 violation |

### Cluster state vs supplied `cluster` parameter mismatches

| Scenario | What happens |
|---|---|
| New cluster but `validatorCount > 0` | `validateClusterOnRegistration` → REVERT `IncorrectClusterState` |
| New cluster but `active = false` | REVERT `IncorrectClusterState` |
| New cluster but `balance > 0` | REVERT `IncorrectClusterState` |
| Existing cluster but wrong state | `hashClusterData(cluster) != stored` → REVERT `IncorrectClusterState` |
| Existing cluster, correct state, but liquidated | REVERT `ClusterIsLiquidated` |

---

## C. Operator × Cluster Cross-Product

### Registration with mixed operator states (4 operators in a cluster)

| Scenario | Operators | Cluster | Result | Notes |
|---|---|---|---|---|
| All normal, new cluster | [O1, O1, O1, O1] | C1 | ✅ Success | Standard path |
| All normal, existing cluster | [O1, O1, O1, O1] | C2 | ✅ Success | Standard path |
| Mix of normal + pre-upgrade | [O1, O3, O1, O3] | C1 | ✅ Success | O3 operators get ETH defaults initialized |
| All pre-upgrade, new cluster | [O3, O3, O3, O3] | C1 | ✅ Success | All get `ensureETHDefaults` |
| One removed operator | [O1, O6, O1, O1] | C1 or C2 | ❌ REVERT `OperatorDoesNotExist` | Fails on O6 |
| One never-existed | [O1, O7, O1, O1] | C1 or C2 | ❌ REVERT `OperatorDoesNotExist` | Fails on O7 |
| Free + paid mix | [O1, O2, O1, O2] | C1 | ✅ Success | Free operators contribute 0 to `cumulativeFee` |
| All free operators | [O2, O2, O2, O2] | C1 | ✅ Success | `burnRate = 0`. Only network fee applies. |
| Pre-upgrade free | [O4, O4, O4, O4] | C1 | ✅ Success | `ethFee` stays 0. No operator fee accrual. |
| Private operator, caller not whitelisted | [O1(private), O1, O1, O1] | C1 | ❌ REVERT `CallerNotWhitelistedWithData` | Whitelist check fails |
| Operator at validator limit | [O1(at limit), O1, O1, O1] | C2 | ❌ REVERT `ExceedValidatorLimitWithData` | `ethValidatorCount + delta > validatorsPerOperatorLimit` |
| SSV cluster with ETH operators | [O1, O1, O1, O1] | C5 | ❌ REVERT `IncorrectClusterVersion` | Cluster version mismatch |

---

## D. EB (Effective Balance) State Combinations

### EB States per cluster

| # | State | `clusterEB[hash].vUnits` | `operatorEthVUnits[opId]` | Description |
|---|-------|--------------------------|---------------------------|-------------|
| E1 | **No EB tracking (implicit)** | 0 | 0 | Default: each validator = 32 ETH = `VUNITS_PRECISION` |
| E2 | **Explicit EB, at baseline** | `validatorCount * VUNITS_PRECISION` | 0 | Oracle set EB = 32 ETH/validator (no deviation) |
| E3 | **Explicit EB, above baseline** | > `validatorCount * VUNITS_PRECISION` | > 0 | Oracle set EB > 32 ETH/validator (positive deviation) |
| E4 | **Explicit EB, at max** | `validatorCount * ebToVUnits(2048)` | large positive | Oracle set EB = 2048 ETH/validator |

### EB impact during registration

| EB State | `updateBalanceWithEB` (fee deduction) | EB snapshot update (line 143-154) | Impact |
|---|---|---|---|
| **E1** Implicit | `getVUnits` returns `validatorCount * VUNITS_PRECISION` (OLD count, before increment). Fee deduction uses baseline vUnits. | `ebSnapshot.vUnits == 0` → skip. No EB update. | ✅ Correct — baseline adjusts automatically via `validatorCount` |
| **E2** Explicit, baseline | `getVUnits` returns stored vUnits (= old `validatorCount * VUNITS_PRECISION`). Fee deduction same as E1. | `ebSnapshot.vUnits > 0` → adds `delta * VUNITS_PRECISION`. | ✅ Correct — explicit tracking maintained |
| **E3** Explicit, above baseline | `getVUnits` returns stored vUnits (includes deviation). Fee deduction is **higher** than baseline (proportional to actual EB). | `ebSnapshot.vUnits > 0` → adds `delta * VUNITS_PRECISION` (baseline for new validators). Deviation unchanged. | ✅ Correct — new validators get baseline, existing deviation preserved |
| **E4** Explicit, at max | Same as E3 but with maximum deviation. Higher fee deduction. | Same as E3. | ✅ Correct |

### EB + operator vUnits consistency during registration

```
BEFORE registration:
  daoTotalEthVUnits = sum(all cluster effective vUnits)
  operatorEthVUnits[opId] = sum(deviations from all clusters using this operator)

AFTER registration (N new validators):
  sp.updateDAO(true, N) → daoTotalEthVUnits += N * VUNITS_PRECISION  (baseline)
  operator.ethValidatorCount += N  (baseline in operator)
  if explicit EB: ebSnapshot.vUnits += N * VUNITS_PRECISION  (baseline in cluster)
  operatorEthVUnits[opId] NOT changed  (deviation unchanged)

CONSISTENCY CHECK:
  New effective vUnits for cluster = old vUnits + N * VUNITS_PRECISION  ✅
  New effective vUnits for operator = operatorEthVUnits[opId] + (ethValidatorCount + N) * VUNITS_PRECISION  ✅
  New daoTotalEthVUnits = old + N * VUNITS_PRECISION  ✅
```

**No deviation change on registration → `operatorEthVUnits` correctly untouched.**

---

## E. Fee Deduction During Registration (Existing Clusters)

For existing clusters (C2, C3), `updateClusterData` is called which runs `updateBalanceWithEB`:

```
vUnits = getVUnits(hashedCluster, cluster.validatorCount)  // OLD validatorCount
idxOp = newOperatorIndex - cluster.index
idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex
operatorFeeUnits = (idxOp * vUnits) / VUNITS_PRECISION
networkFeeUnits = (idxNet * vUnits) / VUNITS_PRECISION
usage = (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS
cluster.balance -= usage
```

| Scenario | vUnits used | Fee impact | Notes |
|---|---|---|---|
| Existing cluster, implicit EB | `oldValidatorCount * VUNITS_PRECISION` | Standard per-validator fee | ✅ |
| Existing cluster, explicit EB above baseline | Stored vUnits (includes deviation) | Higher fee (proportional to actual EB) | ✅ |
| Existing cluster, 0 validators (C3) | 0 (implicit) or stored (explicit) | If implicit: 0 fees. If explicit with vUnits > 0: fees on deviation only. | ⚠️ C3 with explicit EB and vUnits > 0 but validatorCount = 0 means pure deviation — should this be possible? |
| New cluster (C1) | `0 * VUNITS_PRECISION = 0` | 0 fees (no prior validators) | ✅ Correct — no fees to settle |

### ⚠️ Edge: Empty cluster (C3) with explicit EB tracking

If a cluster had validators, got an EB update (explicit tracking), then all validators were removed:
- `_bulkRemoveValidator` subtracts baseline from `ebSnapshot.vUnits`
- If `validatorCount == 0`: cleans up remaining deviation, sets `ebSnapshot.vUnits = 0`

So when re-registering to C3, `ebSnapshot.vUnits` should be 0 → falls back to implicit. **This is correct.**

---

## F. Liquidation Threshold Check

After all updates, `isLiquidatableWithEB` is called:

```
if (cluster.validatorCount == 0) return false;  // can't liquidate empty cluster
if (cluster.balance < minimumLiquidationCollateral) return true;
vUnits = getVUnits(hashedCluster, cluster.validatorCount);  // NEW validatorCount
rate = burnRate + networkFee;
threshold = (minimumBlocksBeforeLiquidation * rate * vUnits) / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS;
return cluster.balance < threshold;
```

| Scenario | vUnits | Threshold | Notes |
|---|---|---|---|
| New cluster, 1 validator, implicit EB | `1 * 10000` | `minBlocks * (burnRate + netFee) * 10000 / 10000 * 100000` | Standard |
| Existing cluster, adding validators, implicit EB | `(old + new) * 10000` | Higher threshold (more validators) | Must deposit enough to cover |
| Existing cluster, explicit EB above baseline | Stored vUnits + new baseline | Even higher threshold | EB amplifies required collateral |
| All free operators, no network fee | vUnits | `minBlocks * 0 * vUnits = 0` | Only `minimumLiquidationCollateral` matters |

---

### ⚠️ Cleanup / Simplification

| Area | Issue | Severity |
|---|---|---|
| `ensureETHDefaults` outer guard :143 | `\|\| operator.snapshot.block == 0` now always true for O1/O2. Function body entered on every call but does nothing. Simplify to `ethSnapshot.block == 0`. | Low (gas waste only) |
| `ensureOperatorExist` :160-162 | `(ethSnapshot.block == 0 && snapshot.block == 0)` can be simplified to `ethSnapshot.block == 0` since `ethSnapshot.block` is now the canonical existence marker. | Low (clarity) |
| `checkOwner` :132 | `snapshot.block == 0 && ethSnapshot.block == 0` can be simplified to `ethSnapshot.block == 0`. | Low (clarity) |
| `updateClusterOperatorsMigration` :383 | `snapshot.block == 0 && ethSnapshot.block == 0` → skip. Can simplify to `ethSnapshot.block == 0`. | Low (clarity) |
| `_resetOperatorState` doesn't zero `owner` | Removed operators retain their `owner`. `checkOwner` passes for the original owner — only the block == 0 check prevents further actions. | Medium (latent risk — defense in depth suggests zeroing `owner`) |

### 🔍 Worth Verifying in Tests

| # | Scenario | What to verify |
|---|---|---|
| 1 | Register with 4 new operators (O1) on new cluster | All pass `ensureOperatorExist`. `ensureETHDefaults` is a no-op. Cluster created correctly. |
| 2 | Register with mix of O1 + O3 on existing cluster | O3 gets defaults. O1 unchanged. Fee settlement correct. |
| 3 | Register with all free operators (O2) | `burnRate = 0`. Only network fee in liquidation check. |
| 4 | Register on empty cluster (C3) after all validators removed | Cluster re-populated. EB tracking reset to implicit. |
| 5 | Register on cluster with explicit EB above baseline (E3) | Fee deduction uses higher vUnits. New validators get baseline only. |
| 6 | Register that would exceed `validatorsPerOperatorLimit` | Reverts `ExceedValidatorLimitWithData`. |
| 7 | Register with insufficient deposit (fails liquidation check) | Reverts `InsufficientBalance`. |
| 8 | Register same public key twice | Second call reverts `ValidatorAlreadyExistsWithData`. |
| 9 | Register to SSV cluster (not migrated) | Reverts `IncorrectClusterVersion`. |
| 10 | Register to liquidated cluster | Reverts `ClusterIsLiquidated`. |
| 11 | Liquidate ETH cluster with new operators (O1) | `ethValidatorCount` must be decremented. Fixed in `_liquidateIfNeeded`. Verify it works. |
| 12 | Liquidate ETH cluster with pre-upgrade operators (O5) | `ethValidatorCount` decremented correctly (both blocks > 0). |
| 13 | New operator (O1) — `getOperatorById` returns `isActive = true` | ETH view correct. |
| 14 | New operator (O1) — `getOperatorByIdSSV` returns `isActive = false` | SSV view correct — not an SSV operator. |
