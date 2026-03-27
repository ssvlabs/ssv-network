import type { Cluster } from "../common/types.ts";

export type ClusterSizeTag = "ops-4" | "ops-7" | "ops-10" | "ops-13";
export type ValidatorBucketTag = "validators-1" | "validators-2" | "validators-4plus";
export type EBModeTag = "implicit" | "explicit-32" | "explicit-high" | "explicit-max-safe";
export type SolvencyTag = "healthy" | "threshold-edge" | "liquidatable" | "liquidated";
export type FeePhaseTag = "flat" | "declared" | "executed";
export type TopologyTag = "single-cluster" | "dual-cluster-shared-operators";

export interface StateTag {
  clusterSize: ClusterSizeTag;
  validatorBucket: ValidatorBucketTag;
  ebMode: EBModeTag;
  solvency: SolvencyTag;
  feePhase: FeePhaseTag;
  topology: TopologyTag;
  lastAction: string;
}

export interface TransitionInput {
  family?: string;
  seed?: bigint;
  action: string;
  preTag: StateTag;
  postTag: StateTag;
}

export interface TransitionRecord extends TransitionInput {
  novel: boolean;
}

const CLUSTER_SIZE_TAGS: ClusterSizeTag[] = ["ops-4", "ops-7", "ops-10", "ops-13"];
const VALIDATOR_TAGS: ValidatorBucketTag[] = ["validators-1", "validators-2", "validators-4plus"];
const EB_MODE_TAGS: EBModeTag[] = ["implicit", "explicit-32", "explicit-high", "explicit-max-safe"];
const SOLVENCY_TAGS: SolvencyTag[] = ["healthy", "threshold-edge", "liquidatable", "liquidated"];
const FEE_PHASE_TAGS: FeePhaseTag[] = ["flat", "declared", "executed"];
const TOPOLOGY_TAGS: TopologyTag[] = ["single-cluster", "dual-cluster-shared-operators"];

function tagKey(tag: StateTag): string {
  return [
    tag.clusterSize,
    tag.validatorBucket,
    tag.ebMode,
    tag.solvency,
    tag.feePhase,
    tag.topology,
  ].join("|");
}

function transitionKey(input: TransitionInput): string {
  return `${tagKey(input.preTag)}->${input.action}->${tagKey(input.postTag)}`;
}

export function clusterSizeTag(operatorCount: number): ClusterSizeTag {
  if (operatorCount >= 13) return "ops-13";
  if (operatorCount >= 10) return "ops-10";
  if (operatorCount >= 7) return "ops-7";
  return "ops-4";
}

export function validatorBucketTag(validatorCount: bigint): ValidatorBucketTag {
  if (validatorCount >= 4n) return "validators-4plus";
  if (validatorCount >= 2n) return "validators-2";
  return "validators-1";
}

export function solvencyTag(cluster: Cluster, liquidationThreshold: bigint): SolvencyTag {
  if (!cluster.active) {
    return "liquidated";
  }
  if (cluster.balance < liquidationThreshold) {
    return "liquidatable";
  }
  if (cluster.balance <= liquidationThreshold + liquidationThreshold / 20n) {
    return "threshold-edge";
  }
  return "healthy";
}

export function buildStateTag(input: {
  cluster: Cluster;
  operatorCount: number;
  liquidationThreshold: bigint;
  ebMode: EBModeTag;
  feePhase: FeePhaseTag;
  topology: TopologyTag;
  lastAction: string;
}): StateTag {
  return {
    clusterSize: clusterSizeTag(input.operatorCount),
    validatorBucket: validatorBucketTag(input.cluster.validatorCount),
    ebMode: input.ebMode,
    solvency: solvencyTag(input.cluster, input.liquidationThreshold),
    feePhase: input.feePhase,
    topology: input.topology,
    lastAction: input.lastAction,
  };
}

export class CoverageTracker {
  private readonly coveredTags = new Set<string>();
  private readonly coveredTransitions = new Set<string>();
  private readonly transitionLog: TransitionRecord[] = [];

  recordTransition(input: TransitionInput): TransitionRecord {
    const transition = transitionKey(input);
    const novel = !this.coveredTransitions.has(transition);
    this.coveredTags.add(tagKey(input.preTag));
    this.coveredTags.add(tagKey(input.postTag));
    this.coveredTransitions.add(transition);

    const record: TransitionRecord = {
      ...input,
      novel,
    };
    this.transitionLog.push(record);
    return record;
  }

  get coveredTransitionCount(): number {
    return this.coveredTransitions.size;
  }

  get coveredTagCount(): number {
    return this.coveredTags.size;
  }

  get novelTransitions(): TransitionRecord[] {
    return this.transitionLog.filter((record) => record.novel);
  }

  getUncoveredStateCombos(limit = 8): string[] {
    const uncovered: string[] = [];

    for (const clusterSize of CLUSTER_SIZE_TAGS) {
      for (const validatorBucket of VALIDATOR_TAGS) {
        for (const ebMode of EB_MODE_TAGS) {
          for (const solvency of SOLVENCY_TAGS) {
            for (const feePhase of FEE_PHASE_TAGS) {
              for (const topology of TOPOLOGY_TAGS) {
                const key = [
                  clusterSize,
                  validatorBucket,
                  ebMode,
                  solvency,
                  feePhase,
                  topology,
                ].join("|");
                if (!this.coveredTags.has(key)) {
                  uncovered.push(key);
                  if (uncovered.length >= limit) {
                    return uncovered;
                  }
                }
              }
            }
          }
        }
      }
    }

    return uncovered;
  }

  formatReport(title = "Coverage Report"): string {
    const uncovered = this.getUncoveredStateCombos();
    const lines = [
      `${title}`,
      `Covered state tags: ${this.coveredTagCount}`,
      `Covered transitions: ${this.coveredTransitionCount}`,
      `Novel transitions: ${this.novelTransitions.length}`,
    ];

    if (uncovered.length > 0) {
      lines.push("Sample uncovered state tags:");
      for (const entry of uncovered) {
        lines.push(`  - ${entry}`);
      }
    }

    return lines.join("\n");
  }
}
