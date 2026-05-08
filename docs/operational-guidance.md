# Operational Guidance

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | [Operator owners](operators.md) | Operational guidance
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

This page collects the main operational caveats and recommended workflows for cluster owners and operator owners. It is intentionally shorter than the full [Specification](./SPEC.md) and [Flows](./FLOWS.md), and focuses on actions that reduce avoidable operational risk.

## What this page is for

Use this document as an operator runbook for edge cases that are valid by design but easy to mishandle in production:

- legacy SSV cluster migration and effective-balance (EB) snapshots
- active ETH cluster validator changes around periodic oracle roots
- liquidated cluster deposits, withdrawals, and reactivation
- operator removal and reduced operator coverage
- private operator whitelist expectations
- implicit vs. explicit EB transitions for ETH clusters
- operator fee declaration lifecycles
- SSV staking withdrawal cadence and cSSV reward settlement

## Core principles

- Treat on-chain EB snapshots as protocol state, not as a complete substitute for beacon-chain-aware tooling.
- Treat committed EB roots as periodic snapshots. A latest root can be valid while still reflecting cluster membership from before a recent validator addition or removal.
- Treat validator-count changes, operator removals, liquidation, and migration as separate state transitions. They do not always become visible to every subsystem at the same time.
- Do not assume that changing an operator's whitelist or removing an operator retroactively changes existing validator membership.
- Prefer explicit operator and cluster monitoring over UI assumptions. Several important transitions are detectable off-chain even when there is no dedicated on-chain warning event.

## Cluster owner guidance

### 1. Migrate and reactivate with an EB buffer

For ETH solvency checks, the protocol may rely on the stored `clusterEB` snapshot. That snapshot can lag the real beacon-chain EB, especially while a cluster is liquidated, because inactive clusters are not included in live oracle roots.

Operational guidance:

- use beacon-chain-aware tooling when sizing reactivation deposits and ETH migration funding
- add a conservative ETH buffer instead of funding to the exact minimum
- expect the on-chain EB snapshot to catch up only after the cluster is active again and later included in a committed root

This matters most for:

- `reactivate`
- `migrateClusterToETH`
- workflows that depend on a recently changed validator count or EB

### 2. Manage active ETH clusters around oracle-root windows

EB roots are committed periodically by the oracle process. In production this cadence is expected to be around every 8 hours. A committed root is therefore a valid snapshot, not a synchronous statement about validator membership after every cluster transaction.

For active ETH clusters, this creates an intentional timing trade-off:

- `updateClusterBalance` is permissionless when the caller has a valid proof against the latest committed root
- validator additions and removals update on-chain validator count immediately and add or remove the 32 ETH baseline EB for those validators
- the latest committed root may still contain EB from before that validator-count change
- any EB deviation above baseline is not removed proportionally by validator removal, so large removals can leave the cluster's effective EB high relative to the new validator count until a fresh oracle root catches up
- if updating the cluster with a proof from that latest valid root makes it liquidatable, any caller can trigger the protocol-defined auto-liquidation and receive the remaining cluster balance

This is not a reason to treat every validator-count change as unsafe. It means large changes should be sequenced with the latest unconsumed EB root in mind.

#### Dangerous sequence: remove validators, then withdraw too aggressively

```text
T0  Oracle snapshots cluster at high EB
    Example: 10,000 ETH EB, 100 validators

T1  Root is committed
    latestCommittedBlock now points to the high-EB snapshot

T2  Owner removes many validators
    On-chain validatorCount falls immediately

T3  Owner withdraws ETH based only on the lower validator count
    Cluster is left near the liquidation threshold

T4  Anyone calls updateClusterBalance with the latest root
    The root is valid, but still reports the high EB from T0

T5  Auto-liquidation can pay the remaining cluster balance to the caller
```

Operational guidance:

- before large removals, check whether there is a latest committed root that has not yet been consumed by the cluster
- after large removals, do not withdraw down near the liquidation threshold until a fresh post-removal root has been committed and consumed
- when sizing a withdrawal after removals, evaluate runway using the latest unconsumed root EB, not only the new validator count or the value returned by `SSVNetworkViews.getEffectiveBalance`
- for high-EB clusters, keep a conservative buffer through at least the next oracle round if the latest root may still reflect pre-removal EB

#### Benign trade-off: add validators before the next oracle round

The opposite direction can be favorable to the owner for a limited time:

