# Assembly Safety Guide for SSV Network

## Overview

SSV Network uses inline assembly extensively for:
1. **Diamond storage access** - deterministic slot computation
2. **Gas optimization** - packed type operations
3. **Low-level operations** - delegatecall routing in SSVNetwork proxy

Assembly bypasses Solidity's built-in safety checks. **Bugs in assembly are catastrophic** - they can corrupt storage, cause silent failures, or create exploits that are invisible to standard tooling.

This guide covers assembly-specific bug patterns and how to fix them safely.

## When Assembly is Used in SSV

### 1. Diamond Storage Pattern

Every storage library uses assembly to access a deterministic slot:

```solidity
function s() private pure returns (SSVStorage storage $) {
    assembly {
        $.slot := SSV_STORAGE_SLOT
    }
}

// Where SSV_STORAGE_SLOT = keccak256(abi.encode("ssv.network.storage.main")) - 1
```

### 2. Delegatecall Routing

SSVNetwork proxy routes calls to modules via delegatecall:

```solidity
function _delegate(address module) internal {
    assembly {
        calldatacopy(0, 0, calldatasize())
        let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
        returndatacopy(0, 0, returndatasize())
        switch result
        case 0 { revert(0, returndatasize()) }
        default { return(0, returndatasize()) }
    }
}
```

### 3. Packed Type Operations (Rare)

Some gas-critical paths may use assembly for packing/unpacking (though SSVPackedLib handles most cases).

## Critical Assembly Bugs in SSV Context

### Bug 1: Delegatecall to Empty Address

**Vulnerability**: `delegatecall` returns `true` if the target address has no code.

```solidity
// ❌ VULNERABLE: No contract existence check
function _delegate(address module) internal {
    assembly {
        // ... delegatecall ...
        switch result
        case 0 { revert(0, returndatasize()) }
        default { return(0, returndatasize()) }
    }
}
```

**Impact**: If `module` address is zero or points to empty address, the call succeeds silently, returning empty data. Functions appear to work but do nothing.

**Fix**: Add contract existence check before delegatecall

```solidity
// ✅ SAFE: Check contract exists
function _delegate(address module) internal {
    assembly {
        // Check code size > 0
        if iszero(extcodesize(module)) {
            // revert with "ModuleDoesNotExist()"
            mstore(0x00, 0x...) // Error selector
            revert(0x00, 0x04)
        }

        calldatacopy(0, 0, calldatasize())
        let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
        returndatacopy(0, 0, returndatasize())
        switch result
        case 0 { revert(0, returndatasize()) }
        default { return(0, returndatasize()) }
    }
}
```

**SSV-specific check**: Verify module registration in storage before delegatecall.

### Bug 2: Storage Slot Collision

**Vulnerability**: Incorrect slot computation or hardcoded slots can collide with proxy storage.

```solidity
// ❌ DANGEROUS: Hardcoded slot without derivation
uint256 private constant MY_SLOT = 0x1234; // Could collide!

// ❌ WRONG: Incorrect derivation
uint256 private constant WRONG_SLOT = keccak256("my.slot"); // Missing -1, could collide

// ✅ CORRECT: Proper EIP-2535 derivation
uint256 private constant CORRECT_SLOT = uint256(keccak256(abi.encode("ssv.network.storage.mystruct"))) - 1;
```

**Why `-1`?**
- Prevents collision with regular storage slots (which occupy low addresses)
- Prevents collision with other keccak256 hashes (which would be at exact hash value)
- Standard pattern from EIP-2535 / OpenZeppelin

**Verification**:
```bash
# Check slot values don't collide
forge inspect SSVStorage storage-layout
forge inspect SSVStorageProtocol storage-layout
# Manually verify each SLOT constant
```

### Bug 3: Arithmetic Overflow in Assembly

**Vulnerability**: Assembly arithmetic has NO overflow checks - Solidity 0.8+ checks don't apply.

```solidity
// ❌ VULNERABLE: Unchecked addition
function unsafeAdd(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        result := add(a, b) // CAN OVERFLOW!
    }
}

// ❌ VULNERABLE: Unchecked multiplication
function unsafeMul(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        result := mul(a, b) // CAN OVERFLOW!
    }
}
```

**Fix**: Implement manual overflow checks

