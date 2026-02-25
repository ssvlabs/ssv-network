# Test Patterns Library for SSV Network

## Overview

This library provides battle-tested patterns for writing comprehensive tests for SSV Network smart contracts. Each pattern is production-ready and follows SSV conventions.

## Table of Contents

1. [Core Test Structure Patterns](#core-test-structure-patterns)
2. [Cluster Lifecycle Patterns](#cluster-lifecycle-patterns)
3. [Operator Management Patterns](#operator-management-patterns)
4. [Staking Patterns](#staking-patterns)
5. [Oracle & EB Update Patterns](#oracle--eb-update-patterns)
6. [Liquidation Patterns](#liquidation-patterns)
7. [Fee Calculation Patterns](#fee-calculation-patterns)
8. [Event Testing Patterns](#event-testing-patterns)
9. [Revert Testing Patterns](#revert-testing-patterns)
10. [Invariant Testing Patterns](#invariant-testing-patterns)

---

## Core Test Structure Patterns

### Pattern 1: Basic Test File Structure

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  ssvNetwork,
  registerOperators,
  DEFAULT_OPERATOR_IDS
} from '../../helpers/contract-helpers';

describe('[Module]: [Function]', () => {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [owner, operator1, operator2, operator3, operator4, user1] = signers;

    const network = await ssvNetwork();
    await registerOperators(4, network);

    return {
      network,
      owner,
      operator1,
      operator2,
      operator3,
      operator4,
      user1,
      signers
    };
  }

  describe('Happy Path', () => {
    it('should [expected behavior]', async () => {
      const { network, owner } = await loadFixture(deployFixture);

      // Arrange
      // ...

      // Act
      // ...

      // Assert
      // ...
    });
  });

  describe('Revert Cases', () => {
    // ...
  });

  describe('Edge Cases', () => {
    // ...
  });
});
```

### Pattern 2: Arrange-Act-Assert

```typescript
it('should update cluster balance correctly', async () => {
  const { network, owner } = await loadFixture(deployFixture);

  // ========== ARRANGE ==========
  // Set up initial state
  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  const depositAmount = ethers.parseEther('10');

  await network.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: depositAmount }
  );

  // Snapshot initial state
  const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

  // ========== ACT ==========
  // Execute the operation under test
  await network.deposit(owner.address, DEFAULT_OPERATOR_IDS, depositAmount, {
    value: depositAmount
  });

  // ========== ASSERT ==========
  // Verify expected state changes
  const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

  expect(clusterAfter.balance).to.equal(
    clusterBefore.balance + depositAmount
  );
  expect(clusterAfter.validatorCount).to.equal(clusterBefore.validatorCount);
});
```

### Pattern 3: Fixture with Pre-Registered Validator

```typescript
async function deployWithValidatorFixture() {
  const signers = await ethers.getSigners();
  const [owner, ...operators] = signers;

  const network = await ssvNetwork();
  await registerOperators(4, network);

  // Pre-register a validator
  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  await network.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: ethers.parseEther('10') }
  );

  const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

  return {
    network,
    owner,
    operators,
    publicKey,
    cluster,
    signers
  };
}

// Usage
it('should remove validator from cluster', async () => {
  const { network, owner, publicKey, cluster } = await loadFixture(
    deployWithValidatorFixture
  );

  await network.removeValidator(publicKey, DEFAULT_OPERATOR_IDS, cluster);

  const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
  expect(clusterAfter.validatorCount).to.equal(0);
});
```

---

## Cluster Lifecycle Patterns

### Pattern 4: Complete Validator Lifecycle

```typescript
describe('Complete Validator Lifecycle', () => {
  it('should handle: register → deposit → update → withdraw → remove', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    // ========== STEP 1: Register validator ==========
    const publicKey = ethers.hexlify(ethers.randomBytes(48));
    const initialDeposit = ethers.parseEther('5');

    await expect(
      network.registerValidator(
        publicKey,
        DEFAULT_OPERATOR_IDS,
        ethers.randomBytes(256),
        0,
        { value: initialDeposit }
      )
    )
      .to.emit(network, 'ValidatorAdded')
      .withArgs(owner.address, DEFAULT_OPERATOR_IDS, publicKey);

    let cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.validatorCount).to.equal(1);
    expect(cluster.balance).to.equal(initialDeposit);

    // ========== STEP 2: Deposit more funds ==========
    const additionalDeposit = ethers.parseEther('5');

    await network.deposit(owner.address, DEFAULT_OPERATOR_IDS, additionalDeposit, {
      value: additionalDeposit
    });

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.be.closeTo(
      initialDeposit + additionalDeposit,
      ethers.parseEther('0.01') // Allow small fee deduction
    );

    // ========== STEP 3: Mine blocks (accrue fees) ==========
    await ethers.provider.send('hardhat_mine', ['0x64']); // 100 blocks

    // ========== STEP 4: Update cluster (settle fees) ==========
    const balanceBeforeUpdate = cluster.balance;

    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.be.lt(balanceBeforeUpdate); // Fees deducted

    // ========== STEP 5: Withdraw remaining balance ==========
    const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
    const withdrawAmount = cluster.balance;

    const tx = await network.withdraw(owner.address, DEFAULT_OPERATOR_IDS);
    const receipt = await tx.wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

    const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

    expect(ownerBalanceAfter).to.be.closeTo(
      ownerBalanceBefore + withdrawAmount - gasUsed,
      ethers.parseEther('0.0001')
    );

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.equal(0);

    // ========== STEP 6: Remove validator ==========
    await network.removeValidator(publicKey, DEFAULT_OPERATOR_IDS, cluster);

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.validatorCount).to.equal(0);
  });
});
```

### Pattern 5: Bulk Validator Registration

```typescript
it('should register multiple validators in single transaction', async () => {
  const { network, owner } = await loadFixture(deployFixture);

  const validatorCount = 5;
  const publicKeys: string[] = [];
  const sharesData: string[] = [];

  for (let i = 0; i < validatorCount; i++) {
    publicKeys.push(ethers.hexlify(ethers.randomBytes(48)));
    sharesData.push(ethers.hexlify(ethers.randomBytes(256)));
  }

  const depositPerValidator = ethers.parseEther('2');
  const totalDeposit = depositPerValidator * BigInt(validatorCount);

  await network.bulkRegisterValidator(
    publicKeys,
    DEFAULT_OPERATOR_IDS,
    sharesData,
    totalDeposit,
    { value: totalDeposit }
  );

  const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
  expect(cluster.validatorCount).to.equal(validatorCount);
  expect(cluster.balance).to.equal(totalDeposit);
});
```

---

## Operator Management Patterns

### Pattern 6: Operator Fee Declaration and Execution

```typescript
describe('Operator Fee Change Flow', () => {
  it('should handle: declare → wait → execute fee', async () => {
    const { network, operator1 } = await loadFixture(deployFixture);

    const operatorId = 1;
    const oldFee = ethers.parseEther('0.001');
    const newFee = ethers.parseEther('0.002');

    // ========== STEP 1: Declare fee change ==========
    await network.connect(operator1).declareOperatorFee(operatorId, newFee);

    let operator = await network.getOperator(operatorId);
    expect(operator.ethFee).to.equal(oldFee); // Not changed yet

    // Fee change stored in pending state
    const pendingFee = await network.getOperatorPendingFee(operatorId);
    expect(pendingFee).to.equal(newFee);

    // ========== STEP 2: Wait for approval period ==========
    const declareFeePeriod = await network.getDeclareFeePeriod();
    await ethers.provider.send('hardhat_mine', [
      ethers.toQuantity(declareFeePeriod + 1n)
    ]);

    // ========== STEP 3: Execute fee change ==========
    await network.connect(operator1).executeOperatorFee(operatorId);

    operator = await network.getOperator(operatorId);
    expect(operator.ethFee).to.equal(newFee); // Now changed
  });

  it('should revert if executed before approval period', async () => {
    const { network, operator1 } = await loadFixture(deployFixture);

    await network.connect(operator1).declareOperatorFee(1, ethers.parseEther('0.002'));

    // Try to execute immediately
    await expect(
      network.connect(operator1).executeOperatorFee(1)
    ).to.be.revertedWithCustomError(network, 'ApprovalNotWithinTimeframe');
  });
});
```

### Pattern 7: Operator Earnings Withdrawal

```typescript
it('should accumulate and withdraw operator earnings', async () => {
  const { network, owner, operator1 } = await loadFixture(deployFixture);

  // Register validator (generates fees for operators)
  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  await network.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: ethers.parseEther('10') }
  );

  // Mine blocks to accrue fees
  await ethers.provider.send('hardhat_mine', ['0x2710']); // 10000 blocks

  // Update cluster to settle fees
  await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);

  // Check operator earned fees
  const operator = await network.getOperator(1);
  expect(operator.ethEarnings).to.be.gt(0);

  // Withdraw earnings
  const operatorBalanceBefore = await ethers.provider.getBalance(operator1.address);
  const earnings = operator.ethEarnings;

  const tx = await network.connect(operator1).withdrawOperatorEarnings(1);
  const receipt = await tx.wait();
  const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

  const operatorBalanceAfter = await ethers.provider.getBalance(operator1.address);

  expect(operatorBalanceAfter).to.be.closeTo(
    operatorBalanceBefore + earnings - gasUsed,
    ethers.parseEther('0.0001')
  );

  // Earnings reset to zero
  const operatorAfter = await network.getOperator(1);
  expect(operatorAfter.ethEarnings).to.equal(0);
});
```

---

## Staking Patterns

### Pattern 8: Stake → Earn → Unstake → Claim Flow

```typescript
describe('Complete Staking Flow', () => {
  it('should handle: stake → earn rewards → unstake → claim', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    const ssvToken = await ethers.getContractAt('SSVToken', await network.getSSVToken());
    const cSSVToken = await ethers.getContractAt('CSSVToken', await network.getCSSVToken());

    // ========== STEP 1: Approve and stake SSV ==========
    const stakeAmount = ethers.parseUnits('1000', 18); // 1000 SSV

    await ssvToken.approve(await network.getAddress(), stakeAmount);
    await network.stake(stakeAmount);

    // Verify cSSV minted
    const cSSVBalance = await cSSVToken.balanceOf(owner.address);
    expect(cSSVBalance).to.equal(stakeAmount);

    // ========== STEP 2: Generate protocol revenue (fees) ==========
    // Register validators to generate ETH fees
    const publicKey = ethers.hexlify(ethers.randomBytes(48));
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('10') }
    );

    // Mine blocks and settle fees
    await ethers.provider.send('hardhat_mine', ['0x2710']); // 10000 blocks
    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);

    // ========== STEP 3: Check pending rewards ==========
    const pendingRewards = await network.pendingEthRewards(owner.address);
    expect(pendingRewards).to.be.gt(0);

    // ========== STEP 4: Request unstake ==========
    await network.requestUnstake(stakeAmount);

    // cSSV burned immediately
    expect(await cSSVToken.balanceOf(owner.address)).to.equal(0);

    // SSV locked in unstaking
    const unstakeRequest = await network.getUnstakeRequest(owner.address);
    expect(unstakeRequest.amount).to.equal(stakeAmount);

    // ========== STEP 5: Wait cooldown period ==========
    const cooldownDuration = await network.getUnstakeCooldownDuration();
    await ethers.provider.send('evm_increaseTime', [Number(cooldownDuration)]);
    await ethers.provider.send('evm_mine', []);

    // ========== STEP 6: Claim SSV + ETH rewards ==========
    const ownerSSVBefore = await ssvToken.balanceOf(owner.address);
    const ownerETHBefore = await ethers.provider.getBalance(owner.address);

    const tx = await network.claimUnstake();
    const receipt = await tx.wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

    const ownerSSVAfter = await ssvToken.balanceOf(owner.address);
    const ownerETHAfter = await ethers.provider.getBalance(owner.address);

    // SSV returned
    expect(ownerSSVAfter).to.equal(ownerSSVBefore + stakeAmount);

    // ETH rewards received
    expect(ownerETHAfter).to.be.closeTo(
      ownerETHBefore + pendingRewards - gasUsed,
      ethers.parseEther('0.0001')
    );
  });
});
```

### Pattern 9: Reward Accumulator Testing

```typescript
it('should calculate rewards correctly with accumulator', async () => {
  const { network, owner, user1 } = await loadFixture(deployFixture);

  const ssvToken = await ethers.getContractAt('SSVToken', await network.getSSVToken());

  // Owner stakes 1000 SSV
  const ownerStake = ethers.parseUnits('1000', 18);
  await ssvToken.approve(await network.getAddress(), ownerStake);
  await network.stake(ownerStake);

  // Generate 10 ETH revenue
  await generateProtocolRevenue(network, ethers.parseEther('10'));

  // User1 stakes 1000 SSV (after revenue)
  await ssvToken.transfer(user1.address, ownerStake);
  await ssvToken.connect(user1).approve(await network.getAddress(), ownerStake);
  await network.connect(user1).stake(ownerStake);

  // Generate another 10 ETH revenue
  await generateProtocolRevenue(network, ethers.parseEther('10'));

  // Owner should have: 10 ETH (before user1) + 5 ETH (after user1, 50% share)
  const ownerRewards = await network.pendingEthRewards(owner.address);
  expect(ownerRewards).to.be.closeTo(
    ethers.parseEther('15'),
    ethers.parseEther('0.01')
  );

  // User1 should have: 5 ETH (after staking, 50% share)
  const user1Rewards = await network.pendingEthRewards(user1.address);
  expect(user1Rewards).to.be.closeTo(
    ethers.parseEther('5'),
    ethers.parseEther('0.01')
  );
});
```

---

## Oracle & EB Update Patterns

### Pattern 10: Oracle EB Update with Merkle Proof

```typescript
it('should update cluster EB with valid merkle proof', async () => {
  const { network, owner, oracle } = await loadFixture(deployFixture);

  // Register validator
  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  await network.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: ethers.parseEther('10') }
  );

  // Generate merkle proof for EB update
  const newEB = ethers.parseEther('64'); // 64 ETH
  const clusterID = await network.getClusterID(owner.address, DEFAULT_OPERATOR_IDS);

  const { root, proof } = generateMerkleProof(clusterID, newEB);

  // Oracle commits root
  await network.connect(oracle).commitRoot(root, 1000);

  // Oracle updates cluster EB
  const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

  await expect(
    network.connect(oracle).updateClusterBalance(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      clusterBefore,
      proof,
      newEB
    )
  )
    .to.emit(network, 'ClusterBalanceUpdated')
    .withArgs(owner.address, DEFAULT_OPERATOR_IDS, anyValue, anyValue);

  const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

  // vUnits updated correctly (ceiling division)
  const expectedVUnits = (newEB * 10_000n + ethers.parseEther('32') - 1n) /
                         ethers.parseEther('32');
  expect(clusterAfter.ebSnapshot.vUnits).to.equal(expectedVUnits);
});

