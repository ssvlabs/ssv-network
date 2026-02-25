# Security Checklist for SSV Bug Fixes

## Overview

This checklist ensures every bug fix meets SSV Network's security requirements before deployment. **Run through this checklist before proposing any fix.**

Missing any of these checks can lead to:
- Loss of user funds (ETH or SSV tokens)
- Protocol bricking (inability to process operations)
- State corruption (incorrect balances, broken indices)
- Governance compromise (oracle manipulation, unauthorized upgrades)

## Pre-Implementation Security Gate

Before writing ANY code, answer these questions:

### Storage Safety
- [ ] Does this fix modify storage structs?
- [ ] If yes, are new fields ONLY appended to the END?
- [ ] Are you adding state to a module contract? (NEVER allowed)
- [ ] Have you verified storage slot computation is unchanged?

### Reentrancy
- [ ] Does this function transfer ETH?
- [ ] Does this function transfer SSV tokens?
- [ ] Does this function call external contracts?
- [ ] If any above are YES, does it have `nonReentrant` modifier?

### Access Control
- [ ] Who should be allowed to call this function?
  - [ ] Anyone (public)
  - [ ] Owner only (check at proxy level)
  - [ ] Oracle only (check `oracleIdOf[msg.sender]`)
  - [ ] Operator owner (check `operator.checkOwner()`)
  - [ ] Cluster owner (keyed by hash)
  - [ ] cSSV contract only (check `msg.sender == CSSV_ADDRESS`)
- [ ] Are there existing access checks you might break?

### Integer Safety
- [ ] Could this arithmetic overflow? (even with checked math)
- [ ] Could this arithmetic underflow?
- [ ] Are you using packed types correctly?
- [ ] Could division by zero occur?
- [ ] Are you handling the zero case explicitly?

### State Consistency
- [ ] Does this maintain the protocol invariants? (see below)
- [ ] Could this create negative balances?
- [ ] Could this break fee index monotonicity?
- [ ] Does this correctly update snapshots?

## Protocol Invariants

Your fix MUST preserve these invariants at all times:

### Balance Invariants

```solidity
// Cluster ETH balance
cluster.balance >= 0  // Never negative

// Operator ETH earnings
operator.ethEarnings <= totalETHFeesCollected

// DAO ETH balance
dao.ethBalance == totalNetworkETHFees - totalWithdrawnByDAO

// Contract ETH balance
address(ssvNetwork).balance >=
    sum(cluster.balance) +
    sum(operator.ethEarnings) +
    dao.ethBalance +
    staking.totalPendingRewards
```

### SSV Token Invariants

```solidity
// Cluster SSV balance
cluster.balance >= 0

// SSV token conservation
ssvToken.balanceOf(ssvNetwork) >=
    sum(cluster.balance) +
    dao.ssvBalance +
    sum(operator.ssvEarnings)

// cSSV supply
cSSVToken.totalSupply() == staking.totalStaked
```

### Index Invariants

```solidity
// Fee indices are monotonically increasing
newIndex >= oldIndex

// Operator snapshot <= current index
operator.ethSnapshot <= ethNetworkFeeIndex
operator.snapshot <= networkFeeIndex

// Cluster index tracking
cluster.networkFeeIndex <= networkFeeIndex
cluster.index <= sum(operator.snapshot for each operator in cluster)
```

### vUnits Invariants

```solidity
// vUnits calculation
vUnits >= validatorCount * VUNITS_PRECISION  // Min: 32 ETH/validator
vUnits <= validatorCount * (MAX_EB_PER_VALIDATOR / DEFAULT_EB_PER_VALIDATOR) * VUNITS_PRECISION  // Max: 2048 ETH/validator

// Operator vUnits tracking
operator.ethValidatorCount == sum of vUnits from all validators in operator's ETH clusters / VUNITS_PRECISION
```

### Liquidation Invariants

```solidity
// Liquidated cluster
cluster.active == false
cluster.balance == 0  // All balance transferred to liquidator

// Liquidation threshold
IF cluster.balance < minimumLiquidationCollateral
   OR cluster.balance < burnRate * minimumBlocksBeforeLiquidation * vUnits / VUNITS_PRECISION
THEN cluster is liquidatable
```

### Staking Invariants

```solidity
// Accumulator precision
accEthPerShare increases monotonically

// User rewards
pendingRewards[user] == (userCSSVBalance * (accEthPerShare - userIndex)) / 1e18

// Unstaking
unstakeRequest.amount <= user's cSSV balance at request time
unstakeRequest.claimableAt == requestTime + cooldownDuration
```

## Code Review Checklist

### For Every Function Modified

