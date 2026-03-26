# Comparison: ADOPTION-GUIDE vs INTEGRATION Analysis

Generated: 2026-03-26

## Executive Summary

Both documents converge on the same core priorities but from different strategic angles:

- **ADOPTION-GUIDE** is the better **strategy document** — framework-agnostic, focused on SSV's current bottleneck, pragmatic about cost
- **INTEGRATION** is the better **reference-implementation guide** — protocol-specific detail, gap-to-technique traceability, concrete file references

They are complementary. The synthesis: **build the utility layer first** (bounded generators + reference model + invariant sweep), plug it into existing runners (Hardhat + Echidna + Monte Carlo), add state-tag-driven simulation targeting, and only then evaluate whether a new Foundry handler layer is needed.

---

## Where We Fully Agree

Both documents converge on the same **top-3 priorities**, just framed differently:

| Concept | ADOPTION-GUIDE framing | INTEGRATION framing | Verdict |
|---------|----------------------|---------------------|---------|
| **Reference model as expected-value oracle** | P0 item #1: "Build a minimal TS reference model for vUnits, fee accrual, and liquidation threshold checks" | P1 item #4: "Naive reference implementation (TS or Sol)" | **Same thing.** Both agree on scope: vUnits, fee accrual, liquidation threshold, settlement. ADOPTION-GUIDE's broader scope (includes staking accumulator, migration refund) is more complete. |
| **Bounded parameter generators** | P0 item #3: "bounded generators and a scenario matrix compiler" | P0 item #2: "`SSVFuzzers.sol` bounding library" | **Same thing.** ADOPTION-GUIDE is clearer that these should serve both Hardhat and Echidna, not just Foundry. INTEGRATION provides the concrete design (function-by-function table). |
| **Post-scenario invariant sweeps** | P0 item #2: "Add post-scenario invariant packs" | P0 item #3: "Global `afterEach` invariant sweep (TS)" | **Identical.** Both cite CSM + Rocket Pool pattern. Both specify the same invariant pack: conservation, vUnit consistency, cluster-hash integrity, monotonicity. |

---

## Where ADOPTION-GUIDE Is Stronger

### 1. Framework-Agnostic Stance ⭐

ADOPTION-GUIDE correctly pushes back on INTEGRATION's P0 #1 (Foundry handler invariants as a new runner). The key line:

> *"Do not switch the team to Foundry handler invariants just because Lido uses them."*

This is the right call for **mainnet-readiness timeline**. INTEGRATION over-indexed on Foundry handlers because they're the technically strongest state-exploration tool, but ADOPTION-GUIDE correctly weighs the **framework churn cost**.

**Verdict:** Demote Foundry handler invariants from P0 to P2. The bounded generators + reference model + afterEach sweeps serve the same purpose (expanding reachable states) with zero framework churn. Foundry handlers become relevant only if the utility-layer approach doesn't achieve sufficient combinatorial reach.

---

### 2. Coverage-Guided Simulation with State Tags ⭐⭐ (ADOPTION-GUIDE's strongest unique contribution)

