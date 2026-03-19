# Deployments

Per-environment deployment configs and results for SSV Network.

## Environments

| Env | Network | Owner | Purpose |
|---|---|---|---|
| `mainnet` | Ethereum L1 | SAFE multi-sig | Production |
| `hoodi-prod` | Hoodi | Dev team | Stable testnet, mirrors mainnet flow |
| `hoodi-stage` | Hoodi | Dev team | Experimental / staging |
| `local` | Hardhat/Anvil | Dev team | Local dev and testing |

Each env directory contains:
```
<env>/
  config.json                    # Input — edit this
  deploy-result.json             # Symlink → deploy-result.<version>.json (latest)
  deploy-result.v2.0.0.json      # Versioned output of `just deploy`
  upgrade-result.json            # Symlink → upgrade-result.<version>.json (latest)
  upgrade-result.v2.0.0.json     # Versioned output of `just upgrade`
  multisig-batch.json            # SAFE Transaction Builder JSON (mainnet)
```

Result files are versioned by the contract's `getVersion()` string. The fixed-name symlinks always point to the latest. Old versioned files are preserved for traceability.

## Quick Start

```bash
# Fork + test before any live upgrade
anvil --fork-url "$HOODI_RPC_URL" --port 8545
just upgrade-test-fork hoodi-stage   # upgrade on fork, then run tests

# Live upgrade (hoodi-stage / hoodi-prod)
just upgrade hoodi-stage

# Mainnet: deploy impls first, then generate SAFE batch
just deploy mainnet
just generate-safe-batch mainnet     # -> mainnet/multisig-batch.json
# Import into SAFE Transaction Builder, review, sign

# Post-upgrade verification only
just verify-upgrade mainnet

# Fresh local deployment
just deploy-fresh local
```

## config.json

Copy `template-config.json` as a starting point.

| Field | Required | Description |
|---|---|---|
| `currentVersion` | **Required** | Version the proxy currently reports on-chain. Upgrade aborts if it doesn't match. |
| `targetVersion` | **Required** | Version the new implementation will report after upgrade. Used as the result file suffix (e.g. `upgrade-result.v2.0.1.json`). Can equal `currentVersion` for hotfixes. |
| `ssvNetworkProxy` | Required | SSVNetwork proxy address |
| `ssvNetworkViews` | Required | SSVNetworkViews proxy address |
| `ssvToken` | Required | SSV ERC-20 token address |
| `owner` | Optional | Defaults to on-chain `owner()` |
| `cooldownDuration` | Optional | Unstake cooldown in seconds (default: `604800` = 7 days) |
| `upgradeTimestamp` | Optional | `SSVOperators` constructor arg (default: `0`) |
| `quorumBps` | Optional | Oracle quorum in basis points (e.g. `7500` = 75%) |
| `defaultOracleIds` | Optional | Array of 4 oracle IDs (default: `[1,2,3,4]`) |
| `skipInitializer` | Optional | Set `true` for patch upgrades where `initializeSSVStaking` was already run. Uses `upgradeTo` instead of `upgradeToAndCall`. Default: `false`. |
| `cssvToken` | Optional | Reuse existing CSSVToken address; deploys new one if omitted |
| `oracles` | Optional | Oracle ID → address map |
| `protocolParams` | Optional | Governance parameters (see below) |

### protocolParams

```json
"protocolParams": {
  "networkFeeEth": "3550900000",
  "maxOperatorEthFee": "5326300000",
  "minOperatorEthFee": "1065200000",
  "minimumLiquidationCollateralEth": "940000000000000",
  "liquidationThresholdPeriod": "35800",
  "operatorFeeIncreaseLimit": "1000",
  "declareOperatorFeePeriod": "604800",
  "executeOperatorFeePeriod": "604800"
}
```

All values are strings or numbers (wei / blocks). **Omit any field to leave the on-chain value unchanged.**

### Version pre-flight

`upgrade.ts` reads `getVersion()` from the proxy before doing anything. If it doesn't match `config.currentVersion`, the script aborts:

```
Error: Version mismatch: config.currentVersion is "v2.0.0" but proxy reports "v1.9.0".
Wrong config or proxy address?
```

This prevents running the wrong config against the wrong proxy.

## Scripts

| Script | `just` recipe | Purpose |
|---|---|---|
| `deploy.ts` | `just deploy <env>` | Deploy impls + modules (no proxy upgrade) |
| `upgrade.ts` | `just upgrade <env>` | Upgrade proxy + attach modules + apply params |
| `upgrade.ts --fork` | `just upgrade-fork <env>` | Same, on local Anvil fork |
| `verify-post-upgrade-config.ts` | `just verify-upgrade <env>` or `just verify-post-upgrade-config <env>` | Read on-chain state, no writes |
| `generate-safe-batch.ts` | `just generate-safe-batch <env>` | Encode SAFE multisig batch |
| `deploy-fresh.ts` | `just deploy-fresh <env>` | Full greenfield deployment |
| `run-forked-tests.ts` | `just test-fork <env>` | Integration tests against fork |

## Troubleshooting

**Version mismatch** — Check `config.version` matches the current on-chain `getVersion()`. Update the field if you're upgrading to a new version.

**Owner mismatch** — Set `HOODI_PRIVATE_KEY` (or `MAINNET_PRIVATE_KEY`) in `.env` to the owner key, or use `--fork` to impersonate.

**No contract code** — Anvil must be running on `127.0.0.1:8545` and forked from the correct network.

**Stale result JSON** — Re-run `just upgrade-fork <env>` then `just test-fork <env>`.
