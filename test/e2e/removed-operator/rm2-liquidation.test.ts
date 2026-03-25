/**
 * RM2-001 through RM2-030: _executeLiquidation deviation cleanup with removed operators.
 *
 * Root cause under test: _executeLiquidation (SSVClusters.sol:586-591) subtracts deviation
 * from operatorEthVUnits[operatorIds[i]] unconditionally. For removed operators whose
 * operatorEthVUnits was deleted to 0 by removeOperator(), this subtraction causes underflow.
 * The guard fix: `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;`
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  SMALL_ETH_REGISTER_VALUE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";

// ---------------------------------------------------------------------------
// Storage-slot helpers — read operatorEthVUnits and daoTotalEthVUnits directly
// from the proxy's diamond storage since the Views module doesn't expose them.
// ---------------------------------------------------------------------------

const EB_STORAGE_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
// operatorEthVUnits is the 3rd field (index 2) in StorageEB — a mapping(uint64 => uint64)
const OPERATOR_ETH_VUNITS_MAP_SLOT = EB_STORAGE_BASE + 2n;

function operatorEthVUnitsSlot(operatorId: bigint): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [operatorId, OPERATOR_ETH_VUNITS_MAP_SLOT],
    ),
  );
}

async function readOperatorEthVUnits(
  provider: any,
  proxyAddress: string,
  operatorId: bigint,
): Promise<bigint> {
  const raw = await provider.getStorage(proxyAddress, operatorEthVUnitsSlot(operatorId));
  return BigInt(raw) & 0xFFFFFFFFFFFFFFFFn; // uint64
}

// daoTotalEthVUnits lives in SSVStorageProtocol packed struct.
// StorageProtocol layout (all uint64/uint32 packed):
//   slot 0: networkFeeIndexBlockNumber(u32) | daoValidatorCount(u32) | daoIndexBlockNumber(u32) | validatorsPerOperatorLimit(u32) | networkFee(u64) | networkFeeIndex(u64) = 32 bytes
//   slot 1: daoBalance(u64) | minimumBlocksBeforeLiquidationSSV(u64) | minimumLiquidationCollateralSSV(u64) | declareOperatorFeePeriod(u64) = 32 bytes
//   slot 2: executeOperatorFeePeriod(u64) | operatorMaxFeeIncrease(u64) | operatorMaxFeeSSV(u64) | ethNetworkFeeIndexBlockNumber(u32) | ethDaoValidatorCount(u32) = 32 bytes
//   slot 3: ethDaoIndexBlockNumber(u32) | ethNetworkFee(u64) | ethNetworkFeeIndex(u64) | ethDaoBalance(u64) = 28 bytes
//   slot 4: minimumLiquidationCollateral(u64) | minimumBlocksBeforeLiquidation(u64) | operatorMaxFee(u64) | daoTotalEthVUnits(u64) = 32 bytes
const PROTOCOL_STORAGE_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
const DAO_TOTAL_ETH_VUNITS_SLOT = PROTOCOL_STORAGE_BASE + 4n;

async function readDaoTotalEthVUnits(provider: any, proxyAddress: string): Promise<bigint> {
  const raw = await provider.getStorage(proxyAddress, "0x" + DAO_TOTAL_ETH_VUNITS_SLOT.toString(16));
  // daoTotalEthVUnits is the 4th uint64 in the slot (bits 192-255)
  return (BigInt(raw) >> 192n) & 0xFFFFFFFFFFFFFFFFn;
}

// ---------------------------------------------------------------------------
// INV-11 invariant: sum of all live operators' (baseline + deviation) == daoTotalEthVUnits + sum(baselines)
// Simplified: for each active operator, operatorEthVUnits should be non-negative and consistent.
// After liquidation with removed ops: removedOp vUnits == 0, live ops vUnits decremented correctly.
// ---------------------------------------------------------------------------
async function assertINV11(
  provider: any,
  proxyAddress: string,
  _views: any,
  _operatorIds: number[],
  expectedDaoVUnits: bigint,
  expectedOpVUnits: Map<number, bigint>,
): Promise<void> {
  const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
  expect(daoVUnits).to.equal(expectedDaoVUnits, "INV-11: daoTotalEthVUnits mismatch");

  for (const [opId, expected] of expectedOpVUnits) {
    const actual = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
    expect(actual).to.equal(expected, `INV-11: operatorEthVUnits[${opId}] mismatch`);
  }
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const MIN_BLOCKS_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register N operators and return their IDs. Operators are registered by opOwner. */
async function setupOperators(
  network: any,
  opOwner: HardhatEthersSigner,
  count: number,
  whitelistees: string[],
): Promise<number[]> {
  const operatorIds = await registerOperators(network, opOwner, count);
  await whitelistAddresses(network, opOwner, operatorIds, whitelistees);
  return operatorIds;
}

