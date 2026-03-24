/**
 * XL-001 through XL-065: Liquidation↔Reactivation chain tests.
 *
 * Full cycles, auto-liquidation chains, removed operator + liq/reactivation,
 * EB on liquidated cluster, fee changes, double/triple cycles, validator mgmt
 * + liquidation, boundary/precision, same-block race conditions, multi-cluster
 * + shared ops.
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
  getValidOperatorFeeIncrease,
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

// ---------------------------------------------------------------------------
// Diamond storage helpers
// ---------------------------------------------------------------------------
const EB_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const OP_VUNITS_MAP = EB_BASE + 2n;
const PROTO_BASE = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
const DAO_VUNITS_SLOT = PROTO_BASE + 4n;
const U64 = (1n << 64n) - 1n;

async function readOpVUnits(p: any, addr: string, opId: bigint): Promise<bigint> {
  const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [opId, OP_VUNITS_MAP]));
  return BigInt(await p.getStorage(addr, slot)) & U64;
}
async function readDaoVUnits(p: any, addr: string): Promise<bigint> {
  return (BigInt(await p.getStorage(addr, "0x" + DAO_VUNITS_SLOT.toString(16).padStart(64, "0"))) >> 192n) & U64;
}

// ---------------------------------------------------------------------------
// Reusable test helpers
// ---------------------------------------------------------------------------
async function setupOps(net: any, owner: HardhatEthersSigner, n: number, wl: string[]): Promise<number[]> {
  const ids = await registerOperators(net, owner, n);
  await whitelistAddresses(net, owner, ids, wl);
  return ids;
}

async function regVal(net: any, co: HardhatEthersSigner, ops: number[], cl: Cluster, dep: bigint, idx: number): Promise<Cluster> {
  const tx = await net.connect(co).registerValidator(makePublicKey(idx), ops, DEFAULT_SHARES, cl, { value: dep });
  return parseClusterFromEvent(net, await tx.wait(), Events.VALIDATOR_ADDED);
}

async function regVals(net: any, co: HardhatEthersSigner, ops: number[], n: number, dep: bigint = DEFAULT_ETH_REGISTER_VALUE): Promise<Cluster> {
  let cl: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < n; i++) {
    cl = await regVal(net, co, ops, cl, i === 0 ? dep : 0n, i + 1);
  }
  return cl;
}

async function doEB(
  net: any, prov: any, co: HardhatEthersSigner, ops: number[],
  cl: Cluster, eb: number, oracles: HardhatEthersSigner[],
): Promise<Cluster> {
  const cid = computeClusterId(co.address, ops);
  const root = computeEBRoot(cid, eb);
  await mineBlocks(prov, 1);
  const bn = await getBlockNumber(prov);
  await commitEBRoot(net, root, bn, oracles);
  const tx = await net.connect(co).updateClusterBalance(bn, co.address, ops, cl, eb, []);
  const receipt = await tx.wait();
  try {
    return parseClusterFromEvent(net, receipt, Events.CLUSTER_BALANCE_UPDATED);
  } catch {
    return parseClusterFromEvent(net, receipt, Events.CLUSTER_LIQUIDATED);
  }
}

/** EB update callable by anyone (third-party). */
async function doEBThirdParty(
  net: any, prov: any, caller: HardhatEthersSigner, co: HardhatEthersSigner,
  ops: number[], cl: Cluster, eb: number, oracles: HardhatEthersSigner[],
): Promise<{ cluster: Cluster; receipt: any }> {
  const cid = computeClusterId(co.address, ops);
  const root = computeEBRoot(cid, eb);
  await mineBlocks(prov, 1);
  const bn = await getBlockNumber(prov);
  await commitEBRoot(net, root, bn, oracles);
  const tx = await net.connect(caller).updateClusterBalance(bn, co.address, ops, cl, eb, []);
  const receipt = await tx.wait();
  let cluster: Cluster;
  try {
    cluster = parseClusterFromEvent(net, receipt, Events.CLUSTER_BALANCE_UPDATED);
  } catch {
    cluster = parseClusterFromEvent(net, receipt, Events.CLUSTER_LIQUIDATED);
  }
  return { cluster, receipt };
}

async function drainAndLiq(
  net: any, prov: any, co: HardhatEthersSigner, liq: HardhatEthersSigner,
  ops: number[], cl: Cluster, numActive: bigint, vUnits: bigint,
): Promise<Cluster> {
  const burn = calcClusterBurn({ blockDiff: 1n, numOperators: numActive, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits });
  const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: numActive, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits });
  const bal = BigInt(cl.balance);
  if (burn > 0n && bal > thresh) {
    await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
  } else {
    await mineBlocks(prov, 10);
  }
  const tx = await net.connect(liq).liquidate(co.address, ops, cl);
  return parseClusterFromEvent(net, await tx.wait(), Events.CLUSTER_LIQUIDATED);
}

