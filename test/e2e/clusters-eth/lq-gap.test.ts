/**
 * W7-G: LQ Liquidation/Reactivation Gap Tests
 *
 * Covers 17 untested scenarios identified in scenarios-lq-reactivation.md:
 * LQ-031, LQ-047, LQ-048, LQ-059..063, LQ-070, LQ-074..076, LQ-080,
 * LQ-103..105
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  setupTestContext,
  makeOperatorKey,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  TOKEN_REGISTER_AMOUNT,
  MINIMAL_OPERATOR_FEE_SSV,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcLiquidationThreshold,
  calcVUnits,
  defaultVUnits,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";
import { deployContract } from "../../../scripts/common/helpers.ts";

// ---------------------------------------------------------------------------
// Diamond storage slot helpers
// ---------------------------------------------------------------------------
const EB_STORAGE_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
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
  return BigInt(raw) & 0xFFFFFFFFFFFFFFFFn;
}

const PROTOCOL_STORAGE_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
const DAO_TOTAL_ETH_VUNITS_SLOT = PROTOCOL_STORAGE_BASE + 4n;

async function readDaoTotalEthVUnits(provider: any, proxyAddress: string): Promise<bigint> {
  const raw = await provider.getStorage(proxyAddress, "0x" + DAO_TOTAL_ETH_VUNITS_SLOT.toString(16));
  return (BigInt(raw) >> 192n) & 0xFFFFFFFFFFFFFFFFn;
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const MIN_BLOCKS_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;
const NUM_OPS_4 = 4n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register N operators owned by opOwner and whitelist clusterOwner. */
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

/** Register a validator and return parsed cluster. */
async function regValidator(
  network: any,
  owner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  deposit: bigint,
  pubkeyIdx: number,
): Promise<{ cluster: Cluster; receipt: any }> {
  const tx = await network.connect(owner).registerValidator(
    makePublicKey(pubkeyIdx), operatorIds, DEFAULT_SHARES, cluster,
    { value: deposit },
  );
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
    receipt,
  };
}

/** Commit EB root + updateClusterBalance, return updated cluster. */
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
    rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
  );
  const receipt = await tx.wait();

  let updatedCluster: Cluster;
  try {
    updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
  } catch {
    updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
  }
  return { cluster: updatedCluster, receipt, rootBlockNum };
}