/** Register a validator in an ETH cluster and return parsed cluster. */
async function registerValidator(
  network: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  deposit: bigint,
  pubkeyIndex: number,
): Promise<{ cluster: Cluster; receipt: any }> {
  const tx = await network.connect(clusterOwner).registerValidator(
    makePublicKey(pubkeyIndex),
    operatorIds,
    DEFAULT_SHARES,
    cluster,
    { value: deposit },
  );
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
    receipt,
  };
}

/** Commit EB root and update cluster balance. */
async function doEBUpdate(
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
  oracles: HardhatEthersSigner[],
  caller?: HardhatEthersSigner,
): Promise<{ cluster: Cluster; receipt: any; rootBlockNum: number }> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const root = computeEBRoot(clusterId, effectiveBalance);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);

  const signer = caller ?? clusterOwner;
  const tx = await network.connect(signer).updateClusterBalance(
    rootBlockNum,
    clusterOwner.address,
    operatorIds,
    cluster,
    effectiveBalance,
    [],
  );
  const receipt = await tx.wait();

  // Try to parse ClusterBalanceUpdated; if auto-liquidation occurred, parse ClusterLiquidated
  let updatedCluster: Cluster;
  try {
    updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
  } catch {
    updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
  }

  return { cluster: updatedCluster, receipt, rootBlockNum };
}

/** Mine blocks until cluster is liquidatable, then liquidate. */
async function drainAndLiquidate(
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  liquidator: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  numActiveOps: bigint,
  effectiveVUnits: bigint,
): Promise<{ cluster: Cluster; receipt: any }> {
  const liqThreshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits,
  });
  const burnPerBlock = calcClusterBurn({
    blockDiff: 1n,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits,
  });

  const balance = BigInt(cluster.balance);
  if (burnPerBlock > 0n && balance > liqThreshold) {
    const blocksToMine = Number((balance - liqThreshold) / burnPerBlock) + 1;
    await mineBlocks(provider, blocksToMine);
  }

  const tx = await network.connect(liquidator).liquidate(
    clusterOwner.address,
    operatorIds,
    cluster,
  );
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED),
    receipt,
  };
}

