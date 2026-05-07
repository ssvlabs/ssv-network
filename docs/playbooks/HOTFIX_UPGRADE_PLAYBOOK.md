# Mainnet Module Hotfix Playbook

## Purpose

This document describes the operational runbook for a mainnet SSV Network hotfix that deploys and attaches only two modules:

- `SSVClusters`
- `SSVValidators`

The hotfix does not upgrade the `SSVNetwork` proxy implementation, does not upgrade `SSVNetworkViews`, does not change protocol parameters, and does not move tokens. The SAFE batch must contain exactly two calls:

```solidity
SSVNetwork.updateModule(1, <new SSVClusters>)
SSVNetwork.updateModule(6, <new SSVValidators>)
```

## Roles and Responsibilities

### SSV Labs

- Validate the hotfix code and compiled artifacts.
- Deploy the two new module implementations on Ethereum mainnet.
- Generate the hotfix SAFE Transaction Builder JSON.
- Generate the hotfix deployment attestation with bytecode hashes.
- Deliver the module addresses, attestation, SAFE batch, and file hashes to the SAFE committee.
- Run post-execution checks against a fork of the updated mainnet state.

### SAFE Multisig Committee

- Review the hotfix scope and confirm it is limited to two `updateModule` calls.
- Verify the two module addresses and bytecode hashes from the attestation.
- Import the hotfix SAFE batch into SAFE Transaction Builder.
- Sign and execute the batch on Ethereum mainnet.

## Source of Truth

For this hotfix, the source files are:

- Config: `deployments/mainnet/config.json`
- Hotfix attestation: `deployments/mainnet/hotfix-deployment-attestation.json`
- Hotfix SAFE batch: `deployments/mainnet/hotfix-multisig-batch.json`

Do not use `deployments/mainnet/multisig-batch.json` for this hotfix. That file is for the full major-upgrade flow and may include proxy upgrades, all module updates, parameter updates, oracle replacements, approval, and stake calls.

## Preconditions

Complete these checks before touching mainnet:

1. Confirm the release branch/commit contains only the intended hotfix changes for `SSVClusters` and `SSVValidators`.
2. Confirm `deployments/mainnet/config.json` has the correct `owner` SAFE and `ssvNetworkProxy`.
3. Confirm `MAINNET_PRIVATE_KEY` is set for the SSV Labs deployer account.
4. Confirm the deployer account has enough ETH to deploy `SSVClusters` and `SSVValidators`.
5. Run the relevant local tests and fork validation for the hotfix.
6. Confirm the committee execution window and the expected SAFE nonce.
7. Prepare a mainnet fork after execution for the smoke test.

## Step 1: Deploy Hotfix Modules on Mainnet

SSV Labs deploys only the two module contracts:

```bash
just deploy-module SSVClusters mainnet
just deploy-module SSVValidators mainnet
```

Capture the printed addresses:

```bash
SSV_CLUSTERS_MODULE=<deployed SSVClusters address>
SSV_VALIDATORS_MODULE=<deployed SSVValidators address>
```

Optional Etherscan verification:

```bash
just verify "$SSV_CLUSTERS_MODULE" mainnet
just verify "$SSV_VALIDATORS_MODULE" mainnet
```

## Step 2: Generate the Hotfix SAFE Batch

Generate the SAFE Transaction Builder JSON from the two deployed module addresses:

```bash
just generate-hotfix-safe-batch mainnet "$SSV_CLUSTERS_MODULE" "$SSV_VALIDATORS_MODULE"
```

This writes:

```text
deployments/mainnet/hotfix-multisig-batch.json
```

Expected batch contents:

1. `SSVNetwork.updateModule(1, SSV_CLUSTERS_MODULE)`
2. `SSVNetwork.updateModule(6, SSV_VALIDATORS_MODULE)`

The command prints the `keccak256` file hash of `hotfix-multisig-batch.json`. Preserve that hash for committee review.

## Step 3: Generate the Hotfix Attestation

Generate the hotfix deployment attestation:

```bash
just generate-hotfix-attestation mainnet "$SSV_CLUSTERS_MODULE" "$SSV_VALIDATORS_MODULE"
```

This writes:

```text
deployments/mainnet/hotfix-deployment-attestation.json
```

