# Emergency Rollback Procedure

This runbook covers emergency rollback after the v2.0.0 deployment is live.

In this repository, "rollback" means switching the active module or proxy implementation to a previously validated implementation or to a patched implementation. It does **not** rewind storage or undo already-mined user transactions.

Use this document together with [deployments/README.md](./README.md) and [scripts/deployment.md](../scripts/deployment.md).

## Scope

This procedure covers:

- `SSVNetwork.updateModule(moduleId, moduleAddress)` for delegated modules
- `SSVNetwork.upgradeTo(newImplementation)` for the network proxy shell
- `SSVNetworkViews.upgradeTo(newImplementation)` for the views proxy wrapper

This procedure does **not** provide a safe path to revert the whole protocol back to the pre-v2 system state. Once v2-only state transitions happen on-chain, a true downgrade to pre-v2 behavior is not supported by this repository.

## Emergency Triggers

Run this procedure when at least one of the following is true:

- A live bug can move, lock, mis-account, or burn user ETH/SSV incorrectly.
- A delegated module is reverting valid flows for operators, cluster owners, or stakers.
- `SSVNetworkViews` or the `SSVViews` module returns invalid production values.
- A governance/configuration change introduced a critical wrong value that cannot wait for a normal release cycle.
- A post-upgrade incident requires immediate containment and replacement of one or more live implementations.

## Owners And Artifacts

Before any action, confirm the owner addresses and the last known-good implementation addresses.

| Item | Source |
|---|---|
| `SSVNetwork` owner | `owner()` on the network proxy |
| `SSVNetworkViews` owner | `owner()` on the views proxy |
| Last known-good module addresses | `deployments/<env>/deploy-result.json`, `deployments/<env>/upgrade-result.<version>.json`, Safe proposal history |
| Last known-good proxy implementations | same files under `deployments/<env>/` |
| Live `cssvToken` address | `deployments/<env>/config.json` or latest upgrade result |
| Live `upgradeTimestamp` for `SSVOperators` | `deployments/<env>/config.json` or latest upgrade result |

If the mainnet owner is a Safe, the live rollback must be executed as Safe transactions. Do not assume an EOA signer path exists on mainnet.

## There Is No Pause Switch

There is no global on-chain pause or circuit-breaker in this codebase.

Public state-changing entrypoints remain callable until the replacement transaction is mined.

## Choose The Smallest Safe Action

| Incident scope | Preferred action | Transaction target |
|---|---|---|
| Bug isolated to one delegated module | Replace only that module | `SSVNetwork.updateModule` |
| Bug spans several delegated modules or a shared library used by them | Replace all affected modules in one batch | `SSVNetwork.updateModule` for each module |
| Bug isolated to the read-only views wrapper proxy | Roll back only the views proxy implementation | `SSVNetworkViews.upgradeTo` |
| Bug in the network proxy shell, selector routing, or proxy implementation logic | Roll back or hotfix the network proxy implementation | `SSVNetwork.upgradeTo` |
| Pure configuration mistake | Use the relevant owner setter, not module rollback | `updateNetworkFee`, `setQuorumBps`, etc. |

Use a patched v2-compatible implementation whenever possible. Do not attempt a full v2-to-v1 downgrade unless a separate migration plan was audited and rehearsed.

## Module Map

Use these module IDs when building Safe transactions for `updateModule(uint8,address)`.

| Module ID | Module | Main surface | Compatibility note |
|---|---|---|---|
| `0` | `SSVOperators` | operator registration, fee changes, earnings withdrawals | Target implementation must be deployed with the correct `upgradeTimestamp` constructor arg |
| `1` | `SSVClusters` | cluster deposit/withdraw/liquidate/migrate/updateClusterBalance | Funds-moving path; prefer smallest hotfix batch |
| `2` | `SSVDAO` | governance setters, oracle replacement, network withdrawals | Target implementation must use the live `cssvToken` constructor arg |
| `3` | `SSVViews` | delegated view logic behind `SSVNetwork` fallback | Distinct from the `SSVNetworkViews` proxy wrapper |
| `4` | `SSVOperatorsWhitelist` | whitelist management | No constructor args |
| `5` | `SSVStaking` | stake, unstake, reward claims, cSSV transfer hook | Target implementation must use the live `cssvToken` constructor arg |
| `6` | `SSVValidators` | register/remove/exit validator flows | No constructor args |

## Rollback Procedure

### 1. Triage The Incident

- Identify the exact failing entrypoint, selector, or invariant.
- Decide whether the issue lives in a delegated module, the network proxy implementation, the views proxy wrapper, or only in configuration.
- Decide whether a single-module rollback is enough or whether multiple implementations must change together.

