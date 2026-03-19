# Simulation Design: SSV Network v2.0.0 Monte Carlo Upgrade Simulation

Research findings and architecture design for a fork-based Monte Carlo simulation
that stress-tests the v2.0.0 upgrade (ETH payments, effective balance accounting,
SSV staking) under realistic mainnet conditions.

---

## R-1: Oracle Quorum Mechanics

### `commitRoot` Signature

```solidity
function commitRoot(bytes32 merkleRoot, uint64 blockNum) external;
```

**Source:** `contracts/interfaces/ISSVDAO.sol:203`

### How `commitRoot` Works

**Source:** `contracts/modules/SSVDAO.sol:155-200`

1. **Caller validation:** `s.oracleIdOf[msg.sender] != 0` (reverts `NotOracle`)
2. **Monotonicity:** `blockNum > seb.latestCommittedBlock` (reverts `StaleBlockNumber`)
3. **Not future:** `blockNum <= block.number` (reverts `FutureBlockNumber`)
4. **Weight source:** `totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply()` must be > 0 (reverts `OracleHasZeroWeight`)
5. **Commitment key:** `keccak256(abi.encodePacked(blockNum, merkleRoot))` ties block+root together
6. **Double-vote guard:** `seb.hasVoted[commitmentKey][oracleId]` must be false (reverts `AlreadyVoted`)
7. **Weight accumulation:** Each oracle has equal weight = `totalStaked / defaultOracleIds.length`
8. **Quorum check:** `accumulatedWeight >= (totalStaked * quorumBps) / 10_000`
   - If met: stores `seb.ebRoots[blockNum] = merkleRoot`, updates `latestCommittedBlock`, emits `RootCommitted`
   - If not met: emits `WeightedRootProposed`

### How Unit Tests Simulate Oracle Quorum

**Source:** `test/unit/SSVDAO/commitRoot.test.ts`

Tests use a **harness contract** (`SSVDAOHarness`) with mock helper functions:
- `dao.mockSetOracle(oracleId, address)` — registers oracle addresses
- `dao.mockSetQuorumBps(bps)` — sets quorum threshold
- `dao.mockSetLatestCommittedBlock(blockNum)` — sets committed block
- `cssv.mint(owner, totalSupply)` — mints cSSV tokens (needed for oracle weight calculation)

The tests call `dao.connect(oracleN).commitRoot(merkleRoot, blockNum)` from each oracle signer sequentially until quorum is reached.

### Can We Impersonate Oracles on Fork?

**Yes.** The fork fixture (`test/setup/fixtures.ts:344-346`) already does this:

```typescript
await ethers.provider.send("hardhat_impersonateAccount", [ForkConfig.DAO_ADDRESS]);
const daoSigner = await ethers.getSigner(ForkConfig.DAO_ADDRESS);
await ethers.provider.send("hardhat_setBalance", [ForkConfig.DAO_ADDRESS, "0x..."]);
```

**Mainnet oracle addresses** from `deployments/mainnet-upgrade.config.json`:
```json
{
  "1": "0x6b6fa15717beeb5a40fac6610c3e92776037a30e",
  "2": "0x01E7e108eD97B4EA08e1a184aBA793b9D282E565",
  "3": "0xef6d2263a1d96eac2a4530ba327bcc2e6c948feb",
  "4": "0xFe33f6cb66ee2A85748458556D6ccEC3716D2173"
}
```

We can impersonate 3 of 4 oracles and call `commitRoot` to meet the 75% quorum.

**Important prerequisite:** cSSV `totalSupply` must be > 0 before calling `commitRoot`. On a fresh fork (pre-upgrade), no one has staked yet, so we must first:
1. Deploy + upgrade the contracts (via the fork fixture)
2. Stake SSV tokens to mint cSSV (or `hardhat_setStorageAt` to fake totalSupply)
3. Then call `commitRoot` from impersonated oracles

---

## R-2: View Functions for Invariant Checking

### Complete View Function Inventory

**Source:** `contracts/interfaces/ISSVViews.sol`, `contracts/modules/SSVViews.sol`

