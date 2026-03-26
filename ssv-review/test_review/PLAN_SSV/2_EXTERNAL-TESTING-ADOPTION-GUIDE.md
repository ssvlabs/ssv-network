# External Testing Adoption Guide for SSV

## Goal

Use the external protocol reviews to improve SSV's ability to reach new cases, not to copy test frameworks for their own sake.

SSV already has strong infrastructure:

- scenario catalogs and coverage reports
- Echidna stateful invariants
- fork fixtures and upgrade replay
- a Monte Carlo simulation engine
- gas enforcement

That means the comparison question should be:

> Does this external technique increase the set of SSV states we can reach, or improve the oracle we use to judge those states?

If the answer is "no", it is not a priority right now.

## The Right Comparison Method

Compare each protocol against SSV on five axes:

| Axis | What to ask | Why it matters for SSV |
|---|---|---|
| State generation | Does it help produce sequences we are not currently ideating? | This is the current bottleneck |
| Oracle quality | Does it give a stronger expected-value check than "did not revert"? | Needed for long multi-step scenarios |
| Reuse fit | Can it plug into Hardhat + Echidna + current simulation? | Avoid framework churn |
| Mainnet readiness | Does it improve fork realism, upgrade confidence, or long-horizon stress? | This is the current program goal |
| Cost | Does it require a new runner or large maintenance surface? | Avoid slowing the team down |

Classify every external idea into one of these buckets:

- `Adopt now`: high reach, strong fit, low framework churn
- `Adapt into existing infra`: good idea, but implement it in current SSV tooling
- `Later`: useful, but not on the critical path to mainnet
- `Skip`: interesting but not a fit for SSV
- `Already have`: no need to duplicate

## What SSV Already Has

Do not spend time re-importing patterns SSV already does well:

- explicit scenario planning and coverage accounting
- stateful Echidna harnesses with actors and shadow bookkeeping
- legacy artifact replay for upgrade testing
- fork preflight and upgrade fallback
- deterministic Monte Carlo simulation
- gas baseline enforcement

The comparison should therefore focus on missing leverage, not maturity theater.

## Per-Protocol Takeaways

### Lido

Best fit:

- naive reference implementations for differential checking
- ghost-variable style bookkeeping per action family
- handler thinking for guided state transitions

Recommendation:

- `Adapt into existing infra`
- Do not switch the team to Foundry handler invariants just because Lido uses them.
- Reuse the idea by building small reference models in TypeScript and by making simulation/scenario actions update shadow state aggressively.

Best SSV targets:

- vUnit updates
- liquidation threshold math
- staking reward distribution
- migration settlement/refund logic

### CSM

Best fit:

- invariant checks that run automatically after ordinary tests
- multi-fork before/after state comparison
- storage-layout and upgrade-backcompat assertions

Recommendation:

- `Adopt now` for post-scenario invariant sweeps
- `Adapt into existing infra` for multi-fork/state-diff ideas

Best SSV targets:

- after each e2e scenario file or helper-driven step chain, run a shared invariant pack
- for upgrade/fork work, compare pre-upgrade and post-upgrade state snapshots field-by-field for sampled clusters/operators/stakers

### Uniswap v4

Best fit:

- bounded parameter generation libraries
- differential testing against an independent oracle
- tiered depth profiles

Recommendation:

- `Adopt now` for bounded parameter generation
- `Adapt into existing infra` for differential oracles

Best SSV targets:

- cluster size selection: 4 / 7 / 10 / 13
- effective balance ranges
- timing distances: same block / short accrual / threshold edge / long accrual
- operator-removal counts
- stake / unstake / claim amounts around precision and queue boundaries

### Aave v4

Best fit:

- domain-specific bound/helper network
- snapshot sandboxes for branch exploration
- off-path state-model validation

Recommendation:

- `Adapt into existing infra`

Best SSV targets:

- create SSV-specific generators rather than raw random action selection
- use snapshot/revert branching to test the same setup under multiple follow-up branches without replaying all setup

