# Whitelist Scenarios (WL-001 to WL-040)

## Source Contract Reference
- `contracts/modules/SSVOperatorsWhitelist.sol` — 4 external functions: `setOperatorsWhitelists`, `removeOperatorsWhitelists`, `setOperatorsWhitelistingContract`, `removeOperatorsWhitelistingContract`
- `contracts/libraries/OperatorLib.sol` — `updateMultipleWhitelists` (bitmap logic), `generateBlockMasks`, `getBitmapIndexes`, `isWhitelistingContract` (ERC165), `updatePrivacyStatus`, whitelist check in `updateClusterOperatorsOnRegistration`
- `contracts/modules/SSVOperators.sol` — `removeOperator` (clears `operatorsWhitelist` but NOT `whitelisted` flag or bitmap entries), `setOperatorsPrivateUnchecked`, `setOperatorsPublicUnchecked`
- `contracts/libraries/storage/SSVStorage.sol` — `operatorsWhitelist` (operatorId => address), `addressWhitelistedForOperators` (address => slot => bitmap)

## Storage Model
- **Bitmap**: `addressWhitelistedForOperators[address][blockIndex]` where `blockIndex = operatorId >> 8`, `bitPosition = operatorId & 0xFF`. Each uint256 slot holds 256 operator bits.
- **Legacy/Contract slot**: `operatorsWhitelist[operatorId]` — single address (legacy EOA or whitelisting contract).
- **Privacy flag**: `operator.whitelisted` — when `true`, registration checks whitelist; when `false`, operator is public.

