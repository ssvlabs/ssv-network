# Safe Upgrade Fork Simulation Playbook

## Purpose

This document describes how to simulate the exact queued SAFE upgrade transaction for the SSV Network mainnet upgrade on a local mainnet fork.

The goal is to validate the real SAFE execution path, not a simplified owner-direct upgrade flow. The simulation:

- executes the queued SAFE transaction through `execTransaction`
- impersonates the required SAFE owners on a local fork
- verifies the post-upgrade on-chain state
- writes an `upgrade-result`-compatible output file
- runs the fork integration suite against the upgraded fork state

This playbook is aligned with:

- `deployments/mainnet/config.json`
- `deployments/mainnet/deploy-result.json`
- `deployments/mainnet/multisig-batch.json`
- `scripts/simulate-safe-upgrade.ts`
- `scripts/run-forked-tests.ts`

## Current Mainnet Scope

For the current `v1.2.0 -> v2.0.0` mainnet upgrade flow in this repository:

- SAFE address: `0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6`
- queued SAFE nonce: `606`
- SSVNetwork proxy: `0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`
- SSVNetworkViews proxy: `0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4`
- MultiSend target: `0x40A2aCCbd92BCA938b02010E17A5b8929b49130D`

The queued SAFE transaction is expected to be a `delegatecall` to `MultiSend`, containing the same `24` inner calls as `deployments/mainnet/multisig-batch.json`.

## Current Config Snapshot

The current repository config for this simulation is:

```json
{
  "currentVersion": "v1.2.0",
  "targetVersion": "v2.0.0",
  "skipInitializer": false,
  "owner": "0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6",
  "ssvNetworkProxy": "0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1",
  "ssvNetworkViews": "0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4",
  "ssvToken": "0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54",
  "cooldownDuration": 604800,
  "upgradeTimestamp": 1774351800,
  "quorumBps": 7500,
  "defaultOracleIds": [1, 2, 3, 4],
  "protocolParams": {
    "networkFeeEth": "3557600000",
    "maxOperatorEthFee": "5336500000",
    "minOperatorEthFee": "10000000",
    "minimumLiquidationCollateralEth": "644852000000000",
    "liquidationThresholdPeriod": "21480",
    "minBlocksBetweenUpdates": "0",
    "minimumLiquidationCollateralSSV": "673652000000000000",
    "liquidationThresholdPeriodSSV": "50120"
  },
  "initialStakeAmount": "1000000000000000000",
  "oracles": {
    "1": "0xc61f7bd9ee5a3d011caf47aa0e5411f720593920",
    "2": "0xc07332e05cec1c4896555a6d10361233fdf14422",
    "3": "0x28bEa5B242362974d5DDb8f17a1E0e525446960B",
    "4": "0x3A98EE5f80268Ed91F8A5880d93468b76a9F3bB4"
  }
}
```

## Current Deployment Snapshot

The currently committed deployment output for the same upgrade is:

```json
{
  "deployer": "0x3187a42658417a4d60866163A4534Ce00D40C0C8",
  "chainId": "1",
  "network": "mainnet",
  "deployedAt": "2026-03-23T09:03:25.491Z",
  "blockNumber": 24719200,
  "implementations": {
    "SSVNetworkSSVStakingUpgrade": "0x93029DC6F03c951f353E51a8f16f722CAa210e5f",
    "SSVNetworkViews": "0x98FEBF8824028A212875d797aBa88362A9B11cc9"
  },
  "cssvToken": {
    "address": "0xe018D31F120A637828F46aFD6c64EC099d960546",
    "deployed": true
  },
  "modules": {
    "SSVOperators": "0x338554A41b6a2Ec9325157C01666AD8b0ACe6060",
    "SSVClusters": "0xf26bFC86210e9b53f95F4DFDBdEd4B2A42e792ED",
    "SSVDAO": "0x8AB722746a83eAE7158e55d43dc4aDe5bb9E0212",
    "SSVViews": "0x055051fa508EEdA80c38De34CA936aBa59642C45",
    "SSVOperatorsWhitelist": "0xd302E99feE1BAB03824Ce9aE20c6c578908CcFa5",
    "SSVStaking": "0x1B844e7abB9779f551dDcCb5f0f34A54eC1c7034",
    "SSVValidators": "0xB1E718d775811af33382eF9850a8C2CA1097c8fB"
  }
}
```

