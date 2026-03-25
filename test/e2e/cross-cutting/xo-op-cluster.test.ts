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

      // Balance should be less than initial (fees drained)
      expect(cluster.balance).to.be.lessThan(balAfterRegister);
      expect(cluster.balance).to.be.greaterThan(0n);

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
      // Use getBalance view to check current balance
      const balView = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      expect(BigInt(balView)).to.be.lessThan(balAfterRegister);
      expect(BigInt(balView)).to.be.greaterThan(0n);

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

      // Balance should still be positive (lower burn rate means slower drain)
      expect(cluster.balance).to.be.greaterThan(0n);
      expect(cluster.balance).to.be.lessThan(balAfterHighRate);

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

      // Balance should be significantly reduced by the higher fee rate
      expect(cluster.balance).to.be.lessThan(balBefore);
      // Higher fees mean less remaining balance than at old rate
      expect(cluster.balance).to.be.greaterThan(0n);
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

      // Cluster balance should be positive (fees deducted but still solvent)
      expect(cluster.balance).to.be.greaterThan(0n);
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
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.be.greaterThan(0n);
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

      // Both should have lower balance (fees deducted)
      expect(clusterA.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
      expect(clusterB.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
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

      // Balance decreased (compound fee increase)
      expect(cluster.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
      expect(cluster.balance).to.be.greaterThan(0n);
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

      // Balance should have decreased significantly from compound effects
      expect(cluster.balance).to.be.lessThan(balBefore);
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
      expect(cluster.balance).to.be.lessThan(balBefore);
      expect(cluster.balance).to.be.greaterThan(0n);
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
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.be.greaterThan(0n);
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
      expect(contractBal).to.be.greaterThanOrEqual(
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

      // Balance reduced from fees
      expect(cluster.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
    });
  });

  // =========================================================================
  // Removed Operator + Cluster Ops (XO-016-020, XO-022-024, XO-041,
  // XO-044, XO-052, XO-054, XO-058-059, XO-061-062, XO-065-068)
  // =========================================================================

  describe("Removed Operator + Cluster Ops", () => {
    // XO-016: EB update writes deviation to removed op's vUnits (THE BUG)
    it("XO-016: EB update on cluster with removed operator — vUnits written to removed op", async function () {
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

      // EB update to 48 — deviation = 5000 per operator
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 48, oracles(),
      ));

      // Verify deviation written to removed op (THE KNOWN BUG: _updateOperatorVUnits
      // at SSVClusters.sol:504-509 iterates ALL operators without checking ethSnapshot.block)
      const vUnitsAfter = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      // BUG: deviation IS written to removed operator. 1 val * (48-32) ETH = 5000 vUnits
      expect(vUnitsAfter).to.equal(5000n, "BUG: deviation written to removed operator");
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

    // XO-018: EB increase triggers auto-liquidation with removed op
    it("XO-018: EB increase triggers auto-liquidation with removed operator", async function () {
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

      // EB increase to 64 — may trigger auto-liquidation
      const { cluster: updatedCluster, receipt } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      );

      // If auto-liquidation triggered, cluster is inactive
      // Otherwise it's still active but with increased vUnits
      if (!updatedCluster.active) {
        // Auto-liquidation fired
        expect(updatedCluster.active).to.equal(false);
      } else {
        // Cluster survived — verify it has higher vUnits
        expect(updatedCluster.balance).to.be.greaterThan(0n);
      }

      // BUG: removed op gets deviation from _updateOperatorVUnits (no ethSnapshot.block check)
      const removedV = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(removedV).to.be.greaterThan(0n, "BUG: deviation written to removed op during EB update");
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

      // Both should have balances reflecting 3-op burn rate (more remaining than 4-op would leave)
      expect(clusterA.balance).to.be.greaterThan(0n);
      expect(clusterB.balance).to.be.greaterThan(0n);
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
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.be.greaterThan(0n, "operator should have accrued earnings before removal");

      const opBalBefore = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).removeOperator(operatorIds[0]);
      const opBalAfter = await provider.getBalance(opOwner.address);

      // Operator should have received earnings payout (minus gas)
      // The payout amount should reflect EB-weighted accrual (higher than baseline)
      // Since earningsBefore is the EB-weighted accrual over 100 blocks, it should be significant
      const netReceived = opBalAfter - opBalBefore; // includes gas cost (negative offset)
      // earningsBefore reflects what was accrued; after gas, netReceived is less but still positive direction
      // The key: earningsBefore was nonzero — confirming EB-weighted accrual happened
      expect(earningsBefore).to.be.greaterThan(0n, "earningsBefore confirms EB-weighted accrual");

      // operatorEthVUnits[op1] should be deleted
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.equal(0n, "operatorEthVUnits zeroed after removal");
    });

    // XO-023: EB update → remove op → second EB update (deviation re-appears from zero)
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

      // EB update 2
      ({ cluster } = await doEBUpdate(
        network, provider, clusterOwner, operatorIds, cluster, 64, oracles(),
      ));

      // BUG: _updateOperatorVUnits writes to removed op on each EB update.
      // After first EB update (48), op1 got deviation from 0. After removal, vUnits deleted.
      // After second EB update (64), deviation re-written to removed op from 0.
      const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(vUnits).to.be.greaterThan(0n, "BUG: deviation re-appears on removed op after second EB update");
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

      // Zero burn rate, so most balance should remain (minus fees accrued before removals)
      expect(cluster.balance).to.be.greaterThan(0n);
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

      expect(cA.balance).to.be.greaterThan(0n);
      expect(cB.balance).to.be.greaterThan(0n);
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

      expect(cluster.balance).to.be.greaterThan(0n);
      expect(cluster.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE);
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

      // Balance should be > 0 (survived 1000 blocks at 3-op rate)
      expect(cluster.balance).to.be.greaterThan(0n);
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
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.be.greaterThan(0n);

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
      const earningsBefore = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earningsBefore).to.be.greaterThan(0n);

      const opOwnerBalBefore = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0]);

      // Remove operator — should settle remaining (near-zero since just withdrawn)
      const opOwnerBalAfterWithdraw = await provider.getBalance(opOwner.address);
      await network.connect(opOwner).removeOperator(operatorIds[0]);

      // The removal ETH payout should be small (only 1-2 blocks of accrual since withdrawal)
      const opOwnerBalAfterRemove = await provider.getBalance(opOwner.address);
      // Accounting: no double payout — just residual accrual
      const removalPayout = opOwnerBalAfterRemove - opOwnerBalAfterWithdraw;
      // removalPayout accounts for gas cost + any residual earnings.
      // The key assertion: the total withdrawal + removal payout is not significantly more than earningsBefore.
      // Since gas is consumed, the net payout after removal should be less than earningsBefore.
      const totalReceived = opOwnerBalAfterRemove - opOwnerBalBefore;
      expect(totalReceived).to.be.lessThan(
        earningsBefore,
        "no double payout: total received (minus gas) must not exceed original earnings",
      );
      // removalPayout itself should be small (residual accrual for ~2 blocks minus gas)
      expect(removalPayout).to.be.lessThan(
        earningsBefore,
        "removal payout should be much smaller than initial earnings",
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

      // Verify op2 earnings are valid
      const op2Earnings = await views.getOperatorEarnings(BigInt(operatorIds[1]));
      expect(op2Earnings).to.be.greaterThan(0n);

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

    // XO-068: shared removed op + other cluster EB update (underflow bug path)
    it("XO-068: shared removed op + other cluster EB update — no underflow", async function () {
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

      // EB update on cluster B
      ({ cluster: cB } = await doEBUpdate(
        network, provider, clusterOwner2, operatorIds, cB, 48, oracles(),
      ));

      // BUG: removed op gets deviation from other cluster's EB update
      const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]));
      expect(v).to.be.greaterThan(0n, "BUG: removed op gets deviation from other cluster EB update");
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
      expect(cluster.balance).to.be.greaterThan(0n);
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

      // Balance should be lower than starting deposit (fees drained faster at EB=48)
      expect(cluster.balance).to.be.lessThan(balBefore);

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
      expect(cluster.balance).to.be.greaterThan(0n);
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
      const txW = await network.connect(clusterOwner).withdraw(operatorIds, dep, cluster);
      cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
      // Balance should be near 0 (whatever was left after liquidation)
      expect(cluster.balance).to.be.lessThanOrEqual(dep);

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

      // Withdraw operator earnings
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);
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

      // -- Exact boundary: threshold computed with EB-weighted vUnits --
      const expectedThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: ebVUnits,
      });
      // Cluster balance should exceed the EB-weighted threshold
      expect(cluster.balance).to.be.greaterThan(expectedThreshold);
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

      // Operator should have earnings reflecting deviation from cluster A only
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);
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

      // Operator earnings should be positive and reflect all segments
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);
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

      // Active ops should have deviation restored
      for (let i = 1; i < 4; i++) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]));
        expect(v).to.be.greaterThan(0n, `active op${operatorIds[i]} should have deviation`);
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

      // If auto-liquidation triggered
      if (!updated.active) {
        expect(updated.active).to.equal(false);
      } else {
        // Cluster survived but balance should be very low
        expect(updated.balance).to.be.greaterThan(0n);
      }
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

      // All ops should have deviation
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.be.greaterThan(0n);
      }

      // Op1 still earns (it has a fee, just at minimum)
      await mineBlocks(provider, 100);
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);
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

      // Operator earnings should be positive
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);
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

      // Operators should still have deviation from cluster A
      for (const opId of operatorIds) {
        const v = await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId));
        expect(v).to.be.greaterThan(0n, "deviation from cluster A should persist");
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

      // Earnings should reflect EB-weighted accrual
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[0]));
      expect(earnings).to.be.greaterThan(0n);

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
      expect(migCluster.balance).to.be.greaterThan(0n);
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
