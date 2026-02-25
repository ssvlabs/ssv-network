# vUnits Calculation Guide for SSV Network

## Overview

**vUnits** (validator units) are the core accounting abstraction in SSV Network v2.0.0 that allows fees to scale with actual validator effective balance (EB) instead of assuming a fixed 32 ETH per validator.

This guide explains the vUnits model, common calculation errors, and how to implement vUnits math correctly.

## What Are vUnits?

vUnits represent a validator's **proportional fee burden** relative to the default 32 ETH effective balance.

### Formula

```
vUnits = effectiveBalanceETH * VUNITS_PRECISION / DEFAULT_EB_PER_VALIDATOR

Where:
- effectiveBalanceETH: actual validator EB (32-2048 ETH)
- VUNITS_PRECISION: 10,000 (4 decimal places)
- DEFAULT_EB_PER_VALIDATOR: 32 ETH
```

### Examples

```
Validator with 32 ETH:
vUnits = 32 * 10_000 / 32 = 10,000

Validator with 64 ETH:
vUnits = 64 * 10_000 / 32 = 20,000

Validator with 2048 ETH:
vUnits = 2048 * 10_000 / 32 = 640,000

Validator with 33 ETH:
vUnits = 33 * 10_000 / 32 = 10,312 (rounded up due to ceiling division)
```

**Key insight**: A validator with 64 ETH pays double the fees of a 32 ETH validator because it secures more value.

## vUnits States: Implicit vs Explicit

SSV Network uses two EB tracking modes during the transition period:

### Implicit EB (Default)

Before the first oracle EB update, clusters operate in **implicit EB mode**:

```solidity
// Implicit vUnits calculation
uint256 implicitVUnits = validatorCount * VUNITS_PRECISION;
```

**Assumption**: Each validator has exactly 32 ETH effective balance.

**When used**:
- Cluster created but no `updateClusterBalance` called yet
- EB tracking not yet enabled for this cluster

### Explicit EB (After Oracle Update)

After the first `updateClusterBalance` call, clusters switch to **explicit EB mode**:

```solidity
// Explicit vUnits stored in cluster
cluster.ebSnapshot.vUnits  // Set by oracle via merkle proof
```

**Source**: Oracle computes vUnits from beacon chain EB data and includes it in merkle tree.

**When used**:
- After first `updateClusterBalance` call
- Oracle continuously updates EB via merkle proofs

### Determining Which Mode

```solidity
function _effectiveVUnits(
    Cluster memory cluster,
    uint256 clusterID
) internal view returns (uint256) {
    if (cluster.ebSnapshot.vUnits == 0) {
        // Implicit mode - use validator count
        return cluster.validatorCount * VUNITS_PRECISION;
    } else {
        // Explicit mode - use oracle-provided vUnits
        return cluster.ebSnapshot.vUnits;
    }
}
```

**Critical**: Always check for `ebSnapshot.vUnits == 0` to distinguish modes.

## Fee Calculations with vUnits

### Operator Fee Calculation

```solidity
// Per-operator fee calculation
uint256 operatorFeePerBlock = operator.ethFee.unpack(); // ETH wei per vUnit per block

// Operator index delta (how many blocks since last snapshot)
uint256 indexDelta = currentIndex - operator.ethSnapshot;

// Total operator fee in vUnits
uint256 operatorFeeVUnits = indexDelta * operatorFeePerBlock;

// Scale by actual vUnits
uint256 operatorFeeWei = (operatorFeeVUnits * effectiveVUnits) / VUNITS_PRECISION;
```

### Network Fee Calculation

```solidity
// Network fee per block per vUnit
uint256 networkFeePerBlock = sp().ethNetworkFee.unpack();

// Network index delta
uint256 networkIndexDelta = sp().ethNetworkFeeIndex.unpack() - cluster.ethNetworkFeeIndex.unpack();

// Total network fee in vUnits
uint256 networkFeeVUnits = networkIndexDelta;

// Scale by actual vUnits
uint256 networkFeeWei = (networkFeeVUnits * effectiveVUnits) / VUNITS_PRECISION;
```

### Total Fee Calculation

