import { setupTestContext } from "../../helpers/context.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import { SeededRNG } from "../../simulation/rng.ts";
import { mineBlocks } from "../../helpers/blocks.ts";
import type { FuzzConfig, FuzzContext, NamedStep, StepFn } from "./types.ts";

const DEFAULT_BLOCKS_PER_TICK = { min: 1n, max: 200n };

function resolveStep<S>(step: StepFn<S> | NamedStep<S>): { name: string; fn: StepFn<S> } {
  if (typeof step === "function") {
    return { name: step.name || "anonymous", fn: step };
  }
  return step;
}

function generateSeed(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let seed = 0n;
  for (const b of bytes) {
    seed = (seed << 8n) | BigInt(b);
  }
  return seed;
}

export function generateSeeds(runs: number): bigint[] {
  const envSeed = process.env.FUZZ_SEED;
  if (envSeed) {
    return [BigInt(envSeed)];
  }
  return Array.from({ length: runs }, () => generateSeed());
}

export async function fuzz<S>(config: FuzzConfig<S>, seed: bigint): Promise<void> {
  const { connection, networkHelpers, signers } = await setupTestContext();
  const deployFixture = async () => ssvNetworkFullFixture(connection);
  const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);

  const rng = new SeededRNG(seed);
  const blocksPerTick = config.blocksPerTick ?? DEFAULT_BLOCKS_PER_TICK;

  const baseCtx: FuzzContext<undefined> = {
    connection,
    networkHelpers,
    provider: connection.ethers.provider,
    network,
    views,
    ssvToken,
    cssvToken,
    signers,
    rng,
    state: undefined,
    tick: -1,
  };

  const state = await config.setup(baseCtx);

  const ctx: FuzzContext<S> = { ...baseCtx, state };
  const resolved = config.steps.map(resolveStep);

  for (let tick = 0; tick < config.ticks; tick++) {
    ctx.tick = tick;

    const blocks = Number(rng.nextInRange(blocksPerTick.min, blocksPerTick.max));
    await mineBlocks(ctx.provider, blocks);

    for (let i = 0; i < resolved.length; i++) {
      const { name, fn } = resolved[i];
      try {
        await fn(ctx);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        throw new Error(
          `Tick ${tick}, step ${i} [${name}] failed:\n` +
          `  Reproduce: FUZZ_SEED=${seed} npx hardhat test <testfile>\n` +
          `  ${msg}`,
        );
      }
    }
  }

  if (config.expectedPhase !== undefined) {
    const phase = (ctx.state as any)?.phase;
    if (phase !== config.expectedPhase) {
      throw new Error(
        `Fuzz run ended in phase "${phase}" but expected "${config.expectedPhase}".\n` +
        `  Reproduce: FUZZ_SEED=${seed} npx hardhat test <testfile>`,
      );
    }
  }

  if (config.after) {
    try {
      await config.after(ctx);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      throw new Error(
        `after() hook failed:\n` +
        `  Reproduce: FUZZ_SEED=${seed} npx hardhat test <testfile>\n` +
        `  ${msg}`,
      );
    }
  }
}
