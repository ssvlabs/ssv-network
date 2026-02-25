# Test Examples for SSV Bug Fixes

## Overview

This guide provides complete test examples for common bug fix scenarios in SSV Network. Use these as templates when writing tests for your bug fixes.

## Test Structure

SSV Network tests use:
- **Mocha** for test framework
- **Chai** for assertions
- **ethers v6** for contract interaction
- **Hardhat** for compilation and network management

### Basic Test Template

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  ssvNetwork,
  registerOperators,
  bulkRegisterValidators,
  DEFAULT_OPERATOR_IDS
} from '../../helpers/contract-helpers';

describe('Bug Fix: [Description]', () => {
  let fixture: any;

  beforeEach(async () => {
    fixture = await loadFixture(deployFixture);
  });

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [owner, operator1, operator2, operator3, operator4, cluster1] = signers;

    const network = await ssvNetwork();

    // Register operators
    await registerOperators(4, network);

    return {
      network,
      owner,
      operator1,
      operator2,
      operator3,
      operator4,
      cluster1,
      signers
    };
  }

  it('should [expected behavior after fix]', async () => {
    const { network, cluster1 } = fixture;

    // Arrange: Set up the conditions that trigger the bug
    // ...

    // Act: Execute the operation
    // ...

    // Assert: Verify the fix works
    // ...
  });

  it('should handle edge case that caused the bug', async () => {
    // Test the specific edge case
  });
});
```

## Example 1: Reentrancy Bug Fix

**Bug**: `withdraw()` function missing `nonReentrant` modifier allows reentrancy attack.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Bug Fix: Reentrancy in withdraw', () => {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [owner, attacker] = signers;

    const SSVNetwork = await ethers.getContractFactory('SSVNetwork');
    const network = await SSVNetwork.deploy();

    // Deploy attacker contract
    const ReentrancyAttacker = await ethers.getContractFactory('ReentrancyAttacker');
    const attackerContract = await ReentrancyAttacker.deploy(await network.getAddress());

    return { network, owner, attacker, attackerContract };
  }

  it('should prevent reentrancy attack on withdraw', async () => {
    const { network, attackerContract } = await loadFixture(deployFixture);

    // Arrange: Fund the protocol
    await network.deposit(DEFAULT_OPERATOR_IDS, ethers.parseEther('1'), {
      value: ethers.parseEther('1')
    });

    // Act & Assert: Attempt reentrancy attack should revert
    await expect(
      attackerContract.attack()
    ).to.be.revertedWithCustomError(network, 'Reentrancy');

    // Verify attacker only called once (didn't re-enter)
    expect(await attackerContract.callCount()).to.equal(1);
  });

  it('should allow normal withdraw after fix', async () => {
    const { network, owner } = await loadFixture(deployFixture);

    // Arrange: Deposit funds
    await network.deposit(DEFAULT_OPERATOR_IDS, ethers.parseEther('1'), {
      value: ethers.parseEther('1')
    });

    const balanceBefore = await ethers.provider.getBalance(owner.address);

    // Act: Normal withdraw should work
    const tx = await network.withdraw(DEFAULT_OPERATOR_IDS);
    const receipt = await tx.wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

    // Assert: Funds transferred correctly
    const balanceAfter = await ethers.provider.getBalance(owner.address);
    expect(balanceAfter).to.be.closeTo(
      balanceBefore + ethers.parseEther('1') - gasUsed,
      ethers.parseEther('0.0001') // Small delta for gas estimation variance
    );
  });
});
```

**Attacker Contract for Testing**:

```solidity
// contracts/test/ReentrancyAttacker.sol
contract ReentrancyAttacker {
    SSVNetwork public target;
    uint256 public callCount;

    constructor(address _target) {
        target = SSVNetwork(_target);
    }

    receive() external payable {
        callCount++;
        if (callCount < 3) {
            // Try to re-enter
            target.withdraw(operatorIds);
        }
    }

    function attack() external {
        // Initial call
        target.withdraw(operatorIds);
    }
}
```

