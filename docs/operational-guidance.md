# Operational Guidance

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | [Operator owners](operators.md) | Operational guidance
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

This page collects the main operational caveats and recommended workflows for cluster owners and operator owners. It is intentionally shorter than the full [Specification](./SPEC.md) and [Flows](./FLOWS.md), and focuses on actions that reduce avoidable operational risk.

## What this page is for

Use this document as an operator runbook for edge cases that are valid by design but easy to mishandle in production:

- legacy SSV cluster migration and effective-balance (EB) snapshots
- liquidated cluster deposits, withdrawals, and reactivation
- operator removal and reduced operator coverage
- private operator whitelist expectations
- implicit vs. explicit EB transitions for ETH clusters
- operator fee declaration lifecycles
- SSV staking withdrawal cadence and cSSV reward settlement

## Core principles

- Treat on-chain EB snapshots as protocol state, not as a complete substitute for beacon-chain-aware tooling.
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

### 2. For legacy SSV clusters, avoid validator removal immediately before migration

For legacy SSV clusters, `updateClusterBalance` stores an EB snapshot for future migration. If validator count changes and the owner migrates in the same stale-root window, the stored snapshot can be out of date relative to the post-removal cluster.

Recommended sequence:

- migrate first, then remove validators later
- or remove validators, then wait for a fresh post-removal oracle root before migrating

This is primarily an owner sequencing issue, not a steady-state accounting issue. Owners should not rely on immediate post-removal migration if the migration funding depends on an exact EB assumption.

### 3. Understand liquidated-cluster behavior

Liquidated clusters have a few non-obvious but intentional behaviors:

- `deposit` is allowed while the cluster is liquidated
- `withdraw` is also allowed while the cluster is liquidated
- a deposit does not reactivate the cluster by itself
- if the owner later decides not to reactivate, they can withdraw the deposited ETH

Operational guidance:

- treat liquidation recovery as a two-step workflow: fund first, reactivate second
- do not assume a deposit alone restores service
- if you are preparing a reactivation, keep track of both deposited ETH and the expected reactivation amount

### 4. Check operator state before reactivation or migration

If one or more operators in a cluster were removed, the cluster may still reactivate or migrate, but removed operators are skipped in the relevant update paths and the cluster can continue with reduced operator coverage.

Operational guidance:

- check every operator in the set before reactivation or migration
- do not assume a 4-operator cluster will still reactivate as 4-of-4 after removals
- treat reduced operator coverage as an operational and fault-tolerance event, not just a fee change

### 5. Treat legacy SSV clusters as migration-focused

Legacy SSV clusters are no longer the general-purpose path. Some actions remain available, but the intended direction is migration to ETH accounting.

Operational guidance:

- expect legacy SSV workflows to be narrower than ETH cluster workflows
- treat `updateClusterBalance` on an SSV cluster as migration preparation, not as SSV fee settlement
- if you need long-term operational flexibility, plan around migration instead of extending reliance on the legacy path

### 6. Whitelist changes are not retroactive

Private-operator authorization is checked when validators are registered. Changing whitelist settings later does not retroactively remove already registered validators.

Operational guidance:

- treat whitelist changes as controls for future registrations only
- if access policy changes, review existing validator membership separately

### 7. Treat the implicit-to-explicit EB flip as a solvency checkpoint

ETH clusters start with an implicit EB assumption (`validatorCount * 32 ETH`) and switch to an explicit stored snapshot the first time an oracle root includes them. The burn rate and liquidation threshold recompute against the explicit value at that moment, so a cluster that is comfortable under the implicit assumption can become liquidatable immediately after the first update if the real EB is materially above 32 ETH per validator.

Operational guidance:

- treat the first `ClusterBalanceUpdated` for a cluster as a solvency event, not a passive oracle update
- if you expect the cluster's real EB to exceed 32 ETH per validator, fund ahead of the first explicit update rather than after
- re-check the liquidation threshold whenever a cluster transitions from no-snapshot to a stored snapshot

See the EB accounting section in the [Specification](./SPEC.md) for the exact burn rate and liquidation formula.

### 8. `migrateClusterToETH` is one-way

Migration deletes the legacy SSV cluster record and creates an ETH-accounted cluster in its place. There is no supported path back to SSV accounting once the migration transaction has executed.

Operational guidance:

- treat migration as a deliberate one-way action, not a reversible switch
- finalize migration sizing, operator set, and fee expectations before calling `migrateClusterToETH`
- if you are unsure about the ETH accounting model, validate on a smaller cluster first

See the migration flow in [Flows](./FLOWS.md) for the full state transitions.

### 9. Do not expect to force an EB refresh on a liquidated cluster

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
- operator removals
- migration attempts for legacy SSV clusters
- the first `ClusterBalanceUpdated` for each cluster (implicit → explicit EB flip)
- pending operator fee declaration windows

Recommended automation:

- surface the latest committed root age and reference block
- warn when a cluster is liquidated and its EB snapshot may be stale
- warn when an owner tries to migrate shortly after validator removal
- warn when a cluster's operator set includes removed operators
- warn when a cluster first switches from implicit to explicit EB and the new burn rate moves it close to the liquidation threshold
- warn when an operator fee declaration is approaching `approvalEndTime` without being executed

## Source documents

This page is a practical companion to:

- [Specification](./SPEC.md)
- [Flows](./FLOWS.md)
- [Operator owners](./operators.md)