```solidity
// Sum all operators
uint256 totalOperatorFeeVUnits = 0;
for (uint i = 0; i < operatorIds.length; i++) {
    Operator memory op = s().operators[operatorIds[i]];
    uint256 delta = currentIndex - op.ethSnapshot.unpack();
    totalOperatorFeeVUnits += delta * op.ethFee.unpack();
}

// Add network fee
uint256 networkFeeVUnits = sp().ethNetworkFeeIndex.unpack() - cluster.ethNetworkFeeIndex.unpack();

// Convert to wei
uint256 totalFeeWei = ((totalOperatorFeeVUnits + networkFeeVUnits) * effectiveVUnits) / VUNITS_PRECISION;

// Deduct from cluster balance
cluster.balance -= totalFeeWei;
```

## Ceiling vs Floor Division

### When to Use Ceiling Division

**Rule**: Use ceiling division when converting **EB → vUnits** to ensure users pay *at least* the correct fee (never underpay).

```solidity
// ✅ CORRECT: Ceiling division
function ebToVUnits(uint256 effectiveBalanceWei) internal pure returns (uint256) {
    return (effectiveBalanceWei * VUNITS_PRECISION + DEFAULT_EB_PER_VALIDATOR - 1)
           / DEFAULT_EB_PER_VALIDATOR;
}

// Example: 33 ETH
// (33 * 10_000 + 32 - 1) / 32
// = (330_000 + 31) / 32
// = 330_031 / 32
// = 10_313 (rounded up)
```

**Why ceiling?** If we used floor division, a validator with 32.1 ETH would pay the same as 32 ETH, underpaying the protocol.

### When to Use Floor Division

**Rule**: Use floor division (regular `/`) when converting **vUnits → EB** for display or limits, to avoid overestimating.

```solidity
// ✅ CORRECT: Floor division for display
function vUnitsToEB(uint256 vUnits) internal pure returns (uint256) {
    return (vUnits * DEFAULT_EB_PER_VALIDATOR) / VUNITS_PRECISION;
}

// Example: 10_313 vUnits
// (10_313 * 32) / 10_000
// = 330_016 / 10_000
// = 33 ETH (rounded down)
```

**Why floor?** We want to show the *minimum* EB represented by vUnits, not overestimate.

## Common vUnits Bugs

### Bug 1: Using Floor Instead of Ceiling for EB→vUnits

```solidity
// ❌ WRONG: Floor division
uint256 vUnits = (effectiveBalance * VUNITS_PRECISION) / DEFAULT_EB_PER_VALIDATOR;
// Validator with 32.1 ETH would get vUnits=10_000, underpaying

// ✅ CORRECT: Ceiling division
uint256 vUnits = (effectiveBalance * VUNITS_PRECISION + DEFAULT_EB_PER_VALIDATOR - 1)
                 / DEFAULT_EB_PER_VALIDATOR;
// Validator with 32.1 ETH gets vUnits=10_001, pays correctly
```

### Bug 2: Forgetting to Divide by VUNITS_PRECISION

```solidity
// ❌ WRONG: Missing precision division
uint256 fee = feePerVUnit * vUnits;
// Result is 10_000x too large!

// ✅ CORRECT: Divide by precision
uint256 fee = (feePerVUnit * vUnits) / VUNITS_PRECISION;
```

### Bug 3: Using Implicit vUnits When Explicit Available

```solidity
// ❌ WRONG: Always using validator count
uint256 vUnits = cluster.validatorCount * VUNITS_PRECISION;
// Ignores oracle-provided explicit EB!

// ✅ CORRECT: Check for explicit EB first
uint256 vUnits = cluster.ebSnapshot.vUnits > 0
    ? cluster.ebSnapshot.vUnits
    : cluster.validatorCount * VUNITS_PRECISION;
```

### Bug 4: Not Checking vUnits Bounds

```solidity
// ❌ WRONG: No bounds check
cluster.ebSnapshot.vUnits = oracleProvidedVUnits;
// Oracle could provide out-of-range value!

// ✅ CORRECT: Enforce bounds
uint256 minVUnits = cluster.validatorCount * VUNITS_PRECISION; // 32 ETH each
uint256 maxVUnits = cluster.validatorCount * (MAX_EB_PER_VALIDATOR * VUNITS_PRECISION / DEFAULT_EB_PER_VALIDATOR);
require(vUnits >= minVUnits && vUnits <= maxVUnits, "vUnits out of range");
```