| Function | Returns | Purpose |
|---|---|---|
| `getValidator(address, bytes)` | `bool` | Is validator active? |
| `getOperatorFee(uint64)` | `uint256` | Operator ETH fee |
| `getOperatorFeeSSV(uint64)` | `uint256` | Operator SSV fee (legacy) |
| `getOperatorDeclaredFee(uint64)` | `OperatorDeclaredFeeData` | Pending fee change |
| `getOperatorById(uint64)` | `OperatorData` | Full operator details (ETH) |
| `getOperatorByIdSSV(uint64)` | `OperatorData` | Full operator details (SSV) |
| `getWhitelistedOperators(uint64[], address)` | `uint64[]` | Which ops whitelist an address |
| `isLiquidatable(owner, operatorIds, cluster)` | `bool` | ETH cluster liquidatable? |
| `isLiquidatableSSV(owner, operatorIds, cluster)` | `bool` | SSV cluster liquidatable? |
| `isLiquidated(owner, operatorIds, cluster)` | `bool` | Cluster already liquidated? |
| `getBurnRate(owner, operatorIds, cluster)` | `uint256` | ETH cluster burn rate |
| `getBurnRateSSV(owner, operatorIds, cluster)` | `uint256` | SSV cluster burn rate |
| `getOperatorEarnings(uint64)` | `uint256` | Operator ETH earnings |
| `getOperatorEarningsSSV(uint64)` | `uint256` | Operator SSV earnings |
| `getBalance(owner, operatorIds, cluster)` | `uint256` | ETH cluster balance |
| `getBalanceSSV(owner, operatorIds, cluster)` | `uint256` | SSV cluster balance |
| `getEffectiveBalance(owner, operatorIds, cluster)` | `uint32` | Cluster effective balance |
| `getClusterAssetType(owner, operatorIds)` | `uint8` | VERSION_SSV=0 or VERSION_ETH=1 |
| `getNetworkFee()` | `uint256` | Current ETH network fee |
| `getNetworkFeeSSV()` | `uint256` | Current SSV network fee |
| `getNetworkEarnings()` | `uint256` | Total ETH network earnings |
| `getNetworkEarningsSSV()` | `uint256` | Total SSV network earnings |
| `getOperatorFeeIncreaseLimit()` | `uint64` | Max fee increase % |
| `getMaximumOperatorFee()` | `uint256` | Max operator fee (ETH) |
| `getMaximumOperatorFeeSSV()` | `uint256` | Max operator fee (SSV) |
| `getMinimumOperatorEthFee()` | `uint256` | Min operator fee (ETH) |
| `getOperatorFeePeriods()` | `OperatorFeePeriodsData` | Declare/execute periods |
| `getLiquidationThresholdPeriod()` | `uint64` | ETH liquidation threshold blocks |
| `getLiquidationThresholdPeriodSSV()` | `uint64` | SSV liquidation threshold blocks |
| `getMinimumLiquidationCollateral()` | `uint256` | Min ETH liquidation collateral |
| `getMinimumLiquidationCollateralSSV()` | `uint256` | Min SSV liquidation collateral |
| `getValidatorsPerOperatorLimit()` | `uint32` | Max validators per operator |
| **`getNetworkValidatorsCount()`** | `uint32` | Total ETH validator count |
| **`cooldownDuration()`** | `uint256` | Unstake cooldown period |
| **`totalStaked()`** | `uint256` | Total SSV staked (cSSV supply) |
| **`stakedBalanceOf(address)`** | `uint256` | User's cSSV balance |
| **`pendingUnstake(address)`** | `UnstakeRequestsData[]` | User's pending unstake requests |
| **`accEthPerShare()`** | `uint256` | Global reward accumulator |
| **`stakingEthPoolBalance()`** | `uint256` | ETH in staking pool |
| **`previewClaimableEth(address)`** | `uint256` | Preview claimable ETH rewards |
| `getOracle(uint32)` | `address` | Oracle address by ID |
| `getOracleWeight(uint32)` | `uint256` | Oracle weight |
| `getActiveOracleIds()` | `uint32[4]` | Active oracle IDs |
| `getQuorumBps()` | `uint16` | Quorum in basis points |
| `getCommittedRoot(uint64)` | `bytes32` | Merkle root for block |
| `getVersion()` | `string` | Contract version |

### Specifically Asked Views — All Present

