# Release Notes

## [v2.0.0]

`v2.0.0` is the main SSV staking and ETH-accounting upgrade for the SSV Network contracts.

This release changes the network model in a material way:

- new clusters use ETH as the fee asset
- fee accounting for ETH clusters becomes effective-balance-aware
- effective balance updates are driven by an oracle-committed Merkle root flow
- SSV staking is introduced through `cSSV`
- legacy SSV clusters remain supported in a constrained compatibility mode and can migrate one-way to ETH

For the source-of-truth technical design, see [docs/SPEC.md](docs/SPEC.md). For exact execution behavior, see [docs/FLOWS.md](docs/FLOWS.md). For deployment and upgrade operations, see [docs/UPGRADE_PLAYBOOK.md](docs/UPGRADE_PLAYBOOK.md) and [deployments/README.md](deployments/README.md).

### Highlights

- **ETH-based cluster accounting**
  New clusters deposit and pay in ETH instead of SSV. Operator earnings and network earnings for the ETH branch are accrued in ETH.

- **Effective balance accounting**
  ETH cluster accounting now scales with effective balance through `vUnits`, rather than flat validator-count-only charging.

- **Oracle-based EB updates**
  Oracles commit Merkle roots for cluster effective balances, and clusters consume fresh EB data through `updateClusterBalance`.

- **SSV staking**
  SSV holders can stake SSV, receive `cSSV`, and earn ETH rewards sourced from protocol fee revenue.

- **One-way migration from legacy SSV clusters**
  Existing SSV clusters can migrate to ETH. The migration path is irreversible.

## Behavioral changes

### ETH clusters are the forward path

After `v2.0.0`, the protocol is intentionally split between:

- **ETH clusters**, which are the standard path for new validator operations
- **legacy SSV clusters**, which remain for backward compatibility and migration

### Legacy SSV clusters are restricted

Legacy SSV clusters no longer behave like fully featured pre-upgrade clusters.

Notable consequences:

- new validator registration continues on the ETH path, not the legacy SSV path
- legacy SSV clusters remain supported for compatibility flows such as removal, exit, liquidation on the SSV branch, migration, and EB snapshot updates
- migration to ETH is the intended long-term path

### Withdraw and deposit behavior changed for liquidated ETH clusters

For ETH clusters:

- depositing into a liquidated cluster is allowed
- withdrawing from a liquidated cluster is allowed

This is part of the intended solvency and reactivation model, not an accidental side effect.

### Reactivation can depend on stale EB state

If a cluster is reactivated while its on-chain EB snapshot is stale, the solvency check may not fully reflect the latest real beacon-chain effective balance. In practice, this means operators should treat reactivation funding conservatively and not assume the on-chain EB snapshot is always current for inactive clusters.

### Removed operators can be skipped in migration or reactivation flows

The upgraded system tolerates some historical operator-state asymmetry. During migration or reactivation, removed operators may be skipped and the cluster can continue with reduced operator coverage if the remaining configuration is valid.

## New protocol capabilities

### Staking and `cSSV`

This release introduces:

- `stake`
- `requestUnstake`
- `withdrawUnlocked`
- `claimEthRewards`
- `syncFees`

`cSSV` is minted on stake, burned on unstake request, and participates in reward settlement through the transfer hook integration with the staking module.

### Oracle and governance controls

This release adds or expands governance around:

- oracle replacement through `replaceOracle`
- oracle quorum configuration through `updateQuorumBps`
- effective-balance update throttling through `updateMinBlocksBetweenUpdates`
- staking cooldown control through `updateUnstakeCooldownDuration`
- ETH fee and collateral configuration for the upgraded accounting model

### Cluster migration and EB updates

This release introduces or formalizes:

- `migrateClusterToETH`
- `updateClusterBalance`
- the ETH reactivation, liquidation, deposit, and withdrawal model tied to EB-aware accounting

## Module and architecture impact

The `v2.0.0` system surface materially expands around the following modules:

- `SSVClusters`
- `SSVValidators`
- `SSVOperators`
- `SSVDAO`
- `SSVStaking`
- `SSVViews`

It also introduces the staking receipt token:

- `CSSVToken`

The mainnet rollout uses a dedicated upgrade implementation:

- `contracts/upgrades/mainnet/SSVNetworkSSVStakingUpgrade.sol`

## Upgrade and rollout notes

This release is designed to be rolled out as an upgrade from `v1.2.0` to `v2.0.0`.

Operationally important points:

- the upgrade path uses the repository deployment and SAFE batch tooling
- `initializeSSVStaking` must run as part of the mainnet upgrade path where applicable
- environment configuration and release artifacts live under `deployments/`
- post-upgrade verification should be performed with the env-aware verification flow

Use these documents for the rollout:

- [docs/UPGRADE_PLAYBOOK.md](docs/UPGRADE_PLAYBOOK.md)
- [deployments/README.md](deployments/README.md)

## Reference docs

- [README.md](README.md) for the repository entry point
- [docs/architecture.md](docs/architecture.md) for the system overview
- [docs/SPEC.md](docs/SPEC.md) for rules, formulas, and invariants
- [docs/FLOWS.md](docs/FLOWS.md) for execution details
- [docs/operators.md](docs/operators.md) for operator-owner behavior