```solidity
// ✅ SAFE: Addition with overflow check
function safeAdd(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        result := add(a, b)
        // Overflow if result < a (wraparound)
        if lt(result, a) {
            // revert with custom error
            mstore(0x00, 0x...) // Overflow() selector
            revert(0x00, 0x04)
        }
    }
}

// ✅ SAFE: Multiplication with overflow check
function safeMul(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        result := mul(a, b)
        // Overflow if b != 0 and result / b != a
        if and(iszero(iszero(b)), iszero(eq(div(result, b), a))) {
            mstore(0x00, 0x...) // Overflow() selector
            revert(0x00, 0x04)
        }
    }
}
```

**SSV best practice**: Use checked Solidity arithmetic outside assembly, only use assembly for storage access.

### Bug 4: Division by Zero

**Vulnerability**: EVM `div` and `mod` opcodes return 0 for division by zero (no revert).

```solidity
// ❌ SILENT FAILURE: Returns 0 instead of reverting
function unsafeDiv(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        result := div(a, b) // Returns 0 if b == 0!
    }
}
```

**Fix**: Explicit zero check

```solidity
// ✅ SAFE: Explicit zero check
function safeDiv(uint256 a, uint256 b) internal pure returns (uint256 result) {
    assembly {
        if iszero(b) {
            mstore(0x00, 0x...) // DivisionByZero() selector
            revert(0x00, 0x04)
        }
        result := div(a, b)
    }
}
```

### Bug 5: Signed Integer Comparison

**Vulnerability**: Using wrong comparison opcode for signed integers.

```solidity
// ❌ WRONG: Using unsigned comparison on signed integer
function wrongComparison(int256 a, int256 b) internal pure returns (bool) {
    assembly {
        result := lt(a, b) // WRONG: lt is unsigned!
        // -1 (0xFFFF...FFFF) > 0 (0x0000...0000) in unsigned
    }
}

// ✅ CORRECT: Use signed comparison
function correctComparison(int256 a, int256 b) internal pure returns (bool) {
    assembly {
        result := slt(a, b) // CORRECT: slt is signed less-than
    }
}
```

**Opcodes for signed operations**:
- `slt` / `sgt` - signed less-than / greater-than
- `sdiv` / `smod` - signed division / modulo
- Use `signextend` when working with sub-32-byte signed integers

### Bug 6: Sub-32-Byte Type Truncation

**Vulnerability**: Assembly doesn't automatically clean upper bits of sub-32-byte types.

```solidity
// ❌ DANGEROUS: Upper bits may contain garbage
function unsafeCast(uint256 value) internal pure returns (uint64 result) {
    assembly {
        result := value // Upper 192 bits may be dirty!
    }
}

// ✅ SAFE: Explicit bit masking
function safeCast(uint256 value) internal pure returns (uint64 result) {
    assembly {
        result := and(value, 0xFFFFFFFFFFFFFFFF) // Mask to 64 bits

        // Or check bounds and revert on overflow
        if gt(value, 0xFFFFFFFFFFFFFFFF) {
            mstore(0x00, 0x...) // Overflow() selector
            revert(0x00, 0x04)
        }
        result := value
    }
}
```

**For signed types**, use `signextend`:
```solidity
function signExtend64(int256 value) internal pure returns (int64 result) {
    assembly {
        // signextend(7, value) extends from byte 7 (64 bits)
        result := signextend(7, value)
    }
}
```

### Bug 7: Memory Corruption

**Vulnerability**: Assembly can overwrite memory used by Solidity.

```solidity
// ❌ DANGEROUS: May corrupt Solidity's free memory pointer
function unsafeMemoryWrite() internal pure {
    assembly {
        mstore(0x40, 0x1234) // CORRUPTS FREE MEMORY POINTER!
    }
}

// ✅ SAFE: Use free memory correctly
function safeMemoryWrite() internal pure returns (uint256 result) {
    assembly {
        // 1. Load free memory pointer
        let ptr := mload(0x40)

        // 2. Write data at ptr
        mstore(ptr, 0x1234)

        // 3. Update free memory pointer
        mstore(0x40, add(ptr, 0x20))

        result := ptr
    }
}
```

**SSV pattern**: Most SSV assembly only reads/writes storage slots, not memory. Memory corruption is rare but check for it.

## Balance Underflow Protection Pattern

**Common bug**: Cluster balance underflow when fees exceed balance.

