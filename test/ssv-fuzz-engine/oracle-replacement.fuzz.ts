import { expect } from "chai";
import { ethers } from "ethers";
import { fuzz, generateSeeds } from "./core/runner.ts";
import type { FuzzContext } from "./core/types.ts";
import { DEFAULT_FUZZ_SEED_COUNT } from "./core/fuzz-helpers.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { Events } from "../common/events.ts";
import { STAKE_AMOUNT } from "../common/constants.ts";

interface State {
  oracles: (HardhatEthersSigner | null)[];
  spareSigners: HardhatEthersSigner[];
  lastCommittedBlock: bigint;
  rootCounter: number;
}

function makeRoot(ctx: FuzzContext<State>, prefix: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`${prefix}-${ctx.state.rootCounter++}`));
}

function findRootCommitted(ctx: FuzzContext<State>, receipt: any): boolean {
  for (const log of receipt.logs ?? []) {
    try {
      if (ctx.network.interface.parseLog(log)?.name === Events.ROOT_COMMITTED) return true;
    } catch {}
  }
  return false;
}

async function tryCommitRoot(
  ctx: FuzzContext<State>, signer: HardhatEthersSigner, root: string, blockNum: bigint,
): Promise<{ committed: boolean } | null> {
  try {
    const receipt = await (await ctx.network.connect(signer).commitRoot(root, blockNum)).wait();
    return { committed: findRootCommitted(ctx, receipt) };
  } catch {
    return null;
  }
}

async function replaceRandomOracle(ctx: FuzzContext<State>): Promise<void> {
  const { oracles, spareSigners } = ctx.state;
  if (spareSigners.length === 0) return;

  const slotIdx = Number(ctx.rng.nextInRange(0n, BigInt(oracles.length - 1)));
  const oldOracle = oracles[slotIdx];
  oracles[slotIdx] = spareSigners.pop()!;
  await ctx.network.replaceOracle(slotIdx + 1, oracles[slotIdx]!.address);

  if (oldOracle !== null) {
    await expect(
      ctx.network.connect(oldOracle).commitRoot(makeRoot(ctx, "reject"), BigInt(await ctx.provider.getBlockNumber())),
    ).to.be.revertedWithCustomError(ctx.network, "NotOracle");
  }

  await tryCommitRoot(ctx, oracles[slotIdx]!, makeRoot(ctx, "new-oracle"), BigInt(await ctx.provider.getBlockNumber()));
}

async function achieveQuorum(ctx: FuzzContext<State>): Promise<void> {
  const active = ctx.state.oracles.filter((o): o is HardhatEthersSigner => o !== null);
  if (active.length < 3) return;

  const blockNum = BigInt(await ctx.provider.getBlockNumber());
  if (blockNum <= ctx.state.lastCommittedBlock) return;

  const root = makeRoot(ctx, "quorum");
  let committed = false;
  for (const voter of ctx.rng.shuffle([...active]).slice(0, 3)) {
    const result = await tryCommitRoot(ctx, voter, root, blockNum);
    if (result?.committed) committed = true;
  }
  if (committed) ctx.state.lastCommittedBlock = blockNum;
}

async function partialVoteThenReplace(ctx: FuzzContext<State>): Promise<void> {
  const { oracles, spareSigners } = ctx.state;
  if (spareSigners.length === 0) return;

  const active = oracles.filter((o): o is HardhatEthersSigner => o !== null);
  if (active.length < 3) return;

  const blockNum = BigInt(await ctx.provider.getBlockNumber());
  if (blockNum <= ctx.state.lastCommittedBlock) return;

  const root = makeRoot(ctx, "partial");
  const first = await tryCommitRoot(ctx, active[0], root, blockNum);
  if (first === null) return;
  expect(first.committed).to.equal(false);

  const replaceIdx = Number(ctx.rng.nextInRange(0n, BigInt(oracles.length - 1)));
  oracles[replaceIdx] = spareSigners.pop()!;
  await ctx.network.replaceOracle(replaceIdx + 1, oracles[replaceIdx]!.address);

  let committed = false;
  for (const voter of oracles.filter((o): o is HardhatEthersSigner => o !== null && o !== active[0]).slice(0, 2)) {
    const result = await tryCommitRoot(ctx, voter, root, blockNum);
    if (result?.committed) committed = true;
  }
  if (committed) ctx.state.lastCommittedBlock = blockNum;
}

async function nonOracleRejected(ctx: FuzzContext<State>): Promise<void> {
  const oracleAddrs = new Set(ctx.state.oracles.filter(o => o !== null).map(o => o!.address));
  const nonOracle = ctx.signers.find(s => !oracleAddrs.has(s.address) && s !== ctx.signers[0] && s !== ctx.signers[1]);
  if (!nonOracle) return;

  await expect(
    ctx.network.connect(nonOracle).commitRoot(makeRoot(ctx, "non-oracle"), BigInt(await ctx.provider.getBlockNumber())),
  ).to.be.revertedWithCustomError(ctx.network, "NotOracle");
}

async function doubleVoteRejected(ctx: FuzzContext<State>): Promise<void> {
  const active = ctx.state.oracles.filter((o): o is HardhatEthersSigner => o !== null);
  if (active.length === 0) return;

  const blockNum = BigInt(await ctx.provider.getBlockNumber());
  if (blockNum <= ctx.state.lastCommittedBlock) return;

  const voter = ctx.rng.pick(active);
  const root = makeRoot(ctx, "double");
  if (await tryCommitRoot(ctx, voter, root, blockNum) === null) return;

  await expect(
    ctx.network.connect(voter).commitRoot(root, blockNum),
  ).to.be.revertedWithCustomError(ctx.network, "AlreadyVoted");
}

const ACTIONS = [
  { fn: replaceRandomOracle, weight: 10 },
  { fn: achieveQuorum, weight: 15 },
  { fn: partialVoteThenReplace, weight: 8 },
  { fn: nonOracleRejected, weight: 10 },
  { fn: doubleVoteRejected, weight: 10 },
];
const WEIGHTS = ACTIONS.map(a => a.weight);

const seeds = generateSeeds(DEFAULT_FUZZ_SEED_COUNT);

describe("Fuzz: oracle chaos — replacements, voting, and access control", function () {
  for (const seed of seeds) {
    it(`Validates oracle replacement during voting — old oracle rejected, new oracle completes quorum with seed=${seed}`, async function () {
      await fuzz<State>({
        ticks: 30,
        blocksPerTick: { min: 1n, max: 10n },

        async setup(ctx) {
          const staker = ctx.signers[1];
          await ctx.ssvToken.mint(staker.address, STAKE_AMOUNT);
          await ctx.ssvToken.connect(staker).approve(await ctx.network.getAddress(), STAKE_AMOUNT);
          await ctx.network.connect(staker).stake(STAKE_AMOUNT);

          const oracles: (HardhatEthersSigner | null)[] = [
            ctx.signers[10], ctx.signers[11], ctx.signers[12], ctx.signers[13],
          ];
          for (let i = 0; i < 4; i++) {
            await ctx.network.replaceOracle(i + 1, oracles[i]!.address);
          }

          return {
            oracles,
            spareSigners: [ctx.signers[14], ctx.signers[15], ctx.signers[16], ctx.signers[17], ctx.signers[18], ctx.signers[19]],
            lastCommittedBlock: 0n,
            rootCounter: 0,
          };
        },

        steps: [async (ctx) => { await ACTIONS[ctx.rng.weightedIndex(WEIGHTS)].fn(ctx); }],
      }, seed);
    });
  }
});