### Bug 5: Integer Overflow in vUnits Math

```solidity
// ❌ WRONG: Potential overflow
uint256 fee = vUnits * feePerBlock * blockDiff;
// If vUnits=640_000, feePerBlock=1e9, blockDiff=100_000, this overflows uint256!

// ✅ CORRECT: Use intermediate divisions
uint256 feePerVUnit = feePerBlock * blockDiff;
uint256 fee = (feePerVUnit * vUnits) / VUNITS_PRECISION;
```

## Operator vUnits Accounting

Operators track total vUnits across all their ETH-denominated validators:

```solidity
struct Operator {
    // ... other fields ...
    uint64 ethValidatorCount;  // Sum of vUnits / VUNITS_PRECISION for all validators
}
```

### Adding Validator

```solidity
// When validator added to ETH cluster
uint256 newVUnits = // calculated from EB or implicit
operator.ethValidatorCount += uint64((newVUnits + VUNITS_PRECISION - 1) / VUNITS_PRECISION);
```

**Note**: `ethValidatorCount` is stored as "virtual validator count" by dividing vUnits by precision.

### Removing Validator

```solidity
// When validator removed from ETH cluster
uint256 removedVUnits = // from cluster state
operator.ethValidatorCount -= uint64((removedVUnits + VUNITS_PRECISION - 1) / VUNITS_PRECISION);
```

### Querying Operator Capacity

```solidity
// Check if operator has capacity for new validator
uint256 currentVUnits = operator.ethValidatorCount * VUNITS_PRECISION;
uint256 maxVUnits = operator.maxValidators * VUNITS_PRECISION;
require(currentVUnits + newValidatorVUnits <= maxVUnits, "Operator at capacity");
```

## Testing vUnits Calculations

### Test Template