## Whitelist Check Order (registration)
1. If `operator.whitelisted == false` → skip (public operator, anyone can register)
2. Check bitmap: `addressWhitelistedForOperators[msg.sender][blockIndex] & (1 << bitPosition)`
3. If bitmap miss → check `operatorsWhitelist[operatorId]`:
   - If `address(0)` → revert `CallerNotWhitelistedWithData`
   - If matches `msg.sender` → pass (legacy EOA)
   - If `isWhitelistingContract(addr)` AND `isWhitelisted(msg.sender, operatorId)` → pass
   - Else → revert `CallerNotWhitelistedWithData`

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| WL-001 | `setOperatorsWhitelists` — single operator, single address | Baseline: whitelist one address for one operator, verify bitmap bit is set | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:15-21, OperatorLib.sol:432-467 |
| WL-002 | `setOperatorsWhitelists` — single operator, multiple addresses | Whitelist N addresses for one operator, verify all bitmap bits set | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:15-21, OperatorLib.sol:432-467 |
| WL-003 | `setOperatorsWhitelists` — multiple operators (same slot), single address | Operators within same 256-slot share one mask update | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:477-510 |
| WL-004 | `setOperatorsWhitelists` — multiple operators (cross-slot), single address | Operators spanning blockIndex boundary (e.g., op 255 and op 256) | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:477-510 |
| WL-005 | `setOperatorsWhitelists` — multiple operators, multiple addresses | Bulk: M addresses x N operators, verify all bits set correctly | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:15-21, OperatorLib.sol:432-467 |
| WL-006 | `setOperatorsWhitelists` — 256th operator in slot boundary | operatorId=255 (bit 255) and operatorId=256 (bit 0 of next slot) | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:537-540 |
| WL-007 | `setOperatorsWhitelists` — idempotent (re-whitelist same address) | Whitelisting already-whitelisted address is a no-op (OR is idempotent) | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:459-460 |
| WL-008 | `setOperatorsWhitelists` — revert: non-owner calls | msg.sender is not operator owner → revert `CallerNotOwnerWithData` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:494-496, OperatorLib.sol:111-116 |
| WL-009 | `setOperatorsWhitelists` — revert: empty operator array | Empty operatorIds → revert `InvalidOperatorIdsLength` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:555-558 |
| WL-010 | `setOperatorsWhitelists` — revert: empty address array | Empty whitelistAddresses → revert `InvalidWhitelistAddressesLength` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:438-439 |
| WL-011 | `setOperatorsWhitelists` — revert: zero address in array | address(0) in whitelist → revert `ZeroAddressNotAllowed` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:546-548 |
| WL-012 | `setOperatorsWhitelists` — revert: address is ERC165 whitelisting contract | Passing a contract that implements `ISSVWhitelistingContract` → revert `AddressIsWhitelistingContract` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:452-453 |
| WL-013 | `setOperatorsWhitelists` — revert: unsorted operator IDs | [5, 3] → revert `UnsortedOperatorsList` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:498-503 |
| WL-014 | `setOperatorsWhitelists` — revert: duplicate operator IDs | [3, 3] → revert `OperatorsListNotUnique` | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:498-500 |
| WL-015 | `setOperatorsWhitelists` — revert: operator does not exist | Non-existent operatorId → revert `OperatorDoesNotExist` (via checkOwner) | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:112-114 |
| WL-016 | `removeOperatorsWhitelists` — single operator, single address | Remove one whitelisted address, verify bitmap bit cleared | `entry:removeOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:26-32, OperatorLib.sol:461-463 |
| WL-017 | `removeOperatorsWhitelists` — multiple operators, multiple addresses | Bulk removal, verify all affected bits cleared | `entry:removeOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:26-32, OperatorLib.sol:432-467 |
| WL-018 | `removeOperatorsWhitelists` — remove address not whitelisted (no-op) | Removing address that was never whitelisted succeeds silently (AND ~mask is idempotent) | `entry:removeOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:462-463 |
| WL-019 | `removeOperatorsWhitelists` — revert: non-owner | msg.sender not operator owner → revert `CallerNotOwnerWithData` | `entry:removeOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:494-496 |
| WL-020 | `removeOperatorsWhitelists` — does NOT revert for whitelisting contract address | Unlike `setOperatorsWhitelists`, remove path skips `isWhitelistingContract` check — can remove any address | `entry:removeOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:452 (registerAddresses guard) |
| WL-021 | `setOperatorsWhitelistingContract` — set valid ERC165 contract | Set contract implementing `ISSVWhitelistingContract`, verify `operatorsWhitelist[operatorId]` updated | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:37-70 |
| WL-022 | `setOperatorsWhitelistingContract` — legacy EOA migrated to bitmap | If `operatorsWhitelist[operatorId]` was a non-ERC165 EOA, that address gets moved to bitmap before new contract is set | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:58-64 |
| WL-023 | `setOperatorsWhitelistingContract` — replace existing whitelisting contract | Overwrite one whitelisting contract with another; old contract has no residual effect | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:66 |
| WL-024 | `setOperatorsWhitelistingContract` — revert: address(0) | Zero address fails ERC165 check → revert `InvalidWhitelistingContract` | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:42-43 |
| WL-025 | `setOperatorsWhitelistingContract` — revert: non-ERC165 contract | Contract without ERC165 `ISSVWhitelistingContract` support → revert `InvalidWhitelistingContract` | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:42-43, OperatorLib.sol:565-567 |
| WL-026 | `setOperatorsWhitelistingContract` — revert: non-owner | msg.sender not operator owner → revert `CallerNotOwnerWithData` | `entry:setOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:54 |
| WL-027 | `removeOperatorsWhitelistingContract` — remove contract, operator becomes bitmap-only | Remove whitelisting contract, verify `operatorsWhitelist[operatorId]` = address(0); bitmap entries remain | `entry:removeOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | SSVOperatorsWhitelist.sol:75-91 |
| WL-028 | `removeOperatorsWhitelistingContract` — revert: non-owner | msg.sender not operator owner → revert `CallerNotOwnerWithData` | `entry:removeOperatorsWhitelistingContract; version:both; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:85 |
| WL-029 | Register validator — whitelisted via bitmap, operator private | msg.sender in bitmap → registration succeeds | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:183-209 |
| WL-030 | Register validator — whitelisted via legacy EOA slot | `operatorsWhitelist[operatorId] == msg.sender` → registration succeeds | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:199 |
| WL-031 | Register validator — whitelisted via whitelisting contract returning true | ERC165 contract's `isWhitelisted(msg.sender, operatorId)` returns true → registration succeeds | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:202-205 |
| WL-032 | Register validator — revert: whitelisting contract returns false | ERC165 contract's `isWhitelisted` returns false → revert `CallerNotWhitelistedWithData` | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:202-207 |
| WL-033 | Register validator — revert: private operator, not whitelisted anywhere | `whitelisted=true`, no bitmap bit, no legacy, no contract → revert `CallerNotWhitelistedWithData` | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:194-196 |
| WL-034 | Register validator — public operator (whitelisted=false), no whitelist needed | `operator.whitelisted == false` → skip all whitelist checks, anyone registers | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:183 |
| WL-035 | Register validator — mixed cluster: 2 public + 2 private-whitelisted operators | Cluster with mix of public and private operators; msg.sender whitelisted for private ones only | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:167-210 |
| WL-036 | Register validator — mixed cluster: revert on one non-whitelisted private operator | 3 ops whitelisted + 1 private non-whitelisted → revert `CallerNotWhitelistedWithData` for the non-whitelisted op | `entry:registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:yes` | [ ] | OperatorLib.sol:192-207 |
| WL-037 | `removeOperator` clears `operatorsWhitelist` but NOT `whitelisted` flag | After removeOperator: `operatorsWhitelist[id]` = address(0), but `operator.whitelisted` retains true (stale — op is deleted anyway) | `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:91-95, SSVOperators.sol:347-358 |
| WL-038 | `removeOperator` does NOT clear bitmap entries | After removeOperator: `addressWhitelistedForOperators[addr][blockIndex]` still has bit set — harmless since operator no longer exists | `entry:removeOperator; version:both; eb:implicit; cluster:active; ops:4; remove_mode:real; revert:no` | [ ] | SSVOperators.sol:91-95 |
| WL-039 | Privacy toggle + whitelist interaction: set private → set whitelist → set public → register | Operator set private, whitelist added, then toggled public; anyone can now register despite whitelist entries existing | `entry:setOperatorsPrivateUnchecked+setOperatorsWhitelists+setOperatorsPublicUnchecked+registerValidator; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:518-529, OperatorLib.sol:183 |
| WL-040 | Cross-slot bulk: operators [1, 255, 256, 511, 512] × multiple addresses | Stress bitmap logic across 3 block-index slots, verify correct mask generation and storage for all slots | `entry:setOperatorsWhitelists; version:both; eb:implicit; cluster:active; ops:parametric; remove_mode:none; revert:no` | [ ] | OperatorLib.sol:477-510 |

