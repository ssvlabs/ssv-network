# Direct ETH Outflow Basic Alert

Last reviewed: 2026-04-28

## Goal

Set up the simplest possible Tenderly alerting layer for direct ETH leaving the SSV Hoodi stage contract.

This is intentionally smaller than the full monitoring suite:

- no Web3 Action yet
- no thresholds yet
- just real-time event notifications from the main protocol contract

## Scope

This alert pack covers only the direct ETH-outflow functions on the Hoodi stage `SSVNetwork` proxy.

Functions covered:

- `withdraw` -> `ClusterWithdrawn`
- `withdrawOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllOperatorEarnings` -> `OperatorWithdrawn`
- `withdrawAllVersionOperatorEarnings` -> `OperatorWithdrawn` for the ETH leg
- `claimEthRewards` -> `RewardsClaimed`

## Why Event Alerts, Not Function Alerts

Management asked for direct ETH-outflow functions. For the first Tenderly setup, the cleanest implementation is still event-based:

- the contract emits the relevant events on the ETH-outflow paths we care about
- several functions collapse into the same ETH-out event
- `Event Emitted` is the simplest Tenderly trigger to deploy and validate

So the first alert pack is function-driven in scope, but event-driven in implementation.

## Contract Target

Current Hoodi stage deployment:

- `SSVNetwork` proxy: `0xc07B3E9671f884FDa67E1e7D43d952E0e1369fd8`
- `SSVNetworkViews`: `0x3234e84b7d1eE1AF8b586E26814d4e268336D142`
- `SSV token`: `0x746C33ccC28b1363c35c09baDAF41b2FFa7E6D56`
- `cSSV token`: `0x6455a0d83FeB099182Fb6D024B9Ae0c2E26C0859`

This is the contract address the basic alert should watch.

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
7. Paste contract address:
   - `0xc07B3E9671f884FDa67E1e7D43d952E0e1369fd8`
8. Select event:
   - `ClusterWithdrawn`
9. Name the alert:
   - `SSV Hoodi Stage - Cluster ETH Withdrawn`
10. Set destination:
   - Slack or email
11. Save and test.

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

1. Confirm the contract address is `0xc07B3E9671f884FDa67E1e7D43d952E0e1369fd8`.
2. Confirm each alert is watching the correct event.
3. Confirm the destination receives a test notification.
4. Confirm the team understands that this first version is event-only and not amount-aware.
5. Confirm the Hoodi project is watching the same proxy that emits the writes.

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

For now, this document is the minimal setup to satisfy "direct ETH-outflow functions only on our Hoodi stage contract."