- [ ] Function has correct visibility (external/public/internal/private)
- [ ] Function has correct state mutability (pure/view/payable)
- [ ] Parameters are validated before use
- [ ] Return values are correct type and semantics
- [ ] Events are emitted with correct parameters
- [ ] Reverts have descriptive custom errors
- [ ] Comments are updated to match new behavior

### For Arithmetic Operations

- [ ] No unchecked blocks unless explicitly justified
- [ ] Division by zero is impossible or checked
- [ ] Multiplication precedes division (minimize precision loss)
- [ ] Packed type conversions use library functions
- [ ] Precision loss is checked for user input
- [ ] Ceiling division used where required (vUnits calculation)
- [ ] **Precision loss is documented** against ground-truth for every formula with rounding: direction (floor/ceiling), magnitude, who bears it (see `packed-types-guide.md` § "Precision Loss Documentation Requirement")

### For Storage Updates

- [ ] State changes follow Checks-Effects-Interactions pattern
- [ ] All related indices/snapshots are updated together
- [ ] Storage updates happen before external calls
- [ ] Memory→storage writes are explicit and correct

### For External Interactions

- [ ] ETH transfers use `.transfer()` or safe `.call{value:}`
- [ ] Token transfers check return value or use SafeERC20
- [ ] No external calls to user-controlled contracts without reentrancy guard
- [ ] Oracle calls verify merkle proofs correctly
- [ ] External calls cannot break protocol state

## Specific Bug Category Checks

### Storage Bug Fixes

- [ ] New fields only appended to end of structs
- [ ] No fields removed or reordered
- [ ] No type changes to existing fields
- [ ] Diamond storage slot computation unchanged
- [ ] Tested with mainnet fork to verify no state corruption

### Reentrancy Bug Fixes

- [ ] `nonReentrant` modifier added to vulnerable function
- [ ] State updates moved before external calls
- [ ] Checks-Effects-Interactions pattern verified
- [ ] Test includes reentrancy attack scenario
- [ ] Gas cost increase documented (~2000 gas)

### Packed Type Bug Fixes

- [ ] Correct precision constant used:
  - [ ] ETH: `ETH_DEDUCTED_DIGITS` (100,000)
  - [ ] SSV: `DEDUCTED_DIGITS` (10,000,000)
- [ ] Using library functions (`.pack()`, `.unpack()`)
- [ ] No magic numbers in code
- [ ] Divisibility checked for user input
- [ ] Test includes non-divisible amount (should revert)
- [ ] Test includes max value (should not overflow)

### Logic Bug Fixes

- [ ] Fix matches SPEC.md expected behavior
- [ ] All edge cases handled (zero, max, min)
- [ ] Fee calculation formulas match SPEC.md
- [ ] vUnits conversion correct (with ceiling division)
- [ ] Test covers the bug scenario
- [ ] Test verifies fix works correctly

### Oracle/EB Bug Fixes

- [ ] Merkle proof verification correct (double-hash)
- [ ] EB range validated (32 ETH to 2048 ETH per validator)
- [ ] Block number monotonicity enforced
- [ ] vUnits calculation uses ceiling division
- [ ] Both implicit and explicit EB paths tested
- [ ] Quorum calculation correct

### Staking Bug Fixes

- [ ] Accumulator math uses 1e18 precision
- [ ] User index updated before reward claim
- [ ] Pending rewards calculated correctly
- [ ] Cooldown duration enforced
- [ ] cSSV mint/burn balanced
- [ ] ETH transfer after state update

## Testing Security Checklist

- [ ] Unit test proves the bug is fixed
- [ ] Test includes the edge case that caused the bug
- [ ] Test verifies no revert on valid input
- [ ] Test verifies revert on invalid input (if applicable)
- [ ] Test checks balance invariants before and after
- [ ] Test verifies events emitted correctly
- [ ] Integration test covers full flow (if multi-module)
- [ ] Existing tests still pass (no regressions)

## Backward Compatibility Checklist

### Events
- [ ] No existing event signatures changed
- [ ] New events added alongside old (if new data needed)
- [ ] Oracle-critical events preserved:
  - [ ] `ValidatorAdded`
  - [ ] `ValidatorRemoved`
  - [ ] `ClusterLiquidated`
  - [ ] `ClusterReactivated`
  - [ ] `ClusterBalanceUpdated`
  - [ ] `RootCommitted`
  - [ ] `ClusterMigratedToETH`

### Function Signatures
- [ ] Public/external function signatures unchanged (or explicitly coordinated)
- [ ] Return values unchanged (or new overload added)
- [ ] View functions return expected types