| View | Available? | Source |
|---|---|---|
| `accEthPerShare()` | **YES** | `SSVViews.sol:624` — reads `SSVStorageStaking.load().accEthPerShare` |
| `previewClaimableEth(address)` | **YES** | `SSVViews.sol:638` — computes pending via `_previewAccEthPerShare` helper |
| `getOperatorEarnings(uint64)` | **YES** | `SSVViews.sol:368` — updates snapshot in memory, returns `ethSnapshot.balance` |
| `getNetworkValidatorsCount()` | **YES** | `SSVViews.sol:578` — returns `sp.ethDaoValidatorCount` |
| `stakingEthPoolBalance()` | **YES** | `SSVViews.sol:631` — returns unpacked `s.stakingEthPoolBalance` |

**Key finding for simulation:** `previewClaimableEth` (SSVViews.sol:638-645) includes a `_previewAccEthPerShare` helper that simulates `_syncFees` in read-only mode, factoring in unrealized network fee earnings. This means we can read accurate claimable rewards at any point without triggering a state change.

---

## R-3: Migration Value Calculation

### `migrateClusterToETH` Requirements

**Source:** `contracts/modules/SSVClusters.sol:264-348`

```solidity
function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable
```

**Steps:**
1. Validates cluster exists in SSV mapping (`VERSION_SSV`)
2. Computes SSV balance at current block (settles outstanding fees)
3. Sets `cluster.balance = msg.value` (ETH deposit)
4. Sets `cluster.active = true` (even if previously liquidated)
5. Liquidation check: `isLiquidatableWithEB(...)` — must pass or reverts `InsufficientBalance`
6. Stores in `ethClusters`, deletes from `clusters`
7. Handles EB deviation accounting
8. Refunds full SSV cluster balance via `CoreLib.transferTokenBalance(msg.sender, ssvClusterBalance)`

### Minimum ETH for Migration (Survival Formula)

For a cluster with N validators, 4 operators at default fee, implicit EB (32 ETH):

```
vUnits = N * 10_000 (implicit, assumes 32 ETH/validator)
burnRate = 4 * DEFAULT_OPERATOR_ETH_FEE_PACKED
         = 4 * 17754  (1_775_464_912 / 100_000 = 17754 packed)
networkFee = 35509     (3_550_900_000 / 100_000 = 35509 packed)

rate = burnRate + networkFee = 4*17754 + 35509 = 106525

thresholdUnits = (minimumBlocksBeforeLiquidation * rate * vUnits) / VUNITS_PRECISION
               = (35800 * 106525 * N * 10000) / 10000
               = 35800 * 106525 * N

liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS
                     = 35800 * 106525 * N * 100_000

For N=1: 35800 * 106525 * 100_000 = 381,359,500,000,000 wei ≈ 0.0003814 ETH
```

Plus must also exceed `minimumLiquidationCollateral = 940_000_000_000_000 = 0.00094 ETH`.

**So minimum ETH for migration with N validators (4 ops, default fees):**
```
max(0.00094, 0.0003814 * N) ETH + epsilon
```

For N=1..3, the 0.00094 ETH minimum collateral dominates. For N>=3, the threshold formula dominates.

### SSV Refund Handling

At `SSVClusters.sol:340-342`:
```solidity
if (ssvClusterBalance != 0) {
    CoreLib.transferTokenBalance(msg.sender, ssvClusterBalance);
}
```

The full outstanding SSV balance (after settling fees to current block) is refunded to `msg.sender` as SSV tokens.

---

## R-4: Mainnet Deployment Info

### Contract Addresses

**Source:** `deployments/mainnet-upgrade.config.json`, `.openzeppelin/mainnet.json`

| Contract | Address |
|---|---|
| SSVNetwork (proxy) | `0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1` |
| SSVNetworkViews | `0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4` |
| SSV Token | `0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54` |
| DAO/Owner | `0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6` |

### Deployment Block

The `.openzeppelin/mainnet.json` records the proxy deploy tx hash: `0x4a11a560d3c2f693e96f98abb1feb447646b01b36203ecab0a96a1cf45fd650b`. The exact block number is not stored in the repo config files.

**To determine the deployment block**, look up the tx on-chain. The SSVNetwork v1 was deployed around block 17507487 (June 2023). The current proxy at `0xDD9BC35aE...` was a later redeployment around block 18685000+ (Nov 2023). The current mainnet block is ~21.8M+ (Feb 2026).

**Event scan estimate:** ~3M blocks from initial deployment to present. However, the fork approach avoids needing to scan events — we get live state directly from the fork.

### Fork Configuration

