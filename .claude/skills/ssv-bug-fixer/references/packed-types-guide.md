# Packed Types in SSV Network

## Overview

SSV uses **packed types** to store large numbers in `uint64` for gas optimization. This creates two parallel systems with different precision requirements.

**Critical**: Using the wrong precision constant is a common bug that causes incorrect fee calculations and balance drift.

## Two Precision Systems

### System 1: SSV Token (Legacy)

```solidity
type PackedSSV = uint64;

// Precision constant
uint256 constant DEDUCTED_DIGITS = 10_000_000;

// Conversion
Actual SSV Wei = packed_value * DEDUCTED_DIGITS
```

**Example**:
```solidity
uint256 feeWei = 10_000_000_000_000_000; // 0.01 SSV
PackedSSV packed = 1_000_000_000;        // feeWei / DEDUCTED_DIGITS
```

### System 2: ETH (V2.0.0)

```solidity
type PackedETH = uint64;

// Precision constant
uint256 constant ETH_DEDUCTED_DIGITS = 100_000;

// Conversion
Actual ETH Wei = packed_value * ETH_DEDUCTED_DIGITS
```

**Example**:
```solidity
uint256 feeWei = 1_000_000_000_000_000; // 0.001 ETH
PackedETH packed = 10_000_000_000;      // feeWei / ETH_DEDUCTED_DIGITS
```

## Why Different Precision?

- **SSV**: Smaller unit value → needs more precision (7 digits)
- **ETH**: Larger unit value → needs less precision (5 digits)

**Max values**:
- PackedSSV max: `2^64 * 10_000_000` = ~184 million SSV
- PackedETH max: `2^64 * 100_000` = ~1.8 billion ETH

## Common Bug Patterns

### Bug 1: Using Wrong Constant

```solidity
// ❌ WRONG - Using SSV constant for ETH
uint256 ethFeeWei = 1_000_000_000_000_000; // 0.001 ETH
PackedETH packed = uint64(ethFeeWei / DEDUCTED_DIGITS); // WRONG CONSTANT!
// Result: packed = 100, unpacks to 10_000_000 wei (way too small!)

// ✅ CORRECT
PackedETH packed = uint64(ethFeeWei / ETH_DEDUCTED_DIGITS);
// Result: packed = 10_000_000_000, unpacks correctly
```

### Bug 2: Manual Packing/Unpacking

```solidity
// ❌ WRONG - Manual division/multiplication
function setFee(uint256 feeWei) external {
    operator.ethFee = uint64(feeWei / 100_000); // Magic number, error-prone
}

// ✅ CORRECT - Use library
function setFee(uint256 feeWei) external {
    operator.ethFee = feeWei.pack(); // Library handles precision
}
```

### Bug 3: Mixing Systems

```solidity
// ❌ WRONG - Mixing SSV and ETH packed types
PackedSSV ssvFee = operator.fee;
PackedETH ethFee = operator.ethFee;
uint256 totalFee = ssvFee.unpack() + ethFee.unpack(); // WRONG! Different units!

// ✅ CORRECT - Convert both to wei with proper precision
uint256 ssvFeeWei = ssvFee.unpack(); // Uses DEDUCTED_DIGITS
uint256 ethFeeWei = ethFee.unpack(); // Uses ETH_DEDUCTED_DIGITS
// Now can convert one to other using exchange rate if needed
```

### Bug 4: Precision Loss Not Checked

```solidity
// ❌ WRONG - User input not validated
function declareFee(uint256 feeWei) external {
    operator.ethFee = uint64(feeWei / ETH_DEDUCTED_DIGITS);
    // If feeWei = 100_001 (not divisible), loses 1 wei silently
}

// ✅ CORRECT - Check divisibility
function declareFee(uint256 feeWei) external {
    if (feeWei % ETH_DEDUCTED_DIGITS != 0) {
        revert MaxPrecisionExceeded();
    }
    operator.ethFee = uint64(feeWei / ETH_DEDUCTED_DIGITS);
}

// ✅ EVEN BETTER - Use library that includes check
function declareFee(uint256 feeWei) external {
    operator.ethFee = feeWei.pack(); // Reverts if not divisible
}
```

## Precision Loss Documentation Requirement

Every formula involving packed types MUST be documented against a ground-truth (infinite-precision reference). Undocumented precision loss is indistinguishable from a bug.