---

## Detailed Scenario Blocks (10 Most Complex)

### WL-004: Cross-Slot Bitmap Boundary

**Scenario:** `setOperatorsWhitelists` with operatorIds [255, 256] and a single whitelist address.

**Why complex:** OperatorId 255 has `blockIndex=0, bitPosition=255` and operatorId 256 has `blockIndex=1, bitPosition=0`. The `generateBlockMasks` function must produce a `masks` array of length 2: `masks[0]` with bit 255 set, `masks[1]` with bit 0 set.

**Setup:**
1. Register two operators (id=255, id=256) by the same owner.
2. Set both private via `setOperatorsPrivateUnchecked([255, 256])`.

**Execution:**
1. Owner calls `setOperatorsWhitelists([255, 256], [addressA])`.

**Assertions:**
- `addressWhitelistedForOperators[addressA][0]` has bit 255 set (`1 << 255`).
- `addressWhitelistedForOperators[addressA][1]` has bit 0 set (`1 << 0 = 1`).
- `OperatorMultipleWhitelistUpdated` event emitted with correct args.

**Edge verification:**
- addressA can register validators using both operators in a cluster.
- addressB (not whitelisted) attempting registration reverts with `CallerNotWhitelistedWithData`.

---

### WL-006: 256th Operator Slot Boundary

**Scenario:** Whitelist an address for operatorId=255 (last bit of slot 0) and operatorId=256 (first bit of slot 1).

**Why complex:** Tests the exact boundary of the bitmap storage. `getBitmapIndexes(255)` returns `(0, 255)` — the highest bit position in slot 0. `getBitmapIndexes(256)` returns `(1, 0)` — the lowest bit position in slot 1. Off-by-one errors in `>> 8` or `& 0xFF` would surface here.

**Setup:**
1. Register operators 255 and 256.
2. Set both private.

**Execution:**
1. `setOperatorsWhitelists([255, 256], [addressA])`.

**Assertions:**
- `addressWhitelistedForOperators[addressA][0] == (1 << 255)` — only bit 255 set.
- `addressWhitelistedForOperators[addressA][1] == 1` — only bit 0 set.
- Removing whitelist for op 255 clears bit 255 in slot 0 but leaves slot 1 unchanged.
- Removing whitelist for op 256 clears bit 0 in slot 1 but leaves slot 0 unchanged.