```solidity
// ❌ VULNERABLE: Reverts on underflow (even in 0.8+)
function wrongPattern(uint256 balance, uint256 fees) internal pure returns (uint256) {
    return balance - fees; // Reverts if fees > balance
}

// ✅ CORRECT: Saturating subtraction (max at 0)
function correctPattern(uint256 balance, uint256 fees) internal pure returns (uint256) {
    return (fees >= balance) ? 0 : balance - fees;
}

// Alternative: Use unchecked with explicit check
function alternativePattern(uint256 balance, uint256 fees) internal pure returns (uint256) {
    unchecked {
        if (fees >= balance) return 0;
        return balance - fees;
    }
}
```

**SSV usage**: Apply to cluster balance updates, operator earnings, DAO balance.

**Why saturating instead of reverting?**
- Allows liquidation to proceed even if fees exceed balance
- Prevents griefing by forcing cluster into unliquidatable state
- Matches economic model: zero balance = liquidatable, not error

## Assembly Safety Checklist

Before merging any assembly code:

### Pre-Implementation
- [ ] Is assembly truly necessary? Can Solidity achieve the same result safely?
- [ ] Have you documented WHY assembly is required? (gas, storage pattern, etc.)
- [ ] Is there a high-level Solidity reference implementation to compare against?

### Arithmetic Safety
- [ ] All arithmetic operations have overflow checks (or proven impossible)
- [ ] Division by zero explicitly checked (or proven impossible)
- [ ] Correct opcode used for signed vs unsigned operations
- [ ] Sub-32-byte types have explicit bit masking or bounds checks

### Storage Safety
- [ ] Storage slots computed correctly (keccak256(...) - 1 pattern)
- [ ] No hardcoded slot values (except well-known constants)
- [ ] Verified no slot collisions with other storage structs
- [ ] Diamond storage pattern followed consistently

### External Calls
- [ ] `delegatecall` target existence verified (extcodesize > 0)
- [ ] Return values checked (not just relying on revert)
- [ ] Call success verified before using returned data
- [ ] Gas forwarded correctly (use `gas()` not hardcoded values)

### Memory Safety
- [ ] Free memory pointer (0x40) not corrupted
- [ ] Memory writes use free memory region
- [ ] Memory reads don't assume uninitialized memory is zero

### Testing
- [ ] Unit test with normal values
- [ ] Unit test with boundary values (0, max uint256, etc.)
- [ ] Unit test with values that should revert
- [ ] Differential fuzzing against Solidity reference implementation (if applicable)
- [ ] Gas benchmarks justify assembly usage

## Common Assembly Patterns in SSV

### Pattern 1: Diamond Storage Access (Safe)

```solidity
// ✅ This pattern is safe and standard
function s() private pure returns (SSVStorage storage $) {
    assembly {
        $.slot := SSV_STORAGE_SLOT
    }
}

// Usage
s().operators[operatorId].fee = newFee;
```

**Why safe?**
- Single slot assignment, no arithmetic
- Slot value computed at compile time (constant)
- Solidity handles all subsequent storage access

### Pattern 2: Delegatecall Routing (Needs Existence Check)

```solidity
// ⚠️ Add extcodesize check before delegatecall
function _delegate(address module) internal {
    // ✅ Add this check
    if (module.code.length == 0) revert ModuleDoesNotExist();

    assembly {
        calldatacopy(0, 0, calldatasize())
        let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
        returndatacopy(0, 0, returndatasize())
        switch result
        case 0 { revert(0, returndatasize()) }
        default { return(0, returndatasize()) }
    }
}
```

### Pattern 3: Packed Type Manipulation (Prefer Library)

```solidity
// ❌ Avoid manual packing in assembly
function manualPack(uint256 value) internal pure returns (uint64) {
    assembly {
        // Missing overflow check!
        result := div(value, 100000)
    }
}

// ✅ Use SSVPackedLib instead
function safePack(uint256 value) internal pure returns (PackedETH) {
    return value.pack(); // Library handles overflow check
}
```

## Debugging Assembly Bugs

### Symptoms of Assembly Bugs

| Symptom | Likely Cause |
|---------|--------------|
| Silent failure (no revert, wrong result) | Delegatecall to empty address, division by zero |
| Storage corruption (wrong values) | Slot collision, wrong slot computation |
| Occasional overflow (works with small values) | Missing overflow check |
| Works in tests, fails on mainnet | Memory corruption, gas estimation issues |
| Wrong comparison results | Using `lt` instead of `slt` for signed integers |

### Debugging Tools