### Storage Layout
- [ ] Existing storage slots unchanged
- [ ] Cluster struct matches event ABI
- [ ] Operator struct backward compatible

## Deployment Safety Checklist

- [ ] Fix works on mainnet fork test
- [ ] Initializer uses correct reinitializer version
- [ ] Upgrade authorization check in place
- [ ] No constructor code (use initializer)
- [ ] Module registration updated if new module

## Documentation Checklist

- [ ] MAINNET-READINESS.md task marked complete
- [ ] Test file path referenced in task
- [ ] Any remaining concerns documented
- [ ] Git commit message describes fix clearly
- [ ] Comments in code explain non-obvious logic

## Pre-Commit Final Checks

Run these commands and verify:

```bash
# Compile
just build
# ✅ Should pass without errors

# Unit tests
just test-unit
# ✅ Should pass 100%

# Integration tests
just test-integration
# ✅ Should pass 100%

# Coverage
just coverage
# ✅ Should be >= 80%

# Validation script
./.claude/skills/ssv-bug-fixer/scripts/validate-fix.sh
# ✅ Should pass all checks
```

## Common Security Pitfalls to Avoid

### ❌ NEVER Do These

```solidity
// ❌ NEVER: Storage variable in module
contract SSVOperators {
    uint256 public myNewVar;  // BREAKS PROXY PATTERN
}

// ❌ NEVER: External call before state update
function withdraw() external {
    payable(msg.sender).transfer(balance);
    balance[msg.sender] = 0;  // TOO LATE - REENTRANT
}

// ❌ NEVER: Unchecked arithmetic without justification
unchecked {
    balance -= fees;  // COULD UNDERFLOW
}

// ❌ NEVER: Wrong precision constant
uint64 packed = ethFee / DEDUCTED_DIGITS;  // WRONG CONSTANT

// ❌ NEVER: Change event signature
event ClusterLiquidated(
    address indexed owner,
    uint64[] operatorIds,
    uint256 newParam  // ❌ BREAKS ORACLE
);

// ❌ NEVER: Reorder struct fields
struct Operator {
    uint64 ethSnapshot;    // ❌ WAS SECOND, NOW FIRST
    uint64 snapshot;       // ❌ CORRUPTS EXISTING DATA
}

// ❌ NEVER: Division before multiplication
uint256 fee = amount / divisor * multiplier;  // PRECISION LOSS
```

### ✅ ALWAYS Do These

```solidity
// ✅ ALWAYS: Use diamond storage
function s() private pure returns (SSVStorage storage $) {
    assembly { $.slot := SSV_STORAGE_SLOT }
}

// ✅ ALWAYS: State update before external call
function withdraw() external nonReentrant {
    balance[msg.sender] = 0;  // FIRST
    payable(msg.sender).transfer(balance);  // THEN
}

// ✅ ALWAYS: Use checked arithmetic (default in 0.8+)
balance -= fees;  // Will revert on underflow

// ✅ ALWAYS: Correct precision constant
uint64 packed = ethFee / ETH_DEDUCTED_DIGITS;  // CORRECT

// ✅ ALWAYS: Preserve event signatures
event ClusterLiquidated(
    address indexed owner,
    uint64[] operatorIds
);  // UNCHANGED

// ✅ ALWAYS: Append to structs only
struct Operator {
    uint64 snapshot;       // EXISTING
    uint64 fee;            // EXISTING
    uint64 newField;       // ✅ APPENDED AT END
}

// ✅ ALWAYS: Multiplication before division
uint256 fee = amount * multiplier / divisor;  // MINIMIZE PRECISION LOSS
```

## Gas Optimization (Secondary Priority)

Security > Correctness > Gas. Only optimize if:

- [ ] Fix is proven correct and secure
- [ ] Gas savings are significant (>1000 gas)
- [ ] Optimization doesn't reduce readability
- [ ] Tests verify optimized version is equivalent

Common safe optimizations:
- Cache storage reads in memory
- Use `calldata` instead of `memory` for external function params
- Pack multiple `uint64` into single slot
- Use `unchecked` for loop counters (if loop bound is safe)

## When in Doubt

- **Ask before changing event signatures** → Check with oracle team
- **Ask before changing storage layout** → Verify with core team
- **Ask before adding new storage** → Confirm diamond storage pattern
- **Ask if unsure about security impact** → Better safe than exploited

## Summary

Before submitting your fix:

1. ✅ Run through this entire checklist
2. ✅ Run validation script (all checks pass)
3. ✅ Update MAINNET-READINESS.md
4. ✅ Write clear commit message
5. ✅ Create PR with context and testing evidence

**Security is non-negotiable. Take your time and verify every change.**
