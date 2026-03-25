/**
 * Scenario: Register Validator with insufficient deposit (expected revert)
 *
 * Exercises: EXPECTED_REVERT outcome (step() throws StepReverted).
 *
 * 1. Try to register a validator with 0 ETH deposit
 * 2. The TX should revert → StepReverted is thrown → scenario stops
 *
 * This validates that the engine correctly classifies reverts.
 */

import type { Scenario } from "../simulation/scenario-types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { EMPTY_CLUSTER, DEFAULT_SHARES } from "../common/constants.ts";

export const registerValidatorRevertScenario: Scenario = {
  id: "register-validator-revert",
  tags: ["cluster", "register", "revert"],

  async run(ctx: ScenarioContext) {
    // Pick an operator group (first 4 operators)
    const opIds = [...ctx.actors.operators.keys()].slice(0, 4);
    if (opIds.length < 4) {
      throw new ScenarioSkipped("Not enough operators for scenario");
    }

    const owner = ctx.actors.clusterOwners[0];
    if (!owner) throw new ScenarioSkipped("No cluster owners available");

    // Generate a unique pubkey
    const seed = await ctx.getBlockNumber();
    const pubkey =
      "0x" +
      Buffer.from(
        seed.toString(16).padStart(96, "a"),
        "hex",
      ).toString("hex");

    // Step 1: Register validator with 0 ETH — should revert
    // This step will throw StepReverted, so we never reach step 2
    await ctx.step(
      "register-with-zero-deposit",
      async () => {
        // Attempt register with 0 value — should revert with InsufficientBalance or similar
        await ctx.contracts.network
          .connect(owner)
          .registerValidator(pubkey, opIds, DEFAULT_SHARES, EMPTY_CLUSTER, {
            value: 0n,
          });
      },
      async () => {
        // This should never be reached
        throw new Error("UNREACHABLE: register with 0 ETH should have reverted");
      },
    );

    // Step 2 is unreachable if step 1 reverts as expected
    await ctx.step(
      "unreachable-step",
      async () => {},
      async () => {},
    );
  },
};
