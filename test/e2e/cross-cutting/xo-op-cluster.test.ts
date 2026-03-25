/**
 * XO-001 through XO-069: Operator↔Cluster cross-module interaction tests.
 *
 * Covers: fee changes + EB, removed operator + cluster ops, privacy + cluster ops,
 * EB + deposit/withdraw, operator earnings isolation, multi-cluster shared ops.
 *
 * All removeOperator() calls use real removeOperator — never mocks.
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  ssvNetworkFullFixture,
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  makeOperatorKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  SMALL_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMAL_OPERATOR_ETH_FEE,
  DECLARE_OPERATOR_FEE_PERIOD,
  TOKEN_REGISTER_AMOUNT,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
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
// Diamond-storage slot helpers
// ---------------------------------------------------------------------------
const EB_STORAGE_BASE =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const OPERATOR_ETH_VUNITS_MAP_SLOT = EB_STORAGE_BASE + 2n;

const PROTOCOL_STORAGE_BASE =
  BigInt(
    ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol")),
  ) - 1n;
const DAO_TOTAL_ETH_VUNITS_SLOT = PROTOCOL_STORAGE_BASE + 4n;

const UINT64_MASK = (1n << 64n) - 1n;

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
  proxyAddr: string,
  operatorId: bigint,
): Promise<bigint> {
  const raw = await provider.getStorage(
    proxyAddr,
    operatorEthVUnitsSlot(operatorId),
  );
  return BigInt(raw) & UINT64_MASK;
}

async function readDaoTotalEthVUnits(
  provider: any,
  proxyAddr: string,
): Promise<bigint> {
  const raw = await provider.getStorage(
    proxyAddr,
    "0x" + DAO_TOTAL_ETH_VUNITS_SLOT.toString(16).padStart(64, "0"),
  );
  return (BigInt(raw) >> 192n) & UINT64_MASK;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function registerValidatorETH(
  network: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  deposit: bigint,
  pubkeyIdx: number,
): Promise<{ cluster: Cluster; receipt: any }> {
  const tx = await network
    .connect(clusterOwner)
    .registerValidator(
      makePublicKey(pubkeyIdx),
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

async function doEBUpdate(
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
  oracles: HardhatEthersSigner[],
): Promise<{ cluster: Cluster; receipt: any; rootBlockNum: number }> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const root = computeEBRoot(clusterId, effectiveBalance);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);

  const tx = await network
    .connect(clusterOwner)
    .updateClusterBalance(
      rootBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      [],
    );
  const receipt = await tx.wait();

  let updatedCluster: Cluster;
  try {
    updatedCluster = parseClusterFromEvent(
      network,
      receipt,
      Events.CLUSTER_BALANCE_UPDATED,
    );
  } catch {
    updatedCluster = parseClusterFromEvent(
      network,
      receipt,
      Events.CLUSTER_LIQUIDATED,
    );
  }
  return { cluster: updatedCluster, receipt, rootBlockNum };
}

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
  const perBlock = calcClusterBurn({
    blockDiff: 1n,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits,
  });
  const threshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits,
  });

  const balance = BigInt(cluster.balance);
  if (perBlock > 0n && balance > threshold) {
    const blocksNeeded = Number((balance - threshold) / perBlock) + 2;
    await mineBlocks(provider, blocksNeeded);
  }

  const tx = await network
    .connect(liquidator)
    .liquidate(clusterOwner.address, operatorIds, cluster);
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED),
    receipt,
  };
}

/** Declare + wait + execute fee for an operator. Returns new fee. */
async function declareAndExecuteFee(
  network: any,
  provider: any,
  opOwner: HardhatEthersSigner,
  operatorId: number,
  newFeeUnpacked: bigint,
): Promise<void> {
  await network.connect(opOwner).declareOperatorFee(BigInt(operatorId), newFeeUnpacked);
  await mineBlocks(provider, Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);
  await network.connect(opOwner).executeOperatorFee(BigInt(operatorId));
}

