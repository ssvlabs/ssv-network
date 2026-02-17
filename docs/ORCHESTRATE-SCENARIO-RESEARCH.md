# Scenario Test Research — Orchestration Prompt

Paste this into a clean Claude Code context to launch the scenario test discovery process.

---

## Instructions

You are orchestrating a multi-phase research process to discover and document scenario tests for SSV Network v2.0.0 smart contracts.

### Phase 1: Parallel Research (3 subtasks)

Launch these 3 subtasks **in parallel** using `/subtask`:

```bash
subtask run research--operators-validators
subtask run research--clusters-migration
subtask run research--eb-staking
```

Each will:
- Deep-read the actual Solidity code for their partition
- Compare every flow against `docs/FLOWS.md`
- Produce scenario documents in `docs/scenarios/`
- Flag any code-vs-docs discrepancies for human review

Monitor progress:
```bash
subtask show research--operators-validators
subtask show research--clusters-migration
subtask show research--eb-staking
```

### Phase 2: Review Partition Outputs

Once all 3 are done, review each output:
```bash
subtask diff research--operators-validators
subtask diff research--clusters-migration
subtask diff research--eb-staking
```

**Check for discrepancies flagged for human review.** If any partition found code-vs-FLOWS.md disagreements, pause and consult with the user before proceeding.

Merge all 3 partition branches so the cross-cutting task can read them:
```bash
subtask stage research--operators-validators ready
subtask stage research--clusters-migration ready
subtask stage research--eb-staking ready
```

### Phase 3: Cross-Cutting Synthesis

After partition branches are merged, launch:
```bash
subtask run research--cross-cutting
```

This will:
- Read all 3 partition outputs
- Generate cross-module scenarios (conservation laws, multi-step flows, full lifecycle)
- Compile everything into `docs/SCENARIO-TESTS.md`

### Phase 4: Human Review

Present the final `docs/SCENARIO-TESTS.md` to the user. Key things to review:
1. **Discrepancies section** — code vs docs disagreements that need human judgment
2. **Cross-cutting scenarios** — do they cover the flows you're worried about?
3. **Completeness** — any flows missing?

### Phase 5: Implementation (separate context)

After SCENARIO-TESTS.md is approved, launch implementation in a new clean context:
```bash
subtask run implement--scenario-tests
```

This implements all scenarios as tests in `test/e2e/`.

---

## Important Notes

- Each research subtask is designed to run independently — they don't depend on each other
- The cross-cutting task DOES depend on the other 3 being done and merged
- If a subtask finds a potential bug (not just a test gap), flag it immediately
- The user has requested that ALL discrepancies be escalated for human review
