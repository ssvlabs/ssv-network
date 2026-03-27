/**
 * Barrel export for simulation infrastructure.
 */

// Types
export type {
  Cluster,
  ClusterVersion,
  ClusterRecord,
  OperatorRecord,
  StakerRecord,
  ActionResult,
  BookkeepingTotals,
  SimulationState,
  ActionWeights,
} from "./types.ts";
export { VERSION_SSV, VERSION_ETH } from "./types.ts";

// RNG
export { SeededRNG } from "./rng.ts";

// Coverage
export {
  CoverageTracker,
  buildStateTag,
  clusterSizeTag,
  validatorBucketTag,
  solvencyTag,
} from "./coverage.ts";
export type {
  StateTag,
  ClusterSizeTag,
  ValidatorBucketTag,
  EBModeTag,
  SolvencyTag,
  FeePhaseTag,
  TopologyTag,
  TransitionRecord,
} from "./coverage.ts";

// State discovery
export {
  discoverOperators,
  discoverClusters,
  sampleOperators,
} from "./state-discovery.ts";
export type { DiscoveredCluster } from "./state-discovery.ts";

// Bookkeeping
export {
  clusterKey,
  parseClusterFromReceipt,
  updateClusterFromReceipt,
  trackEthFlow,
  trackSsvFlow,
  trackStakingFlow,
  trackRewardsClaimed,
  emptyTotals,
} from "./bookkeeping.ts";
export type { FlowDirection } from "./bookkeeping.ts";

// Weight schedule
export {
  getActionWeights,
  selectAction,
  weightsSummary,
} from "./weight-schedule.ts";

// Logger
export { SimLogger } from "./sim-logger.ts";
export type { SimSummary } from "./sim-logger.ts";

// Invariants
export {
  runPeriodicInvariants,
  runFinalInvariants,
  createInvariantContext,
} from "./invariants.ts";
export type { InvariantResult, InvariantContext } from "./invariants.ts";
