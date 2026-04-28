# Monitoring

This folder is intentionally narrow.

Current scope:

- network: `Hoodi`
- environment: `stage`
- deployment source: `deployments/hoodi-stage/config.json`
- runtime deployment values: printed by `npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts`

Withdrawal and reward-claim ETH outflows in scope:

- `withdraw`
- `withdrawOperatorEarnings`
- `withdrawAllOperatorEarnings`
- `withdrawAllVersionOperatorEarnings`
- `claimEthRewards`

Excluded from this pack:

- `liquidate`
- ETH transfers caused by auto-liquidation in `updateClusterBalance`

Those liquidation paths need a separate monitor because `ClusterLiquidated` is also emitted by `liquidateSSV`.

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
- liquidation ETH outflows are intentionally not part of this starter pack
- function-level nuance can be added later with a Web3 Action if needed

Print the current spec with:

```bash
npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts
```

Compile-check the spec with:

```bash
npx tsc --noEmit --target es2022 --module node16 --moduleResolution node16 --esModuleInterop --skipLibCheck --allowImportingTsExtensions scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts
```
