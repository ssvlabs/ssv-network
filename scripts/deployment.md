# Deployment & Upgrade Guide

This project uses Just recipes and TypeScript scripts to deploy and upgrade SSV Network contracts.

For full documentation on environments, workflows, and config schema, see [`deployments/README.md`](../deployments/README.md).
For emergency response after a live deployment, see [`deployments/EMERGENCY-ROLLBACK.md`](../deployments/EMERGENCY-ROLLBACK.md).

## Quick Reference

### Fresh deployment (local/test)

```bash
just deploy-fresh local
```

Deploys everything from scratch: SSVToken (mock), all modules, SSVNetwork + proxy, SSVNetworkViews + proxy, CSSVToken, and runs the staking upgrade. Config is read from `deployments/local/config.json`.

### Deploy implementations (for mainnet/hoodi)

```bash
just deploy mainnet
```

Deploys implementations + modules only (no proxy upgrade). Writes `deployments/mainnet/deploy-result.json`.

### Fork validation

```bash
anvil --fork-url "$HOODI_RPC_URL" --port 8545
just upgrade-test-fork hoodi-stage
```

Runs upgrade on local fork and then executes strict fork tests.

### Live upgrade

```bash
just upgrade hoodi-stage
```

Requires the deployer private key to match the on-chain owner.

### Generate deployment attestation

```bash
just generate-attestation mainnet
```

Generates `deployments/mainnet/deployment-attestation.json` with bytecode hashes, deployer info, constructor args, and config snapshot for committee review.

### Generate SAFE multi-sig batch

```bash
just generate-safe-batch mainnet
```

Generates `deployments/mainnet/multisig-batch.json` for import into SAFE Transaction Builder.

### Verify on-chain state

```bash
just verify-upgrade mainnet
```

Reads `config.json` and verifies all on-chain values match expected parameters.

## One-off Utilities

### Upgrade a proxy (deploy new impl + upgrade)

```bash
just upgrade-contract SSVNetwork 0xPROXY hoodi
```

### Upgrade a proxy with pre-deployed implementation

```bash
just upgrade-contract SSVNetwork 0xPROXY hoodi 0xIMPL
```

### Deploy a single module

```bash
just deploy-module SSVOperators hoodi 12345
```

### Attach a pre-deployed module

```bash
just attach-module hoodi-stage SSVClusters 0xMODULE
```

## Important Notes

- **Storage safety**: Never add state variables to `SSVNetwork` or `SSVNetworkViews`. All state goes through diamond storage libraries.
- **UUPS pattern**: Upgrades use the [UUPS Proxy pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy).
- **Library changes**: When modifying a library, you must also redeploy all modules that use it.
- **Emergency response**: There is no global on-chain pause; rollback uses module replacement or proxy implementation replacement. Follow [`deployments/EMERGENCY-ROLLBACK.md`](../deployments/EMERGENCY-ROLLBACK.md).