## Example 2: Packed Type Precision Bug Fix

**Bug**: Using `DEDUCTED_DIGITS` (SSV constant) instead of `ETH_DEDUCTED_DIGITS` for ETH fees.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Bug Fix: Wrong packed type precision for ETH fees', () => {
  const ETH_DEDUCTED_DIGITS = 100_000n;
  const DEDUCTED_DIGITS = 10_000_000n;

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const network = await ssvNetwork();
    await registerOperators(4, network);

    return { network, signers };
  }

  it('should use correct precision constant for ETH fees', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Set ETH fee to 0.001 ETH (1 finney)
    const feeWei = ethers.parseEther('0.001'); // 1_000_000_000_000_000 wei

    // Act: Declare operator fee
    await network.declareOperatorFee(1, feeWei);

    // Assert: Fee stored correctly with ETH precision
    const operator = await network.getOperator(1);
    const expectedPacked = feeWei / ETH_DEDUCTED_DIGITS; // 10_000_000_000

    expect(operator.ethFee).to.equal(expectedPacked);

    // Verify unpacking gives original value
    const unpackedFee = BigInt(operator.ethFee) * ETH_DEDUCTED_DIGITS;
    expect(unpackedFee).to.equal(feeWei);
  });

  it('should revert on non-divisible ETH fee amounts', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Fee not divisible by ETH_DEDUCTED_DIGITS
    const badFee = 100_001n; // Not divisible by 100_000

    // Act & Assert: Should revert with precision error
    await expect(
      network.declareOperatorFee(1, badFee)
    ).to.be.revertedWithCustomError(network, 'MaxPrecisionExceeded');
  });

  it('should handle maximum packed ETH value', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Max PackedETH = 2^64 - 1
    const maxPacked = 2n ** 64n - 1n;
    const maxWei = maxPacked * ETH_DEDUCTED_DIGITS;

    // Act: Set to max value
    await network.declareOperatorFee(1, maxWei);

    // Assert: Stored correctly
    const operator = await network.getOperator(1);
    expect(operator.ethFee).to.equal(maxPacked);
  });

  it('should revert on overflow beyond uint64', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Value that overflows uint64 after division
    const tooBig = (2n ** 64n) * ETH_DEDUCTED_DIGITS;

    // Act & Assert: Should revert on overflow
    await expect(
      network.declareOperatorFee(1, tooBig)
    ).to.be.reverted;
  });

  it('should not mix SSV and ETH precision constants', async () => {
    const { network } = await loadFixture(deployFixture);

    // This test verifies the bug is fixed
    // Before fix: code used DEDUCTED_DIGITS for ETH (wrong!)
    // After fix: code uses ETH_DEDUCTED_DIGITS for ETH (correct!)

    const feeWei = ethers.parseEther('0.001');
    await network.declareOperatorFee(1, feeWei);

    const operator = await network.getOperator(1);

    // Verify using ETH constant (not SSV constant)
    const correctUnpack = BigInt(operator.ethFee) * ETH_DEDUCTED_DIGITS;
    expect(correctUnpack).to.equal(feeWei);

    // Show what would happen with wrong constant
    const wrongUnpack = BigInt(operator.ethFee) * DEDUCTED_DIGITS;
    expect(wrongUnpack).to.not.equal(feeWei); // Would be 100x wrong!
  });
});
```

## Example 3: Storage Layout Bug Fix

**Bug**: New field inserted in middle of struct instead of appended at end.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { network as hardhatNetwork } from 'hardhat';

describe('Bug Fix: Storage layout corruption', () => {
  async function deployFixture() {
    // Fork mainnet to test against existing state
    await hardhatNetwork.provider.request({
      method: 'hardhat_reset',
      params: [{
        forking: {
          jsonRpcUrl: process.env.MAINNET_ETH_NODE_URL!,
          blockNumber: 12345678 // Block with known state
        }
      }]
    });

    const SSVNetwork = await ethers.getContractFactory('SSVNetwork');
    const network = await SSVNetwork.attach('0x[mainnet address]');

    return { network };
  }

  it('should preserve existing operator data after upgrade', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Read existing operator data from mainnet
    const operatorId = 1;
    const operatorBefore = await network.getOperator(operatorId);

    // Act: Upgrade to new contract version
    const SSVNetworkV2 = await ethers.getContractFactory('SSVNetwork');
    const upgraded = await upgrades.upgradeProxy(
      await network.getAddress(),
      SSVNetworkV2
    );

    // Assert: All fields still match
    const operatorAfter = await upgraded.getOperator(operatorId);

    expect(operatorAfter.snapshot).to.equal(operatorBefore.snapshot);
    expect(operatorAfter.fee).to.equal(operatorBefore.fee);
    expect(operatorAfter.validatorCount).to.equal(operatorBefore.validatorCount);
    expect(operatorAfter.owner).to.equal(operatorBefore.owner);
    expect(operatorAfter.whitelisted).to.equal(operatorBefore.whitelisted);

    // New field should be initialized to default (0 or false)
    expect(operatorAfter.newFieldAtEnd).to.equal(0);
  });

  it('should read/write new field correctly after upgrade', async () => {
    const { network } = await loadFixture(deployFixture);

    // Upgrade
    const SSVNetworkV2 = await ethers.getContractFactory('SSVNetwork');
    const upgraded = await upgrades.upgradeProxy(
      await network.getAddress(),
      SSVNetworkV2
    );

    // Act: Use new field
    await upgraded.setNewField(1, 12345);

    // Assert: New field stored correctly
    const operator = await upgraded.getOperator(1);
    expect(operator.newFieldAtEnd).to.equal(12345);

    // Old fields unchanged
    expect(operator.snapshot).to.equal(operatorBefore.snapshot);
    expect(operator.fee).to.equal(operatorBefore.fee);
  });
});
```