## Source of Truth

Use the following inputs together:

- `deployments/mainnet/config.json`
- `deployments/mainnet/deploy-result.json`
- `deployments/mainnet/multisig-batch.json`
- the queued SAFE transaction JSON exported from the SAFE UI or transaction service

The queued SAFE transaction JSON must contain these fields:

- `to`
- `data`
- `value`
- `operation`
- `baseGas`
- `gasPrice`
- `gasToken`
- `nonce`
- `refundReceiver`
- `safeTxGas`

The simulation script treats the queued SAFE transaction JSON as the execution source of truth and uses `multisig-batch.json` as a consistency check on the decoded inner calls.

## Preconditions

Complete all of the following before running the simulation:

1. Install project dependencies.
2. Ensure the repository is on the release candidate code intended for the upgrade.
3. Confirm `deployments/mainnet/config.json`, `deploy-result.json`, and `multisig-batch.json` are up to date.
4. Save the queued SAFE transaction JSON to a local file.
5. Start a writable local mainnet fork on `127.0.0.1:8545`.
6. Make sure the fork is at a pre-execution state where:
   - the SAFE still has nonce `606`
   - `SSVNetwork.getVersion()` still reports `v1.2.0`
   - the queued SAFE transaction has not already been executed on that fork state

## Step 1: Start the Local Mainnet Fork

Run Anvil against mainnet:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --port 8545
```

If you need deterministic replay, pin a specific block:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --fork-block-number <block> --port 8545
```

The simulation script expects a writable fork at:

```text
http://127.0.0.1:8545
```

## Step 2: Save the Queued SAFE Transaction JSON

Store the queued SAFE transaction object locally, for example:

```text
deployments/mainnet/safe-tx.nonce-606.json
```

The JSON should represent the actual queued transaction, not a reconstructed approximation.

## Step 3: Run the SAFE Simulation

Recommended command:

```bash
just simulate-safe-upgrade mainnet deployments/mainnet/safe-tx.nonce-606.json
```

Equivalent direct command:

```bash
npx tsx scripts/simulate-safe-upgrade.ts \
  --env mainnet \
  --tx-file deployments/mainnet/safe-tx.nonce-606.json \
  --network local \
  --output deployments/mainnet/safe-simulation-result.nonce-606.json
```

Optional flags:

- `--skip-fork-tests true`
  Use this if you only want SAFE execution plus post-upgrade verification without running the behavioral fork suite.
- `--test <path>`
  Use this to run a narrower fork test file instead of the default full integration fork suite.

## What the Script Does

The simulation flow performs the following steps:

1. Loads `config.json`, `deploy-result.json`, `multisig-batch.json`, and the queued SAFE transaction JSON.
2. Decodes the SAFE transaction `data` as `multiSend(bytes)`.
3. Verifies that the decoded inner calls match the repository batch by count, order, target, value, and calldata.
4. Reads `getOwners()`, `getThreshold()`, and `nonce()` from the SAFE on the local fork.
5. Verifies the fork is still in the expected pre-upgrade state.
6. Selects the first `threshold` SAFE owners returned by `getOwners()`.
7. Impersonates those owners on the fork and calls `approveHash(safeTxHash)` for each of them.
8. Builds SAFE pre-validated signature bytes.
9. Executes the exact queued transaction via `execTransaction`.
10. Confirms the SAFE emits `ExecutionSuccess` and increments nonce from `606` to `607`.
11. Verifies:
    - `SSVNetwork` version
    - `SSVNetworkViews` readability
    - ERC-1967 implementation addresses
    - module pointers
    - cSSV token address
    - protocol parameters
    - oracle set, quorum, cooldown
    - initial stake / cSSV supply effects