### What to Document

For every pack/unpack operation, document:
1. **Direction**: rounding down (floor) or rounding up (ceiling)?
2. **Magnitude**: maximum precision lost per operation (e.g., up to `ETH_DEDUCTED_DIGITS - 1` = 99,999 wei)
3. **Accumulation**: does precision loss accumulate over time or is it bounded per transaction?
4. **Who bears the loss**: protocol, operator, or cluster owner?

### Documentation Pattern

```solidity
/// @dev Precision: floor division by ETH_DEDUCTED_DIGITS (100,000).
///      Max loss per pack: 99,999 wei per fee declaration.
///      Loss is one-time at input; unpack is lossless.
///      Protocol-favorable: operator cannot extract dust below ETH_DEDUCTED_DIGITS.
operator.ethFee = feeWei.pack();
```

### SSV-Specific Precision Loss Reference

| Operation | Rounding | Max Loss | Who Bears It |
|-----------|----------|----------|--------------|
| `ethFee.pack()` | Floor | 99,999 wei/block | Operator |
| `fee.packSSV()` | Floor | 9,999,999 wei/block | Operator (SSV) |
| `vUnits` ceiling division | Ceiling | 1 vUnit per validator | Protocol |
| `accEthPerShare` accumulation | Floor | 1 wei per staker per sync | Staker |
| Cluster balance `max(0, balance - fees)` | Floor at 0 | Full balance → 0 | Protocol absorbs |

### When Precision Loss IS a Bug

Precision loss is a bug (not a feature) when:
- It is **not documented** — reviewer cannot distinguish from error
- It is **protocol-unfavorable without justification** — e.g., operator gets 100x what they should
- It **accumulates unboundedly** — small rounding per block × many blocks = significant drift
- It allows **fee bypass** — user crafts input to avoid paying fees via rounding

```solidity
// ❌ BUG: Undocumented precision loss favors attacker
function registerValidatorFee(uint256 feeWei) external {
    // 99,999 wei "free" per call — no comment, no check, fee can be dust-farmed
    operator.ethFee = uint64(feeWei / ETH_DEDUCTED_DIGITS);
}

// ✅ CORRECT: Precision loss documented, divisibility enforced
/// @dev Reverts if feeWei is not an exact multiple of ETH_DEDUCTED_DIGITS.
///      Zero precision loss by construction.
function registerValidatorFee(uint256 feeWei) external {
    operator.ethFee = feeWei.pack(); // Reverts on remainder
}
```

## SSVPackedLib Usage

### Packing Functions

```solidity
using SSVPackedLib for uint256;

// ETH packing
uint256 feeWei = 1_000_000_000_000_000; // 0.001 ETH
PackedETH packed = feeWei.pack();
// Internally: requires(feeWei % ETH_DEDUCTED_DIGITS == 0)
//            packed = uint64(feeWei / ETH_DEDUCTED_DIGITS)

// SSV packing
uint256 ssvFeeWei = 10_000_000_000_000_000; // 0.01 SSV
PackedSSV packed = ssvFeeWei.packSSV();
// Internally: requires(ssvFeeWei % DEDUCTED_DIGITS == 0)
//            packed = uint64(ssvFeeWei / DEDUCTED_DIGITS)
```

### Unpacking Functions

```solidity
using SSVPackedLib for PackedETH;
using SSVPackedLib for PackedSSV;

// ETH unpacking
PackedETH packed = 10_000_000_000;
uint256 feeWei = packed.unpack();
// Result: 1_000_000_000_000_000 (0.001 ETH)

// SSV unpacking
PackedSSV packed = 1_000_000_000;
uint256 ssvFeeWei = packed.unpackSSV();
// Result: 10_000_000_000_000_000 (0.01 SSV)
```

## Identifying Which System to Use

### Decision Tree

```
What currency is this value?
├─ ETH (native token)
│  ├─ Use PackedETH
│  ├─ Use ETH_DEDUCTED_DIGITS
│  └─ Use .pack() / .unpack()
│
└─ SSV (ERC20 token)
   ├─ Use PackedSSV
   ├─ Use DEDUCTED_DIGITS
   └─ Use .packSSV() / .unpackSSV()
```

### Quick Reference

