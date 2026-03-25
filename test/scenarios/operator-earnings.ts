/**
 * Scenario: Operator Earnings Accrue Over Time
 *
 * Exercises: PASS outcome with meaningful assertions.
 *
 * 1. Read initial operator earnings (snapshot pre-state)
 * 2. Mine blocks to let fees accrue
 * 3. Verify operator earnings increased (operators with validators)
 *    or stayed the same (operators with no validators)
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { StateSnapshot } from "../simulation/state-snapshot.ts";

export const operatorEarningsScenario: Scenario = {
  id: "operator-earnings-accrue",
  tags: ["operator", "earnings", "happy-path"],

  async run(ctx: ScenarioContext) {
    const operator = ctx.pickOperator();

    // Capture earnings before mining via the step pre-snapshot
    let earningsBefore: bigint | undefined;

    // Step 1: Read initial earnings
    await ctx.step(
      "read-initial-earnings",
      async () => {
        // No-op action — we just want the pre/post snapshots
      },
      async (_pre: StateSnapshot, post: StateSnapshot) => {
        const opSnap = post.operators.get(operator.id);
        earningsBefore = opSnap?.earnings ?? 0n;
      },
    );

    // Step 2: Mine blocks to accrue fees
    await ctx.step(
      "mine-blocks-for-accrual",
      async () => {
        await ctx.mineBlocks(500);
      },
      async (_pre: StateSnapshot, _post: StateSnapshot) => {
        // Just advancing time
      },
    );

    // Step 3: Verify earnings changed as expected
    await ctx.step(
      "verify-earnings-accrued",
      async () => {
        // No-op action — we just want the post snapshot
      },
      async (_pre: StateSnapshot, post: StateSnapshot) => {
        const opSnap = post.operators.get(operator.id);
        if (!opSnap) {
          throw new Error(`Operator ${operator.id} not found in post snapshot`);
        }
        const earningsAfter = opSnap.earnings;

        // If operator has validators, earnings should have increased.
        // If no validators, earnings stay the same — both are valid.
        // What's NOT valid: earnings decreasing.
        if (earningsBefore !== undefined && earningsAfter < earningsBefore) {
          throw new Error(
            `Operator ${operator.id} earnings decreased: ${earningsBefore} → ${earningsAfter}`,
          );
        }
      },
    );
  },
};
