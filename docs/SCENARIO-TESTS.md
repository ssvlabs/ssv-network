# SSV Network v2.0.0 — Scenario Test Plan

## How to Read This Document

Each scenario is a specific sequence of contract interactions with exact expected outcomes.
Tests will be implemented in `test/e2e/` using Hardhat + ethers v6 + Chai.

### Scenario Format
- **Preconditions**: Exact contract state before the scenario starts
- **Action Sequence**: Step-by-step with block numbers and expected state changes
- **Assertions**: Exact formulas with actual numbers — not "balance is correct" but the full calculation
- **Edge Variations**: Boundary conditions and tweaks on the same scenario

### Naming Convention
- **OV-N**: Operators + Validators scenarios
- **CM-N**: Clusters + Migration scenarios
- **ES-N**: Effective Balance + Staking scenarios
- **CC-N**: Cross-Cutting scenarios (span 3+ modules)

### Key Constants Used Throughout
```
VUNITS_PRECISION = 10_000
ETH_DEDUCTED_DIGITS = 100_000
DEDUCTED_DIGITS = 10_000_000
DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000 wei → packed raw = 17_700
DEFAULT_EB_PER_VALIDATOR = 32 ETH
MAX_EB_PER_VALIDATOR = 2048 ETH
PRECISION (staking) = 1e18
MAX_PENDING_REQUESTS = 10
MINIMAL_STAKING_AMOUNT = 1_000_000_000
VERSION_SSV = 0
VERSION_ETH = 1
```

---

## All Discrepancies (Code vs FLOWS.md)

> **EACH MUST BE REVIEWED BY HUMAN BEFORE IMPLEMENTING TESTS**

### DISC-OV-1: `registerOperator` always emits `OperatorPrivacyStatusUpdated` even when public
- **Source partition:** OV
- **FLOWS.md says:** (§4.1) Only emit when `setPrivate` is true
- **Code does:** `SSVOperators.sol:65` — always emits regardless of `setPrivate` value
- **Likely correct:** Code
- **Impact:** Low — informational event. Tests should expect the event in both cases.

### DISC-OV-2: `registerOperator` does NOT validate fee against `operatorMaxFee` when fee is 0
- **Source partition:** OV
- **FLOWS.md says:** (§4.1) Fee must be within `[minimumOperatorEthFee, operatorMaxFee]`
- **Code does:** `SSVOperators.sol:38-43` — minimum check skipped when fee=0
- **Likely correct:** Code — zero-fee operators are intentionally free
- **Impact:** Medium — FLOWS.md should clarify: "Fee must be 0 (free) OR within `[minimumOperatorEthFee, operatorMaxFee]`"

### DISC-OV-3: `removeOperator` does NOT check `validatorCount == 0 && ethValidatorCount == 0`
- **Source partition:** OV
- **FLOWS.md says:** (§4.2) "Operator must have 0 validators in BOTH SSV and ETH counts"
- **Code does:** `SSVOperators.sol:71-93` — no validator count check before removal
- **Likely correct:** FLOWS.md — this is a **potential missing guard**
- **Impact:** HIGH — an operator with active validators can be removed, breaking `ethDaoValidatorCount == Σ(operator.ethValidatorCount)`. **FLAG FOR HUMAN REVIEW.**

### DISC-OV-4: `removeOperator` does NOT zero `ethSnapshot.index` or `snapshot.index`
- **Source partition:** OV
- **FLOWS.md says:** (§4.2) Implies ALL snapshot fields zeroed
- **Code does:** `SSVOperators.sol:324-335` — indices intentionally preserved
- **Likely correct:** Code — frozen indices used by clusters referencing removed operators
- **Impact:** Medium — FLOWS.md should clarify indices are preserved

### DISC-OV-5: `declareOperatorFee` calls `ensureETHDefaults` but `reduceOperatorFee` does not
- **Source partition:** OV
- **FLOWS.md says:** No mention of `ensureETHDefaults` in either flow
- **Code does:** `SSVOperators.sol:106-108` — only `declareOperatorFee` calls it
- **Likely correct:** Code — reducing a zero ETH fee is self-protecting (reverts)
- **Impact:** Low

### DISC-OV-6: `reduceOperatorFee` uses memory copy, `executeOperatorFee` uses storage directly
- **Source partition:** OV
- **FLOWS.md says:** Both describe same pattern
- **Code does:** Different gas profiles but functionally equivalent
- **Likely correct:** Both
- **Impact:** Low

### DISC-OV-7: `_bulkRemoveValidator` skips operators with `ethSnapshot.block == 0`
- **Source partition:** OV
- **FLOWS.md says:** (§1.3) "Update operator ETH snapshots"
- **Code does:** `OperatorLib.sol:267` — skips removed operators (block==0)
- **Likely correct:** Code — removed operators contribute frozen index
- **Impact:** Low

### DISC-OV-8: `deposit` does NOT update operator snapshots or settle cluster fees
- **Source partition:** OV / CM (duplicate finding)
- **FLOWS.md says:** (§1.4) "1. Update operator snapshots, 2. Settle cluster fees, 3. Add deposit"
- **Code does:** `SSVClusters.sol:190-205` — only validates hash, adds balance, stores hash
- **Likely correct:** Code — deposit is a pure balance addition, fees settle on next state change
- **Impact:** Medium — FLOWS.md misleading. Tests must NOT expect fee settlement on deposit.

### DISC-OV-9: `deposit` does NOT check `cluster.active`
- **Source partition:** OV / CM (duplicate finding)
- **FLOWS.md says:** (§1.4) "Cluster must be active"
- **Code does:** `SSVClusters.sol:190-205` — no active check
- **Likely correct:** Code — depositing to liquidated cluster is permissive, sets up for reactivation
- **Impact:** Low

### DISC-CM-3: `withdraw` does NOT update operator snapshots to storage
- **Source partition:** CM
- **FLOWS.md says:** (§1.5) "1. Update operator snapshots"
- **Code does:** `SSVClusters.sol:220-234` — reads operator indices inline without writing back
- **Likely correct:** Code — withdraw is read-only for operators, only settles cluster fees
- **Impact:** HIGH for test design — operator earnings NOT updated during withdraw

### DISC-CM-5: `reactivate` uses `cluster.balance += msg.value` (additive, not replacement)
- **Source partition:** CM
- **FLOWS.md says:** (§1.8) `cluster.balance = msg.value` (implies replacement)
- **Code does:** `SSVClusters.sol:160` — `+=` adds to any pre-existing deposits
- **Likely correct:** Code — combines with prior deposits into liquidated cluster
- **Impact:** Medium — tests should verify deposit-into-liquidated + reactivate interaction

### DISC-CM-6: Migration EB deviation only applied if `vUnitsCluster > baseline`
- **Source partition:** CM
- **FLOWS.md says:** (§2.1) Handles deviation
- **Code does:** `SSVClusters.sol:315-331` — only adds positive deviation
- **Likely correct:** Code — EB floor is 32 ETH so deviation can never be negative after migration
- **Impact:** Low

### DISC-ES-1: `_syncFees` unconditionally updates `ethDaoBalance` and `ethDaoIndexBlockNumber`
- **Source partition:** ES
- **FLOWS.md says:** (§5.5) Only mentions case where new fees exist
- **Code does:** `SSVStaking.sol:182-184` — always sets these BEFORE checking if `current > previous`
- **Likely correct:** Code — must settle DAO to get consistent snapshot
- **Impact:** Low

### DISC-ES-2: `_syncFees` handles `current <= previous` by updating `stakingEthPoolBalance`
- **Source partition:** ES
- **FLOWS.md says:** (§5.5) Only mentions positive fees case
- **Code does:** `SSVStaking.sol:187-189` — sets `stakingEthPoolBalance = current` when no new fees
- **Likely correct:** Code — keeps pool balance synced after claims
- **Impact:** Medium — missing documentation

### DISC-ES-6: Operator deviation in `_updateOperatorVUnits` applies FULL delta to EACH operator
- **Source partition:** ES
- **FLOWS.md says:** (§3.2) `operatorEthVUnits[opId] += (newVUnits - effectiveOldVUnits) / operatorCount`
- **Code does:** `SSVClusters.sol:496-515` — applies FULL delta to every operator, NOT divided
- **Likely correct:** Code — each operator tracks the sum of deviations from ALL its clusters
- **Impact:** HIGH — FLOWS.md is misleading. The full deviation goes to each operator.

### DISC-CC-1: `removeOperator` does NOT delete `operatorFeeChangeRequests`
- **Source partition:** CC (cross-cutting finding)
- **FLOWS.md says:** (§4.2) "Delete fee change request (if any)"
- **Code does:** `SSVOperators.sol:71-93` — no explicit deletion
- **Likely correct:** Code — harmless since `checkOwner` fails on subsequent attempts
- **Impact:** Low — minor storage leak

---

## Global Invariants (Check in EVERY cross-cutting test)

1. **ETH Conservation**: `contract.ETH >= Σ(active ETH cluster balances) + Σ(operator ETH earnings unpacked) + staking_pool_balance_unpacked`
   - Note: `>=` due to precision loss from packing. Cluster balances are raw wei (never packed).

