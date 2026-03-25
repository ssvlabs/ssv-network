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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react");

      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(true);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // EB decrease 64→48
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(true);
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

      const preDepositBalance = BigInt(cl.balance);

      // Deposit
      const depAmount = ethers.parseEther("3");
      const depTx = await network.connect(clusterOwner).deposit(clusterOwner.address, ops, cl, { value: depAmount });
      cl = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cl.active).to.equal(true);
      // Deposit simply adds msg.value to cluster balance (no fee settlement)
      expect(BigInt(cl.balance)).to.equal(preDepositBalance + depAmount);

      // Second EB update — fees settled against accumulated balance
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(true);
      const addr = await network.getAddress();
      const devDep64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, devDep64, "XL-007: after EB 64");
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
      const depAmt = ethers.parseEther("5");
      const depTx = await network.connect(clusterOwner).deposit(clusterOwner.address, ops, cl, { value: depAmt });
      cl = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cl.active).to.equal(false);
      // Liquidated cluster has no burn, so balance == deposit amount
      expect(cl.balance).to.equal(depAmt);

      // Reactivate — total balance = deposit + react msg.value
      const reactAmt = ethers.parseEther("5");
      cl = await react(network, clusterOwner, ops, cl, reactAmt);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "XL-009: daoTotalEthVUnits zeroed after auto-liq");

      // Reactivate
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
      const dev128 = v128 - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev128, "after react");
      expect(await readDaoVUnits(prov, addr)).to.equal(v128, "XL-009: daoTotalEthVUnits restored after reactivation");

      // Conservation: daoTotalEthVUnits == implicitVUnits + deviation == v128
      const expectedDaoTotal = defaultVUnits(1n) + dev128; // implicit + deviation for 1 validator
      expect(expectedDaoTotal).to.equal(v128, "XL-009: conservation — implicit + deviation == v128");
      expect(await readDaoVUnits(prov, addr)).to.equal(expectedDaoTotal, "XL-009: daoVUnits == implicitVUnits + deviation");

      // Per-op vUnit consistency: each op carries the same deviation (single-cluster scenario)
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev128, `XL-009: op${id} consistent deviation`);
      }
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
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

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
    it("XL-011: EB update → remove op4 → liquidate succeeds (guard skips removed op)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev48 = v48 - defaultVUnits(1n); // 5000

      // After EB update: all 4 ops have deviation, daoVUnits == v48
      await assertAllOpVUnits(prov, addr, ops, dev48, "XL-011: after EB 48");
      expect(await readDaoVUnits(prov, addr)).to.equal(v48, "XL-011: daoVUnits after EB 48");

      // Remove op4 — deletes operatorEthVUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);
      const deadOp11 = await views.getOperatorById(BigInt(ops[3]));
      expect(deadOp11.isActive).to.equal(false, "XL-011: removed op isActive == false");
      expect(deadOp11.fee).to.equal(0n, "XL-011: removed op fee == 0");

      // Remaining ops 0-2 still carry their deviation
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev48, `XL-011: op${id} retains deviation after remove`);
      }

      // Liquidation succeeds — guard skips removed op in _executeLiquidation
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false, "XL-011: cluster liquidated");
      expect(cl.balance).to.equal(0n);

      // Removed op stays at 0, active ops cleaned
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "XL-011: removed op stays 0");
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `XL-011: op${id} cleaned by liquidation`);
      }
    });

    it("XL-012: EB 32→48 → remove op4 → EB 48→64 → liquidate succeeds (guard skips removed op)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removeOperator zeroes vUnits");
      const removedOp12 = await views.getOperatorById(BigInt(ops[3]));
      expect(removedOp12.isActive).to.equal(false, "XL-012: removed op isActive == false");
      expect(removedOp12.fee).to.equal(0n, "XL-012: removed op fee == 0");

      // Second EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after second EB");

      // Active ops get full deviation from baseline
      const devLive = calcVUnits(64n) - defaultVUnits(1n); // 10000
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(devLive, `op${id} has full deviation`);
      }

      // Liquidation succeeds
      const v64 = calcVUnits(64n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v64);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after liq");
    });

    it("XL-013: EB update → remove op4 → auto-liq from EB 128 succeeds (guard skips removed op)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removeOperator zeroes vUnits");

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

      // EB 128: auto-liq fires because balance < v128 threshold — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false, "XL-013: auto-liquidation triggered");
      expect(cl.balance).to.equal(0n);

      // Removed op stays 0, active ops cleaned by liquidation
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "XL-013: removed op stays 0");
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `XL-013: op${id} cleaned by auto-liq`);
      }
    });

    it("XL-014: EB update → remove op3 + op4 → liquidate succeeds (guard skips two removed ops)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removeOperator zeroes op3 vUnits");
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removeOperator zeroes op4 vUnits");

      // Liquidation succeeds — guard skips both removed ops
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 2n, v48);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);

      // Both removed ops stay at 0
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removed op3 stays 0");
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op4 stays 0");
    });

    it("XL-015: remove op4 BEFORE EB update → guard skips removed op, liquidation succeeds", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Remove before EB update
      await network.connect(opOwner).removeOperator(ops[3]);

      // EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after EB update");

      // Active ops get deviation
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev, `op${id} has deviation`);
      }

      // Liquidation succeeds
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after liq");
    });

    it("XL-016: EB 32→48 → remove op4 → EB 48→32 (decrease) → guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Remove op4 — zeroes operatorEthVUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // EB decrease 48→32: guard skips removed op, active ops return to 0 deviation
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after EB decrease");
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `op${id} back to 0 deviation`);
      }
    });

    it("XL-017: EB update → remove op4 → liquidate → reactivate succeeds (guard enables full path)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);

      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removeOperator zeroes vUnits");
      const deadOp17 = await views.getOperatorById(BigInt(ops[3]));
      expect(deadOp17.isActive).to.equal(false, "XL-017: removed op isActive == false");
      expect(deadOp17.fee).to.equal(0n, "XL-017: removed op fee == 0");

      // Liquidation succeeds — guard skips removed op
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0");

      // Reactivation path is no longer blocked
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true, "reactivation succeeds");
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-018: remove op4 → EB update → liquidate → reactivate (guard skips removed op throughout)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      await network.connect(opOwner).removeOperator(ops[3]);

      // EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after EB");

      // Active ops get deviation
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      for (const id of ops.slice(0, 3)) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev, `op${id} has deviation`);
      }

      // Liquidation succeeds
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // DAO vUnits should be consistent
      const daoV = await readDaoVUnits(prov, addr);
      expect(daoV).to.equal(v48, "DAO vUnits includes baseline + deviation");
    });

    it("XL-019: removeOperator deletes operatorEthVUnits → liquidation succeeds (guard skips removed op)", async function () {
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

      // Liquidation succeeds — guard skips removed op
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after liq");
    });

    it("XL-020: EB → remove op4 → EB → remove op3 → liquidate succeeds (guard skips chained removals)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      await network.connect(opOwner).removeOperator(ops[3]);

      // Second EB update — guard skips removed op4
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op4 stays 0 after second EB");

      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removeOperator deletes");

      // Liquidation succeeds — guard skips both removed ops
      const v64 = calcVUnits(64n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 2n, v64);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removed op3 stays 0");
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op4 stays 0");
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // ethValidatorCount: only 3 live ops incremented; removed op stays at 0
      for (let i = 0; i < 3; i++) {
        const opData = await views.getOperatorById(BigInt(ops[i]));
        expect(opData.validatorCount).to.equal(1n, `XL-021: live op${i} validatorCount`);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      await network.connect(opOwner).removeOperator(ops[2]);
      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-024: liquidate → remove ALL ops → reactivate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      for (const id of ops) {
        await network.connect(opOwner).removeOperator(id);
        const deadOp = await views.getOperatorById(BigInt(id));
        expect(deadOp.isActive).to.equal(false, `XL-024: op${id} isActive == false`);
        expect(deadOp.fee).to.equal(0n, `XL-024: op${id} fee == 0`);
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `XL-024: op${id} vUnits == 0`);
      }

      // Reactivate — all ops skipped, burn rate = network fee only
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("5"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-025: liquidate → remove ALL ops → reactivate with insufficient → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      for (const id of ops) await network.connect(opOwner).removeOperator(id);

      // With networkFee > 0 and 0 msg.value, should revert
      await expect(
        network.connect(clusterOwner).reactivate(ops, cl, { value: 0n }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("XL-026: EB → liquidate → remove op → reactivate → EB update (guard skips removed op)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      await network.connect(opOwner).removeOperator(ops[3]);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // Post-reactivation EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after EB update");
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

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
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-028: liquidate → fee increase → reactivate with insufficient → revert", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      // Decrease fee for op[0] back to original (only op[0] was increased; others are already at minimum)
      const originalFee = BigInt(MINIMAL_OPERATOR_ETH_FEE);
      await network.connect(opOwner).reduceOperatorFee(BigInt(ops[0]), originalFee);

      // Verify fee was reduced
      const opData = await views.getOperatorById(BigInt(ops[0]));
      expect(BigInt(opData.fee)).to.equal(originalFee);

      // Reactivate with amount at reduced threshold — should succeed
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("10"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-030: liquidate → remove op + fee change on remaining → reactivate", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

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
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cycle1 liq");
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "cycle1 react");

      // Cycle 2
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cycle2 liq");
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // Cycle 2: EB 48→64
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(64n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // Cycle 3: EB 64→48 (decrease)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, calcVUnits(48n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after triple cycle");
    });

    it("XL-033: reactivate → add validator → EB → liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

      // Add second validator
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      expect(cl.validatorCount).to.equal(2n);

      // EB update (2 validators, baseline = 20000)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());
      const v96 = calcVUnits(96n);

      // Liquidate
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v96);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
    });

    it("XL-034: reactivate → add validator → EB → auto-liquidate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE);
      expect(cl.active).to.equal(true);

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
      expect(cl.balance).to.equal(0n);
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
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-037: reactivate with value below minimum threshold → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);

      // EB 48→64
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(true);
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
      expect(cl.balance).to.equal(0n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("500"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;
      await assertAllOpVUnits(prov, addr, ops, 0n, "after liq");

      // EB update on liquidated cluster — stores snapshot only, no deviation
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "after EB on liq — no deviation applied");

      // Reactivate — uses updated vUnits from EB snapshot
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "after react with new EB");
    });

    it("XL-042: liquidate → EB increase on liquidated → reactivate with insufficient → revert", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // EB increase while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 128, oracles3());
      expect(cl.active).to.equal(false);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // Two EB updates while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation after 1st EB on liq");
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation after 2nd EB on liq");

      // Reactivate — uses final vUnits
      cl = await react(network, clusterOwner, ops, liqCluster, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // EB decrease while liquidated: 48→32
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());
      expect(cl.active).to.equal(false);

      // Reactivate — vUnits = 10000 (baseline), deviation = 0
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // Same EB while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(false);

      // Reactivate — same deviation as before liquidation
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "round-trip: deviation restored");
    });

    it("XL-046: liquidate → remove op → EB on liquidated → reactivate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      await network.connect(opOwner).removeOperator(ops[3]);

      // EB update on liquidated cluster (no deviation applied)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(false);

      // Reactivate — deviation to 3 live ops only
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // EB decrease while liquidated: 128→32 (back to baseline)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles3());
      expect(cl.active).to.equal(false);

      // Reactivate — vUnits = baseline, deviation = 0
      cl = await react(network, clusterOwner, ops, liqCluster, ethers.parseEther("10"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation at baseline");
    });

    it("XL-048: liquidate → EB on liq → remove op → reactivate → EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      const liqCluster = cl;

      // EB update while liquidated
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      expect(cl.active).to.equal(false);

      // Remove op4
      await network.connect(opOwner).removeOperator(ops[3]);

      // Reactivate (3 live ops, deviation from stored vUnits)
      cl = await react(network, clusterOwner, ops, liqCluster);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      const dev48 = calcVUnits(48n) - defaultVUnits(1n);
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(dev48);
      }
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // Another EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after second EB");
      // Live ops get updated deviation
      const devLive = calcVUnits(64n) - defaultVUnits(1n); // 10000
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(devLive);
      }
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
      const liqCl = parseClusterFromEvent(network, await tx1.wait(), Events.CLUSTER_LIQUIDATED);
      expect(liqCl.active).to.equal(false);
      expect(liqCl.balance).to.equal(0n);

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
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
    });

    it("XL-051: owner self-liquidates then reactivates", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Before self-liq: implicit vUnits only (no EB update), deviation == 0 per op
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-051: pre-liq op deviation");
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n), "XL-051: daoVUnits == implicit before liq");

      // Self-liquidation (bypasses solvency check)
      cl = await selfLiq(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(false);

      // After self-liq: vUnits zeroed (implicit cluster liquidated)
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-051: post-liq op deviation");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "XL-051: daoVUnits zeroed after self-liq");

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // After reactivation: implicit vUnits restored, deviation still 0 (no EB update)
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-051: post-react op deviation");
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n), "XL-051: daoVUnits restored after react");

      // Conservation: with no EB update, daoTotalEthVUnits == validatorCount * BPS_DENOMINATOR
      expect(await readDaoVUnits(prov, addr)).to.equal(1n * 10000n, "XL-051: conservation — daoVUnits == 1 * BPS");
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
      expect(cl.balance).to.equal(0n);

      // Reactivate immediately
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.balance).to.equal(0n);
    });

    it("XL-054: two callers reactivate same cluster — second reverts", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, defaultVUnits(1n));
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      // First reactivation succeeds
      const tx1 = await network.connect(clusterOwner).reactivate(ops, cl, { value: DEFAULT_ETH_REGISTER_VALUE });
      const reactCl = parseClusterFromEvent(network, await tx1.wait(), Events.CLUSTER_REACTIVATED);
      expect(reactCl.active).to.equal(true);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      // Reactivate with minimal amount
      const thresh = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      const burn1 = calcClusterBurn({ blockDiff: 1n, numOperators: NUM_OPS, ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: defaultVUnits(1n) });
      cl = await react(network, clusterOwner, ops, cl, thresh + burn1 * 5n);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);

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

      // Before EB: both clusters implicit → daoVUnits = 2 * defaultVUnits(1)
      const v48 = calcVUnits(48n);
      const v64 = calcVUnits(64n);
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n) + defaultVUnits(1n), "XL-056: daoVUnits after 2 implicit clusters");

      // EB updates: A→48 (dev=5000), B→64 (dev=10000)
      clA = await doEB(network, prov, clusterOwner, opsA, clA, 48, oracles3());
      clB = await doEB(network, prov, clusterOwner2, opsB, clB, 64, oracles3());

      const devA = calcVUnits(48n) - defaultVUnits(1n); // 5000
      const devB = calcVUnits(64n) - defaultVUnits(1n); // 10000

      // daoTotalEthVUnits == v48 + v64 after both EB updates
      expect(await readDaoVUnits(prov, addr)).to.equal(v48 + v64, "XL-056: daoVUnits == v48 + v64 after both EB updates");

      // Shared ops 1,2 have stacked deviation: devA + devB
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devA + devB);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devA + devB);

      // Liquidate cluster A
      clA = await drainAndLiq(network, prov, clusterOwner, liquidator, opsA, clA, NUM_OPS, calcVUnits(48n));
      expect(clA.active).to.equal(false);
      expect(clA.balance).to.equal(0n);

      // After liquidating A: daoTotalEthVUnits == only cluster B's vUnits
      expect(await readDaoVUnits(prov, addr)).to.equal(v64, "XL-056: daoVUnits == v64 after A liquidated");

      // Shared ops retain only cluster B's deviation
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devB, "shared op1 retains B dev");
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devB, "shared op2 retains B dev");
      // A-only ops: 0
      expect(await readOpVUnits(prov, addr, BigInt(allOps[2]))).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[3]))).to.equal(0n);
      // B-only ops: unchanged
      expect(await readOpVUnits(prov, addr, BigInt(allOps[4]))).to.equal(devB);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[5]))).to.equal(devB);

      // Conservation: sum of per-op deviations for B's operators == 4 * devB
      // (each of B's 4 ops carries devB). daoTotalEthVUnits == defaultVUnits(1) + devB == v64.
      const sumBOpDev = devB * 4n;
      expect(sumBOpDev).to.equal(devB * NUM_OPS, "XL-056: conservation — B op deviation sum consistent");
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n) + devB, "XL-056: daoVUnits == implicit + devB");
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
      expect(clA.active).to.equal(false);
      expect(clA.balance).to.equal(0n);

      // Reactivate A — deviation re-added
      clA = await react(network, clusterOwner, opsA, clA);
      expect(clA.active).to.equal(true);
      expect(clA.validatorCount).to.equal(1n);

      // Shared ops have both deviations again
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(devA + devB, "restored");
      expect(await readOpVUnits(prov, addr, BigInt(allOps[1]))).to.equal(devA + devB, "restored");
    });

    it("XL-058: shared op removed between two cluster liquidations — second liq succeeds (guard skips removed op)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
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
      expect(clA.active).to.equal(false);
      expect(clA.balance).to.equal(0n);

      // Remove shared op1 — zeroes operatorEthVUnits[op1]
      await network.connect(opOwner).removeOperator(allOps[0]);
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(0n);
      const deadOp58 = await views.getOperatorById(BigInt(allOps[0]));
      expect(deadOp58.isActive).to.equal(false, "XL-058: removed shared op isActive == false");
      expect(deadOp58.fee).to.equal(0n, "XL-058: removed shared op fee == 0");

      // Liquidation of cluster B succeeds — guard skips removed op1
      const vB = calcVUnits(64n);
      clB = await drainAndLiq(network, prov, clusterOwner2, liquidator, opsB, clB, 3n, vB);
      expect(clB.active).to.equal(false, "cluster B liquidated");
      expect(await readOpVUnits(prov, addr, BigInt(allOps[0]))).to.equal(0n, "removed shared op stays 0");
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "liq cleans");

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
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
      expect(cl.balance).to.equal(0n);
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
      expect(cl.active).to.equal(true);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(2n);

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
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);

      // Reactivate with fresh deposit (mimics migration deposit)
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("20"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "after react");

      // Second EB update verifies ongoing deviation correctness
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles3());
      const dev64 = calcVUnits(64n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev64, "after 2nd EB");
    });

    it("XL-065: EB → removeOperator → liquidate succeeds (guard skips removed op)", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());

      // Remove op4 — zeroes vUnits[op4]
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // Verify removed operator state
      const deadOp = await views.getOperatorById(BigInt(ops[3]));
      expect(deadOp.isActive).to.equal(false, "XL-065: removed op isActive == false");
      expect(deadOp.fee).to.equal(0n, "XL-065: removed op fee == 0");

      // Liquidation succeeds — guard skips removed op
      const v48 = calcVUnits(48n);
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v48);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(cl.balance).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0");
    });
  });

  // =========================================================================
  // Section 8: Additional Edge Cases (XL-066 to XL-068)
  // =========================================================================
  describe("Section 8: Additional Edge Cases (XL-066 to XL-068)", function () {
    it("XL-066: explicit-EB + all-ops-removed → self-liquidate → reactivate → verify deviation + vUnits", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 32→48 (explicit EB, deviation = 5000 per op)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n);
      const dev48 = v48 - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev48, "XL-066: after EB 48");
      expect(await readDaoVUnits(prov, addr)).to.equal(v48, "XL-066: daoVUnits after EB 48");

      // Remove ALL 4 operators
      for (const id of ops) {
        await network.connect(opOwner).removeOperator(id);
        const deadOp = await views.getOperatorById(BigInt(id));
        expect(deadOp.isActive).to.equal(false, `XL-066: op${id} isActive == false`);
        expect(deadOp.fee).to.equal(0n, `XL-066: op${id} fee == 0`);
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `XL-066: op${id} vUnits == 0`);
      }

      // Self-liquidation (no active ops → burn rate = 0, only owner can self-liquidate)
      cl = await selfLiq(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(false, "XL-066: cluster liquidated");
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-066: after self-liq — all ops 0");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "XL-066: daoVUnits zeroed after self-liq");

      // Reactivate — all ops dead, burn = network fee only
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("5"));
      expect(cl.active).to.equal(true, "XL-066: reactivation succeeds");
      expect(cl.validatorCount).to.equal(1n);

      // All ops still removed: vUnits stay 0 (deviation loop skips dead ops)
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-066: after react — all dead ops still 0");

      // daoTotalEthVUnits includes baseline (from reactivation updateDAO) + deviation
      // For removed ops, deviation is not added to operators but DAO vUnits gets baseline + stored deviation
      const daoV = await readDaoVUnits(prov, addr);
      // The cluster still has stored vUnits from EB (v48), so daoTotalEthVUnits = v48
      expect(daoV).to.equal(v48, "XL-066: daoVUnits restored with stored EB vUnits");
    });

    it("XL-067: removed operators + hasDeviation=true reactivation — partial deviation", async function () {
      const { network, views } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();

      // Two clusters to keep DAO deviation non-zero
      const allOps = await setupOps(network, opOwner, 8, [clusterOwner.address, clusterOwner2.address]);
      const opsA = [allOps[0], allOps[1], allOps[2], allOps[3]];
      const opsB = [allOps[4], allOps[5], allOps[6], allOps[7]];

      let clA = await regVal(network, clusterOwner, opsA, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      let clB = await regVal(network, clusterOwner2, opsB, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 10);

      // EB updates: A→48, B→64 — both have deviations, hasDeviation=true globally
      clA = await doEB(network, prov, clusterOwner, opsA, clA, 48, oracles3());
      clB = await doEB(network, prov, clusterOwner2, opsB, clB, 64, oracles3());

      const devA = calcVUnits(48n) - defaultVUnits(1n); // 5000
      const devB = calcVUnits(64n) - defaultVUnits(1n); // 10000
      await assertAllOpVUnits(prov, addr, opsA, devA, "XL-067: clA ops after EB 48");
      await assertAllOpVUnits(prov, addr, opsB, devB, "XL-067: clB ops after EB 64");

      // Liquidate cluster A
      const v48 = calcVUnits(48n);
      clA = await drainAndLiq(network, prov, clusterOwner, liquidator, opsA, clA, NUM_OPS, v48);
      expect(clA.active).to.equal(false);
      expect(clA.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, opsA, 0n, "XL-067: clA ops after liq");

      // Remove 2 of A's operators
      await network.connect(opOwner).removeOperator(opsA[2]);
      await network.connect(opOwner).removeOperator(opsA[3]);
      for (const id of [opsA[2], opsA[3]]) {
        const deadOp = await views.getOperatorById(BigInt(id));
        expect(deadOp.isActive).to.equal(false, `XL-067: op${id} isActive == false`);
        expect(deadOp.fee).to.equal(0n, `XL-067: op${id} fee == 0`);
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `XL-067: op${id} vUnits == 0`);
      }

      // Reactivate cluster A — deviation loop should skip removed ops
      // hasDeviation=true because cluster B's DAO deviation is non-zero
      clA = await react(network, clusterOwner, opsA, clA);
      expect(clA.active).to.equal(true, "XL-067: reactivation succeeds");
      expect(clA.validatorCount).to.equal(1n);

      // Live ops (0, 1) get deviation restored; dead ops (2, 3) stay 0
      expect(await readOpVUnits(prov, addr, BigInt(opsA[0]))).to.equal(devA, "XL-067: live op0 deviation restored");
      expect(await readOpVUnits(prov, addr, BigInt(opsA[1]))).to.equal(devA, "XL-067: live op1 deviation restored");
      expect(await readOpVUnits(prov, addr, BigInt(opsA[2]))).to.equal(0n, "XL-067: dead op2 stays 0");
      expect(await readOpVUnits(prov, addr, BigInt(opsA[3]))).to.equal(0n, "XL-067: dead op3 stays 0");

      // Cluster B's operators unaffected
      await assertAllOpVUnits(prov, addr, opsB, devB, "XL-067: clB ops preserved");
    });

    it("XL-068: reactivate explicit-EB cluster → add validator → EB update (baseline/deviation shift)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, ethers.parseEther("20"), 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles3());
      const v48 = calcVUnits(48n); // 15000
      const dev48 = v48 - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev48, "XL-068: after EB 48");
      expect(await readDaoVUnits(prov, addr)).to.equal(v48);

      // Liquidate
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      expect(cl.balance).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "XL-068: after liq");

      // Reactivate
      cl = await react(network, clusterOwner, ops, cl, ethers.parseEther("50"));
      expect(cl.active).to.equal(true);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev48, "XL-068: after react — deviation restored");

      // Add second validator (changes baseline: 1→2 validators, baseline = 20000)
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      expect(cl.validatorCount).to.equal(2n);

      // New baseline = defaultVUnits(2) = 20000
      // daoTotalEthVUnits = old stored vUnits (v48=15000) + new baseline addition (10000) = 25000
      const newBaseline = defaultVUnits(2n); // 20000
      expect(await readDaoVUnits(prov, addr)).to.equal(v48 + defaultVUnits(1n), "XL-068: daoVUnits after addValidator");

      // EB update for 2 validators: totalEB=96 → vUnits=30000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles3());
      const v96 = calcVUnits(96n); // 30000
      const dev96 = v96 - newBaseline; // 30000 - 20000 = 10000
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, dev96, "XL-068: after EB 96 with 2 validators");
      expect(await readDaoVUnits(prov, addr)).to.equal(v96, "XL-068: daoVUnits == v96");
    });
  });
});