/** Mine blocks until cluster is liquidatable then liquidate. */
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
    clusterOwner.address, operatorIds, cluster,
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
describe("W7-G: LQ Liquidation/Reactivation Gap Tests", () => {
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
  let extra2: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [opOwner, clusterOwner, liquidator, oracle1, oracle2, oracle3, oracle4, staker, extra1, extra2],
    } = await setupTestContext());
  });

  // Standard fixture: full network + network fee + oracles
  const baseFixture = async () => {
    const { network, views, ssvToken, cssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    return { network, views, ssvToken, cssvToken };
  };

  // =========================================================================
  // LQ-031: Auto-liquidation skipped for cluster with validatorCount = 0
  // =========================================================================
  describe("LQ-031: Auto-liquidation skipped when validatorCount = 0", () => {
    it("updateClusterBalance does NOT auto-liquidate a cluster with validatorCount = 0", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register validator then remove it to get validatorCount = 0
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Set explicit EB first (need validatorCount > 0 for this)
      const oracles = [oracle1, oracle2, oracle3];
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 64, oracles));

      // Remove the validator → validatorCount = 0
      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await removeTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // With validatorCount=0, only effectiveBalance=0 passes _verifyEBLimits
      // This exercises the _liquidateAfterEBUpdateIfNeeded short-circuit (validatorCount=0 → return false)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root = computeEBRoot(clusterId, 0);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, oracles);

      // updateClusterBalance should succeed without auto-liquidation
      const tx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, 0, [],
      );
      const receipt = await tx.wait();
      const updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);

      // Cluster remains active — auto-liquidation was skipped (validatorCount = 0)
      expect(updatedCluster.active).to.equal(true);
    });
  });

  // =========================================================================
  // LQ-047: SSV liquidation with minimumLiquidationCollateralSSV as binding floor
  // =========================================================================
  describe("LQ-047: SSV liquidation collateral floor is binding constraint", () => {
    // Separate fixture: needs pre-upgrade SSV cluster
    const ssvClusterFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const OP_SSV_FEE = MINIMAL_OPERATOR_FEE_SSV;
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 100), OP_SSV_FEE, false);
        await legacyNetwork.connect(opOwner)
          .registerOperator(makeOperatorKey(i + 100), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(200), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("SSV cluster liquidatable when balance above burn-rate threshold but below collateral floor", async function () {
      const { network, operatorIds, cluster } = await networkHelpers.loadFixture(ssvClusterFixture);

      // Set collateral floor very high so it becomes binding constraint
      // Value must be divisible by DEDUCTED_DIGITS (10_000_000) to avoid MaxPrecisionExceeded
      const highCollateral = TOKEN_REGISTER_AMOUNT * 2n;
      await network.updateMinimumLiquidationCollateralSSV(highCollateral);

      // The cluster's SSV balance < collateral floor → liquidatable
      const liqTx = await network.connect(liquidator).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);
    });
  });

  // =========================================================================
  // LQ-048: SSV liquidation with validatorCount = 0 — third-party revert
  // =========================================================================
  describe("LQ-048: SSV liquidation reverts when validatorCount = 0", () => {
    const ssvCluster048Fixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const OP_SSV_FEE = MINIMAL_OPERATOR_FEE_SSV;
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 200), OP_SSV_FEE, false);
        await legacyNetwork.connect(opOwner)
          .registerOperator(makeOperatorKey(i + 200), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(201), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("Third-party SSV liquidation reverts ClusterNotLiquidatable for validatorCount = 0", async function () {
      const { network, operatorIds, cluster: initialCluster } =
        await networkHelpers.loadFixture(ssvCluster048Fixture);

      // Remove the SSV validator to get validatorCount = 0
      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(201), operatorIds, initialCluster,
      );
      const cluster = parseClusterFromEvent(network, await removeTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // Third-party liquidation should revert
      await expect(
        network.connect(liquidator).liquidateSSV(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });
  });

  // =========================================================================
  // LQ-059, LQ-060, LQ-061: Reactivation with 7, 10, 13 operators
  // =========================================================================
  function describeReactivateWithNOps(scenarioId: string, numOps: number) {
    it(`${scenarioId}: Reactivate with ${numOps} operators — all operators updated`, async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, numOps, [clusterOwner.address]);
      const numOpsN = BigInt(numOps);

      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: numOpsN,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      // Deposit enough for registration + liquidation drain
      const deposit = liqThreshold * 2n;
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);

      // Drain and liquidate
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, numOpsN, vUnits,
      );
      expect(liqCluster.active).to.equal(false);

      // Reactivate with generous deposit
      const reactivateDeposit = liqThreshold * 3n;
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: reactivateDeposit },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(1n);

      // Verify all operators' ethValidatorCount is restored
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(1n, `operator ${opId} ethValidatorCount`);
      }

      // Verify DAO validator count is restored
      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });
  }

  describe("LQ-059/060/061: Reactivation with 7/10/13 operators", () => {
    describeReactivateWithNOps("LQ-059", 7);
    describeReactivateWithNOps("LQ-060", 10);
    describeReactivateWithNOps("LQ-061", 13);
  });

  // =========================================================================
  // LQ-062: Reactivation with one removed operator
  // =========================================================================
  describe("LQ-062: Reactivation with one removed operator", () => {
    it("Removed operator skipped on reactivation — no ethValidatorCount increment, fee excluded", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register 2 validators
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      ({ cluster } = await regValidator(network, clusterOwner, operatorIds, cluster, DEFAULT_ETH_REGISTER_VALUE, 2));
      expect(cluster.validatorCount).to.equal(2n);

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);

      // Remove operator 3 (index 2)
      await network.connect(opOwner).removeOperator(operatorIds[2]);

      // Verify removed operator has ethValidatorCount = 0
      const removedOpData = await views.getOperatorById(operatorIds[2]);
      expect(removedOpData.validatorCount).to.equal(0n);

      // Reactivate
      const vUnits = defaultVUnits(2n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 3n, // only 3 active ops
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const reactivateDeposit = liqThreshold * 2n;

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(2n);

      // Active operators have ethValidatorCount = 2
      for (const opId of [operatorIds[0], operatorIds[1], operatorIds[3]]) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(2n, `operator ${opId} should have ethValidatorCount = 2`);
      }

      // Removed operator still has ethValidatorCount = 0
      const removedAfter = await views.getOperatorById(operatorIds[2]);
      expect(removedAfter.validatorCount).to.equal(0n, "removed operator ethValidatorCount must stay 0");
    });
  });

  // =========================================================================
  // LQ-063: Reactivation with ALL operators removed
  // =========================================================================
  describe("LQ-063: Reactivation with all operators removed", () => {
    it("All operators skipped — cluster reactivates with zero burn rate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Remove ALL 4 operators
      for (const opId of operatorIds) {
        await network.connect(opOwner).removeOperator(opId);
      }

      // Reactivate — with all operators removed, burnRate = 0 from operators,
      // but network fee still applies, so we need enough to cover networkFee threshold
      const vUnits = defaultVUnits(1n);
      const networkOnlyThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 0n, // zero active operators
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const reactivateDeposit = networkOnlyThreshold + ethers.parseEther("1");
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(1n);

      // All operators should still have 0 ethValidatorCount
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(0n, `removed op ${opId} should stay 0`);
      }

      // DAO validator count should be incremented (updateDAO(true, validatorCount))
      expect(await views.getNetworkValidatorsCount()).to.equal(1);
    });
  });

  // =========================================================================
  // LQ-070: Reactivate then deposit — balance accumulates
  // =========================================================================
  describe("LQ-070: Reactivate then deposit", () => {
    it("Cluster balance = reactivation msg.value + deposit msg.value after fees", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const deposit = liqThreshold + burnPerBlock * 5n;
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, deposit, 1);

      // Drain and liquidate
      const { cluster: liqCluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, NUM_OPS_4, vUnits,
      );

      // Reactivate with generous deposit
      const reactivateAmount = liqThreshold * 3n;
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, liqCluster, { value: reactivateAmount },
      );
      let activeCluster = parseClusterFromEvent(network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);
      expect(activeCluster.active).to.equal(true);
      expect(activeCluster.balance).to.equal(reactivateAmount);

      // Deposit additional ETH
      const additionalDeposit = ethers.parseEther("2");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, activeCluster, { value: additionalDeposit },
      );
      const depCluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // Balance = reactivateAmount + additionalDeposit (deposit settles no fees since same block)
      expect(depCluster.balance).to.equal(reactivateAmount + additionalDeposit);
    });
  });

  // =========================================================================
  // LQ-074: Stale EB risk — reactivation with stale increased EB → auto-liquidation
  // =========================================================================
  describe("LQ-074: Stale EB snapshot on reactivation → auto-liquidation", () => {
    it("Reactivates with stale EB=32, then updateClusterBalance with EB=64 triggers auto-liquidation", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const oracles = [oracle1, oracle2, oracle3];

      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Set explicit EB = 32 (baseline)
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 32, oracles));

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate with just enough for EB=32 solvency
      const vUnits32 = calcVUnits(32n); // 10000
      const threshold32 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits32,
      });

      // Deposit just above 32-ETH threshold but below 64-ETH threshold
      const vUnits64 = calcVUnits(64n); // 20000
      const threshold64 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits64,
      });
      // Explicit EB threshold is exactly 2x implicit (64 ETH vs 32 ETH → vUnits 20000 vs 10000)
      expect(threshold64).to.equal(threshold32 * 2n);

      // Use a deposit between the two thresholds (enough for 32, not for 64)
      const reactivateDeposit = threshold32 + (threshold64 - threshold32) / 2n;
      expect(reactivateDeposit).to.equal(threshold32 + threshold32 / 2n);

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivatedCluster = parseClusterFromEvent(
        network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // Now oracle commits new root with EB = 64 (doubled)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root64 = computeEBRoot(clusterId, 64);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root64, rootBlockNum, oracles);

      // updateClusterBalance with EB=64 should trigger auto-liquidation
      const updateTx = await network.connect(liquidator).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, reactivatedCluster, 64, [],
      );
      await expect(updateTx).to.emit(network, Events.CLUSTER_LIQUIDATED);
      await expect(updateTx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });
  });

  // =========================================================================
  // LQ-075: Stale EB with decreased off-chain EB (slashing) — owner overfunds
  // =========================================================================
  describe("LQ-075: Stale EB with decreased EB — overfunded reactivation succeeds", () => {
    it("Reactivates with stale EB=64, actual EB drops to 32 — overfunded but succeeds", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const oracles = [oracle1, oracle2, oracle3];

      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Set explicit EB = 64 (2x baseline)
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 64, oracles));

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Off-chain EB dropped to 32 (slashing), but on-chain snapshot is still 64
      // Owner funds for EB=64 (overfunding relative to actual EB=32)
      const vUnits64 = calcVUnits(64n);
      const threshold64 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits64,
      });

      const reactivateDeposit = threshold64 * 2n;
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivatedCluster = parseClusterFromEvent(
        network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.balance).to.equal(reactivateDeposit);

      // Later, oracle updates with real EB = 32 — cluster becomes BETTER off (lower threshold)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root32 = computeEBRoot(clusterId, 32);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root32, rootBlockNum, oracles);

      // updateClusterBalance with EB=32 should NOT trigger auto-liquidation (cluster is over-funded)
      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, reactivatedCluster, 32, [],
      );
      await expect(updateTx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      await expect(updateTx).not.to.emit(network, Events.CLUSTER_LIQUIDATED);

      const updatedCluster = parseClusterFromEvent(network, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);
      expect(updatedCluster.active).to.equal(true);
    });
  });

  // =========================================================================
  // LQ-076: Reactivation with removed operator + explicit EB deviation
  // =========================================================================
  describe("LQ-076: Reactivation with removed op + explicit EB deviation", () => {
    it("Deviation added only to active operators' operatorEthVUnits, not removed op", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);
      const oracles = [oracle1, oracle2, oracle3];

      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Set explicit EB = 64 (deviation = 10000)
      ({ cluster } = await doEBUpdate(network, provider, clusterOwner, operatorIds, cluster, 64, oracles));

      const vUnits = calcVUnits(64n); // 20000
      const deviation = vUnits - defaultVUnits(1n); // 10000

      // Verify pre-liquidation: all operators have deviation
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviation, `Pre-liq operatorEthVUnits[${opId}]`);
      }

      // Self-liquidate → deviation cleaned from all ops and DAO
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // All operatorEthVUnits should be 0 after liquidation
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId))).to.equal(0n);
      }

      // Remove operator 3 (index 2)
      await network.connect(opOwner).removeOperator(operatorIds[2]);

      // Reactivate — deviation should be re-applied to active ops only
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const reactivateDeposit = liqThreshold * 3n;

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivatedCluster = parseClusterFromEvent(
        network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // Active operators (0, 1, 3) should have deviation re-applied
      for (const opId of [operatorIds[0], operatorIds[1], operatorIds[3]]) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviation, `operatorEthVUnits[${opId}] should have deviation restored`);
      }

      // Removed operator should have 0 operatorEthVUnits
      expect(await readOperatorEthVUnits(provider, proxyAddress, BigInt(operatorIds[2]))).to.equal(
        0n,
        "removed op operatorEthVUnits must remain 0",
      );

      // DAO tracks baseline + deviation: baseline(1 * 10000) + deviation(10000) = 20000
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
      const expectedDaoVUnits = defaultVUnits(1n) + deviation; // baseline + deviation
      expect(daoVUnits).to.equal(expectedDaoVUnits, "daoTotalEthVUnits = baseline + deviation");
    });
  });

  // =========================================================================
  // LQ-080: Reactivation exceeding validatorsPerOperatorLimit
  // =========================================================================
  describe("LQ-080: Reactivation exceeding validatorsPerOperatorLimit", () => {
    it("Reverts ExceedValidatorLimitWithData when reactivation would exceed operator limit", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address, extra1.address]);

      // Register 2 validators on the operators from clusterOwner
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      ({ cluster } = await regValidator(network, clusterOwner, operatorIds, cluster, DEFAULT_ETH_REGISTER_VALUE, 2));
      expect(cluster.validatorCount).to.equal(2n);

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Now set validatorsPerOperatorLimit to 1 via upgrade
      const { address: upgradeImplAddr } = await deployContract(
        connection.ethers, "SSVNetworkValidatorsPerOperatorUpgrade",
      );
      const factory = await connection.ethers.getContractFactory("SSVNetworkValidatorsPerOperatorUpgrade");
      const initData = factory.interface.encodeFunctionData("initializev2", [1]);
      await network.upgradeToAndCall(upgradeImplAddr, initData);

      // Register 1 validator from extra1 to fill operators to limit
      let extra1Cluster: Cluster;
      ({ cluster: extra1Cluster } = await regValidator(
        network, extra1, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 10,
      ));

      // Now try to reactivate clusterOwner's cluster (validatorCount=2)
      // This would make each operator's ethValidatorCount = 1 + 2 = 3 > limit (1)
      const vUnits = defaultVUnits(2n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds, cluster, { value: liqThreshold * 3n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED);
    });
  });

  // =========================================================================
  // LQ-103: Reactivation with hasDeviation from ANOTHER cluster
  // =========================================================================
  describe("LQ-103: Reactivation with hasDeviation from another active cluster", () => {
    it("Reactivated cluster with clusterDeviation=0 while DAO deviation is non-zero from another cluster", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address, extra1.address]);
      const oracles = [oracle1, oracle2, oracle3];

      // Cluster A (extra1): register + set explicit EB = 64 (creating deviation)
      let { cluster: clusterA } = await regValidator(
        network, extra1, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 50,
      );
      ({ cluster: clusterA } = await doEBUpdate(
        network, provider, extra1, operatorIds, clusterA, 64, oracles,
      ));

      const deviationA = calcVUnits(64n) - defaultVUnits(1n); // 10000

      // Verify operators have deviation from cluster A
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviationA);
      }

      // Cluster B (clusterOwner): register with implicit EB (no deviation), then liquidate
      let { cluster: clusterB } = await regValidator(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 51,
      );

      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, clusterB,
      );
      clusterB = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate cluster B — it has clusterDeviation=0 but operators have non-zero deviation from A
      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, clusterB, { value: liqThreshold * 2n },
      );
      const reactivatedB = parseClusterFromEvent(
        network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(reactivatedB.active).to.equal(true);

      // operatorEthVUnits should still only reflect cluster A's deviation (unchanged by B's reactivation)
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviationA, `operatorEthVUnits[${opId}] should only have cluster A deviation`);
      }

      // DAO tracks baseline + deviation for ALL active clusters:
      // Cluster A: baseline(10000) + deviation(10000) = 20000
      // Cluster B (reactivated, implicit EB): baseline(10000) + deviation(0) = 10000
      // Total: 30000
      const expectedDaoVUnits = defaultVUnits(1n) + deviationA + defaultVUnits(1n); // A(baseline+dev) + B(baseline)
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
      expect(daoVUnits).to.equal(expectedDaoVUnits, "daoTotalEthVUnits = A(baseline+dev) + B(baseline)");
    });
  });

  // =========================================================================
  // LQ-104: Reactivation with additive deviation from multiple clusters
  // =========================================================================
  describe("LQ-104: Reactivation with additive deviation from both clusters", () => {
    it("Both clusters have deviation — reactivation adds cluster deviation to operators additively", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address, extra1.address]);
      const oracles = [oracle1, oracle2, oracle3];

      // Cluster A (extra1): register + set explicit EB = 64
      let { cluster: clusterA } = await regValidator(
        network, extra1, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 60,
      );
      ({ cluster: clusterA } = await doEBUpdate(
        network, provider, extra1, operatorIds, clusterA, 64, oracles,
      ));

      const deviationA = calcVUnits(64n) - defaultVUnits(1n); // 10000

      // Cluster B (clusterOwner): register + set explicit EB = 96
      let { cluster: clusterB } = await regValidator(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 61,
      );
      ({ cluster: clusterB } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, clusterB, 96, oracles,
      ));

      const deviationB = calcVUnits(96n) - defaultVUnits(1n); // 20000
      const totalDeviation = deviationA + deviationB; // 30000

      // Verify combined deviation
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(totalDeviation, `Pre-liq combined deviation for op ${opId}`);
      }

      // Self-liquidate cluster B → deviation B removed
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, clusterB,
      );
      clusterB = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // After liquidation of B: operators should only have deviation A
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(deviationA, `After B liq: op ${opId} should only have deviation A`);
      }

      // Reactivate cluster B — deviation B should be re-added
      const vUnits96 = calcVUnits(96n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits96,
      });

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, clusterB, { value: liqThreshold * 3n },
      );
      const reactivatedB = parseClusterFromEvent(
        network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED,
      );
      expect(reactivatedB.active).to.equal(true);

      // Operators should have A + B deviation again
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, proxyAddress, BigInt(opId));
        expect(opVUnits).to.equal(totalDeviation, `After reactivation: op ${opId} should have combined deviation`);
      }

      // DAO tracks baselines + deviations for all active clusters:
      // A: baseline(10000) + deviation(10000) = 20000
      // B: baseline(10000) + deviation(20000) = 30000
      // Total: 50000
      const expectedDaoVUnits = defaultVUnits(1n) + deviationA + defaultVUnits(1n) + deviationB;
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
      expect(daoVUnits).to.equal(expectedDaoVUnits, "daoTotalEthVUnits = sum(baselines + deviations)");
    });
  });

  // =========================================================================
  // LQ-105: Same-block reactivation (blockDiffEthFee = 0)
  // =========================================================================
  describe("LQ-105: Same-block reactivation — blockDiffEthFee = 0", () => {
    it("Reactivation in same block as liquidation skips snapshot/index/balance accrual", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate immediately (same block if hardhat allows, or next block)
      // The key point: no blocks mined between liquidation and reactivation
      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPS_4,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const reactivateDeposit = liqThreshold * 2n;
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateDeposit },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(reactivatedCluster.active).to.equal(true);
      // Balance should be exactly the deposit (no fee accrual when blockDiff = 0 or 1)
      expect(reactivatedCluster.balance).to.equal(reactivateDeposit);

      // Verify operators are properly restored
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(1n);
      }
    });
  });

  // =========================================================================
  // LQ-010: Liquidation with validatorCount=5, per-operator ethValidatorCount
  // =========================================================================
  describe("LQ-010: Liquidation with validatorCount=5 — per-operator ethValidatorCount zeroed", () => {
    it("Each operator's ethValidatorCount is 0 after liquidating a 5-validator cluster", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register 5 validators
      let cluster = EMPTY_CLUSTER;
      for (let i = 1; i <= 5; i++) {
        ({ cluster } = await regValidator(network, clusterOwner, operatorIds, cluster, DEFAULT_ETH_REGISTER_VALUE, i));
      }
      expect(cluster.validatorCount).to.equal(5n);

      // Verify each operator has ethValidatorCount = 5 before liquidation
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(5n, `operator ${opId} ethValidatorCount before liquidation`);
      }

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);

      // LQ-010: Verify per-operator ethValidatorCount is decremented to 0
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(0n, `operator ${opId} ethValidatorCount must be 0 after liquidation`);
      }
    });
  });

  // =========================================================================
  // LQ-024: Liquidation attempt on cluster with validatorCount=0 — third-party revert
  // =========================================================================
  describe("LQ-024: Third-party liquidation reverts when validatorCount = 0", () => {
    it("Reverts ClusterNotLiquidatable when third party tries to liquidate cluster with validatorCount=0", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register a validator then remove it
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await removeTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // Third-party liquidation should revert since validatorCount=0 means no burn, cluster is healthy
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });
  });

  // =========================================================================
  // LQ-025: Self-liquidation on cluster with validatorCount=0 — succeeds
  // =========================================================================
  describe("LQ-025: Self-liquidation succeeds when validatorCount = 0", () => {
    it("Owner can self-liquidate a cluster with validatorCount=0", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register a validator then remove it
      let { cluster } = await regValidator(network, clusterOwner, operatorIds, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await removeTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // Self-liquidation bypasses the liquidation check and should succeed
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const liqCluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.validatorCount).to.equal(0n);
    });
  });

  // =========================================================================
  // LQ-027: Liquidation with validatorCount=10 — DAO counters decremented
  // =========================================================================
  describe("LQ-027: Liquidation with validatorCount=10 — DAO counters decremented", () => {
    it("daoTotalEthVUnits and ethDaoValidatorCount decremented by 10 after liquidation", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddress = await network.getAddress();

      const operatorIds = await setupOperators(network, opOwner, 4, [clusterOwner.address]);

      // Register 10 validators
      let cluster = EMPTY_CLUSTER;
      for (let i = 1; i <= 10; i++) {
        ({ cluster } = await regValidator(network, clusterOwner, operatorIds, cluster, DEFAULT_ETH_REGISTER_VALUE, i));
      }
      expect(cluster.validatorCount).to.equal(10n);

      // Read DAO counters before liquidation
      const daoValidatorCountBefore = await views.getNetworkValidatorsCount();
      const daoVUnitsBefore = await readDaoTotalEthVUnits(provider, proxyAddress);

      expect(BigInt(daoValidatorCountBefore)).to.equal(10n);
      expect(daoVUnitsBefore).to.equal(defaultVUnits(10n));

      // Self-liquidate
      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);

      // Verify DAO counters decremented by 10
      const daoValidatorCountAfter = await views.getNetworkValidatorsCount();
      const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, proxyAddress);

      expect(BigInt(daoValidatorCountAfter)).to.equal(0n,
        "ethDaoValidatorCount should be decremented by 10");
      expect(daoVUnitsAfter).to.equal(0n,
        "daoTotalEthVUnits should be decremented by 10 * BPS_DENOMINATOR");
    });
  });

  // =========================================================================
  // LQ-077: Reactivation reentrancy guard
  // =========================================================================
  describe("LQ-077: Reactivation reentrancy guard", () => {
    it("Reentrant call to reactivate() during withdraw() is blocked by nonReentrant", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      // Deploy malicious contract first so we can whitelist its address
      const MaliciousReactivate = await connection.ethers.getContractFactory("MaliciousReactivate");
      const malicious = await MaliciousReactivate.deploy(await network.getAddress());
      await malicious.waitForDeployment();
      const maliciousAddress = await malicious.getAddress();

      // Need 8 operators: 4 for the withdraw cluster, 4 for the reactivate cluster
      const allOps = await setupOperators(network, opOwner, 8, [maliciousAddress]);
      const withdrawOps = allOps.slice(0, 4);
      const reactivateOps = allOps.slice(4, 8);

      // Register a validator on the withdraw operators (active cluster for withdraw)
      const regTx1 = await malicious.registerValidator(
        makePublicKey(80), withdrawOps, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt1 = await regTx1.wait();
      const withdrawCluster = parseClusterFromEvent(network, regReceipt1, Events.VALIDATOR_ADDED);

      // Register a validator on the reactivate operators, then self-liquidate it
      const regTx2 = await malicious.registerValidator(
        makePublicKey(81), reactivateOps, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt2 = await regTx2.wait();
      const reactivateCluster = parseClusterFromEvent(network, regReceipt2, Events.VALIDATOR_ADDED);

      // Make the reactivate cluster liquidatable by setting high minimum collateral
      await network.updateMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE * 2n);

      // Third-party liquidation of the reactivate cluster
      const liqTx = await network.connect(liquidator).liquidate(
        maliciousAddress, reactivateOps, reactivateCluster,
      );
      const liqCluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);

      // Reset minimum collateral
      await network.updateMinimumLiquidationCollateral(0n);

      // Set params on malicious contract:
      // - ops/cl for withdraw (active cluster)
      // - reactivateOps/reactivateCl for reactivate (liquidated cluster)
      await malicious.setParams(withdrawOps, withdrawCluster);
      await malicious.setReactivateParams(reactivateOps, liqCluster);

      // The attack: malicious.attack() calls withdraw(ops, 1, cl)
      // withdraw sends ETH to malicious contract → receive() is called
      // receive() tries reactivate{value: msg.value}(reactivateOps, reactivateCl)
      // reactivate hits nonReentrant → ReentrancyGuardReentrantCall
      // ETH transfer fails → withdraw reverts with ETHTransferFailed
      await expect(malicious.attack()).to.be.revertedWithCustomError(network, Errors.ETH_TRANSFER_FAILED);
    });
  });
});
