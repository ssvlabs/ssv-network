# SSV Storage Patterns

## Critical Rules

**NEVER** violate these storage rules - they WILL break the protocol on mainnet:

1. ❌ **NEVER** add storage variables directly to module contracts
2. ❌ **NEVER** reorder fields in existing storage structs
3. ❌ **NEVER** remove fields from storage structs
4. ❌ **NEVER** change types of existing storage fields
5. ✅ **ALWAYS** use diamond storage pattern for new state
6. ✅ **ALWAYS** append new fields to END of structs

## Diamond Storage Pattern

SSV Network uses the EIP-2535 Diamond storage pattern. All state lives in deterministic storage slots computed via `keccak256(slot_name) - 1`.

### How It Works

```solidity
// Storage slot computation (done once in storage library)
bytes32 constant SSV_STORAGE_SLOT =
    0x[result of keccak256(abi.encode("ssv.network.storage.main")) - 1];

// Access pattern (in module contracts)
function s() private pure returns (SSVStorage storage $) {
    assembly {
        $.slot := SSV_STORAGE_SLOT
    }
}

// Usage
s().operators[operatorId].fee = newFee;
s().clusters[clusterHash].balance += amount;
```

### Available Storage Structs

| Storage | Slot Key | Purpose |
|---------|----------|---------|
| `SSVStorage` | `ssv.network.storage.main` | Operators, clusters, validators, module addresses |
| `SSVStorageProtocol` | `ssv.network.storage.protocol` | Fee indices, DAO balances, liquidation params |
| `SSVStorageEB` | `ssv.network.storage.eb` | Merkle roots, EB snapshots, oracle voting |
| `SSVStorageStaking` | `ssv.network.storage.staking` | Staking state, rewards accumulator, cSSV |
| `SSVStorageReentrancy` | `ssv.network.storage.reentrancy` | Custom reentrancy guard status |

### Example: Adding New State

**Scenario**: You need to track a new feature flag for operators.

```solidity
// ❌ WRONG - Adding storage to module
contract SSVOperators {
    mapping(uint64 => bool) public operatorFeatureFlag; // DON'T DO THIS!
}

// ✅ CORRECT - Add to diamond storage
// 1. Modify contracts/libraries/storage/SSVStorage.sol
struct Operator {
    uint64 snapshot;              // Existing
    uint64 fee;                   // Existing
    uint32 validatorCount;        // Existing
    address owner;                // Existing
    bool whitelisted;             // Existing
    // ... other existing fields ...
    bool featureFlag;             // ✅ NEW FIELD APPENDED AT END
}

// 2. Use in module contract
function enableOperatorFeature(uint64 operatorId) external {
    Operator storage operator = s().operators[operatorId];
    operator.checkOwner(); // Existing helper
    operator.featureFlag = true; // New field accessible
}
```

## Storage Struct Append-Only Rule

When modifying storage structs, you can ONLY append fields at the end.

### ✅ CORRECT Examples

```solidity
// BEFORE
struct Operator {
    uint64 snapshot;
    uint64 fee;
    uint32 validatorCount;
}

// AFTER - Field appended
struct Operator {
    uint64 snapshot;
    uint64 fee;
    uint32 validatorCount;
    uint64 ethSnapshot;        // ✅ NEW - Appended at end
}
```

### ❌ WRONG Examples

```solidity
// ❌ WRONG - Field inserted at beginning
struct Operator {
    uint64 ethSnapshot;        // ❌ DON'T INSERT HERE
    uint64 snapshot;
    uint64 fee;
    uint32 validatorCount;
}

// ❌ WRONG - Field inserted in middle
struct Operator {
    uint64 snapshot;
    uint64 ethSnapshot;        // ❌ DON'T INSERT HERE
    uint64 fee;
    uint32 validatorCount;
}

// ❌ WRONG - Field removed
struct Operator {
    uint64 snapshot;
    // uint64 fee;            // ❌ DON'T REMOVE FIELDS
    uint32 validatorCount;
}

// ❌ WRONG - Field type changed
struct Operator {
    uint64 snapshot;
    uint128 fee;              // ❌ WAS uint64, DON'T CHANGE TYPE
    uint32 validatorCount;
}

// ❌ WRONG - Fields reordered
struct Operator {
    uint32 validatorCount;    // ❌ DON'T REORDER
    uint64 fee;
    uint64 snapshot;
}
```

