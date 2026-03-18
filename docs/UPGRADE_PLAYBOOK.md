# Mainnet Upgrade Playbook

## Purpose

This document describes the operational runbook for upgrading the Ethereum mainnet SSV Network deployment from `v1.2.0` to `v2.0.0`.

It is specific to the production ownership model where:

- `SSVNetwork` is owned by a SAFE multisig.
- `SSVNetworkViews` is owned by the same SAFE multisig unless explicitly configured otherwise.
- SSV Labs deploys the new implementation contracts and prepares the SAFE batch.
- The multisig committee reviews, signs, and executes the upgrade transactions on SAFE.

This playbook is aligned with the repository deployment flow in `deployments/README.md` and the scripts:

- `just deploy mainnet`
- `just generate-safe-batch mainnet`
- `just verify-upgrade mainnet`

## Version Scope

- Current on-chain version: `v1.2.0`
- Target version: `v2.0.0`
- Legacy code reference: [`https://github.com/ssvlabs/ssv-network/tree/v1.2.0`](https://github.com/ssvlabs/ssv-network/tree/v1.2.0)
- Target code reference: [`https://github.com/ssvlabs/ssv-network/tree/v2.0.0`](https://github.com/ssvlabs/ssv-network/tree/v2.0.0)

## Roles and Responsibilities

### SSV Labs

- Prepare the final mainnet configuration in `deployments/mainnet/config.json`.
- Set the deployer key in `.env` as `MAINNET_PRIVATE_KEY`.
- Run the mainnet implementation deployment.
- Generate the SAFE Transaction Builder JSON from the deployed addresses and config values.
- Deliver the upgrade instructions, the generated SAFE batch JSON and the implementation addresses from the deployment result to the multisig committee.
- Run post-execution verification.

### SAFE Multisig Committee

- Review the upgrade instructions, implementation addresses and the generated SAFE batch JSON.
- Import the generated batch into SAFE Transaction Builder.
- Review every target address and parameter (DIP proposal).
- Sign and execute the batch on Ethereum mainnet.

## Source of Truth

For mainnet, the operational source of truth is:

- Config: `deployments/mainnet/config.json`
- Deployment output: `deployments/mainnet/deploy-result.json`
- SAFE batch output: `deployments/mainnet/multisig-batch.json`

`config.json` defines the intended upgrade parameters. `deploy-result.json` contains the freshly deployed implementation and module addresses. `multisig-batch.json` is generated from both and is the file to import into SAFE.

## Mainnet Configuration Template

Before deployment, populate `deployments/mainnet/config.json` with the intended mainnet values.

**Configure an `upgradeTimestamp` to be some future block**

```json
{
  "currentVersion": "v1.2.0",
  "targetVersion": "v2.0.0",
  "skipInitializer": false,
  "owner": "<multisig address>",
  "ssvNetworkProxy": "<mainnet SSVNetwork>",
  "ssvNetworkViews": "<mainnet SSVNetworkViews>",
  "ssvToken": "<mainnet SSV Token>",
  "cooldownDuration": 604800,
  "upgradeTimestamp": <target timestamp>,
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

Notes:

- `currentVersion` must match the version currently reported on-chain by the proxy. The scripts abort on mismatch.
- `skipInitializer` must remain `false` for the `v1.2.0 -> v2.0.0` mainnet upgrade so the staking initializer is executed through `upgradeToAndCall`.
- Any omitted `protocolParams` field is left unchanged on-chain.
- Oracle addresses must be finalized before generating the SAFE batch.

## Preconditions

Complete all of the following before touching mainnet:

1. Validate the release candidate code and contract artifacts for `v2.0.0`.
2. Finalize `deployments/mainnet/config.json`, including oracle addresses and target timestamps.
3. Confirm the SAFE address that owns `SSVNetwork` and `SSVNetworkViews`.
4. Confirm `MAINNET_PRIVATE_KEY` is set in `.env` for the SSV Labs deployer account.
5. Ensure the deployer account has enough ETH to deploy:
   - `SSVNetworkSSVStakingUpgrade`
   - `SSVNetworkViews`
   - `CSSVToken`
   - All module implementations
6. Confirm the SAFE holds at least `initialStakeAmount` in SSV tokens (currently 1 SSV). The batch includes an `approve` + `stake` pair that transfers SSV from the SAFE to the SSVNetwork proxy.
7. Estimate the gas cost of the full SAFE batch before mainnet execution:
   - Simulate the complete batch against a mainnet fork (`just upgrade-fork mainnet`) or via Tenderly.
   - The batch contains roughly 24 transactions (1 `upgradeToAndCall`, 7 `updateModule`, 1 `upgradeTo`, ~10 parameter setters, 1 `updateQuorumBps`, ~4 `replaceOracle`, 1 `approve`, 1 `stake`). At typical mainnet gas prices the total is in the 4–6M gas range. Confirm the SAFE has enough ETH to cover execution at current gas prices.
   - If Tenderly is available, import `multisig-batch.json` and run a simulation before delivery to the committee.
8. Dry-run the same flow on a fork or staging environment before mainnet execution.

## Step 1: Deploy Implementations on Mainnet

SSV Labs runs:

```bash
just deploy mainnet
```

This step deploys implementations only. It does not upgrade either proxy.

Expected output includes:

- `SSVNetworkSSVStakingUpgrade` implementation
- `SSVNetworkViews` implementation
- `CSSVToken` deployment or reuse
- Module implementations:
  - `SSVOperators`
  - `SSVClusters`
  - `SSVDAO`
  - `SSVViews`
  - `SSVOperatorsWhitelist`
  - `SSVStaking`
  - `SSVValidators`

The script writes the results to:

- `deployments/mainnet/deploy-result.json`
- `deployments/mainnet/deploy-result.v2.0.0.json` as the versioned artifact for this release

SSV Labs should capture and share:

- deployment timestamp
- deployer address
- chain ID
- every newly deployed contract address and parameters used on deployment (if any)
- the **bytecode hash** (`keccak256` of the deployed runtime bytecode) for each implementation and module, so the committee can independently verify they are pointing the proxies at the correct compiled artifacts

To compute the bytecode hash of a deployed contract:

```bash
cast keccak $(cast code <address> --rpc-url $MAINNET_RPC_URL)
```

The expected values should be derived from the locally compiled artifacts in `artifacts/build-info/` or by running the same command against the staging deployment. Include the full table of address → bytecode hash in the delivery to the committee.

## Step 2: Generate the SAFE Batch

After the implementation deployment is complete, SSV Labs runs:

```bash
just generate-safe-batch mainnet
```

This generates:

```text
deployments/mainnet/multisig-batch.json
```

The batch is built from:

- `deployments/mainnet/config.json`
- `deployments/mainnet/deploy-result.json`

This is the recommended path for mainnet because it removes manual entry of target addresses and parameter values in SAFE.

## Step 3: SAFE Batch Contents

The generated SAFE batch encodes the owner-governed upgrade and configuration calls in this order.

### 1. Upgrade `SSVNetwork`

Because `skipInitializer=false`, the first call is:

```solidity
SSVNetwork.upgradeToAndCall(<new SSVNetwork implementation>, <initializeSSVStaking calldata>)
```

The initializer payload encodes:

```solidity
initializeSSVStaking(uint64 cooldownDuration, uint32[4] defaultOracleIds, uint16 quorumBps)
```

If a future patch upgrade sets `skipInitializer=true`, the batch uses `upgradeTo(...)` instead.

### 2. Update module pointers on `SSVNetwork`

The batch then updates all module slots:

```solidity
SSVNetwork.updateModule(0, <SSVOperators>)
SSVNetwork.updateModule(1, <SSVClusters>)
SSVNetwork.updateModule(2, <SSVDAO>)
SSVNetwork.updateModule(3, <SSVViews>)
SSVNetwork.updateModule(4, <SSVOperatorsWhitelist>)
SSVNetwork.updateModule(5, <SSVStaking>)
SSVNetwork.updateModule(6, <SSVValidators>)
```

### 3. Upgrade `SSVNetworkViews`

The batch upgrades the views proxy separately:

```solidity
SSVNetworkViews.upgradeTo(<new SSVNetworkViews implementation>)
```

### 4. Apply governance and protocol parameters

The batch includes setter calls for every parameter present in `config.json`. For the proposed mainnet config, this includes:

```solidity
SSVNetwork.updateNetworkFee(...)
SSVNetwork.updateMaximumOperatorFee(...)
SSVNetwork.updateMinimumOperatorEthFee(...)
SSVNetwork.updateMinimumLiquidationCollateral(...)
SSVNetwork.updateLiquidationThresholdPeriod(...)
SSVNetwork.updateMinBlocksBetweenUpdates(...)
SSVNetwork.updateMinimumLiquidationCollateralSSV(...)
SSVNetwork.updateLiquidationThresholdPeriodSSV(...)
```

If additional optional fields are present in config, the batch generator will also include their corresponding setters.

### 5. Replace oracle addresses

For each oracle entry in `config.json`, the batch includes:

```solidity
SSVNetwork.replaceOracle(<oracleId>, <oracleAddress>)
```

### 6. Initial SSV stake

If `initialStakeAmount` is set in `config.json`, the batch includes the ERC-20 approval and stake call:

```solidity
SSVToken.approve(SSVNetwork, <initialStakeAmount>)
SSVNetwork.stake(<initialStakeAmount>)
```

This seeds the staking module so that `totalStaked > 0`, which is required for oracle quorum to function.

## Step 4: SAFE Committee Review and Execution

The multisig committee should:

1. Import `deployments/mainnet/multisig-batch.json` into SAFE Transaction Builder.
2. Confirm the SAFE address matches the intended `owner`.
3. Review each transaction target and calldata.
4. Confirm the implementation and module addresses against `deploy-result.json`.
5. Confirm the parameter values against `deployments/mainnet/config.json`.
6. Sign and execute the batch on mainnet.

Recommended review checklist:

- `SSVNetwork` proxy address is correct.
- `SSVNetworkViews` proxy address is correct.
- All module addresses are the fresh `v2.0.0` deployments.
- New protocol parameters match the approved release values.
- Oracle IDs and replacement addresses are correct.
- Bytecode hash of each implementation and module address matches the hash provided by SSV Labs:

  ```bash
  cast keccak $(cast code <address> --rpc-url $MAINNET_RPC_URL)
  ```

  Verify this independently for `SSVNetworkSSVStakingUpgrade`, `SSVNetworkViews`, `CSSVToken`, and all seven module implementations before signing.

## Step 5: Verify Initial Stake
The initial SSV stake is included in the SAFE batch when `initialStakeAmount` is set in `config.json`. No separate transactions are needed.

## Step 6: Post-Execution Verification

After the multisig execution completes, SSV Labs runs:

```bash
just verify-upgrade mainnet
```

Verification should confirm:

- `SSVNetwork` reports the target version.
- `SSVNetworkViews` points to the intended implementation.
- All module pointers were updated.
- Governance parameters exposed through `SSVViews` match `deployments/mainnet/config.json`.
- Oracle replacements were applied.

Manual completion checks should then confirm:

- the initial stake is visible on-chain (included in the batch when `initialStakeAmount` is set)

Note: `minBlocksBetweenUpdates` is configured during the upgrade flow, but it is not exposed through `SSVViews`, so `just verify-upgrade mainnet` cannot assert it directly.

## Artifacts to Preserve

Archive the following for auditability:

- final `deployments/mainnet/config.json`
- final `deployments/mainnet/deploy-result.json`
- final `deployments/mainnet/multisig-batch.json`
- SAFE transaction hash(es)
- deployment transaction hash(es)
- verification output
- internal sign-off confirming first stake completion

## Failure and Abort Conditions

Abort the mainnet upgrade if any of the following occurs:

- `currentVersion` does not match the on-chain proxy version.
- The deployed implementation addresses in `deploy-result.json` are incomplete.
- Oracle addresses or governance parameters do not match the proposal.
- SAFE review finds any mismatch between `config.json`, `deploy-result.json`, and the imported batch.
- The batch cannot be fully signed and reviewed before the intended execution window.

If execution fails mid-process, do not improvise manual fixes from SAFE without first reconciling:

- which transactions were mined
- the current proxy implementation addresses
- current module pointers
- current governance parameters
- current oracle configuration

## Mainnet Command Summary

SSV Labs:

```bash
just deploy mainnet
just generate-safe-batch mainnet
just verify-upgrade mainnet
```

SAFE committee:

1. Import `deployments/mainnet/multisig-batch.json`
2. Review
3. Sign
4. Execute