---

### WL-012: Reject Whitelisting Contract via setOperatorsWhitelists

**Scenario:** Attempt to whitelist an address that implements `ISSVWhitelistingContract` (ERC165) using the bitmap-based `setOperatorsWhitelists` path.

**Why complex:** The contract enforces a separation of concerns: ERC165-compliant whitelisting contracts MUST use `setOperatorsWhitelistingContract`, not the bitmap path. The check `isWhitelistingContract(whitelistAddress)` uses `ERC165Checker.supportsInterface` which involves an external call. Edge cases include contracts that implement ERC165 but revert on `supportsInterface`, or contracts that return true for the interface but behave incorrectly.

**Setup:**
1. Deploy a mock contract implementing `ISSVWhitelistingContract` with proper ERC165 support.
2. Register an operator, set it private.

**Execution:**
1. Owner calls `setOperatorsWhitelists([operatorId], [mockWhitelistingContract])`.

**Assertions:**
- Transaction reverts with `AddressIsWhitelistingContract(mockWhitelistingContract)`.
- The bitmap is NOT modified.
- Using `setOperatorsWhitelistingContract` with the same contract succeeds.

---

### WL-022: Legacy EOA Migration on Whitelisting Contract Set

**Scenario:** An operator has an existing legacy whitelisted EOA in `operatorsWhitelist[operatorId]`. Setting a whitelisting contract via `setOperatorsWhitelistingContract` migrates that EOA into the bitmap before overwriting the slot.

**Why complex:** This is a stateful migration path. The code at SSVOperatorsWhitelist.sol:58-64 checks if the current whitelisted address is a non-ERC165 address (EOA or generic contract) and, if so, adds it to the bitmap. This ensures backward compatibility: the previously whitelisted EOA retains access after the whitelisting contract is set.

**Setup:**
1. Register operator (id=X). Set private.
2. Set legacy whitelist: some mechanism that sets `operatorsWhitelist[X] = legacyEOA` (this may require an older code path or direct storage manipulation in test).

**Execution:**
1. Owner calls `setOperatorsWhitelistingContract([X], newWhitelistingContract)`.

**Assertions:**
- `operatorsWhitelist[X]` is now `newWhitelistingContract`.
- `addressWhitelistedForOperators[legacyEOA][X >> 8]` has bit `(X & 0xFF)` set — legacy EOA migrated to bitmap.
- `legacyEOA` can still register validators (now via bitmap path).
- An address approved by `newWhitelistingContract.isWhitelisted()` can also register.
- An address NOT in bitmap AND NOT approved by contract → reverts.

---

### WL-035: Mixed Cluster — Public and Private-Whitelisted Operators

**Scenario:** Register a validator using a 4-operator cluster where operators 1 and 2 are public (`whitelisted=false`) and operators 3 and 4 are private (`whitelisted=true`) with msg.sender whitelisted for both private operators.

**Why complex:** The registration loop in `updateClusterOperatorsOnRegistration` must correctly skip whitelist checks for public operators (line 183: `if (operator.whitelisted)`) while enforcing them for private operators. The bitmap loading optimization (caching `currentWhitelistedMask` per `blockIndex`) must work correctly when operators span different block indices or when only some operators require whitelist checks.

**Setup:**
1. Register 4 operators [op1, op2, op3, op4].
2. `setOperatorsPublicUnchecked([op1, op2])` (or leave default — check if default is public).
3. `setOperatorsPrivateUnchecked([op3, op4])`.
4. `setOperatorsWhitelists([op3, op4], [registrant])`.

**Execution:**
1. `registrant` calls `registerValidator` with cluster `[op1, op2, op3, op4]`.

**Assertions:**
- Registration succeeds — public operators skip whitelist, private operators pass bitmap check.
- A different address (not whitelisted for op3/op4) attempting the same cluster → reverts `CallerNotWhitelistedWithData(op3)` (first failing operator).

---

### WL-036: Mixed Cluster Revert — One Non-Whitelisted Private Operator

**Scenario:** 4-operator cluster, 3 operators pass whitelist (2 public + 1 private-whitelisted), but the 4th operator is private and msg.sender is NOT whitelisted for it.