The attestation includes:

- generated timestamp
- network and chain ID
- `SSVNetwork` proxy address
- SAFE owner address
- `SSVClusters` module ID and address
- `SSVValidators` module ID and address
- on-chain runtime bytecode hash for each module
- intended SAFE transactions
- `hotfix-multisig-batch.json` hash, if the batch already exists

To independently verify each bytecode hash:

```bash
cast keccak $(cast code "$SSV_CLUSTERS_MODULE" --rpc-url "$MAINNET_RPC_URL")
cast keccak $(cast code "$SSV_VALIDATORS_MODULE" --rpc-url "$MAINNET_RPC_URL")
```

## Step 4: SAFE Committee Review and Execution

The multisig committee should:

1. Import `deployments/mainnet/hotfix-multisig-batch.json` into SAFE Transaction Builder.
2. Confirm the SAFE address matches `deployments/mainnet/config.json` `owner`.
3. Confirm both transaction targets are the `SSVNetwork` proxy from `deployments/mainnet/config.json`.
4. Decode and review the calldata.
5. Confirm transaction 1 is `updateModule(1, <new SSVClusters>)`.
6. Confirm transaction 2 is `updateModule(6, <new SSVValidators>)`.
7. Confirm there are no `upgradeTo`, `upgradeToAndCall`, parameter setter, oracle, token approval, stake, or ETH transfer calls.
8. Verify the module addresses and bytecode hashes against `hotfix-deployment-attestation.json`.
9. Sign and execute the batch on mainnet.

After execution, preserve the SAFE transaction hash and the emitted `ModuleUpgraded` events for module IDs `1` and `6`.

## Step 5: Post-Execution Checks

After the SAFE batch executes, run a smoke test against a fork of the just-updated mainnet state:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --port 8545
just smoke-test mainnet local
```

The smoke test exercises the main user flows through the current mainnet proxy and therefore validates that calls delegated through the newly attached `SSVClusters` and `SSVValidators` modules still work end to end.

Recommended additional checks:

```bash
just verify-upgrade mainnet
```

`verify-upgrade` confirms the configured protocol state still matches `deployments/mainnet/config.json`. It does not independently read module pointers, so the module-pointer evidence for this hotfix is the SAFE execution calldata, the `ModuleUpgraded` events, and the successful fork smoke test.

## Artifacts to Preserve

Archive the following:

- deployed `SSVClusters` address and transaction hash
- deployed `SSVValidators` address and transaction hash
- `deployments/mainnet/hotfix-deployment-attestation.json`
- `deployments/mainnet/hotfix-multisig-batch.json`
- printed `keccak256` file hashes
- SAFE transaction hash
- `ModuleUpgraded` logs for module IDs `1` and `6`
- post-execution smoke test output

## Failure and Abort Conditions

Abort the hotfix if any of the following occurs:

- Either deployed module address has no code on mainnet.
- The generated SAFE batch contains anything other than the two expected `updateModule` calls.
- The SAFE target address is not the mainnet `SSVNetwork` proxy.
- Module ID `1` does not point to the new `SSVClusters` address.
- Module ID `6` does not point to the new `SSVValidators` address.
- The committee cannot independently match the bytecode hashes.
- The imported SAFE batch differs from the generated JSON or printed file hash.

If execution fails or only partially executes, stop and reconcile the executed transaction logs before preparing any replacement batch.

## Mainnet Command Summary

SSV Labs:

```bash
just deploy-module SSVClusters mainnet
just deploy-module SSVValidators mainnet

SSV_CLUSTERS_MODULE=<deployed SSVClusters address>
SSV_VALIDATORS_MODULE=<deployed SSVValidators address>

just generate-hotfix-safe-batch mainnet "$SSV_CLUSTERS_MODULE" "$SSV_VALIDATORS_MODULE"
just generate-hotfix-attestation mainnet "$SSV_CLUSTERS_MODULE" "$SSV_VALIDATORS_MODULE"

# After SAFE execution:
anvil --fork-url "$MAINNET_RPC_URL" --port 8545
just smoke-test mainnet local
```

SAFE committee:

1. Import `deployments/mainnet/hotfix-multisig-batch.json`.
2. Review exactly two `updateModule` calls.
3. Sign.
4. Execute.