## Example 4: vUnits Calculation Bug Fix

**Bug**: Using floor division instead of ceiling division for EB → vUnits conversion.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('Bug Fix: vUnits ceiling division', () => {
  const VUNITS_PRECISION = 10_000n;
  const DEFAULT_EB = ethers.parseEther('32');

  async function deployFixture() {
    const network = await ssvNetwork();
    await registerOperators(4, network);
    return { network };
  }

  it('should use ceiling division for EB to vUnits conversion', async () => {
    const { network } = await loadFixture(deployFixture);

    // Test case: 32.1 ETH should round UP, not down
    const eb = ethers.parseEther('32.1');

    // Calculate expected vUnits with ceiling division
    // ceiling(32.1 * 10_000 / 32) = ceiling(10_031.25) = 10_032
    const expectedVUnits = (eb * VUNITS_PRECISION + DEFAULT_EB - 1n) / DEFAULT_EB;

    // Register validator and trigger EB update
    const publicKey = ethers.hexlify(ethers.randomBytes(48));
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('1') }
    );

    // Oracle updates EB
    const clusterID = await network.getClusterID(owner.address, DEFAULT_OPERATOR_IDS);
    const merkleProof = await generateMerkleProof(clusterID, eb);

    await network.connect(oracle).updateClusterBalance(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster,
      merkleProof,
      eb
    );

    // Assert: Cluster vUnits matches expected (ceiling)
    const clusterAfter = await network.getCluster(
      owner.address,
      DEFAULT_OPERATOR_IDS
    );

    expect(clusterAfter.ebSnapshot.vUnits).to.equal(expectedVUnits);
    expect(clusterAfter.ebSnapshot.vUnits).to.equal(10_032); // Not 10_031!
  });

  it('should charge correct fees with non-standard EB', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Validator with 33 ETH
    const eb = ethers.parseEther('33');
    const expectedVUnits = (eb * VUNITS_PRECISION + DEFAULT_EB - 1n) / DEFAULT_EB;
    // = (33 * 10_000 + 31) / 32 = 10_313

    await setupClusterWithEB(network, eb);

    const operatorFee = ethers.parseEther('0.001'); // 1 finney per vUnit per block
    await network.declareOperatorFee(1, operatorFee);

    // Act: Mine 100 blocks
    await ethers.provider.send('hardhat_mine', ['0x64']); // 100 blocks

    const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);
    const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

    // Calculate expected fee
    // feePerBlock = 0.001 ETH per vUnit per block
    // blocks = 100
    // vUnits = 10_313
    // fee = (0.001 * 100 * 10_313) / 10_000 = 0.10313 ETH
    const expectedFee = (operatorFee * 100n * expectedVUnits) / VUNITS_PRECISION;

    // Assert: Fee charged correctly
    const actualFee = clusterBefore.balance - clusterAfter.balance;
    expect(actualFee).to.equal(expectedFee);
  });

  it('should handle exact multiples of 32 ETH', async () => {
    const { network } = await loadFixture(deployFixture);

    // 32 ETH should give exactly 10_000 vUnits (no rounding needed)
    const eb32 = ethers.parseEther('32');
    await setupClusterWithEB(network, eb32);
    const cluster32 = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster32.ebSnapshot.vUnits).to.equal(10_000);

    // 64 ETH should give exactly 20_000 vUnits
    const eb64 = ethers.parseEther('64');
    await setupClusterWithEB(network, eb64);
    const cluster64 = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster64.ebSnapshot.vUnits).to.equal(20_000);
  });

  it('should reject EB below minimum (32 ETH)', async () => {
    const { network } = await loadFixture(deployFixture);

    const belowMin = ethers.parseEther('31.9');

    await expect(
      setupClusterWithEB(network, belowMin)
    ).to.be.revertedWithCustomError(network, 'EBBelowMinimum');
  });

  it('should reject EB above maximum (2048 ETH)', async () => {
    const { network } = await loadFixture(deployFixture);

    const aboveMax = ethers.parseEther('2048.1');

    await expect(
      setupClusterWithEB(network, aboveMax)
    ).to.be.revertedWithCustomError(network, 'EBAboveMaximum');
  });
});
```

## Example 5: Fee Index Snapshot Bug Fix

**Bug**: Operator snapshot not updated when fee changed, causing incorrect fee calculations.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Bug Fix: Operator snapshot not updated on fee change', () => {
  async function deployFixture() {
    const network = await ssvNetwork();
    await registerOperators(4, network);
    return { network };
  }

  it('should update operator snapshot when fee is declared', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Current network fee index
    const indexBefore = await network.getNetworkFeeIndex();

    // Act: Declare new operator fee
    const newFee = ethers.parseEther('0.002');
    await network.declareOperatorFee(1, newFee);

    // Assert: Operator snapshot should be updated to current index
    const operator = await network.getOperator(1);
    expect(operator.ethSnapshot).to.equal(indexBefore);
  });

  it('should prevent double-charging fees before and after fee change', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Register cluster with old fee
    const oldFee = ethers.parseEther('0.001');
    await network.declareOperatorFee(1, oldFee);

    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('10') }
    );

    // Mine 100 blocks with old fee
    await ethers.provider.send('hardhat_mine', ['0x64']);

    // Change fee
    const newFee = ethers.parseEther('0.002');
    await network.declareOperatorFee(1, newFee);

    // Mine another 100 blocks with new fee
    await ethers.provider.send('hardhat_mine', ['0x64']);

    // Act: Update cluster
    const clusterBefore = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);
    const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);

    // Calculate expected fee
    // First 100 blocks: oldFee * 100 * vUnits / VUNITS_PRECISION
    // Second 100 blocks: newFee * 100 * vUnits / VUNITS_PRECISION
    const vUnits = 10_000n; // Assuming 32 ETH validator
    const expectedFee =
      (oldFee * 100n * vUnits) / 10_000n +
      (newFee * 100n * vUnits) / 10_000n;

    // Assert: Fee charged correctly (not double-counted)
    const actualFee = clusterBefore.balance - clusterAfter.balance;
    expect(actualFee).to.be.closeTo(expectedFee, ethers.parseEther('0.0001'));
  });
});
```

