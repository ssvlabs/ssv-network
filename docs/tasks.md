# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | Tasks | [Local development](local-dev.md) | [Roles](roles.md) | [Operator owners](operators.md) | [Operational guidance](operational-guidance.md)
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Development workflows

This repository uses `just` recipes for day-to-day work. There are no Hardhat task workflows to document here.

## Core recipes

### Build and cleanup

```bash
just build
just clean
```

### Test suites

```bash
just test
just test-unit
just test-integration
just test-forked
just coverage
just sizes
```

### Environment-driven deployment and upgrade

```bash
just deploy-fresh local
just deploy hoodi-stage
just upgrade hoodi-stage
just upgrade-fork hoodi-stage
just test-fork hoodi-stage
just upgrade-test-fork hoodi-stage
just verify-upgrade hoodi-stage
just smoke-test hoodi-stage
```

### Mainnet release support

```bash
just deploy mainnet
just generate-attestation mainnet
just generate-safe-batch mainnet
just verify-upgrade mainnet
```

### One-off utilities

```bash
just deploy-module <module> <network> [args...]
just attach-module <env> <module> <module-address>
just upgrade-contract <contract> <proxy> <network> [impl]
just verify <address> <network>
just abis
```

## Where to find the full process docs

- For deployment environments, config schema, result artifacts, SAFE batches, and verification flows, use [deployments/README.md](../deployments/README.md).
- For quick operational examples around the deployment scripts, use [scripts/deployment.md](../scripts/deployment.md).
- For mainnet-specific upgrade sequencing, use [UPGRADE_PLAYBOOK.md](UPGRADE_PLAYBOOK.md).

## Notes

- Environment-specific values come from `deployments/<env>/config.json`.
- RPC URLs and signer keys come from `.env`.
- When changing shared libraries, treat dependent modules as part of the same upgrade surface and redeploy them together.