**Why complex:** Tests that the registration loop correctly identifies the failing operator and includes its ID in the revert data. The loop iterates in sorted order; the failing operator could be at any position. This scenario places it last (highest ID) to verify the loop doesn't short-circuit early on success.

**Setup:**
1. Register 4 operators [op1, op2, op3, op4] sorted.
2. op1, op2 are public. op3, op4 are private.
3. Whitelist `registrant` for op3 only. op4 has NO whitelist entry for `registrant`.

**Execution:**
1. `registrant` calls `registerValidator` with cluster `[op1, op2, op3, op4]`.

**Assertions:**
- Reverts with `CallerNotWhitelistedWithData(op4)`.
- No state changes (atomic revert).

**Variant:** Place the non-whitelisted operator first in the sorted list to confirm the revert surfaces the correct operatorId regardless of position.

---

### WL-037: removeOperator Clears operatorsWhitelist but NOT whitelisted Flag

**Scenario:** Operator is private (`whitelisted=true`) with a whitelisting contract set. After `removeOperator`, verify the cleanup scope.

**Why complex:** This tests a deliberate design decision: `removeOperator` calls `delete s.operatorsWhitelist[operatorId]` (line 95) which clears the whitelisting contract mapping, but `_resetOperatorState` (line 347-358) does NOT clear `operator.whitelisted`. This is harmless because the operator is fully deleted (block=0, owner=0), but understanding this gap matters for re-registration scenarios and storage analysis.

**Setup:**
1. Register operator (id=X). Set private. Set whitelisting contract.
2. Whitelist addressA via bitmap for operator X.

**Execution:**
1. Owner calls `removeOperator(X)`.

**Assertions:**
- `operatorsWhitelist[X]` == address(0) — contract mapping cleared.
- `operator.whitelisted` is still `true` (field NOT reset by `_resetOperatorState`).
- `operator.owner` == address(0), `snapshot.block` == 0 — operator is effectively deleted.
- `addressWhitelistedForOperators[addressA][X >> 8]` still has bit set — bitmap NOT cleared.
- Attempting to register a validator using operator X → reverts `OperatorDoesNotExist` (not a whitelist error).

---

### WL-038: removeOperator Does NOT Clear Bitmap Entries

**Scenario:** Complementary to WL-037. Focuses specifically on bitmap residue after operator removal and its implications.

**Why complex:** This is a storage hygiene scenario. After `removeOperator(X)`, the bitmap entry `addressWhitelistedForOperators[addressA][X >> 8]` retains the bit for operator X. If a new operator is later registered and receives the same operatorId X, the stale bitmap entry could grant unintended whitelist access — but only if the new operator is set to private. This tests whether the protocol handles this edge case.