## Example 6: Cluster Balance Underflow Bug Fix

**Bug**: Cluster balance subtraction can underflow if fees exceed balance, causing revert instead of liquidation.

```typescript
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Bug Fix: Cluster balance underflow on low balance', () => {
  async function deployFixture() {
    const network = await ssvNetwork();
    await registerOperators(4, network);
    return { network };
  }

  it('should handle cluster with insufficient balance gracefully', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Create cluster with minimal balance
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('0.001') } // Very low balance
    );

    // Mine many blocks to accrue large fees
    await ethers.provider.send('hardhat_mine', ['0x2710']); // 10000 blocks

    // Act: Update cluster (fees exceed balance)
    // Before fix: Would revert with underflow
    // After fix: Balance set to 0, cluster becomes liquidatable

    await network.updateCluster(owner.address, DEFAULT_OPERATOR_IDS);

    // Assert: Balance set to 0 (not underflow)
    const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.equal(0);

    // Cluster should be liquidatable now
    const isLiquidatable = await network.isLiquidatable(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster
    );
    expect(isLiquidatable).to.be.true;
  });

  it('should allow liquidation when balance below threshold', async () => {
    const { network } = await loadFixture(deployFixture);

    // Arrange: Create cluster that will become liquidatable
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: ethers.parseEther('0.001') }
    );

    // Mine blocks until liquidatable
    await ethers.provider.send('hardhat_mine', ['0x2710']);

    // Act: Liquidate cluster
    const liquidatorBefore = await ethers.provider.getBalance(liquidator.address);

    const tx = await network.connect(liquidator).liquidate(
      owner.address,
      DEFAULT_OPERATOR_IDS,
      cluster
    );

    // Assert: Liquidation successful
    await expect(tx)
      .to.emit(network, 'ClusterLiquidated')
      .withArgs(owner.address, DEFAULT_OPERATOR_IDS);

    // Liquidator receives remaining balance
    const liquidatorAfter = await ethers.provider.getBalance(liquidator.address);
    expect(liquidatorAfter).to.be.gt(liquidatorBefore);

    // Cluster marked inactive
    const clusterAfter = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(clusterAfter.active).to.be.false;
    expect(clusterAfter.balance).to.equal(0);
  });
});
```

