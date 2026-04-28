# Monitoring

This folder is intentionally narrow.

Current scope:

- network: `Hoodi`
- environment: `stage`
- contract in scope: `SSVNetwork` proxy `0xc07B3E9671f884FDa67E1e7D43d952E0e1369fd8`
- views: `0x3234e84b7d1eE1AF8b586E26814d4e268336D142`
- token: `0x746C33ccC28b1363c35c09baDAF41b2FFa7E6D56`
- cSSV: `0x6455a0d83FeB099182Fb6D024B9Ae0c2E26C0859`

Direct ETH-outflow functions in scope:

- `withdraw`
- `withdrawOperatorEarnings`
- `withdrawAllOperatorEarnings`
- `withdrawAllVersionOperatorEarnings`
- `claimEthRewards`

Files kept in this folder:

- [direct-eth-outflow-basic-alert.md](./direct-eth-outflow-basic-alert.md)
  Tenderly setup note for the first event-based alerts.

- [direct-eth-outflow-basic-alert-spec.ts](./direct-eth-outflow-basic-alert-spec.ts)
  Small TypeScript spec that prints the current Hoodi stage alert pack.

Implementation model:

- `withdraw` -> `ClusterWithdrawn`
- `withdrawOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllVersionOperatorEarnings` -> `OperatorWithdrawn` for the ETH leg
- `claimEthRewards` -> `RewardsClaimed`

Why it is event-based:

- Tenderly `Event Emitted` alerts are the fastest clean starting point
- the events are the canonical signal for the ETH-outflow paths we care about
- zero-value emissions are possible, so this first pack is not strict `amount > 0` detection
- function-level nuance can be added later with a Web3 Action if needed

Print the current spec with:

```bash
npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts
```

Compile-check the spec with:

```bash
npx tsc --noEmit --target es2022 --module node16 --moduleResolution node16 --esModuleInterop --skipLibCheck --allowImportingTsExtensions scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts
```