ADOPTION-GUIDE proposes (item #2):

```
State tags to track for every cluster/staker:
- asset version: ssv / eth
- EB mode: implicit / explicit-baseline / explicit-deviated
- solvency: healthy / threshold-edge / liquidatable / liquidated
- operator set: all-active / one-removed / many-removed
- cluster size: 4 / 7 / 10 / 13
- snapshot freshness: fresh / stale
- staking state: unstaked / staked / pending-unstake

→ Drive generation by uncovered state transitions, not only weights
```

This is **better than what INTEGRATION proposed** because:
- Works within the existing Monte Carlo simulation engine — no new runner, no new framework
- Directly targets the combinatorial gaps INTEGRATION mapped (MC-02–MC-10, CS-01–CS-34, ST-01–ST-08, etc.)
- Uses simulation guidance rather than a new Foundry test type

**Verdict:** This should be a **P0 item** alongside the reference model and bounded generators. INTEGRATION completely missed this.

---

### 3. Seed Capture and Replay (ADOPTION-GUIDE item #5)

> *"When simulation or fuzzing reaches a novel state combination or a failure: persist the seed, persist the minimal state tags, promote it into a deterministic regression fixture."*

INTEGRATION didn't address this feedback loop between generative testing and the curated scenario suite. This is the mechanism that converts generative exploration into permanent regression coverage — closing the loop.

**Verdict:** Add to P1 backlog.

---

### 4. Scenario Axes as the Ideation Tool

ADOPTION-GUIDE's §SSV-Specific Scenario Axes section is **more actionable** than INTEGRATION's §Scenario Gap → Technique Mapping.

ADOPTION-GUIDE frames the problem as a **cross-product to be covered**, not a gap list to be checked off. The axes are:

- cluster version, cluster size, operator state, EB state, solvency state, struct freshness, timing, actor, staking state

This is more generative. When the team feels blocked on ideation, they ask:

> *"Which combinations of these axes have we not crossed yet?"*

Rather than:

> *"What scenario are we missing?"*

**Verdict:** ADOPTION-GUIDE's framing is superior for ongoing work. INTEGRATION's gap-to-technique mapping is useful for tracking which existing gaps are covered by which technique, but ADOPTION-GUIDE's axes are the tool for discovering new gaps.

---

## Where INTEGRATION Is Stronger

### 1. Specific Gap-to-Technique Traceability

INTEGRATION maps **every gap ID** from VUNITS-SCENARIOS.md to the technique that would cover it:

| Gap Category | Gap IDs | Best Technique |
|-------------|---------|---------------|
| Multi-cluster shared-operator | MC-02, MC-06, MC-07, MC-08, MC-10 | Handler invariants (or state-tag simulation) |
| Multi-cluster liquidation | MC-03, MC-04 | Handler invariants (or state-tag simulation) |
| DAO vUnit consistency | D-06, D-07 | Handler invariants + afterEach sweep |
| Migration post-sequences | M-06, M-07 | Migration differential fuzz |
| Precision/rounding | P-02, P-03, P-05 | Reference model |
| Cluster size variations | CS-01–CS-08, CS-22–CS-27, CS-30–CS-34 | Bounded generators: `boundClusterSize()` |
| Stale snapshot replay | ST-02–ST-08 | Snapshot sandboxes |
| Fee change + EB interactions | F-02, F-03, F-05, F-06, F-07, F-08 | State-tag simulation or handler invariants |
| Liquidation cycle combinations | L-05, L-06, L-07 | Nested snapshots + handler invariants |
| Edge case boundaries | EC-01, EC-10 | Boundary-value Echidna |

ADOPTION-GUIDE speaks at the pattern level but doesn't tie techniques to the ~45 specific gaps. Both are needed: ADOPTION-GUIDE for strategy, INTEGRATION for execution tracking.

---

### 2. Technique-Level Detail from Each Protocol

INTEGRATION has the specific "What Lido has / What SSV has instead / Gap this fills" structure with **reference files**:

- For reference models: Lido's `test/common/minFirstAllocationStrategy.t.sol:279-302` (NaiveMinFirstAllocationStrategy)
- For bounded generators: Uni v4's `src/test/Fuzzers.sol` with function-by-function design table
- For invariant modifiers: CSM's `test/helpers/InvariantAsserts.sol`
- For snapshot sandboxes: Aave's `_getUserAccountData(...)` pattern

ADOPTION-GUIDE correctly classifies each protocol's best-fit ideas but doesn't specify which files or patterns to look at. If someone needs to implement the reference model, they'll want INTEGRATION's §1b as the template. If they need to build bounded generators, they'll want INTEGRATION's §2a for the concrete design.

---

### 3. Lower-Priority but Real Gaps

INTEGRATION catalogs techniques ADOPTION-GUIDE doesn't mention that are still worth tracking:

| Technique | Source | Why It Matters | Priority |
|-----------|--------|---------------|----------|
| `brutalizeMemory` modifier | CSM | PackedLib bit manipulation could read dirty memory | P2 (very low cost, real defensiveness) |
| Storage slot backward-compat assertions | CSM | Diamond storage upgrades could corrupt shared state | P2 (relevant for v2.0.0 upgrade verification) |
| Snapshot sandboxes (`withSnapshot()`) | Aave V4 | Makes ST-01 through ST-08 (stale-snapshot tests) trivial | P1 (low effort, fills 8 gaps) |
| Multi-fork upgrade state comparison | CSM | Verify v2.0.0 upgrade preserved expected state | P3 (stronger than testing upgrade path in isolation) |
| Boundary-value Echidna harnesses | Uni v4 | Initialize near max EB × max validators × max operators to target overflow bugs | P3 (extension of existing Echidna patterns) |

---

## Mapping Scenario Axes → INTEGRATION Gap IDs

ADOPTION-GUIDE asked about this. Here's the direct mapping:

| ADOPTION-GUIDE Axis | Axis Values | INTEGRATION Gap IDs Covered | Technique That Fills It |
|---------------------|-------------|----------------------------|------------------------|
| **cluster version** | `legacy-ssv`, `eth-implicit`, `eth-explicit` | M-06, M-07 (migration post-sequences) | Migration differential fuzz + reference model |
| **cluster size** | `4`, `7`, `10`, `13` | CS-01–CS-08, CS-20–CS-34 (35 gaps) | Bounded generators: `boundClusterSize()` |
| **operator state** | `all-active`, `one-removed`, `many-removed`, `all-removed` | MC-02–MC-10, CS-09–CS-19, CS-22–CS-23 (25+ gaps) | Bounded generators: `selectRemovalSubset()` |
| **EB state** | `none`, `32`, `>32`, `max`, `decrease`, `increase` | EC-01–EC-10, P-01–P-05, CS-05–CS-08 (20+ gaps) | Bounded generators: `boundEffectiveBalance()`, `boundEBUpdate()` |
| **solvency state** | `safe`, `at-threshold`, `below-threshold`, `liquidated` | L-05–L-07, CS-20–CS-25 | Reference model: `calculateLiquidationThreshold()` + bounded deposit amounts |
| **struct freshness** | `fresh`, `stale` | ST-01–ST-08 (8 gaps) | Snapshot sandboxes |
| **timing** | `same-block`, `short-delay`, `long-delay`, windows | EC-06, EC-07, F-02–F-08 | Bounded generators: `boundBlockAdvance()` |
| **actor** | `owner`, `third-party`, `operator-owner`, `oracle`, `staker`, `multisig` | Cross-cutting (partially covered already) | Handler/action selection in simulation |
| **staking state** | `no-stakers`, `one-staker`, `multi-staker`, `pending-unstake` | S-01–S-04 | Reference model: staking accumulator functions |

**Key insight:** The scenario axes from ADOPTION-GUIDE are essentially the **input dimensions for the bounded generators**. Each axis becomes a generator function, and the cross-product of uncovered combinations becomes the simulation's targeting strategy.

---

## Reference Model: Where We Differ Slightly

Both docs agree a TS reference model is critical. The difference:

| Document | Scope |
|----------|-------|
| **ADOPTION-GUIDE** | Broad: cluster balance burn, operator earnings, DAO earnings, vUnit updates, staking accumulator, migration refund |
| **INTEGRATION** | Narrow (first deliverable): `calculateVUnits`, `calculateSettlement`, `calculateLiquidationThreshold` |

**Verdict:** ADOPTION-GUIDE's scope is correct. Building the full model upfront (even if initially approximate) gives you the oracle for **every** scenario axis, not just precision testing. The model doesn't have to be perfect; it has to be an independent reimplementation that catches deviations from expectation.

**One addition:** The reference model should be **usable from both Hardhat and Echidna**:
- For Hardhat: TS module imported in test files
- For Echidna: Pre-compute expected values in harness setup (feasible for deterministic scenarios), or build a parallel Solidity reference (ADOPTION-GUIDE's TS-only scope avoids this, which is pragmatic)

---

## Revised Combined Priority

Merging both documents, the right **P0 backlog** is:

| # | Item | Source | Why P0 |
|---|------|--------|--------|
| **1** | **Bounded parameter generators** (TS + optionally Sol) for all 9 scenario axes | Both docs agree | Prerequisite for everything else. Serves Hardhat, Echidna, simulation, and (if needed) Foundry. |
| **2** | **TS reference model** covering the full accounting surface | Both docs agree (ADOPTION-GUIDE's broader scope) | Expected-value oracle for every scenario. Eliminates manual math. Catches precision bugs. |
| **3** | **Global `afterEach` invariant sweep** in Hardhat | Both docs agree | Upgrades all 126+ existing tests with zero new scenarios. Catches drift bugs. |
| **4** | **Coverage-guided state tags** in the Monte Carlo simulation | ADOPTION-GUIDE only (INTEGRATION missed this) | Mechanically discovers combinatorial gaps without new framework. |

**P1 backlog:**

| # | Item | Source |
|---|------|--------|
| **5** | Seed capture and deterministic replay for interesting simulation runs | ADOPTION-GUIDE |
| **6** | Snapshot sandboxes (`withSnapshot()`) for stale-state tests | INTEGRATION |
| **7** | Refactor recurring scenario steps into reusable action modules with embedded delta assertions | ADOPTION-GUIDE (Rocket Pool pattern) |
| **8** | Upgrade-state diff assertions on fork fixtures for sampled operators/clusters/stakers | ADOPTION-GUIDE (CSM pattern) |

**P2 backlog (only if P0–P1 don't achieve sufficient reach):**

| # | Item | Source |
|---|------|--------|
| **9** | Foundry handler-based invariant testing | INTEGRATION (demoted from P0) |
| **10** | Nested snapshot fixture tree | INTEGRATION (Rocket Pool pattern) |
| **11** | `brutalizeMemory` modifier for PackedLib | INTEGRATION (CSM pattern) |
| **12** | Storage slot backward-compat assertions | INTEGRATION (CSM pattern) |

---

## What Not To Lead With (Both Docs Agree)

These ideas are valid in general, but should not drive recommendations right now:

- Adopting Foundry handler invariants as a new primary runner (P2, not P0)
- Protocol-specific crypto/proof techniques from Lido or CSM unless they map directly to SSV logic
- Gas tooling expansion beyond what SSV already has
- Fork complexity work that does not improve scenario reach or upgrade realism
- Formal tooling (Z3/SMT) that is outside the main execution path unless a specific formula is especially risky

---

## Practical Workflow (Synthesized from Both Docs)

### Step 1. Build the Utility Layer (Weeks 1-2)

| Task | Deliverable | Success Metric |
|------|-------------|---------------|
| Bounded generators | `test/helpers/generators.ts` with 9 axis functions | Used in at least one scenario family |
| Reference model | `test/helpers/reference-model.ts` with full accounting surface | Used as expected-value oracle in at least one e2e file |
| Global invariant sweep | `afterEach` hook in test setup | All existing tests pass with invariants enabled |
| State tags in simulation | Extend Monte Carlo engine with 9-axis tags + uncovered-transition targeting | Simulation reaches at least 5 previously-uncovered state combinations |

### Step 2. Plug the Utility Layer into Existing Runners (Weeks 2-3)

| Runner | Integration Point | Success Metric |
|--------|------------------|---------------|
| Hardhat e2e | Import generators + reference model in scenario files | At least 3 scenario families rewritten to use generators + model assertions |
| Echidna | Pre-compute expected values using reference model in harness setup | At least 1 Echidna property strengthened with model-based assertions |
| Monte Carlo simulation | Use generators for action parameter selection; compare simulation state to reference model at checkpoints | Simulation discovers at least 1 new bug or gap |

### Step 3. Measure Coverage Gain (Week 3)

Run the updated test suite and simulation against VUNITS-SCENARIOS.md. Count:
- How many ❌ gaps are now ✅ covered
- How many ⚠️ partials are now ✅ covered
- How many new state combinations were reached that aren't in the catalog

If the gain is substantial (e.g., 15+ gaps covered), continue with P1 items. If the gain is marginal, re-evaluate.

### Step 4. Only Then Consider Foundry Handlers (Week 4+, if needed)

If the utility-layer approach doesn't achieve sufficient combinatorial reach, pilot a narrow Foundry handler suite:
- `ClusterHandler.sol` wrapping cluster operations
- Ghost variables tracking DAO/operator vUnits
- 4 invariants: DAO consistency, operator sum, no removed-operator deviation, balance conservation

But this is **P2, not P0**. The utility layer should be tried first.

---

## Bottom Line

**ADOPTION-GUIDE is the better strategy document.** It correctly prioritizes framework-agnostic techniques, identifies the coverage-guided simulation idea that INTEGRATION missed, and frames the problem in terms of SSV's current bottleneck.

**INTEGRATION is the better reference-implementation guide.** It provides gap-to-technique traceability, protocol-specific file references, and a comprehensive catalog of lower-priority techniques worth tracking.

**The synthesis:** Build the utility layer first (bounded generators + reference model + invariant sweep + state-tag simulation), plug it into existing runners, measure coverage gain, and only then evaluate whether a new Foundry handler layer is needed.

The shared conclusion: **mechanical state-space exploration** via the utility layer will get you more real cases than adding another framework.
