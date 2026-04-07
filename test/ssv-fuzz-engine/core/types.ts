import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { SSVNetwork, SSVNetworkViews, SSVToken, CSSVToken } from "../../../types/ethers-contracts/index.js";
import type { Cluster } from "../../common/types.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { SeededRNG } from "../../simulation/rng.ts";

export interface FuzzContext<S = any> {
  connection: NetworkConnection<"generic">;
  networkHelpers: NetworkHelpersType;
  provider: any;
  network: SSVNetwork;
  views: SSVNetworkViews;
  ssvToken: SSVToken;
  cssvToken: CSSVToken;
  signers: HardhatEthersSigner[];
  rng: SeededRNG;
  state: S;
  tick: number;
}

export type SetupFn<S> = (ctx: FuzzContext<undefined>) => Promise<S>;
export type StepFn<S> = (ctx: FuzzContext<S>) => Promise<void>;

export type NamedStep<S> = { name: string; fn: StepFn<S> };

export interface FuzzConfig<S> {
  ticks: number;
  blocksPerTick?: { min: bigint; max: bigint };
  setup: SetupFn<S>;
  steps: (StepFn<S> | NamedStep<S>)[];
  expectedPhase?: string;
  after?: (ctx: FuzzContext<S>) => Promise<void>;
}

export interface OperatorRecord {
  id: number;
  fee: bigint;
  owner: HardhatEthersSigner;
}

export interface ClusterRecord {
  cluster: Cluster;
  operatorIds: number[];
  owner: HardhatEthersSigner;
  validatorKeys: string[];
}