```typescript
describe('vUnits Calculations', () => {
  describe('EB to vUnits Conversion', () => {
    it('should use ceiling division for EB to vUnits', async () => {
      // 32 ETH - exact
      expect(await contract.ebToVUnits(ethers.parseEther('32')))
        .to.equal(10_000);

      // 32.1 ETH - should round up
      expect(await contract.ebToVUnits(ethers.parseEther('32.1')))
        .to.equal(10_032); // Ceiling: (32.1 * 10_000 + 31) / 32

      // 33 ETH - should round up
      expect(await contract.ebToVUnits(ethers.parseEther('33')))
        .to.equal(10_313); // Ceiling: (33 * 10_000 + 31) / 32

      // 64 ETH - exact
      expect(await contract.ebToVUnits(ethers.parseEther('64')))
        .to.equal(20_000);

      // 2048 ETH - max
      expect(await contract.ebToVUnits(ethers.parseEther('2048')))
        .to.equal(640_000);
    });

    it('should use floor division for vUnits to EB', async () => {
      // 10_000 vUnits
      expect(await contract.vUnitsToEB(10_000))
        .to.equal(ethers.parseEther('32'));

      // 10_313 vUnits (from 33 ETH)
      expect(await contract.vUnitsToEB(10_313))
        .to.equal(ethers.parseEther('33.0016')); // Floor: (10_313 * 32) / 10_000
    });
  });

  describe('Fee Scaling with vUnits', () => {
    it('should charge double fee for 64 ETH validator', async () => {
      // Setup: operator with 1 gwei/vUnit/block fee
      const feePerVUnit = 1_000_000_000n; // 1 gwei

      // Case 1: 32 ETH validator (10_000 vUnits)
      const fee32 = await contract.calculateFee(feePerVUnit, 10_000, 100); // 100 blocks
      expect(fee32).to.equal(100n * 1_000_000_000n); // 100 gwei total

      // Case 2: 64 ETH validator (20_000 vUnits)
      const fee64 = await contract.calculateFee(feePerVUnit, 20_000, 100);
      expect(fee64).to.equal(200n * 1_000_000_000n); // 200 gwei total (2x)
    });

    it('should handle non-standard EB correctly', async () => {
      // Validator with 33 ETH (10_313 vUnits due to ceiling)
      const fee33 = await contract.calculateFee(1_000_000_000n, 10_313, 100);

      // Expected: 100 blocks * 1 gwei/vUnit/block * 10_313 vUnits / 10_000
      // = 100 * 1_000_000_000 * 10_313 / 10_000
      // = 103_130_000_000 (103.13 gwei)
      expect(fee33).to.equal(103_130_000_000n);
    });
  });

  describe('Implicit vs Explicit vUnits', () => {
    it('should use implicit vUnits when ebSnapshot.vUnits is 0', async () => {
      const cluster = {
        validatorCount: 4,
        ebSnapshot: { vUnits: 0, blockNumber: 0 },
        // ... other fields
      };

      const vUnits = await contract.effectiveVUnits(cluster);
      expect(vUnits).to.equal(40_000); // 4 * 10_000
    });

    it('should use explicit vUnits when ebSnapshot.vUnits is set', async () => {
      const cluster = {
        validatorCount: 4,
        ebSnapshot: { vUnits: 45_000, blockNumber: 100 }, // Explicit EB
        // ... other fields
      };

      const vUnits = await contract.effectiveVUnits(cluster);
      expect(vUnits).to.equal(45_000); // Use explicit value
    });
  });

  describe('Operator vUnits Accounting', () => {
    it('should increment operator ethValidatorCount when validator added', async () => {
      const operatorBefore = await ssvNetwork.getOperator(1);

      // Add validator with 32 ETH (10_000 vUnits)
      await ssvNetwork.registerValidator(/* params */);

      const operatorAfter = await ssvNetwork.getOperator(1);
      expect(operatorAfter.ethValidatorCount).to.equal(
        operatorBefore.ethValidatorCount + 1
      ); // +1 because 10_000 vUnits / 10_000 = 1
    });

    it('should handle fractional validator count correctly', async () => {
      // Add validator with 64 ETH (20_000 vUnits)
      await ssvNetwork.registerValidator(/* with 64 ETH EB */);

      const operator = await ssvNetwork.getOperator(1);
      // ethValidatorCount should increment by 2 (20_000 / 10_000 = 2)
      expect(operator.ethValidatorCount).to.equal(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimum EB (32 ETH)', async () => {
      const vUnits = await contract.ebToVUnits(ethers.parseEther('32'));
      expect(vUnits).to.equal(10_000);

      const fee = await contract.calculateFee(1_000_000_000n, vUnits, 100);
      expect(fee).to.equal(100_000_000_000n); // 100 gwei
    });

    it('should handle maximum EB (2048 ETH)', async () => {
      const vUnits = await contract.ebToVUnits(ethers.parseEther('2048'));
      expect(vUnits).to.equal(640_000);

      const fee = await contract.calculateFee(1_000_000_000n, vUnits, 100);
      expect(fee).to.equal(6_400_000_000_000n); // 6400 gwei
    });

    it('should revert on EB below minimum', async () => {
      await expect(
        contract.ebToVUnits(ethers.parseEther('31.9'))
      ).to.be.revertedWithCustomError(contract, 'EBBelowMinimum');
    });

    it('should revert on EB above maximum', async () => {
      await expect(
        contract.ebToVUnits(ethers.parseEther('2048.1'))
      ).to.be.revertedWithCustomError(contract, 'EBAboveMaximum');
    });

    it('should handle zero vUnits (empty cluster)', async () => {
      const fee = await contract.calculateFee(1_000_000_000n, 0, 100);
      expect(fee).to.equal(0);
    });
  });
});
```

### Invariant Testing

