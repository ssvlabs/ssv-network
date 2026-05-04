# SSV Network

### [Intro](../README.md) | Architecture | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | [Operator owners](operators.md) | [Operational guidance](operational-guidance.md)
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Contract architecture

The upgraded SSV Network keeps the modular proxy-based design used in earlier versions, but the business logic has materially expanded in `v2.0.0`. New clusters are ETH-funded, fee accrual is effective-balance-aware, effective balance updates are driven by an oracle root flow, and SSV staking distributes ETH rewards through `cSSV`.

At a high level:

- `SSVNetwork` is the main write entrypoint. It is a UUPS-upgradeable proxy-like router that delegates logic to module contracts.
- `SSVNetworkViews` is the main read entrypoint. It is upgraded separately and exposes the consolidated read surface.
- Stateless module contracts contain protocol logic and are attached to `SSVNetwork` through module slots.
- Diamond-storage libraries keep protocol state out of the entrypoint contracts, which is critical for upgrade safety.
- `CSSVToken` represents staked SSV and is tightly coupled to the staking module.

## Main components

### `SSVNetwork`

`SSVNetwork` is the protocol write surface for operators, clusters, validators, DAO/governance actions, and staking. It owns the persistent protocol state through storage libraries and delegates external calls to the configured module addresses.

This contract is UUPS-upgradeable. Storage safety still depends on not introducing new mutable state directly into `SSVNetwork` or `SSVNetworkViews`.

### `SSVNetworkViews`

`SSVNetworkViews` is the canonical read surface. It forwards view calls to `SSVNetwork` and exposes read helpers for operators, clusters, balances, fees, staking, oracle configuration, and protocol parameters.

### Modules

The current module split is:

- `SSVOperators` for operator lifecycle, fee governance, and operator earnings
- `SSVOperatorsWhitelist` for private operators and whitelisting
- `SSVClusters` for deposits, withdrawals, liquidation, reactivation, migration, and effective-balance updates
- `SSVValidators` for validator registration, exit, and removal flows
- `SSVDAO` for governance parameters, oracle administration, and protocol-level configuration
- `SSVStaking` for SSV staking, unstake requests, and ETH reward accounting
- `SSVViews` for read-side helpers and derived accounting views

Direct interaction with module contracts is not meaningful on its own because the protocol state lives behind `SSVNetwork`.

### Storage libraries

Protocol state is organized through storage libraries such as:

- `SSVStorage`
- `SSVStorageProtocol`
- `SSVStorageStaking`

This separation is part of the repo’s upgrade discipline. Logic can evolve across modules and implementations while the storage layout remains explicit and reviewable.

### Upgrade implementation

The mainnet rollout uses a dedicated upgrade implementation at `contracts/upgrades/mainnet/SSVNetworkSSVStakingUpgrade.sol`. The operational flow around this implementation is documented in [UPGRADE_PLAYBOOK.md](UPGRADE_PLAYBOOK.md) and [deployments/README.md](../deployments/README.md).

### `CSSVToken`

`CSSVToken` is the staking receipt token for staked SSV. It is minted and burned by the staking module and hooks transfers back into staking so accrued ETH rewards are settled before balances move.

## v2 system model

### ETH clusters and legacy SSV clusters

The most important conceptual change in `v2.0.0` is the split between:

- **ETH clusters**, which are the new standard and pay operator and network fees in ETH
- **Legacy SSV clusters**, which keep their pre-upgrade SSV accounting model and are preserved mainly for continuity and migration

The system is intentionally asymmetric after the upgrade. ETH clusters are the forward path. Legacy SSV clusters remain supported only within constrained rules.

### Effective balance and `vUnits`

ETH clusters are charged using effective-balance-aware accounting. The protocol normalizes effective balance into internal accounting units (`vUnits`) so fee burn scales with validator weight rather than only validator count.

The detailed formulas live in [SPEC.md](SPEC.md). The important architectural point is that EB data is no longer a peripheral input. It directly affects solvency checks, fee accounting, liquidation risk, and operator/DAO bookkeeping for ETH clusters.

### Oracle root flow

Effective balance updates are fed on-chain through an oracle-committed Merkle root, and clusters consume those updates through `updateClusterBalance`. The root-commit mechanics, quorum rules, and Merkle encoding are specified in [SPEC.md](SPEC.md), while the exact execution flow is documented in [FLOWS.md](FLOWS.md).

### Staking

The upgraded system adds SSV staking. Users stake SSV, receive `cSSV`, and earn ETH rewards sourced from protocol network fees. The staking module, the DAO fee accounting, and the `cSSV` transfer hook form one accounting system and should be considered together when reviewing changes.

### Migration

Legacy SSV clusters can migrate to ETH through a one-way transition. After migration, the cluster follows the ETH accounting model and cannot return to the legacy SSV branch.

## Design notes and operational gotchas

These are intentional protocol behaviors worth keeping visible in high-level docs:

- Legacy SSV clusters are restricted after the upgrade. They can be removed from, exited from, liquidated on the SSV path, migrated to ETH, and EB-updated, but they cannot continue as full-featured SSV clusters.
- Migration from SSV to ETH is one-way and irreversible.
- Effective balance starts as an implicit baseline and becomes explicit only after a successful oracle-backed `updateClusterBalance`.
- ETH deposits into liquidated clusters are allowed. This is useful for preparing reactivation.
- ETH withdrawals from liquidated clusters are allowed.
- Reactivation may rely on a stale on-chain EB snapshot. If the real effective balance increased while the cluster was inactive, the cluster may reactivate with insufficient ETH and later be auto-liquidated on the next valid EB update.
- Removed operators may be skipped during migration or reactivation flows. The cluster can continue with reduced operator coverage if the remaining configuration stays valid.

These are protocol-level behaviors, not documentation shortcuts. Reviewers and operators should assume they are part of the supported design unless the spec changes.

## Suggested reading order

- Start here for the mental model
- Read [SPEC.md](SPEC.md) for rules, formulas, invariants, and access control
- Read [FLOWS.md](FLOWS.md) for function-by-function execution behavior
- Read [UPGRADE_PLAYBOOK.md](UPGRADE_PLAYBOOK.md) and [deployments/README.md](../deployments/README.md) for environment and rollout operations