## Helper Functions for Tests

### Common Setup Helpers

```typescript
// test/helpers/contract-helpers.ts

export async function setupClusterWithEB(
  network: any,
  effectiveBalance: bigint
) {
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
  const clusterID = await network.getClusterID(owner.address, DEFAULT_OPERATOR_IDS);
  const { root, proof } = await generateMerkleProof(clusterID, effectiveBalance);

  // Oracle commits root
  await network.connect(oracle).commitRoot(root, block.number);

  // Oracle updates cluster EB
  const cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
  await network.connect(oracle).updateClusterBalance(
    owner.address,
    DEFAULT_OPERATOR_IDS,
    cluster,
    proof,
    effectiveBalance
  );
}

export async function generateMerkleProof(
  clusterID: string,
  effectiveBalance: bigint
) {
  // Generate merkle tree with cluster EB
  const leaf = ethers.keccak256(
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256'],
        [clusterID, effectiveBalance]
      )
    )
  );

  // For testing: single-leaf tree
  const root = leaf;
  const proof: string[] = [];

  return { root, proof, leaf };
}

export async function mineBlocksAndUpdate(
  network: any,
  blocks: number,
  owner: any,
  operatorIds: number[]
) {
  await ethers.provider.send('hardhat_mine', [ethers.toQuantity(blocks)]);
  await network.updateCluster(owner, operatorIds);
}
```

### Assertion Helpers

