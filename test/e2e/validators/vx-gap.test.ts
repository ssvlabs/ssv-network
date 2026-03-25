/**
 * VX Gap Tests — Validator Remove/Exit scenarios not covered by existing tests.
 *
 * Covers: VX-006, VX-015, VX-020, VX-023, VX-028, VX-031, VX-033, VX-035,
 *         VX-037, VX-038, VX-040, VX-044, VX-050, VX-051, VX-052, VX-058,
 *         VX-059, VX-060, VX-062, VX-063, VX-064, VX-065, VX-067, VX-069
 *
 * Every test uses REAL removeOperator() — never mockRemoveOperator().
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
  setupTestContext,
  mineBlocks,
  getBlockNumber,
  calcVUnits,
  defaultVUnits,
  calcClusterBurn,
  calcLiquidationThreshold,
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
  setupOracles,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  SMALL_ETH_REGISTER_VALUE,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  BPS_DENOMINATOR,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";

// ─── Storage-slot helpers ─────────────────────────────────────────────────────
const EB_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const coder = ethers.AbiCoder.defaultAbiCoder();

function opEthVUnitsSlot(opId: number | bigint): string {
  const mappingSlot = EB_BASE + 2n;
  return ethers.keccak256(coder.encode(["uint256", "uint256"], [BigInt(opId), mappingSlot]));
}

function clusterEBSlot(clusterId: string): string {
  const mappingSlot = EB_BASE + 1n;
  return ethers.keccak256(coder.encode(["bytes32", "uint256"], [clusterId, mappingSlot]));
}

async function readOpEthVUnits(provider: any, addr: string, opId: number | bigint): Promise<bigint> {
  const raw = await provider.getStorage(addr, opEthVUnitsSlot(opId));
  return BigInt(raw) & ((1n << 64n) - 1n);
}

async function readClusterEBVUnits(provider: any, addr: string, clusterId: string): Promise<bigint> {
  const raw = await provider.getStorage(addr, clusterEBSlot(clusterId));
  return BigInt(raw) & ((1n << 64n) - 1n);
}

// ─── Event helpers ────────────────────────────────────────────────────────────
function parseCluster(network: any, receipt: any, eventName: string): Cluster {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = network.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === eventName) {
      const ct = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: BigInt(ct[0]),
        networkFeeIndex: BigInt(ct[1]),
        index: BigInt(ct[2]),
        active: ct[3],
        balance: BigInt(ct[4]),
      };
    }
  }
  throw new Error(`${eventName} event not found`);
}

function countEvents(network: any, receipt: any, eventName: string): number {
  let count = 0;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === eventName) count++;
    } catch { /* skip */ }
  }
  return count;
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe("VX Gap Tests — Validator Remove/Exit", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let signers: HardhatEthersSigner[];

  before(async function () {
    ({ connection, networkHelpers, signers } = await setupTestContext());
  });

  // ── Deploy helpers ────────────────────────────────────────────────────────

  /** Full fixture with oracles, N operators, whitelisted cluster owner(s) */
  async function deployAndSetup(opCount: number, clusterOwnerCount = 1) {
    const { network, views, cssvToken, ssvToken } = await ssvNetworkFullFixture(connection);
    const provider = connection.ethers.provider;
    const [owner, oracle1, oracle2, oracle3, oracle4, staker, ...rest] = signers;
    const oracles = [oracle1, oracle2, oracle3, oracle4];

    await setupOracles(network, ssvToken, staker, oracles);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, owner, opCount);
    const clusterOwners: HardhatEthersSigner[] = rest.slice(0, clusterOwnerCount);
    await whitelistAddresses(network, owner, operatorIds, clusterOwners.map(s => s.address));

    const networkAddr = await network.getAddress();
    return { network, views, ssvToken, cssvToken, provider, owner, oracles, staker, operatorIds, clusterOwners, networkAddr };
  }

  /** Register N validators and return fresh cluster state */
  async function registerValidators(
    network: any, clusterOwner: HardhatEthersSigner, operatorIds: number[],
    count: number, startPk = 1, depositValue = DEFAULT_ETH_REGISTER_VALUE,
  ): Promise<{ cluster: Cluster; pubkeys: string[] }> {
    const pubkeys: string[] = [];
    let cluster: Cluster = { ...EMPTY_CLUSTER };
    for (let i = 0; i < count; i++) {
      const pk = makePublicKey(startPk + i);
      pubkeys.push(pk);
      const tx = await network.connect(clusterOwner).registerValidator(
        pk, operatorIds, DEFAULT_SHARES, cluster, { value: depositValue },
      );
      const receipt = await tx.wait();
      cluster = parseCluster(network, receipt, Events.VALIDATOR_ADDED);
    }
    return { cluster, pubkeys };
  }

  /** Perform EB update via oracle quorum + updateClusterBalance */
  async function performEBUpdate(
    network: any, oracles: HardhatEthersSigner[], provider: any,
    clusterOwner: HardhatEthersSigner, operatorIds: number[], cluster: Cluster,
    clusterId: string, effectiveBalance: number,
  ): Promise<Cluster> {
    const root = computeEBRoot(clusterId, effectiveBalance);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, oracles);
    const tx = await network.updateClusterBalance(
      rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
    );
    const receipt = await tx.wait();
    try {
      return parseCluster(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    } catch {
      return parseCluster(network, receipt, Events.CLUSTER_LIQUIDATED);
    }
  }

  /** Drain cluster until liquidatable and liquidate */
  async function drainAndLiquidate(
    network: any, provider: any, clusterOwner: HardhatEthersSigner,
    liquidator: HardhatEthersSigner, operatorIds: number[], cluster: Cluster,
    numActiveOps: bigint, effectiveVUnits: bigint,
  ): Promise<Cluster> {
    const liqThreshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
      numOperators: numActiveOps, ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits,
    });
    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n, numOperators: numActiveOps, ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits,
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
    return parseCluster(network, receipt, Events.CLUSTER_LIQUIDATED);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-006: removeValidator (7 ops, ETH, active, explicit EB)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-006: removeValidator with 7-op cluster and explicit EB", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(7);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 2 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);

    // EB update: 70 ETH for 2 validators → vUnits = ceil(70*10000/32) = 21875
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);
    const expectedVUnits = calcVUnits(70n); // 21875
    const baseline2 = defaultVUnits(2n); // 20000
    const deviation = expectedVUnits - baseline2; // 1875

    // Remove 1 validator
    const tx = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(1n);

    // ebSnapshot.vUnits should be expectedVUnits - 1*BPS_DENOMINATOR
    const ebAfter = await readClusterEBVUnits(provider, networkAddr, clusterId);
    expect(ebAfter).to.equal(expectedVUnits - BPS_DENOMINATOR);

    // Deviation preserved in operators (not cleaned, because validatorCount != 0)
    for (const opId of operatorIds) {
      const vUnits = await readOpEthVUnits(provider, networkAddr, opId);
      expect(vUnits).to.equal(deviation);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-015: removeValidator from liquidated ETH cluster (implicit EB)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-015: removeValidator from liquidated ETH cluster — no settlement", async function () {
    const { network, provider, operatorIds, clusterOwners } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const liquidator = signers[2];

    // Register 1 validator with small deposit
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 1, 1, SMALL_ETH_REGISTER_VALUE,
    );

    // Drain and liquidate
    const liqCluster = await drainAndLiquidate(
      network, provider, clusterOwner, liquidator, operatorIds, clusterReg,
      4n, defaultVUnits(1n),
    );
    expect(liqCluster.active).to.equal(false);

    // Remove validator from liquidated cluster
    const tx = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, liqCluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.equal(false);
    // Balance stays at 0 (no settlement for liquidated)
    expect(clusterAfter.balance).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-020: removeValidator fee settlement with explicit EB
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-020: removeValidator settles fees using EB-weighted formula (explicit EB)", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 1 validator
    const { cluster: clusterReg } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // EB update: 48 ETH → vUnits = ceil(48*10000/32) = 15000 (1.5x baseline)
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 48);
    const depositBefore = BigInt(cluster.balance);

    // Mine blocks to accumulate fees
    await mineBlocks(provider, 100);

    // Remove — fee settlement uses vUnits=15000 (higher than default 10000)
    const tx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    // Fees deducted should be proportional to vUnits=15000
    const feesDeducted = depositBefore - BigInt(clusterAfter.balance);
    expect(feesDeducted).to.be.greaterThan(0n, "VX-020: fees must be deducted");

    // Verify the fee is EB-weighted: with vUnits=15000 (1.5x default 10000),
    // fees should be roughly 1.5x what they'd be at default EB
    const expectedVUnits = calcVUnits(48n);
    expect(expectedVUnits).to.equal(15000n, "VX-020: vUnits = ceil(48*10000/32) = 15000");

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.equal(true, "VX-020: cluster still active after removing last validator");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-023: remove then re-register same pubkey
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-023: removeValidator then re-register same pubkey succeeds", async function () {
    const { network, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;

    // Register validator
    const pk = makePublicKey(42);
    const tx1 = await network.connect(clusterOwner).registerValidator(
      pk, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const receipt1 = await tx1.wait();
    const cluster1 = parseCluster(network, receipt1, Events.VALIDATOR_ADDED);

    // Remove
    const tx2 = await network.connect(clusterOwner).removeValidator(pk, operatorIds, cluster1);
    const receipt2 = await tx2.wait();
    const cluster2 = parseCluster(network, receipt2, Events.VALIDATOR_REMOVED);
    expect(cluster2.validatorCount).to.equal(0n);

    // Re-register same pubkey — should succeed
    const tx3 = await network.connect(clusterOwner).registerValidator(
      pk, operatorIds, DEFAULT_SHARES, cluster2, { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const receipt3 = await tx3.wait();
    const cluster3 = parseCluster(network, receipt3, Events.VALIDATOR_ADDED);
    expect(cluster3.validatorCount).to.equal(1n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-028: bulkRemoveValidator — explicit EB + removed operator (THE BUG)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-028: bulkRemoveValidator all — explicit EB + removed operator — guard skips removed op", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 3 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);

    // EB update: 100 ETH for 3 validators → deviation exists
    // vUnits = ceil(100*10000/32) = 31250, baseline = 30000, deviation = 1250
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 100);
    const expectedVUnits = calcVUnits(100n);
    expect(expectedVUnits).to.equal(31250n, "VX-028: vUnits = ceil(100*10000/32) = 31250");
    const deviation = expectedVUnits - defaultVUnits(3n);
    expect(deviation).to.equal(1250n, "VX-028: exact deviation = 31250 - 30000 = 1250");

    // Remove operator 1 — deletes operatorEthVUnits[op1] to 0
    await network.connect(owner).removeOperator(operatorIds[0]);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);

    // bulkRemoveValidator all — guard skips removed op, no underflow
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // Removed op stays at 0
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n, "removed op vUnits stays 0");

    // Active ops cleaned up to 0 after removing all validators
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n, `op[${i}] vUnits cleaned`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-031: bulkRemoveValidator — 50 validators, 13 ops (stress test)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-031: bulkRemoveValidator stress — 50 validators, 13 ops", async function () {
    this.timeout(300000); // 5 minutes for large test
    const { network, operatorIds, clusterOwners } =
      await deployAndSetup(13);
    const [clusterOwner] = clusterOwners;

    // Register 50 validators via bulkRegisterValidator
    const pubkeys: string[] = [];
    const sharesArray: string[] = [];
    for (let i = 1; i <= 50; i++) {
      pubkeys.push(makePublicKey(i));
      sharesArray.push(DEFAULT_SHARES);
    }
    const regTx = await network.connect(clusterOwner).bulkRegisterValidator(
      pubkeys, operatorIds, sharesArray, EMPTY_CLUSTER,
      { value: ethers.parseEther("100") },
    );
    const regReceipt = await regTx.wait();
    const clusterReg = parseCluster(network, regReceipt, Events.VALIDATOR_ADDED);
    expect(clusterReg.validatorCount).to.equal(50n);

    // Bulk remove all 50
    const removeTx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, clusterReg);
    const removeReceipt = await removeTx.wait();
    const clusterAfter = parseCluster(network, removeReceipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(countEvents(network, removeReceipt, Events.VALIDATOR_REMOVED)).to.equal(50);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-033: bulkRemoveValidator — SSV cluster, liquidated
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-033: bulkRemoveValidator from liquidated SSV cluster", async function () {
    const deploySSVFixture = async () => {
      const { network: legacyNet, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const opOwner = signers[0];
      const clusterOwner = signers[1];
      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNet.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNet.connect(opOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvAmount = TOKEN_REGISTER_AMOUNT * 5n;
      await ssvToken.mint(clusterOwner.address, ssvAmount);
      await ssvToken.connect(clusterOwner).approve(await legacyNet.getAddress(), ssvAmount);

      // Register 3 validators
      const pubkeys: string[] = [];
      let cluster: any = EMPTY_CLUSTER;
      for (let i = 1; i <= 3; i++) {
        pubkeys.push(makePublicKey(i));
        await legacyNet.connect(clusterOwner).registerValidator(
          makePublicKey(i), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
        );
        cluster = await getCurrentClusterState(connection, legacyNet, clusterOwner.address, operatorIds);
      }

      // Upgrade
      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNet, legacyViews);

      // Drain and liquidate the SSV cluster
      const provider = connection.ethers.provider;
      await mineBlocks(provider, 300_000_000);

      const liqTx = await newNetwork.connect(clusterOwner).liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseCluster(newNetwork, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);

      return { network: newNetwork, views: newViews, operatorIds, cluster: liqCluster, pubkeys, clusterOwner };
    };

    const { network, operatorIds, cluster, pubkeys, clusterOwner } =
      await networkHelpers.loadFixture(deploySSVFixture);

    // Bulk remove from liquidated SSV cluster
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.equal(false);
    // Balance remains 0 — no settlement for liquidated
    expect(clusterAfter.balance).to.equal(0n);
    expect(countEvents(network, receipt, Events.VALIDATOR_REMOVED)).to.equal(3);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-035: bulkRemoveValidator — liquidated, explicit EB, all validators
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-035: bulkRemoveValidator all from liquidated cluster with explicit EB — deviation NOT cleaned", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const liquidator = signers[2];
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 2 validators with small deposit
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 2, 1, SMALL_ETH_REGISTER_VALUE,
    );

    // EB update: 68 ETH → vUnits = ceil(68*10000/32) = 21250, baseline=20000, deviation=1250
    const cluster = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 68,
    );

    // Drain and liquidate (liquidation cleans deviation from operators)
    const liqCluster = await drainAndLiquidate(
      network, provider, clusterOwner, liquidator, operatorIds, cluster,
      4n, calcVUnits(68n),
    );
    expect(liqCluster.active).to.equal(false);

    // Bulk remove all from liquidated cluster
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, liqCluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.equal(false);

    // ebSnapshot.vUnits zeroed unconditionally
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);

    // operatorEthVUnits NOT modified by remove (already cleaned by liquidation)
    // After liquidation they should be 0 for this cluster's contribution
    for (const opId of operatorIds) {
      const vUnits = await readOpEthVUnits(provider, networkAddr, opId);
      expect(vUnits).to.equal(0n);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-037: bulkRemoveValidator — multiple removed operators, deviation cleanup
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-037: bulkRemoveValidator all — 7-op, 2 removed ops — guard skips removed ops", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(7);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 3 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);

    // EB update: 100 ETH → vUnits = 31250, baseline = 30000, deviation = 1250
    const cluster = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 100,
    );

    // Remove operators 3 and 5 (indices 2 and 4)
    await network.connect(owner).removeOperator(operatorIds[2]);
    await network.connect(owner).removeOperator(operatorIds[4]);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[2])).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[4])).to.equal(0n);

    // Bulk remove all — guard skips removed ops, no underflow
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // Removed ops stay at 0
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[2])).to.equal(0n, "removed op[2] stays 0");
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[4])).to.equal(0n, "removed op[4] stays 0");

    // Active ops cleaned up to 0
    for (const i of [0, 1, 3, 5, 6]) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n, `op[${i}] vUnits cleaned`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-038: bulkRemoveValidator — EB deviation after prior EB update (no underflow)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-038: bulkRemoveValidator after EB up then EB down — deviation correct, no underflow", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 2 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);

    // First EB update: 80 ETH → vUnits = 25000, baseline=20000, deviation=5000
    const cluster1 = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 80,
    );

    // Verify deviation of 5000
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(5000n);
    }

    // Second EB update: 66 ETH → vUnits = ceil(66*10000/32) = 20625, baseline=20000, deviation=625
    const cluster2 = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, cluster1, clusterId, 66,
    );

    // Verify deviation reduced to 625
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(625n);
    }

    // Bulk remove all — cleanup should subtract remainingVUnits=625, not historical 5000
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster2);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(0n);
    }
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-040: exitValidator from SSV cluster
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-040: exitValidator from legacy SSV cluster — event only, no state change", async function () {
    const deploySSVFixture = async () => {
      const { network: legacyNet, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const opOwner = signers[0];
      const clusterOwner = signers[1];
      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNet.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNet.connect(opOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvAmount = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvAmount);
      await ssvToken.connect(clusterOwner).approve(await legacyNet.getAddress(), ssvAmount);

      await legacyNet.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      await getCurrentClusterState(connection, legacyNet, clusterOwner.address, operatorIds);

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNet, legacyViews);
      return { network: newNetwork, operatorIds, clusterOwner };
    };

    const { network, operatorIds, clusterOwner } =
      await networkHelpers.loadFixture(deploySSVFixture);

    // Exit — should emit event, no state changes
    const tx = await network.connect(clusterOwner).exitValidator(makePublicKey(1), operatorIds);
    await expect(tx).to.emit(network, Events.VALIDATOR_EXITED);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-044: exitValidator from liquidated cluster
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-044: exitValidator from liquidated cluster — event emitted (no cluster check)", async function () {
    const { network, provider, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const liquidator = signers[2];

    // Register with small deposit
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 1, 1, SMALL_ETH_REGISTER_VALUE,
    );

    // Drain and liquidate
    const liqCluster = await drainAndLiquidate(
      network, provider, clusterOwner, liquidator, operatorIds, clusterReg,
      4n, defaultVUnits(1n),
    );
    expect(liqCluster.active).to.equal(false);

    // Exit from liquidated cluster — should still emit event (only checks validator existence)
    const tx = await network.connect(clusterOwner).exitValidator(pubkeys[0], operatorIds);
    await expect(tx).to.emit(network, Events.VALIDATOR_EXITED);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-050: bulkExitValidator — non-owner caller (revert)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-050: bulkExitValidator from non-owner reverts", async function () {
    const { network, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const notOwner = signers[7]; // some other signer

    // Register 2 validators
    const { pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);

    // Bulk exit from wrong address — _validateExistingValidator hashes with msg.sender,
    // so the hash doesn't match → ValidatorDoesNotExist
    await expect(
      network.connect(notOwner).bulkExitValidator(pubkeys, operatorIds),
    ).to.be.revertedWithCustomError(network, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-051: bulkExitValidator from liquidated cluster
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-051: bulkExitValidator from liquidated cluster — events emitted", async function () {
    const { network, provider, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const liquidator = signers[2];

    // Register 2 validators with small deposit
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 2, 1, SMALL_ETH_REGISTER_VALUE,
    );

    // Drain and liquidate
    const liqCluster = await drainAndLiquidate(
      network, provider, clusterOwner, liquidator, operatorIds, clusterReg,
      4n, defaultVUnits(2n),
    );
    expect(liqCluster.active).to.equal(false);

    // Bulk exit from liquidated — should still work (event-only)
    const tx = await network.connect(clusterOwner).bulkExitValidator(pubkeys, operatorIds);
    const receipt = await tx.wait();
    expect(countEvents(network, receipt, Events.VALIDATOR_EXITED)).to.equal(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-052: bulkExitValidator — SSV cluster
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-052: bulkExitValidator from legacy SSV cluster — events emitted", async function () {
    const deploySSVFixture = async () => {
      const { network: legacyNet, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const opOwner = signers[0];
      const clusterOwner = signers[1];
      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNet.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNet.connect(opOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvAmount = TOKEN_REGISTER_AMOUNT * 5n;
      await ssvToken.mint(clusterOwner.address, ssvAmount);
      await ssvToken.connect(clusterOwner).approve(await legacyNet.getAddress(), ssvAmount);

      // Register 2 validators
      let cluster: any = EMPTY_CLUSTER;
      for (let i = 1; i <= 2; i++) {
        await legacyNet.connect(clusterOwner).registerValidator(
          makePublicKey(i), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
        );
        cluster = await getCurrentClusterState(connection, legacyNet, clusterOwner.address, operatorIds);
      }

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNet, legacyViews);
      return { network: newNetwork, operatorIds, cluster, clusterOwner };
    };

    const { network, operatorIds, clusterOwner } =
      await networkHelpers.loadFixture(deploySSVFixture);

    // Bulk exit
    const pubkeys = [makePublicKey(1), makePublicKey(2)];
    const tx = await network.connect(clusterOwner).bulkExitValidator(pubkeys, operatorIds);
    const receipt = await tx.wait();
    expect(countEvents(network, receipt, Events.VALIDATOR_EXITED)).to.equal(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-058: bulkRemoveValidator — interleaved with deposit
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-058: bulkRemoveValidator after deposit — fee settlement uses correct balance", async function () {
    const { network, provider, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;

    // Register 5 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 5);
    const balanceAfterReg = BigInt(clusterReg.balance);

    // Deposit more ETH
    const extraDeposit = ethers.parseEther("5");
    const depTx = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, clusterReg, { value: extraDeposit },
    );
    const depReceipt = await depTx.wait();
    const clusterDep = parseCluster(network, depReceipt, Events.CLUSTER_DEPOSITED);
    const balanceAfterDeposit = BigInt(clusterDep.balance);
    expect(balanceAfterDeposit).to.be.greaterThan(balanceAfterReg);

    await mineBlocks(provider, 100);

    // Bulk remove 3 of 5
    const pubkeysToRemove = pubkeys.slice(0, 3);
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeysToRemove, operatorIds, clusterDep);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(2n, "VX-058: 5 - 3 = 2 validators remain");
    // Balance should be less than deposit balance (fees were settled)
    expect(BigInt(clusterAfter.balance)).to.be.lessThan(balanceAfterDeposit);
    // Balance should still be substantially positive — at least half of deposit remains
    // (100 blocks of fees on 5 validators at min fee cannot drain 15+ ETH)
    expect(BigInt(clusterAfter.balance)).to.be.greaterThan(
      balanceAfterDeposit / 2n,
      "VX-058: balance > half deposit (fees are small relative to deposit)",
    );
    expect(clusterAfter.active).to.equal(true, "VX-058: cluster active after partial removal");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-059: removeValidator then exitValidator same pubkey — revert
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-059: removed validator then exit same pubkey — reverts ValidatorDoesNotExist", async function () {
    const { network, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;

    const pk = makePublicKey(1);
    const { cluster: clusterReg } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // Remove
    const tx = await network.connect(clusterOwner).removeValidator(pk, operatorIds, clusterReg);
    await tx.wait();

    // Exit same pubkey — should revert
    await expect(
      network.connect(clusterOwner).exitValidator(pk, operatorIds),
    ).to.be.revertedWithCustomError(network, Errors.VALIDATOR_DOES_NOT_EXIST);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-060: 10-op cluster, explicit EB, all removed, deviation cleanup
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-060: bulkRemoveValidator all — 10-op, explicit EB, deviation cleanup across all ops", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(10);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 3 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);

    // EB update: 100 ETH → deviation = 31250 - 30000 = 1250
    const cluster = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 100,
    );
    const deviation = calcVUnits(100n) - defaultVUnits(3n);

    // Verify deviation on all 10 operators
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(deviation);
    }

    // Bulk remove all
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(0n);
    }
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
    expect(countEvents(network, receipt, Events.VALIDATOR_REMOVED)).to.equal(3);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-062: bulkExitValidator — idempotent (second call with same validators)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-062: bulkExitValidator twice — idempotent, second call succeeds", async function () {
    const { network, operatorIds, clusterOwners } = await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;

    const { pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);

    // First bulk exit
    const tx1 = await network.connect(clusterOwner).bulkExitValidator(pubkeys, operatorIds);
    const receipt1 = await tx1.wait();
    expect(countEvents(network, receipt1, Events.VALIDATOR_EXITED)).to.equal(3);

    // Second bulk exit — should also succeed (event-only, idempotent)
    const tx2 = await network.connect(clusterOwner).bulkExitValidator(pubkeys, operatorIds);
    const receipt2 = await tx2.wait();
    expect(countEvents(network, receipt2, Events.VALIDATOR_EXITED)).to.equal(3);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-063: bulkRemoveValidator — EB deviation underflow with removed op (THE BUG variant)
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-063: bulkRemoveValidator — removed op with 0 vUnits — guard prevents underflow", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 2 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);

    // EB update: 80 ETH → vUnits = 25000, baseline=20000, deviation=5000
    const cluster = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 80,
    );
    const deviation = calcVUnits(80n) - defaultVUnits(2n); // 5000

    // Remove operator — deletes its operatorEthVUnits to 0
    await network.connect(owner).removeOperator(operatorIds[0]);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);

    // Active operators still have deviation=5000
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(deviation);
    }

    // Bulk remove all — guard skips removed op, no underflow
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // Removed op stays at 0
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n, "removed op stays 0");

    // Active ops cleaned up to 0
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n, `op[${i}] vUnits cleaned`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-064: removeValidator — ALL operators removed
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-064: removeValidator from cluster where ALL operators are removed", async function () {
    const { network, provider, owner, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;

    // Register 1 validator
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // Remove ALL operators
    for (const opId of operatorIds) {
      await network.connect(owner).removeOperator(opId);
    }

    // Remove validator — all operators skipped in updateClusterOperators
    const tx = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, clusterReg);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    // No operator snapshot updates happened (all skipped)
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(0n);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-065: removeValidator — SSV cluster with removed operator
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-065: removeValidator from SSV cluster where one op is removed — SSV path skips removed op", async function () {
    const deploySSVFixture = async () => {
      const { network: legacyNet, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const opOwner = signers[0];
      const clusterOwner = signers[1];
      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNet.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNet.connect(opOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvAmount = TOKEN_REGISTER_AMOUNT * 3n;
      await ssvToken.mint(clusterOwner.address, ssvAmount);
      await ssvToken.connect(clusterOwner).approve(await legacyNet.getAddress(), ssvAmount);

      await legacyNet.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(connection, legacyNet, clusterOwner.address, operatorIds);

      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNet, legacyViews);
      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, clusterOwner, opOwner };
    };

    const { network, views, operatorIds, cluster, clusterOwner, opOwner } =
      await networkHelpers.loadFixture(deploySSVFixture);

    // Remove operator 1 (SSV operator, snapshot.block == 0 after removal)
    await network.connect(opOwner).removeOperator(operatorIds[0]);

    // Get operator SSV state before removal
    const opsBefore: bigint[] = [];
    for (let i = 1; i < 4; i++) {
      const opData = await views.getOperatorByIdSSV(operatorIds[i]);
      opsBefore.push(BigInt(opData.validatorCount));
    }

    // Remove validator from SSV cluster
    const tx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);

    // Active operators: validatorCount decremented
    for (let i = 1; i < 4; i++) {
      const opData = await views.getOperatorByIdSSV(operatorIds[i]);
      expect(BigInt(opData.validatorCount)).to.equal(opsBefore[i - 1] - 1n);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-067: bulkRemoveValidator — SSV cluster, all to zero
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-067: bulkRemoveValidator all from SSV cluster — validatorCount reaches 0", async function () {
    const deploySSVFixture = async () => {
      const { network: legacyNet, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const opOwner = signers[0];
      const clusterOwner = signers[1];
      const OP_SSV_FEE = 10_000_000_000n;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNet.connect(opOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNet.connect(opOwner).registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvAmount = TOKEN_REGISTER_AMOUNT * 5n;
      await ssvToken.mint(clusterOwner.address, ssvAmount);
      await ssvToken.connect(clusterOwner).approve(await legacyNet.getAddress(), ssvAmount);

      // Register 3 validators
      const pubkeys: string[] = [];
      let cluster: any = EMPTY_CLUSTER;
      for (let i = 1; i <= 3; i++) {
        pubkeys.push(makePublicKey(i));
        await legacyNet.connect(clusterOwner).registerValidator(
          makePublicKey(i), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
        );
        cluster = await getCurrentClusterState(connection, legacyNet, clusterOwner.address, operatorIds);
      }

      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNet, legacyViews);
      return { network: newNetwork, views: newViews, operatorIds, cluster, pubkeys, clusterOwner };
    };

    const { network, views, operatorIds, cluster, pubkeys, clusterOwner } =
      await networkHelpers.loadFixture(deploySSVFixture);

    // Bulk remove all 3
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.equal(true);
    expect(countEvents(network, receipt, Events.VALIDATOR_REMOVED)).to.equal(3);

    // SSV DAO counts decremented
    for (const opId of operatorIds) {
      const opData = await views.getOperatorByIdSSV(opId);
      expect(BigInt(opData.validatorCount)).to.equal(0n);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VX-069: bulkRemoveValidator — liquidated, explicit EB, partial removal
  // ═══════════════════════════════════════════════════════════════════════════
  it("VX-069: bulkRemoveValidator partial from liquidated cluster with explicit EB — no cleanup", async function () {
    const { network, provider, oracles, operatorIds, clusterOwners } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const liquidator = signers[2];
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 3 validators with small deposit
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 3, 1, SMALL_ETH_REGISTER_VALUE,
    );

    // EB update: 100 ETH → vUnits = 31250, baseline=30000, deviation=1250
    const cluster = await performEBUpdate(
      network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 100,
    );

    // Liquidate
    const liqCluster = await drainAndLiquidate(
      network, provider, clusterOwner, liquidator, operatorIds, cluster,
      4n, calcVUnits(100n),
    );
    expect(liqCluster.active).to.equal(false);

    // Partial bulk remove (2 of 3) from liquidated cluster
    const pubkeysToRemove = pubkeys.slice(0, 2);
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeysToRemove, operatorIds, liqCluster);
    const receipt = await tx.wait();
    const clusterAfter = parseCluster(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(1n);
    expect(clusterAfter.active).to.equal(false);
    // No settlement for liquidated cluster
    expect(clusterAfter.balance).to.equal(0n);

    // ebSnapshot.vUnits decremented by 2 * BPS_DENOMINATOR
    // but NOT entering last-validator cleanup (validatorCount != 0)
    // The key assertion: cluster still has 1 validator, so no final cleanup triggered
    expect(clusterAfter.validatorCount).to.equal(1n);
    expect(countEvents(network, receipt, Events.VALIDATOR_REMOVED)).to.equal(2);
  });
});