2. **SSV Conservation**: `contract.SSV >= Σ(active SSV cluster balances) + Σ(operator SSV earnings unpacked) + staked_SSV`

3. **Validator Count**: `sp.ethDaoValidatorCount == Σ(operator.ethValidatorCount)` across all operators
   - Caveat: broken if DISC-OV-3 is exploited (operator removed with active validators)

4. **vUnit Consistency**: `sp.daoTotalEthVUnits == sp.ethDaoValidatorCount × VUNITS_PRECISION + Σ(cluster EB deviations)`
   - Where deviation = `clusterEB.vUnits - validatorCount × VUNITS_PRECISION` for explicit EB clusters

5. **Cluster Hash Integrity**: `s.ethClusters[key] == keccak256(abi.encodePacked(validatorCount, networkFeeIndex, index, balance, active))`

6. **cSSV Supply**: `cSSV.totalSupply() == Σ(staked SSV) - Σ(unstake-requested SSV)`
   - Mint on stake, burn on requestUnstake

7. **Accumulator Monotonicity**: `accEthPerShare` only increases, never decreases

8. **Oracle Monotonicity**: `latestCommittedBlock` only increases

9. **Cluster Version Exclusivity**: A cluster key exists in EITHER `s.clusters` OR `s.ethClusters`, never both

10. **Operator Dual Tracking**: For each operator: `ethValidatorCount == Σ(validatorCount of active ETH clusters using this operator)`

---

## Part 1: Operators + Validators

### OV-1: Register Operator (Public, Non-Zero Fee) — Initial State Verification

**Modules Touched:** SSVOperators
**Bug Class Covered:** Incorrect initialization, missing field defaults

#### Preconditions
- No operators registered
- `sp.minimumOperatorEthFee` = 100_000 (packed: 1)
- `sp.operatorMaxFee` = packed value allowing up to 10 ETH/block

#### Action Sequence
| Step | Action | Block | Expected State Change |
|------|--------|-------|----------------------|
| 1 | `registerOperator(pubkey, 1_770_000_000, false)` | 100 | Creates operator ID 1 |

#### Assertions
- [ ] `operator[1].owner == msg.sender`
- [ ] `operator[1].ethFee == PackedETH.wrap(17_700)` (= 1_770_000_000 / 100_000)
- [ ] `operator[1].ethSnapshot.block == 100`
- [ ] `operator[1].ethSnapshot.index == 0`
- [ ] `operator[1].ethSnapshot.balance == PackedETH.wrap(0)`
- [ ] `operator[1].validatorCount == 0`
- [ ] `operator[1].ethValidatorCount == 0`
- [ ] `operator[1].fee == PackedSSV.wrap(0)` (no SSV fee for new operators)
- [ ] `operator[1].snapshot.block == 0` (SSV snapshot NOT initialized)
- [ ] `operator[1].whitelisted == false`
- [ ] `s.operatorsPKs[keccak256(pubkey)] == 1`
- [ ] `s.lastOperatorId.current() == 1`
- [ ] Event: `OperatorAdded(1, msg.sender, pubkey, 1_770_000_000)`
- [ ] Event: `OperatorPrivacyStatusUpdated([1], false)` (per DISC-OV-1)

#### Edge Variations
- Fee = 0: succeeds, `ethFee == PackedETH.wrap(0)`. Can NEVER increase fee.
- `setPrivate = true`: `whitelisted == true`, event with `true`.
- Same pubkey again: revert `OperatorAlreadyExists`.
- Fee not divisible by 100_000: revert `MaxPrecisionExceeded`.

---

### OV-2: Register Operator (Private, Zero Fee) — Free Operator Constraints

**Modules Touched:** SSVOperators

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | `registerOperator(pubkey, 0, true)` | 100 |
| 2 | `declareOperatorFee(1, 500_000)` | 200 |

#### Assertions
- [ ] Step 1: `operator[1].ethFee == PackedETH.wrap(0)`, `whitelisted == true`
- [ ] Step 2: Reverts `FeeIncreaseNotAllowed` (SSVOperators.sol:115)

---

### OV-3: ensureETHDefaults — Critical Default Fee Assignment

**Modules Touched:** OperatorLib

#### Preconditions
- Legacy operator with SSV fee > 0, `ethSnapshot.block == 0`, `ethFee == PackedETH.wrap(0)`

#### Assertions after first ETH interaction at block 200
- [ ] `operator.ethFee == PackedETH.wrap(17_700)` (DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS)
- [ ] `operator.ethSnapshot.block == 200`
- [ ] `operator.ethSnapshot.balance == PackedETH.wrap(0)`

#### Edge Variations
- Legacy operator with SSV fee = 0: ethFee stays 0 (free operator stays free in ETH)
- Already ETH-initialized: no-op

---

### OV-4: Register Validator — New Cluster with 4 Public Operators

**Modules Touched:** SSVValidators, SSVOperators (via OperatorLib)

#### Preconditions
- 4 legacy operators (IDs 1-4) with SSV fee > 0, not yet ETH-initialized
- `sp.ethNetworkFee = PackedETH.wrap(35_509)`

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | `registerValidator{value: 10 ETH}(pubkey, [1,2,3,4], shares, emptyCluster)` | 200 |
| 2 | Advance 100 blocks | 300 |

#### Assertions After Step 1 (block 200)
- [ ] Each `operator[1..4].ethFee == PackedETH.wrap(17_700)`
- [ ] Each `operator[1..4].ethValidatorCount == 1`
- [ ] Each `operator[1..4].ethSnapshot.block == 200`
- [ ] `sp.ethDaoValidatorCount == 1`
- [ ] `sp.daoTotalEthVUnits == 10_000`
- [ ] `cluster.validatorCount == 1`, `cluster.balance == 10e18`, `cluster.active == true`

#### Assertions After Step 2 (block 300, after triggering snapshot update)
Per operator earnings (100 blocks):
- `blockDiffEthFee = 100 * 17_700 = 1_770_000`
- `effectiveVUnits = 0 + 1 * 10_000 = 10_000`
- `delta = (1_770_000 * 10_000) / 10_000 = 1_770_000`
- [ ] Each `operator[1..4].ethSnapshot.balance == PackedETH.wrap(1_770_000)` → `177_000_000_000 wei`

Cluster balance after 100 blocks:
- `operatorIndexDelta = 4 * 1_770_000 = 7_080_000`
- `networkFeeIndexDelta = 100 * 35_509 = 3_550_900`
- `vUnits = 10_000`
- `operatorFeeUnits = (7_080_000 * 10_000) / 10_000 = 7_080_000`
- `networkFeeUnits = (3_550_900 * 10_000) / 10_000 = 3_550_900`
- `totalUsageWei = (7_080_000 + 3_550_900) * 100_000 = 1_063_090_000_000`
- [ ] `cluster.balance == 10e18 - 1_063_090_000_000 = 9_999_998_936_910_000_000`

---

### OV-5: Register Validator — Existing Cluster with Fee Settlement

**Modules Touched:** SSVValidators, ClusterLib, OperatorLib

#### Preconditions
- 4 operators, ETH-initialized at block 200, `ethFee = PackedETH.wrap(17_700)`
- Cluster with 1 validator, `balance == 10 ETH`, created at block 200

#### Action at block 250: Register 2nd validator with 5 ETH deposit
- Settles 50 blocks of fees at 1-validator rate
- `cluster.balance = 15e18 - 531_545_000_000 = 14_999_999_468_455_000_000`
- Each operator `ethValidatorCount == 2`

---

### OV-6–OV-35: [Remaining OV Scenarios]

*See `docs/scenarios/operators-validators.md` for the complete detailed scenarios OV-6 through OV-35, covering:*
- OV-6: Private operator whitelist enforcement
- OV-7: Bulk register validators
- OV-8–9: Remove validator (fee settlement, last validator)
- OV-10: Full validator lifecycle (register→advance→remove→withdraw)
- OV-11–12: Fee declaration/execution/reduction with timelock
- OV-13: Operator earnings accumulation with vUnit deviation
- OV-14: Remove operator — full cleanup and final withdrawal
- OV-15: Fee change during active cluster — no gap/double-count
- OV-16: Multi-cluster operator earnings
- OV-17: Operator removal after all validators removed
- OV-18: Combined ETH + SSV withdrawal
- OV-19–21: Revert cases (register, remove, operator remove)
- OV-22: Same-block register and remove
- OV-23: ensureETHDefaults with zero SSV fee
- OV-24: Precision loss in operator earnings
- OV-25: Cluster balance underflow protection
- OV-26: Exit validator (signal only)
- OV-27: DAO network fee earnings consistency
- OV-28: Operator index frozen after removal
- OV-29: Concurrent fee changes on multiple operators
- OV-30: Operator registration then immediate validator registration
- OV-31: 13-operator cluster gas and correctness
- OV-32: Validator registration with explicit EB
- OV-33: Validator removal with explicit EB — deviation cleanup
- OV-34: Bulk remove validators
- OV-35: Deposit and withdraw — no side effects on operator state

---

## Part 2: Clusters + Migration