### 2. Pick The Target Addresses

- Pull the last known-good addresses from the latest relevant file under `deployments/<env>/`.
- If using a patched implementation, make sure it was compiled from the exact branch/revision approved for the incident response.
- For `SSVDAO`, `SSVViews`, and `SSVStaking`, verify the target implementation was deployed with the live `cssvToken` address.
- For `SSVOperators`, verify the target implementation was deployed with the live `upgradeTimestamp`.
- Never point `updateModule` to an EOA or an address with no code. `CoreLib.setModuleContract` rejects that.

### 3. Rehearse On A Fork

Rehearse the exact rollback before touching a live network.

For a delegated module rollback on a local fork:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --port 8545
just attach-module SSVClusters 0xKNOWN_GOOD_MODULE 0xNETWORK_PROXY local
```

For a config-only verification pass after rehearsal:

```bash
npx tsx scripts/upgrade.ts --env mainnet --verify-only --network local
```

The fork rehearsal must confirm:

- the rollback transaction succeeds with the real owner authority model
- affected read paths and write paths behave as expected after replacement
- no additional initializer call is required for a proxy rollback unless the replacement was explicitly designed for one

### 4. Build The Mainnet Transaction Set

For mainnet Safe execution, use the smallest transaction set that removes the broken code path.

Safe transaction signatures:

```solidity
updateModule(uint8 moduleId, address moduleAddress)
upgradeTo(address newImplementation)
```

Execution rules:

- If the incident is in a delegated module, batch only the affected `updateModule` calls.
- If the incident is in the network proxy shell, call `SSVNetwork.upgradeTo(...)`.
- If the incident is only in the views proxy wrapper, call `SSVNetworkViews.upgradeTo(...)`.
- After the v2 initializer has already run, prefer `upgradeTo`, not `upgradeToAndCall`.
- Only use `upgradeToAndCall` during rollback if the replacement implementation was explicitly designed to require a new one-time initializer and that path was rehearsed on a fork.

### 5. Execute

- Get sign-off from the incident owner and the Safe signers on the exact target addresses.
- Publish a short pre-execution notice saying the protocol has no pause switch and users should avoid affected functions until the rollback transaction is mined.
- Submit and monitor the Safe transaction until it is confirmed.
- Record block number, transaction hash, replaced addresses, and operator-facing impact.

### 6. Verify After Execution

Complete all of the following immediately after mining:

- Check transaction success in the explorer.
- For module swaps, confirm the expected `ModuleUpgraded` event was emitted for each changed module.
- Run incident-specific smoke tests against the live network.
- Run `scripts/upgrade.ts --verify-only` if the rollback keeps the expected config values unchanged.
- Verify `getVersion()` on both `SSVNetwork` and `SSVNetworkViews` if either proxy implementation changed.
- Verify the exact user flow that triggered the incident now behaves correctly.

## Recoverable vs Irrecoverable State

### Recoverable By Owner Action

- Active module pointers in `SSVNetwork`
- `SSVNetwork` proxy implementation
- `SSVNetworkViews` proxy implementation
- Governance/config parameters controlled by DAO owner setters
- Oracle addresses and quorum values

### Not Reversible By Rollback

- ETH or SSV already transferred out of the protocol
- Operator earnings withdrawals already executed
- Cluster deposits, withdrawals, liquidations, or reactivations already mined
- `migrateClusterToETH` transitions already executed
- Validator registrations, removals, and exits already mined
- Oracle roots already committed
- `updateClusterBalance` writes already applied
- cSSV minting and burning history
- unstake requests already created
- emitted events and off-chain indexing side effects

### Special Limitation

`CSSVToken` is a regular ERC-20 contract, not a UUPS proxy. If an incident requires changing `CSSVToken` logic, this runbook is not sufficient; that requires a separate migration plan.

## Communication Plan

Use three public messages.

### 1. Initial Incident Notice

Publish immediately after containment starts:

- incident summary
- affected functions or user groups
- explicit instruction to avoid affected flows
- statement that no global pause exists
- time of next update

### 2. Pre-Execution Notice

Publish once the rollback transaction is ready:

- target contracts/modules
- whether this is a module swap or proxy implementation rollback
- expected user-visible impact
- expected execution window

### 3. Completion Notice

Publish after the transaction is mined:

- transaction hash
- replaced implementation/module addresses
- whether users may resume activity
- any residual restrictions or follow-up actions

## Recommended Postmortem Data To Save

Capture these items in the incident record:

- incident start time
- affected module(s) or proxy implementation(s)
- pre-rollback target addresses
- post-rollback target addresses
- Safe transaction hash
- verification commands and outputs
- user communication timestamps

