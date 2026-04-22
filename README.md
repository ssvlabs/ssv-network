# SSV Network Smart Contracts

### Intro | [Architecture](./docs/architecture.md) | [Setup](./docs/setup.md) | [Tasks](./docs/tasks.md) | [Local development](./docs/local-dev.md) | [Roles](./docs/roles.md) | [Operator owners](./docs/operators.md)
### Deep docs | [Specification](./docs/SPEC.md) | [Flows](./docs/FLOWS.md) | [Mainnet upgrade playbook](./docs/UPGRADE_PLAYBOOK.md) | [Deployments](./deployments/README.md)

This repository contains the Solidity smart contracts for the SSV Network `v2.0.0`.

The upgraded system keeps the modular SSV Network architecture while adding ETH-based fee accounting for new clusters, effective-balance-aware charging, an oracle-driven effective balance update flow, SSV staking through `cSSV`, and one-way migration for legacy SSV clusters.

The documentation is divided into different sections:

- **Architecture** explains the system layout, the contract modules, the v2 feature set, the legacy-to-ETH migration model, and the main design assumptions to keep in mind.
- **Setup** covers local prerequisites, environment configuration, and the minimum steps needed to compile and test the repository.
- **Tasks** lists the `just` recipes used for day-to-day development, testing, deployment support, and verification.
- **Local development** focuses on local deployment, fork-based upgrade validation, smoke tests, and where environment-specific configuration lives.
- **Roles** summarizes the operational actors in the system, including the owner, deployer, oracle set, operator owners, cluster owners, and stakers.
- **Operator owners** documents operator registration, privacy and whitelisting, ETH fee management, and earnings withdrawal.
- **Specification / Flows** remain the deep technical source of truth for rules, invariants, and exact execution behavior.

## Quick start

```bash
npm install
cp .env.example .env
just build
just test-unit
```

For environment-driven deployments, upgrades, SAFE batch generation, and post-upgrade verification, use [deployments/README.md](./deployments/README.md).

## Repository map

- `contracts/` core contracts, modules, storage libraries, interfaces, and upgrade entrypoints
- `contracts/modules/` protocol logic split across operators, clusters, validators, DAO, staking, views, and whitelisting modules
- `contracts/upgrades/mainnet/` dedicated upgrade implementation used for the v2 mainnet rollout
- `deployments/` per-environment config, results, attestations, and SAFE batch artifacts
- `scripts/` deployment, upgrade, verification, and support scripts used by the `just` recipes
- `test/` unit, integration, fork, sanity, and Echidna test suites

## SSV documentation

Check the official [SSV Network smart contracts documentation](https://docs.ssv.network/developers/smart-contracts) for protocol-facing documentation, releases, and higher-level integration guidance.

## How to contribute

### Join the builders

Start getting familiar with DVT staking in the [SSV Discord](https://discord.gg/5vT22pRBrf) and use the `#dev-support` channel for protocol and repository questions.

### Suggest improvements

If you have an improvement for the contracts, tests, or deployment flow, open an issue or PR and include the protocol or operational context behind the suggestion.

## Bug bounty program

SSV Network runs its smart contract bug bounty program through [Immunefi](https://immunefi.com/bounty/ssvnetwork/).

If you believe you found a vulnerability, report it through the [SSV Network Immunefi page](https://immunefi.com/bounty/ssvnetwork/). Follow the program rules there to stay eligible for review and rewards.