**Source:** `hardhat.config.ts:62-69`

```typescript
hardhat_forked: {
  type: 'edr-simulated',
  forking: {
    url: "http://127.0.0.1:8545",
    blockNumber: process.env.FORK_BLOCK_NUMBER ? Number(...) : undefined,
  }
}
```

The fork approach:
1. Start Anvil: `anvil --fork-url "$MAINNET_ETH_NODE_URL" --port 8545`
2. Run tests with `npx hardhat test --network hardhat_forked`
3. Optionally pin block with `FORK_BLOCK_NUMBER=<N>`

---

## R-5: SSV Token Minting on Fork

### SSV Token Contract

**Source:** `contracts/token/SSVToken.sol`

```solidity
contract SSVToken is Ownable, ERC20, ERC20Burnable {
    constructor() ERC20("SSV Token", "SSV") {
        _mint(msg.sender, 1000000000000000000000);
    }
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

The `mint` function is `onlyOwner` — only the token deployer (not the DAO address on the SSVNetwork contract) can mint. The SSV token on mainnet has a fixed supply (no mint function exposed to arbitrary callers).

### How Tests Provision SSV Tokens

**Source:** `test/setup/fixtures.ts:181-184`

In fresh deployments, tests deploy their own `MockToken`:
```typescript
const ssvToken = await connection.ethers.deployContract("MockToken");
await ssvToken.mint(deployer.address, connection.ethers.parseEther("1000000"));
```

In fork tests (`ssvNetworkFullForkedFixture`), the test attaches to the real mainnet SSV token at `ForkConfig.SSV_TOKEN` and uses the existing on-chain balances.

### Can We `deal` / `hardhat_setStorageAt`?

**Yes.** This is the recommended approach for fork simulation:

```typescript
// Option 1: hardhat_setBalance for ETH
await ethers.provider.send("hardhat_setBalance", [address, hexAmount]);

