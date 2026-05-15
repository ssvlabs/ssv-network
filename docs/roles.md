# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | Roles | [Operator owners](operators.md) | [Operational guidance](operational-guidance.md)
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Protocol roles

The upgraded system has more operational roles than the earlier network versions because the protocol now includes oracle-fed effective balance accounting and staking.

## Contract owner

The contract owner is the governance authority over the deployed protocol. In production this is expected to be a SAFE multisig.

Owner-controlled responsibilities include:

- Upgrading `SSVNetwork` and `SSVNetworkViews`
- Updating attached module addresses through `updateModule`
- Updating protocol parameters such as network fees, operator fee bounds, liquidation thresholds, cooldowns, and EB update rate limits
- Replacing oracle addresses and updating quorum
- Withdrawing protocol-controlled SSV earnings and invoking owner-only recovery paths

The exact owner-only access surface is defined in [SPEC.md](SPEC.md).

## Deployer / release operator

The deployer is not a protocol role in the accounting model, but it is an operational role for this repository.

Typical deployer responsibilities:

- Deploying new implementations and modules
- Generating deployment attestations
- Generating SAFE batch payloads
- Running fork validation and post-upgrade verification

These workflows are documented in [deployments/README.md](../deployments/README.md) and [UPGRADE_PLAYBOOK.md](UPGRADE_PLAYBOOK.md).

## Oracle

Registered oracle addresses can submit effective-balance Merkle roots through `commitRoot`. Oracles do not own cluster funds, but they do affect when the on-chain system can consume fresh EB data.

Oracle administration remains owner-controlled through `replaceOracle` and `updateQuorumBps`.

## Operator owner

An operator owner controls a specific operator record and can:

- Register and remove operators
- Manage private/public status and whitelisting
- Declare, execute, reduce, or cancel operator fee changes
- Withdraw operator earnings in ETH or legacy SSV paths where applicable

Operator-specific details are documented in [operators.md](operators.md).

## Cluster owner

A cluster owner controls validator and cluster lifecycle actions for a cluster, including:

- Registering validators into ETH clusters
- Removing validators
- Signaling validator exit
- Depositing ETH, withdrawing ETH, and reactivating ETH clusters
- Migrating a legacy SSV cluster to ETH

Some actions are intentionally permissionless:

- `deposit` can be called by anyone on behalf of a cluster owner
- `updateClusterBalance` is permissionless when the caller has a valid proof against a committed root
- liquidation can be triggered by third parties when the protocol rules allow it

## Staker

Any address with SSV can stake into the protocol, receive `cSSV`, request unstake, withdraw unlocked SSV, and claim ETH rewards.

## Read-only integrator

Integrators and indexers generally consume the protocol through `SSVNetworkViews`. `SSVNetworkViews` is treated as the canonical consolidated read surface.