| Context | Currency | Type | Constant | Pack Method | Unpack Method |
|---------|----------|------|----------|-------------|---------------|
| Operator ETH fee | ETH | PackedETH | ETH_DEDUCTED_DIGITS | `.pack()` | `.unpack()` |
| Operator SSV fee | SSV | PackedSSV | DEDUCTED_DIGITS | `.packSSV()` | `.unpackSSV()` |
| Network ETH fee | ETH | PackedETH | ETH_DEDUCTED_DIGITS | `.pack()` | `.unpack()` |
| Network SSV fee | SSV | PackedSSV | DEDUCTED_DIGITS | `.packSSV()` | `.unpackSSV()` |
| Cluster ETH balance | ETH | uint256 | N/A | N/A | N/A |
| Cluster SSV balance | SSV | uint256 | N/A | N/A | N/A |
| DAO ETH earnings | ETH | uint256 | N/A | N/A | N/A |
| DAO SSV earnings | SSV | uint256 | N/A | N/A | N/A |

**Note**: Balances are stored as full `uint256` (not packed) because they accumulate over time and need full precision.

## vUnits and Packed Types

vUnits calculations interact with packed ETH fees:

```solidity
// vUnits calculation (NOT packed)
uint256 vUnits = (effectiveBalance * VUNITS_PRECISION) / DEFAULT_EB_PER_VALIDATOR;

// Operator fee calculation with vUnits
PackedETH ethFee = operator.ethFee;          // Packed
uint256 ethFeePerBlock = ethFee.unpack();    // Unpack to wei
uint256 totalFee = ethFeePerBlock * vUnits / VUNITS_PRECISION * blocks;
//                                 ^^^^^^^^^ vUnits scaling
```

**Common bug**: Forgetting to divide by VUNITS_PRECISION after multiplying by vUnits.

## Fee Index Math

Fee indices are stored as `PackedETH` or `PackedSSV`:

```solidity
// Network fee index update (ETH)
PackedETH currentIndex = sp().ethNetworkFeeIndex;
uint256 currentIndexWei = currentIndex.unpack();

uint256 deltaWei = feePerBlock * blocks;
uint256 newIndexWei = currentIndexWei + deltaWei;

sp().ethNetworkFeeIndex = newIndexWei.pack(); // Might revert if precision lost
```

**Critical**: Fee indices must maintain precision. If index update would lose precision, the operation should revert.

## Testing Packed Types

### Test Template

```typescript
describe('Packed Types', () => {
  describe('ETH Packing', () => {
    it('should pack and unpack correctly', async () => {
      const feeWei = ethers.parseEther('0.001'); // 1 finney

      // Pack
      const packed = await contract.packETH(feeWei);

      // Unpack
      const unpacked = await contract.unpackETH(packed);

      expect(unpacked).to.equal(feeWei);
    });

    it('should revert on non-divisible amounts', async () => {
      // 100_001 wei is not divisible by 100_000
      const badFee = 100_001n;

      await expect(
        contract.packETH(badFee)
      ).to.be.revertedWithCustomError(contract, 'MaxPrecisionExceeded');
    });

    it('should handle maximum packed value', async () => {
      // Max PackedETH: 2^64 - 1
      const maxPacked = 2n ** 64n - 1n;
      const maxWei = maxPacked * 100_000n;

      const packed = await contract.packETH(maxWei);
      expect(packed).to.equal(maxPacked);

      const unpacked = await contract.unpackETH(packed);
      expect(unpacked).to.equal(maxWei);
    });

    it('should revert on overflow', async () => {
      // Exceeds uint64 after division
      const tooBig = (2n ** 64n) * 100_000n;

      await expect(
        contract.packETH(tooBig)
      ).to.be.reverted; // Overflow in uint64 cast
    });
  });

  describe('SSV Packing', () => {
    it('should pack and unpack SSV correctly', async () => {
      const ssvWei = ethers.parseUnits('0.01', 18); // 0.01 SSV

      const packed = await contract.packSSV(ssvWei);
      const unpacked = await contract.unpackSSV(packed);

      expect(unpacked).to.equal(ssvWei);
    });

    it('should handle different precision than ETH', async () => {
      // Same numeric value, different precision
      const value = 1_000_000n;

      const ethPacked = await contract.packETH(value * 100_000n);
      const ssvPacked = await contract.packSSV(value * 10_000_000n);

      // Packed values are different due to different divisors
      expect(ethPacked).to.not.equal(ssvPacked);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero', async () => {
      const packed = await contract.packETH(0);
      expect(packed).to.equal(0);

      const unpacked = await contract.unpackETH(0);
      expect(unpacked).to.equal(0);
    });

    it('should handle minimum packable amount', async () => {
      // 1 * ETH_DEDUCTED_DIGITS = smallest packable
      const minWei = 100_000n;
      const packed = await contract.packETH(minWei);
      expect(packed).to.equal(1);
    });
  });
});
```