async function selfLiq(net: any, co: HardhatEthersSigner, ops: number[], cl: Cluster): Promise<Cluster> {
  const tx = await net.connect(co).liquidate(co.address, ops, cl);
  return parseClusterFromEvent(net, await tx.wait(), Events.CLUSTER_LIQUIDATED);
}

async function react(net: any, co: HardhatEthersSigner, ops: number[], cl: Cluster, dep: bigint = DEFAULT_ETH_REGISTER_VALUE): Promise<Cluster> {
  const tx = await net.connect(co).reactivate(ops, cl, { value: dep });
  return parseClusterFromEvent(net, await tx.wait(), Events.CLUSTER_REACTIVATED);
}

async function assertAllOpVUnits(prov: any, addr: string, ops: number[], expected: bigint, label: string) {
  for (const id of ops) {
    expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(expected, `${label}: op${id}`);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NUM_OPS = 4n;

// ===========================================================================
// Test Suite
// ===========================================================================
describe("XL: Liquidation-Reactivation Chain Tests", function () {
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
      signers: [opOwner, clusterOwner, clusterOwner2, liquidator, oracle1, oracle2, oracle3, oracle4, staker, extra1, extra2],
    } = await setupTestContext());
  });

  const baseFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    return { network, views, ssvToken };
  };

  const oracles3 = () => [oracle1, oracle2, oracle3];

  // =========================================================================
  // Section 1: Full Cycle (XL-001 to XL-010)
  // =========================================================================
  describe("Section 1: Full Cycle (XL-001 to XL-010)", function () {
    it("XL-001: 4-op full cycle — EB 32→48, liquidate, reactivate, EB 48→64", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Step 1: EB 32→48
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n); // 15000
      const dev48 = v48 - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev48, "after EB 48");
      expect(await readDaoVUnits(prov, addr)).to.equal(v48);

      // Step 2: Drain and liquidate
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n);

      // Step 3: Reactivate
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react");
      expect(await readDaoVUnits(prov, addr)).to.equal(v48);

      // Step 4: EB 48→64
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const v64 = calcVUnits(64n); // 20000
      const dev64 = v64 - defaultVUnits(1n); // 10000
      await assertAllOpVUnits(prov, addr, ops, dev64, "after EB 64");
      expect(await readDaoVUnits(prov, addr)).to.equal(v64);
    });

    it("XL-002: 7-op full cycle — EB 32→48, liquidate, reactivate, EB 48→64", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 7, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev48 = v48 - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after EB 48");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 7n, v48);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      cl = await react(network, clusterOwner, ops, cl);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react");

      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const dev64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev64, "after EB 64");
    });

    it("XL-003: full cycle with EB decrease on second update — 32→64, liq, react, 64→48", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const v64 = calcVUnits(64n);

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v64);
      cl = await react(network, clusterOwner, ops, cl);

      // EB decrease 64→48
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after EB decrease 64→48");
    });

    it("XL-004: full cycle with implicit EB (no explicit EB update)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      const implicitV = defaultVUnits(1n);

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, implicitV);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-005: DAO invariant across full cycle — EB 32→48, liq, react, 48→64", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      // Baseline: daoVUnits = validatorCount * BPS = 10000
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n));

      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      expect(await readDaoVUnits(prov, addr)).to.equal(v48, "after EB 48");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "after liq");

      cl = await react(network, clusterOwner, ops, cl);
      expect(await readDaoVUnits(prov, addr)).to.equal(v48, "after react");

      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(64n), "after EB 64");
    });

    it("XL-006: self-liquidation mid-cycle, reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "pre self-liq");

      // Self-liquidation (owner bypasses solvency check)
      cl = await selfLiq(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after self-liq");

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react");
    });

    it("XL-007: deposit between reactivation and second EB update", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("5"));

      // Deposit
      const depAmount = ethers.parseEther("3");
      const depTx = await network.connect(clusterOwner).deposit(clusterOwner.address, ops, cl, { value: depAmount });
      cl = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // Second EB update — fees settled against accumulated balance
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(true);
      expect(cl.balance).to.be.gt(0n);
    });

    it("XL-008: deposit on liquidated cluster before reactivation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      expect(cl.balance).to.equal(0n);

      // Deposit on liquidated cluster
      const depTx = await network.connect(clusterOwner).deposit(clusterOwner.address, ops, cl, { value: ethers.parseEther("5") });
      cl = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cl.active).to.equal(false);

      // Reactivate — total balance = deposit + react msg.value
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("5"));
      expect(cl.active).to.equal(true);
    });

    it("XL-009: auto-liquidation from EB increase, then reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Position balance between old threshold (implicit) and new threshold (EB=128)
      const implicitV = defaultVUnits(1n);
      const v128 = calcVUnits(128n);
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v128 });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // EB update to 128 ETH — threshold jumps above balance → auto-liquidation
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after auto-liq");

      // Reactivate
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
      const dev128 = v128 - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev128, "after react");
    });

    it("XL-010: auto-liquidation, reactivate, second EB update", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Position balance between old (implicit) and new (EB=128) thresholds
      const implicitV = defaultVUnits(1n);
      const v128 = calcVUnits(128n);
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v128 });
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);

      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);

      // Second EB update 128→64 (decrease)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(true);
      const dev64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev64, "after 2nd EB");
    });
  });

  // =========================================================================
  // Section 2: Operator Removal Before Liquidation (XL-011 to XL-020)
  // =========================================================================
  describe("Section 2: Operator Removal Before Liquidation (XL-011 to XL-020)", function () {
    it("XL-011: EB update → remove op4 → liquidate (THE BUG PATH — Panic 0x11)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);

      // Remove op4 — deletes operatorEthVUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // Drain to liquidatable
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: _executeLiquidation subtracts deviation from dead op's zeroed vUnits → underflow
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-012: EB 32→48 → remove op4 → EB 48→64 → liquidate (Panic — compounding mismatch)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removeOperator zeroes vUnits");

      // Second EB update — NO guard in _updateOperatorVUnits, writes delta to dead op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const ebDelta = calcVUnits(64n) - calcVUnits(48n); // 5000 (only the second delta)
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(ebDelta, "dead op gets delta written back");

      // Drain to liquidatable
      const v64 = calcVUnits(64n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: dead op has 5000 but full deviation is 10000 → underflow
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-013: EB update → remove op4 → auto-liq from EB 128 — Panic 0x11", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);

      // Position balance between v48 threshold and v128 threshold
      const v48 = calcVUnits(48n);
      const v128 = calcVUnits(128n);
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v128 });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // EB 128: auto-liq fires because balance < v128 threshold,
      // but _executeLiquidation hits dead op underflow → Panic(0x11)
      const cid = computeClusterId(clusterOwner.address, ops);
      const root = computeEBRoot(cid, 128);
      await mineBlocks(prov, 1);
      const bn = await getBlockNumber(prov);
      await commitEBRoot(network, root, bn, oracles3());
      await expect(
        network.connect(clusterOwner).updateClusterBalance(bn, clusterOwner.address, ops, cl, 128, []),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-014: EB update → remove op3 + op4 → liquidate (Panic 0x11 — two dead ops)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[2]);
      await network.connect(opOwner).removeOperator(ops[3]);

      const v48 = calcVUnits(48n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 2n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 2n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: subtraction from dead ops' zeroed vUnits causes underflow
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-015: remove op4 BEFORE EB update → EB writes to dead op, liquidation subtracts cleanly", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Remove before EB update
      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      // No guard in _updateOperatorVUnits — dead op gets full delta written
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(dev, "dead op gets delta from EB update");

      // Liquidation succeeds: dead op has 5000, deviation = 5000, 5000-5000=0 → no underflow
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false);
      // All ops zeroed after liquidation
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "dead op zeroed by liq");
    });

    it("XL-016: EB 32→48 → remove op4 → EB 48→32 (decrease) → Panic in _updateOperatorVUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Remove op4 — zeroes operatorEthVUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // EB decrease 48→32: _updateOperatorVUnits subtracts delta from dead op's zeroed slot → underflow
      const cid = computeClusterId(clusterOwner.address, ops);
      const root = computeEBRoot(cid, 32);
      await mineBlocks(prov, 1);
      const bn = await getBlockNumber(prov);
      await commitEBRoot(network, root, bn, oracles3());
      await expect(
        network.connect(clusterOwner).updateClusterBalance(bn, clusterOwner.address, ops, cl, 32, []),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-017: EB update → remove op4 → liquidate → Panic 0x11 (blocks reactivation path)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);

      await network.connect(opOwner).removeOperator(ops[3]);

      // Drain to liquidatable
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: liquidation reverts, blocking the entire reactivation path
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-018: remove op4 → EB update → liquidate → reactivate (EB writes to dead op, liq cleans)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      // No guard: dead op gets delta written (remove before EB → delta = full deviation)
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(dev, "EB writes to dead op");

      // Liquidation succeeds: 5000 - 5000 = 0 (no underflow when remove is before EB)
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // DAO vUnits should be consistent
      const daoV = await readDaoVUnits(prov, addr);
      expect(daoV).to.equal(v48, "DAO vUnits includes baseline + deviation");
    });

    it("XL-019: real removeOperator deletes operatorEthVUnits — but liquidation still panics", async function () {
      // removeOperator properly deletes operatorEthVUnits[op4] = 0,
      // but _executeLiquidation still tries to subtract deviation from the zeroed slot.
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      const dev = calcVUnits(48n) - defaultVUnits(1n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(dev, "pre-remove");

      // Real removeOperator deletes operatorEthVUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "deleted by real removeOperator");

      // Drain to liquidatable
      const v48 = calcVUnits(48n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: Panic(0x11) — vUnits[deadOp] = 0, subtract deviation underflows
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-020: EB → remove op4 → EB → remove op3 → liquidate (Panic — chained removals)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      // Dead op4 gets second delta only (5000), not full deviation (10000)
      const ebDelta = calcVUnits(64n) - calcVUnits(48n); // 5000
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(ebDelta);

      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removeOperator deletes");

      // Drain to liquidatable
      const v64 = calcVUnits(64n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 2n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 2n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // Both dead ops cause underflow: op3=0, op4=5000, both < deviation=10000
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });
  });

  // =========================================================================
  // Section 3: Operator Removal After Liquidation (XL-021 to XL-030)
  // =========================================================================
  describe("Section 3: Operator Removal After Liquidation (XL-021 to XL-030)", function () {
    it("XL-021: liquidate → remove op → reactivate (implicit EB)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      const v = defaultVUnits(1n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v);

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // ethValidatorCount: only 3 live ops incremented
      for (let i = 0; i < 3; i++) {
        const opData = await views.getOperatorById(BigInt(ops[i]));
        expect(opData.validatorCount).to.be.gt(0n);
      }
      const deadOp = await views.getOperatorById(BigInt(ops[3]));
      expect(deadOp.validatorCount).to.equal(0n);
    });

    it("XL-022: EB update → liquidate → remove op → reactivate (explicit EB)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev = v48 - defaultVUnits(1n);

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      // Deviation added to 3 live ops
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(dev);
      }
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);
    });

    it("XL-023: liquidate → remove 2 ops → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      await network.connect(opOwner).removeOperator(ops[2]);
      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
    });

    it("XL-024: liquidate → remove ALL ops → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      for (const id of ops) await network.connect(opOwner).removeOperator(id);

      // Reactivate — all ops skipped, burn rate = network fee only
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("5"));
      expect(cl.active).to.equal(true);
    });

    it("XL-025: liquidate → remove ALL ops → reactivate with insufficient → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      for (const id of ops) await network.connect(opOwner).removeOperator(id);

      // With networkFee > 0 and 0 msg.value, should revert
      await expect(
        network.connect(clusterOwner).reactivate(ops, cl, { value: 0n }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("XL-026: EB → liquidate → remove op → reactivate → EB update", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);

      // Post-reactivation EB update — NO guard: dead op gets delta written
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const ebDelta = calcVUnits(64n) - calcVUnits(48n); // 5000
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(ebDelta, "dead op gets delta from EB update");
      // Live ops have full deviation from baseline
      const devLive = calcVUnits(64n) - defaultVUnits(1n); // 10000
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(devLive);
      }
    });

    it("XL-027: liquidate → fee change → reactivate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      // Increase fee for op1
      const newFee = await getValidOperatorFeeIncrease(views, BigInt(ops[0]));
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      const feePeriods = await views.getOperatorFeePeriods();
      await prov.send("evm_increaseTime", [Number(feePeriods[0]) + 1]);
      await mineBlocks(prov, 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      // Verify fee changed
      const opData = await views.getOperatorById(BigInt(ops[0]));
      expect(BigInt(opData.fee)).to.equal(BigInt(newFee));

      // Reactivate with sufficient funds for new burn rate
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
    });

    it("XL-028: liquidate → fee increase → reactivate with insufficient → revert", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      const newFee = await getValidOperatorFeeIncrease(views, BigInt(ops[0]));
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      const feePeriods = await views.getOperatorFeePeriods();
      await prov.send("evm_increaseTime", [Number(feePeriods[0]) + 1]);
      await mineBlocks(prov, 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      // Calculate old threshold with all operators at original fee
      const oldThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });

      // Reactivate with amount between old and new threshold
      // This should be insufficient for the new rate
      await expect(
        network.connect(clusterOwner).reactivate(ops, cl, { value: oldThreshold }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("XL-029: liquidate → fee decrease → reactivate succeeds at lower threshold", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // First increase fees so we can decrease them later
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      const newFee = await getValidOperatorFeeIncrease(views, BigInt(ops[0]));
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      const feePeriods = await views.getOperatorFeePeriods();
      await prov.send("evm_increaseTime", [Number(feePeriods[0]) + 1]);
      await mineBlocks(prov, 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      // Decrease fee for op[0] back to original (only op[0] was increased; others are already at minimum)
      const originalFee = BigInt(MINIMAL_OPERATOR_ETH_FEE);
      await network.connect(opOwner).reduceOperatorFee(BigInt(ops[0]), originalFee);

      // Verify fee was reduced
      const opData = await views.getOperatorById(BigInt(ops[0]));
      expect(BigInt(opData.fee)).to.equal(originalFee);

      // Reactivate with amount at reduced threshold — should succeed
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("10"));
      expect(cl.active).to.equal(true);
    });

    it("XL-030: liquidate → remove op + fee change on remaining → reactivate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      // Remove op4
      await network.connect(opOwner).removeOperator(ops[3]);

      // Change fee for op1
      const newFee = await getValidOperatorFeeIncrease(views, BigInt(ops[0]));
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      const feePeriods = await views.getOperatorFeePeriods();
      await prov.send("evm_increaseTime", [Number(feePeriods[0]) + 1]);
      await mineBlocks(prov, 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      // Reactivate — 3 ops at mixed fees, 1 dead
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
    });
  });

  // =========================================================================
  // Section 4: Multi-Cycle Stability (XL-031 to XL-040)
  // =========================================================================
  describe("Section 4: Multi-Cycle Stability (XL-031 to XL-040)", function () {
    it("XL-031: double liq/react cycle with EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev = v48 - defaultVUnits(1n);

      // Cycle 1
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cycle1 liq");
      cl = await react(network, clusterOwner, ops, cl);
      await assertAllOpVUnits(prov, addr, ops, dev, "cycle1 react");

      // Cycle 2
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cycle2 liq");
      cl = await react(network, clusterOwner, ops, cl);
      await assertAllOpVUnits(prov, addr, ops, dev, "cycle2 react — same as cycle1");
    });

    it("XL-032: triple liq/react cycle with EB changes", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Cycle 1: EB 32→48
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      cl = await react(network, clusterOwner, ops, cl);

      // Cycle 2: EB 48→64
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(64n));
      cl = await react(network, clusterOwner, ops, cl);

      // Cycle 3: EB 64→48 (decrease)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      cl = await react(network, clusterOwner, ops, cl);

      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after triple cycle");
    });

    it("XL-033: reactivate → add validator → EB → liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));

      // Add second validator
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      expect(cl.validatorCount).to.equal(2n);

      // EB update (2 validators, baseline = 20000)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());
      const v96 = calcVUnits(96n);

      // Liquidate
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v96);
      expect(cl.active).to.equal(false);
    });

    it("XL-034: reactivate → add validator → EB → auto-liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      cl = await react(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE);

      // Add second validator (2 validators now, baseline = 20000)
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);

      // Position balance between implicit threshold (2 vals) and high EB threshold
      const implicitV = defaultVUnits(2n); // 20000
      const v256 = calcVUnits(256n); // 80000
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v256 });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // EB 256 with 2 validators → huge threshold increase triggers auto-liq
      cl = await doEB(network, prov, clusterOwner, ops, cl, 256, oracles3());
      expect(cl.active).to.equal(false);
    });

    it("XL-035: reactivate with exact minimum threshold", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);

      // Calculate exact threshold for reactivation
      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: v48,
      });
      // Add 1 block of burn to cover the reactivation block
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const exactMin = thresh + burn1;

      cl = await react(network, clusterOwner, ops, cl, exactMin);
      expect(cl.active).to.equal(true);
    });

    it("XL-036: reactivate with 1 wei above minimum", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);

      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48,
      });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });

      cl = await react(network, clusterOwner, ops, cl, thresh + burn1 + 1n);
      expect(cl.active).to.equal(true);
    });

    it("XL-037: reactivate with value below minimum threshold → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);

      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48,
      });

      // Value clearly below threshold should be insufficient
      const insufficient = thresh / 2n;
      await expect(
        network.connect(clusterOwner).reactivate(ops, cl, { value: insufficient }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("XL-038: react → EB → withdraw → liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));

      // EB 48→64
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const v64 = calcVUnits(64n);

      // Withdraw most of the balance
      const bal = BigInt(cl.balance);
      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64,
      });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64 });
      if (bal > thresh + burn1 * 3n) {
        const withdrawAmt = bal - thresh - burn1 * 3n;
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // Mine 1 more block and liquidate
      await mineBlocks(prov, 2);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v64);
      expect(cl.active).to.equal(false);
    });

    it("XL-039: max EB (2048) liquidation and reactivation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, ethers.parseEther("100"), 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 2048, oracles3());
      const vMax = calcVUnits(2048n); // 640000
      expect(vMax).to.equal(640000n);
      const devMax = vMax - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, devMax, "max EB");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, vMax);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("500"));
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, devMax, "after react");
    });

    it("XL-040: minimal EB changes (32→33→34) — precision test", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB 32→33
      cl = await doEB(network, prov, clusterOwner, ops, cl, 33, oracles3());
      const v33 = calcVUnits(33n); // ceil(33*10000/32) = 10313
      expect(v33).to.equal(10313n);
      const dev33 = v33 - defaultVUnits(1n); // 313
      await assertAllOpVUnits(prov, addr, ops, dev33, "EB=33");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v33);
      cl = await react(network, clusterOwner, ops, cl);
      await assertAllOpVUnits(prov, addr, ops, dev33, "react with EB=33");

      // EB 33→34
      cl = await doEB(network, prov, clusterOwner, ops, cl, 34, oracles3());
      const v34 = calcVUnits(34n); // ceil(34*10000/32) = 10625
      expect(v34).to.equal(10625n);
      const dev34 = v34 - defaultVUnits(1n); // 625
      await assertAllOpVUnits(prov, addr, ops, dev34, "EB=34");
    });
  });

  // =========================================================================
  // Section 5: EB Update on Inactive/Liquidated (XL-041 to XL-048)
  // =========================================================================
  describe("Section 5: EB Update on Inactive/Liquidated (XL-041 to XL-048)", function () {
    it("XL-041: liquidate → EB update on liquidated cluster → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      const liqCluster = cl;
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      // EB update on liquidated cluster — stores snapshot only, no deviation
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      await assertAllOpVUnits(prov, addr, ops, 0n, "after EB on liq — no deviation applied");

      // Reactivate — uses updated vUnits from EB snapshot
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react with new EB");
    });

    it("XL-042: liquidate → EB increase on liquidated → reactivate with insufficient → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      const liqCluster = cl;

      // EB increase while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());

      // Reactivate with amount sufficient for old EB but not new
      const oldThresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      const burn1Old = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: defaultVUnits(1n) });
      const sufficientForOld = oldThresh + burn1Old * 2n;

      // This amount is sufficient for implicit EB but not for 128 ETH EB
      await expect(
        network.connect(clusterOwner).reactivate(ops, liqCluster, { value: sufficientForOld }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("XL-043: liquidate → two EB updates on liquidated → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      const liqCluster = cl;

      // Two EB updates while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation after 1st EB on liq");
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation after 2nd EB on liq");

      // Reactivate — uses final vUnits
      cl = await react(network, clusterOwner, ops, liqCluster, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      const dev64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev64, "uses final EB=64 vUnits");
    });

    it("XL-044: EB update → liquidate → EB decrease on liquidated → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      const liqCluster = cl;

      // EB decrease while liquidated: 48→32
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());

      // Reactivate — vUnits = 10000 (baseline), deviation = 0
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      // No deviation since EB == baseline
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation at baseline EB");
    });

    it("XL-045: EB update → liquidate → same EB on liquidated → reactivate (round-trip)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev = v48 - defaultVUnits(1n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      const liqCluster = cl;

      // Same EB while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Reactivate — same deviation as before liquidation
      cl = await react(network, clusterOwner, ops, liqCluster);
      await assertAllOpVUnits(prov, addr, ops, dev, "round-trip: deviation restored");
    });

    it("XL-046: liquidate → remove op → EB on liquidated → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      const liqCluster = cl;

      await network.connect(opOwner).removeOperator(ops[3]);

      // EB update on liquidated cluster (no deviation applied)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Reactivate — deviation to 3 live ops only
      cl = await react(network, clusterOwner, ops, liqCluster);
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(dev);
      }
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "dead op");
    });

    it("XL-047: auto-liquidation from EB increase → EB decrease while liq → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Position balance between implicit threshold and v128 threshold
      const implicitV = defaultVUnits(1n);
      const v128 = calcVUnits(128n);
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v128 });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // Auto-liquidation from EB increase
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);
      const liqCluster = cl;

      // EB decrease while liquidated: 128→32 (back to baseline)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());

      // Reactivate — vUnits = baseline, deviation = 0
      cl = await react(network, clusterOwner, ops, liqCluster, ethers.parseEther("10"));
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation at baseline");
    });

    it("XL-048: liquidate → EB on liq → remove op → reactivate → EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      const liqCluster = cl;

      // EB update while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Remove op4
      await network.connect(opOwner).removeOperator(ops[3]);

      // Reactivate (3 live ops, deviation from stored vUnits)
      cl = await react(network, clusterOwner, ops, liqCluster);
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(dev48);
      }
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // Another EB update — NO guard: dead op gets delta written
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const ebDelta = calcVUnits(64n) - calcVUnits(48n); // 5000
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(ebDelta, "dead op gets delta");
    });
  });

  // =========================================================================
  // Section 6: Concurrency and Race Conditions (XL-049 to XL-055)
  // =========================================================================
  describe("Section 6: Concurrency and Race Conditions (XL-049 to XL-055)", function () {
    it("XL-049: two callers liquidate same cluster — second reverts", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      const v = defaultVUnits(1n);

      // Mine to liquidatable
      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v,
      });
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v });
      await mineBlocks(prov, Number((DEFAULT_ETH_REGISTER_VALUE - thresh) / burn) + 2);

      // First liquidation succeeds
      const tx1 = await network.connect(liquidator).liquidate(clusterOwner.address, ops, cl);
      await tx1.wait();

      // Second liquidation with stale state reverts (IncorrectClusterState)
      await expect(
        network.connect(extra1).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("XL-050: liquidate then reactivate sequentially", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-051: owner self-liquidates then reactivates", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Self-liquidation (bypasses solvency check)
      cl = await selfLiq(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(false);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
    });

    it("XL-052: EB auto-liquidates, owner reactivates immediately after", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Position balance between implicit and v128 thresholds
      const implicitV = defaultVUnits(1n);
      const v128 = calcVUnits(128n);
      const oldThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const newThresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v128 });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });
      const targetBal = (oldThresh + newThresh) / 2n;
      const withdrawAmt = BigInt(cl.balance) - targetBal - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // EB update triggers auto-liquidation
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);

      // Reactivate immediately
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
    });

    it("XL-053: EB update raises threshold, then liquidation succeeds", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Mine blocks so balance is above implicit threshold but will be below 2x threshold
      const implicitV = defaultVUnits(1n);
      const thresh1 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV,
      });
      const v64 = calcVUnits(64n);
      const thresh2 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v64,
      });
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitV });

      // Target balance between thresh1 and thresh2
      const targetBalance = (thresh1 + thresh2) / 2n;
      const blocksNeeded = (DEFAULT_ETH_REGISTER_VALUE - targetBalance) / burn;
      await mineBlocks(prov, Number(blocksNeeded));

      // EB update to 64 — raises threshold but no auto-liq if balance still above
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());

      // If auto-liq didn't fire, try manual liquidation
      if (cl.active) {
        await mineBlocks(prov, 2);
        cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v64);
      }
      expect(cl.active).to.equal(false);
    });

    it("XL-054: two callers reactivate same cluster — second reverts", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      // First reactivation succeeds
      const tx1 = await network.connect(clusterOwner).reactivate(ops, cl, { value: DEFAULT_ETH_REGISTER_VALUE });
      await tx1.wait();

      // Second reactivation with stale state reverts
      await expect(
        network.connect(clusterOwner).reactivate(ops, cl, { value: DEFAULT_ETH_REGISTER_VALUE }),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("XL-055: reactivate then EB update — auto-liq may fire on reactivated cluster", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, SMALL_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));

      // Reactivate with minimal amount
      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: defaultVUnits(1n) });
      cl = await react(network, clusterOwner, ops, cl, thresh + burn1 * 5n);

      // EB update with very high EB — new threshold much higher
      cl = await doEB(network, prov, clusterOwner, ops, cl, 2048, oracles3());

      // Either auto-liquidation fired or cluster is now undercollateralized
      if (cl.active) {
        // If still active, verify it's now liquidatable
        await mineBlocks(prov, 1);
        const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, ops, cl);
        await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);
      } else {
        expect(cl.balance).to.equal(0n);
      }
    });
  });

  // =========================================================================
  // Section 7: Cross-Module Deviation Edge Cases (XL-056 to XL-065)
  // =========================================================================
  describe("Section 7: Cross-Module Deviation Edge Cases (XL-056 to XL-065)", function () {
    it("XL-056: two clusters share operators — one liquidates, shared ops retain other deviation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();

      // 6 operators: cluster A uses [1,2,3,4], cluster B uses [1,2,5,6]
      const allOps = await setupOps(network, opOwner, 6, [clusterOwner.address, clusterOwner2.address]);
      const opsA = [allOps[0], allOps[1], allOps[2], allOps[3]];
      const opsB = [allOps[0], allOps[1], allOps[4], allOps[5]];

      let clA = await regVal(network, clusterOwner, opsA, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      let clB = await regVal(network, clusterOwner2, opsB, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 10);

      // EB updates: A→48 (dev=5000), B→64 (dev=10000)
      clA = await doEB(network, prov, clusterOwner, opsA, clA, 48, oracles3());
      clB = await doEB(network, prov, clusterOwner2, opsB, clB, 64, oracles3());

      const devA = calcVUnits(48n) - defaultVUnits(1n); // 5000
      const devB = calcVUnits(64n) - defaultVUnits(1n); // 10000

      // Shared ops 1,2 have stacked deviation: devA + devB
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devA + devB);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devA + devB);

      // Liquidate cluster A
      clA = await drainAndLiq(network, prov, clusterOwner, liquidator, opsA, clA, NUM_OPS, calcVUnits(48n));

      // Shared ops retain only cluster B's deviation
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devB, "shared op1 retains B dev");
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devB, "shared op2 retains B dev");
      // A-only ops: 0
      expect(await readOpVUnits(prov, addr, BigInt(allOps[2]))).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[3]))).to.equal(0n);
      // B-only ops: unchanged
      expect(await readOpVUnits(prov, addr, BigInt(allOps[4]))).to.equal(devB);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[5]))).to.equal(devB);
    });

    it("XL-057: shared operators — one cluster liquidates then reactivates, deviation restored", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();

      const allOps = await setupOps(network, opOwner, 6, [clusterOwner.address, clusterOwner2.address]);
      const opsA = [allOps[0], allOps[1], allOps[2], allOps[3]];
      const opsB = [allOps[0], allOps[1], allOps[4], allOps[5]];

      let clA = await regVal(network, clusterOwner, opsA, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      let clB = await regVal(network, clusterOwner2, opsB, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 10);

      clA = await doEB(network, prov, clusterOwner, opsA, clA, 48, oracles3());
      clB = await doEB(network, prov, clusterOwner2, opsB, clB, 64, oracles3());

      const devA = calcVUnits(48n) - defaultVUnits(1n);
      const devB = calcVUnits(64n) - defaultVUnits(1n);

      // Liquidate A
      clA = await drainAndLiq(network, prov, clusterOwner, liquidator, opsA, clA, NUM_OPS, calcVUnits(48n));

      // Reactivate A — deviation re-added
      clA = await react(network, clusterOwner, opsA, clA);

      // Shared ops have both deviations again
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devA + devB, "restored");
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devA + devB, "restored");
    });

    it("XL-058: shared op removed between two cluster liquidations — Panic 0x11 on second liq", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();

      const allOps = await setupOps(network, opOwner, 6, [clusterOwner.address, clusterOwner2.address]);
      const opsA = [allOps[0], allOps[1], allOps[2], allOps[3]];
      const opsB = [allOps[0], allOps[1], allOps[4], allOps[5]];

      let clA = await regVal(network, clusterOwner, opsA, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      let clB = await regVal(network, clusterOwner2, opsB, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 10);

      clA = await doEB(network, prov, clusterOwner, opsA, clA, 48, oracles3());
      clB = await doEB(network, prov, clusterOwner2, opsB, clB, 64, oracles3());

      // Liquidate cluster A (cleans A's deviation from shared ops)
      clA = await drainAndLiq(network, prov, clusterOwner, liquidator, opsA, clA, NUM_OPS, calcVUnits(48n));

      // Remove shared op1 — zeroes operatorEthVUnits[op1]
      await network.connect(opOwner).removeOperator(allOps[0]);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(0n);

      // Drain cluster B to liquidatable
      const vB = calcVUnits(64n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vB });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vB });
      const bal = BigInt(clB.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // THE BUG: liquidation of cluster B tries to subtract B's deviation from dead op1's zeroed vUnits
      await expect(
        network.connect(liquidator).liquidate(clusterOwner2.address, opsB, clB),
      ).to.be.revertedWithPanic(0x11);
    });

    it("XL-059: addValidator → EB increase → liquidate → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, ethers.parseEther("20"), 1);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      expect(cl.validatorCount).to.equal(2n);

      // EB update for 2 validators: baseline = 20000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());
      const v96 = calcVUnits(96n); // ceil(96*10000/32) = 30000
      const dev = v96 - defaultVUnits(2n); // 30000 - 20000 = 10000
      await assertAllOpVUnits(prov, addr, ops, dev, "EB=96, 2 vals");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v96);
      await assertAllOpVUnits(prov, addr, ops, 0n, "liq cleans");

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.validatorCount).to.equal(2n);
      await assertAllOpVUnits(prov, addr, ops, dev, "react restores");
    });

    it("XL-060: removeValidator → EB decrease → liquidate → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, ethers.parseEther("20"), 1);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());

      // Remove one validator
      const rmTx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), ops, cl);
      cl = parseClusterFromEvent(network, await rmTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cl.validatorCount).to.equal(1n);

      // EB update for 1 validator: 48 ETH
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.validatorCount).to.equal(1n);
      expect(cl.active).to.equal(true);
    });

    it("XL-061: withdraw near threshold → EB increase triggers auto-liq", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const thresh48 = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48,
      });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });

      // Withdraw to just above threshold
      const withdrawAmt = BigInt(cl.balance) - thresh48 - burn1 * 5n;
      if (withdrawAmt > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(ops, withdrawAmt, cl);
        cl = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      }

      // EB increase to 128 — threshold increases dramatically, triggers auto-liq
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);
    });

    it("XL-062: EB decrease + deposit → not liquidatable", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Deposit more
      const depTx = await network.connect(clusterOwner).deposit(clusterOwner.address, ops, cl, { value: ethers.parseEther("5") });
      cl = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // EB decrease lowers threshold
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());

      // Not liquidatable (balance well above threshold)
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("XL-063: react → removeValidator → verify solvency", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, ethers.parseEther("20"), 1);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(96n));
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));

      // Remove one validator — reduces validatorCount
      const rmTx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), ops, cl);
      cl = parseClusterFromEvent(network, await rmTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cl.validatorCount).to.equal(1n);

      // Cluster should still be solvent (stored vUnits from EB, reduced baseline)
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("XL-064: migration to ETH → EB → liquidate → reactivate chain", async function () {
      // Tests that a migrated cluster correctly handles the liq/react chain
      // with EB deviation accounting
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Simulate migration-like flow: cluster exists, add EB, full liq/react chain
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev = v48 - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "after EB");

      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);

      // Reactivate with fresh deposit (mimics migration deposit)
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, dev, "after react");

      // Second EB update verifies ongoing deviation correctness
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const dev64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev64, "after 2nd EB");
    });

    it("XL-065: EB → removeOperator → liquidate reverts with Panic 0x11", async function () {
      // THE BUG: After EB update creates deviation and operator is removed,
      // liquidation cannot proceed — the reactivation path is completely blocked.
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Remove op4 — zeroes vUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // Drain to liquidatable
      const v48 = calcVUnits(48n);
      const burn = calcClusterBurn({ blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const thresh = calcLiquidationThreshold({ minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: v48 });
      const bal = BigInt(cl.balance);
      if (burn > 0n && bal > thresh) {
        await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
      }

      // Liquidation panics — blocks liq/react chain entirely
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, ops, cl),
      ).to.be.revertedWithPanic(0x11);
    });
  });
});