### Rocket Pool

Best fit:

- scenario action modules with embedded local assertions
- post-test invariant sweep
- nested snapshot fixture trees

Recommendation:

- `Adopt now` for action modules plus invariant sweeps
- `Later` for deeper snapshot trees if setup time becomes a serious cost

Best SSV targets:

- package recurring scenario steps as "action helpers" that both perform the call and assert local balance/index deltas

## Highest-Yield Improvements for SSV

These are the highest-value additions for the current phase.

### 1. Build a reference-model layer

This is the single best way to break past "we only test scenarios we manually imagine."

Create a small TypeScript state model for:

- cluster balance burn
- operator earnings accrual
- dao/network earnings accrual
- vUnit updates from EB changes
- staking accumulator and reward settlement
- migration refund and ETH activation

Then compare model vs on-chain state:

- after each deterministic e2e scenario step
- after each simulation action
- at selected Echidna harness checkpoints where feasible

This gives you a reusable oracle for many new sequences.

### 2. Replace pure weighted randomness with coverage-guided sequence generation

The current simulation is weight-scheduled by time, which is useful, but not enough on its own.

Add state tags to every tracked cluster and staker, for example:

- asset version: `ssv` / `eth`
- EB mode: `implicit` / `explicit-baseline` / `explicit-deviated`
- solvency: `healthy` / `threshold-edge` / `liquidatable` / `liquidated`
- operator set: `all-active` / `one-removed` / `many-removed`
- cluster size: `4` / `7` / `10` / `13`
- snapshot freshness: `fresh` / `stale`
- staking state: `unstaked` / `staked` / `pending-unstake`

Then drive generation by uncovered state transitions, not only weights.

Examples:

- ensure every action is exercised from every relevant EB mode
- ensure each critical action is exercised with stale and fresh cluster structs
- ensure removed-operator scenarios are crossed with each cluster size
- ensure staking actions are crossed with fee/EB changes and liquidation events

This should produce more cases than adding another fuzzer.

### 3. Add post-scenario invariant packs

Reuse the CSM/Rocket Pool idea in the current Hardhat suite:

- after each multi-step e2e scenario, run a shared invariant pack
- after each helper action in long scenario chains, run a smaller local invariant pack

Suggested pack:

- ETH conservation
- SSV conservation
- validator-count consistency
- vUnit consistency
- cluster-hash integrity
- cSSV supply consistency
- accumulator monotonicity
- oracle-block monotonicity

This turns every scenario into a broader state-consistency test.

### 4. Introduce bounded generators and a scenario matrix compiler

Most missing cases in the vUnits catalog are not new mechanics. They are combinations of existing mechanics across a few dimensions.

Define reusable generators for:

- valid operator-count sets
- operator-removal subsets
- effective-balance ladders
- timing gaps in blocks
- deposit/withdraw amounts near threshold edges
- staking amounts near minimum and rounding boundaries

Then define scenario families as:

`initial state vector + action sequence template + parameter generator + model assertions`

This is much more scalable than writing one-off tests from scratch.

### 5. Capture and replay interesting seeds

When simulation or fuzzing reaches a novel state combination or a failure:

- persist the seed
- persist the minimal state tags reached
- promote the interesting seed into a deterministic regression or scenario fixture

That closes the loop between generative testing and the curated scenario suite.

## What Not To Lead With

These ideas are valid in general, but should not drive recommendations right now:

- adopting Foundry handler invariants as a new primary runner
- protocol-specific crypto/proof techniques from Lido or CSM unless they map directly to SSV logic
- gas tooling expansion beyond what SSV already has
- fork complexity work that does not improve scenario reach or upgrade realism
- formal tooling that is outside the main execution path unless a specific formula is especially risky

## Practical Workflow

### Step 1. Turn external reviews into an adoption sheet

For each advanced pattern from each protocol, add one row with:

| Field | Meaning |
|---|---|
| Pattern | Short name |
| Source repo | Aave / CSM / Lido / Rocket Pool / Uni |
| Problem solved | Ideation, oracle strength, fork realism, upgrade safety, ergonomics |
| SSV fit | high / medium / low |
| Bucket | adopt now / adapt / later / skip / already have |
| SSV insertion point | `test/e2e`, `test/simulation`, `test/echidna`, fixtures, helpers |
| First pilot | One narrow experiment |

Do this first. It prevents "cool technique drift."

### Step 2. Review protocols in this order

1. `Lido`
   Best source for reference models and invariant discipline.
2. `Uniswap v4`
   Best source for parameter generation and independent oracle thinking.
3. `CSM`
   Best source for per-test invariant wrapping and upgrade/fork comparison.
4. `Aave v4`
   Best source for bounded scenario fixtures and branch exploration.
5. `Rocket Pool`
   Best source for action-module ergonomics.

This order maximizes usefulness for SSV's current bottleneck.

### Step 3. Run only one pilot per pattern

Good pilots:

- add a TS reference model for vUnit accounting and use it in one high-value scenario family
- add post-scenario invariants to one `test/e2e/cross-cutting` file
- add a bounded generator for cluster-size/removal/EB combinations and use it in one vUnits test family
- add coverage-guided state tags to the simulation and prove it reaches combinations the weighted scheduler currently misses

If a pilot does not clearly increase reachable states or bug-finding ability, stop there.

## Recommended Immediate Backlog

### P0

- Build a minimal TS reference model for vUnits, fee accrual, and liquidation threshold checks
- Add a shared post-scenario invariant helper for long e2e flows
- Add bounded parameter generators for cluster size, EB ladder, operator removals, and timing gaps
- Extend the simulation with state tags and uncovered-transition targeting

### P1

- Add seed capture and deterministic replay for interesting simulation runs
- Add upgrade-state diff assertions on fork fixtures for sampled operators/clusters/stakers
- Refactor recurring scenario steps into reusable action modules with embedded delta assertions

### P2

- Consider a narrow Foundry differential/handler suite only if one subsystem remains hard to express in Echidna plus Hardhat

## SSV-Specific Scenario Axes

When the team feels blocked on ideation, do not ask "what scenario are we missing?"

Ask:

> Which combinations of these axes have we not crossed yet?

Core axes:

- cluster version: `legacy-ssv`, `eth-implicit`, `eth-explicit`
- cluster size: `4`, `7`, `10`, `13`
- operator state: `all-active`, `one-removed`, `many-removed`, `all-removed`
- EB state: `none`, `32`, `>32`, `max`, `decrease`, `increase`
- solvency state: `safe`, `at-threshold`, `below-threshold`, `liquidated`
- struct freshness: `fresh`, `stale`
- timing: `same-block`, `short-delay`, `long-delay`, `declare-window`, `execute-window`
- actor: `owner`, `third-party`, `operator-owner`, `oracle`, `staker`, `multisig`
- staking state: `no-stakers`, `one-staker`, `multi-staker`, `pending-unstake`

Critical action families:

- `deposit`
- `withdraw`
- `registerValidator`
- `removeValidator`
- `liquidate`
- `reactivate`
- `migrateClusterToETH`
- `commitRoot`
- `updateClusterBalance`
- `stake`
- `requestUnstake`
- `withdrawUnlocked`
- `claimEthRewards`
- operator fee declare/execute/reduce/withdraw

The missing tests are usually pairwise or triple-wise gaps across these axes, not brand-new flows.

## Bottom Line

Yes, checking each protocol against SSV is the right way to do this.

But do it against SSV's bottleneck:

- better state generation
- better expected-value oracles
- better replay of interesting sequences

For the current mainnet-readiness phase, the strongest ideas to import are:

1. reference-model/differential checks
2. bounded scenario generators
3. post-scenario invariant sweeps
4. coverage-guided simulation rather than purely weighted simulation

That path will get you more real cases than adding another framework.