// Helper function
function generateMerkleProof(clusterID: string, eb: bigint) {
  const leaf = ethers.keccak256(
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256'],
        [clusterID, eb]
      )
    )
  );

  // For testing: single-leaf tree
  return { root: leaf, proof: [] };
}
```

---

## Liquidation Patterns

### Pattern 11: Liquidation and Reactivation Flow

```typescript
describe('Liquidation Flow', () => {
  it('should liquidate underfunded cluster and allow reactivation', async () => {
    const { network, owner, liquidator } = await loadFixture(deployFixture);

    // ========== STEP 1: Create cluster with minimal balance ==========
    const publicKey = ethers.hexlify(ethers.randomBytes(48));
    const minimalDeposit = ethers.parseEther('0.001');

    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: minimalDeposit }
    );

    // ========== STEP 2: Mine blocks until liquidatable ==========
    await ethers.provider.send('hardhat_mine', ['0x2710']); // 10000 blocks

    // ========== STEP 3: Verify cluster is liquidatable ==========
    const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    const isLiquidatable = await network.isLiquidatable(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster
    );
    expect(isLiquidatable).to.be.true;

    // ========== STEP 4: Liquidate cluster ==========
    const liquidatorBalanceBefore = await ethers.provider.getBalance(liquidator.address);

    await expect(
      network.connect(liquidator).liquidate(
        owner.address,
        DEFAULT_OPERATOR_IDS,
        cluster
      )
    )
      .to.emit(network, 'ClusterLiquidated')
      .withArgs(owner.address, DEFAULT_OPERATOR_IDS);

    const clusterAfterLiquidation = await network.getCluster(
      owner.address,
      DEFAULT_OPERATOR_IDS
    );

    expect(clusterAfterLiquidation.active).to.be.false;
    expect(clusterAfterLiquidation.balance).to.equal(0);

    // Liquidator receives remaining balance
    const liquidatorBalanceAfter = await ethers.provider.getBalance(liquidator.address);
    expect(liquidatorBalanceAfter).to.be.gt(liquidatorBalanceBefore);

    // ========== STEP 5: Reactivate cluster ==========
    const reactivationAmount = ethers.parseEther('5');

    await expect(
      network.reactivate(
        owner.address,
        DEFAULT_OPERATOR_IDS,
        reactivationAmount,
        { value: reactivationAmount }
      )
    )
      .to.emit(network, 'ClusterReactivated')
      .withArgs(owner.address, DEFAULT_OPERATOR_IDS);

    const clusterAfterReactivation = await network.getCluster(
      owner.address,
      DEFAULT_OPERATOR_IDS
    );

    expect(clusterAfterReactivation.active).to.be.true;
    expect(clusterAfterReactivation.balance).to.equal(reactivationAmount);
  });
});
```

---

## Fee Calculation Patterns

### Pattern 12: Verify Fee Calculation Matches SPEC

```typescript
it('should calculate fees according to SPEC.md formula', async () => {
  const { network, owner } = await loadFixture(deployFixture);

  // Setup: Register validator with known fee
  const operatorFee = ethers.parseEther('0.001'); // 1 finney per vUnit per block
  const networkFee = await network.getNetworkFee();

  await network.declareOperatorFee(1, operatorFee);
  // ... execute fee after approval period ...

  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  await network.registerValidator(
    publicKey,
    DEFAULT_OPERATOR_IDS,
    ethers.randomBytes(256),
    0,
    { value: ethers.parseEther('10') }
  );

  const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
  const blocksBefore = await ethers.provider.getBlockNumber();

  // Mine exactly 100 blocks
  await ethers.provider.send('hardhat_mine', ['0x64']);

  await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);

  const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
  const blocksAfter = await ethers.provider.getBlockNumber();

  const blockDiff = BigInt(blocksAfter - blocksBefore);

  // Calculate expected fee using SPEC.md formula
  const vUnits = 10_000n; // 32 ETH validator
  const operatorFeePerBlock = operatorFee * vUnits / 10_000n;
  const networkFeePerBlock = networkFee * vUnits / 10_000n;
  const totalFeePerBlock = operatorFeePerBlock + networkFeePerBlock;
  const expectedFee = totalFeePerBlock * blockDiff * 4n; // 4 operators

  const actualFee = clusterBefore.balance - clusterAfter.balance;

  expect(actualFee).to.be.closeTo(expectedFee, ethers.parseEther('0.001'));
});
```

---

## Event Testing Patterns

### Pattern 13: Exact Event Parameter Matching

```typescript
it('should emit ValidatorAdded event with correct parameters', async () => {
  const { network, owner } = await loadFixture(deployFixture);

  const publicKey = ethers.hexlify(ethers.randomBytes(48));
  const sharesData = ethers.hexlify(ethers.randomBytes(256));
  const cluster = { /* cluster struct */ };

  await expect(
    network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      sharesData,
      0,
      { value: ethers.parseEther('1') }
    )
  )
    .to.emit(network, 'ValidatorAdded')
    .withArgs(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      publicKey,
      sharesData,
      cluster
    );
});
```

---

## Revert Testing Patterns

### Pattern 14: Comprehensive Revert Testing

```typescript
describe('Revert Cases', () => {
  it('should revert with specific error for each condition', async () => {
    const { network, owner, user1 } = await loadFixture(deployFixture);

    // Test 1: Insufficient ETH
    await expect(
      network.deposit(owner.address, DEFAULT_OPERATOR_IDS, ethers.parseEther('1'), {
        value: ethers.parseEther('0.5') // Less than amount
      })
    ).to.be.revertedWithCustomError(network, 'InsufficientBalance');

    // Test 2: Unauthorized caller
    await expect(
      network.connect(user1).withdrawOperatorEarnings(1)
    ).to.be.revertedWithCustomError(network, 'CallerNotOperatorOwner');

    // Test 3: Invalid operator IDs
    await expect(
      network.registerValidator(
        ethers.hexlify(ethers.randomBytes(48)),
        [],
        ethers.randomBytes(256),
        0,
        { value: ethers.parseEther('1') }
      )
    ).to.be.revertedWithCustomError(network, 'InvalidOperatorIdsLength');

    // Test 4: Cluster not active
    // ... liquidate cluster first ...
    await expect(
      network.deposit(owner.address, DEFAULT_OPERATOR_IDS, ethers.parseEther('1'), {
        value: ethers.parseEther('1')
      })
    ).to.be.revertedWithCustomError(network, 'ClusterNotActive');
  });
});
```

---

## Invariant Testing Patterns

### Pattern 15: Balance Conservation Invariant

```typescript
describe('Invariants', () => {
  it('should conserve total ETH across all operations', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    // Helper: Calculate total ETH in protocol
    async function getTotalETH() {
      const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

      let totalOperatorEarnings = 0n;
      for (const opId of DEFAULT_OPERATOR_IDS) {
        const operator = await network.getOperator(opId);
        totalOperatorEarnings += operator.ethEarnings;
      }

      const daoBalance = await network.getDAOBalance();

      return cluster.balance + totalOperatorEarnings + daoBalance;
    }

    // Register validator
    const depositAmount = ethers.parseEther('10');
    await network.registerValidator(
      ethers.hexlify(ethers.randomBytes(48)),
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: depositAmount }
    );

    const totalBefore = await getTotalETH();
    expect(totalBefore).to.equal(depositAmount);

    // Perform various operations
    await ethers.provider.send('hardhat_mine', ['0x64']);
    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);
    await network.deposit(owner.address, DEFAULT_OPERATOR_IDS, ethers.parseEther('5'), {
      value: ethers.parseEther('5')
    });

    const totalAfter = await getTotalETH();

    // Total ETH conserved (minus withdrawals)
    expect(totalAfter).to.equal(depositAmount + ethers.parseEther('5'));
  });
});
```

## Summary

This pattern library provides production-ready test templates for SSV Network. Use these patterns as starting points and adapt them to your specific test cases.

**Key principles:**
- Always use `loadFixture` for performance
- Follow Arrange-Act-Assert structure
- Test happy path, revert cases, and edge cases
- Verify events with exact parameters
- Check balance invariants
- Use descriptive test names

For more patterns, see:
- `integration-patterns.md` - Multi-module flows
- `invariant-testing.md` - Property-based testing
- `gas-testing.md` - Gas benchmarking