**1. Forge Debugger**
```bash
forge test --debug testFunctionName
# Step through EVM opcodes
```

**2. Hardhat Console**
```typescript
await hardhat.tracer.enable();
await contract.functionWithAssembly();
await hardhat.tracer.disable();
```

**3. Manual Verification**
```solidity
// Add Solidity reference implementation for comparison
function referenceImplementation(uint256 a, uint256 b) public pure returns (uint256) {
    return a + b; // Solidity checked math
}

function assemblyImplementation(uint256 a, uint256 b) public pure returns (uint256 result) {
    assembly {
        result := add(a, b)
        if lt(result, a) { revert(0, 0) }
    }
}

// Test: both should return same result
function testEquivalence(uint256 a, uint256 b) public {
    assert(referenceImplementation(a, b) == assemblyImplementation(a, b));
}
```

**4. Echidna Differential Testing**
```solidity
contract EchidnaAssemblyTest {
    function echidna_assembly_matches_solidity(uint256 a, uint256 b) public returns (bool) {
        // Assume inputs won't overflow
        if (a > type(uint256).max - b) return true;

        return referenceImplementation(a, b) == assemblyImplementation(a, b);
    }
}
```

## Gas Optimization vs Safety

Assembly is often used for gas optimization. **Always prioritize safety over gas savings.**

### When Assembly is Justified

✅ **Good reasons**:
- Diamond storage pattern (standard, safe, necessary)
- Significant gas savings (>5000 gas per call in hot path)
- No safe Solidity alternative (rare)

❌ **Bad reasons**:
- Marginal gas savings (<1000 gas)
- "Looks cool" or "more professional"
- Avoiding Solidity type checks intentionally

### Gas Benchmark Template

If using assembly for gas optimization, prove the savings:

```typescript
describe('Gas Benchmark: Assembly vs Solidity', () => {
  it('should measure gas difference', async () => {
    const gasSolidity = await contract.solidityVersion.estimateGas(args);
    const gasAssembly = await contract.assemblyVersion.estimateGas(args);

    console.log(`Solidity: ${gasSolidity} gas`);
    console.log(`Assembly: ${gasAssembly} gas`);
    console.log(`Savings: ${gasSolidity - gasAssembly} gas`);

    // Verify correctness
    expect(await contract.solidityVersion(args))
      .to.equal(await contract.assemblyVersion(args));
  });
});
```

**Rule of thumb**: Assembly must save >5000 gas AND pass all safety checks to be worth the risk.

## Summary

### Critical Rules

1. ✅ **Always check `extcodesize` before delegatecall**
2. ✅ **Always check division by zero in assembly**
3. ✅ **Always implement overflow checks for arithmetic**
4. ✅ **Always document WHY assembly is used**
5. ✅ **Always provide Solidity reference implementation**
6. ✅ **Always use proper storage slot derivation** (keccak256 - 1)
7. ❌ **Never use assembly unless absolutely necessary**
8. ❌ **Never skip testing assembly with boundary values**

### When to Use Each Pattern

| Operation | Preferred Approach |
|-----------|-------------------|
| Diamond storage access | ✅ Assembly (standard pattern) |
| Packed type pack/unpack | ✅ SSVPackedLib (Solidity) |
| Arithmetic | ✅ Solidity 0.8+ checked math |
| Balance underflow protection | ✅ `max(0, balance - fees)` |
| Delegatecall routing | ⚠️ Assembly + extcodesize check |
| Gas optimization | ❌ Only if >5000 gas savings |

### Quick Reference: Safe Assembly Patterns

```solidity
// ✅ Storage slot access
assembly { $.slot := CONSTANT_SLOT }

// ✅ Delegatecall with existence check
if (target.code.length == 0) revert();
assembly { let result := delegatecall(...) }

// ✅ Safe addition
assembly {
    result := add(a, b)
    if lt(result, a) { revert(0, 0) }
}

// ✅ Safe multiplication
assembly {
    result := mul(a, b)
    if and(iszero(iszero(b)), iszero(eq(div(result, b), a))) {
        revert(0, 0)
    }
}

// ✅ Safe division
assembly {
    if iszero(b) { revert(0, 0) }
    result := div(a, b)
}

// ✅ Balance underflow protection (Solidity, not assembly)
return (fees >= balance) ? 0 : balance - fees;
```

**When in doubt, don't use assembly. Safe code is better than fast code.**
