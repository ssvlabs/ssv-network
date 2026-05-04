# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | Operator owners | [Operational guidance](operational-guidance.md)
### Deep docs | [Specification](SPEC.md) | [Flows](FLOWS.md) | [Mainnet upgrade playbook](UPGRADE_PLAYBOOK.md) | [Deployments](../deployments/README.md)

## Operator owners

The operator lifecycle remains a core part of the SSV Network, but in `v2.0.0` operators now participate in both legacy SSV accounting and the new ETH fee model depending on cluster type and migration state.

## Registering an operator

Operators are registered through `SSVNetwork.registerOperator(...)`.

At registration time, the operator owner chooses:

- the operator public key
- the initial fee
- whether the operator starts as private or public

For the precise fee constraints and execution behavior, use [SPEC.md](SPEC.md) and [FLOWS.md](FLOWS.md).

## Public and private operators

Operators can be public or private:

- **Public** operators can be used by any eligible caller
- **Private** operators can only be used by addresses authorized through the protocol whitelist mechanisms

Whitelisting can be managed through:

- direct address-based whitelists
- an external whitelisting contract implementing `ISSVWhitelistingContract`

This design lets operator owners keep policy on-chain while still supporting custom authorization logic when needed.

## Whitelisting flows

Relevant functions include:

- `setOperatorsWhitelists`
- `removeOperatorsWhitelists`
- `setOperatorsWhitelistingContract`
- `removeOperatorsWhitelistingContract`
- `setOperatorsPrivateUnchecked`
- `setOperatorsPublicUnchecked`

When a validator is registered against a private operator, the protocol checks whether the caller is authorized for that operator. Existing validators are not retroactively removed if whitelist settings later change.

## ETH fee model for operators

In the upgraded system, ETH is the fee asset for new clusters. Operator owners should understand:

- ETH fee changes follow a declare/execute or immediate-reduce model
- earnings may exist on both ETH and legacy SSV branches depending on operator history
- legacy operators can transition into ETH flows as clusters migrate or register under the new model

Detailed fee-settlement rules, default ETH fee behavior, and earnings accounting are defined in [SPEC.md](SPEC.md).

## Earnings withdrawal

Operator owners can withdraw:

- ETH earnings through the ETH withdrawal functions
- legacy SSV earnings through the SSV withdrawal functions where applicable

The repo keeps both branches because the system must support pre-upgrade state while moving the active network model toward ETH.

## Practical notes

- Removing an operator does not erase the historical owner address used for read-side visibility.
- Removed operators may still matter to cluster history and migration logic, so operator removal should be treated as a protocol event, not just a UI cleanup action.
- Private operator policy affects future validator registration attempts, not historical validator membership.
