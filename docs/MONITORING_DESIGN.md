# SSV Network v2.0.0 — Post-Upgrade Continuous Monitoring Design

## Goal
Detect accounting anomalies and potential exploits as early as possible after the upgrade. The contracts have **no pause mechanism**, so this layer can only **warn**, not prevent.

## Why the existing audit scripts are a perfect fit

- `check-mainnet-migrate-clusters.ts` already verifies a single migration end-to-end (asset-type switch, operator validator-count deltas, proxy ETH delta, SSV refund, minimum ETH check).
- `check-mainnet-staking.ts` already verifies staking/unstaking math (`accEthPerShare`, `totalStaked`, `userIndex`, pending-unstake length).
- Both scripts use `SSVNetworkViews` to read the "expected" on-chain state and compare it against events and transaction side-effects.

Re-purposing them means we do not rewrite the math; we just **trigger** the same checks **automatically** for every relevant transaction.

## Architecture

```
┌─────────────┐    GraphQL      ┌──────────────────┐    RPC + Views    ┌─────────────┐
│  Subgraph   │ ──────────────► │  Monitor Script  │ ────────────────► │ Alert       │
│  (events)   │   (filter)      │  (verify)        │   (state proof)   │ Telegram    │
└─────────────┘                 └──────────────────┘                   └─────────────┘
```

### 1. Subgraph as an event filter (replaces block scanning)

Instead of `for (b = from; b <= to; b++) { eth_getBlockByNumber(b) }` (O(blocks)), the monitor polls the SSV subgraph for **relevant events** since the last checked block (O(events)).

Events to watch:

| Event | Risk |
|---|---|
| `ClusterWithdrawn` | Cluster withdraws more ETH than available |
| `OperatorWithdrawn` | Operator withdraws more ETH earnings than accrued |
| `OperatorWithdrawnSSV` | Operator withdraws more SSV earnings than accrued |
| `ClusterLiquidated` | Unjustified liquidation |
| `ClusterMigratedToETH` | Bad migration accounting (SSV refund, operator counts, min ETH) |
| `Staked` / `UnstakeRequested` | Staking math drift (cSSV mint/burn, `accEthPerShare`) |
| `FeesSynced` | Reward accumulator bug |
| `ClusterBalanceUpdated` | EB manipulation / wrong fee settlement |
| `NetworkEarningsWithdrawn` | DAO drainage |

### 2. On-chain verification per event

For each event the script performs a **targeted RPC check** at `blockNumber` (and `blockNumber - 1`). This is exactly what the existing scripts do, but automated.

| Event | On-chain verification |
|---|---|
| `ClusterWithdrawn` | 1. Decode tx input → get pre-state `Cluster` struct passed to `withdraw`.<br>2. Call `getBalance(owner, operatorIds, inputCluster, { blockTag: blockNumber - 1 })` → this is the **max withdrawable** amount before the tx.<br>3. **Alert if** `event.value > preBalance`.<br>4. Call `getBalance(owner, operatorIds, event.cluster, { blockTag: blockNumber })` → should equal `event.cluster.balance` (post-state consistency). |
| `OperatorWithdrawn` | 1. Call `getOperatorEarnings(operatorId, { blockTag: blockNumber - 1 })`.<br>2. **Alert if** `event.value > preEarnings`. |
| `OperatorWithdrawnSSV` | Same as above with `getOperatorEarningsSSV`. |
| `ClusterLiquidated` | 1. Call `isLiquidatable(owner, operatorIds, cluster, { blockTag: blockNumber - 1 })`.<br>2. **Alert if** it was not liquidatable. Verify bounty equals remaining balance. |
| `ClusterMigratedToETH` | Run the full `check-mainnet-migrate-clusters.ts` logic for that single tx hash (pre/post asset type, operator deltas, refund, min ETH). |
| `Staked` / `UnstakeRequested` | Run the full `check-mainnet-staking.ts` logic for that single tx hash (token/cSSV transfers, `totalStaked` delta, `accEthPerShare`). |
| `FeesSynced` | Verify `newFeesWei` and `accEthPerShare` match `getNetworkEarnings` delta and `stakingEthPoolBalance`. |

### 3. Periodic global invariant (backstop)

Every **N blocks** (e.g., 100 blocks ≈ 20 min), verify the **ETH Contract Balance Accounting Invariant** from `FLOWS.md`:

```
contract.ETH_balance  >=  Σ( getBalance(cluster, block) for all active ETH clusters )
                       + Σ( getOperatorEarnings(id, block) for all operators )
                       + getNetworkEarnings(block)
```

**How to make it tractable:**
- The subgraph supplies the list of all `Cluster` IDs and `Operator` IDs.
- The script only needs to query balances/earnings via RPC, not scan blocks.
- Run it in batches (e.g., 50 clusters at a time) to avoid RPC timeouts.

If the left side is **materially smaller** than the right, an exploit drained ETH from the contract.

### 4. Alerting policy

| Severity | Trigger |
|---|---|
| `CRITICAL` | Any invariant check returns `FAIL` (e.g., withdrawal > available balance). |
| `WARN` | Post-state check skipped because multiple SSVNetwork txs exist in the same block (pre-state checks are still valid). |
| `INFO` | Event processed successfully, all checks pass. |

Integration: write to stdout in a structured format (JSON Lines) and pipe to your alerting webhook.

## Concrete deliverable

A starter script is provided at `scripts/monitor-invariants.ts`. It demonstrates:
- Subgraph polling loop.
- `ClusterWithdrawn` over-withdrawal check (the user's primary example).
- `OperatorWithdrawn` / `OperatorWithdrawnSSV` over-withdrawal check.
- Extensible skeleton for staking/migration checks.

## Deployment recommendation

- Run as a lightweight Node.js service (Docker container).
- **Polling interval**: 15 seconds (one Ethereum block ≈ 12 s).
- **Start block**: upgrade block (`24_920_727`) or CLI override.
- **State file**: persist `lastCheckedBlock` to disk so restarts are safe and do not re-process old events.
- **RPC node**: dedicated node or high-rate limit provider (the script makes view calls only, no transactions).

## Extending the starter script

To add a new check:

1. Add a GraphQL query in `monitor-invariants.ts` for the target event.
2. In the main loop, fetch the new events alongside the existing ones.
3. Write a `check*(event, ...)` function that queries `SSVNetworkViews` at `blockNumber - 1` and `blockNumber`.
4. Log `FAIL` if the invariant is violated.

Because the script reuses the exact same `SSVNetworkViews` math that the contracts use, it is a **ground-truth verifier**: if the monitor says a check failed, the contract state is inconsistent with its own view functions.
