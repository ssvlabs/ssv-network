import { CoverageTracker } from "../../simulation/coverage.ts";
import {
  buildScenarioCase,
  createPocRoles,
  describeScenarioCase,
  getPocSeeds,
  runScenarioCase,
  runSeededReactivationRegression,
  type ScenarioFamilyName,
} from "../../helpers/poc.ts";
import { setupTestContext } from "../../helpers/context.ts";

describe("Hybrid ETH-Core Generative Testing PoC", () => {
  const tracker = new CoverageTracker();
  const families: ScenarioFamilyName[] = [
    "singleClusterLifecycle",
    "sharedOperatorsTwoClusters",
    "liquidationWindow",
  ];
  const seeds = getPocSeeds();

  let context: Awaited<ReturnType<typeof setupTestContext>>;
  let roles: Awaited<ReturnType<typeof createPocRoles>>;
  let baseSnapshot: { restore: () => Promise<void> };

  before(async function () {
    context = await setupTestContext();
    roles = await createPocRoles(context.connection);
    baseSnapshot = await context.networkHelpers.takeSnapshot();
  });

  beforeEach(async function () {
    await baseSnapshot.restore();
  });

  after(function () {
    if (process.env.POC_COVERAGE_REPORT === "0") {
      return;
    }
    // Keep the PoC self-describing when run from CI or a local shell.
    console.log(tracker.formatReport("[POC] ETH-Core Generative Coverage"));
  });

  for (const familyName of families) {
    describe(familyName, () => {
      for (const seed of seeds) {
        const scenarioCase = buildScenarioCase(familyName, seed);

        it(describeScenarioCase(scenarioCase), async function () {
          await runScenarioCase(
            {
              connection: context.connection,
              networkHelpers: context.networkHelpers,
              roles,
              tracker,
            },
            scenarioCase,
          );
        });
      }
    });
  }

  it("seeded liquidate-reactivate regression", async function () {
    await runSeededReactivationRegression(
      {
        connection: context.connection,
        networkHelpers: context.networkHelpers,
        roles,
        tracker,
      },
      9001n,
    );
  });
});