// Option 2: hardhat_setStorageAt for ERC-20 balances
// SSV Token uses OpenZeppelin ERC20 — balances are at mapping slot
// balanceOf mapping is at slot 0 in the OZ layout
const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "uint256"], [targetAddress, 0]
));
await ethers.provider.send("hardhat_setStorageAt", [
  ssvTokenAddress, slot, ethers.zeroPadValue(ethers.toBeHex(amount), 32)
]);
```

For the simulation, we can also impersonate the SSV token owner to call `mint()` if the mainnet token has a live owner, OR use `hardhat_setStorageAt` to directly set balances.

---

## R-6: Fee Sync Mechanics

### `_syncFees` — When Is It Called?

**Source:** `contracts/modules/SSVStaking.sol:179-203`

`_syncFees` is called inside **SSVStaking** at the start of these functions:
- `syncFees()` — explicit external call (line 35)
- `stake(uint256)` — line 51
- `requestUnstake(uint256)` — line 73
- `claimEthRewards()` — line 117
- `onCSSVTransfer(from, to, amount)` — line 174 (triggered by cSSV transfers)

### What `_syncFees` Does

```solidity
function _syncFees(StorageStaking storage s) internal {
    StorageProtocol storage sp = SSVStorageProtocol.load();
    PackedETH current = sp.networkTotalEarnings();        // <- reads live network earnings
    sp.ethDaoBalance = current;                            // <- snapshots DAO balance
    sp.ethDaoIndexBlockNumber = uint32(block.number);      // <- snapshots block

    PackedETH previous = s.stakingEthPoolBalance;
    if (current.lte(previous)) {
        s.stakingEthPoolBalance = current;
        return;
    }

    PackedETH packedNewFees = current.sub(previous);
    uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
    if (totalStaked != 0) {
        uint256 newFeesWei = PackedETHLib.unpack(packedNewFees);
        s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
    }
    s.stakingEthPoolBalance = current;
}
```

`networkTotalEarnings()` (ProtocolLib.sol:85-91) computes:
```
earningsUnits = (blocksSinceLastUpdate * ethNetworkFee * daoTotalEthVUnits) / VUNITS_PRECISION
return ethDaoBalance + packed(earningsUnits)
```

### Does `accEthPerShare` Update on Cluster Operations?

**No.** Confirmed by grep: `_syncFees` / `syncFees` are NOT called in `SSVClusters.sol`. Cluster operations (`deposit`, `withdraw`, `liquidate`, `migrateClusterToETH`, `updateClusterBalance`) do NOT trigger `_syncFees`.

However, `ProtocolLib.updateDAO()` and `ProtocolLib.updateDAOEarnings()` are called by cluster operations, which update `ethDaoBalance` and `ethDaoIndexBlockNumber`. This means:
- **The underlying network earnings accumulate correctly** (via `networkTotalEarnings()` reading live block numbers)
- **But `accEthPerShare` in StorageStaking is stale** until someone calls a staking function

**Implication for simulation:** The staking accumulator is lazy. `accEthPerShare` only updates when staking actions occur. Between staking actions, network fees continue to accrue in `ethDaoBalance` via `ProtocolLib`, but the per-share distribution isn't computed until `_syncFees` is called. The view function `previewClaimableEth` handles this correctly by computing a preview.

---

## R-7: Mainnet Scale

### Estimated Network Size

The mainnet SSV network (as of early 2026):
- **Operators:** ~1,200-1,500 registered operators (not all active)
- **Clusters:** ~25,000-40,000 clusters (based on validator registrations)
- **Validators:** ~70,000-100,000+ validators registered through SSV

The `getNetworkValidatorsCount()` view returns `sp.ethDaoValidatorCount` which tracks ETH-cluster validators only. On a pre-upgrade fork, this will be 0 since no clusters have migrated yet.

### Feasibility of Full Tracking

For simulation purposes:
- **All operators:** Feasible to track — ~1,500 is small
- **All clusters:** Feasible with events-based reconstruction, but we need cluster structs (validatorCount, index, networkFeeIndex, balance, active). These are hashed on-chain, not stored in cleartext.
- **Sampling approach:** For Monte Carlo simulation, we can:
  1. Use a representative sample (100-500 clusters across different sizes)
  2. Create synthetic clusters with realistic distributions
  3. Focus on migration scenarios rather than full state replay

### Cluster State Challenge

Cluster data is stored as `keccak256(hash)` — not directly readable. To get actual cluster state, we'd need to:
1. Replay events from deployment to reconstruct cluster structs
2. OR use the view functions with known cluster structs from event logs
3. OR create fresh clusters in the simulation

**Recommendation:** For Monte Carlo simulation, create synthetic clusters with realistic parameter distributions rather than trying to replay full mainnet state. The fork gives us correct protocol parameters and operator state; we generate the cluster scenarios.

---

## Architecture Design

### Refined Simulation Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Simulation Harness                   │
│  (TypeScript, runs on Hardhat forked network)        │
├─────────────────┬───────────────────────────────────┤
│  Setup Phase    │  Execution Phase   │  Check Phase  │
│                 │                    │               │
│ 1. Fork mainnet │ For each epoch:    │ After each:   │
│ 2. Upgrade      │  - Mine N blocks   │ - View calls  │
│    contracts    │  - Random actions: │ - Invariant   │
│ 3. Configure    │    * register val  │   checks      │
│    oracles     │    * migrate       │ - Balance      │
│ 4. Provision    │    * deposit/wdraw │   accounting  │
│    test actors │    * liquidate     │ - Conservation │
│ 5. Stake SSV    │    * stake/unstake │   laws        │
│    (mint cSSV) │    * commitRoot    │               │
│                 │    * claimRewards  │               │
└─────────────────┴───────────────────┴───────────────┘
```

### Simulation Parameters

| Parameter | Recommended Value | Rationale |
|---|---|---|
| Fork block | Latest mainnet block | Most realistic state |
| Sample operators | 50 (of ~1500) | Representative mix of fees/sizes |
| Sample clusters | 200-500 synthetic | Mix of sizes: 1, 4, 32, 100 validators |
| Actors (EOAs) | 20 | Cluster owners, stakers, liquidators |
| Epochs per run | 100 | Each epoch = 1000 blocks (~3.5 hrs) |
| Blocks per epoch | 1000 | Enough for fee accrual to be significant |
| Monte Carlo runs | 50-100 | For statistical confidence |
| Actions per epoch | 5-15 random | From weighted distribution |

### Action Distribution (per epoch)