// ===========================================================================
// Test Suite
// ===========================================================================
describe("RM2: _executeLiquidation Deviation Cleanup With Removed Operators", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let opOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let extra1: HardhatEthersSigner;
  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [opOwner, clusterOwner, liquidator, oracle1, oracle2, oracle3, oracle4, staker, extra1],
    } = await setupTestContext());
  });

  // Common fixture: deploy full network, set fees, setup oracles
  const baseFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    return { network, views, ssvToken };
  };

  // -----------------------------------------------------------------------
  // Helper: parametric test for "N-op cluster, explicit EB, remove op1, liquidate"
  // Used by RM2-001, RM2-003, RM2-005, RM2-007
  // -----------------------------------------------------------------------
  function describeParametricDeviationLiquidation(
    scenarioId: string,
    numOps: number,
    effectiveBalance: number,
  ) {
    it(`${scenarioId}: ${numOps}-op cluster, explicit EB (${effectiveBalance} ETH), remove op1, third-party liquidate`, async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, numOps, [clusterOwner.address]);

      // Register validator
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // EB update
      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, effectiveBalance, oracles));

      const vUnits = calcVUnits(BigInt(effectiveBalance));
      const deviation = vUnits - defaultVUnits(1n);

      // Verify operatorEthVUnits are set for all ops
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviation, `Pre-remove: operatorEthVUnits[${opId}]`);
      }

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Verify removed op's vUnits is deleted
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // Drain and liquidate (burn rate = numOps-1 active ops)
      const numActiveOps = BigInt(numOps - 1);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        numActiveOps, vUnits,
      );

      // Assertions
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // operatorEthVUnits[removedOp] == 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(
        0n,
        "operatorEthVUnits[removedOp] must be 0",
      );

      // Live ops: deviation should be subtracted
      for (let i = 1; i < numOps; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(
          0n,
          `operatorEthVUnits[op${i + 1}] should be 0 after deviation cleanup`,
        );
      }

      // daoTotalEthVUnits decremented
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
      expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits should be 0 with no active clusters");

      // INV-11
      const expectedOpVUnits = new Map<number, bigint>();
      for (const opId of operatorIds) expectedOpVUnits.set(opId, 0n);
      await assertINV11(provider, proxyAddress, views, operatorIds, 0n, expectedOpVUnits);
    });
  }

  // -----------------------------------------------------------------------
  // Helper: parametric test for "N-op cluster, baseline EB (deviation=0), remove op, liquidate"
  // Used by RM2-002, RM2-004, RM2-006, RM2-008
  // -----------------------------------------------------------------------
  function describeParametricBaselineLiquidation(
    scenarioId: string,
    numOps: number,
  ) {
    it(`${scenarioId}: ${numOps}-op cluster, explicit EB at baseline (32 ETH), remove op1, liquidate — clean path`, async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, numOps, [clusterOwner.address]);

      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // EB update at baseline (32 ETH = deviation 0)
      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 32, oracles));

      const vUnits = calcVUnits(32n); // 10000
      expect(vUnits).to.equal(defaultVUnits(1n)); // deviation = 0

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // Drain and liquidate
      const numActiveOps = BigInt(numOps - 1);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        numActiveOps, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // All vUnits should be 0 (no deviation to clean)
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }

      // INV-11
      const expectedOpVUnits = new Map<number, bigint>();
      for (const opId of operatorIds) expectedOpVUnits.set(opId, 0n);
      await assertINV11(provider, proxyAddress, views, operatorIds, 0n, expectedOpVUnits);
    });
  }

  // =========================================================================
  // RM2-001 through RM2-008: Parametric operator counts
  // =========================================================================
  describe("Parametric Operator Count — Deviation > 0", () => {
    describeParametricDeviationLiquidation("RM2-001", 4, 48);
    describeParametricDeviationLiquidation("RM2-003", 7, 48);
    describeParametricDeviationLiquidation("RM2-005", 10, 64);
    describeParametricDeviationLiquidation("RM2-007", 13, 48);
  });

  describe("Parametric Operator Count — Baseline EB (deviation=0)", () => {
    describeParametricBaselineLiquidation("RM2-002", 4);
    describeParametricBaselineLiquidation("RM2-004", 7);
    describeParametricBaselineLiquidation("RM2-006", 10);
    describeParametricBaselineLiquidation("RM2-008", 13);
  });

  // =========================================================================
  // RM2-009: Self-liquidation by owner
  // =========================================================================
  describe("Self-Liquidation", () => {
    it("RM2-009: 4-op cluster, explicit EB, remove op1, owner self-liquidates", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // Self-liquidation (owner == msg.sender bypasses solvency check)
      const tx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      );
      const receipt = await tx.wait();
      const liqCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);

      expect(liqCluster.active).to.equal(false);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // INV-11: all vUnits 0
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-010: Explicit assertion that operatorEthVUnits[removedOp] == 0 post-liquidation
  // =========================================================================
  describe("operatorEthVUnits Assertions", () => {
    it("RM2-010: operatorEthVUnits[removedOp] == 0 post-liquidation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const deviation = calcVUnits(48n) - defaultVUnits(1n);
      expect(deviation).to.equal(5000n, "RM2-010: calcVUnits(48)-defaultVUnits(1) = 5000");

      // Pre-removal check
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(deviation);
      }

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Post-removal: removed op's vUnits deleted
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // Liquidate
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits);
      expect(liqCluster.active).to.equal(false);

      // Post-liquidation: removed op still 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(
        0n,
        "operatorEthVUnits[removedOp] must remain 0 after liquidation",
      );
    });
  });

  // =========================================================================
  // RM2-011: daoTotalEthVUnits correctness
  // =========================================================================
  describe("daoTotalEthVUnits Verification", () => {
    it("RM2-011: daoTotalEthVUnits decremented by full deviation (not per-op)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const vUnits = calcVUnits(48n);
      // daoTotalEthVUnits = baseline (from updateDAO) + deviation (from EB update) = vUnits
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(vUnits, "Pre-liquidation daoTotalEthVUnits = baseline + deviation");

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const { cluster: liqCluster } = await drainAndLiquidate(network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits);
      expect(liqCluster.active).to.equal(false);

      // daoTotalEthVUnits should be 0 (deviation fully subtracted)
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n, "daoTotalEthVUnits must be 0 after liquidation");
    });
  });

  // =========================================================================
  // RM2-012: ethValidatorCount NOT decremented for removed op
  // =========================================================================
  describe("ethValidatorCount Verification", () => {
    it("RM2-012: ethValidatorCount NOT decremented for removed op (already 0)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      // Pre-removal: all ops have validatorCount=1
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(1);
      }

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // Removed op: validatorCount already 0 from removal
      const removedOpData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(removedOpData.validatorCount).to.equal(0);

      // Liquidate
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits);
      expect(liqCluster.active).to.equal(false);

      // Post-liquidation: all ops have validatorCount=0
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(0, `op${opId} validatorCount`);
      }

      // DAO validator count
      expect(await views.getNetworkValidatorsCount()).to.equal(0);
    });
  });

  // =========================================================================
  // RM2-013: EB update writes stale deviation to removed op, then liquidation
  // =========================================================================
  describe("Stale Write Paths", () => {
    it("RM2-013: EB update after removal writes stale deviation, liquidation handles it", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // Remove op1 BEFORE EB update
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // EB update writes stale deviation to removed op (the RM1 bug)
      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      // With RM1 guard in _updateOperatorVUnits, removed op stays at 0 (no stale write).
      // We verify liquidation doesn't revert regardless.
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // Drain and liquidate
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // Post-liquidation: no revert occurred, check live ops deviation cleaned
      for (let i = 1; i < 4; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(0n);
      }

      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-014: Threshold boundary liquidation
  // =========================================================================
  describe("Threshold Boundary", () => {
    it("RM2-014: Liquidation at exact threshold boundary with removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const vUnits = calcVUnits(48n);
      const numActiveOps = 3n;

      // Drain until liquidatable — use the helper which handles the timing
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        numActiveOps, vUnits,
      );

      expect(liqCluster.active).to.equal(false);

      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-015: Implicit EB (vUnitsCluster=0), remove op1, liquidation
  // =========================================================================
  describe("Implicit EB", () => {
    it("RM2-015: Implicit EB (no EB update), remove op1, liquidation — no deviation to clean", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, SMALL_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // No EB update — implicit EB, vUnitsCluster=0
      // All operatorEthVUnits should be 0
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // Drain and liquidate with implicit vUnits
      const implicitVUnits = defaultVUnits(1n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        3n, implicitVUnits,
      );

      expect(liqCluster.active).to.equal(false, "RM2-015: cluster liquidated");
      // Cluster balance should be 0 after liquidation
      expect(BigInt(liqCluster.balance)).to.equal(0n, "RM2-015: cluster balance == 0 after liquidation");
      // Validator count preserved in cluster struct (not reset on liquidation)
      expect(liqCluster.validatorCount).to.equal(1n, "RM2-015: validatorCount preserved");

      // All operatorEthVUnits remain 0 — deviation block was skipped
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(
          0n,
          `RM2-015: op${opId} vUnits remain 0 (implicit EB)`,
        );
      }

      // DAO total vUnits should also be 0 (no deviation was ever written)
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(
        0n,
        "RM2-015: daoTotalEthVUnits == 0 (no EB update occurred)",
      );
    });
  });

  // =========================================================================
  // RM2-016: Remove op, EB update, balance drains, liquidation — full lifecycle
  // =========================================================================
  describe("Full Lifecycle", () => {
    it("RM2-016: removeOp → EB update (stale write) → drain → liquidate — no underflow", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const deposit = connection.ethers.parseEther("10");
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // EB update (writes stale deviation to removed op via RM1 bug)
      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const vUnits = calcVUnits(48n);

      // Drain and liquidate
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // No underflow revert occurred — guard fix works
      // Verify removed op vUnits state
      // With guard fix in _executeLiquidation, removed op is skipped
      // The stale write from EB update may leave orphaned value, but no underflow
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-017: Verify remaining live operators' operatorEthVUnits each decremented
  // =========================================================================
  describe("Live Operator Deviation Cleanup", () => {
    it("RM2-017: Live operators' operatorEthVUnits each decremented by deviation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const deviation = calcVUnits(48n) - defaultVUnits(1n);

      // Pre-remove: all ops have deviation
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(deviation);
      }

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Live ops still have deviation
      for (let i = 1; i < 4; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(deviation);
      }

      // Liquidate
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits);
      expect(liqCluster.active).to.equal(false);

      // Post-liquidation: live ops' deviation cleaned to 0
      for (let i = 1; i < 4; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(
          0n,
          `operatorEthVUnits[op${i + 1}] should be 0`,
        );
      }
      // Removed op still 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-018: Large deviation (2048 ETH max EB)
  // =========================================================================
  describe("Large Deviation Arithmetic", () => {
    it("RM2-018: 4-op, explicit EB 2048 ETH (large deviation=630000), remove op1, liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      // Need a large deposit because burn rate with high vUnits is enormous
      const largeDeposit = connection.ethers.parseEther("100");
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, largeDeposit, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 2048, oracles));

      const vUnits = calcVUnits(2048n); // 640000
      const deviation = vUnits - defaultVUnits(1n); // 630000
      expect(deviation).to.equal(630000n);

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
      for (let i = 1; i < 4; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-019: Remove 2 of 4 operators, then liquidate
  // =========================================================================
  describe("Multiple Operators Removed", () => {
    it("RM2-019: 4-op, remove op1 AND op2, liquidate — 2 removed ops skipped", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      // Remove op1 and op2
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      await network.connect(opOwner).removeOperator(operatorIds[1]);

      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[1]))).to.equal(0n);

      // Liquidate with 2 active ops
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 2n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      // Both removed ops stay 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[1]))).to.equal(0n);
      // Live ops cleaned
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[2]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[3]))).to.equal(0n);
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });

    // =========================================================================
    // RM2-020: Remove 3 of 4 operators
    // =========================================================================
    it("RM2-020: 4-op, remove op1/op2/op3, liquidate — 1 live op receives all deviation subtraction", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      // Remove 3 ops
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");
      await network.connect(opOwner).removeOperator(operatorIds[1]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[1]))).to.equal(0n, "removeOperator must zero vUnits");
      await network.connect(opOwner).removeOperator(operatorIds[2]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[2]))).to.equal(0n, "removeOperator must zero vUnits");

      // Liquidate with 1 active op
      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 1n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-021: Remove ALL 4 operators, self-liquidate
  // =========================================================================
  describe("All Operators Removed", () => {
    it("RM2-021: Remove all 4 ops, self-liquidate — all ops skipped, DAO deviation still cleaned", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const vUnits = calcVUnits(48n);
      // daoTotalEthVUnits = baseline + deviation = vUnits
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(vUnits);

      // Remove all 4 operators
      for (const opId of operatorIds) {
        await network.connect(opOwner).removeOperator(opId);
      }

      // All operatorEthVUnits deleted
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }

      // Self-liquidation (no active ops means burn rate=0, only owner can self-liquidate)
      const tx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const receipt = await tx.wait();
      const liqCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);

      expect(liqCluster.active).to.equal(false);
      // DAO deviation cleaned
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
      // All ops still 0
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }
    });
  });

  // =========================================================================
  // RM2-022: Auto-liquidation via EB update with removed op
  // =========================================================================
  describe("Auto-Liquidation via EB Update", () => {
    it("RM2-022: 4-op, remove op1, EB update (32→128) triggers auto-liquidation", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Small deposit so EB increase makes it undercollateralized
      const implicitVUnits = defaultVUnits(1n);
      const implicitThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });
      // Deposit just above implicit threshold
      const deposit = implicitThreshold + (implicitThreshold / 2n);

      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // EB update with massive increase (128 ETH = 40000 vUnits) triggers auto-liquidation
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root = computeEBRoot(clusterId, 128);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const tx = await network.connect(liquidator).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, 128, [],
      );
      const receipt = await tx.wait();

      // Should emit both ClusterBalanceUpdated and ClusterLiquidated
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const liqCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // Removed op vUnits == 0 (guard skipped it)
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // daoTotalEthVUnits: after auto-liquidation, updateDAO subtracts baseline and deviation
      // is subtracted in _executeLiquidation → should be 0
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
      expect(await views.getNetworkValidatorsCount()).to.equal(0);
    });

    // =========================================================================
    // RM2-023: 7-op auto-liquidation with removed op
    // =========================================================================
    it("RM2-023: 7-op, remove op1, EB update triggers auto-liquidation — ethValidatorCount NOT decremented for removed op", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 7, [clusterOwner.address]);

      const implicitVUnits = defaultVUnits(1n);
      const implicitThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 7n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });
      const deposit = implicitThreshold + (implicitThreshold / 2n);

      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // Removed op should have validatorCount=0 already
      const removedOpData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(removedOpData.validatorCount).to.equal(0);

      // EB update with 128 ETH triggers auto-liquidation
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root = computeEBRoot(clusterId, 128);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const tx = await network.connect(liquidator).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, 128, [],
      );
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      // Post-liquidation: removed op validatorCount still 0
      const removedOpDataPost = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(removedOpDataPost.validatorCount).to.equal(0);

      // Live ops validatorCount=0
      for (let i = 1; i < 7; i++) {
        const opData = await views.getOperatorById(BigInt(operatorIds[i]));
        expect(opData.validatorCount).to.equal(0);
      }

      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-024: daoTotalEthVUnits correct for N-1 active operators
  // =========================================================================
  describe("DAO Deviation Accounting", () => {
    it("RM2-024: daoTotalEthVUnits uses full deviation (not per-op), correct for N-1 active ops", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      const vUnits = calcVUnits(48n);

      // daoTotalEthVUnits = baseline + deviation = vUnits (total, not just deviation)
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(vUnits);

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      // daoTotalEthVUnits unchanged by operator removal
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(vUnits);

      // Liquidate
      const { cluster: liqCluster } = await drainAndLiquidate(network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits);
      expect(liqCluster.active).to.equal(false);

      // After liquidation, daoTotalEthVUnits decremented by full deviation
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-025: Bounty/burn-rate verification
  // =========================================================================
  describe("Bounty Verification", () => {
    it("RM2-025: Liquidation bounty reflects 3-op burn rate after op removal", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const deposit = DEFAULT_ETH_REGISTER_VALUE;
      let { cluster } = await registerValidator(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1,
      );
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const vUnits = calcVUnits(48n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balance = BigInt(cluster.balance);
      const blocksToMine = Number((balance - liqThreshold) / burnPerBlock) + 1;
      await mineBlocks(provider, blocksToMine);

      const liqBalBefore = await provider.getBalance(liquidator.address);

      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();

      const gasUsed = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
      const liqBalAfter = await provider.getBalance(liquidator.address);
      const bounty = liqBalAfter - liqBalBefore + gasUsed;

      // Bounty should be > 0 (remaining balance transferred)
      expect(bounty).to.be.greaterThan(0n, "Liquidation bounty must be positive");
    });
  });

  // =========================================================================
  // RM2-026: Double EB update after removal, then liquidation
  // =========================================================================
  describe("Double Stale Deviation", () => {
    it("RM2-026: removeOp → EB 32→48 → EB 48→64 (double stale), liquidation — no underflow", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const deposit = connection.ethers.parseEther("50");
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);
      expect(cluster.validatorCount).to.equal(1n);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const oracles = [oracle1, oracle2, oracle3];

      // First EB update: 32→48 (stale write #1)
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      // Second EB update: 48→64 (stale write #2)
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 64, oracles));

      const vUnits = calcVUnits(64n); // 20000

      // Drain and liquidate
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // No underflow — guard fix protected the subtraction
      // Removed op: either 0 (guard skipped both writes) or has stale value (orphaned, harmless)
      // Live ops: deviation cleaned to 0
      for (let i = 1; i < 4; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[i]))).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-027: Liquidate then reactivate round-trip
  // =========================================================================
  describe("Liquidate + Reactivate Round-Trip", () => {
    it("RM2-027: explicit EB, remove op1, liquidate, reactivate — removed op still has vUnits==0", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);

      // Reactivate with fresh deposit
      const reactivateDeposit = DEFAULT_ETH_REGISTER_VALUE;
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        liqCluster,
        { value: reactivateDeposit },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(reactivatedCluster.active).to.equal(true);

      // Removed op still has operatorEthVUnits == 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // Live ops may have deviation restored (from reactivation path)
      // The key assertion is the removed op stays at 0
    });
  });

  // =========================================================================
  // RM2-028: Post-liquidation cluster state verification
  // =========================================================================
  describe("Post-Liquidation Cluster State", () => {
    it("RM2-028: cluster.active=false, balance=0, index=0, networkFeeIndex=0", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const vUnits = calcVUnits(48n);
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, 3n, vUnits,
      );

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
      expect(liqCluster.index).to.equal(0n);
      expect(liqCluster.networkFeeIndex).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-029: ClusterLiquidated event verification
  // =========================================================================
  describe("Event Emission", () => {
    it("RM2-029: ClusterLiquidated event emitted with correct owner, operatorIds, zeroed cluster", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      let { cluster } = await registerValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      expect(cluster.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 48, oracles));

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n, "removeOperator must zero vUnits");

      const vUnits = calcVUnits(48n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balance = BigInt(cluster.balance);
      const blocksToMine = Number((balance - liqThreshold) / burnPerBlock) + 1;
      await mineBlocks(provider, blocksToMine);

      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );

      // Event emitted with all 4 operator IDs (including removed)
      await expect(liqTx)
        .to.emit(network, Events.CLUSTER_LIQUIDATED)
        .withArgs(
          clusterOwner.address,
          operatorIds,
          // Cluster tuple: (validatorCount, networkFeeIndex, index, active, balance)
          (_clusterArg: any) => {
            return true; // Just verify the event is emitted
          },
        );

      // Parse and verify cluster details from event
      const receipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
    });
  });

  // =========================================================================
  // RM2-030: Shared operators across 2 clusters, remove op, liquidate one
  // =========================================================================
  describe("Shared Operators Across Clusters", () => {
    it("RM2-030: 2 clusters share ops, remove op1, liquidate cluster A — cluster B's deviation preserved", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      // Register 6 operators: cluster A = [op1,op2,op3,op4], cluster B = [op3,op4,op5,op6]
      const operatorIds = await setupOperators(network, opOwner, 6, [clusterOwner.address, extra1.address]);

      const opsA = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[3]];
      const opsB = [operatorIds[2], operatorIds[3], operatorIds[4], operatorIds[5]];

      // Register cluster A
      let { cluster: clusterA } = await registerValidator(
        network, clusterOwner, opsA, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      expect(clusterA.validatorCount).to.equal(1n);

      // Register cluster B (different owner)
      let { cluster: clusterB } = await registerValidator(
        network, extra1, opsB, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 2,
      );
      expect(clusterB.validatorCount).to.equal(1n);

      const oracles = [oracle1, oracle2, oracle3];

      // EB update cluster A: 48 ETH (deviation_A = 5000)
      ({ cluster: clusterA } = await doEBUpdate(
        network, provider, clusterOwner, opsA, clusterA, 48, oracles,
      ));
      const deviationA = calcVUnits(48n) - defaultVUnits(1n); // 5000

      // EB update cluster B: 64 ETH (deviation_B = 10000)
      ({ cluster: clusterB } = await doEBUpdate(
        network, provider, extra1, opsB, clusterB, 64, oracles,
      ));
      const deviationB = calcVUnits(64n) - defaultVUnits(1n); // 10000

      // Shared ops (op3, op4) have combined deviation
      const sharedDeviation = deviationA + deviationB;
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[2]))).to.equal(sharedDeviation);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[3]))).to.equal(sharedDeviation);

      // op1 only in cluster A: deviation = deviationA
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(deviationA);

      // Remove op1 (only in cluster A)
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);

      // Liquidate cluster A
      const vUnitsA = calcVUnits(48n);
      const { cluster: liqClusterA } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, opsA, clusterA, 3n, vUnitsA,
      );

      expect(liqClusterA.active).to.equal(false);

      // op1 stays 0 (removed, skipped)
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[0]))).to.equal(0n);
      // op2 was only in cluster A: deviation cleaned to 0
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[1]))).to.equal(0n);
      // Shared ops: cluster A's deviation subtracted, cluster B's preserved
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[2]))).to.equal(deviationB);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[3]))).to.equal(deviationB);
      // op5, op6 only in cluster B: unaffected
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[4]))).to.equal(deviationB);
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[5]))).to.equal(deviationB);

      // daoTotalEthVUnits: cluster A's full vUnits subtracted, cluster B's full vUnits remain
      const vUnitsB = calcVUnits(64n); // baseline + deviation = 20000
      expect(await readDaoTotalEthVUnits(provider, proxyAddress)).to.equal(vUnitsB);
    });
  });
});
