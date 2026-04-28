# Direct ETH Outflow Basic Alert

Last reviewed: 2026-04-28

## Goal

Set up the simplest possible Tenderly alerting layer for withdrawal and reward-claim ETH outflows from the SSV Hoodi stage contract.

This is intentionally smaller than the full monitoring suite:

- no Web3 Action yet
- no thresholds yet
- just real-time event notifications from the main protocol contract

## Scope

This alert pack covers only withdrawal and reward-claim ETH outflows on the Hoodi stage `SSVNetwork` proxy.

Functions covered:

- `withdraw` -> `ClusterWithdrawn`
- `withdrawOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllVersionOperatorEarnings` -> `OperatorWithdrawn` for the ETH leg
- `claimEthRewards` -> `RewardsClaimed`

Explicitly excluded from this pack:

- `liquidate`
- auto-liquidation triggered by `updateClusterBalance`

Why excluded:

- liquidation is a native ETH-outflow path, but it emits `ClusterLiquidated`, which is shared with `liquidateSSV`
- that path needs its own monitor or Web3 Action logic to distinguish ETH liquidation from SSV liquidation

## Why Event Alerts, Not Function Alerts

Management asked for direct ETH-outflow functions. For this first pass, the pack is intentionally narrower than all ETH-outflow paths and focuses only on withdrawal and reward-claim functions. Within that scope, the cleanest Tenderly setup is still event-based:

- the contract emits the relevant events on the ETH-outflow paths we care about
- several functions collapse into the same ETH-out event
- `Event Emitted` is the simplest Tenderly trigger to deploy and validate

So the first alert pack is function-driven in scope, but event-driven in implementation.

## Contract Target

Do not copy contract addresses from this document by hand.

Resolve the current Hoodi stage deployment from the config-backed spec:

```bash
npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts
```

Use these fields from the printed JSON:

- `deployment.ssvNetworkProxy`
- `deployment.ssvNetworkViews`
- `deployment.ssvToken`
- `deployment.cssvToken`

The spec reads from:

- `deployments/hoodi-stage/config.json`

## Alert Pack

Source spec:

- [direct-eth-outflow-basic-alert-spec.ts](./direct-eth-outflow-basic-alert-spec.ts)

Suggested three-alert starter pack:

1. `SSV Hoodi Stage - Cluster ETH Withdrawn`
2. `SSV Hoodi Stage - Operator ETH Withdrawn`
3. `SSV Hoodi Stage - Staker ETH Rewards Claimed`

Why three alerts instead of one:

- Tenderly's `Event Emitted` alert flow is simplest when each alert watches one event.
- This keeps routing and severity cleaner.
- It also lets you page only the highest-signal event first if desired.

## Recommended Severity

Start with:

1. `ClusterWithdrawn`
- `critical`

2. `OperatorWithdrawn`
- `high`

3. `RewardsClaimed`
- `high`

On Hoodi stage, route all three to Slack or email first. PagerDuty belongs in the production rollout, not the first stage validation pass.

## Tenderly Setup

This is based on Tenderly's official alert model of `Trigger -> Target -> Destination`, and the `Event Emitted` trigger is the correct simple starting point for this use case.

References:

- [Tenderly smart contract alerts overview](https://blog.tenderly.co/how-to-set-up-real-time-alerting-for-smart-contracts-with-tenderly/)
- [Tenderly add any contract to alerts](https://blog.tenderly.co/changelog/insert-any-address/)

### Alert 1: Cluster ETH Withdrawn

1. Open Tenderly project.
2. Select the `Hoodi` network.
3. Go to `Alerts`.
4. Click `New Alert`.
5. Select trigger type: `Event Emitted`.
6. Set target type to `Address`.
7. Run:
   - `npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts`
8. Paste `deployment.ssvNetworkProxy` from the printed JSON.
9. Select event:
   - `ClusterWithdrawn`
10. Name the alert:
   - `SSV Hoodi Stage - Cluster ETH Withdrawn`
11. Set destination:
   - Slack or email
12. Save and test.

### Alert 2: Operator ETH Withdrawn

Repeat the same flow, but select event:

- `OperatorWithdrawn`

Suggested name:

- `SSV Hoodi Stage - Operator ETH Withdrawn`

### Alert 3: Staker ETH Rewards Claimed

Repeat the same flow, but select event:

- `RewardsClaimed`

Suggested name:

- `SSV Hoodi Stage - Staker ETH Rewards Claimed`

## Expected Payload Meaning

Important note for stage validation:

- `RewardsClaimed` can be emitted with `amount = 0`
- `ClusterWithdrawn` can be emitted on a zero-value withdrawal
- this basic alert pack therefore detects direct ETH-outflow paths, not guaranteed positive-value transfers
- if the team needs strict `amount > 0` semantics, add a Web3 Action or downstream filter before paging

### `ClusterWithdrawn`

Interpretation:

- ETH was withdrawn from a cluster balance by the cluster owner path.

Why it matters:

- this is direct ETH leaving the protocol from cluster funds

### `OperatorWithdrawn`

Interpretation:

- an operator withdrew ETH earnings

Why it matters:

- this is direct ETH leaving protocol-controlled operator accounting
- this covers:
  - `withdrawOperatorEarnings`
  - `withdrawAllOperatorEarnings`
  - the ETH leg of `withdrawAllVersionOperatorEarnings`

### `RewardsClaimed`

Interpretation:

- a staker claimed ETH rewards

Why it matters:

- this is direct ETH leaving staking reward balances

## Initial Routing Recommendation

Stage rollout:

1. route all three alerts to Slack or email
2. verify the event volume and payloads on Hoodi
3. keep this pack event-only until the team is happy with the signal quality

## Validation Checklist

Before considering the alert live:

1. Run `npx tsx scripts/monitoring/direct-eth-outflow-basic-alert-spec.ts`.
2. Confirm the Tenderly target address matches `deployment.ssvNetworkProxy` from the printed JSON.
3. Confirm each alert is watching the correct event.
4. Confirm the destination receives a test notification.
5. Confirm the team understands that this first version is event-only and not amount-aware.
6. Confirm the Hoodi project is watching the same proxy that emits the writes.

## Limitations

This is a basic alert, so it does not:

- inspect withdrawal size thresholds
- distinguish expected vs unexpected recipients
- correlate bursts
- separate low-value from high-value reward claims

That is intentional. Those are second-step improvements.

## Immediate Next Step

After the basic alert is live, the next useful upgrade is:

- attach a Web3 Action destination to `ClusterWithdrawn`, `OperatorWithdrawn`, and `RewardsClaimed`

That second step can classify:

- amount thresholds
- unexpected recipients
- burst frequency
- cluster inactive/active context

For now, this document is the minimal setup to satisfy "withdrawal and reward-claim ETH outflows only on our Hoodi stage contract."