| Action | Weight | Description |
|---|---|---|
| `registerValidator` | 10% | Add validators to ETH clusters |
| `migrateClusterToETH` | 15% | Migrate SSV clusters |
| `deposit` | 15% | Top up cluster balances |
| `withdraw` | 10% | Withdraw from clusters |
| `liquidate` | 5% | Liquidate underfunded clusters |
| `commitRoot` | 10% | Oracle EB updates |
| `updateClusterBalance` | 10% | Apply EB changes |
| `stake` | 10% | Stake SSV tokens |
| `requestUnstake` | 5% | Request unstaking |
| `claimEthRewards` | 5% | Claim ETH rewards |
| `mine blocks (no-op)` | 5% | Time passage only |

### Invariant Checks

After each epoch, verify:

1. **ETH Conservation:** `contract.balance >= sum(all_cluster_balances) + sum(all_operator_eth_earnings) + stakingEthPoolBalance`
2. **SSV Conservation:** `ssvToken.balanceOf(contract) >= sum(all_ssv_cluster_balances) + sum(all_operator_ssv_earnings) + sum(pending_unstake_amounts)`
3. **Staking Accumulator:** `accEthPerShare` monotonically non-decreasing
4. **Staking Pool:** `stakingEthPoolBalance <= getNetworkEarnings()`
5. **Validator Counts:** `getNetworkValidatorsCount() == sum(cluster.validatorCount for active ETH clusters)`
6. **Operator Consistency:** For each operator, `ethValidatorCount == sum(cluster.validatorCount where op in cluster)`
7. **Cluster Hash Integrity:** All cluster operations produce valid cluster hashes (verifiable via view functions)
8. **Liquidation Correctness:** No active cluster with `validatorCount > 0` is liquidatable after deposit/reactivate
9. **Oracle Monotonicity:** `latestCommittedBlock` strictly increases
10. **cSSV Supply = Total Staked SSV:** `cssvToken.totalSupply() == ssvToken.balanceOf(stakingContract) - pendingUnstakeTotal`

### Showstoppers and Design Changes

#### 1. Cluster State Opacity (Mitigated)
On-chain cluster data is hashed — we can't read arbitrary cluster state. **Mitigation:** Track all cluster structs locally in the simulation (created by us), and pass correct structs to each function call. This is how the existing tests work.

#### 2. cSSV Must Exist Before Oracle Calls (Critical)
`commitRoot` requires `totalSupply > 0`. The simulation must stake SSV and mint cSSV **before** attempting any oracle root commits. **Sequence:** deploy/upgrade -> stake SSV -> set up oracles -> simulate.

#### 3. Lazy `accEthPerShare` (Design Consideration)
The staking accumulator only updates on staking actions. For accurate invariant checking between epochs, use `previewClaimableEth()` (which simulates `_syncFees` read-only) rather than reading `accEthPerShare()` directly.

#### 4. Merkle Proof Construction (Implementation Effort)
`updateClusterBalance` requires valid Merkle proofs. The simulation must build a Merkle tree from cluster effective balances and generate proofs. Use OpenZeppelin's `@openzeppelin/merkle-tree` library (same as the oracle would use). Proof leaf format: `keccak256(keccak256(abi.encode(clusterId, effectiveBalance)))`.

#### 5. Fork State Freshness
The fork captures a point-in-time snapshot. During simulation, `block.number` advances locally but Ethereum mainnet state doesn't change. This is fine — we're testing contract logic, not mainnet liveness.

### Implementation Roadmap

1. **Phase 1 — Scaffold** (Task 1)
   - Fork setup + upgrade fixture (leverage `ssvNetworkFullForkedFixture`)
   - Actor provisioning (ETH + SSV via `hardhat_setBalance` / `hardhat_setStorageAt`)
   - Oracle setup (impersonate 4 oracle addresses, fund with ETH)
   - Initial SSV staking to bootstrap cSSV supply

2. **Phase 2 — Action Engine** (Task 2)
   - Random action generator with weighted distribution
   - Cluster state tracker (local cache of all cluster structs)
   - Merkle tree builder for EB oracle updates
   - Block advancement (`mine` helper)

3. **Phase 3 — Invariant Checker** (Task 3)
   - Balance conservation checks (ETH + SSV)
   - Staking reward accumulator verification
   - Cross-entity consistency (operators vs clusters vs DAO)
   - Statistical output (pass rates, failure distributions)

4. **Phase 4 — Monte Carlo Runner** (Task 4)
   - Parameterized test runner with random seeds
   - Results aggregation and reporting
   - Edge case amplification (heavy liquidation scenarios, rapid migration waves)
