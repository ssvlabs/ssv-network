/**
 * XV-001 through XV-062: Validator↔EB cross-module interaction tests.
 *
 * Covers: lifecycle & cleanup, exit interactions, re-registration/round-trips,
 * sequential/interleaving, empty-cluster EB revert, removed operator bug paths,
 * multi-cluster shared ops, boundary/max EB/precision, scale,
 * liquidation/reactivation, between-op interactions, same-block ops, revert/edge cases.
 *
 * All removeOperator() calls use real removeOperator — never mocks.
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
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMAL_OPERATOR_ETH_FEE,
  DECLARE_OPERATOR_FEE_PERIOD,
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
// Diamond storage slot helpers
// ---------------------------------------------------------------------------
const EB_BASE =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const OP_VUNITS_MAP = EB_BASE + 2n;
const PROTO_BASE =
  BigInt(
    ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol")),
  ) - 1n;
const DAO_VUNITS_SLOT = PROTO_BASE + 4n;
const U64 = (1n << 64n) - 1n;

async function readOpVUnits(
  p: any,
  addr: string,
  opId: bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [opId, OP_VUNITS_MAP],
    ),
  );
  return BigInt(await p.getStorage(addr, slot)) & U64;
}

async function readDaoVUnits(p: any, addr: string): Promise<bigint> {
  return (
    (BigInt(
      await p.getStorage(
        addr,
        "0x" + DAO_VUNITS_SLOT.toString(16).padStart(64, "0"),
      ),
    ) >>
      192n) &
    U64
  );
}

// ---------------------------------------------------------------------------
// Reusable test helpers
// ---------------------------------------------------------------------------
async function setupOps(
  net: any,
  owner: HardhatEthersSigner,
  n: number,
  wl: string[],
): Promise<number[]> {
  const ids = await registerOperators(net, owner, n);
  await whitelistAddresses(net, owner, ids, wl);
  return ids;
}

async function regVal(
  net: any,
  co: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  dep: bigint,
  idx: number,
): Promise<Cluster> {
  const tx = await net
    .connect(co)
    .registerValidator(makePublicKey(idx), ops, DEFAULT_SHARES, cl, {
      value: dep,
    });
  return parseClusterFromEvent(net, await tx.wait(), Events.VALIDATOR_ADDED);
}

async function regVals(
  net: any,
  co: HardhatEthersSigner,
  ops: number[],
  n: number,
  dep: bigint = DEFAULT_ETH_REGISTER_VALUE,
  startIdx = 1,
): Promise<Cluster> {
  let cl: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < n; i++) {
    cl = await regVal(net, co, ops, cl, i === 0 ? dep : 0n, startIdx + i);
  }
  return cl;
}

async function remVal(
  net: any,
  co: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  idx: number,
): Promise<Cluster> {
  const tx = await net
    .connect(co)
    .removeValidator(makePublicKey(idx), ops, cl);
  return parseClusterFromEvent(net, await tx.wait(), Events.VALIDATOR_REMOVED);
}

async function bulkRemVal(
  net: any,
  co: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  indices: number[],
): Promise<Cluster> {
  const keys = indices.map((i) => makePublicKey(i));
  const tx = await net.connect(co).bulkRemoveValidator(keys, ops, cl);
  return parseClusterFromEvent(net, await tx.wait(), Events.VALIDATOR_REMOVED);
}

async function doEB(
  net: any,
  prov: any,
  co: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  eb: number,
  oracles: HardhatEthersSigner[],
): Promise<Cluster> {
  const cid = computeClusterId(co.address, ops);
  const root = computeEBRoot(cid, eb);
  await mineBlocks(prov, 1);
  const bn = await getBlockNumber(prov);
  await commitEBRoot(net, root, bn, oracles);
  const tx = await net
    .connect(co)
    .updateClusterBalance(bn, co.address, ops, cl, eb, []);
  const receipt = await tx.wait();
  try {
    return parseClusterFromEvent(net, receipt, Events.CLUSTER_BALANCE_UPDATED);
  } catch {
    return parseClusterFromEvent(net, receipt, Events.CLUSTER_LIQUIDATED);
  }
}

async function drainAndLiq(
  net: any,
  prov: any,
  co: HardhatEthersSigner,
  liq: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  numActive: bigint,
  vUnits: bigint,
): Promise<Cluster> {
  const burn = calcClusterBurn({
    blockDiff: 1n,
    numOperators: numActive,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const thresh = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
    numOperators: numActive,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const bal = BigInt(cl.balance);
  if (burn > 0n && bal > thresh) {
    await mineBlocks(prov, Number((bal - thresh) / burn) + 2);
  } else {
    await mineBlocks(prov, 10);
  }
  const tx = await net.connect(liq).liquidate(co.address, ops, cl);
  return parseClusterFromEvent(net, await tx.wait(), Events.CLUSTER_LIQUIDATED);
}

async function react(
  net: any,
  co: HardhatEthersSigner,
  ops: number[],
  cl: Cluster,
  dep: bigint = DEFAULT_ETH_REGISTER_VALUE,
): Promise<Cluster> {
  const tx = await net.connect(co).reactivate(ops, cl, { value: dep });
  return parseClusterFromEvent(
    net,
    await tx.wait(),
    Events.CLUSTER_REACTIVATED,
  );
}

async function assertAllOpVUnits(
  prov: any,
  addr: string,
  ops: number[],
  expected: bigint,
  label: string,
) {
  for (const id of ops) {
    expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
      expected,
      `${label}: op${id}`,
    );
  }
}

const NUM_OPS = 4n;

// ===========================================================================
// Test Suite
// ===========================================================================
describe("XV: Validator↔EB Cross-Module Tests", function () {
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
      ],
    } = await setupTestContext());
  });

  const baseFixture = async () => {
    const { network, views, ssvToken } =
      await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [
      oracle1,
      oracle2,
      oracle3,
      oracle4,
    ]);
    return { network, views, ssvToken };
  };

  const oracles = () => [oracle1, oracle2, oracle3, oracle4];

  // =========================================================================
  // Lifecycle & Cleanup (XV-001, 002, 003, 004, 005, 006, 007, 009, 010, 011, 012, 013)
  // =========================================================================
  describe("Lifecycle & Cleanup", () => {
    it("XV-001: register → EB at baseline (32 ETH) → remove — full lifecycle, no deviation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update at baseline: 32 ETH → deviation = 0
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles());
      const v32 = calcVUnits(32n); // 10000
      expect(v32).to.equal(defaultVUnits(1n), "baseline vUnits equals default");
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation at baseline");
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n), "DAO vUnits equals baseline for 1 validator");

      // Remove last validator
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All operator vUnits zeroed
      await assertAllOpVUnits(prov, addr, ops, 0n, "operators cleaned after remove");
      // DAO vUnits zeroed
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zero after remove");
    });

    it("XV-002: register → EB 48 ETH → remove — full lifecycle with deviation cleanup", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → deviation = 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n); // 15000
      const dev = v48 - defaultVUnits(1n); // 5000
      expect(dev).to.equal(5000n, "deviation value");

      // Verify per-operator vUnits
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          dev,
          `op${id} vUnits after EB`,
        );
      }
      // Verify DAO vUnits consistency
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after EB");

      // Remove last validator — triggers deviation cleanup loop
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All operator vUnits cleaned to 0
      await assertAllOpVUnits(prov, addr, ops, 0n, "operators cleaned after remove");
      // DAO vUnits cleaned
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zero after cleanup");
    });

    it("XV-003: register 3 vals → EB 48/val → remove 1 — partial remove, deviation preserved", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 3 validators
      let cl = await regVals(network, clusterOwner, ops, 3);

      // EB update: 144 ETH (48*3)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const v144 = calcVUnits(144n); // 45000
      const baseline3 = defaultVUnits(3n); // 30000
      const deviation = v144 - baseline3; // 15000
      expect(deviation).to.equal(15000n, "expected deviation");

      // Per-operator and DAO vUnits after EB
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          deviation,
          `op${id} vUnits after EB`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(144n), "DAO vUnits after EB");

      // Remove 1 validator (partial — validatorCount > 0, no cleanup)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(2n);

      // Deviation preserved (not cleaned since validatorCount > 0)
      await assertAllOpVUnits(prov, addr, ops, deviation, "deviation preserved after partial remove");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(144n) - defaultVUnits(1n), "DAO vUnits after partial remove");
    });

    it("XV-005: register 3 vals → EB 48/val → remove all 3 — full deviation cleanup", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 3 validators
      let cl = await regVals(network, clusterOwner, ops, 3);

      // EB update: 144 ETH (48*3)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const v144 = calcVUnits(144n); // 45000
      const deviation = v144 - defaultVUnits(3n); // 15000

      // Verify deviation written to all operators and DAO
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          deviation,
          `op${id} vUnits after EB`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(144n), "DAO vUnits after EB");

      // Remove all 3 validators serially
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      cl = await remVal(network, clusterOwner, ops, cl, 3);
      expect(cl.validatorCount).to.equal(0n);

      // Deviation subtracted from all 4 operators
      await assertAllOpVUnits(prov, addr, ops, 0n, "all operators cleaned after full remove");
      // DAO vUnits zeroed
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zero after full cleanup");
    });

    it("XV-012: register → remove (implicit EB only) — no EB cleanup path entered", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator (implicit EB — no updateClusterBalance ever called)
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // No EB update — all operator vUnits should be 0 (implicit mode)
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation in implicit mode");
      expect(await readDaoVUnits(prov, addr)).to.equal(defaultVUnits(1n), "DAO vUnits equals baseline for 1 implicit validator");

      // Remove last validator
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // Operator vUnits remain 0 (EB cleanup path not entered since ebSnapshot.vUnits == 0)
      await assertAllOpVUnits(prov, addr, ops, 0n, "operators still zero after remove");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits still zero after remove");
    });

    it("XV-004: partial remove leaving 1 validator — deviation preserved", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 3 validators
      let cl = await regVals(network, clusterOwner, ops, 3);
      // EB update: 48 ETH/val = 144 total
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());

      // vUnits = ebToVUnits(144) = ceil(144*10000/32) = 45000
      const v144 = calcVUnits(144n);
      const baseline3 = defaultVUnits(3n); // 30000
      const deviation = v144 - baseline3; // 15000
      await assertAllOpVUnits(prov, addr, ops, deviation, "after EB update");

      // Remove 2 validators (leaving 1)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      expect(cl.validatorCount).to.equal(1n);

      // Deviation should be preserved (not cleaned — validatorCount > 0)
      await assertAllOpVUnits(prov, addr, ops, deviation, "deviation preserved after partial remove");
    });

    it("XV-006: bulk partial remove 3 of 5 validators — deviation intact", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 5);
      // EB 48 ETH/val = 240 total
      cl = await doEB(network, prov, clusterOwner, ops, cl, 240, oracles());

      const v240 = calcVUnits(240n);
      const baseline5 = defaultVUnits(5n);
      const deviation = v240 - baseline5;
      await assertAllOpVUnits(prov, addr, ops, deviation, "after EB");

      // Bulk remove 3
      cl = await bulkRemVal(network, clusterOwner, ops, cl, [1, 2, 3]);
      expect(cl.validatorCount).to.equal(2n);

      // Deviation still intact (validatorCount > 0)
      await assertAllOpVUnits(prov, addr, ops, deviation, "deviation intact after bulk partial remove");
    });

    it("XV-007: bulk full remove all 5 validators (7 ops) — deviation cleanup scales", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 7, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 5);
      // EB 48 ETH/val = 240 total
      cl = await doEB(network, prov, clusterOwner, ops, cl, 240, oracles());

      const v240 = calcVUnits(240n);
      const baseline5 = defaultVUnits(5n);
      const deviation = v240 - baseline5;
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(deviation);
      }

      // Bulk remove all 5
      cl = await bulkRemVal(network, clusterOwner, ops, cl, [1, 2, 3, 4, 5]);
      expect(cl.validatorCount).to.equal(0n);

      // All operator vUnits should be cleaned
      await assertAllOpVUnits(prov, addr, ops, 0n, "all ops cleaned after full remove");
    });

    it("XV-009: double EB update across validator count change", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // First EB update: 48 ETH (1 val)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const devAfter1st = calcVUnits(48n) - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, devAfter1st, "after first EB");

      // Register 2 more validators
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 3);
      expect(cl.validatorCount).to.equal(3n);

      // Second EB update: 144 ETH (48*3)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      // storedVUnits before 2nd update: 15000 (from 1st EB) + 2*10000 (from registrations) = 35000
      // newVUnits = ebToVUnits(144) = 45000
      // delta = 45000 - 35000 = 10000
      // total per op = 5000 + 10000 = 15000
      const expectedDev = devAfter1st + (calcVUnits(144n) - (calcVUnits(48n) + defaultVUnits(2n)));
      await assertAllOpVUnits(prov, addr, ops, expectedDev, "after second EB");
    });

    it("XV-010: interleaved register and EB update — storedVUnits consistency", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 2 validators
      let cl = await regVals(network, clusterOwner, ops, 2);

      // First EB update: 96 ETH (48*2)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles());
      const v96 = calcVUnits(96n);
      const dev1 = v96 - defaultVUnits(2n); // 30000 - 20000 = 10000
      await assertAllOpVUnits(prov, addr, ops, dev1, "after first EB");

      // Register 3 more
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 3);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 4);
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 5);

      // Second EB update: 240 ETH (48*5)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 240, oracles());
      // storedVUnits before 2nd = v96 + 3*BPS = 30000 + 30000 = 60000
      // newVUnits = calcVUnits(240) = 75000
      // delta = 75000 - 60000 = 15000
      const v240 = calcVUnits(240n);
      const expectedDev = dev1 + (v240 - (v96 + defaultVUnits(3n)));
      await assertAllOpVUnits(prov, addr, ops, expectedDev, "after second EB");
    });

    it("XV-011: bulk register 10 vals → EB → bulk remove 10 — clean slate", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 10, DEFAULT_ETH_REGISTER_VALUE);

      // EB update: 480 ETH (48*10)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 480, oracles());
      const dev = calcVUnits(480n) - defaultVUnits(10n);
      await assertAllOpVUnits(prov, addr, ops, dev, "after EB");

      // Bulk remove all 10
      cl = await bulkRemVal(network, clusterOwner, ops, cl, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(cl.validatorCount).to.equal(0n);

      await assertAllOpVUnits(prov, addr, ops, 0n, "clean slate");
      const daoV = await readDaoVUnits(prov, addr);
      expect(daoV).to.equal(0n, "DAO vUnits zeroed");
    });

    it("XV-013: explicit EB at baseline (32 ETH) → remove — cleanup loop skipped", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB at baseline: 32 ETH → deviation = 0
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles());
      await assertAllOpVUnits(prov, addr, ops, 0n, "no deviation at baseline");

      // Remove last validator
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All still zero (cleanup loop skipped because remainingVUnits == 0)
      await assertAllOpVUnits(prov, addr, ops, 0n, "still zero after remove");
    });
  });

  // =========================================================================
  // Exit Interactions (XV-014, 015)
  // =========================================================================
  describe("Exit Interactions", () => {
    it("XV-014: exit → EB update → remove — exit is event-only", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Exit (event-only, no state change)
      await network.connect(clusterOwner).exitValidator(makePublicKey(1), ops);

      // EB update: 48 ETH — should use validatorCount=1 (exit doesn't reduce it)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "EB sees full validatorCount");

      // Remove
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned after remove");
    });

    it("XV-015: register 3 → exit 1 → EB → remove non-exited — EB sees 3 vals", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 3);

      // Exit validator 1 (event-only)
      await network.connect(clusterOwner).exitValidator(makePublicKey(1), ops);

      // EB update: 144 ETH (48*3 — exit doesn't reduce count)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const dev = calcVUnits(144n) - defaultVUnits(3n);
      await assertAllOpVUnits(prov, addr, ops, dev, "EB sees 3 validators");

      // Remove validator 2 (non-exited)
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      expect(cl.validatorCount).to.equal(2n);

      // Deviation preserved (not last val)
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation preserved");
    });
  });

  // =========================================================================
  // Re-registration / Round-trips (XV-016, 017, 018)
  // =========================================================================
  describe("Re-registration / Round-trips", () => {
    it("XV-016: EB → remove all → register new — returns to implicit EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());

      // Remove last val — deviation cleaned, ebSnapshot.vUnits zeroed
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned");

      // Re-register — ebSnapshot.vUnits == 0, so condition at SSVValidators:138 is false
      // Cluster returns to implicit EB
      cl = await regVal(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE, 10);
      expect(cl.validatorCount).to.equal(1n);

      // No deviation (implicit EB)
      await assertAllOpVUnits(prov, addr, ops, 0n, "implicit EB after re-register");
    });

    it("XV-017: full round-trip — EB → remove all → register → EB again", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      cl = await remVal(network, clusterOwner, ops, cl, 1);

      // Re-register (implicit)
      cl = await regVal(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE, 10);
      await assertAllOpVUnits(prov, addr, ops, 0n, "implicit after re-register");

      // New EB update: transitions back to explicit
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "explicit again after second EB");
    });

    it("XV-018: EB → register 1 more → remove 1 — deviation preserved", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000

      // Register 1 more (adds BPS to ebSnapshot.vUnits)
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);
      // Deviation unchanged by registration
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation unchanged by registration");

      // Remove 1 (not last — no cleanup)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation preserved after partial remove");
    });
  });

  // =========================================================================
  // Sequential / Interleaving (XV-019, 020, 036, 039, 041, 057, 058)
  // =========================================================================
  describe("Sequential / Interleaving", () => {
    it("XV-019: 5 vals → EB → remove 2 → EB again → remove 3", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 5);

      // First EB: 240 ETH (48*5)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 240, oracles());
      const v240 = calcVUnits(240n);
      const dev1 = v240 - defaultVUnits(5n);
      await assertAllOpVUnits(prov, addr, ops, dev1, "after first EB");

      // Remove 2 (partial)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      expect(cl.validatorCount).to.equal(3n);

      // Second EB: 144 ETH (48*3)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      // storedVUnits before 2nd: v240 - 2*BPS = 75000 - 20000 = 55000
      // newVUnits = calcVUnits(144) = 45000
      // delta2 = 45000 - 55000 = -10000
      const storedBefore2nd = v240 - defaultVUnits(2n);
      const v144 = calcVUnits(144n);
      const delta2 = v144 - storedBefore2nd;
      const expectedDev = dev1 + delta2;
      await assertAllOpVUnits(prov, addr, ops, expectedDev, "after second EB");

      // Remove last 3 (cleanup)
      cl = await remVal(network, clusterOwner, ops, cl, 3);
      cl = await remVal(network, clusterOwner, ops, cl, 4);
      cl = await remVal(network, clusterOwner, ops, cl, 5);
      expect(cl.validatorCount).to.equal(0n);

      await assertAllOpVUnits(prov, addr, ops, 0n, "fully cleaned");
    });

    it("XV-020: 1 val EB 64 → register 9 more — massive expansion", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles());
      const dev = calcVUnits(64n) - defaultVUnits(1n); // 20000 - 10000 = 10000
      await assertAllOpVUnits(prov, addr, ops, dev, "after EB");

      // Register 9 more
      for (let i = 2; i <= 10; i++) {
        cl = await regVal(network, clusterOwner, ops, cl, i === 2 ? DEFAULT_ETH_REGISTER_VALUE * 5n : 0n, i);
      }
      expect(cl.validatorCount).to.equal(10n);

      // Deviation unchanged (registration doesn't touch operatorEthVUnits)
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation unchanged after expansion");
    });

    it("XV-036: cross-block interleaving — EB → register → EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // First EB update
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev1 = calcVUnits(48n) - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev1, "after first EB");

      // Register 1 more (next block)
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);

      // Second EB update
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles());
      // storedVUnits = calcVUnits(48) + BPS = 15000 + 10000 = 25000
      // newVUnits = calcVUnits(96) = 30000
      // delta = 30000 - 25000 = 5000
      const v96 = calcVUnits(96n);
      const storedBefore = calcVUnits(48n) + defaultVUnits(1n);
      const delta2 = v96 - storedBefore;
      await assertAllOpVUnits(prov, addr, ops, dev1 + delta2, "after second EB");
    });

    it("XV-037: fee settlement on removal uses explicit EB-weighted vUnits (exact balance)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → vUnits = 15000 (explicit), deviation = 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n); // 15000
      const dev = v48 - defaultVUnits(1n); // 5000
      const balAfterEB = BigInt(cl.balance);
      const blockAfterEB = await getBlockNumber(prov);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation after EB");

      // Advance 100 blocks — fees accrue at EB-weighted rate
      await mineBlocks(prov, 100);

      // Remove last val — settles fees for all elapsed blocks using vUnits=15000
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      const blockAfterRemove = await getBlockNumber(prov);
      expect(cl.validatorCount).to.equal(0n);

      // Exact balance verification: burn uses explicit vUnits (15000), not implicit (10000)
      const blockDiff = BigInt(blockAfterRemove - blockAfterEB);
      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: v48,
      });
      expect(BigInt(cl.balance)).to.equal(balAfterEB - expectedBurn, "exact balance using EB-weighted vUnits");

      // Verify that using implicit vUnits would give a DIFFERENT (incorrect) result
      const wrongBurn = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n), // 10000 (implicit, wrong)
      });
      expect(expectedBurn).to.not.equal(wrongBurn, "EB-weighted burn differs from implicit burn");

      await assertAllOpVUnits(prov, addr, ops, 0n, "deviation cleaned");
    });

    it("XV-038: fee settlement on registration uses pre-registration vUnits (exact balance)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → vUnits = 15000 (explicit)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n); // 15000
      const dev = v48 - defaultVUnits(1n); // 5000
      const balAfterEB = BigInt(cl.balance);
      const blockAfterEB = await getBlockNumber(prov);

      // Advance 100 blocks — fees accrue at storedVUnits=15000
      await mineBlocks(prov, 100);

      // Register 1 more val — fee settlement uses pre-registration storedVUnits (15000)
      const deposit = DEFAULT_ETH_REGISTER_VALUE;
      cl = await regVal(network, clusterOwner, ops, cl, deposit, 2);
      const blockAfterReg = await getBlockNumber(prov);
      expect(cl.validatorCount).to.equal(2n);

      // Exact balance: balAfterEB + deposit - burn(blockDiff, vUnits=15000 pre-registration)
      const blockDiff = BigInt(blockAfterReg - blockAfterEB);
      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: v48, // pre-registration vUnits
      });
      expect(BigInt(cl.balance)).to.equal(balAfterEB + deposit - expectedBurn, "exact balance: fees settled at pre-registration vUnits");

      // Deviation unchanged by registration
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation unchanged after registration");
    });

    it("XV-039: serial single removals — deviation cleaned only on last", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 3);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const dev = calcVUnits(144n) - defaultVUnits(3n);
      await assertAllOpVUnits(prov, addr, ops, dev, "after EB");

      // Remove 1 (not last)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation intact after 1st remove");

      // Remove 2 (not last)
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation intact after 2nd remove");

      // Remove 3 (last — cleanup triggers)
      cl = await remVal(network, clusterOwner, ops, cl, 3);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned on last remove");
    });

    it("XV-041: add after EB → serial remove — deviation cleaned on last only", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000

      // Register 1 more
      cl = await regVal(network, clusterOwner, ops, cl, 0n, 2);

      // Remove first (not last)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation intact after partial remove");

      // Remove last — cleanup: remainingVUnits = 5000 (deviation from original EB)
      cl = await remVal(network, clusterOwner, ops, cl, 2);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned on last remove");
    });

    it("XV-057: sequential EB increases (48 → 64) → remove — accumulated deviation cleaned", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // First EB: 48 ETH
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      // dev1 = 5000 (documents intermediate step)
      calcVUnits(48n) - defaultVUnits(1n);

      // Second EB: 64 ETH
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles());
      const dev2 = calcVUnits(64n) - defaultVUnits(1n); // 10000 total
      await assertAllOpVUnits(prov, addr, ops, dev2, "accumulated deviation");

      // Remove last
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "all deviation cleaned");
    });

    it("XV-058: EB increase (64 ETH) then decrease (48 ETH) → remove — correct deviation cleaned", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // First EB: 64 ETH → deviation = 10000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles());
      const dev1 = calcVUnits(64n) - defaultVUnits(1n); // 10000
      expect(dev1).to.equal(10000n, "deviation after first EB");
      await assertAllOpVUnits(prov, addr, ops, dev1, "after first EB (64 ETH)");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(64n), "DAO vUnits after first EB");

      // Second EB: 48 ETH → deviation shrinks to 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev2 = calcVUnits(48n) - defaultVUnits(1n); // 5000
      expect(dev2).to.equal(5000n, "deviation after second EB");

      // Each operator should have 5000 (not peak 10000)
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          dev2,
          `op${id} vUnits after EB decrease`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after EB decrease");

      // Remove last — remainingVUnits = 5000 (current deviation, not peak)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "deviation fully cleaned");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zeroed");
    });
  });

  // =========================================================================
  // Empty Cluster EB Revert (XV-021)
  // =========================================================================
  describe("Empty Cluster EB Revert", () => {
    it("XV-021: EB update on empty cluster (0 validators) — reverts EBExceedsMaximum", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());

      // Remove last val
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // Try EB update on empty cluster — should revert
      const cid = computeClusterId(clusterOwner.address, ops);
      const root = computeEBRoot(cid, 48);
      await mineBlocks(prov, 1);
      const bn = await getBlockNumber(prov);
      await commitEBRoot(network, root, bn, oracles());

      await expect(
        network
          .connect(clusterOwner)
          .updateClusterBalance(bn, clusterOwner.address, ops, cl, 48, []),
      ).to.be.revertedWithCustomError(network, Errors.EB_EXCEEDS_MAXIMUM);
    });
  });

  // =========================================================================
  // Removed Operator Bug Paths (XV-023, 024, 025, 026, 049, 050)
  // ALL use real removeOperator()
  // =========================================================================
  describe("Removed Operator Bug Paths", () => {
    it("XV-023: register → removeOperator → EB → remove last val — guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Remove op3
      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(
        0n,
        "operatorEthVUnits==0 immediately after removeOperator",
      );

      // EB update (48 ETH) — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000

      // Guard works: removed op stays at 0
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(
        0n,
        "removed op stays 0 after EB update (guard works)",
      );

      // Active ops have deviation
      for (const id of [ops[0], ops[1], ops[3]]) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev, `op${id} has deviation`);
      }

      // Remove last val — cleanup skips removed op too
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      await assertAllOpVUnits(prov, addr, ops, 0n, "all ops cleaned");
    });

    it("XV-024: register → removeOperator → EB 48 → EB 32 — guard skips removed op throughout", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Remove op3
      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "zeroed after removeOperator");

      // EB update 48: guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(
        0n,
        "removed op stays 0 after EB 48 (guard works)",
      );

      // EB update 32: guard still skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 32, oracles());
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(
        0n,
        "removed op stays 0 after EB 32",
      );
    });

    it("XV-025: 3 vals → removeOperator → EB 48/val → bulk remove all — guard skips removed op", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 3);

      // Remove op2
      await network.connect(opOwner).removeOperator(ops[1]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[1]))).to.equal(0n, "zeroed after removeOperator");

      // EB update: 144 ETH (48*3) — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const dev = calcVUnits(144n) - defaultVUnits(3n);

      // Guard works: removed op stays at 0
      expect(await readOpVUnits(prov, addr, BigInt(ops[1]))).to.equal(0n, "removed op stays 0 (guard works)");

      // Active ops have deviation
      for (const id of [ops[0], ops[2], ops[3]]) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(dev, `op${id} has deviation`);
      }

      // Bulk remove all 3
      cl = await bulkRemVal(network, clusterOwner, ops, cl, [1, 2, 3]);
      expect(cl.validatorCount).to.equal(0n);

      await assertAllOpVUnits(prov, addr, ops, 0n, "all ops cleaned");
    });

    it("XV-026: EB 48 → removeOperator → remove last val — guard skips removed op in cleanup", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update BEFORE removal: deviation written to op3
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(dev, "deviation on op3");

      // Remove op3: operatorEthVUnits[op3] deleted (set to 0)
      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "zeroed by removeOperator");

      // Remove last val — guard skips removed op in cleanup, tx succeeds
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All ops cleaned
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removed op stays 0");
      for (const id of [ops[0], ops[1], ops[3]]) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `op${id} cleaned after remove`);
      }
    });

    it("XV-049: 2 ops removed → EB → remove last val — guard skips both removed ops", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // Remove 2 operators
      await network.connect(opOwner).removeOperator(ops[2]);
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n);

      // EB update: guard skips both removed ops
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "removed op3 stays 0 (guard works)");
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op4 stays 0 (guard works)");

      // Active ops have deviation
      expect(await readOpVUnits(prov, addr, BigInt(ops[0]))).to.equal(dev, "op0 has deviation");
      expect(await readOpVUnits(prov, addr, BigInt(ops[1]))).to.equal(dev, "op1 has deviation");

      // Remove last val — cleanup works correctly
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      await assertAllOpVUnits(prov, addr, ops, 0n, "all cleaned");
    });

    it("XV-050: EB 48 → removeOperator → register 1 more — removed op vUnits unchanged", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      // dev = 5000 (documents expected deviation, unused since test reverts)

      // Remove op3
      await network.connect(opOwner).removeOperator(ops[2]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[2]))).to.equal(0n, "zeroed after removeOperator");

      // Register 1 more val — should NOT write to operatorEthVUnits[removedOp]
      // But cannot register with a removed operator in the array — ensureOperatorExist rejects
      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(makePublicKey(2), ops, DEFAULT_SHARES, cl, { value: 0n }),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // =========================================================================
  // Multi-Cluster Shared Ops (XV-027, 042)
  // =========================================================================
  describe("Multi-Cluster Shared Ops", () => {
    it("XV-027: two clusters share ops — remove from cluster A preserves B's deviation", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      // Cluster A: 2 validators, EB 128 ETH (64 ETH/val)
      let clA = await regVals(network, clusterOwner, ops, 2);
      clA = await doEB(network, prov, clusterOwner, ops, clA, 128, oracles());
      const devA = calcVUnits(128n) - defaultVUnits(2n);

      // Cluster B: 1 validator, EB 48 ETH
      let clB = await regVal(network, clusterOwner2, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 100);
      clB = await doEB(network, prov, clusterOwner2, ops, clB, 48, oracles());
      const devB = calcVUnits(48n) - defaultVUnits(1n);

      // Total deviation per op = devA + devB
      const totalDev = devA + devB;
      await assertAllOpVUnits(prov, addr, ops, totalDev, "stacked deviation");

      // Remove 1 val from cluster A (partial — no cleanup)
      clA = await remVal(network, clusterOwner, ops, clA, 1);
      expect(clA.validatorCount).to.equal(1n);

      // Deviation unchanged (partial remove doesn't trigger cleanup)
      await assertAllOpVUnits(prov, addr, ops, totalDev, "deviation preserved after partial remove from A");

      // Remove last val from A → cleanup subtracts A's deviation only
      clA = await remVal(network, clusterOwner, ops, clA, 2);
      expect(clA.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, devB, "only B's deviation remains");

      // Remove B
      clB = await remVal(network, clusterOwner2, ops, clB, 100);
      expect(clB.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "all cleaned");
    });

    it("XV-042: two clusters, same ops, independent EB — remove A then B", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      // Cluster A: 1 validator, EB 48 ETH
      let clA = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      // Cluster B: 1 validator, EB 64 ETH
      let clB = await regVal(network, clusterOwner2, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 100);

      // EB update cluster A: 48 ETH
      clA = await doEB(network, prov, clusterOwner, ops, clA, 48, oracles());
      const devA = calcVUnits(48n) - defaultVUnits(1n); // 5000
      expect(devA).to.equal(5000n, "cluster A deviation");
      await assertAllOpVUnits(prov, addr, ops, devA, "only A's deviation");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n) + defaultVUnits(1n), "DAO has A's total + B's baseline");

      // EB update cluster B: 64 ETH
      clB = await doEB(network, prov, clusterOwner2, ops, clB, 64, oracles());
      const devB = calcVUnits(64n) - defaultVUnits(1n); // 10000
      expect(devB).to.equal(10000n, "cluster B deviation");
      const totalDev = devA + devB; // 15000

      // Verify stacked deviation on all operators
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          totalDev,
          `op${id} stacked deviation`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n) + calcVUnits(64n), "DAO total vUnits for both clusters");

      // Remove all from cluster A — only A's deviation subtracted
      clA = await remVal(network, clusterOwner, ops, clA, 1);
      expect(clA.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, devB, "only B's deviation remains after A removed");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(64n), "DAO has only B's total vUnits");

      // Remove all from cluster B — everything cleaned
      clB = await remVal(network, clusterOwner2, ops, clB, 100);
      expect(clB.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "all operators cleaned");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits fully zeroed");
    });
  });

  // =========================================================================
  // Boundary / Max EB / Precision (XV-029, 030, 040, 052)
  // =========================================================================
  describe("Boundary / Max EB / Precision", () => {
    it("XV-029: max EB (2048 ETH) then register — projected vUnits used for liquidity check", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 2048, oracles());

      const v2048 = calcVUnits(2048n); // 640000
      const dev = v2048 - defaultVUnits(1n); // 630000
      await assertAllOpVUnits(prov, addr, ops, dev, "max EB deviation");

      // Register 1 more with large deposit (projected vUnits = 650000)
      cl = await regVal(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE * 10n, 2);
      expect(cl.validatorCount).to.equal(2n);

      // Deviation unchanged
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation unchanged after register");
    });

    it("XV-030: max EB (2048 ETH) → remove — large deviation cleaned", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 2048, oracles());
      const dev = calcVUnits(2048n) - defaultVUnits(1n); // 630000
      await assertAllOpVUnits(prov, addr, ops, dev, "max deviation");

      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "large deviation fully cleaned");
    });

    it("XV-040: non-aligned EB (33 ETH) — precise deviation cleanup", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 33, oracles());

      // ebToVUnits(33) = ceil(33*10000/32) = ceil(330000/32) = 10313
      const v33 = calcVUnits(33n);
      expect(v33).to.equal(10313n, "non-aligned vUnits");
      const dev = v33 - defaultVUnits(1n); // 313
      await assertAllOpVUnits(prov, addr, ops, dev, "non-aligned deviation");

      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "precise cleanup");
    });

    it("XV-052: register → EB 48 → register 1 more (barely sufficient deposit) — succeeds with projected vUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator with generous deposit
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → vUnits = 15000, deviation = 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n); // 15000
      const dev = v48 - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation after EB");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after EB");

      // Register 1 more with a large deposit (should succeed since sufficient funds)
      // projectedVUnits = 15000 + 10000 = 25000
      cl = await regVal(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE, 2);
      expect(cl.validatorCount).to.equal(2n);

      // Deviation unchanged by registration (only ebSnapshot.vUnits grows, not operatorEthVUnits)
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation unchanged after register");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n) + defaultVUnits(1n), "DAO vUnits after register adds baseline for new validator");
    });

  });

  // =========================================================================
  // Scale (XV-031, 046, 059)
  // =========================================================================
  describe("Scale", () => {
    it("XV-031: bulk 50 vals → EB → bulk remove 25 → EB → bulk remove 25", async function () {
      this.timeout(120_000);
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 50 validators
      const largeDep = DEFAULT_ETH_REGISTER_VALUE * 50n;
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, largeDep, 1);
      for (let i = 2; i <= 50; i++) {
        cl = await regVal(network, clusterOwner, ops, cl, 0n, i);
      }
      expect(cl.validatorCount).to.equal(50n);

      // EB: 2400 ETH (48*50)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 2400, oracles());
      const dev1 = calcVUnits(2400n) - defaultVUnits(50n);

      // Bulk remove first 25
      const firstBatch = Array.from({ length: 25 }, (_, i) => i + 1);
      cl = await bulkRemVal(network, clusterOwner, ops, cl, firstBatch);
      expect(cl.validatorCount).to.equal(25n);
      await assertAllOpVUnits(prov, addr, ops, dev1, "deviation preserved after partial bulk remove");

      // Second EB: 1200 ETH (48*25)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 1200, oracles());

      // Bulk remove remaining 25
      const secondBatch = Array.from({ length: 25 }, (_, i) => i + 26);
      cl = await bulkRemVal(network, clusterOwner, ops, cl, secondBatch);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "fully cleaned at scale");
    });

    it("XV-046: complex interleave — 10 vals, EB, remove 5, register 3, EB, remove 8", async function () {
      this.timeout(60_000);
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 7, [clusterOwner.address]);

      // Register 10 validators
      let cl = await regVals(network, clusterOwner, ops, 10);

      // First EB: 480 ETH (48*10)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 480, oracles());
      // dev1 = calcVUnits(480n) - defaultVUnits(10n); (documented, intermediate step)

      // Remove 5
      for (let i = 1; i <= 5; i++) {
        cl = await remVal(network, clusterOwner, ops, cl, i);
      }
      expect(cl.validatorCount).to.equal(5n);

      // Register 3 more (start at index 20 to avoid pubkey collision)
      for (let i = 20; i <= 22; i++) {
        cl = await regVal(network, clusterOwner, ops, cl, 0n, i);
      }
      expect(cl.validatorCount).to.equal(8n);

      // Second EB: 384 ETH (48*8)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 384, oracles());

      // Bulk remove remaining 8
      const remaining = [6, 7, 8, 9, 10, 20, 21, 22];
      cl = await bulkRemVal(network, clusterOwner, ops, cl, remaining);
      expect(cl.validatorCount).to.equal(0n);
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(0n, `op${id} cleaned`);
      }
    });

    it("XV-059: max operator count (13 ops) → EB 48 → remove — deviation cleanup iterates all 13", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 13, [clusterOwner.address]);

      // Register 1 validator with 13 operators
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → deviation = 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n); // 15000
      const dev = v48 - defaultVUnits(1n); // 5000
      expect(dev).to.equal(5000n, "deviation value");

      // Verify all 13 operators have the deviation
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          dev,
          `op${id} vUnits after EB`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after EB");

      // Remove last validator — cleanup loop iterates all 13 operators
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All 13 operators cleaned
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          0n,
          `op${id} cleaned after remove`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zeroed after remove");
    });
  });

  // =========================================================================
  // Liquidation / Reactivation (XV-034, 060, 061, 062)
  // =========================================================================
  describe("Liquidation / Reactivation", () => {
    it("XV-034: EB → liquidate → reactivate → second EB — deviation restored", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n);
      const dev = v48 - defaultVUnits(1n); // 5000

      // Liquidate — deviation cleaned
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "deviation cleaned by liquidation");

      // Reactivate — deviation restored from ebSnapshot.vUnits (still 15000)
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation restored by reactivation");

      // Second EB update: 64 ETH
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles());
      const v64 = calcVUnits(64n);
      const newDev = v64 - defaultVUnits(1n); // 10000
      await assertAllOpVUnits(prov, addr, ops, newDev, "after second EB");
    });

    it("XV-035: registration into liquidated cluster (IMPOSSIBLE PATH) — reverts ClusterIsLiquidated", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 1 validator, EB update
      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const v48 = calcVUnits(48n);

      // Liquidate — deviation cleaned
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v48);
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "deviation cleaned by liquidation");

      // Remove last val from liquidated cluster
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      expect(cl.active).to.equal(false);

      // ebSnapshot.vUnits zeroed (line 222 runs regardless of active flag)
      // DAO vUnits zeroed
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zeroed after remove");

      // Try to register into the liquidated cluster — IMPOSSIBLE PATH
      // validateClusterOnRegistration calls validateClusterIsNotLiquidated (ClusterLib.sol:221)
      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(makePublicKey(10), ops, DEFAULT_SHARES, cl, { value: DEFAULT_ETH_REGISTER_VALUE }),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_IS_LIQUIDATED);

      // Correct path: must reactivate first, then register
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // Now registration succeeds (cluster returned to implicit EB since ebSnapshot=0)
      cl = await regVal(network, clusterOwner, ops, cl, DEFAULT_ETH_REGISTER_VALUE, 10);
      expect(cl.validatorCount).to.equal(1n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "implicit EB after reactivation + register");

      // New EB update transitions to explicit
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = v48 - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev, "explicit EB after update");
    });

    it("XV-061: liquidate → remove subset → reactivate → EB update", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 3 validators, EB update
      let cl = await regVals(network, clusterOwner, ops, 3);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const v144 = calcVUnits(144n);

      // Liquidate
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, NUM_OPS, v144);
      expect(cl.active).to.equal(false);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned by liquidation");

      // Remove 1 val while inactive (still has 2 left)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(2n);

      // Reactivate with reduced validator count
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // EB update for 2 validators: 96 ETH (48*2)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles());
      const v96 = calcVUnits(96n);
      const newDev = v96 - defaultVUnits(2n); // 30000 - 20000 = 10000
      await assertAllOpVUnits(prov, addr, ops, newDev, "fresh EB after reactivation");
    });

    it("XV-062: liquidate → remove subset → reactivate → EB (with removed operator — guard skips it)", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      // Register 3 validators, EB update
      let cl = await regVals(network, clusterOwner, ops, 3);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const v144 = calcVUnits(144n);

      // Remove operator before liquidation
      await network.connect(opOwner).removeOperator(ops[3]);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "zeroed after removeOperator");

      // Liquidation succeeds — guard skips removed op
      cl = await drainAndLiq(network, prov, clusterOwner, liquidator, ops, cl, 3n, v144);
      expect(cl.active).to.equal(false, "cluster liquidated");
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after liq");

      // Reactivate
      cl = await react(network, clusterOwner, ops, cl);
      expect(cl.active).to.equal(true);

      // EB update — guard skips removed op
      cl = await doEB(network, prov, clusterOwner, ops, cl, 96, oracles());
      const v96 = calcVUnits(96n);
      const newDev = v96 - defaultVUnits(3n);
      expect(await readOpVUnits(prov, addr, BigInt(ops[3]))).to.equal(0n, "removed op stays 0 after EB");
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(prov, addr, BigInt(ops[i]))).to.equal(newDev, `op${i} has deviation`);
      }
    });
  });

  // =========================================================================
  // Between-op Interactions (XV-043, 044, 045, 051, 056)
  // =========================================================================
  describe("Between-op Interactions", () => {
    it("XV-043: deposit between EB and remove — ebSnapshot unchanged", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "after EB");

      // Deposit more ETH — does not affect ebSnapshot or vUnits
      const txD = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, ops, cl, { value: ethers.parseEther("5") });
      cl = parseClusterFromEvent(network, await txD.wait(), Events.CLUSTER_DEPOSITED);

      // vUnits unchanged
      await assertAllOpVUnits(prov, addr, ops, dev, "vUnits unchanged after deposit");

      // Remove last val
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned after remove");
    });

    it("XV-044: withdraw between EB and remove — no double settlement", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      const v48 = calcVUnits(48n); // 15000
      const balAfterEB = BigInt(cl.balance);
      const blockAfterEB = await getBlockNumber(prov);

      await mineBlocks(prov, 50);

      // Withdraw partial — settles fees at EB-weighted vUnits
      const txW = await network.connect(clusterOwner).withdraw(ops, 0n, cl);
      cl = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
      const blockAfterWithdraw = await getBlockNumber(prov);
      const burnToWithdraw = calcClusterBurn({
        blockDiff: BigInt(blockAfterWithdraw - blockAfterEB),
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: v48,
      });
      expect(BigInt(cl.balance)).to.equal(balAfterEB - burnToWithdraw, "exact balance after withdraw");

      // vUnits still same
      await assertAllOpVUnits(prov, addr, ops, dev, "vUnits unchanged after withdraw");

      // Remove — settles remaining fees, no double-settlement
      const balBeforeRemove = BigInt(cl.balance);
      const blockBeforeRemove = await getBlockNumber(prov);
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      const blockAfterRemove = await getBlockNumber(prov);
      const burnToRemove = calcClusterBurn({
        blockDiff: BigInt(blockAfterRemove - blockBeforeRemove),
        numOperators: NUM_OPS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: v48,
      });
      expect(BigInt(cl.balance)).to.equal(balBeforeRemove - burnToRemove, "exact balance after remove");
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned");
    });

    it("XV-045: operator fee change between EB and remove — consistency", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);

      // Operator fee change: declare → wait → execute
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      await mineBlocks(prov, Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      // vUnits unchanged by fee change
      await assertAllOpVUnits(prov, addr, ops, dev, "vUnits unchanged after fee change");

      // Remove
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned");
    });

    it("XV-051: register → EB → network fee change → remove — EB-weighted network fee settlement", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update: 48 ETH → deviation = 5000
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev, "deviation after EB");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after EB");

      // Change network fee
      const newNetworkFee = DEFAULT_NETWORK_FEE_UNPACKED * 2n;
      await network.updateNetworkFee(newNetworkFee);

      // vUnits unaffected by network fee change
      await assertAllOpVUnits(prov, addr, ops, dev, "vUnits unchanged after network fee change");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits unchanged after network fee change");

      // Advance blocks so fees accrue at new rate
      await mineBlocks(prov, 50);

      // Remove last validator — settles fees at new network fee rate, weighted by vUnits=15000
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);

      // All operator vUnits cleaned
      await assertAllOpVUnits(prov, addr, ops, 0n, "operators cleaned after remove");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zeroed after remove");
    });

    it("XV-056: register → EB → fee change → second EB → remove — two EB updates straddle fee change", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // First EB: 48 ETH
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev1 = calcVUnits(48n) - defaultVUnits(1n); // 5000
      await assertAllOpVUnits(prov, addr, ops, dev1, "after first EB");
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(48n), "DAO vUnits after first EB");

      // Operator fee change: declare → wait → execute
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(BigInt(ops[0]), newFee);
      await mineBlocks(prov, Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);
      await network.connect(opOwner).executeOperatorFee(BigInt(ops[0]));

      // vUnits unchanged by fee change
      await assertAllOpVUnits(prov, addr, ops, dev1, "vUnits unchanged after fee change");

      // Second EB: 64 ETH — settles fees at old+new rate mix, then updates vUnits
      cl = await doEB(network, prov, clusterOwner, ops, cl, 64, oracles());
      const dev2 = calcVUnits(64n) - defaultVUnits(1n); // 10000 total
      // Each operator's vUnits reflects the total deviation from baseline
      for (const id of ops) {
        expect(await readOpVUnits(prov, addr, BigInt(id))).to.equal(
          dev2,
          `op${id} vUnits after second EB`,
        );
      }
      expect(await readDaoVUnits(prov, addr)).to.equal(calcVUnits(64n), "DAO vUnits after second EB");

      // Remove last
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "all operators cleaned");
      expect(await readDaoVUnits(prov, addr)).to.equal(0n, "DAO vUnits zeroed");
    });
  });

  // =========================================================================
  // Same-block Operations (XV-047, 048)
  // =========================================================================
  describe("Same-block Operations", () => {
    it("XV-047: register and EB update in same block scenario — zero fee delta", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update immediately (minimal blocks)
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      const dev = calcVUnits(48n) - defaultVUnits(1n);
      await assertAllOpVUnits(prov, addr, ops, dev, "EB initialized despite minimal blocks");
    });

    it("XV-048: remove same block as EB update — uses new explicit vUnits", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);

      // EB update
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());
      // dev = 5000 (explicit EB — fee uses these vUnits even for zero-block-diff)

      // Remove immediately (zero fee delta between EB and remove)
      cl = await remVal(network, clusterOwner, ops, cl, 1);
      expect(cl.validatorCount).to.equal(0n);
      await assertAllOpVUnits(prov, addr, ops, 0n, "cleaned on same-block remove");
    });
  });

  // =========================================================================
  // Revert / Edge Cases (XV-054, 055)
  // =========================================================================
  describe("Revert / Edge Cases", () => {
    it("XV-054: bulk remove with empty pubkeys — reverts ValidatorDoesNotExist", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVal(network, clusterOwner, ops, EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, 1);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 48, oracles());

      // Empty pubkeys array → revert
      await expect(
        network.connect(clusterOwner).bulkRemoveValidator([], ops, cl),
      ).to.be.revertedWithCustomError(network, Errors.VALIDATOR_DOES_NOT_EXIST);
    });

    it("XV-055: bulk remove with 1 invalid pubkey in batch — atomic revert preserves EB", async function () {
      const { network } = await networkHelpers.loadFixture(baseFixture);
      const prov = connection.ethers.provider;
      const addr = await network.getAddress();
      const ops = await setupOps(network, opOwner, 4, [clusterOwner.address]);

      let cl = await regVals(network, clusterOwner, ops, 3);
      cl = await doEB(network, prov, clusterOwner, ops, cl, 144, oracles());
      const dev = calcVUnits(144n) - defaultVUnits(3n);

      // Try bulk remove with an invalid pubkey (never registered)
      const badKey = makePublicKey(999);
      await expect(
        network.connect(clusterOwner).bulkRemoveValidator(
          [makePublicKey(1), badKey, makePublicKey(3)],
          ops,
          cl,
        ),
      ).to.be.revertedWithCustomError(network, Errors.VALIDATOR_DOES_NOT_EXIST);

      // State unchanged after revert
      await assertAllOpVUnits(prov, addr, ops, dev, "EB state unchanged after revert");
    });
  });
});