12. Writes an `upgrade-result`-compatible JSON output file.
13. Runs fork integration tests against the upgraded local fork state.

## Output Files

The script writes:

```text
deployments/mainnet/safe-simulation-result.nonce-606.json
```

This file is intentionally shaped like `upgrade-result.json`, with an additional `simulation` block containing:

- `safeAddress`
- `safeTxHash`
- `safeNonce`
- `postExecutionSafeNonce`
- `selectedApprovers`
- `executionBlock`
- `receiptHash`

This output can be consumed directly by the existing fork test runner.

## Success Criteria

The simulation is considered successful only if all of the following hold:

- the SAFE transaction decodes correctly as `multiSend(bytes)`
- the decoded inner calls match `deployments/mainnet/multisig-batch.json`
- `execTransaction.staticCall(...)` returns `true`
- the real `execTransaction(...)` succeeds
- the SAFE nonce moves from `606` to `607`
- `SSVNetwork.getVersion()` reports `v2.0.0`
- proxy implementation addresses match `deploy-result.json`
- module pointers match `deploy-result.json`
- shared post-upgrade verification passes without mismatches
- the fork integration suite passes

## Troubleshooting

### Safe nonce mismatch

Symptom:

```text
Safe nonce mismatch: expected 606, got <other>
```

Cause:

- the fork is too new
- the transaction was already executed on the fork source state
- the wrong SAFE transaction JSON was provided

Action:

- restart the fork from a pre-execution block
- verify the queued transaction really belongs to nonce `606`

### MultiSend batch mismatch

Symptom:

```text
inner call <n> calldata mismatch
```

Cause:

- the queued SAFE transaction differs from the repository batch
- `deploy-result.json` or `multisig-batch.json` is stale
- the wrong transaction JSON was exported

Action:

- regenerate and review `multisig-batch.json`
- compare the queued SAFE transaction against the current deployment artifacts

### `execTransaction.staticCall` fails or returns `false`

Cause:

- insufficient owner approvals
- wrong nonce
- wrong SAFE transaction fields
- fork state does not match the intended pre-execution state

Action:

- verify owners and threshold on-chain
- verify the transaction fields are identical to the queued SAFE tx
- re-check the fork block and source RPC

### Post-upgrade verification mismatch

Cause:

- config drift
- wrong deployment artifacts
- wrong queued SAFE transaction
- unexpected fork state

Action:

- re-check `config.json`, `deploy-result.json`, and the queued tx JSON as one set

### Fork tests fail after a successful SAFE execution

Cause:

- the upgrade path is correct, but the upgraded behavior regresses
- the fork test suite is using a stale config file

Action:

- inspect the generated `safe-simulation-result.nonce-606.json`
- rerun:

```bash
npx tsx scripts/run-forked-tests.ts \
  --config deployments/mainnet/safe-simulation-result.nonce-606.json \
  --fork-network hardhat_forked \
  --use-deployed-state true \
  --strict-deployed-state true \
  --allow-deployed-fallback false \
  --no-gas-enforce true
```

with:

```bash
MAINNET_RPC_URL=http://127.0.0.1:8545
```

## Recommended Operator Workflow

For the current mainnet release, the recommended dry-run sequence is:

1. `just deploy mainnet`
2. `just generate-safe-batch mainnet`
3. export or copy the queued SAFE transaction JSON
4. start a local mainnet fork
5. `just simulate-safe-upgrade mainnet <tx-file>`
6. review the generated simulation result file
7. deliver the SAFE batch and attestation to the multisig committee only after the fork simulation passes

## Related Documents

- [UPGRADE_PLAYBOOK.md](./UPGRADE_PLAYBOOK.md)
- [../deployments/README.md](../deployments/README.md)