**Setup:**
1. Register operator (id=X, counter-based). Set private. Whitelist addressA.
2. Remove operator X.
3. Register a NEW operator that gets id=X+1 (counter increments, so id reuse doesn't happen with Counters.sol).

**Assertions:**
- New operator gets a different ID → no collision. The stale bitmap bit for operator X is inert.
- However: if using direct storage manipulation to simulate ID reuse, verify that the stale bit would grant access.

**Note:** With OpenZeppelin `Counters`, operator IDs always increment, so ID reuse cannot happen in practice. This scenario documents that design assumption.

---

### WL-039: Privacy Toggle + Whitelist Interaction Flow

**Scenario:** Full lifecycle: operator starts public → set private → add whitelist → verify restricted → set public → verify unrestricted → set private again → verify whitelist still active.

**Why complex:** Tests the interaction between `setOperatorsPrivateUnchecked` / `setOperatorsPublicUnchecked` (which toggle `operator.whitelisted`) and the whitelist entries (which persist in bitmap/contract regardless of privacy toggle). The key insight: toggling public does NOT clear whitelist data. Toggling back to private re-activates the existing whitelist without needing to re-set it.

**Setup:**
1. Register operator (id=X). Default state (public or check default).
2. Whitelist addressA for operator X via bitmap.

**Execution sequence:**
1. `setOperatorsPrivateUnchecked([X])` → operator is now private.
2. addressA registers validator → succeeds (whitelisted).
3. addressB registers validator → reverts (not whitelisted).
4. `setOperatorsPublicUnchecked([X])` → operator is now public.
5. addressB registers validator → succeeds (public, no whitelist check).
6. `setOperatorsPrivateUnchecked([X])` → operator is private again.
7. addressA registers validator → succeeds (bitmap entry persisted through toggle).
8. addressB registers validator → reverts (not whitelisted, bitmap was never set for addressB).

**Assertions:**
- Privacy toggle does not modify `addressWhitelistedForOperators` or `operatorsWhitelist`.
- Whitelist entries survive public/private transitions.
- `OperatorPrivacyStatusUpdated` events emitted correctly at each toggle.

---

### WL-040: Cross-Slot Bulk Bitmap Stress

**Scenario:** `setOperatorsWhitelists` with operatorIds [1, 255, 256, 511, 512] spanning 3 distinct block-index slots, and 3 different whitelist addresses.

**Why complex:** The `generateBlockMasks` function creates a masks array sized from `startBlockIndex` to `lastBlockIndex`. With operators [1, 255, 256, 511, 512]:
- `startBlockIndex = 1 >> 8 = 0`
- Last block index = `512 >> 8 = 2`
- Masks array length = `2 - 0 + 1 = 3`
- `masks[0]` = bits for ops 1 (bit 1) and 255 (bit 255) = `(1 << 1) | (1 << 255)`
- `masks[1]` = bits for ops 256 (bit 0) and 511 (bit 255) = `(1 << 0) | (1 << 255)`
- `masks[2]` = bit for op 512 (bit 0) = `(1 << 0)`

Each of the 3 addresses gets all 3 mask updates applied. This is the most comprehensive bitmap coverage test.

**Setup:**
1. Register 5 operators with IDs 1, 255, 256, 511, 512 (requires registering enough operators to reach these IDs, or using direct storage setup).
2. Set all 5 private.

**Execution:**
1. Owner calls `setOperatorsWhitelists([1, 255, 256, 511, 512], [addrA, addrB, addrC])`.

**Assertions per address (addrA, addrB, addrC):**
- `addressWhitelistedForOperators[addr][0] == (1 << 1) | (1 << 255)`
- `addressWhitelistedForOperators[addr][1] == (1 << 0) | (1 << 255)`
- `addressWhitelistedForOperators[addr][2] == (1 << 0)`

**Follow-up:**
- Remove whitelist for ops [255, 256] only: verify masks[0] bit 255 cleared, masks[1] bit 0 cleared, other bits unchanged.
- Each address can register validators with any of the 5 operators.
- After partial removal, addresses can only register with ops [1, 511, 512].

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original WL-001 through WL-040 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| WL-041 | removeOperatorsWhitelists | Revert: empty operator array — verify `InvalidOperatorIdsLength` (mirrors WL-009 for the remove path) | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:555-558 |
| WL-042 | removeOperatorsWhitelists | Revert: empty address array — verify `InvalidWhitelistAddressesLength` (mirrors WL-010 for the remove path) | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:438-439 |
| WL-043 | removeOperatorsWhitelists | Revert: unsorted operator IDs — verify `UnsortedOperatorsList` (mirrors WL-013 for the remove path) | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:498-503 |
| WL-044 | removeOperatorsWhitelists | Revert: duplicate operator IDs — verify `OperatorsListNotUnique` (mirrors WL-014 for the remove path) | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:498-500 |
| WL-045 | removeOperatorsWhitelists | Revert: non-existent operator ID — verify `OperatorDoesNotExist` via `checkOwner` | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:112-114 |
| WL-046 | setOperatorsWhitelistingContract | Call with empty operator IDs array — verify `InvalidOperatorIdsLength` revert | `entry:setOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:37-70, OperatorLib.sol:555-558 |
| WL-047 | setOperatorsWhitelistingContract | Call with non-existent operator ID — verify `OperatorDoesNotExist` revert | `entry:setOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:54, OperatorLib.sol:112-114 |
| WL-048 | removeOperatorsWhitelistingContract | Call with empty operator IDs array — verify `InvalidOperatorIdsLength` revert | `entry:removeOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:75-91, OperatorLib.sol:555-558 |
| WL-049 | removeOperatorsWhitelistingContract | Call with non-existent operator ID — verify `OperatorDoesNotExist` revert | `entry:removeOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:85, OperatorLib.sol:112-114 |
| WL-050 | removeOperatorsWhitelistingContract | Call on operator with no whitelisting contract set — idempotent no-op, sets address(0) to address(0). Verify no revert. | `entry:removeOperatorsWhitelistingContract; revert:no` | [ ] | SSVOperatorsWhitelist.sol:75-91 |
| WL-051 | registerValidator | Bitmap cache reload: register with operators spanning 2+ blockIndex slots where msg.sender is whitelisted in both slots. Verify `currentWhitelistedMask` is reloaded at slot boundary (line 186-189). | `entry:registerValidator; revert:no` | [ ] | OperatorLib.sol:183-209 |
| WL-052 | registerValidator | Bitmap miss with zero legacy slot: private operator where bitmap bit is NOT set and `operatorsWhitelist[operatorId] == address(0)` — revert `CallerNotWhitelistedWithData`. Verify the zero-address fallthrough. | `entry:registerValidator; revert:yes` | [ ] | OperatorLib.sol:194-196 |
| WL-053 | registerValidator | Non-whitelisting contract in legacy slot: `operatorsWhitelist[operatorId]` holds an address that does NOT implement `ISSVWhitelistingContract` and is NOT msg.sender — verify fallthrough to revert `CallerNotWhitelistedWithData`. | `entry:registerValidator; revert:yes` | [ ] | OperatorLib.sol:199-207 |

---

## ask-codex Review Findings

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| WL-054 | setOperatorsWhitelists | Cross-slot unsorted input e.g. [256, 255] — `generateBlockMasks` may panic on length math before reaching `UnsortedOperatorsList`. | `entry:setOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:483, 486, 498 |
| WL-055 | setOperatorsWhitelists | Sparse-gap masks — operator IDs like [1, 512] leaving empty blocks between startBlockIndex and endBlockIndex. Verify zero-mask skip at OperatorLib.sol:455,458. | `entry:setOperatorsWhitelists; revert:no` | [ ] | OperatorLib.sol:455, 458 |
| WL-056 | removeOperatorsWhitelists | Empty array input → revert `InvalidWhitelistAddressesLength` or `InvalidOperatorIdsLength`. | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:438, 441 |
| WL-057 | removeOperatorsWhitelists | Unsorted operator IDs in remove call → revert `UnsortedOperatorsList`. | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:498 |
| WL-058 | removeOperatorsWhitelists | Non-existent operator in remove call → revert `OperatorDoesNotExist`. | `entry:removeOperatorsWhitelists; revert:yes` | [ ] | OperatorLib.sol:449 |
| WL-059 | setOperatorsWhitelistingContract | Existing whitelist is a non-ERC165 contract (deployed but fails supportsInterface) → old whitelist cleared, new one set. | `entry:setOperatorsWhitelistingContract; revert:no` | [ ] | SSVOperatorsWhitelist.sol:56, 60 |
| WL-060 | registerValidator (via whitelist) | Whitelisting contract passes ERC165 but misbehaves on `isWhitelisted` (reverts or returns garbage). Unguarded external call at OperatorLib.sol:203-204. | `entry:registerValidator; revert:yes` | [ ] | OperatorLib.sol:203-204 |
| WL-061 | setOperatorsWhitelistingContract | Empty operator array → revert `InvalidOperatorIdsLength`. | `entry:setOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:45 |
| WL-062 | removeOperatorsWhitelistingContract | Non-existent operator → revert `OperatorDoesNotExist`. | `entry:removeOperatorsWhitelistingContract; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:85 |
| WL-063 | removeOperatorsWhitelistingContract | Remove whitelisting contract with no bitmap fallback → next private registration reverts at OperatorLib.sol:194. | `entry:removeOperatorsWhitelistingContract+registerValidator; revert:yes` | [ ] | SSVOperatorsWhitelist.sol:87, OperatorLib.sol:194 |
| WL-064 | setOperatorsPrivateUnchecked | Toggle public→private: verify `operatorsWhitelist` slot persists across toggle at SSVOperators.sol:219,227 and OperatorLib.sol:193. | `entry:setOperatorsPrivateUnchecked; revert:no` | [ ] | SSVOperators.sol:219, 227, OperatorLib.sol:193 |