### Common Test Assertions

```typescript
// Verify no precision loss
expect(packed.unpack()).to.equal(originalWei);

// Verify divisibility check
await expect(contract.packETH(nonDivisible)).to.be.reverted;

// Verify correct constant used
const expectedPacked = feeWei / ETH_DEDUCTED_DIGITS;
expect(packed).to.equal(expectedPacked);

// Verify arithmetic
const fee1 = 1_000_000_000_000_000n;
const fee2 = 2_000_000_000_000_000n;
const totalPacked = (fee1 + fee2).pack();
expect(totalPacked.unpack()).to.equal(fee1 + fee2);
```

## Debugging Packed Type Issues

### Symptoms of Wrong Precision

1. **Fees way too high**: Likely unpacking with wrong constant
   ```solidity
   // Bug: Using DEDUCTED_DIGITS to unpack ETH
   uint256 fee = packed * DEDUCTED_DIGITS; // 100x too high!
   ```

2. **Fees way too low**: Likely packing with wrong constant
   ```solidity
   // Bug: Using ETH_DEDUCTED_DIGITS to pack SSV
   packed = fee / ETH_DEDUCTED_DIGITS; // 100x too small!
   ```

3. **Reverts on valid amounts**: Divisibility check using wrong constant
   ```solidity
   // Bug: Checking SSV divisibility with ETH constant
   require(ssvFee % ETH_DEDUCTED_DIGITS == 0); // Wrong!
   ```

### Verification Checklist

When reviewing packed type code:

- [ ] ETH values use `PackedETH` type
- [ ] SSV values use `PackedSSV` type
- [ ] ETH packing uses `ETH_DEDUCTED_DIGITS` or `.pack()`
- [ ] SSV packing uses `DEDUCTED_DIGITS` or `.packSSV()`
- [ ] ETH unpacking uses `ETH_DEDUCTED_DIGITS` or `.unpack()`
- [ ] SSV unpacking uses `DEDUCTED_DIGITS` or `.unpackSSV()`
- [ ] No magic numbers (100_000 or 10_000_000) in code
- [ ] Divisibility checked before packing user input
- [ ] No mixing of ETH and SSV packed values

## Migration Note: SSV to ETH

V2.0.0 introduces ETH-denominated fees alongside existing SSV fees. Operators have BOTH:

```solidity
struct Operator {
    // SSV system (legacy)
    uint64 snapshot;          // PackedSSV
    uint64 fee;               // PackedSSV
    uint32 validatorCount;

    // ETH system (new)
    uint64 ethSnapshot;       // PackedETH
    uint64 ethFee;            // PackedETH
    uint32 ethValidatorCount;
}
```

**Critical**: When working with operator fees, verify which system the code is using!

```solidity
// SSV fee calculation
uint256 ssvFee = operator.fee.unpackSSV() * blocks * validatorCount;

// ETH fee calculation
uint256 ethFee = operator.ethFee.unpack() * blocks * vUnits / VUNITS_PRECISION;
```

## Summary

### Quick Rules

1. ✅ **ETH values**: Use `PackedETH` + `ETH_DEDUCTED_DIGITS` (100,000)
2. ✅ **SSV values**: Use `PackedSSV` + `DEDUCTED_DIGITS` (10,000,000)
3. ✅ **Always** use library functions (`.pack()`, `.unpack()`)
4. ✅ **Never** use magic numbers
5. ✅ **Always** check divisibility on user input
6. ✅ **Test** with non-divisible values (should revert)
7. ✅ **Test** with max values (should not overflow)

### If You're Fixing a Packed Type Bug

1. Identify currency: ETH or SSV?
2. Find all pack/unpack operations
3. Verify correct constant used
4. Check for magic numbers
5. Add divisibility checks if missing
6. Write test with edge cases
7. Verify against SPEC.md formulas
