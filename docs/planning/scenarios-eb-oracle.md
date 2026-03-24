# EB Oracle / Root Commitment Scenarios (EB-001 — EB-030)

**Worker:** W1-H
**Scope:** `commitRoot`, `replaceOracle`, `updateQuorumBps`, `updateMinBlocksBetweenUpdates` — oracle voting, quorum mechanics, cSSV supply freezing, monotonicity enforcement.

**Source files:**
- `contracts/modules/SSVDAO.sol` — `commitRoot`, `replaceOracle`, `updateQuorumBps`, `updateMinBlocksBetweenUpdates`
- `contracts/libraries/storage/SSVStorageEB.sol` — `ebRoots`, `rootCommitments`, `hasVoted`, `roundFrozenSupply`, `latestCommittedBlock`
- `contracts/libraries/storage/SSVStorageStaking.sol` — `oracles`, `oracleIdOf`, `defaultOracleIds`, `quorumBps`
- `contracts/interfaces/ISSVDAO.sol` — events
- `docs/SPEC.md` §4 Oracle System
- `docs/FLOWS.md` §3.1 Commit Root, §6.2 Replace Oracle

---

## Tag Legend

| Tag Key | Values | Meaning |
|---------|--------|---------|
| `entry` | functionName | Solidity entry point under test |
| `version` | eth / ssv / both / na | Cluster version context (na = oracle-only, no cluster) |
| `eb` | implicit / explicit / na | EB mode (na = oracle-only scenarios) |
| `cluster` | active / liquidated / migrated / none | Cluster state context (none = no cluster involved) |
| `ops` | 4 / 7 / 10 / 13 / parametric / na | Operator count (na = oracle-only) |
| `remove_mode` | real / mock_zero / mock_payout / none | Removed-operator mode |
| `revert` | yes / no | Whether scenario expects a revert |

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-001 | Single oracle commits root (1-of-1 quorum) | Happy path: single oracle with 100% quorum commits root, `RootCommitted` emitted, `latestCommittedBlock` updated | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221 |
| EB-002 | 3-of-4 oracles reach 75% quorum | Happy path: weighted voting with default 7500 BPS quorum, root committed on 3rd vote | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221 |
| EB-003 | 2-of-4 oracles fail to reach quorum | Partial vote: 2 oracles vote, `WeightedRootProposed` emitted but no `RootCommitted`, storage persists | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221 |
| EB-004 | Oracle double-vote same (blockNum, root) rejected | Same oracle calls `commitRoot` twice with identical params, second call reverts `AlreadyVoted` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:188 |
| EB-005 | Oracle votes same blockNum, different root (allowed) | commitmentKey differs because root differs — oracle can vote for a competing proposal | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:186-189 |
| EB-006 | Oracle commits for future block (revert) | `blockNum > block.number` reverts with `FutureBlockNumber` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:181-183 |
| EB-007 | Oracle commits non-monotonically (stale block) | `blockNum <= latestCommittedBlock` reverts with `StaleBlockNumber` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:176-178 |
| EB-008 | Oracle commits blockNum equal to latestCommittedBlock | Exact equality (`blockNum == latestCommittedBlock`) still reverts `StaleBlockNumber` (strict `>`) | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:176-178 |
| EB-009 | Non-oracle caller reverts | Unregistered address calls `commitRoot`, reverts `NotOracle` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:172-173 |
| EB-010 | cSSV supply frozen on first vote of round | First oracle votes → `roundFrozenSupply[key]` set from `cSSV.totalSupply()`. Second oracle votes → supply unchanged even if cSSV minted between votes | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:192-199 |
| EB-011 | cSSV supply = 0 reverts (ZeroCSSVSupply) | No stakers → `cSSV.totalSupply() == 0` → first vote reverts `ZeroCSSVSupply` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:194-195 |
| EB-012 | cSSV supply truncates to zero (InsufficientCSSVSupply) | `cSSV.totalSupply()` is 1, 2, or 3 (< oracle count 4) → truncated supply = 0 → reverts `InsufficientCSSVSupply` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:197-198 |
| EB-013 | cSSV supply truncation dust excluded from voting | Supply = 7 with 4 oracles → truncated = 4, dust = 3. Weight = 1 per oracle. Threshold computed from truncated supply, not raw | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:196-207 |
| EB-014 | Quorum threshold edge: exactly at quorum | 3 oracles vote with quorum=7500 BPS. `accumulatedWeight = 3 * (supply/4) >= (supply * 7500) / 10000`. Root committed | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:207-220 |
| EB-015 | Quorum threshold edge: one below quorum | 2-of-4 with quorum=5001 BPS. `accumulatedWeight = 2*(supply/4)` < `(supply*5001)/10000`. Root NOT committed | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:207-220 |
| EB-016 | Quorum at minimum: 1 BPS (single oracle always passes) | `quorumBps = 1`. A single oracle's weight always exceeds `(supply * 1) / 10000`. Root committed on first vote | `entry:commitRoot,updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:207-220, 254-260 |
| EB-017 | Quorum at 10000 BPS (unanimous required) | `quorumBps = 10000`. All 4 oracles must vote. Root committed only on 4th vote | `entry:commitRoot,updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:207-220, 254-260 |
| EB-018 | Quorum BPS 0 rejected (SEC-20) | `updateQuorumBps(0)` reverts `InvalidQuorum` — prevents zero-threshold bypass | `entry:updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:254-260 |
| EB-019 | Quorum BPS > 10000 rejected | `updateQuorumBps(10001)` reverts `InvalidQuorum` | `entry:updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:254-260 |
| EB-020 | Oracle replacement mid-round: old oracle voted, new oracle votes | Oracle 1 votes. Owner replaces oracle 1 address. New address votes on same commitment → `AlreadyVoted` (vote tracked by oracleId, not address) | `entry:commitRoot,replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:186-189, 226-249 |
| EB-021 | Oracle replacement: old oracle can no longer vote | After `replaceOracle`, old address calling `commitRoot` reverts `NotOracle` | `entry:commitRoot,replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:172-173, 226-249 |
| EB-022 | Oracle replacement: new oracle votes on fresh round | `replaceOracle` then new oracle votes on a new round (no prior vote). Succeeds | `entry:commitRoot,replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221, 226-249 |
| EB-023 | Multiple rounds in sequence | Round 1: 3 oracles reach quorum → root committed. Round 2: new blockNum, 3 oracles reach quorum → second root committed. `latestCommittedBlock` updated twice | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221 |
| EB-024 | Quorum BPS change between rounds | Round 1 commits at 7500 BPS. Owner changes to 5000 BPS. Round 2 commits with only 2-of-4 oracles | `entry:commitRoot,updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:168-221, 254-260 |
| EB-025 | Quorum BPS change mid-round affects threshold | Oracle 1 votes (quorum 7500). Owner lowers quorum to 2500. Oracle 2 votes — now meets new threshold. Root committed on 2nd vote | `entry:commitRoot,updateQuorumBps; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:207, 254-260 |
| EB-026 | Cleanup after quorum: rootCommitments and roundFrozenSupply deleted | After root committed, verify `rootCommitments[key] == 0` and `roundFrozenSupply[key] == 0`, but `hasVoted[key][id]` persists | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:no` | No | SSVDAO.sol:215-217 |
| EB-027 | hasVoted persists after quorum — prevents re-vote on same key | After a successful round, oracles attempt to re-vote on the same `(blockNum, root)` — reverts `StaleBlockNumber` (blockNum <= latestCommittedBlock) or `AlreadyVoted` | `entry:commitRoot; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:176-178, 188 |
| EB-028 | replaceOracle: invalid oracle ID 0 reverts | `replaceOracle(0, addr)` reverts `InvalidOracleId` | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:228 |
| EB-029 | replaceOracle: oracle ID > MAX_DELEGATION_SLOTS reverts | `replaceOracle(5, addr)` reverts `InvalidOracleId` (MAX_DELEGATION_SLOTS = 4) | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:228 |
| EB-030 | replaceOracle: new oracle already assigned to another ID reverts | Oracle address already registered under ID 2, attempt to assign to ID 3 → reverts `OracleAlreadyAssigned` | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; remove_mode:none; revert:yes` | No | SSVDAO.sol:242-243 |

---

## Detailed Scenario Blocks (8 Most Complex)

---

### EB-002: 3-of-4 Oracles Reach 75% Quorum

**Purpose:** Validate the weighted voting quorum mechanism with the default 4-oracle, 7500 BPS configuration.

**Preconditions:**
- 4 oracles registered via `initializeSSVStaking` (IDs 1-4)
- `quorumBps = 7500` (75%)
- `cSSV.totalSupply() = 1000` (arbitrary; truncated supply = 1000 since 1000 % 4 == 0)
- `latestCommittedBlock = 100`

**Steps:**
1. Oracle 1 calls `commitRoot(rootA, 200)`
   - First vote → `roundFrozenSupply[key] = 1000`
   - `weight = 1000 / 4 = 250`
   - `rootCommitments[key] = 250`
   - `threshold = (1000 * 7500) / 10000 = 750`
   - `250 < 750` → `WeightedRootProposed(rootA, 200, 250, 750, 1, oracle1Addr)`
2. Oracle 2 calls `commitRoot(rootA, 200)`
   - `roundFrozenSupply[key]` already set → uses frozen value
   - `rootCommitments[key] = 500`
   - `500 < 750` → `WeightedRootProposed(rootA, 200, 500, 750, 2, oracle2Addr)`
3. Oracle 3 calls `commitRoot(rootA, 200)`
   - `rootCommitments[key] = 750`
   - `750 >= 750` → quorum reached
   - `ebRoots[200] = rootA`, `latestCommittedBlock = 200`
   - Cleanup: `delete rootCommitments[key]`, `delete roundFrozenSupply[key]`
   - `RootCommitted(rootA, 200)` emitted

**Postconditions:**
- `ebRoots[200] == rootA`
- `latestCommittedBlock == 200`
- `rootCommitments[key] == 0` (deleted)
- `roundFrozenSupply[key] == 0` (deleted)
- `hasVoted[key][1] == true`, `hasVoted[key][2] == true`, `hasVoted[key][3] == true`
- `hasVoted[key][4] == false` (oracle 4 never voted)

**File References:** SSVDAO.sol:168-221, SSVStorageEB.sol:21-27, SSVStorageStaking.sol:33-35

---

### EB-010: cSSV Supply Frozen on First Vote of Round

**Purpose:** Verify that the cSSV total supply is snapshotted on the first vote and immutable for the remainder of the round, preventing mid-round supply manipulation.

**Preconditions:**
- 4 oracles registered, `quorumBps = 7500`
- `cSSV.totalSupply() = 400` initially
- `latestCommittedBlock = 50`

**Steps:**
1. Oracle 1 calls `commitRoot(rootA, 100)`
   - First vote: `rawSupply = 400`, `truncated = 400 - (400 % 4) = 400`
   - `roundFrozenSupply[key] = 400`
   - `weight = 400 / 4 = 100`, `rootCommitments[key] = 100`
2. External actor stakes SSV → `cSSV.totalSupply()` increases to 800
3. Oracle 2 calls `commitRoot(rootA, 100)`
   - `roundFrozenSupply[key]` already = 400 → frozen supply used, not current 800
   - `weight = 400 / 4 = 100`, `rootCommitments[key] = 200`
   - `threshold = (400 * 7500) / 10000 = 300`
   - `200 < 300` → not committed
4. Oracle 3 calls `commitRoot(rootA, 100)`
   - `rootCommitments[key] = 300`, `300 >= 300` → quorum reached
   - Root committed using frozen supply math, unaffected by the mid-round mint

**Postconditions:**
- Root committed with threshold math based on supply=400, not supply=800
- Prevents attacker from inflating supply mid-round to raise quorum threshold and block commitment

**File References:** SSVDAO.sol:192-199, ICSSVToken.sol

---

### EB-012: cSSV Supply Truncates to Zero (InsufficientCSSVSupply)

**Purpose:** Edge case where cSSV supply exists but is less than oracle count, making truncated voting supply zero.

**Preconditions:**
- 4 oracles registered, `quorumBps = 7500`
- `cSSV.totalSupply() = 3` (less than oracle count of 4)
- `latestCommittedBlock = 0`

**Steps:**
1. Oracle 1 calls `commitRoot(rootA, 50)`
   - `rawSupply = 3`, `truncated = 3 - (3 % 4) = 3 - 3 = 0`
   - `rawSupply != 0` so `ZeroCSSVSupply` is NOT triggered
   - `truncated == 0` → reverts with `InsufficientCSSVSupply`

**Variations:**
- Supply = 1: truncated = 0 → `InsufficientCSSVSupply`
- Supply = 2: truncated = 0 → `InsufficientCSSVSupply`
- Supply = 4: truncated = 4 → succeeds (weight = 1 per oracle)

**Postconditions:**
- No state changes (transaction reverted)
- Distinguishes `ZeroCSSVSupply` (raw=0) from `InsufficientCSSVSupply` (raw>0 but truncated=0)

**File References:** SSVDAO.sol:194-198

---

### EB-020: Oracle Replacement Mid-Round — Old Oracle Voted, New Oracle Attempts Same Commitment

**Purpose:** Verify that `hasVoted` is tracked by oracleId (not address), so replacing an oracle address does not allow the same oracle slot to vote twice on a round.

**Preconditions:**
- 4 oracles registered (oracle1=addrA at ID 1)
- `quorumBps = 7500`, `latestCommittedBlock = 100`
- `cSSV.totalSupply() = 400`

**Steps:**
1. Oracle 1 (addrA) calls `commitRoot(rootA, 200)` — succeeds
   - `hasVoted[key][1] = true`
   - `WeightedRootProposed` emitted
2. Owner calls `replaceOracle(1, addrB)` — succeeds
   - `oracleIdOf[addrA] = 0`, `oracleIdOf[addrB] = 1`, `oracles[1] = addrB`
   - `OracleReplaced(1, addrA, addrB)` emitted
3. New oracle 1 (addrB) calls `commitRoot(rootA, 200)` — REVERTS `AlreadyVoted`
   - `oracleIdOf[addrB] = 1`, `hasVoted[key][1] = true` → revert

**Why this matters:** Prevents a governance-level double-vote attack where DAO replaces an oracle that already voted, and the new oracle tries to vote again in the same round.

**Postconditions:**
- Oracle ID 1 has exactly 1 vote counted for this round regardless of address changes
- Old address (addrA) cannot vote anymore (`NotOracle`)

**File References:** SSVDAO.sol:172-173, 186-189, 226-249; FLOWS.md §6.2

---

### EB-025: Quorum BPS Change Mid-Round Affects Active Threshold

**Purpose:** Demonstrate that quorum is evaluated at vote-time, not frozen at round start — a mid-round quorum change can cause an otherwise-insufficient vote to commit the root.

**Preconditions:**
- 4 oracles registered
- `quorumBps = 7500` initially
- `cSSV.totalSupply() = 400`, `latestCommittedBlock = 100`

**Steps:**
1. Oracle 1 calls `commitRoot(rootA, 200)`
   - `roundFrozenSupply[key] = 400`, `weight = 100`, `rootCommitments[key] = 100`
   - `threshold = (400 * 7500) / 10000 = 300`
   - `100 < 300` → `WeightedRootProposed`
2. Owner calls `updateQuorumBps(2500)` — quorum lowered to 25%
3. Oracle 2 calls `commitRoot(rootA, 200)`
   - `rootCommitments[key] = 200`
   - `threshold = (400 * 2500) / 10000 = 100` ← NEW threshold
   - `200 >= 100` → quorum reached → `RootCommitted`

**Key insight:** `quorumBps` is read from storage at each vote evaluation (SSVDAO.sol:207), not cached in `roundFrozenSupply`. This means DAO can unblock a stuck round by lowering quorum, but could also be exploited if quorum governance is compromised.

**Postconditions:**
- `ebRoots[200] == rootA`, `latestCommittedBlock == 200`
- Cleanup performed on `rootCommitments` and `roundFrozenSupply`
- Only 2 oracle votes were needed (not 3 as with original 75% quorum)

**File References:** SSVDAO.sol:207, 254-260

---

### EB-005: Oracle Votes Same blockNum With Different Root (Competing Proposals)

**Purpose:** Verify that the `commitmentKey = keccak256(blockNum, merkleRoot)` design allows competing proposals for the same block, and that each proposal tracks votes independently.

**Preconditions:**
- 4 oracles registered, `quorumBps = 7500`
- `cSSV.totalSupply() = 400`, `latestCommittedBlock = 100`

**Steps:**
1. Oracles 1, 2 vote for `(200, rootA)` — 2 votes, below quorum
   - `commitmentKeyA = keccak256(200, rootA)`
   - `rootCommitments[keyA] = 200`, threshold = 300
2. Oracles 3, 4 vote for `(200, rootB)` — 2 votes, below quorum
   - `commitmentKeyB = keccak256(200, rootB)` — different key
   - `rootCommitments[keyB] = 200`, threshold = 300
3. Oracle 1 votes for `(200, rootB)` — now keyB has 3 votes
   - `rootCommitments[keyB] = 300`, `300 >= 300` → quorum reached
   - `RootCommitted(rootB, 200)`, `latestCommittedBlock = 200`

**Key insight:** Oracle 1 voted for both rootA and rootB on block 200 — this is allowed because they are different commitment keys. The first proposal to reach quorum wins.

**Postconditions:**
- `ebRoots[200] == rootB` (rootB won the race)
- `rootCommitments[keyA] = 200` — orphaned, persists indefinitely (no cleanup for losing proposals)
- `roundFrozenSupply[keyA]` persists
- `latestCommittedBlock = 200` — future commits for block 200 revert `StaleBlockNumber`
- The losing proposal's votes are now permanently stuck (cannot revert, cannot clean up)

**File References:** SSVDAO.sol:186-220; SPEC.md §4 "Failed Quorum Behavior"

---

### EB-023: Multiple Rounds in Sequence

**Purpose:** Validate that consecutive root commitment rounds correctly advance `latestCommittedBlock` monotonically, each round with independent supply freezing and vote tracking.

**Preconditions:**
- 4 oracles registered, `quorumBps = 7500`
- `cSSV.totalSupply() = 400` initially
- `latestCommittedBlock = 0`

**Steps:**
1. **Round 1:** Oracles 1, 2, 3 vote `(rootA, 100)` — quorum reached
   - `latestCommittedBlock = 100`, `ebRoots[100] = rootA`
   - `roundFrozenSupply[keyA]` deleted, `rootCommitments[keyA]` deleted
2. Someone stakes → `cSSV.totalSupply() = 600`
3. **Round 2:** Oracles 1, 2, 3 vote `(rootB, 200)` — quorum reached
   - First vote freezes supply at 600 (new round, new key)
   - `latestCommittedBlock = 200`, `ebRoots[200] = rootB`
4. **Round 3:** Oracles 1, 2, 3 vote `(rootC, 150)` — REVERTS
   - `150 <= latestCommittedBlock (200)` → `StaleBlockNumber`

**Postconditions:**
- `ebRoots[100] == rootA`, `ebRoots[200] == rootB`
- `latestCommittedBlock == 200`
- Monotonicity enforced: block 150 rejected after block 200
- Each round used independently frozen supply

**File References:** SSVDAO.sol:168-221

---

### EB-013: cSSV Supply Truncation — Dust Excluded From Voting Math

**Purpose:** Verify that the truncation `rawSupply - (rawSupply % oracleCount)` correctly excludes dust from both per-oracle weight and quorum threshold calculations, preventing rounding-based attacks.

**Preconditions:**
- 4 oracles registered, `quorumBps = 7500`
- `cSSV.totalSupply() = 7`
- `latestCommittedBlock = 0`

**Steps:**
1. Oracle 1 calls `commitRoot(rootA, 50)`
   - `rawSupply = 7`, `oracleCount = 4`
   - `truncated = 7 - (7 % 4) = 7 - 3 = 4`
   - `roundFrozenSupply[key] = 4`
   - `weight = 4 / 4 = 1`
   - `rootCommitments[key] = 1`
   - `threshold = (4 * 7500) / 10000 = 3` (integer division)
   - `1 < 3` → `WeightedRootProposed`
2. Oracle 2 votes: `rootCommitments[key] = 2`, `2 < 3` → not committed
3. Oracle 3 votes: `rootCommitments[key] = 3`, `3 >= 3` → quorum reached → `RootCommitted`

**Arithmetic verification:**
- Without truncation: `weight = 7/4 = 1` (Solidity integer division), `threshold = (7*7500)/10000 = 5`. Would need all 4 oracles (weight 4 vs threshold 5 — actually impossible with 4 oracles at weight 1 each). Truncation ensures `4 * weight == frozenSupply`, making threshold achievable.
- Dust (3 tokens) is excluded from all math, preventing it from inflating the threshold relative to achievable vote weight.

**Postconditions:**
- Root committed with exactly 3 oracle votes
- `roundFrozenSupply[key]` deleted (was 4, not 7)

**File References:** SSVDAO.sol:192-207

---

## Additional Scenarios for `replaceOracle` and `updateMinBlocksBetweenUpdates`

The following supplementary scenarios round out coverage for DAO governance functions that interact with the oracle system. They are included in the table above (EB-028 through EB-030) and the additional rows below are captured by the table entries. Key `replaceOracle` edge cases covered:

- **EB-028:** `oracleId = 0` → `InvalidOracleId`
- **EB-029:** `oracleId > MAX_DELEGATION_SLOTS (4)` → `InvalidOracleId`
- **EB-030:** Address already assigned to another ID → `OracleAlreadyAssigned`
- **EB-021:** Old oracle address loses `NotOracle` access
- **EB-022:** New oracle can vote on fresh rounds
- **EB-020:** `hasVoted` tracked by ID, not address — prevents double-vote after replacement

The `updateMinBlocksBetweenUpdates` function is tested in the EB-updates scenario file (W1-H2), as it applies to `updateClusterBalance`, not `commitRoot`.

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original EB-001 through EB-030 set. Note: some oracle gaps may overlap with scenarios in the DAO governance file (DA-*).

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-031a | replaceOracle | Replace oracle with `address(0)` — revert `ZeroAddress`. Verifies zero-address guard on oracle replacement. | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; revert:yes` | [ ] | SSVDAO.sol:229 |
| EB-031b | replaceOracle | Replace oracle with its own current address (same address) — revert `SameOracleAddressNotAllowed`. Verifies identity check. | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; revert:yes` | [ ] | SSVDAO.sol:232-234 |
| EB-031c | replaceOracle | First assignment to an empty oracle slot (oracleId exists but address is `address(0)`) — verify succeeds, `OracleReplaced` event emitted, `oracleIdOf` mapping updated. | `entry:replaceOracle; version:na; eb:na; cluster:none; ops:na; revert:no` | [ ] | SSVDAO.sol:226-249 |

---

## ask-codex Review Findings

### Corrections

- **EB-001**: "Single oracle commits root (1-of-1 quorum)" is NOT a real path. The contract uses a fixed 4-slot oracle array at SSVStorageStaking.sol:33. One vote at quorumBps=10000 cannot commit. Mark as unreachable/needs rework.

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| EB-031d | commitRoot | Raise quorumBps mid-round (via updateQuorumBps) so next vote fails to reach threshold → commit blocked. Mirror of EB-014 which only covers lowering. | `entry:commitRoot; revert:no` | [ ] | SSVDAO.sol:207, 211, 254 |
| EB-031e | commitRoot | Quorum boundary: quorumBps=2501 (1 vote just stops being enough) and quorumBps=7501 (3 votes just stops being enough). Test exact step-function boundaries. | `entry:commitRoot; revert:no` | [ ] | SSVDAO.sol:202, 207, 211 |
| EB-031f | replaceOracle | Replace oracle slot mid-round BEFORE that slot has voted → new address can vote on same commitment. Tests in-flight replacement. | `entry:replaceOracle+commitRoot; revert:no` | [ ] | SSVDAO.sol:172, 188, 245 |
| EB-031g | replaceOracle | newOracle=address(0) → revert `ZeroAddressNotAllowed`. (Covered in DAO scenarios but not in this EB file.) | `entry:replaceOracle; revert:yes` | [ ] | SSVDAO.sol:229 |
| EB-031h | replaceOracle | oldOracle==newOracle → revert `SameOracleAddressNotAllowed`. (Covered in DAO scenarios but not in this EB file.) | `entry:replaceOracle; revert:yes` | [ ] | SSVDAO.sol:231 |

---

## Coverage Verification (W4)

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| EB-001 | no | none | — | Scenario marked unreachable by ask-codex review (fixed 4-slot oracle array, 1-of-1 quorum is not a real path) |
| EB-002 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Commits on the third vote at 75% quorum" / "Commits root when 3 of 4 oracles vote" — verifies weight accumulation and RootCommitted on 3rd vote |
| EB-003 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Emits WeightedRootProposed repeatedly and accumulates weight when quorum is still not reached" / "Stores weight but does not commit root when 1 of 4 oracles votes" |
| EB-004 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'AlreadyVoted' when oracle tries to vote twice" / "Reverts when same oracle votes twice" |
| EB-005 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Conflicting roots for same block: first root to reach quorum is committed" / "Allows same oracle to vote for different root at same block" + "tracks weight separately for different roots" |
| EB-006 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'FutureBlockNumber' when block number is in the future" |
| EB-007 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'StaleBlockNumber' when block number is not greater than last committed" (blockNum=50 < 100) |
| EB-008 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | Same test as EB-007 — tests blockNum==latestCommittedBlock (100==100) reverts StaleBlockNumber |
| EB-009 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'NotOracle' when caller is not an oracle" / "Reverts when non-oracle calls commitRoot" |
| EB-010 | yes | none | test/sanity/ssv2-frozen-supply-quorum.test.ts + test/unit/SSVDAO/commitRoot.test.ts | "Freezes supply at first vote and cleans up on commit" + "Supply increase between votes does not block quorum" — verifies frozen supply immutability |
| EB-011 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'ZeroCSSVSupply' when no cSSV supply exists" / "Reverts when cSSV totalSupply is 0" |
| EB-012 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Is reverted with 'InsufficientCSSVSupply' when totalSupply is below the oracle count" — mints 3 tokens with 4 oracles |
| EB-013 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Stores truncated frozen supply and emits quorum based on the stored voting supply" — truncatingSupply=1_000_000_002, truncated=1_000_000_000 |
| EB-014 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Commits on the third vote at 75% quorum even when totalSupply is not divisible by 4" — boundary test with exact quorum |
| EB-015 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Does not commit on the third vote at 80% quorum when totalSupply is not divisible by 4" — 3 votes insufficient at 80% |
| EB-016 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Single oracle vote commits root when quorumBps is 1" + "Commits root on the first vote when accumulated weight meets the quorum threshold" (quorum=100) |
| EB-017 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Requires all 4 oracle votes when quorumBps is 10000 (100%)" + "Requires all 4 oracle votes at 100% quorum even when totalSupply is not divisible by 4" |
| EB-018 | yes | none | test/unit/SSVDAO/setQuorumBps.test.ts | "Is reverted when quorum is 0" |
| EB-019 | yes | none | test/unit/SSVDAO/setQuorumBps.test.ts | "Is reverted when quorum exceeds 10000 bps" |
| EB-020 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Oracle replaced mid-vote: old oracle loses voting rights, new oracle gets AlreadyVoted for reused slot" / "Replacement oracle inherits same oracleId and cannot re-vote" |
| EB-021 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | Same tests as EB-020 — old oracle gets NotOracle after replacement |
| EB-022 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Oracle replaced with a completely new address: new oracle inherits the slot and can vote on subsequent blocks" |
| EB-023 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'StaleBlockNumber' when trying to propose the same block after it was committed" — proves monotonicity. Multiple sequential rounds tested across e2e oracle-commits |
| EB-024 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Lowering quorumBps between votes" + "Raising quorumBps between votes" — both test quorum change between rounds |
| EB-025 | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Lowering quorumBps between votes causes the next vote to evaluate against the new threshold" — oracle1 votes at 7500, quorum lowered to 5000, oracle2 commits |
| EB-026 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/sanity/ssv2-frozen-supply-quorum.test.ts | "Requires all 4 oracle votes at 100% quorum" verifies rootCommitmentWeight==0 after commit + frozen-supply test verifies cleanup |
| EB-027 | yes | none | test/unit/SSVDAO/commitRoot.test.ts + test/e2e/effective-balance/oracle-commits.test.ts | "Is reverted with 'StaleBlockNumber' when trying to propose the same block after it was committed" — re-vote after quorum reverts StaleBlockNumber |
| EB-028 | yes | none | test/unit/SSVDAO/replaceOracle.test.ts + test/sanity/replace-oracle-invalid-id.test.ts | "Is reverted with 'InvalidOracleId' when oracle ID is zero" |
| EB-029 | yes | none | test/sanity/replace-oracle-invalid-id.test.ts | "Is reverted with 'InvalidOracleId' when oracleId is MAX_DELEGATION_SLOTS + 1" (ID=5 reverts) |
| EB-030 | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | "Is reverted with 'OracleAlreadyAssigned' when new oracle is already assigned to another ID" |
| EB-031a | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | "Is reverted with 'ZeroAddress' when new oracle address is zero" |
| EB-031b | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | "Is reverted with 'SameOracleAddressNotAllowed' when replacing with same address" |
| EB-031c | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | "Can replace an oracle with ID that had no previous address" — empty slot (address(0)) assignment |
| EB-031d | yes | none | test/unit/SSVDAO/commitRoot.test.ts | "Raising quorumBps between votes requires additional votes to reach new threshold" |
| EB-031e | no | none | — | No test for exact step-function boundaries at quorumBps=2501/7501 |
| EB-031f | no | none | — | No test for replace oracle mid-round BEFORE that slot has voted |
| EB-031g | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | Same as EB-031a — ZeroAddress revert |
| EB-031h | yes | none | test/unit/SSVDAO/replaceOracle.test.ts | Same as EB-031b — SameOracleAddressNotAllowed revert |