```text
T0  Root is committed and consumed
    clusterEB is aligned with the current validator set

T1  Owner registers new validators
    On-chain validatorCount increases immediately, with 32 ETH baseline EB added per validator

T2  Until the next oracle root is committed and consumed,
    new validators are effectively accounted at the baseline 32 ETH EB

T3  Next oracle root includes the updated beacon-chain EB
    updateClusterBalance moves the cluster to explicit EB for the new state
```

This is an accepted latency trade-off in the design. Owners should not rely on it as a permanent fee state, and should fund the cluster for the EB that will apply once the next root catches up.

### 3. For legacy SSV clusters, avoid validator removal immediately before migration

For legacy SSV clusters, `updateClusterBalance` stores an EB snapshot for future migration. If validator count changes and the owner migrates in the same stale-root window, the stored snapshot can be out of date relative to the post-removal cluster.

Recommended sequence:

- migrate first, then remove validators later
- or remove validators, then wait for a fresh post-removal oracle root before migrating

This is primarily an owner sequencing issue, not a steady-state accounting issue. Owners should not rely on immediate post-removal migration if the migration funding depends on an exact EB assumption.

For active ETH clusters, the analogous validator-count/oracle-root timing concern is covered in §2.

### 4. Understand liquidated-cluster behavior

Liquidated clusters have a few non-obvious but intentional behaviors:

- `deposit` is allowed while the cluster is liquidated
- `withdraw` is also allowed while the cluster is liquidated
- a deposit does not reactivate the cluster by itself
- if the owner later decides not to reactivate, they can withdraw the deposited ETH

Operational guidance:

- treat liquidation recovery as a two-step workflow: fund first, reactivate second
- do not assume a deposit alone restores service
- if you are preparing a reactivation, keep track of both deposited ETH and the expected reactivation amount

### 5. Check operator state before reactivation or migration

If one or more operators in a cluster were removed, the cluster may still reactivate or migrate, but removed operators are skipped in the relevant update paths and the cluster can continue with reduced operator coverage.

Operational guidance:

- check every operator in the set before reactivation or migration
- do not assume a 4-operator cluster will still reactivate as 4-of-4 after removals
- treat reduced operator coverage as an operational and fault-tolerance event, not just a fee change

### 6. Treat legacy SSV clusters as migration-focused

Legacy SSV clusters are no longer the general-purpose path. Some actions remain available, but the intended direction is migration to ETH accounting.

Operational guidance:

- expect legacy SSV workflows to be narrower than ETH cluster workflows
- treat `updateClusterBalance` on an SSV cluster as migration preparation, not as SSV fee settlement
- if you need long-term operational flexibility, plan around migration instead of extending reliance on the legacy path

### 7. Whitelist changes are not retroactive

Private-operator authorization is checked when validators are registered. Changing whitelist settings later does not retroactively remove already registered validators.

Operational guidance:

- treat whitelist changes as controls for future registrations only
- if access policy changes, review existing validator membership separately

### 8. Treat the implicit-to-explicit EB flip as a solvency checkpoint

ETH clusters start with an implicit EB assumption (`validatorCount * 32 ETH`) and switch to an explicit stored snapshot the first time an oracle root includes them. The burn rate and liquidation threshold recompute against the explicit value at that moment, so a cluster that is comfortable under the implicit assumption can become liquidatable immediately after the first update if the real EB is materially above 32 ETH per validator.

Operational guidance:

- treat the first `ClusterBalanceUpdated` for a cluster as a solvency event, not a passive oracle update
- if you expect the cluster's real EB to exceed 32 ETH per validator, fund ahead of the first explicit update rather than after
- re-check the liquidation threshold whenever a cluster transitions from no-snapshot to a stored snapshot

See the EB accounting section in the [Specification](./SPEC.md) for the exact burn rate and liquidation formula.

### 9. `migrateClusterToETH` is one-way

Migration deletes the legacy SSV cluster record and creates an ETH-accounted cluster in its place. There is no supported path back to SSV accounting once the migration transaction has executed.

Operational guidance:

- treat migration as a deliberate one-way action, not a reversible switch
- finalize migration sizing, operator set, and fee expectations before calling `migrateClusterToETH`
- if you are unsure about the ETH accounting model, validate on a smaller cluster first

See the migration flow in [Flows](./FLOWS.md) for the full state transitions.

### 10. Do not expect to force an EB refresh on a liquidated cluster

Liquidated clusters are excluded from committed oracle roots by design, so the on-chain EB snapshot cannot be refreshed while the cluster is inactive. There is no supported mechanism to submit a proof out of band for an inactive cluster.

Operational guidance:

- do not plan reactivation around an updated EB snapshot — the snapshot refreshes only after reactivation and later re-inclusion in a root
- size reactivation funding from beacon-chain-aware tooling rather than from the stored snapshot
- this is the underlying reason for the buffer guidance in §1

## Operator owner guidance

### 1. Treat operator removal as a protocol event

Removing an operator is not just a UI cleanup step. Removed operators can still matter to cluster history, settlement, and migration logic even though they no longer participate in future accrual.

Operational guidance:

- announce removals to affected cluster owners when possible
- expect downstream effects on cluster reactivation and migration workflows
- remember that clusters referencing the operator may continue with reduced coverage rather than disappearing immediately

### 2. Manage private/public transitions carefully

Private operator settings affect new registrations, not historical membership. A whitelist change does not evict existing validators.

Operational guidance:

- use whitelist updates to control future intake
- if exclusivity matters, audit historical usage separately

### 3. Fee declarations have a bounded execution window

A declared operator fee change is executable only between `approvalBeginTime` and `approvalEndTime` (`declareOperatorFeePeriod + executeOperatorFeePeriod` after declaration). Outside that window, the declaration is no longer usable and the operator must re-declare.

Operational guidance:

- track the declare/execute window from the moment of declaration, not from the moment you intend to execute
- do not let a declaration sit idle near the window end
- if a missed window invalidated a prior request, re-declare explicitly rather than retrying `executeOperatorFee`

See the operator fee change flow in [Flows](./FLOWS.md) for the full sequence.

### 4. Declarations made before the v2 upgrade do not carry across it

The v2 upgrade rejects execution of any fee declaration whose `approvalBeginTime` is at or before `1776672000` (Mon Apr 20 2026 08:00:00 GMT+0000). Operators with pending declarations around the upgrade window needed to re-declare after the upgrade for the change to be executable.

Operational guidance:

- if a pre-upgrade fee change is no longer executable, re-declare it after the upgrade rather than investigating the rejection as a bug
- treat upgrade boundaries as declaration-lifecycle resets in general

## SSV staker guidance

### 1. cSSV transfers settle rewards for both parties at the transfer block

When cSSV is transferred, the `onCSSVTransfer` hook settles pending ETH rewards for the sender at the current share price and starts reward accrual for the receiver from the block of transfer. The receiver does not inherit any unclaimed rewards accumulated before the transfer.

Operational guidance:

- treat cSSV transfers as reward-crystallizing events for the sender
- do not assume that buying cSSV on a secondary market includes a claim on past rewards
- if you need to preserve reward continuity for an address, claim or transfer before expected accrual, not after

### 2. `withdrawUnlocked()` only returns matured unstake requests

A staker can hold many pending unstake requests at once, each with its own 7-day cooldown. A single call to `withdrawUnlocked()` processes all requests that have matured and leaves immature ones in place for a later call.

Operational guidance:

- if you staggered unstakes over multiple days, plan repeated `withdrawUnlocked()` calls rather than one
- do not interpret a partial return as a failure — immature requests are still tracked on-chain
- track outstanding requests off-chain so you know when the next call becomes productive

See the unstake request lifecycle in the [Specification](./SPEC.md) for full semantics.

## Monitoring and automation recommendations

At minimum, operators and cluster owners should monitor:

- `RootCommitted` updates from the oracle
- cluster liquidation status
- validator-count changes
- active clusters with a newer `RootCommitted` event than their latest `ClusterBalanceUpdated` event
- operator removals
- migration attempts for legacy SSV clusters
- the first `ClusterBalanceUpdated` for each cluster (implicit → explicit EB flip)
- pending operator fee declaration windows

Recommended automation:

- surface the latest committed root age and reference block
- surface whether each active ETH cluster has consumed the latest committed root by comparing `RootCommitted` and `ClusterBalanceUpdated` events; use `SSVNetworkViews.getCommittedRoot(blockNum)` to verify a root by block number when needed
- warn when a cluster is liquidated and its EB snapshot may be stale
- warn when an owner tries to withdraw aggressively after large validator removals but before a fresh post-removal EB update
- simulate latest-root consumption before high-impact withdrawals or validator removals
- warn when an owner tries to migrate shortly after validator removal
- warn when a cluster's operator set includes removed operators
- warn when a cluster first switches from implicit to explicit EB and the new burn rate moves it close to the liquidation threshold
- warn when an operator fee declaration is approaching `approvalEndTime` without being executed

## Source documents

This page is a practical companion to:

- [Specification](./SPEC.md)
- [Flows](./FLOWS.md)
- [Operator owners](./operators.md)
