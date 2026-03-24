/**
 * RM3: bulkRemoveValidator / removeValidator with Removed Operators
 *
 * Tests the deviation cleanup loop at SSVValidators.sol lines 215-218.
 * Bug: removeOperator() deletes operatorEthVUnits[opId] (→ 0), but the
 * cleanup loop subtracts remainingVUnits from ALL operators including removed
 * ones, causing uint64 underflow.
 * Fix: Guard `if (s.operators[operatorIds[i]].ethSnapshot.block == 0) continue;`
 *
 * Every test uses REAL removeOperator() — never mockRemoveOperator().
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  generateMerkleForClusterEB,
  setupTestContext,
  mineBlocks,
  getBlockNumber,
  calcVUnits,
  defaultVUnits,
  computeClusterId,
  commitEBRoot,
  setupOracles,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  SMALL_ETH_REGISTER_VALUE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

// ─── Storage-slot helpers for direct reads ───────────────────────────────────
const EB_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const PROTOCOL_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;

const coder = ethers.AbiCoder.defaultAbiCoder();

function opEthVUnitsSlot(opId: number | bigint): string {
  const mappingSlot = EB_BASE + 2n;
  return ethers.keccak256(coder.encode(["uint256", "uint256"], [BigInt(opId), mappingSlot]));
}

function clusterEBSlot(clusterId: string): string {
  const mappingSlot = EB_BASE + 1n;
  return ethers.keccak256(coder.encode(["bytes32", "uint256"], [clusterId, mappingSlot]));
}

const DAO_TOTAL_SLOT = "0x" + (PROTOCOL_BASE + 4n).toString(16).padStart(64, "0");

async function readOpEthVUnits(provider: any, addr: string, opId: number | bigint): Promise<bigint> {
  const raw = await provider.getStorage(addr, opEthVUnitsSlot(opId));
  return BigInt(raw) & ((1n << 64n) - 1n);
}

async function readDaoTotalEthVUnits(provider: any, addr: string): Promise<bigint> {
  const raw = await provider.getStorage(addr, DAO_TOTAL_SLOT);
  return (BigInt(raw) >> 192n) & ((1n << 64n) - 1n);
}

async function readClusterEBVUnits(provider: any, addr: string, clusterId: string): Promise<bigint> {
  const raw = await provider.getStorage(addr, clusterEBSlot(clusterId));
  return BigInt(raw) & ((1n << 64n) - 1n);
}

// ─── Event helpers ───────────────────────────────────────────────────────────
function parseClusterFromReceipt(network: any, receipt: any, eventName: string): Cluster {
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

// ─── Shared test context ─────────────────────────────────────────────────────
describe("RM3: bulkRemoveValidator with Removed Operators", function () {
  let connection: NetworkConnection<"generic">;

  before(async function () {
    ({ connection } = await setupTestContext());
  });

  /** Deploy full fixture + set up oracles + register operators + whitelist */
  async function deployAndSetup(opCount: number, clusterOwnerCount = 1) {
    const { network, views, cssvToken, ssvToken } = await ssvNetworkFullFixture(connection);
    const provider = connection.ethers.provider;
    const signers = await connection.ethers.getSigners();
    const [owner, oracle1, oracle2, oracle3, oracle4, staker, ...rest] = signers;
    const oracles = [oracle1, oracle2, oracle3, oracle4];

    // Setup oracles
    await setupOracles(network, ssvToken, staker, oracles);

    // Register operators
    const operatorIds = await registerOperators(network, owner, opCount);

    // Get cluster owners
    const clusterOwners: HardhatEthersSigner[] = rest.slice(0, clusterOwnerCount);

    // Whitelist cluster owners
    await whitelistAddresses(network, owner, operatorIds, clusterOwners.map(s => s.address));

    const networkAddr = await network.getAddress();

    return { network, views, ssvToken, cssvToken, provider, owner, oracles, staker, operatorIds, clusterOwners, networkAddr, signers };
  }

  /** Register N validators and return fresh cluster state */
  async function registerValidators(
    network: any,
    clusterOwner: HardhatEthersSigner,
    operatorIds: number[],
    count: number,
    startPk = 1,
    depositValue = DEFAULT_ETH_REGISTER_VALUE,
  ): Promise<{ cluster: Cluster; pubkeys: string[] }> {
    const pubkeys: string[] = [];
    let cluster: Cluster = { ...EMPTY_CLUSTER };

    for (let i = 0; i < count; i++) {
      const pk = makePublicKey(startPk + i);
      pubkeys.push(pk);
      const tx = await network.connect(clusterOwner).registerValidator(
        pk, operatorIds, DEFAULT_SHARES, cluster,
        { value: depositValue },
      );
      const receipt = await tx.wait();
      cluster = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_ADDED);
    }
    return { cluster, pubkeys };
  }

  /** Perform EB update via oracle quorum + updateClusterBalance */
  async function performEBUpdate(
    network: any,
    oracles: HardhatEthersSigner[],
    provider: any,
    clusterOwner: HardhatEthersSigner,
    operatorIds: number[],
    cluster: Cluster,
    clusterId: string,
    effectiveBalance: number,
  ): Promise<Cluster> {
    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId, effectiveBalance },
    ]);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, oracles);
    const tx = await network.updateClusterBalance(
      rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
    );
    const receipt = await tx.wait();
    return parseClusterFromReceipt(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Core Bug Scenarios — Guard Needed (revert without fix)
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-001: 4-op cluster, explicit EB, removeOp1, bulkRemoveValidator (last) — core underflow", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 1 validator
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // EB update: 34 ETH → vUnits = 10625, deviation = 625
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // Verify deviation was applied
    const deviation = calcVUnits(34n) - defaultVUnits(1n); // 10625 - 10000 = 625
    expect(deviation).to.equal(625n);

    // Remove operator 1
    await network.connect(owner).removeOperator(operatorIds[0]);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);

    // bulkRemoveValidator — last validator (would underflow without guard)
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n);
    }
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-003: 4-op cluster, explicit EB, removeOp1, removeValidator (single, last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Single removeValidator — same code path as bulk
    const tx = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-005: 7-op cluster, explicit EB, removeOp1, bulkRemoveValidator (last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(7);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-006: 10-op cluster, explicit EB, removeOp1, bulkRemoveValidator (last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(10);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-007: 13-op cluster, explicit EB, removeOp1, bulkRemoveValidator (last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(13);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-008: 7-op cluster, 2 ops removed, bulkRemoveValidator (last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(7);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // Remove 2 operators
    await network.connect(owner).removeOperator(operatorIds[2]);
    await network.connect(owner).removeOperator(operatorIds[4]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[2])).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[4])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-010: 4-op cluster, explicit EB, removeOp1, bulk remove all N validators at once", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 3 validators
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);

    // EB update: 3 validators, 102 ETH total → baseline = 30000, vUnits = ceil(102*10000/32) = 31875
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 102);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Bulk remove all 3 at once
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Partial Removal — Deviation Cleanup NOT Triggered
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-002: 4-op cluster, explicit EB, removeOp1, bulkRemoveValidator (not last) — no cleanup", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);

    await network.connect(owner).removeOperator(operatorIds[0]);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);

    // Remove 1 of 2 — not last, no deviation cleanup
    const tx = await network.connect(clusterOwner).bulkRemoveValidator([pubkeys[0]], operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(1n);
    // ebSnapshot.vUnits should be reduced by 1 * BPS_DENOMINATOR but still > 0
    const ebVUnits = await readClusterEBVUnits(provider, networkAddr, clusterId);
    expect(ebVUnits).to.be.greaterThan(0n);
    // Removed op's vUnits still 0 (deletion from removeOperator stands)
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
  });

  it("RM3-004: 4-op cluster, explicit EB, removeOp1, removeValidator (single, not last) — no cleanup", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(1n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
  });

  it("RM3-014: 4-op cluster, explicit EB, removeOp1 — ethValidatorCount NOT decremented for removed op", async function () {
    const { network, views, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Remove validator — op1 is skipped in updateClusterOperators
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // Live ops should have ethValidatorCount = 0 (decremented from 1 to 0)
    for (let i = 1; i < 4; i++) {
      const opData = await views.getOperatorById(BigInt(operatorIds[i]));
      expect(BigInt(opData[2])).to.equal(0n, `op ${operatorIds[i]} ethValidatorCount should be 0`);
    }
    // Removed op — getOperatorById returns zeroed data
    const removedOpData = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(removedOpData[2])).to.equal(0n, "removed op ethValidatorCount should be 0");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Two-Step Drain — Partial Then Last
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-011: 4-op, explicit EB, removeOp1, removeValidator (1/2), removeValidator (last) — two-step", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Step 1: remove first validator (not last — no cleanup)
    const tx1 = await network.connect(clusterOwner).removeValidator(pubkeys[0], operatorIds, cluster);
    const receipt1 = await tx1.wait();
    const clusterMid = parseClusterFromReceipt(network, receipt1, Events.VALIDATOR_REMOVED);
    expect(clusterMid.validatorCount).to.equal(1n);

    // Step 2: remove last validator (triggers cleanup — guard needed)
    const tx2 = await network.connect(clusterOwner).removeValidator(pubkeys[1], operatorIds, clusterMid);
    const receipt2 = await tx2.wait();
    const clusterFinal = parseClusterFromReceipt(network, receipt2, Events.VALIDATOR_REMOVED);

    expect(clusterFinal.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-022: 4-op, explicit EB, removeOp1, bulkRemove (2/3), bulkRemove (last 1) — two-phase bulk", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 3);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 102);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Phase 1: remove 2 of 3 (not last, no cleanup)
    const tx1 = await network.connect(clusterOwner).bulkRemoveValidator(
      [pubkeys[0], pubkeys[1]], operatorIds, cluster,
    );
    const receipt1 = await tx1.wait();
    const clusterMid = parseClusterFromReceipt(network, receipt1, Events.VALIDATOR_REMOVED);
    expect(clusterMid.validatorCount).to.equal(1n);

    // Phase 2: remove last 1 (triggers cleanup)
    const tx2 = await network.connect(clusterOwner).bulkRemoveValidator(
      [pubkeys[2]], operatorIds, clusterMid,
    );
    const receipt2 = await tx2.wait();
    const clusterFinal = parseClusterFromReceipt(network, receipt2, Events.VALIDATOR_REMOVED);

    expect(clusterFinal.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Negative / Edge-Case Tests
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-009: register after op removal reverts; pre-registered validators bulk-removed successfully", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 2 validators BEFORE removal
    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);

    // Remove operator 2
    await network.connect(owner).removeOperator(operatorIds[1]);

    // Trying to register a new validator should revert (cluster contains removed op)
    await expect(
      network.connect(clusterOwner).registerValidator(
        makePublicKey(100), operatorIds, DEFAULT_SHARES, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      ),
    ).to.be.revertedWithCustomError(network, "OperatorDoesNotExist");

    // But bulk-removing the pre-registered validators succeeds
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[1])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-012: implicit EB (no oracle update), removeOp1, bulkRemoveValidator (last) — no deviation, no risk", async function () {
    const { network, provider, owner, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register 1 validator — NO EB update (implicit EB)
    const { cluster, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // ebSnapshot.vUnits should be 0 (no explicit EB)
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Remove validator — entire EB block skipped because ebSnapshot.vUnits == 0
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
  });

  it("RM3-013: explicit EB with zero deviation (32 ETH), removeOp1, bulkRemoveValidator (last) — no cleanup needed", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // EB update: 32 ETH → vUnits = 10000 = baseline → deviation = 0
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 32);
    expect(calcVUnits(32n) - defaultVUnits(1n)).to.equal(0n);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Remove last validator — deviation is 0 so remainingVUnits = 0, loop skipped
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Verification & Accounting Scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-015: verify operatorEthVUnits subtracted from live ops only", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    const deviation = calcVUnits(34n) - defaultVUnits(1n); // 625

    // Before removal: live ops have deviation in operatorEthVUnits
    for (let i = 0; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(deviation);
    }

    await network.connect(owner).removeOperator(operatorIds[0]);
    // After removeOperator: op1 vUnits = 0 (deleted)
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);

    // Remove last validator — deviation cleanup with guard
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // After cleanup: all live ops should have 0 (deviation subtracted)
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n,
        `op ${operatorIds[i]} should have 0 vUnits after cleanup`);
    }
    // Removed op: still 0 (guard skipped it)
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
  });

  it("RM3-016: verify ebSnapshot cleared after last-validator removal", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // ebSnapshot.vUnits should be non-zero after EB update
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(calcVUnits(34n));

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // After last-validator removal: ebSnapshot.vUnits must be 0
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-017: liquidated cluster, removeOp1, bulkRemoveValidator (last) — cleanup skipped (active=false)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // Register with small deposit to allow liquidation
    const { cluster: clusterReg, pubkeys } = await registerValidators(
      network, clusterOwner, operatorIds, 1, 1, SMALL_ETH_REGISTER_VALUE,
    );
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // Liquidate FIRST while all operators are still active (avoids _executeLiquidation underflow)
    const liquidateTx = await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterLiq = parseClusterFromReceipt(network, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(clusterLiq.active).to.be.false;

    // THEN remove operator — after liquidation, so _executeLiquidation doesn't hit the zeroed operatorEthVUnits
    await network.connect(owner).removeOperator(operatorIds[0]);

    // Remove last validator from liquidated cluster — deviation cleanup skipped (active=false at line 212)
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, clusterLiq);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(clusterAfter.active).to.be.false;
    // ebSnapshot.vUnits still zeroed at line 222
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });

  it("RM3-018: full deviation data cleanup verification", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    const daoVUnitsBefore = await readDaoTotalEthVUnits(provider, networkAddr);
    expect(daoVUnitsBefore).to.be.greaterThan(0n);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    await tx.wait();

    // Full cleanup verification
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
    for (let i = 0; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n);
    }
    // daoTotalEthVUnits includes both baseline (from updateDAO) and deviation (from updateDAOEthVUnits)
    // After removing last validator: baseline subtracted by updateDAO, deviation by cleanup → 0
    const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, networkAddr);
    expect(daoVUnitsAfter).to.equal(0n);
  });

  it("RM3-019: operator earnings for live ops after bulkRemoveValidator", async function () {
    const { network, views, provider, owner, oracles, operatorIds, clusterOwners } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const clusterAfterEB = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // Mine blocks for fee accumulation
    await mineBlocks(provider, 100);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Remove last validator — use cluster state from EB update (still valid)
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, clusterAfterEB);
    await tx.wait();

    // Live operators should have non-zero earnings from fee accrual
    for (let i = 1; i < 4; i++) {
      const earnings = await views.getOperatorEarnings(BigInt(operatorIds[i]));
      expect(BigInt(earnings)).to.be.greaterThan(0n, `live op ${operatorIds[i]} should have accrued earnings`);
    }
  });

  it("RM3-020: removed op has cross-cluster deviation — guard prevents corruption", async function () {
    const { network, provider, owner, oracles, operatorIds: allOps, clusterOwners, networkAddr } =
      await deployAndSetup(7, 2);
    const [clusterOwnerA, clusterOwnerB] = clusterOwners;

    // ClusterA: ops [0,1,2,3]  ClusterB: ops [0,4,5,6] — op0 is shared
    const opsA = [allOps[0], allOps[1], allOps[2], allOps[3]];
    const opsB = [allOps[0], allOps[4], allOps[5], allOps[6]];

    // Whitelist both cluster owners for both op sets
    await whitelistAddresses(network, owner, opsB, [clusterOwnerB.address]);

    const clusterIdA = computeClusterId(clusterOwnerA.address, opsA);
    const clusterIdB = computeClusterId(clusterOwnerB.address, opsB);

    // Register validators in both clusters
    const { cluster: clusterAReg, pubkeys: pksA } = await registerValidators(network, clusterOwnerA, opsA, 1);
    const { cluster: clusterBReg, pubkeys: pksB } = await registerValidators(network, clusterOwnerB, opsB, 1, 10);

    // EB updates for both clusters
    const clusterA = await performEBUpdate(network, oracles, provider, clusterOwnerA, opsA, clusterAReg, clusterIdA, 34);
    await mineBlocks(provider, 2);
    const clusterB = await performEBUpdate(network, oracles, provider, clusterOwnerB, opsB, clusterBReg, clusterIdB, 36);

    const deviationA = calcVUnits(34n) - defaultVUnits(1n); // 625
    const deviationB = calcVUnits(36n) - defaultVUnits(1n); // 1250

    // Op0 has combined deviation from both clusters
    const op0VUnitsBefore = await readOpEthVUnits(provider, networkAddr, allOps[0]);
    expect(op0VUnitsBefore).to.equal(deviationA + deviationB);

    // Remove op0
    await network.connect(owner).removeOperator(allOps[0]);
    expect(await readOpEthVUnits(provider, networkAddr, allOps[0])).to.equal(0n);

    // Record clusterB ops' vUnits before
    const opsBVUnitsBefore: bigint[] = [];
    for (let i = 4; i <= 6; i++) {
      opsBVUnitsBefore.push(await readOpEthVUnits(provider, networkAddr, allOps[i]));
    }

    // Remove last validator from clusterA — should NOT affect clusterB's ops
    const tx = await network.connect(clusterOwnerA).bulkRemoveValidator(pksA, opsA, clusterA);
    await tx.wait();

    // ClusterA cleanup done, op0 was skipped
    expect(await readOpEthVUnits(provider, networkAddr, allOps[0])).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterIdA)).to.equal(0n);

    // ClusterB ops should be untouched by clusterA's cleanup
    for (let i = 0; i < 3; i++) {
      const current = await readOpEthVUnits(provider, networkAddr, allOps[i + 4]);
      expect(current).to.equal(opsBVUnitsBefore[i],
        `clusterB op ${allOps[i + 4]} should not be affected by clusterA cleanup`);
    }
  });

  it("RM3-025: ValidatorRemoved events emitted with correct cluster struct", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 2);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 70);

    await network.connect(owner).removeOperator(operatorIds[0]);

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();

    // Parse all ValidatorRemoved events
    const events: any[] = [];
    for (const log of receipt.logs ?? []) {
      let parsed;
      try { parsed = network.interface.parseLog(log); } catch { continue; }
      if (parsed?.name === Events.VALIDATOR_REMOVED) events.push(parsed);
    }

    expect(events.length).to.equal(2, "should emit 2 ValidatorRemoved events");

    // Both events should reference the final cluster state
    for (const ev of events) {
      const ct = ev.args[ev.args.length - 1];
      expect(BigInt(ct[0])).to.equal(0n, "validatorCount should be 0 in final event");
    }

    // Events should have the correct public keys
    const emittedPks = events.map((e: any) => e.args[2]);
    expect(emittedPks).to.include.members(pubkeys);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Scale & Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  it("RM3-021: 13-op cluster, 6 ops removed, bulkRemoveValidator (last) — extreme scale", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(13);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    // Remove 6 operators (even-indexed: 1,3,5,7,9,11 → operatorIds[1,3,5,7,9,11])
    const removedIndices = [1, 3, 5, 7, 9, 11];
    for (const idx of removedIndices) {
      await network.connect(owner).removeOperator(operatorIds[idx]);
    }

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);

    // Removed ops: all 0
    for (const idx of removedIndices) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[idx])).to.equal(0n);
    }
    // Live ops: deviation cleaned up → 0
    const liveIndices = [0, 2, 4, 6, 8, 10, 12];
    for (const idx of liveIndices) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[idx])).to.equal(0n);
    }
  });

  it("RM3-023: ALL 4 operators removed, bulkRemoveValidator (last) — guard skips all", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 34);

    const daoVUnitsBefore = await readDaoTotalEthVUnits(provider, networkAddr);
    expect(daoVUnitsBefore).to.be.greaterThan(0n);

    // Remove ALL operators
    for (const opId of operatorIds) {
      await network.connect(owner).removeOperator(opId);
    }

    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);

    // All ops zeroed (were already 0 from removeOperator)
    for (const opId of operatorIds) {
      expect(await readOpEthVUnits(provider, networkAddr, opId)).to.equal(0n);
    }

    // DAO total: baseline removed by updateDAO, deviation removed by cleanup → 0
    const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, networkAddr);
    expect(daoVUnitsAfter).to.equal(0n);
  });

  it("RM3-024: large deviation (128 ETH for 1 validator), removeOp1, bulkRemoveValidator (last)", async function () {
    const { network, provider, owner, oracles, operatorIds, clusterOwners, networkAddr } =
      await deployAndSetup(4);
    const [clusterOwner] = clusterOwners;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const { cluster: clusterReg, pubkeys } = await registerValidators(network, clusterOwner, operatorIds, 1);

    // 128 ETH for 1 validator → vUnits = 40000, deviation = 30000
    const cluster = await performEBUpdate(network, oracles, provider, clusterOwner, operatorIds, clusterReg, clusterId, 128);
    const deviation = calcVUnits(128n) - defaultVUnits(1n);
    expect(deviation).to.equal(30000n);

    await network.connect(owner).removeOperator(operatorIds[0]);

    // Large remainingVUnits (30000) — would cause massive underflow without guard
    const tx = await network.connect(clusterOwner).bulkRemoveValidator(pubkeys, operatorIds, cluster);
    const receipt = await tx.wait();
    const clusterAfter = parseClusterFromReceipt(network, receipt, Events.VALIDATOR_REMOVED);

    expect(clusterAfter.validatorCount).to.equal(0n);
    expect(await readOpEthVUnits(provider, networkAddr, operatorIds[0])).to.equal(0n);
    for (let i = 1; i < 4; i++) {
      expect(await readOpEthVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n);
    }
    expect(await readClusterEBVUnits(provider, networkAddr, clusterId)).to.equal(0n);
  });
});