```typescript
// Custom chai matchers

export function expectCloseTo(
  actual: bigint,
  expected: bigint,
  delta: bigint,
  message?: string
) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff).to.be.lte(delta, message);
}

export async function expectBalance(
  network: any,
  owner: string,
  operatorIds: number[],
  expectedBalance: bigint,
  delta: bigint = ethers.parseEther('0.0001')
) {
  const cluster = await network.getCluster(owner, operatorIds);
  expectCloseTo(cluster.balance, expectedBalance, delta, 'Cluster balance mismatch');
}

export async function expectOperatorEarnings(
  network: any,
  operatorId: number,
  expectedEarnings: bigint,
  delta: bigint = ethers.parseEther('0.0001')
) {
  const operator = await network.getOperator(operatorId);
  expectCloseTo(operator.ethEarnings, expectedEarnings, delta, 'Operator earnings mismatch');
}
```

## Integration Test Example

Complete end-to-end test covering multiple modules:

```typescript
describe('Integration: Register → Update EB → Withdraw', () => {
  it('should handle full lifecycle with EB updates', async () => {
    const { network, owner, oracle } = await loadFixture(deployFixture);

    // Step 1: Register validator with deposit
    const depositAmount = ethers.parseEther('10');
    await network.registerValidator(
      publicKey,
      DEFAULT_OPERATOR_IDS,
      ethers.randomBytes(256),
      0,
      { value: depositAmount }
    );

    let cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.equal(depositAmount);
    expect(cluster.validatorCount).to.equal(1);
    expect(cluster.ebSnapshot.vUnits).to.equal(0); // Implicit mode

    // Step 2: Oracle updates EB (33 ETH - non-standard)
    const eb = ethers.parseEther('33');
    await setupClusterWithEB(network, eb);

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    const expectedVUnits = (eb * 10_000n + ethers.parseEther('32') - 1n) / ethers.parseEther('32');
    expect(cluster.ebSnapshot.vUnits).to.equal(expectedVUnits); // Explicit mode now

    // Step 3: Mine blocks and accrue fees
    await ethers.provider.send('hardhat_mine', ['0x64']); // 100 blocks

    // Step 4: Withdraw remaining balance
    const balanceBeforeWithdraw = cluster.balance;
    await network.withdraw(owner.address, DEFAULT_OPERATOR_IDS);

    cluster = await network.getCluster(owner.address, DEFAULT_OPERATOR_IDS);
    expect(cluster.balance).to.equal(0);

    // Verify owner received ETH
    const ownerBalance = await ethers.provider.getBalance(owner.address);
    // (actual check would need to account for gas)

    // Step 5: Verify operator earnings updated
    for (const opId of DEFAULT_OPERATOR_IDS) {
      const operator = await network.getOperator(opId);
      expect(operator.ethEarnings).to.be.gt(0);
    }

    // Step 6: Operator withdraws earnings
    const op1Before = await ethers.provider.getBalance(operator1.address);
    await network.connect(operator1).withdrawOperatorEarnings(1);
    const op1After = await ethers.provider.getBalance(operator1.address);

    expect(op1After).to.be.gt(op1Before);

    const operatorAfterWithdraw = await network.getOperator(1);
    expect(operatorAfterWithdraw.ethEarnings).to.equal(0);
  });
});
```

## Summary

### Key Testing Patterns

1. **Use fixtures** for common setup (loadFixture for performance)
2. **Test edge cases** explicitly (zero, max, overflow, underflow)
3. **Verify events** with exact parameter matching
4. **Check balance invariants** before and after operations
5. **Test both positive and negative cases** (should work + should revert)
6. **Use helper functions** for common operations
7. **Integration tests** verify cross-module interactions

### Coverage Goals

- **Statements**: ≥ 95%
- **Branches**: ≥ 90%
- **Functions**: ≥ 95%
- **Lines**: ≥ 95%

### Test Organization

```
test/
├── unit/                       # Isolated function tests
│   ├── SSVClusters/
│   ├── SSVOperators/
│   ├── SSVDAO/
│   ├── SSVStaking/
│   └── SSVValidators/
├── integration/                # Multi-module tests
├── sanity/                     # Regression tests
└── helpers/                    # Shared test utilities
```

**Every bug fix MUST include at least one test that:**
- Proves the bug existed (fails before fix)
- Proves the bug is fixed (passes after fix)
- Tests the edge case that caused the bug
