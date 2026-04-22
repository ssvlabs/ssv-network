# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | Setup | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | [Operator owners](operators.md)
### [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Developer setup

This repository uses Solidity, Hardhat, TypeScript scripts, npm dependencies, and `just` recipes as the main local workflow.

## Prerequisites

- Node.js LTS
- npm
- [`just`](https://github.com/casey/just) for running the repository workflows

Optional but useful:

- Anvil for fork-based testing and upgrade validation
- Slither for static analysis
- Echidna for invariant fuzzing

## Install dependencies

```bash
npm install
```

## Configure the environment

Copy the example file and fill in the values needed for the environments you use:

```bash
cp .env.example .env
```

Common variables:

- `MAINNET_RPC_URL` and `HOODI_RPC_URL` for RPC access
- `MAINNET_PRIVATE_KEY` and `HOODI_PRIVATE_KEY` for live owner or deployer actions
- `ETHERSCAN_KEY` for block-explorer verification

The environment-specific deployment source of truth lives under `deployments/<env>/config.json`. The `.env` file mainly supplies RPC and signer credentials.

## Compile and test

```bash
just build
just test-unit
```

Useful next steps:

- See [tasks.md](tasks.md) for the full `just` recipe list
- See [local-dev.md](local-dev.md) for local deployment and fork flows
- See [deployments/README.md](../deployments/README.md) for environment-driven deployment and upgrade workflows