## Why This Matters

### Storage Layout Collision

Solidity packs storage sequentially. If you reorder/insert fields:

```solidity
// Original on mainnet
struct Operator {
    uint64 snapshot;      // slot 0, bytes 0-7
    uint64 fee;           // slot 0, bytes 8-15
    uint32 validatorCount;// slot 0, bytes 16-19
}

// After bad change (insert at beginning)
struct Operator {
    uint64 newField;      // slot 0, bytes 0-7 (now reads old snapshot!)
    uint64 snapshot;      // slot 0, bytes 8-15 (now reads old fee!)
    uint64 fee;           // slot 0, bytes 16-23 (now reads old validatorCount + padding!)
    uint32 validatorCount;// slot 1, bytes 0-3 (now reads garbage!)
}

// Result: ALL existing operator data is corrupted!
```

## Verification Tools

### Before Committing Storage Changes

```bash
# Generate storage layout
forge inspect SSVNetwork storageLayout > layout-new.json

# Compare with previous (if you have it)
diff layout-old.json layout-new.json

# Look for:
# - Slot number changes for existing fields (BAD)
# - New fields at different slot than expected (BAD)
# - New fields appended with higher slot (GOOD)
```

### Manual Verification Checklist

- [ ] Only modified storage struct files in `contracts/libraries/storage/`
- [ ] New fields only added at END of structs
- [ ] No fields removed or reordered
- [ ] No type changes to existing fields
- [ ] No new storage variables in module contracts
- [ ] Slot computation unchanged

## Common Mistakes and Fixes

### Mistake 1: Adding State to Module

```solidity
// ❌ WRONG
contract SSVOperators {
    uint256 public newCounter; // This creates storage in module!
}

// ✅ FIX
// 1. Add to SSVStorage struct
struct SSVStorage {
    // ... existing fields ...
    uint256 operatorCounter; // At end
}

// 2. Access via diamond storage
function increment() external {
    s().operatorCounter++;
}
```

### Mistake 2: Inserting Field in Struct

```solidity
// ❌ WRONG
struct Cluster {
    uint32 validatorCount;
    uint64 newIndex;       // ❌ Inserted here
    uint64 networkFeeIndex;
    uint64 index;
}

// ✅ FIX
struct Cluster {
    uint32 validatorCount;
    uint64 networkFeeIndex;
    uint64 index;
    uint64 newIndex;       // ✅ Appended at end
}
```

### Mistake 3: Changing Field Type

```solidity
// ❌ WRONG
struct Operator {
    uint64 snapshot;
    uint128 fee;          // ❌ Was uint64
}

// ✅ FIX - Don't change type, add new field if needed
struct Operator {
    uint64 snapshot;
    uint64 fee;           // ✅ Keep original
    uint128 feeExtended;  // ✅ New field if larger type needed
}
```

## Testing Storage Changes

### Mainnet Fork Test Pattern

```typescript
describe('Storage Upgrade', () => {
  it('should preserve existing operator data', async () => {
    // 1. Fork mainnet at specific block
    await network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: process.env.MAINNET_ETH_NODE_URL,
          blockNumber: 12345678
        }
      }]
    });

    // 2. Read existing operator data
    const operatorBefore = await ssvNetwork.getOperator(1);

    // 3. Upgrade contract
    await upgrades.upgradeProxy(proxyAddress, NewSSVNetwork);

    // 4. Read same operator data
    const operatorAfter = await ssvNetwork.getOperator(1);

    // 5. Verify all fields match
    expect(operatorBefore.snapshot).to.equal(operatorAfter.snapshot);
    expect(operatorBefore.fee).to.equal(operatorAfter.fee);
    expect(operatorBefore.validatorCount).to.equal(operatorAfter.validatorCount);
    // ... all existing fields should match
  });
});
```

## Summary Checklist

When you need to add new state:

1. ✅ Identify which storage struct it belongs to
2. ✅ Add field at END of that struct
3. ✅ Update struct in `contracts/libraries/storage/`
4. ✅ Access via diamond storage pattern: `s().newField`
5. ✅ Never add storage variables to module contracts
6. ✅ Never reorder, remove, or change types of existing fields
7. ✅ Test with mainnet fork to verify no corruption
8. ✅ Verify storage layout with forge inspect

**When in doubt, ask before modifying storage!**
