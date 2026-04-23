# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | Local development | [Roles](roles.md) | [Operator owners](operators.md)
### [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Local development

This repository supports both fresh local deployments and fork-based validation of real environment configs.

## Fresh local deployment

Use the local deployment config and deploy everything from scratch:

```bash
just deploy-fresh local
```

This is the quickest way to get a complete local protocol instance with the v2 module set.

## Fork-based upgrade validation

The preferred way to validate an environment upgrade is to run it on a local fork and then execute the strict fork tests.

Example:

```bash
anvil --fork-url "$HOODI_RPC_URL" --port 8545
just upgrade-test-fork hoodi-stage
```

Other useful variants:

```bash
just upgrade-fork hoodi-stage
just test-fork hoodi-stage
just smoke-test hoodi-stage
```

## Environment sources of truth

- `deployments/<env>/config.json` defines the intended configuration for that environment
- `deployments/<env>/deploy-result*.json` stores deployment outputs
- `deployments/<env>/upgrade-result*.json` stores upgrade outputs

For the detailed schema and expected artifacts, use [deployments/README.md](../deployments/README.md).

## Verification and explorer flows

This repo keeps explorer verification and post-upgrade config verification as script-driven workflows rather than documenting long manual steps here.

Use:

- [deployments/README.md](../deployments/README.md) for env-aware deployment and verification flows
- [scripts/deployment.md](../scripts/deployment.md) for concise script examples

## Troubleshooting

- If an env-driven command fails early, check that `.env` has the required RPC URL and signer key for that environment.
- If fork tests cannot find deployed state, confirm Anvil is running on `127.0.0.1:8545` and that the chosen env config matches the forked network.
- If verification output looks stale, rerun the relevant deploy or upgrade flow so the latest result artifact is regenerated.