### CM-1: ETH Cluster Lifecycle — Create, Deposit, Advance, Withdraw

**Modules Touched:** SSVValidators, SSVClusters, ClusterLib, OperatorLib, ProtocolLib

#### Preconditions
- 4 operators, each `ethFee = 1_000_000_000` (packed raw = 10_000)
- Network fee: raw = 5_000
- `minimumBlocksBeforeLiquidation = 100`

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | Register validator, 10 ETH | B0 |
| 2 | Deposit 5 ETH | B0+50 |
| 3 | Withdraw 2 ETH | B0+100 |

#### Assertions
- Step 2: `cluster.balance = 10e18 + 5e18 = 15e18` (NO fee settlement per DISC-OV-8)
- Step 3: Fees settled for 100 blocks:
  - `operatorFeeUnits = (4_000_000 * 10_000) / 10_000 = 4_000_000`
  - `networkFeeUnits = (500_000 * 10_000) / 10_000 = 500_000`
  - `totalFees = (4_000_000 + 500_000) * 100_000 = 450_000_000_000`
  - `balanceAfterFees = 15e18 - 450_000_000_000`
  - `balanceAfterWithdraw = balanceAfterFees - 2e18 = 12_999_999_550_000_000_000`

---

### CM-2: Withdraw Exactly To Liquidation Threshold (Boundary)

**Bug Class:** Off-by-one in `<` vs `<=` boundary

#### Key Assertion
- `isLiquidatableWithEB` uses `cluster.balance < liquidationThreshold` (strict less-than)
- `balance == threshold` → NOT liquidatable → withdrawal succeeds
- `balance == threshold - 1` → liquidatable → withdrawal reverts `InsufficientBalance`

---

### CM-3: Third-Party Liquidation With Bounty Verification

#### Preconditions
- 1 validator, deposit = 1e12 wei, per-block burn = 4_500_000_000

#### Assertions at block B0+123 (liquidatable):
- `balanceAfterFees = 1e12 - 553_500_000_000 = 446_500_000_000`
- `threshold = 450_000_000_000`
- `446_500_000_000 < 450_000_000_000` → liquidatable
- [ ] Liquidator receives exactly 446_500_000_000 wei
- [ ] `cluster.active == false`, `cluster.balance == 0`
- [ ] Operator `ethValidatorCount` decremented BEFORE balance zeroed (per DISC-CM-4)

---

### CM-4–CM-30: [Remaining CM Scenarios]

*See `docs/scenarios/clusters-migration.md` for complete detailed scenarios CM-4 through CM-30, covering:*
- CM-4: SSV self-liquidation with SSV balance return
- CM-5: Basic SSV→ETH migration with SSV refund
- CM-6: Migration of liquidated SSV cluster
- CM-7: Migration with mixed operator ETH state
- CM-8: Post-migration ETH fee accrual
- CM-9: Reactivation after liquidation
- CM-10: Deposit into liquidated cluster + reactivation
- CM-11: SSV blocked operations verification
- CM-12: Explicit EB fee scaling
- CM-13: Migration with EB deviation sync
- CM-14: Liquidation with EB deviation cleanup
- CM-15: Auto-liquidation via updateClusterBalance
- CM-16: Conservation law — multi-cluster ETH balance tracking
- CM-17: SSV fee accrual precision
- CM-18: SSV refund after extended accrual
- CM-19: Withdraw from empty cluster (validatorCount == 0)
- CM-20: Reactivation with explicit EB deviation restoration
- CM-21: Liquidation boundary (`<` not `<=`)
- CM-22: Migration with removed operator
- CM-23: Withdraw doesn't update operator snapshots
- CM-24: Packing precision enforcement
- CM-25: updateClusterBalance on SSV cluster (EB snapshot only)
- CM-26: Liquidation bounty = post-settlement balance
- CM-27: DAO earnings settlement during migration
- CM-28: Multiple migrations — same operators
- CM-29: Migration with insufficient ETH (boundary)
- CM-30: Full end-to-end lifecycle with conservation proof

---

## Part 3: Effective Balance + Staking

### ES-1: Single Oracle Commit — Below Quorum

**Modules Touched:** SSVDAO

#### Preconditions
- 4 oracles, `quorumBps = 7500`, `cSSV.totalSupply() = 40e9`

#### Assertions
- `weight = 40e9 / 4 = 10e9`
- `threshold = 40e9 * 7500 / 10_000 = 30e9`
- `10e9 < 30e9` → quorum NOT reached
- [ ] `ebRoots[100] == bytes32(0)`, `latestCommittedBlock` unchanged

---

### ES-2: Quorum Reached — 3 of 4 Oracles

#### Assertions
- 3 oracles vote → accumulated = 30e9 = threshold → quorum reached
- [ ] `ebRoots[100] == rootA`, `latestCommittedBlock == 100`
- [ ] `rootCommitments[commitKey] == 0` (deleted)
- [ ] `hasVoted` preserved (prevents re-voting)

---

### ES-6: First EB Update — Implicit to Explicit (Same vUnits)

#### Preconditions
- 2 validators, implicit vUnits = 20_000, EB update to 64 ETH

#### Key Assertion
- `newVUnits = ebToVUnits(64) = ceil(64 * 10_000 / 32) = 20_000`
- `effectiveOldVUnits = 20_000` (implicit = validatorCount * VUNITS_PRECISION)
- `newVUnits == effectiveOldVUnits` → NO deviation change
- [ ] Cluster now has explicit EB, future updates use stored value as baseline

---

### ES-7: EB Increase — Higher Fee Burn Rate

#### Preconditions
- 2 validators, prior explicit vUnits = 20_000, update to 96 ETH at block 300

#### Assertions
- `newVUnits = 30_000`
- Fee settlement uses OLD vUnits (20_000) for blocks 200-300
- After: each `operatorEthVUnits[i] += 10_000` (FULL delta per operator, per DISC-ES-6)
- Future fees scale at 1.5× rate (30_000 / 20_000)

---

### ES-9: Auto-Liquidation on EB Increase

#### Key Flow
- Cluster balance just above threshold at 20_000 vUnits
- EB doubles to 40_000 vUnits → threshold doubles → cluster liquidatable
- `_liquidateAfterEBUpdateIfNeeded` triggers auto-liquidation
- Bounty goes to caller of `updateClusterBalance` (not cluster owner)

---

### ES-15: Basic Stake → Earn → Claim Cycle

#### Preconditions
- 1 cluster with 1 validator generating network fees
- User stakes 10e18 SSV at block 1000

#### Assertions
- Pre-stake fees (blocks 0-1000) are NOT claimable (totalSupply was 0)
- User earns only blocks 1000-1100 fees
- `accEthPerShare += (newFeesWei * 1e18) / 10e18`
- Payout truncated to nearest 100_000 wei (dust stays in accrued)

---

### ES-17: Stake Timing — Late Joiner

#### Steps
- User A stakes 10e18 SSV at block 0
- User B stakes 30e18 SSV at block 50
- Both claim at block 100

#### Math with f = wei/block:
- A: `62.5f` (100% of blocks 0-50 + 25% of blocks 50-100)
- B: `37.5f` (75% of blocks 50-100)
- Sum = 100f = total fees

---

### ES-3–ES-32: [Remaining ES Scenarios]

*See `docs/scenarios/eb-staking.md` for complete detailed scenarios covering:*
- ES-3: Conflicting oracle roots
- ES-4: Oracle replacement mid-vote
- ES-5: Oracle revert cases
- ES-8: EB decrease
- ES-10: Fee settlement uses OLD vUnits (no gap proof)
- ES-11: Operator vUnit tracking across multiple clusters
- ES-12: EB limits enforcement (min/max)
- ES-13: Merkle proof verification
- ES-14: Update frequency and staleness
- ES-16: Multiple stakers — pro-rata distribution
- ES-18: Unstake request → cooldown → withdraw
- ES-19: cSSV transfer settles rewards
- ES-20: Accumulator edge cases (zero supply, monotonicity, dust)
- ES-21: MAX_PENDING_REQUESTS (10)
- ES-22: MINIMAL_STAKING_AMOUNT
- ES-23: syncFees() public function
- ES-24: EB increase → higher staking rewards
- ES-25: Auto-liquidation reduces staking revenue
- ES-26: EB update on SSV cluster (snapshot only)
- ES-27–28: Full staking reward math with precision
- ES-29: requestUnstake + immediate claim
- ES-30: cSSV transfer — mint/burn do NOT trigger hook
- ES-31: Staking with pre-existing DAO balance
- ES-32: EB update → syncFees full chain trace

---

## Part 4: Cross-Cutting Flows

These scenarios test interactions between 3+ modules that no individual partition test can cover.

---

### CC-1: Full Economic Conservation Law

**Modules Touched:** SSVOperators, SSVValidators, SSVClusters, SSVDAO, SSVStaking, ProtocolLib
**Bug Class Covered:** Value creation/destruction — the master invariant

#### Preconditions
- 4 operators registered at block 0 with `ethFee = 2_000_000_000` (packed = 20_000)
- `sp.ethNetworkFee = PackedETH.wrap(10_000)` (= 1_000_000_000 wei/block)
- 1 staker with 10e18 SSV staked → 10e18 cSSV