```typescript
describe('vUnits Invariants', () => {
  it('should maintain: totalVUnits = sum of validator vUnits', async () => {
    // Add multiple validators with different EBs
    await ssvNetwork.registerValidator(/* 32 ETH */);  // +10_000 vUnits
    await ssvNetwork.registerValidator(/* 64 ETH */);  // +20_000 vUnits
    await ssvNetwork.registerValidator(/* 33 ETH */);  // +10_313 vUnits

    const cluster = await ssvNetwork.getCluster(clusterID);

    // Total vUnits should be sum
    expect(cluster.ebSnapshot.vUnits).to.equal(40_313);
  });

  it('should maintain: fee proportional to vUnits', async () => {
    const feePerVUnit = 1_000_000_000n;
    const blocks = 100n;

    // Validator A: 32 ETH (10_000 vUnits)
    const feeA = await contract.calculateFee(feePerVUnit, 10_000, blocks);

    // Validator B: 64 ETH (20_000 vUnits)
    const feeB = await contract.calculateFee(feePerVUnit, 20_000, blocks);

    // Fee should scale linearly with vUnits
    expect(feeB).to.equal(feeA * 2n);
  });

  it('should maintain: operator.ethValidatorCount >= actual validator count', async () => {
    // If validators have >32 ETH, ethValidatorCount will be higher
    const operator = await ssvNetwork.getOperator(1);

    // Count validators using this operator
    const actualValidatorCount = await countValidatorsForOperator(1);

    // ethValidatorCount should be >= actual count
    expect(operator.ethValidatorCount).to.be.gte(actualValidatorCount);
  });
});
```

## Integration with Oracle Updates

When the oracle calls `updateClusterBalance`:

```solidity
function updateClusterBalance(
    address owner,
    uint64[] calldata operatorIds,
    Cluster calldata cluster,
    bytes32[] calldata proof,
    uint256 effectiveBalance  // Total EB for all validators in cluster
) external onlyOracle {
    // 1. Verify merkle proof
    bytes32 leaf = keccak256(keccak256(abi.encode(clusterID, effectiveBalance)));
    require(MerkleProof.verify(proof, sp().ebRoot, leaf), "Invalid proof");

    // 2. Convert EB to vUnits (with ceiling division)
    uint256 newVUnits = (effectiveBalance * VUNITS_PRECISION + DEFAULT_EB_PER_VALIDATOR - 1)
                        / DEFAULT_EB_PER_VALIDATOR;

    // 3. Validate bounds
    uint256 minVUnits = cluster.validatorCount * VUNITS_PRECISION;
    uint256 maxVUnits = cluster.validatorCount * (MAX_EB_PER_VALIDATOR * VUNITS_PRECISION / DEFAULT_EB_PER_VALIDATOR);
    require(newVUnits >= minVUnits && newVUnits <= maxVUnits, "vUnits out of range");

    // 4. Store in cluster
    Cluster storage clusterStorage = s().ethClusters[clusterHash];
    clusterStorage.ebSnapshot.vUnits = newVUnits;
    clusterStorage.ebSnapshot.blockNumber = block.number;

    // 5. Update fees using new vUnits
    _updateClusterFees(clusterStorage, operatorIds, newVUnits);
}
```

## Summary

### Quick Reference

| Operation | Formula | Division Type |
|---|---|---|
| EB → vUnits | `(EB * 10_000 + 31) / 32` | Ceiling |
| vUnits → EB | `(vUnits * 32) / 10_000` | Floor |
| Fee calculation | `(feePerVUnit * vUnits) / 10_000` | Floor |
| vUnits bounds | `[validatorCount * 10_000, validatorCount * 640_000]` | — |

### Rules to Remember

1. ✅ **Always use ceiling division** for EB → vUnits
2. ✅ **Always divide by VUNITS_PRECISION** after multiplying by vUnits
3. ✅ **Check for ebSnapshot.vUnits == 0** to determine implicit vs explicit mode
4. ✅ **Validate vUnits bounds** (min: 32 ETH/val, max: 2048 ETH/val)
5. ✅ **Test with non-standard EB values** (33 ETH, 64 ETH, 2048 ETH)
6. ✅ **Verify fee linearity** (2x vUnits = 2x fees)

### When Debugging vUnits Issues

- **Fees too high?** → Check if using vUnits without dividing by precision
- **Fees too low?** → Check if using floor instead of ceiling division
- **Fees not scaling?** → Check if using implicit vUnits when explicit available
- **Unexpected reverts?** → Check vUnits bounds validation

**vUnits are the heart of SSV v2.0.0 fee model. Get them right, and everything else follows.**
