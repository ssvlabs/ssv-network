# SSV Network v2.0.0 — Technical Specification

This document is the detailed technical specification for the SSV Staking upgrade (v2.0.0), derived from the DIP-X proposal. It serves as the source of truth for verifying smart contract behavior against the intended design.

## Table of Contents

1. [ETH Payments](#1-eth-payments)
2. [Effective Balance Accounting](#2-effective-balance-accounting)
3. [SSV Staking](#3-ssv-staking)
4. [Oracle System](#4-oracle-system)
5. [Storage Layout](#5-storage-layout)
6. [Type System & Packing](#6-type-system--packing)
7. [All Events](#7-all-events)
8. [All External Functions](#8-all-external-functions)
9. [Access Control Matrix](#9-access-control-matrix)
10. [Accounting Formulas](#10-accounting-formulas)
11. [Governance Parameters](#11-governance-parameters)
12. [Error Codes](#12-error-codes)
13. [Constants](#13-constants)

### Related Documents

- [Validator Registration — All State Combinations](./SPEC_VALIDATOR_REGISTRATION.md): Exhaustive analysis of `registerValidator`/`bulkRegisterValidator` covering all operator states, cluster states, EB states, and their cross-products.

---

## 1. ETH Payments

### Overview

ETH replaces SSV as the payment asset for network and operator fees. All new clusters operate exclusively with ETH. Existing SSV clusters are legacy — they cannot add/remove validators, deposit SSV, or reactivate. The only forward path is migration to ETH.

### New Clusters (ETH-based)

- Operator fees paid in ETH
- Network fees paid in ETH
- ETH deposited upfront for runway
- Fees scale with effective balance (vUnits), not validator count

### Existing Clusters (SSV-based, Legacy)

- Continue running with existing SSV runway
- **Blocked operations**: add validators, remove validators, reactivate, deposit SSV
- **Allowed operations**: self-liquidate, migrate to ETH, exit validators
- SSV fee accrual continues normally until runway depletes or migration occurs

### Cluster Migration (`migrateClusterToETH`)

- One-way, irreversible
- Single transaction: switches accounting from SSV to ETH
- Remaining SSV balance refunded to cluster owner
- ETH deposited via `msg.value` as new cluster balance
- Must pass ETH liquidation check post-migration or reverts with `InsufficientBalance`

### Operator Fee Transition

**New operators**: Register with ETH fee only (no SSV fee option)

**Existing operators**:
- SSV fees frozen (cannot modify)
- SSV fee accrual continues for non-migrated clusters
- Default ETH fee assigned automatically on first ETH cluster interaction:
  - If SSV fee = 0 → ETH fee = 0
  - If SSV fee > 0 → ETH fee = `DEFAULT_OPERATOR_ETH_FEE` (1,770,000,000 wei = ~0.00464 ETH/year per 32 ETH validator)

### Breaking Function Signature Changes

| Old Signature | New Signature | Change |
|---|---|---|
| `registerValidator(..., uint256 amount, Cluster)` | `registerValidator(..., Cluster) payable` | `amount` removed, now `payable` |
| `bulkRegisterValidator(..., uint256 amount, Cluster)` | `bulkRegisterValidator(..., Cluster) payable` | `amount` removed, now `payable` |
| `deposit(..., uint256 amount, Cluster)` | `deposit(..., Cluster) payable` | `amount` removed, now `payable` |
| `reactivate(..., uint256 amount, Cluster)` | `reactivate(..., Cluster) payable` | `amount` removed, now `payable` |
| `getBalance(...) returns (uint256)` | `getBalance(...) returns (uint256, uint256)` | Now also returns `ebBalance` |

---

## 2. Effective Balance Accounting

### Overview

Fees are calculated based on a cluster's total effective balance (in whole ETH) rather than validator count. This supports post-Pectra validators with variable effective balances (32–2048 ETH per validator).

### vUnit System

vUnits are the internal accounting unit that normalizes effective balance:

```
ETH → vUnits (ceiling): vUnits = ceil(effectiveBalanceETH * VUNITS_PRECISION / 32)
vUnits → ETH (floor):   effectiveBalanceETH = floor(vUnits * 32 / VUNITS_PRECISION)

VUNITS_PRECISION = 10,000
```

Examples:
- 1 validator at 32 ETH → 10,000 vUnits
- 1 validator at 64 ETH → 20,000 vUnits
- 3 validators at 32 ETH each → 30,000 vUnits

### Implicit vs Explicit EB

- **Implicit** (default): `clusterEB.vUnits == 0` → system uses `validatorCount * VUNITS_PRECISION`
- **Explicit**: Set after first `updateClusterBalance` call with oracle Merkle proof

### EB Update Constraints

- `effectiveBalance >= validatorCount * 32` (minimum 32 ETH per validator)
- `effectiveBalance <= validatorCount * 2048` (maximum 2048 ETH per validator)
- Block numbers must be strictly monotonically increasing
- Minimum blocks between updates enforced (`minBlocksBetweenUpdates`)

### DAO vUnit Tracking

```
daoTotalEthVUnits = ethDaoValidatorCount * VUNITS_PRECISION + Σ(cluster_deviations)
```

Where deviation = `cluster.vUnits - (cluster.validatorCount * VUNITS_PRECISION)` for clusters with explicit EB.

---

## 3. SSV Staking

### Overview

SSV holders stake tokens → receive cSSV (ERC-20, 1:1 ratio) → earn pro-rata share of ETH protocol revenue (network fees).

### Staking Flow

1. User approves SSV token transfer
2. User calls `stake(amount)` — minimum `MINIMAL_STAKING_AMOUNT` (1,000,000,000)
3. SSV tokens transferred to contract
4. cSSV minted to user at 1:1 ratio
5. Rewards begin accruing immediately

### Reward Distribution (Accumulator Pattern)

```solidity
// On syncFees():
currentDaoEarnings = sp.networkTotalEarnings()    // total ETH DAO has earned
newFees = currentDaoEarnings - stakingEthPoolBalance
accEthPerShare += (unpack(newFees) * 1e18) / cSSV.totalSupply()
stakingEthPoolBalance = currentDaoEarnings

// On settle(user):
pending = (cSSVBalance * (accEthPerShare - userIndex[user])) / 1e18
accrued[user] += pending
userIndex[user] = accEthPerShare
```

### Claiming Rewards

- Call `claimEthRewards()` at any time
- Payout truncated to ETH_DEDUCTED_DIGITS precision: `payout = accrued - (accrued % 100_000)`
- Deducted from both `stakingEthPoolBalance` and `sp.ethDaoBalance`
- ETH transferred to user

### cSSV Token Behavior

- Mint: only by SSVStaking on `stake()`
- Burn: only by SSVStaking on `requestUnstake()`
- Transfer hook: `_beforeTokenTransfer` calls `SSVStaking.onCSSVTransfer(from, to, amount)`
  - Settles rewards for both sender and receiver before transfer
  - Ensures rewards accrued up to transfer point stay with original holder
- Retains full DAO governance voting power

### Unstaking (Two-Step)

1. **`requestUnstake(amount)`**: Burns cSSV, creates `UnstakeRequest{amount, unlockTime = now + cooldownDuration}`. Max 10 pending requests per user.
2. **`withdrawUnlocked()`**: After cooldown, returns SSV at 1:1. Uses swap-and-pop for O(1) removal.

Rewards STOP accruing for the unstaked portion at the moment of `requestUnstake`.

---

## 4. Oracle System

### Overview

Effective Balance Oracles track validator balances on the beacon chain and commit Merkle roots on-chain. The protocol uses a permissioned set of 4 oracles with a 3-of-4 (75%) quorum threshold.

### Commit Flow (`commitRoot`)

1. Oracle calls `commitRoot(merkleRoot, blockNum)`
2. Contract validates: `blockNum > latestCommittedBlock` (monotonic), `blockNum <= block.number` (not future)
3. Requires `cSSV.totalSupply() > 0` (reverts with `OracleHasZeroWeight` otherwise)
4. Each oracle has equal weight: `weight = totalCSSVSupply / 4`
5. Accumulated weight tracked per `commitmentKey = keccak256(blockNum, merkleRoot)`
6. When `accumulatedWeight >= (totalCSSVSupply * quorumBps) / 10_000`:
   - Root is committed: `ebRoots[blockNum] = merkleRoot`
   - `latestCommittedBlock = blockNum`
   - Emits `RootCommitted`
7. Below quorum: emits `WeightedRootProposed`

### Merkle Tree Structure (OpenZeppelin StandardMerkleTree compatible)

**Leaf encoding**: `keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))`
- Double-hash prevents second pre-image attacks
- `clusterID`: `keccak256(abi.encodePacked(owner, sortedOperatorIds))`
- `effectiveBalance`: `uint32` in whole ETH

**Tree construction**:
- Leaves sorted by hash value
- Internal nodes: siblings sorted before hashing (smaller hash first)
- Odd nodes duplicated

### Update Flow (`updateClusterBalance`)

Permissionless — anyone can submit a valid proof:

1. Verify committed root exists for `blockNum`
2. Verify update frequency (min blocks between updates)
3. Verify staleness (blockNum > last root used for this cluster)
4. Verify Merkle proof against committed root
5. Verify EB limits (32–2048 ETH per validator)
6. Convert to vUnits, apply fee settlements, update operator/DAO vUnit deviations
7. Auto-liquidate if cluster becomes undercollateralized

### Oracle API (External Reference)

The SSV Oracle (`github.com/ssvlabs/ssv-oracle`) exposes:
- `GET /api/commit` — latest committed root info
- `GET /api/proof/{clusterId}` — Merkle proof for a specific cluster

---

## 5. Storage Layout

### SSVStorage (`keccak256("ssv.network.storage.main") - 1`)

```solidity
struct StorageData {
    mapping(bytes32 => bytes32) validatorPKs;         // keccak256(pubkey, owner) → hashed(operatorIds | active)
    mapping(bytes32 => bytes32) clusters;              // SSV clusters: keccak256(owner, opIds) → clusterHash
    mapping(bytes32 => uint64) operatorsPKs;           // keccak256(pubkey) → operatorId
    mapping(SSVModules => address) ssvContracts;       // module enum → implementation
    mapping(uint64 => address) operatorsWhitelist;     // operatorId → whitelist address/contract
    mapping(uint64 => OperatorFeeChangeRequest) operatorFeeChangeRequests;
    mapping(uint64 => Operator) operators;             // operatorId → Operator struct
    IERC20 token;                                      // SSV ERC-20
    Counters.Counter lastOperatorId;                   // auto-increment
    mapping(address => mapping(uint256 => uint256)) addressWhitelistedForOperators; // bitmap
    mapping(bytes32 => bytes32) ethClusters;            // ETH clusters: same key → clusterHash
}
```

### Operator Struct

```solidity
struct Operator {
    uint32 validatorCount;       // SSV validator count
    PackedSSV fee;               // SSV fee (packed /10M)
    address owner;
    bool whitelisted;            // private flag
    Snapshot snapshot;           // SSV earnings: {uint32 block, uint64 index, PackedSSV balance}
    uint32 ethValidatorCount;    // ETH validator count
    PackedETH ethFee;            // ETH fee (packed /100K)
    EthSnapshot ethSnapshot;     // ETH earnings: {uint32 block, uint64 index, PackedETH balance}
}
```

### Cluster Struct

```solidity
struct Cluster {
    uint32 validatorCount;
    uint64 networkFeeIndex;     // snapshot of cumulative network fee index
    uint64 index;               // snapshot of cumulative operator fee index
    bool active;
    uint256 balance;            // ETH wei (ETH clusters) or SSV tokens (SSV clusters)
}
```

### SSVStorageProtocol (`keccak256("ssv.network.storage.protocol") - 1`)

```solidity
struct StorageProtocol {
    // SSV (legacy) fields
    uint32 networkFeeIndexBlockNumber;
    uint32 daoValidatorCount;
    uint32 daoIndexBlockNumber;
    uint32 validatorsPerOperatorLimit;
    PackedSSV networkFee;
    uint64 networkFeeIndex;
    PackedSSV daoBalance;
    uint64 minimumBlocksBeforeLiquidationSSV;
    PackedSSV minimumLiquidationCollateralSSV;
    uint64 declareOperatorFeePeriod;
    uint64 executeOperatorFeePeriod;
    uint64 operatorMaxFeeIncrease;
    uint64 operatorMaxFeeSSV;

    // ETH fields
    uint32 ethNetworkFeeIndexBlockNumber;
    uint32 ethDaoValidatorCount;
    uint32 ethDaoIndexBlockNumber;
    PackedETH ethNetworkFee;
    uint64 ethNetworkFeeIndex;
    PackedETH ethDaoBalance;
    PackedETH minimumLiquidationCollateral;
    uint64 minimumBlocksBeforeLiquidation;
    PackedETH operatorMaxFee;

    // EB fields
    uint64 daoTotalEthVUnits;
    PackedETH minimumOperatorEthFee;
}
```

### SSVStorageEB (`keccak256("ssv.network.storage.eb") - 1`)

```solidity
struct StorageEB {
    mapping(uint64 => bytes32) ebRoots;                    // blockNum → Merkle root
    mapping(bytes32 => ClusterEBSnapshot) clusterEB;       // clusterId → EB snapshot
    mapping(uint64 => uint64) operatorEthVUnits;           // operatorId → deviation vUnits
    uint64 latestCommittedBlock;
    uint32 minBlocksBetweenUpdates;
    mapping(bytes32 => uint256) rootCommitments;           // commitKey → accumulated weight
    mapping(bytes32 => mapping(uint32 => bool)) hasVoted;  // commitKey → oracleId → voted
}

struct ClusterEBSnapshot {
    uint64 vUnits;              // 0 = implicit (use validatorCount * 10_000)
    uint64 lastRootBlockNum;    // block of last root used
    uint64 lastUpdateBlock;     // actual block.number of last update
}
```

### SSVStorageStaking (`keccak256("ssv.network.storage.staking") - 1`)

```solidity
struct StorageStaking {
    uint64 cooldownDuration;
    PackedETH stakingEthPoolBalance;
    uint128 accEthPerShare;                                // scaled by 1e18
    mapping(address => uint256) userIndex;
    mapping(address => uint256) accrued;                   // unclaimed ETH in wei
    mapping(uint32 => address) oracles;                    // oracleId → address
    mapping(address => uint32) oracleIdOf;                 // address → oracleId
    uint32[4] defaultOracleIds;
    uint16 quorumBps;
    mapping(address => UnstakeRequest[]) withdrawalRequests;
}

struct UnstakeRequest {
    uint192 amount;
    uint64 unlockTime;
}
```

---

## 6. Type System & Packing

### PackedSSV (uint64)

```
Pack:   raw = value / 10_000_000
Unpack: value = raw * 10_000_000
```

Reverts with `MaxPrecisionExceeded` if `value % 10_000_000 != 0`.

### PackedETH (uint64)

```
Pack:   raw = value / 100_000
Unpack: value = raw * 100_000
```

Reverts with `MaxPrecisionExceeded` if `value % 100_000 != 0`.

### Version Constants

```
VERSION_SSV = 0       // Legacy SSV-fee clusters
VERSION_ETH = 1       // New ETH-fee clusters
VERSION_UNDEFINED = 255
```

### Cluster Hashing

```solidity
keccak256(abi.encodePacked(
    cluster.validatorCount,
    cluster.networkFeeIndex,
    cluster.index,
    cluster.balance,
    cluster.active
))
```

### Cluster ID (Identity Key)

```solidity
keccak256(abi.encodePacked(ownerAddress, operatorIds))
```

---

## 7. All Events

### Operator Events

```solidity
event OperatorAdded(uint64 indexed operatorId, address indexed owner, bytes publicKey, uint256 fee);
event OperatorRemoved(uint64 indexed operatorId);
event OperatorFeeDeclared(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);
event OperatorFeeDeclarationCancelled(address indexed owner, uint64 indexed operatorId);
event OperatorFeeExecuted(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);
event OperatorWithdrawn(address indexed owner, uint64 indexed operatorId, uint256 value);
event OperatorPrivacyStatusUpdated(uint64[] operatorIds, bool toPrivate);
event FeeRecipientAddressUpdated(address indexed owner, address recipientAddress);
```

### Whitelist Events

```solidity
event OperatorMultipleWhitelistUpdated(uint64[] operatorIds, address[] whitelistAddresses);
event OperatorMultipleWhitelistRemoved(uint64[] operatorIds, address[] whitelistAddresses);
event OperatorWhitelistingContractUpdated(uint64[] operatorIds, address whitelistingContract);
```

### Validator Events

```solidity
event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, Cluster cluster);
event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, Cluster cluster);
event ValidatorExited(address indexed owner, uint64[] operatorIds, bytes publicKey);
```

### Cluster Events

```solidity
event ClusterLiquidated(address indexed owner, uint64[] operatorIds, Cluster cluster);
event ClusterReactivated(address indexed owner, uint64[] operatorIds, Cluster cluster);
event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, uint256 ethDeposited, uint256 ssvRefunded, uint32 effectiveBalance, Cluster cluster);
event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);
event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);
event ClusterBalanceUpdated(address indexed owner, uint64[] operatorIds, uint64 indexed blockNum, uint32 effectiveBalance, Cluster cluster);
```

### DAO Events

```solidity
event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);
event NetworkFeeUpdatedSSV(uint256 oldFee, uint256 newFee);
event NetworkEarningsWithdrawn(uint256 value, address recipient);
event OperatorFeeIncreaseLimitUpdated(uint64 value);
event DeclareOperatorFeePeriodUpdated(uint64 value);
event ExecuteOperatorFeePeriodUpdated(uint64 value);
event LiquidationThresholdPeriodUpdated(uint64 value);
event LiquidationThresholdPeriodSSVUpdated(uint64 value);
event MinimumLiquidationCollateralUpdated(uint256 value);
event MinimumLiquidationCollateralSSVUpdated(uint256 value);
event OperatorMaximumFeeUpdated(uint256 maxFee);
event MinimumOperatorEthFeeUpdated(uint256 minFee);
event RootCommitted(bytes32 indexed merkleRoot, uint64 indexed blockNum);
event WeightedRootProposed(bytes32 indexed merkleRoot, uint64 indexed blockNum, uint256 accumulatedWeight, uint256 quorum, uint32 oracleId, address oracle);
event OracleReplaced(uint32 indexed oracleId, address indexed oldOracle, address indexed newOracle);
event QuorumUpdated(uint16 newQuorum);
event CooldownDurationUpdated(uint64 newCooldownDuration);
```

### Staking Events

```solidity
event Staked(address indexed user, uint256 amount);
event UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime);
event UnstakedWithdrawn(address indexed user, uint256 amount);
event FeesSynced(uint256 newFeesWei, uint256 accEthPerShare);
event RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex);
event RewardsClaimed(address indexed user, uint256 amount);
event ERC20Rescued(address indexed token, address indexed to, uint256 amount);
```

### Module Events

```solidity
event ModuleUpgraded(SSVModules indexed moduleId, address moduleAddress);
```

---

## 8. All External Functions

### SSVOperators

```solidity
function registerOperator(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64)
function removeOperator(uint64 operatorId) external nonReentrant
function declareOperatorFee(uint64 operatorId, uint256 fee) external
function executeOperatorFee(uint64 operatorId) external
function cancelDeclaredOperatorFee(uint64 operatorId) external
function reduceOperatorFee(uint64 operatorId, uint256 fee) external
function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external
function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external
function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external nonReentrant
function withdrawAllOperatorEarnings(uint64 operatorId) external nonReentrant
function withdrawAllVersionOperatorEarnings(uint64 operatorId) external nonReentrant
function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external nonReentrant
function withdrawAllOperatorEarningsSSV(uint64 operatorId) external nonReentrant
```

### SSVOperatorsWhitelist

```solidity
function setOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external
function removeOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external
function setOperatorsWhitelistingContract(uint64[] calldata operatorIds, ISSVWhitelistingContract whitelistingContract) external
function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external
```

### SSVValidators

```solidity
function registerValidator(bytes calldata publicKey, uint64[] memory operatorIds, bytes calldata sharesData, Cluster memory cluster) external payable
function bulkRegisterValidator(bytes[] memory publicKeys, uint64[] memory operatorIds, bytes[] calldata sharesData, Cluster memory cluster) external payable
function removeValidator(bytes calldata publicKey, uint64[] memory operatorIds, Cluster memory cluster) external
function bulkRemoveValidator(bytes[] calldata publicKeys, uint64[] memory operatorIds, Cluster memory cluster) external
function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external
function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external
```

### SSVClusters

```solidity
function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external nonReentrant
function liquidateSSV(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external nonReentrant
function reactivate(uint64[] calldata operatorIds, Cluster memory cluster) external payable
function deposit(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external payable
function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external nonReentrant
function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable
function updateClusterBalance(uint64 blockNum, address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster, uint32 effectiveBalance, bytes32[] calldata merkleProof) external nonReentrant
```

### SSVDAO

```solidity
function updateNetworkFee(uint256 fee) external                          // onlyOwner
function updateNetworkFeeSSV(uint256 fee) external                       // onlyOwner
function withdrawNetworkSSVEarnings(uint256 amount) external nonReentrant // onlyOwner
function updateOperatorFeeIncreaseLimit(uint64 percentage) external       // onlyOwner
function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external    // onlyOwner
function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external    // onlyOwner
function updateLiquidationThresholdPeriod(uint64 blocks) external        // onlyOwner
function updateLiquidationThresholdPeriodSSV(uint64 blocks) external     // onlyOwner
function updateMinimumLiquidationCollateral(uint256 amount) external     // onlyOwner
function updateMinimumLiquidationCollateralSSV(uint256 amount) external  // onlyOwner
function updateMaximumOperatorFee(uint256 maxFee) external               // onlyOwner
function updateMinimumOperatorEthFee(uint256 minFee) external            // onlyOwner
function commitRoot(bytes32 merkleRoot, uint64 blockNum) external        // oracle only
function replaceOracle(uint32 oracleId, address newOracle) external      // onlyOwner
function setQuorumBps(uint16 quorum) external                            // onlyOwner
function setUnstakeCooldownDuration(uint64 duration) external            // onlyOwner
```

### SSVStaking

```solidity
function syncFees() external nonReentrant
function stake(uint256 amount) external nonReentrant
function requestUnstake(uint256 amount) external nonReentrant
function withdrawUnlocked() external nonReentrant
function claimEthRewards() external nonReentrant
function rescueERC20(address token, address to, uint256 amount) external nonReentrant // onlyOwner
function onCSSVTransfer(address from, address to, uint256 amount) external           // cSSV only
```

### SSVNetwork (Proxy-level)

```solidity
function initialize(...) external initializer onlyProxy
function setFeeRecipientAddress(address recipientAddress) external    // anyone
function updateModule(SSVModules moduleId, address moduleAddress) external // onlyOwner
function getVersion() external pure returns (string memory)           // "v2.0.0"
```

---

## 9. Access Control Matrix

| Role | Who | Functions |
|---|---|---|
| **Owner** | Contract owner (Ownable2Step) | All `update*`, `withdraw*Network*`, `replaceOracle`, `setQuorumBps`, `setUnstakeCooldownDuration`, `updateModule`, `rescueERC20`, `_authorizeUpgrade` |
| **Operator Owner** | `msg.sender == operator.owner` | `removeOperator`, `declareOperatorFee`, `executeOperatorFee`, `cancelDeclaredOperatorFee`, `reduceOperatorFee`, `setOperators*`, `withdraw*OperatorEarnings*` |
| **Cluster Owner** | `msg.sender == owner` in cluster key | `reactivate`, `withdraw`, `migrateClusterToETH`, `registerValidator`, `bulkRegisterValidator`, `removeValidator`, `bulkRemoveValidator`, `exitValidator`, `bulkExitValidator` |
| **Oracle** | `oracleIdOf[msg.sender] != 0` | `commitRoot` |
| **cSSV Token** | `msg.sender == CSSV_ADDRESS` | `onCSSVTransfer` |
| **Anyone** | Any address | `liquidate` (if liquidatable), `liquidateSSV` (if liquidatable), `deposit`, `updateClusterBalance`, `registerOperator`, `syncFees`, `stake`, `requestUnstake`, `withdrawUnlocked`, `claimEthRewards`, `setFeeRecipientAddress`, all view functions |

---

## 10. Accounting Formulas

### ETH Network Fee Index

```
currentIndex = sp.ethNetworkFeeIndex + (block.number - sp.ethNetworkFeeIndexBlockNumber) * PackedETH.unwrap(sp.ethNetworkFee)
```

### ETH Operator Fee Index

```
operator.ethSnapshot.index += (block.number - ethSnapshot.block) * PackedETH.unwrap(operator.ethFee)
```

### ETH Operator Earnings (with EB)

```
effectiveVUnits = seb.operatorEthVUnits[operatorId] + operator.ethValidatorCount * VUNITS_PRECISION
operator.ethSnapshot.balance += (blockDiff * ethFee * effectiveVUnits) / VUNITS_PRECISION
```

### ETH Cluster Balance Update

```
clusterVUnits = (seb.clusterEB[id].vUnits == 0) ? validatorCount * 10_000 : seb.clusterEB[id].vUnits

idxOp = clusterIndex - cluster.index
idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex
networkFeeUnits = (idxNet * clusterVUnits) / VUNITS_PRECISION
operatorFeeUnits = (idxOp * clusterVUnits) / VUNITS_PRECISION
totalFees = (networkFeeUnits + operatorFeeUnits) * ETH_DEDUCTED_DIGITS

cluster.balance = max(0, cluster.balance - totalFees)
```

### SSV Network Fee Index (Legacy)

```
currentIndex = sp.networkFeeIndex + (block.number - sp.networkFeeIndexBlockNumber) * PackedSSV.unwrap(sp.networkFee)
```

### SSV Cluster Balance Update (Legacy)

```
usage = (clusterIndexSSV - cluster.index + currentNetworkFeeIndexSSV - cluster.networkFeeIndex) * cluster.validatorCount
cluster.balance = max(0, cluster.balance - unpack(usage))
```

### ETH Liquidation Check

```
burnRate = Σ PackedETH.unwrap(operator.ethFee) for all operators in cluster
networkFee = PackedETH.unwrap(sp.ethNetworkFee)
thresholdUnits = (minimumBlocksBeforeLiquidation * (burnRate + networkFee) * vUnits) / VUNITS_PRECISION

liquidatable = (balance < unpack(minimumLiquidationCollateral))
            || (balance < thresholdUnits * ETH_DEDUCTED_DIGITS)
```

### SSV Liquidation Check (Legacy)

```
burnRate = Σ PackedSSV.unwrap(operator.fee)
networkFee = PackedSSV.unwrap(sp.networkFee)

liquidatable = (balance < unpack(minimumLiquidationCollateralSSV))
            || (balance < unpack((burnRate + networkFee) * validatorCount * minimumBlocksBeforeLiquidationSSV))
```

### Staking Reward Accumulation

```
// syncFees:
newDaoEarnings = sp.networkTotalEarnings()    // ETH DAO total
newFees = newDaoEarnings - stakingEthPoolBalance
accEthPerShare += (unpack(newFees) * 1e18) / cSSV.totalSupply()
stakingEthPoolBalance = newDaoEarnings

// settle(user):
pending = (cSSVBalance * (accEthPerShare - userIndex[user])) / 1e18
accrued[user] += pending
userIndex[user] = accEthPerShare
```

---

## 11. Governance Parameters

### ETH Cluster Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `ethNetworkFee` | 0.000000003550929823 ETH/block (~0.00928 ETH/year) | `updateNetworkFee(uint256)` |
| `minimumLiquidationCollateral` | 0.00094 ETH | `updateMinimumLiquidationCollateral(uint256)` |
| `minimumBlocksBeforeLiquidation` | 50,190 blocks (~7 days) | `updateLiquidationThresholdPeriod(uint64)` |
| `operatorMaxFee` | TBD | `updateMaximumOperatorFee(uint256)` |
| `minimumOperatorEthFee` | TBD | `updateMinimumOperatorEthFee(uint256)` |

### SSV Cluster Parameters (Legacy)

| Parameter | Current Value | Proposed Value |
|---|---|---|
| `minimumLiquidationCollateralSSV` | 1.53 SSV | 0.883 SSV |
| `minimumBlocksBeforeLiquidationSSV` | 100,380 (~14 days) | 100,380 (~14 days) |

### Staking Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `cooldownDuration` | 604,800 seconds (7 days) | `setUnstakeCooldownDuration(uint64)` |

### Oracle Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `quorumBps` | 7,500 (75%) | `setQuorumBps(uint16)` |
| Oracle set | 4 oracles | `replaceOracle(uint32, address)` |

### Operator Fee Parameters

| Parameter | Value | Update Function |
|---|---|---|
| `defaultOperatorETHFee` | 1,770,000,000 wei (~0.00464 ETH/year) | Hardcoded |
| `declareOperatorFeePeriod` | Governance-set | `updateDeclareOperatorFeePeriod(uint64)` |
| `executeOperatorFeePeriod` | Governance-set | `updateExecuteOperatorFeePeriod(uint64)` |
| `operatorMaxFeeIncrease` | Governance-set | `updateOperatorFeeIncreaseLimit(uint64)` |

---

## 12. Error Codes

### Cluster Errors
- `ClusterAlreadyEnabled` — reactivating an already active cluster
- `ClusterIsLiquidated` — operating on a liquidated cluster
- `ClusterNotLiquidatable` — liquidation attempted but cluster is solvent
- `ClusterDoesNotExist` — cluster not found
- `InsufficientBalance` — balance too low for operation
- `InvalidPublicKeyLength` — validator public key wrong length
- `ValidatorAlreadyExistsWithData(bytes publicKey)` — validator already registered
- `ValidatorDoesNotExist` — validator not found
- `IncorrectClusterState` — submitted cluster struct doesn't match stored hash
- `IncorrectClusterVersion` — operating on wrong cluster version (e.g. SSV cluster for ETH operation)
- `IncorrectValidatorStateWithData(bytes publicKey)` — validator state mismatch
- `NewBlockPeriodIsBelowMinimum` — liquidation threshold too low
- `InvalidOperatorIdsLength` — wrong number of operator IDs
- `UnsortedOperatorsList` — operator IDs not sorted
- `EmptyPublicKeysList` — no public keys provided
- `PublicKeysSharesLengthMismatch` — public keys and shares arrays differ in length

### Operator Errors
- `CallerNotOwnerWithData(address caller, address owner)` — msg.sender not operator owner
- `CallerNotWhitelistedWithData(uint64 operatorId)` — whitelist check failed
- `OperatorAlreadyExists` — duplicate operator registration
- `OperatorDoesNotExist` — operator not found
- `InsufficientBalance` — insufficient earnings to withdraw
- `FeeTooLow` — fee below minimum operator ETH fee
- `FeeTooHigh` — fee exceeds maximum operator fee
- `FeeExceedsIncreaseLimit` — fee increase exceeds max allowed
- `FeeIncreaseNotAllowed` — zero-fee operator cannot increase
- `SameFeeChangeNotAllowed` — declared fee same as current
- `ApprovalNotWithinTimeframe` — fee execute outside window
- `NoFeeDeclared` — no pending fee change request
- `ExceedValidatorLimitWithData(uint64 operatorId)` — operator at validator capacity
- `TargetModuleDoesNotExistWithData(uint8 moduleId)` — module not registered
- `IncorrectOperatorVersion(uint8 operatorVersion)` — wrong operator version for operation
- `LegacyOperatorFeeDeclarationInvalid` — pre-migration fee declaration
- `OperatorsListNotUnique` — duplicate operator IDs in list

### Whitelist Errors
- `InvalidContractAddress` — invalid whitelist contract address
- `AddressIsWhitelistingContract(address contractAddress)` — address already a whitelisting contract
- `InvalidWhitelistingContract(address contractAddress)` — contract doesn't implement interface
- `InvalidWhitelistAddressesLength` — whitelist address array length mismatch
- `ZeroAddressNotAllowed` — zero address not permitted

### Packing Errors
- `MaxValueExceeded` — packed value overflow
- `MaxPrecisionExceeded` — fee value not divisible by precision factor

### Oracle/EB Errors
- `NotOracle` — caller not registered oracle
- `AlreadyVoted` — oracle already voted for this block
- `StaleBlockNumber` — block number not newer than last committed
- `FutureBlockNumber` — block number in the future
- `InvalidProof` — Merkle proof verification failed
- `RootNotFound` — no committed root for block number
- `StaleUpdate` — EB update is outdated
- `UpdateTooFrequent` — min blocks between updates not met
- `EBBelowMinimum` — effective balance below minimum
- `EBExceedsMaximum` — effective balance above maximum
- `OracleAlreadyAssigned` — oracle address already in use
- `OracleHasZeroWeight` — cSSV totalSupply is zero (no oracle weight)
- `InvalidQuorum` — quorum value out of valid range

### Staking Errors
- `NothingToWithdraw` — no unlocked unstake requests
- `NothingToClaim` — no accrued rewards to claim
- `MaxRequestsAmountReached` — exceeded MAX_PENDING_REQUESTS (10)
- `UnstakeAmountExceedsBalance` — unstake amount exceeds cSSV balance
- `StakeTooLow` — stake amount below MINIMAL_STAKING_AMOUNT
- `ZeroAmount` — amount is zero
- `InvalidToken` — cannot rescue protected tokens
- `NotCSSV` — caller is not the cSSV token contract

### General Errors
- `NotAuthorized` — unauthorized action
- `ZeroAddress` — zero address not allowed
- `ETHTransferFailed` — ETH transfer reverted
- `TokenTransferFailed` — ERC-20 transfer reverted

---

## 13. Constants

```solidity
// Precision
uint32 constant VUNITS_PRECISION = 10_000;
uint256 constant ETH_DEDUCTED_DIGITS = 100_000;
uint256 constant DEDUCTED_DIGITS = 10_000_000;

// EB Limits
uint256 constant MAX_EB_PER_VALIDATOR = 2048 ether;
uint256 constant DEFAULT_EB_PER_VALIDATOR = 32 ether;

// Operator Defaults
uint256 constant DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000;  // 1.77 gwei/vUnit/block

// Protocol Limits
uint64 constant MINIMAL_LIQUIDATION_THRESHOLD = 21_480;  // blocks
uint256 constant MAX_PENDING_REQUESTS = 10;
uint256 constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
uint256 constant MAX_DELEGATION_SLOTS = 4;

// Version
uint8 constant VERSION_SSV = 0;
uint8 constant VERSION_ETH = 1;
uint8 constant VERSION_UNDEFINED = 255;
```

---

END OF SPEC.md