#### Action Sequence
| Step | Action | Block | ETH In/Out |
|------|--------|-------|------------|
| 1 | Register validator, 10 ETH deposit | 100 | +10 ETH |
| 2 | Register 2nd validator, 5 ETH deposit | 200 | +5 ETH |
| 3 | Advance 100 blocks | 300 | — |
| 4 | Withdraw 1 ETH from cluster | 300 | -1 ETH |
| 5 | Operator 1 withdraws all ETH earnings | 300 | -op1_earnings ETH |

#### Conservation Check at Each Step

**After Step 1 (block 100):**
- Contract ETH = 10 ETH
- Cluster balance (stored) = 10 ETH
- Operator earnings (stored) = 0 (just initialized)
- DAO earnings (stored) = 0
- Staking pool = 0
- **10e18 == 10e18 + 0 + 0 + 0** ✓

**After Step 3 (block 300, before any withdrawals):**
- Contract ETH = 15 ETH (10 + 5 deposited, nothing withdrawn)
- All fees are "pending" — cluster stored balance is still at 15e18 (deposit didn't settle fees)
- Operator stored earnings = 0 (operators haven't been snapshot-updated since step 2)

But the invariant uses STORED values:
- `contract.ETH (15e18) >= cluster.stored_balance (15e18) + Σ(op.stored_earnings) (0) + stored_DAO_earnings (0) + staking_pool (0)`
- `15e18 >= 15e18` ✓

**After Step 4 (block 300, withdraw settles cluster fees):**
- Withdraw triggers fee settlement for the cluster
- Cluster balance = 15e18 - totalFees - 1e18
- Fees computed inline, NOT written to operator storage (per DISC-CM-3)
- Contract ETH = 15e18 - 1e18 = 14e18

Check:
- `14e18 >= cluster.new_stored_balance + Σ(op.stored_earnings=0) + stored_DAO_earnings + staking_pool`
- The gap between contract.ETH and stored values = unsettled operator/DAO earnings
- This is why the invariant uses `>=` not `==`

**After Step 5 (block 300, operator withdrawal):**
- `withdrawAllOperatorEarnings(1)` calls `updateSnapshotSt` → settles operator 1 earnings
- Operator 1 earnings for blocks 100-300 (200 blocks):
  - Blocks 100-200: 1 validator → effectiveVUnits = 10_000
    - `delta = (100 * 20_000 * 10_000) / 10_000 = 2_000_000`
  - Blocks 200-300: 2 validators → effectiveVUnits = 20_000
    - `delta = (100 * 20_000 * 20_000) / 10_000 = 4_000_000`
  - Total: `6_000_000` packed → `600_000_000_000 wei`
- Contract ETH = 14e18 - 600_000_000_000

#### Master Conservation Formula
At any settled point:
```
contract.ETH_balance == Σ(active_cluster.stored_balance)
                      + Σ(operator.ethSnapshot.balance_unpacked)
                      + sp.ethDaoBalance_unpacked
                      + staking_pool_balance
                      + precision_dust (≥ 0)
```

Assertions:
- [ ] Conservation holds after EVERY step (with `>=`)
- [ ] After ALL earnings are withdrawn and settled, conservation holds with `==` (modulo precision dust)
- [ ] Precision dust never exceeds `N_operations * ETH_DEDUCTED_DIGITS` (each operation can lose at most 99_999 wei)

---

### CC-2: Register → Advance → Verify Full Economics (Exact Numbers)

**Modules Touched:** SSVValidators, SSVClusters, SSVOperators, ProtocolLib
**Bug Class Covered:** End-to-end fee accounting correctness

#### Preconditions
- 4 operators (IDs 1-4), public, registered at block 0 with `ethFee = 2_000_000_000` (packed = 20_000)
- `sp.ethNetworkFee = PackedETH.wrap(10_000)` (= 1_000_000_000 wei/block)
- `sp.ethNetworkFeeIndex = 0`, `sp.ethNetworkFeeIndexBlockNumber = 0`

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | `registerValidator{value: 10 ETH}(pk, [1,2,3,4], shares, emptyCluster)` | 100 |
| 2 | Advance 100 blocks | 200 |
| 3 | Trigger full settlement (e.g., `removeValidator` or explicit `withdraw(0)`) | 200 |

#### Exact Math After 100 Blocks (Step 3)

**Each operator's ETH earnings:**
- `blockDiffEthFee = 100 * 20_000 = 2_000_000`
- `effectiveVUnits = 0 + 1 * 10_000 = 10_000`
- `delta = (2_000_000 * 10_000) / 10_000 = 2_000_000`
- Each operator earns: `2_000_000 * 100_000 = 200_000_000_000 wei`
- 4 operators total: `800_000_000_000 wei`

**Cluster balance deduction:**
- `operatorIndexDelta = 4 * 2_000_000 = 8_000_000`
- `networkFeeIndexDelta = 100 * 10_000 = 1_000_000`
- `vUnits = 10_000`
- `operatorFeeUnits = (8_000_000 * 10_000) / 10_000 = 8_000_000`
- `networkFeeUnits = (1_000_000 * 10_000) / 10_000 = 1_000_000`
- `totalFees = (8_000_000 + 1_000_000) * 100_000 = 900_000_000_000`
- `cluster.balance = 10e18 - 900_000_000_000 = 9_999_999_100_000_000_000`

**DAO ETH earnings (network fee portion):**
- `networkTotalEarnings = ethDaoBalance + (blockDiff * networkFee * daoTotalEthVUnits) / VUNITS_PRECISION`
- `= 0 + (100 * 10_000 * 10_000) / 10_000 = 1_000_000` packed
- `= 1_000_000 * 100_000 = 100_000_000_000 wei`

**Conservation check:**
```
cluster.balance     = 9_999_999_100_000_000_000
operator_earnings   = 4 * 200_000_000_000 = 800_000_000_000
DAO_earnings        = 100_000_000_000
Sum                 = 9_999_999_100_000_000_000 + 800_000_000_000 + 100_000_000_000
                    = 10_000_000_000_000_000_000 = 10 ETH ✓
```

#### Assertions
- [ ] Each operator earns exactly `200_000_000_000 wei`
- [ ] Cluster balance = `9_999_999_100_000_000_000`
- [ ] DAO earnings = `100_000_000_000 wei`
- [ ] Sum == 10 ETH (exact conservation, no precision loss in this case)

---

### CC-3: Migration → Register → EB Update → Fee Change → Liquidation

**Modules Touched:** SSVClusters, SSVValidators, SSVOperators, SSVDAO, OperatorLib, ClusterLib, ProtocolLib
**Bug Class Covered:** Multi-step state transitions with exact accounting at each phase

#### Preconditions
- 4 operators (IDs 1-4), SSV fee > 0 (packed raw = 1_000), ETH not yet initialized
- SSV cluster: 2 validators, balance = 100e18 SSV, created at block 0
- `sp.ssvNetworkFee` raw = 500
- `sp.ethNetworkFee = PackedETH.wrap(10_000)` (1e9 wei/block)
- `minimumBlocksBeforeLiquidation = 100`
- `DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000` → packed = 17_700

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | Migrate SSV cluster to ETH with `msg.value = 5 ETH` | 500 |
| 2 | Register 3rd validator, deposit 0 ETH | 600 |
| 3 | Oracle commits EB root, then `updateClusterBalance(EB=192)` | 700 |
| 4 | Operator 1 declares fee 2_000_000_000 (packed 20_000) | 700 |
| 5 | Operator 1 executes fee at block 800 (within timelock) | 800 |
| 6 | Advance until cluster approaches liquidation | ~5500 |
| 7 | Third-party liquidates | ~5500 |
| 8 | Operator 1 withdraws all earnings | 5500 |

#### Step 1: Migration at block 500

**SSV fee settlement (500 blocks):**
- `operatorIndexDelta = 4 * 500 * 1_000 = 2_000_000`
- `networkFeeIndexDelta = 500 * 500 = 250_000`
- `usage_packed = 2_000_000 * 2 + 250_000 * 2 = 4_500_000`
- `usage_unpacked = 4_500_000 * 10_000_000 = 45_000_000_000_000`
- `ssvRefund = 100e18 - 45_000_000_000_000 = 99_999_955_000_000_000_000`
- [ ] Owner receives 99_999_955_000_000_000_000 SSV tokens

**ETH cluster setup:**
- All 4 operators: `ensureETHDefaults()` → `ethFee = PackedETH.wrap(17_700)`
- `cluster.balance = 5e18`, `cluster.index = 0` (all operators are ETH-new)
- Each operator `ethValidatorCount = 2`
- `sp.ethDaoValidatorCount = 2`, `sp.daoTotalEthVUnits = 20_000`

#### Step 2: Register 3rd validator at block 600

**Fee settlement (100 blocks at 2 validators):**
- Each operator: `blockDiffEthFee = 100 * 17_700 = 1_770_000`, `effectiveVUnits = 20_000`
  - `delta = (1_770_000 * 20_000) / 10_000 = 3_540_000`
- `opIndexDelta = 4 * 1_770_000 = 7_080_000`
- `netIndexDelta = 100 * 10_000 = 1_000_000`
- `opFeeUnits = (7_080_000 * 20_000) / 10_000 = 14_160_000`
- `netFeeUnits = (1_000_000 * 20_000) / 10_000 = 2_000_000`
- `totalFees = (14_160_000 + 2_000_000) * 100_000 = 1_616_000_000_000`
- `cluster.balance = 5e18 - 1_616_000_000_000 = 4_999_998_384_000_000_000`
- After: `validatorCount = 3`, each operator `ethValidatorCount = 3`
- `sp.daoTotalEthVUnits = 30_000`, `sp.ethDaoValidatorCount = 3`

#### Step 3: EB Update to 192 ETH at block 700

- `newVUnits = ebToVUnits(192) = ceil(192 * 10_000 / 32) = 60_000`
- `effectiveOldVUnits = 30_000` (implicit: 3 * 10_000)

**Fee settlement (100 blocks at OLD vUnits = 30_000):**
- Each operator: `blockDiffEthFee = 100 * 17_700 = 1_770_000`, `effectiveVUnits = 0 + 3 * 10_000 = 30_000`
  - `delta = (1_770_000 * 30_000) / 10_000 = 5_310_000`
- `opIndexDelta = 4 * 1_770_000 = 7_080_000`
- `netIndexDelta = 100 * 10_000 = 1_000_000`
- `opFeeUnits = (7_080_000 * 30_000) / 10_000 = 21_240_000`
- `netFeeUnits = (1_000_000 * 30_000) / 10_000 = 3_000_000`
- `totalFees = (21_240_000 + 3_000_000) * 100_000 = 2_424_000_000_000`
- `cluster.balance = 4_999_998_384_000_000_000 - 2_424_000_000_000 = 4_999_995_960_000_000_000`

**vUnit update:**
- `deviation = 60_000 - 30_000 = 30_000`
- Each `operatorEthVUnits[i] += 30_000` (full delta per operator!)
- `sp.daoTotalEthVUnits += 30_000` → now 60_000
- `ebSnapshot = {vUnits: 60_000, ...}`

#### Steps 4-5: Fee change
- Operator 1 declares fee increase to 20_000 packed, executes at block 800
- Earnings from 700-800 settled at OLD fee 17_700 before fee change

#### Steps 6-7: Liquidation (approximate)
- New per-block burn with 60_000 vUnits: `burnRate = 4 * 17_700 + 1 * (20_000 - 17_700) = 72_600` (op1 at 20_000, others at 17_700)
  - Actually, `burnRate` is the cumulativeFee for liquidation check, but vUnits scaling changes the threshold
- The cluster balance decreases until liquidatable
- Bounty = remaining balance after fee settlement

#### Assertions
- [ ] SSV refund exact at step 1
- [ ] ETH conservation at every step
- [ ] Fee settlement uses OLD vUnits before EB update
- [ ] Operator deviation = 30_000 per operator (full delta, not divided)
- [ ] Liquidation bounty is exact post-settlement balance
- [ ] After operator withdrawal, total withdrawn matches cumulative earnings

---

### CC-4: Multi-Staker Revenue Distribution Through State Changes

**Modules Touched:** SSVStaking, SSVClusters, ProtocolLib, CSSVToken
**Bug Class Covered:** Staking accumulator correctness across multiple phases

#### Preconditions
- 1 ETH cluster: 1 validator, 4 operators at `ethFee = PackedETH.wrap(20_000)`
- `sp.ethNetworkFee = PackedETH.wrap(10_000)`
- `sp.daoTotalEthVUnits = 10_000`

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | User A stakes 100e18 SSV | 0 |
| 2 | Advance 50 blocks | 50 |
| 3 | User B stakes 300e18 SSV | 50 |
| 4 | Advance 50 blocks | 100 |
| 5 | EB update doubles vUnits (64 ETH for 1 validator → vUnits = 20_000) | 100 |
| 6 | Advance 50 blocks | 150 |
| 7 | User A claims | 150 |
| 8 | User B claims | 150 |

#### DAO Earnings Per Block

**Phase 1 (blocks 0-50, vUnits = 10_000):**
- `earningsPerBlock (packed) = (1 * 10_000 * 10_000) / 10_000 = 10_000`
- `earningsPerBlock (wei) = 10_000 * 100_000 = 1_000_000_000`

**Phase 2 (blocks 50-100, vUnits = 10_000):**
- Same: `1_000_000_000 wei/block`

**Phase 3 (blocks 100-150, vUnits = 20_000):**
- `earningsPerBlock (packed) = (1 * 10_000 * 20_000) / 10_000 = 20_000`
- `earningsPerBlock (wei) = 20_000 * 100_000 = 2_000_000_000`

#### Staking Math

**At block 0 (User A stakes 100e18):**
- `_syncFees`: no prior fees (block 0). If `ethDaoBalance = 0` and `ethDaoIndexBlockNumber = 0`:
  - `current = 0 + (0 * 10_000 * 10_000) / 10_000 = 0`
  - No new fees → `accEthPerShare = 0`
- `userIndex[A] = 0`
- `cSSV.totalSupply() = 100e18`

**At block 50 (User B stakes 300e18):**
- `_syncFees`:
  - `current = 0 + (50 * 10_000 * 10_000) / 10_000 = 500_000` packed
  - `previous = 0`
  - `newFeesWei = 500_000 * 100_000 = 50_000_000_000`
  - `accEthPerShare += (50_000_000_000 * 1e18) / 100e18 = 500_000_000`
- `_settle(B)`: `bal = 0` → no-op, `userIndex[B] = 500_000_000`
- Mint 300e18 cSSV → `totalSupply = 400e18`

**At block 100 (EB update — `_syncFees` NOT called by updateClusterBalance, only by staking functions):**
- EB update modifies `daoTotalEthVUnits = 20_000`
- But `_syncFees` is NOT called here — stakers need to explicitly interact

**At block 150 (User A claims):**
- `_syncFees`:
  - DAO earnings from block 50 to 150:
    - Blocks 50-100: `50 * 10_000 * 10_000 / 10_000 = 500_000` packed
    - But wait: `updateDAOEarnings` was called at block 100 (during EB update's `updateDAOEthVUnits`)
    - So `ethDaoBalance` at block 100 = `500_000 + 500_000 = 1_000_000` packed, `ethDaoIndexBlockNumber = 100`
    - From block 100 to 150: `50 * 10_000 * 20_000 / 10_000 = 1_000_000` packed
    - `current = 1_000_000 + 1_000_000 = 2_000_000` packed
  - `previous = stakingEthPoolBalance = 500_000` (set at block 50)
  - `packedNewFees = 2_000_000 - 500_000 = 1_500_000`
  - `newFeesWei = 1_500_000 * 100_000 = 150_000_000_000`
  - `accEthPerShare += (150_000_000_000 * 1e18) / 400e18 = 375_000_000`
  - Total `accEthPerShare = 500_000_000 + 375_000_000 = 875_000_000`

- `_settle(A)`:
  - `bal = 100e18` (A's cSSV balance)
  - `pending = (100e18 * (875_000_000 - 0)) / 1e18 = 87_500_000_000`
  - `accrued[A] = 87_500_000_000`

**User A's claimed rewards:**
- Phase 1 (blocks 0-50): A was sole staker → 100% of 50_000_000_000 = `50_000_000_000`
- Phase 2 (blocks 50-100): A has 100e18 / 400e18 = 25% of 50_000_000_000 = `12_500_000_000`
- Phase 3 (blocks 100-150): A has 25% of 100_000_000_000 = `25_000_000_000`
- Total A: `50_000_000_000 + 12_500_000_000 + 25_000_000_000 = 87_500_000_000` ✓

**At block 150 (User B claims):**
- `_syncFees`: no new blocks → no change
- `_settle(B)`:
  - `pending = (300e18 * (875_000_000 - 500_000_000)) / 1e18 = 300 * 375_000_000 = 112_500_000_000`
  - `accrued[B] = 112_500_000_000`

**User B's claimed rewards:**
- Phase 2: B has 75% of 50_000_000_000 = `37_500_000_000`
- Phase 3: B has 75% of 100_000_000_000 = `75_000_000_000`
- Total B: `37_500_000_000 + 75_000_000_000 = 112_500_000_000` ✓

**Conservation:** `87_500_000_000 + 112_500_000_000 = 200_000_000_000` = total fees for 150 blocks ✓

#### Assertions
- [ ] User A gets exactly `87_500_000_000 wei` (100% of phase 1, 25% of phases 2+3)
- [ ] User B gets exactly `112_500_000_000 wei` (75% of phases 2+3)
- [ ] Sum = total DAO earnings for 150 blocks
- [ ] EB update at block 100 correctly doubles DAO earning rate from block 100 onward
- [ ] `accEthPerShare` only increases (monotonic)

---

### CC-5: Operator Serving Multiple Clusters with Different EBs

**Modules Touched:** SSVClusters, SSVOperators, OperatorLib, SSVStorageEB
**Bug Class Covered:** Operator vUnit deviation accumulation across clusters

#### Preconditions
- Operator O (ID=1) serves:
  - Cluster A: 2 validators, operators [1,2,3,4], registered at block 0
  - Cluster B: 3 validators, operators [1,2,3,4], registered at block 0
- `ethFee = PackedETH.wrap(20_000)` (2e9 wei/block) for all operators
- `sp.ethNetworkFee = PackedETH.wrap(10_000)`
- `operatorEthVUnits[1] = 0` initially

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | EB update Cluster A: 96 ETH (2 validators) → vUnits = 30_000 | 100 |
| 2 | EB update Cluster B: 128 ETH (3 validators) → vUnits = 40_000 | 100 |
| 3 | Advance 100 blocks | 200 |
| 4 | Liquidate Cluster A | 200 |
| 5 | Advance 100 blocks | 300 |

#### Step 1: Cluster A EB update
- `effectiveOldVUnits = 2 * 10_000 = 20_000` (implicit)
- `newVUnits = ebToVUnits(96) = ceil(96 * 10_000 / 32) = 30_000`
- Deviation = `30_000 - 20_000 = 10_000`
- Each `operatorEthVUnits[i] += 10_000`
- O's `operatorEthVUnits[1] = 10_000`

#### Step 2: Cluster B EB update
- `effectiveOldVUnits = 3 * 10_000 = 30_000` (implicit)
- `newVUnits = ebToVUnits(128) = ceil(128 * 10_000 / 32) = 40_000`
- Deviation = `40_000 - 30_000 = 10_000`
- Each `operatorEthVUnits[i] += 10_000`
- O's `operatorEthVUnits[1] = 10_000 + 10_000 = 20_000`

#### Step 3: Operator earnings for 100 blocks (100-200)
- O's `ethValidatorCount = 2 + 3 = 5`
- `effectiveVUnits = 20_000 + 5 * 10_000 = 70_000`
- `blockDiffEthFee = 100 * 20_000 = 2_000_000`
- `delta = (2_000_000 * 70_000) / 10_000 = 14_000_000`
- O earns: `14_000_000 * 100_000 = 1_400_000_000_000 wei`

#### Step 4: Liquidate Cluster A
- `updateClusterOperators` called → settles operator snapshots up to block 200 (already settled in step 3 calc)
- O's `ethValidatorCount -= 2` → `ethValidatorCount = 3`
- `_executeLiquidation`:
  - `sp.updateDAO(false, 2)` → `sp.daoTotalEthVUnits -= 20_000` (baseline)
  - `vUnitsCluster = 30_000`, `baseline = 20_000`, deviation = 10_000
  - `sp.daoTotalEthVUnits -= 10_000` (deviation)
  - `operatorEthVUnits[1] -= 10_000` → now 10_000

#### Step 5: Earnings for blocks 200-300 (after liquidation)
- O's `ethValidatorCount = 3` (only Cluster B)
- `effectiveVUnits = 10_000 + 3 * 10_000 = 40_000`
- `delta = (2_000_000 * 40_000) / 10_000 = 8_000_000`
- O earns: `8_000_000 * 100_000 = 800_000_000_000 wei`

#### Assertions
- [ ] After step 2: O's `operatorEthVUnits[1] == 20_000` (sum of both deviations)
- [ ] After step 2: O's `effectiveVUnits = 70_000` (20_000 deviation + 5 * 10_000 baseline)
- [ ] After step 4: O's `operatorEthVUnits[1] == 10_000` (Cluster A deviation removed)
- [ ] After step 4: O's `effectiveVUnits = 40_000` (10_000 deviation + 3 * 10_000)
- [ ] Earnings rate decreased correctly: 1.4e12/100 blocks → 0.8e12/100 blocks
- [ ] `sp.daoTotalEthVUnits` correctly tracks: started at 50_000, +20_000 (both deviations), -30_000 (liquidation) = 40_000

---

### CC-6: Staking Rewards Through Liquidation Event

**Modules Touched:** SSVStaking, SSVClusters, ProtocolLib
**Bug Class Covered:** Clean transition of staking rewards when cluster count changes

#### Preconditions
- 2 clusters: Cluster A (1 validator), Cluster B (1 validator)
- `sp.daoTotalEthVUnits = 20_000`, `sp.ethNetworkFee = PackedETH.wrap(10_000)`
- 1 staker with 10e18 cSSV
- `accEthPerShare = 0`, block 0

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | Advance 100 blocks | 100 |
| 2 | Cluster A gets liquidated | 100 |
| 3 | Advance 100 blocks | 200 |
| 4 | Staker claims | 200 |

#### Math

**Phase 1 (blocks 0-100, 2 clusters active, daoTotalEthVUnits = 20_000):**
- `earningsPerBlock = (1 * 10_000 * 20_000) / 10_000 = 20_000` packed
- Total: `100 * 20_000 = 2_000_000` packed

**At block 100 (liquidation):**
- `_executeLiquidation` → `sp.updateDAO(false, 1)`:
  - `updateDAOEarnings(sp)` called FIRST:
    - `sp.ethDaoBalance = 0 + (100 * 10_000 * 20_000) / 10_000 = 2_000_000` packed
    - `sp.ethDaoIndexBlockNumber = 100`
  - Then: `sp.ethDaoValidatorCount -= 1`, `sp.daoTotalEthVUnits -= 10_000` → now 10_000

**Phase 2 (blocks 100-200, 1 cluster active, daoTotalEthVUnits = 10_000):**
- `earningsPerBlock = (1 * 10_000 * 10_000) / 10_000 = 10_000` packed
- Total: `100 * 10_000 = 1_000_000` packed

**At block 200 (staker claims):**
- `_syncFees`:
  - `current = 2_000_000 + (100 * 10_000 * 10_000) / 10_000 = 2_000_000 + 1_000_000 = 3_000_000` packed
  - `previous = 0`
  - `newFeesWei = 3_000_000 * 100_000 = 300_000_000_000`
  - `accEthPerShare += (300_000_000_000 * 1e18) / 10e18 = 30_000_000_000`
- `_settle(staker)`:
  - `pending = (10e18 * 30_000_000_000) / 1e18 = 300_000_000_000`

#### Assertions
- [ ] Staker receives `300_000_000_000 wei` total
- [ ] This equals: 100 blocks × 2e10/block + 100 blocks × 1e10/block = 2e12 + 1e12 = 3e11... wait
  - `100 * 20_000 * 100_000 = 200_000_000_000` (phase 1)
  - `100 * 10_000 * 100_000 = 100_000_000_000` (phase 2)
  - Total = `300_000_000_000` ✓
- [ ] DAO earnings settled at exact liquidation block (no gap)
- [ ] daoTotalEthVUnits decreased at liquidation → lower earning rate phase 2
- [ ] No phantom rewards from liquidated cluster after block 100
- [ ] `accEthPerShare` monotonically increases

---

### CC-7: Migration Race — Two Clusters, Same Operators

**Modules Touched:** SSVClusters, OperatorLib, ProtocolLib
**Bug Class Covered:** Operator ETH state correctness after sequential migrations

#### Preconditions
- Operators 1-4: SSV fee > 0 (`fee = PackedSSV.wrap(1_000)`), no ETH state
- Cluster A: [1,2,3,4], 1 validator, balance = 50e18 SSV
- Cluster B: [1,2,3,4], 2 validators, balance = 80e18 SSV
- Both created at block 0

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | Migrate Cluster A with 5 ETH | 100 |
| 2 | Migrate Cluster B with 10 ETH | 200 |

#### Step 1: Migrate Cluster A

**For each operator (in `updateClusterOperatorsMigration`):**
- SSV snapshot updated, `validatorCount -= 1`
- `ethSnapshot.block == 0` → `ensureETHDefaults()`:
  - `ethSnapshot.block = 100`, `ethFee = PackedETH.wrap(17_700)`
- `ethValidatorCount += 1` → `ethValidatorCount = 1`
- `cumulativeIndexETH = 0` (newly initialized, index = 0)

**Cluster A ETH state:**
- `cluster.index = 0`, `cluster.balance = 5e18`

#### Step 2: Migrate Cluster B (100 blocks later)

**For each operator:**
- SSV snapshot updated, `validatorCount -= 2`
- `ethSnapshot.block != 0` (set at block 100) → take `else` branch:
  - `updateSnapshotSt(operator, id)`:
    - `blockDiffEthFee = (200 - 100) * 17_700 = 1_770_000`
    - `effectiveVUnits = 0 + 1 * 10_000 = 10_000` (1 validator from Cluster A)
    - `delta = (1_770_000 * 10_000) / 10_000 = 1_770_000`
    - `ethSnapshot.balance += PackedETH.wrap(1_770_000)`
    - `ethSnapshot.index += 1_770_000`
  - `cumulativeIndexETH += operator.ethSnapshot.index` (= 1_770_000 per operator)
- `ethValidatorCount += 2` → `ethValidatorCount = 3`
- `cumulativeFeeETH = 4 * 17_700 = 70_800`

**Cluster B ETH state:**
- `cluster.index = 4 * 1_770_000 = 7_080_000` (non-zero! captures existing indices)
- `cluster.balance = 10e18`

#### Assertions
- [ ] After step 1: each operator `ethValidatorCount == 1`, `ethSnapshot.block == 100`
- [ ] After step 1: NO `ensureETHDefaults()` needed at step 2 (already initialized)
- [ ] After step 2: each operator `ethValidatorCount == 3` (not double-counted)
- [ ] After step 2: Cluster B's `cluster.index == 7_080_000` (captures 100 blocks of earnings)
- [ ] After step 2: operators earned 100 blocks of fees from Cluster A's 1 validator
- [ ] No double-counting of validators across migrations

---

### CC-8: cSSV Transfer Mid-Revenue-Accrual

**Modules Touched:** CSSVToken, SSVStaking, ProtocolLib
**Bug Class Covered:** Transfer hook correctly settles both parties at pre-transfer balances

#### Preconditions
- User A: 100e18 cSSV, User B: 0 cSSV
- 1 cluster generating network fees at `10_000` packed/block → `1_000_000_000 wei/block`
- `sp.daoTotalEthVUnits = 10_000`
- `accEthPerShare = 0`, block 0

#### Action Sequence
| Step | Action | Block |
|------|--------|-------|
| 1 | Revenue accrues 50 blocks | 50 |
| 2 | A transfers 50e18 cSSV to B | 50 |
| 3 | Revenue accrues 50 more blocks | 100 |
| 4 | A claims | 100 |
| 5 | B claims | 100 |

#### Math

**DAO earnings per block:** `(1 * 10_000 * 10_000) / 10_000 = 10_000` packed → `1_000_000_000 wei`

**At block 50 (transfer triggers `onCSSVTransfer`):**
- `_syncFees`:
  - `current = 50 * 10_000 = 500_000` packed
  - `newFeesWei = 500_000 * 100_000 = 50_000_000_000`
  - `accEthPerShare += (50_000_000_000 * 1e18) / 100e18 = 500_000_000`
- `_settle(A)`:
  - `bal = cSSV.balanceOf(A) = 100e18` (PRE-TRANSFER balance!)
  - `pending = (100e18 * 500_000_000) / 1e18 = 50_000_000_000`
  - `accrued[A] = 50_000_000_000`
  - `userIndex[A] = 500_000_000`
- `_settle(B)`:
  - `bal = cSSV.balanceOf(B) = 0` (PRE-TRANSFER!)
  - `pending = 0`
  - `userIndex[B] = 500_000_000`
- Then ERC20 transfer: A has 50e18 cSSV, B has 50e18 cSSV

**At block 100 (A claims):**
- `_syncFees`:
  - `newFeesWei = 50_000_000_000` (50 more blocks)
  - `accEthPerShare += (50_000_000_000 * 1e18) / 100e18 = 500_000_000`
  - Total `accEthPerShare = 1_000_000_000`
- `_settle(A)`:
  - `pending = (50e18 * (1_000_000_000 - 500_000_000)) / 1e18 = 25_000_000_000`
  - `accrued[A] = 50_000_000_000 + 25_000_000_000 = 75_000_000_000`
- A's total = `75_000_000_000 wei`

**At block 100 (B claims):**
- `_settle(B)`:
  - `pending = (50e18 * (1_000_000_000 - 500_000_000)) / 1e18 = 25_000_000_000`
  - `accrued[B] = 25_000_000_000`
- B's total = `25_000_000_000 wei`

#### Assertions
- [ ] A gets 100% of first 50 blocks (`50_000_000_000`) + 50% of next 50 blocks (`25_000_000_000`) = `75_000_000_000`
- [ ] B gets 50% of next 50 blocks (`25_000_000_000`)
- [ ] Sum = `100_000_000_000` = total DAO earnings for 100 blocks ✓
- [ ] `_beforeTokenTransfer` settles BEFORE balances change
- [ ] Transfer to B sets `userIndex[B] = accEthPerShare` → no retroactive earnings

---

### CC-9: Governance Parameter Change Mid-Operation

**Modules Touched:** SSVDAO, SSVClusters, SSVOperators, ProtocolLib
**Bug Class Covered:** Parameter changes applied at correct boundary

#### Sub-scenario 9a: Network Fee Update

**Preconditions:**
- Cluster with 1 validator, balance = 10 ETH, created at block 0
- `sp.ethNetworkFee = PackedETH.wrap(10_000)` initially
- 4 operators, `ethFee = PackedETH.wrap(20_000)`

**Actions:**
| Step | Action | Block |
|------|--------|-------|
| 1 | Advance 100 blocks | 100 |
| 2 | Owner calls `updateNetworkFee(2_000_000_000)` → packed = 20_000 | 100 |
| 3 | Advance 100 blocks | 200 |
| 4 | Withdraw from cluster | 200 |

**Network fee index calculation:**
- `updateNetworkFee` calls `updateDAOEarnings` → settles at old fee
- Then sets `sp.ethNetworkFee = PackedETH.wrap(20_000)` and `sp.ethNetworkFeeIndex = currentIndex`
- `currentIndex at block 100 = 0 + 100 * 10_000 = 1_000_000`
- After update: `ethNetworkFeeIndex = 1_000_000`, `ethNetworkFeeIndexBlockNumber = 100`

**At block 200 withdraw:**
- `currentNetworkFeeIndex = 1_000_000 + (200 - 100) * 20_000 = 3_000_000`
- `networkFeeIndexDelta = 3_000_000 - cluster.networkFeeIndex_at_creation`

If cluster was created at block 0 with `networkFeeIndex = 0`:
- Total delta = `3_000_000`
- This correctly represents: 100 blocks at 10_000 + 100 blocks at 20_000 = 1_000_000 + 2_000_000

#### Assertions
- [ ] Old fee used for blocks 0-100, new fee for blocks 100-200
- [ ] Transition is seamless via network fee index accumulator
- [ ] DAO earnings settled at exact block of fee change

#### Sub-scenario 9b: Liquidation Threshold Update

**Preconditions:**
- Cluster at block 200, balance just above old threshold
- `minimumBlocksBeforeLiquidation = 200` → threshold = X
- Cluster balance = X + 1 wei

**Actions:**
| Step | Action | Block |
|------|--------|-------|
| 1 | Owner updates `minimumBlocksBeforeLiquidation = 400` | 200 |
| 2 | Third-party tries to liquidate | 200 |

**Assertions:**
- [ ] New threshold = 2 × old threshold (doubled blocks)
- [ ] Cluster that was safe is now liquidatable
- [ ] Liquidation succeeds immediately after parameter change

---

### CC-10: Full System Lifecycle (End-to-End)

**Modules Touched:** ALL modules
**Bug Class Covered:** Complete system correctness across full lifecycle

#### Preconditions
- Empty system, block 0
- `sp.ethNetworkFee = PackedETH.wrap(10_000)` (1e9 wei/block)
- `minimumBlocksBeforeLiquidation = 100`
- `declareOperatorFeePeriod = 100 seconds`
- `executeOperatorFeePeriod = 200 seconds`

#### Action Sequence
| Step | Action | Block | Time |
|------|--------|-------|------|
| 1 | Register 4 operators with fee 2e9 (packed 20_000) | 10 | T0 |
| 2 | User A stakes 50e18 SSV | 20 | T1 |
| 3 | Register validator, 10 ETH deposit | 100 | T2 |
| 4 | Advance 100 blocks | 200 | T3 |
| 5 | Oracle commits EB root | 200 | T3 |
| 6 | `updateClusterBalance(EB=48 ETH, 1 validator)` | 200 | T3 |
| 7 | Advance 100 blocks | 300 | T4 |
| 8 | Operator 1 declares fee increase to 2.2e9 (packed 22_000) | 300 | T4 |
| 9 | Advance (past timelock), execute fee | 400 | T5 |
| 10 | Register 2nd validator, 0 deposit | 400 | T5 |
| 11 | Advance 100 blocks | 500 | T6 |
| 12 | User A claims staking rewards | 500 | T6 |
| 13 | Remove 1st validator | 500 | T6 |
| 14 | Advance 100 blocks | 600 | T7 |
| 15 | Withdraw remaining cluster balance | 600 | T7 |
| 16 | Remove operator (after removing all validators) | 600 | T7 |

#### Key State Changes to Track

**Step 6: EB Update to 48 ETH (1 validator)**
- `newVUnits = ebToVUnits(48) = ceil(48 * 10_000 / 32) = 15_000`
- `effectiveOldVUnits = 1 * 10_000 = 10_000` (implicit)
- Deviation = 5_000
- Fee settlement for blocks 100-200 at OLD vUnits = 10_000
- Then `operatorEthVUnits[1..4] += 5_000` each
- `sp.daoTotalEthVUnits = 10_000 + 5_000 = 15_000`

**Step 9: Fee execution**
- Settles operator 1 earnings from block 200 to 400 at old fee 20_000
- With `effectiveVUnits = 5_000 + 1 * 10_000 = 15_000`
- Then `ethFee` changes to 22_000

**Step 10: Register 2nd validator**
- EB snapshot has `vUnits = 15_000`, so: `ebSnapshot.vUnits += 1 * 10_000 = 25_000`
- `sp.daoTotalEthVUnits += 10_000` → now 25_000
- Each operator `ethValidatorCount = 2`

**Step 12: User A claims staking rewards**
- `_syncFees` gathers all DAO earnings from block 20 to 500
- Multiple phases with different `daoTotalEthVUnits`:
  - Blocks 20-100: vUnits = 0 (no cluster yet) → 0 earnings
  - Blocks 100-200: vUnits = 10_000 → earnings rate 10_000
  - Blocks 200-300: vUnits = 15_000 (after EB update) → earnings rate 15_000
  - Blocks 300-400: vUnits = 15_000 → same
  - Blocks 400-500: vUnits = 25_000 (after 2nd validator) → earnings rate 25_000

**Step 13: Remove 1st validator**
- EB snapshot: `vUnits = 25_000 - 10_000 = 15_000`, if `validatorCount == 1`
  - If `validatorCount == 1` and `ebSnapshot.vUnits > 0`: deduct baseline
  - Remaining deviation = `15_000 - 1 * 10_000 = 5_000`
- Each operator `ethValidatorCount = 1`

**Step 16: Final verification**
After all operations:
- [ ] All cluster balances add up with all operator earnings and DAO earnings = total ETH deposited minus withdrawals
- [ ] All SSV staking rewards match DAO network fee earnings
- [ ] cSSV supply matches active stakes
- [ ] `ethDaoValidatorCount == Σ(operator.ethValidatorCount)`
- [ ] `daoTotalEthVUnits == ethDaoValidatorCount * 10_000 + Σ(deviations)`

---

## Gap Analysis: Cross-Partition Findings

### Finding 1: DISC-OV-8 and DISC-CM-1 are the same discrepancy (deposit doesn't settle fees)
Both OV and CM partitions independently discovered this. The scenarios are consistent: deposit is intentionally simple, and tests should NOT expect fee settlement on deposit.

### Finding 2: DISC-OV-9 and DISC-CM-2 are the same discrepancy (deposit doesn't check active)
Same cross-partition duplication. Code is intentional.

### Finding 3: Operator removal without validator count check (DISC-OV-3) has cross-module implications
This discrepancy affects the global invariant `ethDaoValidatorCount == Σ(operator.ethValidatorCount)`. If an operator with active validators is removed, the invariant breaks. However, the cluster's fee calculation still works because:
- The removed operator's index is frozen (DISC-OV-4)
- The cluster stops accruing fees for the removed operator
- **BUT**: `ethDaoValidatorCount` is NOT decremented, causing `daoTotalEthVUnits` to be overstated
- This means DAO earns MORE network fees than clusters actually pay → conservation law still holds (DAO overcounts)
- The excess is "phantom earnings" that no one can claim (clusters don't pay for the removed operator)
- **Impact on staking**: staking rewards would be slightly higher than actual fee revenue → potential insolvency of staking pool

### Finding 4: `_updateOperatorVUnits` applies FULL deviation per operator (DISC-ES-6)
This is consistent with `_executeLiquidation` and `_bulkRemoveValidator` cleanup. The pattern is deliberate: each operator tracks the sum of deviations from ALL clusters it serves. OV-33 verified this is NOT a bug. Cross-partition consistency confirmed.

### Finding 5: Withdraw not updating operator snapshots (DISC-CM-3) is NOT a partition-specific issue
This affects the conservation law: after a withdraw, stored operator balances are stale. The conservation law uses `>=` to handle this. Cross-cutting tests must account for this when checking exact balances.

### Finding 6: Missing cross-module scenario — DAO earnings during staking claims
When a staker calls `claimEthRewards`, both `sp.ethDaoBalance` and `s.stakingEthPoolBalance` are decremented. If multiple stakers claim in sequence, each claim's `_syncFees` re-settles the DAO earnings. The `current <= previous` path (DISC-ES-2) handles the case where a claim reduces `ethDaoBalance` below `stakingEthPoolBalance`.

### Finding 7: No partition tested the oracle-staking coupling
ES-5c noted that `cSSV.totalSupply() == 0` blocks oracle commits (`OracleHasZeroWeight`). This means: no staking → no EB updates → no explicit vUnit tracking. This coupling was identified but no cross-cutting scenario tests the full chain: stake → oracle commit → EB update → staking rewards increase.

---

## Appendix: Cross-Module Interaction Map

| Source Module | Target State | Write | Read | Key Functions |
|---|---|---|---|---|
| SSVClusters.liquidate | StorageProtocol | `daoTotalEthVUnits ±=`, `ethDaoBalance` | `ethNetworkFee`, `minimumBlocksBeforeLiquidation` | `updateDAO`, `_executeLiquidation` |
| SSVClusters.migrate | StorageProtocol + StorageEB | `updateDAO`, `daoTotalEthVUnits`, `operatorEthVUnits[]` | `currentNetworkFeeIndex()` | `updateClusterOperatorsMigration` |
| SSVClusters.updateEB | StorageProtocol + StorageEB | `updateDAOEthVUnits()`, `operatorEthVUnits[]`, `clusterEB[].vUnits` | `currentNetworkFeeIndex()` | `_applyClusterFeeUpdates`, `_updateOperatorVUnits` |
| SSVStaking._syncFees | StorageProtocol + StorageStaking | `ethDaoBalance`, `ethDaoIndexBlockNumber`, `accEthPerShare` | `networkTotalEarnings()` (reads `daoTotalEthVUnits`, `ethNetworkFee`) | `_syncFees` |
| SSVStaking.claim | StorageProtocol | `ethDaoBalance -= payout` | `ethDaoBalance`, `stakingEthPoolBalance` | `claimEthRewards` |
| OperatorLib.updateSnapshotSt | StorageEB | (read only) | `operatorEthVUnits[operatorId]` | `updateSnapshotSt` |
| ClusterLib.getVUnits | StorageEB | (read only) | `clusterEB[clusterId].vUnits` | `getVUnits`, `updateBalanceWithEB`, `isLiquidatableWithEB` |
| ProtocolLib.networkTotalEarnings | StorageProtocol | (read only, view) | `daoTotalEthVUnits`, `ethNetworkFee`, `ethDaoBalance` | Used by SSVStaking._syncFees |
| ProtocolLib.updateDAO | StorageProtocol | `ethDaoValidatorCount ±=`, `daoTotalEthVUnits ±=`, settles `ethDaoBalance` | implicit via updateDAOEarnings | Called by SSVClusters on register/liquidate/reactivate/migrate |

---

## Appendix: Key Code References

| Concept | File | Lines |
|---------|------|-------|
| registerValidator | SSVValidators.sol | 31-42 |
| removeValidator | SSVValidators.sol | 96-100 |
| deposit (ETH) | SSVClusters.sol | 190-205 |
| withdraw (ETH) | SSVClusters.sol | 210-260 |
| liquidate (ETH) | SSVClusters.sol | 35-69 |
| reactivate | SSVClusters.sol | 133-185 |
| migrateClusterToETH | SSVClusters.sol | 264-348 |
| updateClusterBalance | SSVClusters.sol | 353-423 |
| _applyClusterFeeUpdates | SSVClusters.sol | 463-494 |
| _updateOperatorVUnits | SSVClusters.sol | 496-515 |
| _liquidateAfterEBUpdateIfNeeded | SSVClusters.sol | 524-555 |
| _executeLiquidation | SSVClusters.sol | 557-617 |
| registerOperator | SSVOperators.sol | 28-66 |
| removeOperator | SSVOperators.sol | 71-93 |
| declareOperatorFee | SSVOperators.sol | 95-142 |
| executeOperatorFee | SSVOperators.sol | 144-169 |
| reduceOperatorFee | SSVOperators.sol | 181-198 |
| commitRoot | SSVDAO.sol | 155-200 |
| replaceOracle | SSVDAO.sol | 205-229 |
| stake | SSVStaking.sol | 41-61 |
| requestUnstake | SSVStaking.sol | 66-94 |
| claimEthRewards | SSVStaking.sol | 114-145 |
| onCSSVTransfer | SSVStaking.sol | 169-177 |
| _syncFees | SSVStaking.sol | 179-203 |
| _settle | SSVStaking.sol | 205-208 |
| _settleWithBalance | SSVStaking.sol | 210-224 |
| networkTotalEarnings | ProtocolLib.sol | 85-91 |
| updateDAO | ProtocolLib.sol | 108-120 |
| updateDAOEthVUnits | ProtocolLib.sol | 143-151 |
| updateSnapshotSt (ETH) | OperatorLib.sol | 52-72 |
| ensureETHDefaults | OperatorLib.sol | 142-153 |
| updateClusterOperators | OperatorLib.sol | 253-282 |
| updateClusterOperatorsMigration | OperatorLib.sol | 367-411 |
| ebToVUnits | ClusterLib.sol | 353-358 |
| vUnitsToEB | ClusterLib.sol | 365-367 |
| getVUnits | ClusterLib.sol | 277-289 |
| updateBalanceWithEB | ClusterLib.sol | 298-313 |
| isLiquidatableWithEB | ClusterLib.sol | 67-84 |
| _beforeTokenTransfer | CSSVToken.sol | 26-30 |
