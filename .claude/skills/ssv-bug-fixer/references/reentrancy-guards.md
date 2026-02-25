# Reentrancy Guards in SSV Network

## Critical Rule

**ALL functions that transfer ETH or tokens MUST use the `nonReentrant` modifier.**

## Why This Matters

Reentrancy attacks allow malicious contracts to call back into your contract before the first call completes, potentially:
- Draining funds through repeated withdrawals
- Corrupting state by re-entering during state updates
- Bypassing access controls
- Breaking invariants

SSV Network deals with significant ETH and SSV token value, making reentrancy protection essential.

## SSV's Custom Reentrancy Guard

SSV uses a **custom** reentrancy guard (not OpenZeppelin's), stored in diamond storage:

```solidity
// contracts/abstract/SSVReentrancyGuard.sol
modifier nonReentrant() {
    SSVStorageReentrancy storage $ = _getSSVStorageReentrancy();
    if ($.locked) revert Reentrancy();
    $.locked = true;
    _;
    $.locked = false;
}

// Storage lives in deterministic slot
function _getSSVStorageReentrancy() private pure returns (SSVStorageReentrancy storage $) {
    assembly {
        $.slot := SSV_REENTRANCY_STORAGE_SLOT
    }
}
```

**Why custom?** Standard OpenZeppelin guard uses inherited storage, which conflicts with diamond pattern.

## Functions That MUST Be Protected

### Category 1: ETH Transfers

Any function with these operations:
```solidity
payable(addr).transfer(amount)
payable(addr).send(amount)
addr.call{value: amount}("")
```

**Currently protected**:
- ✅ `SSVClusters.withdraw()`
- ✅ `SSVClusters.liquidate()`
- ✅ `SSVClusters.updateClusterBalance()`
- ✅ `SSVOperators.withdrawOperatorEarnings()`
- ✅ `SSVOperators.withdrawAllOperatorEarnings()`
- ✅ `SSVDAO.withdrawNetworkEarnings()`
- ✅ `SSVStaking.claimEthRewards()`
- ✅ `SSVStaking.completeUnstake()`

### Category 2: SSV Token Transfers

Any function with:
```solidity
token.transfer(to, amount)
token.transferFrom(from, to, amount)
```

**Currently protected**:
- ✅ `SSVClusters.liquidateSSV()`
- ✅ `SSVDAO.withdrawNetworkSSVEarnings()`

### Category 3: External Calls (Caution)

Functions that make external calls to user-controlled contracts, even without transfers:
```solidity
externalContract.someFunction()
```

**Evaluate case-by-case**: If state changes before the call, add `nonReentrant`.

## Functions That DON'T Need Protection

### Intentionally NOT Protected

These functions are safe because state changes occur AFTER all checks and BEFORE any external calls:

- ✅ `deposit()` - User sends ETH IN (payable), no outbound transfer
- ✅ `reactivate()` - User sends ETH IN, no external calls
- ✅ `registerValidator()` - Pure state changes, no transfers
- ✅ `removeValidator()` - Pure state changes, no transfers
- ✅ `migrateClusterToETH()` - Returns SSV tokens, but uses ERC20 standard (not reentrant)

**Pattern**: If ETH flows IN to contract (payable) but nothing flows OUT, reentrancy risk is low.

## Common Reentrancy Patterns in SSV

### Pattern 1: Withdraw Functions

**Vulnerable code**:
```solidity
function withdraw(uint256 amount) external {
    // ❌ BAD: Transfer before state update
    payable(msg.sender).transfer(amount);
    balance[msg.sender] -= amount; // Attacker can re-enter before this
}
```

**Fixed code**:
```solidity
function withdraw(uint256 amount) external nonReentrant {
    // ✅ GOOD: State update before transfer (checks-effects-interactions)
    balance[msg.sender] -= amount;
    payable(msg.sender).transfer(amount);
}
```

**Even better** (SSV style):
```solidity
function withdraw() external nonReentrant {
    // 1. Checks
    Cluster memory cluster = s().clusters[hash];
    if (cluster.balance == 0) revert InsufficientBalance();

    // 2. Effects
    uint256 amount = cluster.balance;
    cluster.balance = 0;
    s().clusters[hash] = cluster;

    // 3. Interactions
    payable(msg.sender).transfer(amount);

    // 4. Event
    emit ClusterWithdrawn(hash, amount);
}
```

### Pattern 2: Liquidation Functions

Liquidation involves transferring collateral to liquidator:

```solidity
function liquidate(address owner, uint64[] calldata operatorIds)
    external
    nonReentrant  // ✅ REQUIRED
{
    // Complex state updates
    Cluster memory cluster = _liquidateCluster(owner, operatorIds);

    // Transfer liquidation collateral to caller
    payable(msg.sender).transfer(cluster.balance);

    emit ClusterLiquidated(owner, operatorIds);
}
```

**Without `nonReentrant`**: Attacker could liquidate multiple times before state finalizes.

### Pattern 3: Operator Earnings Withdrawal

```solidity
function withdrawOperatorEarnings(uint64 operatorId)
    external
    nonReentrant  // ✅ REQUIRED
{
    Operator storage operator = s().operators[operatorId];
    operator.checkOwner();

    uint256 ethEarnings = operator.ethEarnings;
    uint256 ssvEarnings = operator.ssvEarnings;

    // Clear earnings BEFORE transfer
    operator.ethEarnings = 0;
    operator.ssvEarnings = 0;

    // Now safe to transfer
    if (ethEarnings > 0) {
        payable(operator.owner).transfer(ethEarnings);
    }
    if (ssvEarnings > 0) {
        s().token.transfer(operator.owner, ssvEarnings);
    }
}
```

### Pattern 4: Staking Rewards Claims

```solidity
function claimEthRewards() external nonReentrant {  // ✅ REQUIRED
    SSVStorageStaking storage $ = _getSSVStorageStaking();

    // Calculate pending rewards
    uint256 pending = _pendingRewards(msg.sender);

    // Update user's index BEFORE transfer
    $.userRewardIndex[msg.sender] = $.accEthPerShare;

    // Transfer rewards
    payable(msg.sender).transfer(pending);

    emit EthRewardsClaimed(msg.sender, pending);
}
```

## Checks-Effects-Interactions Pattern

Always follow this order:

### 1. Checks
```solidity
// Validate inputs
require(amount > 0, "Zero amount");
require(balance[msg.sender] >= amount, "Insufficient balance");
require(msg.sender == owner, "Not owner");
```

### 2. Effects
```solidity
// Update state
balance[msg.sender] -= amount;
totalSupply -= amount;
```

### 3. Interactions
```solidity
// External calls LAST
payable(msg.sender).transfer(amount);
token.transfer(msg.sender, amount);
```

### 4. Events (After Interactions)
```solidity
// Events after interactions is fine
emit Withdrawn(msg.sender, amount);
```

## Event Emission After State Changes

Events must always be emitted **after** all state changes and external calls are complete. This is both a CEI correctness requirement and a critical constraint for SSV's oracle infrastructure.

### Why This Matters for SSV

SSV nodes, the SDK, and off-chain indexers rely on events to reconstruct on-chain state. If an event is emitted before state is fully settled, the emitted data will be incorrect, causing oracle desync.

**Oracle-critical events** (breaking these is catastrophic — see `security-checklist.md`):
- `ValidatorAdded` / `ValidatorRemoved`
- `ClusterLiquidated` / `ClusterReactivated`
- `ClusterBalanceUpdated`
- `RootCommitted`
- `ClusterMigratedToETH`

### Correct Ordering

```solidity
// ✅ CORRECT: CEI + event last
function liquidate(address owner, uint64[] calldata operatorIds, Cluster memory cluster)
    external nonReentrant
{
    // 1. Checks
    cluster.validateClusterIsNotLiquidated();
    // ...

    // 2. Effects — all state settled BEFORE event
    cluster.active = false;
    cluster.balance = 0;
    s().clusters[hashedCluster] = cluster.hashClusterData();

    // 3. Interactions
    CoreLib.transferBalance(msg.sender, bounty);

    // 4. Event — emitted with FINAL settled state
    emit ClusterLiquidated(owner, operatorIds, cluster);
}
```

```solidity
// ❌ BUG: Event emitted with intermediate (unsettled) state
function liquidate(address owner, uint64[] calldata operatorIds, Cluster memory cluster)
    external nonReentrant
{
    cluster.active = false;
    emit ClusterLiquidated(owner, operatorIds, cluster); // ❌ balance not yet zeroed!
    cluster.balance = 0;
    s().clusters[hashedCluster] = cluster.hashClusterData();
    CoreLib.transferBalance(msg.sender, bounty);
}
```

### Event Documentation Checklist

When adding or modifying an event:
- [ ] Event is emitted AFTER all state mutations
- [ ] Event is emitted AFTER external calls (interactions)
- [ ] Event parameters reflect the **final** settled state (not intermediate)
- [ ] The event struct parameter (e.g., `cluster`) is the post-mutation value
- [ ] NatSpec documents: purpose, consumers (oracle/SDK/indexer), parameter semantics
- [ ] If modifying an existing event signature: **stop and coordinate with oracle team first**

## Testing for Reentrancy

### Attack Contract Template

```solidity
contract ReentrancyAttacker {
    SSVNetwork public target;
    uint256 public callCount;

    receive() external payable {
        callCount++;
        if (callCount < 3) {
            // Try to re-enter
            target.withdraw();
        }
    }

    function attack() external {
        target.deposit{value: 1 ether}();
        target.withdraw();
    }
}
```

### Test Template

```typescript
describe('Reentrancy Protection', () => {
  it('should prevent reentrancy on withdraw', async () => {
    // Deploy attacker contract
    const Attacker = await ethers.getContractFactory('ReentrancyAttacker');
    const attacker = await Attacker.deploy(ssvNetwork.address);

    // Fund the protocol
    await ssvNetwork.deposit({value: ethers.parseEther('10')});

    // Attempt reentrancy attack
    await expect(
      attacker.attack()
    ).to.be.revertedWithCustomError(ssvNetwork, 'Reentrancy');

    // Verify callCount is 1 (didn't re-enter)
    expect(await attacker.callCount()).to.equal(1);
  });
});
```

## When to Add Reentrancy Guard

### Decision Tree

```
Does function transfer ETH or tokens?
├─ YES → Add nonReentrant
└─ NO
   └─ Does it call external contract?
      ├─ YES → Are there state changes before the call?
      │  ├─ YES → Add nonReentrant
      │  └─ NO → Safe (but consider future changes)
      └─ NO → Safe
```

### Quick Checklist

Add `nonReentrant` if ANY of these:
- [ ] Function uses `.transfer()`, `.send()`, or `.call{value:}`
- [ ] Function calls `token.transfer()` or `token.transferFrom()`
- [ ] Function makes external call to user-provided address
- [ ] Function modifies state before external interaction
- [ ] Function is called during state transition (liquidation, unstaking, etc.)

## Common Mistakes

### Mistake 1: Forgetting Guard on New Function

```solidity
// ❌ WRONG - New withdraw function without guard
function withdrawOperatorSSV(uint64 operatorId) external {
    uint256 earnings = s().operators[operatorId].ssvEarnings;
    s().operators[operatorId].ssvEarnings = 0;
    s().token.transfer(msg.sender, earnings);
}

// ✅ CORRECT - Add nonReentrant
function withdrawOperatorSSV(uint64 operatorId) external nonReentrant {
    uint256 earnings = s().operators[operatorId].ssvEarnings;
    s().operators[operatorId].ssvEarnings = 0;
    s().token.transfer(msg.sender, earnings);
}
```

### Mistake 2: Wrong State Update Order

```solidity
// ❌ WRONG - Transfer before state update (nonReentrant doesn't fix bad order)
function withdraw() external nonReentrant {
    payable(msg.sender).transfer(amount);
    balance[msg.sender] = 0; // Should be before transfer!
}

// ✅ CORRECT - State update before transfer
function withdraw() external nonReentrant {
    balance[msg.sender] = 0;
    payable(msg.sender).transfer(amount);
}
```

### Mistake 3: Read-Only Functions with Guard

```solidity
// ❌ WRONG - Unnecessary guard on view function
function getBalance() external view nonReentrant returns (uint256) {
    return balance[msg.sender];
}

// ✅ CORRECT - No guard needed on pure reads
function getBalance() external view returns (uint256) {
    return balance[msg.sender];
}
```

## Verification Tools

### Grep for Unguarded Transfers

```bash
# Find all ETH transfers
grep -r "payable.*transfer\|payable.*send\|payable.*call" contracts/modules/

# Find all token transfers
grep -r "token.transfer\|token.transferFrom" contracts/modules/

# Check if they have nonReentrant
# (Manual verification needed)
```

### Automated Check (in validate-fix.sh)

```bash
# Find transfers without nonReentrant in same function
for file in contracts/modules/*.sol; do
  # This is simplified - actual script is more robust
  grep -A 20 "function.*external" "$file" | \
  grep -B 20 "transfer\|send\|call{value" | \
  grep -L "nonReentrant" && echo "Warning: $file may need reentrancy guard"
done
```

## Summary

### Quick Rules

1. ✅ **ALWAYS** add `nonReentrant` to functions that transfer ETH or tokens
2. ✅ **ALWAYS** follow checks-effects-interactions pattern
3. ✅ **ALWAYS** update state before external calls
4. ✅ **ALWAYS** test with reentrancy attack scenario
5. ❌ **NEVER** assume ERC20 transfers are safe (some tokens have hooks)
6. ❌ **NEVER** skip guard because "it's unlikely to be exploited"

### If You're Adding/Modifying a Function

Ask yourself:
1. Does it transfer ETH? → Add `nonReentrant`
2. Does it transfer tokens? → Add `nonReentrant`
3. Does it call external contract? → Consider `nonReentrant`
4. Are state changes before interactions? → Verify ordering
5. Is there a test for reentrancy? → Add one

**When in doubt, add the guard. The gas cost (~2000 gas) is negligible compared to a reentrancy exploit.**