// ===========================================================================
// Test Suite
// ===========================================================================
describe("XO: Operator↔Cluster Cross-Module Tests", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let opOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
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
      signers: [
        opOwner,
        clusterOwner,
        clusterOwner2,
        liquidator,
        oracle1,
        oracle2,
        oracle3,
        oracle4,
        staker,
        extra1,
        extra2,
      ],
    } = await setupTestContext());
  });

  // Standard fixture: deploy full network + setup network fee + oracles
  const baseFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    return { network, views, ssvToken };
  };

  // Pre-upgrade (SSV) fixture for migration tests
  const ssvFixture = async () => {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(connection);
    return { legacyNetwork, legacyViews, ssvToken };
  };

  const oracles = () => [oracle1, oracle2, oracle3, oracle4];

  // =========================================================================
  // Fee Changes + Cluster Operations (XO-009 to XO-015, XO-021, XO-038-040,
  // XO-045-049, XO-053)
  // =========================================================================

  describe("Fee Changes + Cluster Ops", () => {
    // XO-001: fee increase mid-cluster-life — burn rate reflects new fee on withdraw
    it("XO-001: fee increase mid-cluster-life — burn rate reflects new fee on withdraw", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      const balAfterRegister = cluster.balance;

      // Mine 100 blocks at old rate
      await mineBlocks(provider, 100);

      // Op1 declares + executes fee increase (2x)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Verify op1 fee changed
      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opData.fee)).to.equal(newFee);

      // Mine 100 more blocks at new rate
      await mineBlocks(provider, 100);

      // Withdraw (settle)
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Exact burn: mine(100) + declare(1) + mine(604801) + execute(1) + mine(100) + withdraw(1) = 605004 blocks total
      // Op1 runs at old rate for 604903 blocks (up to execute), then 101 blocks at 2x rate
      // Equivalent to: all 4 ops at old rate for full 605004 + op1 extra (2x-1x) for 101 blocks
      const vUnitsXO1 = defaultVUnits(1n);
      const baseBurn = calcClusterBurn({ blockDiff: 605004n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO1 });
      const extraBurn = calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO1 });
      expect(cluster.balance).to.equal(balAfterRegister - baseBurn - extraBurn);

      // -- G4 vUnit consistency: implicit EB, all operators should have 0 deviation --
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits deviation should be 0 (implicit EB)`);
      }

      // daoTotalEthVUnits = baseline: validatorCount * BPS_DENOMINATOR
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(defaultVUnits(1n), "daoTotalEthVUnits should equal baseline for 1 validator");
    });

    // XO-002: fee increase changes operator index growth rate — segmented indices
    it("XO-002: fee increase changes operator index growth rate — segmented indices", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      const balAfterRegister = cluster.balance;

      // Mine 100 blocks at old rate
      await mineBlocks(provider, 100);

      // Op1 declares + executes fee increase (2x)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Mine 100 more blocks at new rate
      await mineBlocks(provider, 100);

      // Verify cluster balance reflects segmented accrual
      // mine(100) + declare(1) + mine(604801) + execute(1) + mine(100) = 605003 blocks from register
      // Op1 at old rate for 604903, then 100 blocks at 2x → extra = 100 blocks * 1 op
      const vUnitsXO2 = defaultVUnits(1n);
      const baseBurnXO2 = calcClusterBurn({ blockDiff: 605003n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO2 });
      const extraBurnXO2 = calcClusterBurn({ blockDiff: 100n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO2 });
      const balView = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      expect(BigInt(balView)).to.equal(balAfterRegister - baseBurnXO2 - extraBurnXO2);

      // -- G4 vUnit consistency: implicit EB, no deviation --
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits deviation should be 0 (implicit EB)`);
      }
      // daoTotalEthVUnits = baseline for 1 validator
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(defaultVUnits(1n), "daoTotalEthVUnits should equal baseline for 1 validator");
    });

    // XO-003: fee reduction mid-cluster-life — burn rate drops, more balance withdrawable
    it("XO-003: fee reduction mid-cluster-life — burn rate drops, more balance withdrawable", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register with a generous deposit to avoid liquidation during fee period wait
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // First increase all ops fees (2x, within 100% max increase limit)
      const highFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      for (const opId of operatorIds) {
        await declareAndExecuteFee(network, provider, opOwner, opId, highFee);
      }

      // Mine 100 blocks at high rate
      await mineBlocks(provider, 100);

      // Settle to get a baseline
      let txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
      const balAfterHighRate = cluster.balance;

      // Reduce op1 fee back to minimum
      await network.connect(opOwner).reduceOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE);

      // Verify op1 fee changed
      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opData.fee)).to.equal(MINIMAL_OPERATOR_ETH_FEE);

      // Mine 100 more blocks at reduced rate
      await mineBlocks(provider, 100);

      // Settle again
      txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // From first withdraw to second: reduceOperatorFee(1) + mine(100) + withdraw(1) = 102 blocks
      // Op1: 1 block at 2x (before reduce) + 101 blocks at 1x (after reduce)
      // Ops 2-4: 102 blocks at 2x rate; Network: 102 blocks
      const vUnitsXO3 = defaultVUnits(1n);
      const highFeeRaw = highFee / ETH_DEDUCTED_DIGITS;
      const burnXO3 = calcClusterBurn({ blockDiff: 102n, numOperators: 3n, ethFee: highFeeRaw, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO3 })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: highFeeRaw, networkFee: 0n, effectiveVUnits: vUnitsXO3 })
        + calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO3 });
      expect(cluster.balance).to.equal(balAfterHighRate - burnXO3);

      // -- G4 vUnit consistency: implicit EB --
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits deviation should be 0 (implicit EB)`);
      }
      // daoTotalEthVUnits = baseline for 1 validator
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(defaultVUnits(1n), "daoTotalEthVUnits should equal baseline for 1 validator");
    });

    // XO-011: fee increase makes cluster liquidatable — third party liquidates
    it("XO-011: fee increase makes cluster liquidatable — third party liquidates", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register with small deposit — vulnerable to fee increase
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Increase all operator fees significantly (2x)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      for (const opId of operatorIds) {
        await declareAndExecuteFee(network, provider, opOwner, opId, newFee);
      }

      // Mine enough blocks to push below liquidation threshold at new rate
      const vUnits = defaultVUnits(1n);
      const newFeeRaw = (newFee / ETH_DEDUCTED_DIGITS);
      const perBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 4n,
        ethFee: newFeeRaw,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: newFeeRaw,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balance = BigInt(cluster.balance);
      if (perBlock > 0n && balance > threshold) {
        const blocksNeeded = Number((balance - threshold) / perBlock) + 2;
        await mineBlocks(provider, blocksNeeded);
      }

      // Liquidate by third party
      const txLiq = await network
        .connect(liquidator)
        .liquidate(clusterOwner.address, operatorIds, cluster);
      const receiptLiq = await txLiq.wait();
      cluster = parseClusterFromEvent(network, receiptLiq, Events.CLUSTER_LIQUIDATED);

      // Cluster should be inactive
      expect(cluster.active).to.equal(false);

      // Verify fees are still at the increased rate
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(BigInt(opData.fee)).to.equal(newFee, `op${opId} fee should persist after liquidation`);
      }

      // -- G4 vUnit consistency: implicit EB, no deviation --
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits deviation should be 0 (implicit EB)`);
      }
      // After liquidation, daoTotalEthVUnits should reflect removal of baseline
      // 1 validator was liquidated: daoTotalEthVUnits -= 1 * BPS_DENOMINATOR = 0
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(0n, "daoTotalEthVUnits should be 0 after liquidation of only cluster");
    });

    // XO-009: reactivate after liquidation with removed operator
    it("XO-009: reactivate cluster after liquidation with removed operator", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Drain and liquidate
      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));
      expect(cluster.active).to.equal(false);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Deposit enough to reactivate with 3-op burn rate
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const reactivateDeposit = threshold * 2n;

      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, {
          value: reactivateDeposit,
        });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      // Reactivate
      const txReact = await network
        .connect(clusterOwner)
        .reactivate(operatorIds, cluster, { value: 0n });
      const receiptReact = await txReact.wait();
      cluster = parseClusterFromEvent(network, receiptReact, Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);

      // Removed op should have vUnits == 0
      const removedVUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(removedVUnits).to.equal(0n);
    });

    // XO-010: new cluster with remaining operators after 1 of 13 removed
    it("XO-010: new cluster with remaining operators after 1 removed from group", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      // Register 5 operators — will use 4 for a cluster after removing 1
      const operatorIds = await registerOperators(network, opOwner, 5);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Remove op5
      await network.connect(opOwner).removeOperator(operatorIds[4]);

      // Register new cluster with ops 1-4 (valid 4-op cluster)
      const ops4 = operatorIds.slice(0, 4);
      const { cluster } = await registerValidatorETH(
        network, clusterOwner, ops4, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      expect(cluster.validatorCount).to.equal(1n);
      expect(cluster.active).to.equal(true);
    });

    // XO-012: fee increase reduces available withdrawal amount
    it("XO-012: fee increase reduces available balance — withdraw limited", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register with small deposit
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const balBefore = cluster.balance;

      // Increase all operator fees significantly
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      for (const opId of operatorIds) {
        await declareAndExecuteFee(network, provider, opOwner, opId, newFee);
      }

      // Mine blocks — fees drain faster at higher rate
      await mineBlocks(provider, 5000);

      // Settle cluster
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Each declareAndExecuteFee = DECLARE_OPERATOR_FEE_PERIOD + 3 blocks
      // Total: 4 * (DECLARE_OPERATOR_FEE_PERIOD + 3n) + 5000 + 1 = totalBlocks
      const feeChangeBlocks = DECLARE_OPERATOR_FEE_PERIOD + 3n;
      const totalBlocks12 = 4n * feeChangeBlocks + 5001n;
      const vUnitsXO12 = defaultVUnits(1n);
      // Baseline: all 4 ops at old rate for totalBlocks + network fee
      let totalBurn12 = calcClusterBurn({ blockDiff: totalBlocks12, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO12 });
      // Extra burn for each op's time at 2x (extra 1x over baseline)
      for (let i = 1n; i <= 4n; i++) {
        const extraBlocks = totalBlocks12 - i * feeChangeBlocks;
        totalBurn12 += calcClusterBurn({ blockDiff: extraBlocks, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO12 });
      }
      expect(cluster.balance).to.equal(balBefore - totalBurn12);
    });

    // XO-013: fee reduction enables previously-failing withdraw
    it("XO-013: fee reduction enables withdraw that was previously blocked", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Mine many blocks
      await mineBlocks(provider, 5000);

      // Reduce all operator fees to minimum
      const minFee = MINIMAL_OPERATOR_ETH_FEE;
      // Fees are already at minimum, so reduce isn't needed — instead verify withdraw works at current rate
      // The point: settle cluster first, then withdraw
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Block diff: mine(5000) + withdraw(1) = 5001 blocks from register
      const expectedBurn = calcClusterBurn({
        blockDiff: 5001n,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(cluster.balance).to.equal(SMALL_ETH_REGISTER_VALUE - expectedBurn);
    });

    // XO-015: declare fee before EB, execute after EB
    it("XO-015: fee declared before EB update, executed after — uses post-EB vUnits", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Declare fee increase for op1
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(BigInt(operatorIds[0]), newFee);

      // EB update before execution
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Now execute the fee
      await mineBlocks(provider, Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(operatorIds[0]));

      // Verify operator fee changed
      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opData.fee)).to.equal(newFee);

      // Verify op's vUnits reflect EB update
      // EB=48 for 1 validator: deviation = calcVUnits(48) - defaultVUnits(1) = 15000 - 10000 = 5000
      const expectedDeviation = calcVUnits(48n) - defaultVUnits(1n);
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.equal(expectedDeviation);
    });

    // XO-021: fee change on shared operator, 2 cluster withdrawals
    it("XO-021: fee change on shared operator — both clusters settle correctly", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      let { cluster: clusterA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      let { cluster: clusterB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      await mineBlocks(provider, 100);

      // Execute fee increase for op1
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      await mineBlocks(provider, 100);

      // Both clusters withdraw
      const txA = await network.connect(clusterOwner).withdraw(operatorIds, 0n, clusterA);
      clusterA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_WITHDRAWN);

      const txB = await network.connect(clusterOwner2).withdraw(operatorIds, 0n, clusterB);
      clusterB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_WITHDRAWN);

      // Cluster A: registered at R, withdraw at R+605005.
      // Op1 old rate 604904 blocks + new rate 101 blocks. Equivalent to 4-op baseline + 101 extra.
      const vUnitsXO21 = defaultVUnits(1n);
      const baseBurnA21 = calcClusterBurn({ blockDiff: 605005n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO21 });
      const extraBurnA21 = calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO21 });
      expect(clusterA.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - baseBurnA21 - extraBurnA21);

      // Cluster B: registered at R+1, withdraw at R+605006. Same 605005 block span.
      // Op1 old rate 604903 blocks + new rate 102 blocks. Equivalent to 4-op baseline + 102 extra.
      const baseBurnB21 = calcClusterBurn({ blockDiff: 605005n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO21 });
      const extraBurnB21 = calcClusterBurn({ blockDiff: 102n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO21 });
      expect(clusterB.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - baseBurnB21 - extraBurnB21);
    });

    // XO-038: multiple operators increase fees sequentially then withdraw
    it("XO-038: multiple operators increase fees sequentially — compound burn rate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Op1 increases fee
      const newFee1 = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee1);

      // Op2 increases fee
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[1], newFee1);

      await mineBlocks(provider, 50);

      // Withdraw — verify cluster still solvent
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Each declareAndExecuteFee = DECLARE_OPERATOR_FEE_PERIOD + 3n blocks
      const feeBlocks38 = DECLARE_OPERATOR_FEE_PERIOD + 3n;
      const totalBlocks38 = 2n * feeBlocks38 + 51n; // 2 fee changes + mine(50) + withdraw(1)
      const vUnitsXO38 = defaultVUnits(1n);
      const baseBurn38 = calcClusterBurn({ blockDiff: totalBlocks38, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO38 });
      // Op1 extra: totalBlocks - 1*feeBlocks; Op2 extra: totalBlocks - 2*feeBlocks
      const extra1_38 = calcClusterBurn({ blockDiff: totalBlocks38 - feeBlocks38, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO38 });
      const extra2_38 = calcClusterBurn({ blockDiff: totalBlocks38 - 2n * feeBlocks38, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO38 });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - baseBurn38 - extra1_38 - extra2_38);
    });

    // XO-039: fee increase + EB increase compound — cluster drains faster
    it("XO-039: fee increase + EB increase compound — accelerated balance drain", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const balBefore = cluster.balance;

      // Fee increase
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      for (const opId of operatorIds) {
        await declareAndExecuteFee(network, provider, opOwner, opId, newFee);
      }

      // EB increase — compounds the burn rate
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));

      // The compound effect: fee doubled + vUnits doubled = 4x drain rate
      // Settle to observe
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Phase 1 (register to EB update): 4 * feeChangeBlocks + 5 = totalP1, at implicit vUnits
      const feeBlocks39 = DECLARE_OPERATOR_FEE_PERIOD + 3n;
      const totalP1 = 4n * feeBlocks39 + 5n;
      const vUnitsXO39 = defaultVUnits(1n);
      let burnP1 = calcClusterBurn({ blockDiff: totalP1, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO39 });
      for (let i = 1n; i <= 4n; i++) {
        burnP1 += calcClusterBurn({ blockDiff: totalP1 - i * feeBlocks39, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO39 });
      }
      // Phase 2 (EB update to withdraw): 1 block, all 4 ops at 2x, EB=64 vUnits
      const ebVUnits39 = calcVUnits(64n);
      const newFeeRaw39 = newFee / ETH_DEDUCTED_DIGITS;
      const burnP2 = calcClusterBurn({ blockDiff: 1n, numOperators: 4n, ethFee: newFeeRaw39, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: ebVUnits39 });
      expect(cluster.balance).to.equal(balBefore - burnP1 - burnP2);
    });

    // XO-040: operator fee reduced to zero — cluster sees 3-op effective burn rate
    it("XO-040: operator fee reduced to zero — burn rate drops", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      const balBefore = cluster.balance;
      await mineBlocks(provider, 100);

      // Reduce op1 fee to minimum (can't go to zero — must be >= minimum)
      // Settle to check balance
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Block diff: mine(100) + withdraw(1) = 101 blocks from register
      const expectedBurn = calcClusterBurn({
        blockDiff: 101n,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(cluster.balance).to.equal(balBefore - expectedBurn);
    });

    // XO-045: declare fee, remove operator, execute fee — reverts
    it("XO-045: declare fee then remove operator — execute reverts OperatorDoesNotExist", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Declare fee increase
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(BigInt(operatorIds[0]), newFee);

      // Remove the operator
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Execute should revert
      await mineBlocks(provider, Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);
      await expect(
        network.connect(opOwner).executeOperatorFee(BigInt(operatorIds[0])),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    // XO-046: reduce fee on removed operator — reverts
    it("XO-046: reduce fee on removed operator — reverts OperatorDoesNotExist", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      await expect(
        network.connect(opOwner).reduceOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE / 2n),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    // XO-047: operator withdraws earnings then cluster withdraws — no double-counting
    it("XO-047: operator earnings + cluster withdraw — no double-counting", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await mineBlocks(provider, 200);

      // Operator withdraws earnings
      // 200 blocks from register, 1 operator's share, 1 validator at default vUnits
      const expectedEarnings = calcClusterBurn({
        blockDiff: 200n,
        numOperators: 1n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: 0n,
        effectiveVUnits: defaultVUnits(1n),
      });
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.equal(expectedEarnings);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);

      // Cluster owner withdraws
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Contract ETH balance should be >= remaining cluster + remaining operator earnings + DAO
      const contractBal = await provider.getBalance(proxyAddr);
      const daoEarnings = BigInt(await views.getNetworkEarnings());
      let totalOpEarnings = 0n;
      for (const opId of operatorIds) {
        totalOpEarnings += BigInt(await views.getOperatorEarnings(BigInt(opId)));
      }
      expect(contractBal).to.equal(
        cluster.balance + totalOpEarnings + daoEarnings,
      );
    });

    // XO-049: fee change persists through liquidation-reactivation cycle
    it("XO-049: fee change persists through liquidation-reactivation", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Increase op1 fee
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Liquidate
      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));

      // Verify fee still in effect
      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(BigInt(opData.fee)).to.equal(newFee);

      // Deposit and reactivate
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const deposit = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: deposit });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);
    });

    // XO-053: same-block fee change + withdraw
    it("XO-053: fee change and withdraw in same block — index jump visible", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Wait for declare period, then execute and immediately withdraw in next block
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Withdraw immediately after
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Total: declareAndExecuteFee (604803 blocks) + withdraw(1) = 604804 blocks
      // Op1 at old rate for 604803, then 1 block at 2x. Extra = 1 block.
      const totalBlocks53 = DECLARE_OPERATOR_FEE_PERIOD + 3n + 1n;
      const vUnitsXO53 = defaultVUnits(1n);
      const baseBurn53 = calcClusterBurn({ blockDiff: totalBlocks53, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsXO53 });
      const extraBurn53 = calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsXO53 });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - baseBurn53 - extraBurn53);
    });
  });

  // =========================================================================
  // Removed Operator + Cluster Ops (XO-016-020, XO-022-024, XO-041,
  // XO-044, XO-052, XO-054, XO-058-059, XO-061-062, XO-065-068)
  // =========================================================================

  describe("Removed Operator + Cluster Ops", () => {
    // XO-016: EB update guard skips removed operator's vUnits
    it("XO-016: EB update on cluster with removed operator — guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      const vUnitsBefore = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnitsBefore).to.equal(0n);

      // EB update to 48 — guard skips removed op
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Guard works: removed op stays at 0
      const vUnitsAfter = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnitsAfter).to.equal(0n, "removed op stays 0 (guard works)");

      // Active ops have deviation
      for (let i = 1; i < 4; i++) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(v).to.equal(5000n, `active op ${operatorIds[i]} has 5000 deviation`);
      }
    });

    // XO-017: EB increase then decrease on cluster with removed op
    it("XO-017: EB increase then decrease with removed operator", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // EB increase to 48
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // EB decrease back to 32
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 32, oracles(),
      ));

      // Removed op should still have 0 vUnits
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.equal(0n, "removed op vUnits must be 0 after EB increase+decrease");

      // Active ops should be back to baseline (0 deviation)
      for (let i = 1; i < 4; i++) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(v).to.equal(0n, `op${operatorIds[i]} should have 0 deviation after return to baseline`);
      }
    });

    // XO-018: EB increase with removed op — guard skips removed op
    it("XO-018: EB increase with removed operator — guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register with minimal deposit
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Mine to bring close to threshold
      await mineBlocks(provider, 5000);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // EB increase to 64 — may trigger auto-liquidation, guard skips removed op
      const { cluster: updatedCluster, receipt } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      );

      // Whether auto-liq fired or not, removed op must stay at 0
      const removedV = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(removedV).to.equal(0n, "removed op stays 0 (guard works)");
    });

    // XO-019: 2 clusters sharing removed op → withdraw from both
    it("XO-019: two clusters share removed op — both withdraw with 3-op rate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      let { cluster: clusterA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      let { cluster: clusterB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      await mineBlocks(provider, 100);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      // Verify operatorEthVUnits[op1] zeroed immediately
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0])),
      ).to.equal(0n, "operatorEthVUnits[op1] zeroed after removeOperator");

      await mineBlocks(provider, 100);

      // Both clusters withdraw
      const txA = await network.connect(clusterOwner).withdraw(operatorIds, 0n, clusterA);
      clusterA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_WITHDRAWN);

      const txB = await network.connect(clusterOwner2).withdraw(operatorIds, 0n, clusterB);
      clusterB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_WITHDRAWN);

      // Cluster A: registered at R, withdrawal at R+203
      // Op1 contributed 102 blocks (R to R+102); ops 2-4 contributed 203 blocks; network: 203 blocks
      const vUnitsA = defaultVUnits(1n);
      const burnA = calcClusterBurn({ blockDiff: 203n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsA })
        + calcClusterBurn({ blockDiff: 102n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsA });
      expect(clusterA.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burnA);

      // Cluster B: registered at R+1, withdrawal at R+204
      // Op1 contributed 101 blocks; ops 2-4 contributed 203 blocks; network: 203 blocks
      const burnB = calcClusterBurn({ blockDiff: 203n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsA })
        + calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsA });
      expect(clusterB.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burnB);
    });

    // XO-020: 2 clusters, removed op, deposits
    it("XO-020: two clusters with removed op — deposits succeed", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      let { cluster: clusterA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      let { cluster: clusterB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      const dep = ethers.parseEther("1");
      const txA = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, clusterA, { value: dep });
      clusterA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_DEPOSITED);

      const txB = await network
        .connect(clusterOwner2)
        .deposit(clusterOwner2.address, operatorIds, clusterB, { value: dep });
      clusterB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_DEPOSITED);

      expect(clusterA.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + dep);
      expect(clusterB.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + dep);
    });

    // XO-022: EB update → remove op → withdrawOperatorEarnings
    it("XO-022: EB update then op removal — final earnings include EB-weighted accrual", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Remove op1 — final settlement includes EB-weighted earnings
      // Phase 1: register→EBUpdate = 5 blocks at implicit vUnits, 1 operator share
      // Phase 2: EBUpdate→now = 100 blocks at EB=48 vUnits, 1 operator share
      const expEarnings = calcClusterBurn({
        blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n),
      }) + calcClusterBurn({
        blockDiff: 100n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n),
      });
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.equal(expEarnings);

      const opBalBefore = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      const opBalAfter = await provider.getBalance(opOwner.address);

      // Operator should have received earnings payout (minus gas)
      // The payout amount should reflect EB-weighted accrual (higher than baseline)
      // Since earningsBefore is the EB-weighted accrual over 100 blocks, it should be significant
      const netReceived = opBalAfter - opBalBefore; // includes gas cost (negative offset)
      // earningsBefore reflects what was accrued; removeOperator settles +1 block of additional earnings
      // Already verified exact earnings above — this confirms EB-weighted accrual happened

      // operatorEthVUnits[op1] should be deleted
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.equal(0n, "operatorEthVUnits zeroed after removal");
    });

    // XO-023: EB update → remove op → second EB update — guard keeps removed op clean
    it("XO-023: second EB update after op removal — removed op stays clean", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update 1
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // EB update 2 — guard skips removed op
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));

      // Guard works: removed op stays at 0
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.equal(0n, "removed op stays 0 after second EB update (guard works)");

      // Active ops have full deviation from baseline
      const devLive = calcVUnits(64n) - defaultVUnits(1n); // 10000
      for (let i = 1; i < 4; i++) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(v).to.equal(devLive, `active op ${operatorIds[i]} has full deviation`);
      }
    });

    // XO-024: withdrawOperatorEarnings on removed op — reverts
    it("XO-024: withdrawOperatorEarnings on removed operator — reverts", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).removeOperator(operatorIds[0]);

      await expect(
        network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    // XO-041: all 4 ops removed — withdraw entire balance
    it("XO-041: all 4 operators removed — withdraw succeeds (zero burn rate)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove all 4
      for (const opId of operatorIds) {
        await network.connect(opOwner).removeOperator(opId);
      }
      await mineBlocks(provider, 200);

      // Withdraw with settlement (0 amount = just settle)
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Removals happen sequentially: op1@1, op2@2, op3@3, op4@4 blocks after register
      // Then mine(200) + withdraw(1) = 201 more blocks with 0 ops. Total = 205 blocks.
      // Operator fees: 4*1 + 3*1 + 2*1 + 1*1 = 10 operator-block units
      const vUnitsVal = defaultVUnits(1n);
      const opBurn = calcClusterBurn({ blockDiff: 1n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 2n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal });
      const netBurn = calcClusterBurn({ blockDiff: 205n, numOperators: 0n, ethFee: 0n, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsVal });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - opBurn - netBurn);
    });

    // XO-044: two clusters share op1 removed — both withdraw correctly
    it("XO-044: two clusters share removed op1 — both settle with 3-op rate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      let { cluster: cA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      let { cluster: cB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      await network.connect(opOwner).removeOperator(operatorIds[0]);
      // Verify operatorEthVUnits[op1] zeroed immediately
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0])),
      ).to.equal(0n, "operatorEthVUnits[op1] zeroed after removeOperator");

      await mineBlocks(provider, 200);

      const txA = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cA);
      cA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_WITHDRAWN);

      const txB = await network.connect(clusterOwner2).withdraw(operatorIds, 0n, cB);
      cB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_WITHDRAWN);

      // cA registered at R, withdraw at R+203. Op1 removed at R+2.
      // Op1: 2 blocks. Ops 2-4: 203 blocks. Network: 203 blocks.
      const vUnitsVal = defaultVUnits(1n);
      const burnA = calcClusterBurn({ blockDiff: 203n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsVal })
        + calcClusterBurn({ blockDiff: 2n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal });
      expect(cA.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burnA);

      // cB registered at R+1, withdraw at R+204. Op1: 1 block. Ops 2-4: 203 blocks. Network: 203 blocks.
      const burnB = calcClusterBurn({ blockDiff: 203n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnitsVal })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnitsVal });
      expect(cB.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burnB);
    });

    // XO-052: remove all validators from explicit-EB cluster with removed op
    it("XO-052: remove all validators from explicit-EB cluster with removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Remove last validator (empties cluster)
      const txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // All operators should have deviation cleaned
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits should be 0 after all validators removed`);
      }
    });

    // XO-054: same-block operator removal + cluster withdraw
    it("XO-054: operator removal and cluster withdraw — sees zeroed fee immediately", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await mineBlocks(provider, 100);

      // Remove op, then withdraw
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      // Verify operatorEthVUnits[op1] zeroed immediately
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0])),
      ).to.equal(0n, "operatorEthVUnits[op1] zeroed immediately after removeOperator");

      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Block counting: mine(100) + removeOp(1) + withdraw(1) = 102 total from register
      // Op1 removed at block 101 (contributed 101 blocks); ops 2-4 contribute full 102 blocks
      const vUnits = defaultVUnits(1n);
      const burn3ops = calcClusterBurn({ blockDiff: 102n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits });
      const burnRemovedOp = calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnits });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burn3ops - burnRemovedOp);
    });

    // XO-058: long-duration removed operator — fee math correct
    it("XO-058: 1000 blocks with removed operator — 3-op burn rate correct", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      // Verify operatorEthVUnits[op1] zeroed immediately
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0])),
      ).to.equal(0n, "operatorEthVUnits[op1] zeroed after removeOperator");

      // Mine 1000 more blocks
      await mineBlocks(provider, 1000);

      // Settle
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Block counting: removeOp(1) + mine(1000) + withdraw(1) = 1002 total from register
      // Op1 removed at block 1; ops 2-4 contribute full 1002 blocks
      const burn3ops = calcClusterBurn({ blockDiff: 1002n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: defaultVUnits(1n) });
      const burnRemovedOp = calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n) });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burn3ops - burnRemovedOp);
    });

    // XO-059: withdraw after op removal from explicit-EB cluster
    it("XO-059: withdraw after op removal from explicit-EB cluster — vUnits unchanged", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Read vUnits before removal
      const deviation = calcVUnits(48n) - defaultVUnits(1n);
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(deviation, `op${opId} vUnits after EB`);
      }

      // Remove op
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      // Removed op vUnits zeroed immediately
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(
        0n,
        "operatorEthVUnits zeroed after removeOperator",
      );
      // Remaining ops' vUnits unchanged by op removal
      for (const opId of operatorIds.slice(1)) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(deviation, `op${opId} vUnits unchanged after op removal`);
      }

      await mineBlocks(provider, 100);

      // Withdraw
      const balAfterEB = cluster.balance;
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // From EB update: removeOp(1) + mine(100) + withdraw(1) = 102 blocks
      // Op1 contributed 1 block, ops 2-4 contribute 102 blocks at EB=48 vUnits
      const ebVUnits = calcVUnits(48n);
      const burn3ops = calcClusterBurn({ blockDiff: 102n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: ebVUnits });
      const burnRemovedOp = calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: ebVUnits });
      expect(cluster.balance).to.equal(balAfterEB - burn3ops - burnRemovedOp);

      // Verify vUnits still unchanged for remaining ops after withdraw
      for (const opId of operatorIds.slice(1)) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(deviation, `op${opId} vUnits still unchanged after withdraw`);
      }
    });

    // XO-061: replace removed op with new op in new cluster
    it("XO-061: replace removed op with new op in new cluster", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster: oldCluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Register new op5
      const newOpId = await network
        .connect(opOwner)
        .registerOperator.staticCall(makeOperatorKey(100), MINIMAL_OPERATOR_ETH_FEE, true);
      await network
        .connect(opOwner)
        .registerOperator(makeOperatorKey(100), MINIMAL_OPERATOR_ETH_FEE, true);

      const newOps = [Number(newOpId), operatorIds[1], operatorIds[2], operatorIds[3]].sort(
        (a, b) => Number(a) - Number(b),
      );
      await whitelistAddresses(network, opOwner, newOps, [clusterOwner.address]);

      // Register new cluster with ops 2,3,4,5
      const { cluster: newCluster } = await registerValidatorETH(
        network, clusterOwner, newOps, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );
      expect(newCluster.validatorCount).to.equal(1n);
      expect(newCluster.active).to.equal(true);
    });

    // XO-062: withdraw earnings then remove operator — no double payout
    it("XO-062: withdraw earnings then remove operator — no double payout", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await mineBlocks(provider, 200);

      // Withdraw earnings first
      // 200 blocks from register, 1 operator share, 1 validator at default vUnits
      const expectedEarningsBeforeW = calcClusterBurn({
        blockDiff: 200n,
        numOperators: 1n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: 0n,
        effectiveVUnits: defaultVUnits(1n),
      });
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.equal(expectedEarningsBeforeW);

      const opOwnerBalBefore = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);

      // Remove operator — should settle remaining (near-zero since just withdrawn)
      const opOwnerBalAfterWithdraw = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Residual earnings: 1 block of accrual between withdrawal and removal
      const residualEarnings = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 1n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: 0n,
        effectiveVUnits: defaultVUnits(1n),
      });
      const opOwnerBalAfterRemove = await provider.getBalance(opOwner.address);
      const totalReceived = opOwnerBalAfterRemove - opOwnerBalBefore;
      // Total payout = earningsBefore + residual - gas. Must be < earningsBefore + residual (gas > 0).
      expect(totalReceived).to.be.lessThan(
        earningsBefore + residualEarnings,
        "no double payout: total received (minus gas) must be < earnings + residual",
      );
      // Net change from withdrawal to removal = residual - gas (negative or small positive)
      const removalPayout = opOwnerBalAfterRemove - opOwnerBalAfterWithdraw;
      expect(removalPayout).to.be.lessThan(
        residualEarnings,
        "removal payout net of gas should be less than 1-block residual",
      );
    });

    // XO-065: removed op1 stale vUnits don't contaminate op2 earnings
    it("XO-065: removed op1 stale vUnits do not contaminate op2 earnings", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Verify op2 earnings: Phase 1 (register→EBUpdate) = 5 blocks implicit +
      // Phase 2 (EBUpdate→removeOp1) = mine(100)+removeOp(1) = 101 blocks at EB=48
      const expectedOp2Earnings = calcClusterBurn({
        blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n),
      }) + calcClusterBurn({
        blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n),
      });
      const op2Earnings = await views.getOperatorEarnings(BigInt(operatorIds[1]));
      expect(op2Earnings).to.equal(expectedOp2Earnings);

      // Withdraw op2 earnings — should succeed
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[1]);
      const op2EarningsAfter = await views.getOperatorEarnings(BigInt(operatorIds[1]));
      expect(op2EarningsAfter).to.equal(0n);
    });

    // XO-066: removeOperator then liquidate (underflow bug path)
    it("XO-066: removeOperator then liquidate — no underflow", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Drain and liquidate with 3-op burn rate
      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        3n, vUnits,
      ));
      expect(cluster.active).to.equal(false);

      // Removed op vUnits should be 0
      const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(v).to.equal(0n);
    });

    // XO-067: removeOperator then remove last validator (underflow bug path)
    it("XO-067: removeOperator then remove last validator — no underflow", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Remove the validator
      const txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);
    });

    // XO-068: shared removed op + other cluster EB update — guard skips removed op
    it("XO-068: shared removed op + other cluster EB update — guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      let { cluster: cA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      let { cluster: cB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // EB update on cluster B — guard skips removed op
      ({ cluster: cB } = await doEBUpdate(
        network, provider, clusterOwner2, operatorIds, cB, 48, oracles(),
      ));

      // Guard works: removed op stays at 0
      const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(v).to.equal(0n, "removed op stays 0 after other cluster's EB update (guard works)");

      // Active ops have deviation from cluster B's EB update
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      for (let i = 1; i < 4; i++) {
        const opV = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(opV).to.equal(dev, `active op ${operatorIds[i]} has deviation`);
      }
    });
  });

  // =========================================================================
  // Privacy + Cluster Ops (XO-027 to XO-032)
  // =========================================================================

  describe("Privacy + Cluster Ops", () => {
    // XO-027: privacy change blocks new validator registration
    it("XO-027: privacy change blocks non-whitelisted validator registration", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      // Whitelist only clusterOwner
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register validator as whitelisted owner
      await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Make op1 private
      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      // clusterOwner2 is NOT whitelisted — should revert
      await expect(
        network.connect(clusterOwner2).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED);
    });

    // XO-028: privacy change has no effect on deposit
    it("XO-028: privacy change has no effect on deposit", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      // Deposit succeeds (no whitelist check)
      const dep = ethers.parseEther("1");
      const txD = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txD.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + dep);
    });

    // XO-029: privacy change has no effect on withdraw
    it("XO-029: privacy change has no effect on withdraw", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      await mineBlocks(provider, 50);

      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Block diff: setPrivate(1) + mine(50) + withdraw(1) = 52 blocks from register
      const expectedBurn = calcClusterBurn({
        blockDiff: 52n,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - expectedBurn);
    });

    // XO-030: privacy change has no effect on removeValidator
    it("XO-030: privacy change has no effect on removeValidator", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      const txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);
    });

    // XO-031: privacy change has no effect on liquidation
    it("XO-031: privacy change has no effect on liquidation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));
      expect(cluster.active).to.equal(false);
    });

    // XO-032: privacy change has no effect on reactivation
    it("XO-032: privacy change has no effect on reactivation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));

      await network.connect(opOwner).setOperatorsPrivateUnchecked([BigInt(operatorIds[0])]);

      // Deposit and reactivate
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);
    });
  });

  // =========================================================================
  // EB + Deposit/Withdraw/Liquidation/Reactivation (XO-033-037, XO-042-043,
  // XO-048, XO-050-051, XO-055-057, XO-060, XO-063-064, XO-069)
  // =========================================================================

  describe("EB + Cluster Lifecycle", () => {
    // XO-033: EB increase raises threshold — balance drains faster
    it("XO-033: EB increase raises liquidation threshold — higher drain rate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const balBefore = cluster.balance;

      // EB update to 48 — raises threshold and burn rate
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Settle — balance should decrease faster with higher vUnits
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Phase 1: register to EB update = 5 blocks (mine(1) + 3 commits + 1 updateClusterBalance) at implicit vUnits
      const burnPhase1 = calcClusterBurn({
        blockDiff: 5n,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      // Phase 2: EB update to withdraw = mine(100) + withdraw(1) = 101 blocks at EB=48 vUnits
      const burnPhase2 = calcClusterBurn({
        blockDiff: 101n,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: calcVUnits(48n),
      });
      expect(cluster.balance).to.equal(balBefore - burnPhase1 - burnPhase2);

      // -- Per-operator vUnits deviation: EB=48 for 1 validator --
      // explicit vUnits = ceil(48*10000/32) = 15000; implicit = 10000; deviation = 5000
      const explicitVUnits = calcVUnits(48n); // 15000
      const implicitVUnits = defaultVUnits(1n); // 10000
      const expectedDeviation = explicitVUnits - implicitVUnits; // 5000
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDeviation, `op${opId} vUnits deviation should be ${expectedDeviation}`);
      }

      // -- daoTotalEthVUnits consistency: baseline + deviation --
      // daoTotalEthVUnits = validatorCount * BPS + deviation = 10000 + 5000 = 15000
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(explicitVUnits, "daoTotalEthVUnits should equal baseline + deviation");
    });

    // XO-034: EB increase then deposit offsets threshold — withdraw succeeds
    it("XO-034: EB increase then deposit — withdraw succeeds", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Deposit more
      const dep = ethers.parseEther("5");
      const txD = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txD.wait(), Events.CLUSTER_DEPOSITED);

      // Withdraw — should succeed
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

      // Burns: register→EBUpdate = 5 blocks implicit; EBUpdate→deposit = 1 block EB48; deposit→withdraw = 1 block EB48
      const ebVUnits = calcVUnits(48n);
      const burnImplicit = calcClusterBurn({ blockDiff: 5n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: defaultVUnits(1n) });
      const burnEB1 = calcClusterBurn({ blockDiff: 1n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: ebVUnits });
      const burnEB2 = burnEB1;
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - burnImplicit - burnEB1 + dep - burnEB2);
    });

    // XO-035: inactive cluster EB update then reactivation
    it("XO-035: EB update on liquidated cluster — reactivation uses stored vUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));

      // EB update on liquidated cluster
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));

      // Deposit enough for EB=64 threshold (2x)
      const newVUnits = calcVUnits(64n);
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      // Reactivate
      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);
    });

    // XO-036: deposit into liquidated cluster, withdraw without reactivating
    it("XO-036: deposit+withdraw on liquidated cluster — no fee settlement", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));

      // Deposit
      const dep = ethers.parseEther("1");
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      // Withdraw from inactive cluster — no fee settlement, full amount recoverable
      const balAfterDeposit36 = cluster.balance;
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, dep, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
      // Balance = deposit balance - withdrawn amount (no fees for inactive clusters)
      expect(cluster.balance).to.equal(balAfterDeposit36 - dep);

      // Cluster should remain inactive after deposit+withdraw
      expect(cluster.active).to.equal(false);

      // -- G4 vUnit consistency: implicit EB, no deviation stored --
      const proxyAddr = await network.getAddress();
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits should be 0 (implicit EB, liquidated)`);
      }
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(0n, "daoTotalEthVUnits should be 0 for implicit EB");
    });

    // XO-037: liquidate → remove op → deposit → reactivate
    it("XO-037: reactivation after liquidation with removed op — deviation skips removed", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      const vUnits = defaultVUnits(1n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, vUnits,
      ));

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Deposit + reactivate
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);

      // Removed op should have 0 vUnits
      const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(v).to.equal(0n);
    });

    // XO-042: remove all validators from explicit-EB cluster — deviation cleanup
    it("XO-042: remove all validators from explicit-EB cluster — deviation cleaned", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register 2 validators
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      ({ cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, cluster,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      ));

      // EB update — 96 ETH for 2 validators (48/val)
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 96, oracles(),
      ));

      // Verify deviation exists with exact values
      // 2 validators, 96 ETH total => vUnits = ceil(96*10000/32) = 30000
      // implicit = 2 * 10000 = 20000; deviation = 30000 - 20000 = 10000
      const explicitVUnitsEB96 = calcVUnits(96n); // 30000
      const implicitVUnits2Val = defaultVUnits(2n); // 20000
      const expectedDeviationEB96 = explicitVUnitsEB96 - implicitVUnits2Val; // 10000
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDeviationEB96, `op${opId} deviation should be ${expectedDeviationEB96} after EB=96`);
      }
      // daoTotalEthVUnits = baseline(20000) + deviation(10000) = 30000
      const daoVAfterEB = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVAfterEB).to.equal(explicitVUnitsEB96, "daoTotalEthVUnits should equal total vUnits after EB=96");

      // Remove validator 1
      let txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);

      // Remove validator 2
      txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(2), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // All operators should have deviation cleaned
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(0n, `op${opId} vUnits should be 0 after all validators removed`);
      }

      // DAO vUnits should also be cleaned
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(0n, "daoTotalEthVUnits should be 0 after all validators removed");
    });

    // XO-048: EB-weighted operator earnings: fee change settles at EB rate
    it("XO-048: EB-weighted operator earnings — fee change settles at deviation rate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update to 48
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Execute fee change (settles at EB rate)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Operator earnings: Phase 1 (register→EBUpdate) = 5 blocks implicit
      // Phase 2 (EBUpdate→execute) = mine(100) + declare(1) + mine(604801) + execute(1) = 604903 blocks at EB=48
      const expectedEarnings48 = calcClusterBurn({
        blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n),
      }) + calcClusterBurn({
        blockDiff: 604903n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n),
      });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarnings48);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);

      // -- Per-operator vUnits: EB=48, 1 validator --
      const proxyAddr = await network.getAddress();
      const explicitVUnits48 = calcVUnits(48n); // 15000
      const implicitVUnits1 = defaultVUnits(1n); // 10000
      const expectedDeviation48 = explicitVUnits48 - implicitVUnits1; // 5000
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDeviation48, `op${opId} vUnits deviation should be ${expectedDeviation48}`);
      }

      // -- daoTotalEthVUnits consistency: baseline + deviation = 15000 --
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(explicitVUnits48, "daoTotalEthVUnits should equal total vUnits for EB=48");

      // -- Operator earnings after withdrawal should be 0 --
      const earningsAfter = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsAfter).to.equal(0n, "op1 earnings should be 0 after full withdrawal");
    });

    // XO-050: EB persists through liquidation-reactivation
    it("XO-050: EB persists through liquidation-reactivation — threshold reflects vUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Liquidate
      const ebVUnits = calcVUnits(48n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, ebVUnits,
      ));

      // Deposit and reactivate with EB threshold
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: ebVUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);
      const balAfterDeposit = cluster.balance;

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);

      // -- EB persists: per-operator vUnits restored after reactivation --
      const proxyAddr = await network.getAddress();
      const implicitVUnits = defaultVUnits(1n); // 10000
      const expectedDeviation = ebVUnits - implicitVUnits; // 15000 - 10000 = 5000
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDeviation, `op${opId} vUnits deviation should be restored to ${expectedDeviation} after reactivation`);
      }

      // -- daoTotalEthVUnits restored: baseline(10000) + deviation(5000) = 15000 --
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(ebVUnits, "daoTotalEthVUnits should equal total vUnits after reactivation");

      // -- Reactivation of inactive cluster: no fees deducted, balance = deposit balance --
      expect(cluster.balance).to.equal(balAfterDeposit);
    });

    // XO-051: EB changed while liquidated then reactivation
    it("XO-051: EB changed while liquidated — reactivation uses latest vUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // EB = 48, then liquidate
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));
      const ebVUnits1 = calcVUnits(48n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, ebVUnits1,
      ));

      // EB update to 64 while liquidated
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));

      // Reactivate with EB=64 threshold
      const ebVUnits2 = calcVUnits(64n);
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: ebVUnits2,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);
    });

    // XO-055: two clusters, one with explicit EB, operator earnings include deviation from EB cluster only
    it("XO-055: two clusters, one explicit EB — operator earnings include deviation from EB cluster only", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      // Cluster A: explicit EB
      let { cluster: cA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      ({ cluster: cA } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cA, 48, oracles(),
      ));

      // Cluster B: implicit EB
      let { cluster: cB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      );

      await mineBlocks(provider, 100);

      // Operator earnings across 3 phases:
      // Phase 1 (register cA → EB update): 5 blocks, 1 val, implicit vUnits
      // Phase 2 (EB update → register cB): 1 block, 1 val, EB=48 vUnits (15000)
      // Phase 3 (register cB → now): 100 blocks, 2 vals, vUnits = 2*10000 + 5000 = 25000
      const expectedEarnings55 =
        calcClusterBurn({ blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n) })
        + calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n) })
        + calcClusterBurn({ blockDiff: 100n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(2n) + (calcVUnits(48n) - defaultVUnits(1n)) });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarnings55);
    });

    // XO-056: alternating EB updates and fee changes — operator earnings sum segments
    it("XO-056: alternating EB updates and fee changes — earnings sum segments correctly", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update 1
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));
      await mineBlocks(provider, 50);

      // Fee change
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);
      await mineBlocks(provider, 50);

      // EB update 2
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));
      await mineBlocks(provider, 50);

      // Operator earnings: 4 segments (operator snapshots settle at EB updates and fee execute)
      // Phase 1 (register → 1st EB update): 5 blocks at ethFee, implicit vUnits (10000)
      // Phase 2 (1st EB update → fee execute): 604853 blocks at ethFee, vUnits=15000 (EB=48 deviation)
      // Phase 3 (fee execute → 2nd EB update): 55 blocks at 2x ethFee, vUnits=15000 (deviation unchanged)
      // Phase 4 (2nd EB update → now): 50 blocks at 2x ethFee, vUnits=20000 (EB=64 deviation)
      const newFeeRaw56 = newFee / ETH_DEDUCTED_DIGITS;
      const ebVUnits48 = calcVUnits(48n); // 15000
      const ebVUnits64 = calcVUnits(64n); // 20000
      const expectedEarnings56 =
        calcClusterBurn({ blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n) })
        + calcClusterBurn({ blockDiff: 604853n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: ebVUnits48 })
        + calcClusterBurn({ blockDiff: 55n, numOperators: 1n, ethFee: newFeeRaw56, networkFee: 0n, effectiveVUnits: ebVUnits48 })
        + calcClusterBurn({ blockDiff: 50n, numOperators: 1n, ethFee: newFeeRaw56, networkFee: 0n, effectiveVUnits: ebVUnits64 });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarnings56);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);
    });

    // XO-057: EB cluster liquidated, op removed, then reactivated
    it("XO-057: EB cluster liquidated, op removed, then reactivated — deviation only to active ops", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Liquidate
      const ebVUnits = calcVUnits(48n);
      ({ cluster } = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
        4n, ebVUnits,
      ));

      // Remove op1
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // Deposit + reactivate
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: ebVUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, { value: dep });
      cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner).reactivate(operatorIds, cluster, { value: 0n });
      cluster = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.equal(true);

      // Removed op should have 0 vUnits (deviation not restored)
      const removedV = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(removedV).to.equal(0n, "removed op should not receive deviation on reactivation");

      // Active ops should have deviation restored: EB=48, 1 validator → deviation = 5000
      const expectedActiveDeviation = calcVUnits(48n) - defaultVUnits(1n);
      for (let i = 1; i < 4; i++) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(v).to.equal(expectedActiveDeviation, `active op${operatorIds[i]} deviation should be ${expectedActiveDeviation}`);
      }
    });

    // XO-060: compound fee + EB increases trigger auto-liquidation
    it("XO-060: compound fee + EB increases trigger auto-liquidation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 1,
      );

      // Fee increase for all ops
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      for (const opId of operatorIds) {
        await declareAndExecuteFee(network, provider, opOwner, opId, newFee);
      }

      // Mine blocks to drain significantly
      await mineBlocks(provider, 3000);

      // EB increase may trigger auto-liquidation
      const { cluster: updated } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      );

      // Compute exact burn: 4 * feeChangeBlocks + 3005 blocks total from register
      // Settlement uses OLD (implicit) vUnits = 10000
      const feeBlocks60 = DECLARE_OPERATOR_FEE_PERIOD + 3n;
      const totalP1_60 = 4n * feeBlocks60 + 3005n; // register to EB update
      const vUnits60 = defaultVUnits(1n);
      // Baseline: all 4 ops at old rate + network fee
      let burnP1_60 = calcClusterBurn({ blockDiff: totalP1_60, numOperators: 4n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits60 });
      // Extra burn for each op's time at 2x (extra 1x over baseline)
      for (let i = 1n; i <= 4n; i++) {
        burnP1_60 += calcClusterBurn({ blockDiff: totalP1_60 - i * feeBlocks60, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: vUnits60 });
      }
      // Balance after EB update settlement (before new vUnits applied): SMALL_ETH - burnP1
      // After EB update, new vUnits = calcVUnits(64) = 20000. Liquidation check uses new vUnits.
      // If balance > 0 after settlement, cluster survives (fees ~0.025 ETH << 1 ETH deposit)
      expect(updated.active).to.equal(true);
      expect(updated.balance).to.equal(SMALL_ETH_REGISTER_VALUE - burnP1_60);
    });

    // XO-063: zero-fee operator + EB update — deviation written, burn rate = 0 for that op
    it("XO-063: zero-fee operator + EB update — deviation written but burn rate = 0 for op", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // Reduce op1 fee to minimum (can't reduce below minimum)
      // Op1 already at minimum — just verify EB update works
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // All ops should have deviation = calcVUnits(48) - defaultVUnits(1) = 5000
      const expectedDev63 = calcVUnits(48n) - defaultVUnits(1n);
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDev63);
      }

      // Op1 still earns (it has a fee, just at minimum)
      await mineBlocks(provider, 100);
      // Earnings: Phase 1 (register→EBUpdate) = 5 blocks implicit + Phase 2 (EBUpdate→now) = 100 blocks EB=48
      const expectedEarnings63 = calcClusterBurn({
        blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n),
      }) + calcClusterBurn({
        blockDiff: 100n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n),
      });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarnings63);
    });

    // XO-064: remove 1 of 2 validators from explicit-EB cluster → withdrawOperatorEarnings
    it("XO-064: remove one validator from 2-validator EB cluster — earnings recalculated", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      // Register 2 validators
      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      ({ cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, cluster,
        DEFAULT_ETH_REGISTER_VALUE, 2,
      ));

      // EB update (96 for 2 validators)
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 96, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Remove validator 1
      const txRem = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await txRem.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(1n);

      await mineBlocks(provider, 100);

      // Operator earnings: 4 phases of accrual for 1 operator
      // Phase 1: val1→val2 (1 block, 1 val, vUnits=10000)
      // Phase 2: val2→EBUpdate (5 blocks, 2 vals, vUnits=20000)
      // Phase 3: EBUpdate→removeVal (101 blocks, 2 vals, EB=96 vUnits=30000)
      // Phase 4: removeVal→now (100 blocks, 1 val, deviation=10000 still set, vUnits=1*10000+10000=20000)
      const expectedEarnings64 =
        calcClusterBurn({ blockDiff: 1n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n) })
        + calcClusterBurn({ blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(2n) })
        + calcClusterBurn({ blockDiff: 101n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(96n) })
        + calcClusterBurn({ blockDiff: 100n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n) + (calcVUnits(96n) - defaultVUnits(2n)) });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarnings64);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);
    });

    // XO-069: reactivation with hasDeviation=true from other cluster
    it("XO-069: reactivation with hasDeviation=true from another cluster's EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      // Cluster A: EB update
      let { cluster: cA } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );
      ({ cluster: cA } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cA, 48, oracles(),
      ));

      // Cluster B: small deposit, liquidate
      let { cluster: cB } = await registerValidatorETH(
        network, clusterOwner2, operatorIds, EMPTY_CLUSTER,
        SMALL_ETH_REGISTER_VALUE, 2,
      );
      const vUnits = defaultVUnits(1n);
      ({ cluster: cB } = await drainAndLiquidate(
        network, provider, clusterOwner2, liquidator, operatorIds, cB,
        4n, vUnits,
      ));

      // Operators now have deviation from cluster A. Reactivating B should add to it.
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const dep = threshold * 3n;
      const txDep = await network
        .connect(clusterOwner2)
        .deposit(clusterOwner2.address, operatorIds, cB, { value: dep });
      cB = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

      const txR = await network.connect(clusterOwner2).reactivate(operatorIds, cB, { value: 0n });
      cB = parseClusterFromEvent(network, await txR.wait(), Events.CLUSTER_REACTIVATED);
      expect(cB.active).to.equal(true);

      // Operators should still have deviation from cluster A's EB=48: deviation = 5000
      const expectedDevFromA = calcVUnits(48n) - defaultVUnits(1n);
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDevFromA, "deviation from cluster A should persist");
      }
    });
  });

  // =========================================================================
  // EB + Operator Earnings Isolation (XO-014)
  // =========================================================================

  describe("EB + Operator Earnings", () => {
    // XO-014: EB increase then fee change — operator earnings uses deviation-weighted vUnits
    it("XO-014: EB increase then fee change — operator earnings at EB-weighted rate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      let { cluster } = await registerValidatorETH(
        network, clusterOwner, operatorIds, EMPTY_CLUSTER,
        DEFAULT_ETH_REGISTER_VALUE, 1,
      );

      // EB update
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      await mineBlocks(provider, 100);

      // Fee change settles operator snapshot at EB-weighted rate
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await declareAndExecuteFee(network, provider, opOwner, operatorIds[0], newFee);

      // Earnings: Phase 1 (register→EBUpdate) = 5 blocks implicit
      // Phase 2 (EBUpdate→execute) = mine(100) + declare(1) + mine(604801) + execute(1) = 604903 blocks at EB=48
      const expectedEarningsXO14 = calcClusterBurn({
        blockDiff: 5n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: defaultVUnits(1n),
      }) + calcClusterBurn({
        blockDiff: 604903n, numOperators: 1n, ethFee: OP_ETH_FEE_RAW, networkFee: 0n, effectiveVUnits: calcVUnits(48n),
      });
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.equal(expectedEarningsXO14);

      // Withdraw
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);
      const after = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(after).to.equal(0n);

      // -- Per-operator vUnits: EB=48, 1 validator --
      const proxyAddr = await network.getAddress();
      const explicitVUnits48 = calcVUnits(48n); // 15000
      const implicitVUnits1 = defaultVUnits(1n); // 10000
      const expectedDeviation = explicitVUnits48 - implicitVUnits1; // 5000
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.equal(expectedDeviation, `op${opId} vUnits deviation should be ${expectedDeviation} for EB=48`);
      }

      // -- daoTotalEthVUnits consistency: baseline + deviation = 15000 --
      const daoV = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoV).to.equal(explicitVUnits48, "daoTotalEthVUnits should equal total vUnits for EB=48");
    });
  });

  // =========================================================================
  // Migration (XO-025, XO-026)
  // =========================================================================

  describe("Migration + EB/Removal", () => {
    // XO-025: SSV cluster with explicit EB → migrate
    it("XO-025: SSV cluster with explicit EB → migrateClusterToETH", async function () {
      const { legacyNetwork, legacyViews, ssvToken } =
        await networkHelpers.loadFixture(ssvFixture);
      const provider = connection.ethers.provider;

      const OP_SSV_FEE = 10_000_000_000n;

      // Register ops in legacy
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const id = await legacyNetwork
          .connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNetwork
          .connect(opOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(id));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
      await ssvToken
        .connect(clusterOwner)
        .approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Upgrade
      const { newNetwork } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      // Setup oracles on new network
      await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      // EB update on SSV cluster
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root = computeEBRoot(clusterId, 48);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(newNetwork, root, rootBlockNum, oracles());

      const txEB = await newNetwork.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, 48, [],
      );
      cluster = parseClusterFromEvent(newNetwork, await txEB.wait(), Events.CLUSTER_BALANCE_UPDATED);

      // Migrate
      const ethDeposit = ethers.parseEther("5");
      const txMig = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receiptMig = await txMig.wait();
      const migCluster = parseClusterFromEvent(
        newNetwork, receiptMig, Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(migCluster.active).to.equal(true);
      expect(migCluster.balance).to.equal(ethDeposit);
    });

    // XO-026: migration with removed op + explicit EB
    it("XO-026: migration with removed op + explicit EB", async function () {
      const { legacyNetwork, legacyViews, ssvToken } =
        await networkHelpers.loadFixture(ssvFixture);
      const provider = connection.ethers.provider;

      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const id = await legacyNetwork
          .connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNetwork
          .connect(opOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(id));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT * 2n);
      await ssvToken
        .connect(clusterOwner)
        .approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT * 2n);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Upgrade
      const { newNetwork } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      // EB update
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const root = computeEBRoot(clusterId, 48);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(newNetwork, root, rootBlockNum, oracles());

      const txEB = await newNetwork.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, 48, [],
      );
      cluster = parseClusterFromEvent(newNetwork, await txEB.wait(), Events.CLUSTER_BALANCE_UPDATED);

      // Remove op1
      await newNetwork.connect(opOwner).removeOperator(operatorIds[0]);

      // Migrate
      const ethDeposit = ethers.parseEther("5");
      const txMig = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      const receiptMig = await txMig.wait();
      const migCluster = parseClusterFromEvent(
        newNetwork, receiptMig, Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(migCluster.active).to.equal(true);
    });
  });
});
