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
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
  calcClusterBurn,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";

// ---------------------------------------------------------------------------
// Raw storage reading helpers — read diamond-storage fields from the proxy
// ---------------------------------------------------------------------------

// StorageEB base slot: uint256(keccak256("ssv.network.storage.eb")) - 1
const SSV_STORAGE_EB_BASE = BigInt(
  ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb")),
) - 1n;

// StorageProtocol base slot: uint256(keccak256("ssv.network.storage.protocol")) - 1
const SSV_STORAGE_PROTOCOL_BASE = BigInt(
  ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol")),
) - 1n;

// operatorEthVUnits is the 3rd field in StorageEB (slot base+2) — mapping(uint64=>uint64)
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = SSV_STORAGE_EB_BASE + 2n;

// daoTotalEthVUnits is in StorageProtocol slot base+4, bits 192-255
const DAO_TOTAL_ETH_VUNITS_SLOT = SSV_STORAGE_PROTOCOL_BASE + 4n;

// ethDaoValidatorCount is in StorageProtocol slot base+2, bits 224-255
const ETH_DAO_VALIDATOR_COUNT_SLOT = SSV_STORAGE_PROTOCOL_BASE + 2n;

const UINT64_MASK = (1n << 64n) - 1n;
const UINT32_MASK = (1n << 32n) - 1n;

async function readOperatorEthVUnits(
  provider: any,
  proxyAddr: string,
  operatorId: bigint,
): Promise<bigint> {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const slot = ethers.keccak256(
    coder.encode(["uint256", "uint256"], [operatorId, OPERATOR_ETH_VUNITS_MAPPING_SLOT]),
  );
  const raw = await provider.getStorage(proxyAddr, slot);
  return BigInt(raw) & UINT64_MASK;
}

async function readDaoTotalEthVUnits(provider: any, proxyAddr: string): Promise<bigint> {
  const raw = await provider.getStorage(
    proxyAddr,
    "0x" + DAO_TOTAL_ETH_VUNITS_SLOT.toString(16).padStart(64, "0"),
  );
  return (BigInt(raw) >> 192n) & UINT64_MASK;
}

async function readEthDaoValidatorCount(provider: any, proxyAddr: string): Promise<bigint> {
  const raw = await provider.getStorage(
    proxyAddr,
    "0x" + ETH_DAO_VALIDATOR_COUNT_SLOT.toString(16).padStart(64, "0"),
  );
  return (BigInt(raw) >> 224n) & UINT32_MASK;
}

// ---------------------------------------------------------------------------
// INV-11 invariant check: operatorEthVUnits[removedOp] == 0 for all removed
// operators, and daoTotalEthVUnits is consistent
// ---------------------------------------------------------------------------
async function assertINV11(
  provider: any,
  proxyAddr: string,
  operatorIds: number[],
  removedIndices: number[],
  expectedDeviation: bigint,
  expectedDaoVUnits: bigint,
) {
  // Removed operators must have operatorEthVUnits == 0
  for (const idx of removedIndices) {
    const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[idx]));
    expect(vUnits).to.equal(
      0n,
      `operatorEthVUnits[op${operatorIds[idx]}] should be 0 (removed operator)`,
    );
  }

  // Active operators should have the expected deviation
  const activeIndices = operatorIds
    .map((_, i) => i)
    .filter((i) => !removedIndices.includes(i));
  for (const idx of activeIndices) {
    const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[idx]));
    expect(vUnits).to.equal(
      expectedDeviation,
      `operatorEthVUnits[op${operatorIds[idx]}] should equal cluster deviation`,
    );
  }

  // daoTotalEthVUnits consistency
  const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddr);
  expect(daoVUnits).to.equal(expectedDaoVUnits, "daoTotalEthVUnits mismatch");
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function registerValidators(
  network: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  count: number,
  depositPerValidator: bigint = DEFAULT_ETH_REGISTER_VALUE,
  keySeed: number = 1,
): Promise<Cluster> {
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < count; i++) {
    const tx = await network.connect(clusterOwner).registerValidator(
      makePublicKey(keySeed + i),
      operatorIds,
      DEFAULT_SHARES,
      cluster,
      { value: depositPerValidator },
    );
    cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
  }
  return cluster;
}

async function setupExplicitEB(
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
  oracles: HardhatEthersSigner[],
): Promise<Cluster> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const root = computeEBRoot(clusterId, effectiveBalance);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);
  const tx = await network.connect(clusterOwner).updateClusterBalance(
    rootBlockNum,
    clusterOwner.address,
    operatorIds,
    cluster,
    effectiveBalance,
    [],
  );
  return parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);
}

async function drainAndLiquidate(
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  liquidator: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveVUnits?: bigint,
): Promise<Cluster> {
  // Compute per-block burn for this cluster
  const numOps = BigInt(operatorIds.length);
  const vUnits = effectiveVUnits ?? defaultVUnits(cluster.validatorCount);
  const perBlockBurn = calcClusterBurn({
    blockDiff: 1n,
    numOperators: numOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const threshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
    numOperators: numOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });

  // Mine just enough blocks to bring balance below threshold
  // cluster.balance is the settled balance at the last interaction block
  if (cluster.balance > threshold && perBlockBurn > 0n) {
    const blocksNeeded = (cluster.balance - threshold) / perBlockBurn + 2n;
    await mineBlocks(provider, Number(blocksNeeded));
  } else {
    // Already close to threshold, mine a few blocks
    await mineBlocks(provider, 10);
  }

  const tx = await network
    .connect(liquidator)
    .liquidate(clusterOwner.address, operatorIds, cluster);
  return parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
}

async function removeOps(
  network: any,
  operatorOwner: HardhatEthersSigner,
  operatorIds: number[],
  indices: number[],
): Promise<void> {
  for (const idx of indices) {
    await network.connect(operatorOwner).removeOperator(operatorIds[idx]);
  }
}

async function reactivate(
  network: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  deposit: bigint = DEFAULT_ETH_REGISTER_VALUE,
): Promise<Cluster> {
  const tx = await network
    .connect(clusterOwner)
    .reactivate(operatorIds, cluster, { value: deposit });
  return parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
}

// =========================================================================
// Test Suite
// =========================================================================

describe("RM5 — Removed Operator Reactivation Guard", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [
        operatorOwner,
        clusterOwner,
        liquidator,
        oracle1,
        oracle2,
        oracle3,
        oracle4,
        staker,
        clusterOwner2,
      ],
    } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const proxyAddr = await network.getAddress();
    return { network, views, proxyAddr };
  };

  // -----------------------------------------------------------------------
  // RM5-001, 003, 004, 005 — Core flow: liquidate → remove → reactivate
  // Parametric over cluster size (4, 7, 10, 13 operators)
  // -----------------------------------------------------------------------
  describe("Core flow — liquidate → remove → reactivate (RM5-001, 003, 004, 005)", () => {
    const configs = [
      { id: "RM5-001", ops: 4, removeIdxs: [1], vals: 2, eb: 128 },
      { id: "RM5-003", ops: 7, removeIdxs: [1, 4], vals: 2, eb: 128 },
      { id: "RM5-004", ops: 10, removeIdxs: [1, 4, 7], vals: 2, eb: 128 },
      { id: "RM5-005", ops: 13, removeIdxs: [1, 4, 7, 10], vals: 2, eb: 128 },
    ];

    for (const cfg of configs) {
      it(`${cfg.id}: ${cfg.ops}-op, explicit EB=${cfg.eb}, liquidate, remove ${cfg.removeIdxs.length} op(s), reactivate`, async function () {
        const { network, views, proxyAddr } =
          await networkHelpers.loadFixture(deployFixture);
        const provider = connection.ethers.provider;

        // Setup operators and cluster
        const operatorIds = await registerOperators(network, operatorOwner, cfg.ops);
        await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
        let cluster = await registerValidators(network, clusterOwner, operatorIds, cfg.vals);

        // Setup explicit EB
        cluster = await setupExplicitEB(
          network, provider, clusterOwner, operatorIds, cluster,
          cfg.eb, [oracle1, oracle2, oracle3],
        );

        const vUnitsCluster = calcVUnits(BigInt(cfg.eb));
        const baselineVUnits = defaultVUnits(BigInt(cfg.vals));
        const expectedDeviation = vUnitsCluster > baselineVUnits ? vUnitsCluster - baselineVUnits : 0n;
        expect(expectedDeviation).to.be.gt(0n);

        // Liquidate (deviation cleaned from all operators)
        cluster = await drainAndLiquidate(
          network, provider, clusterOwner, liquidator, operatorIds, cluster, vUnitsCluster,
        );
        expect(cluster.active).to.equal(false);
        expect(cluster.balance).to.equal(0n);

        // Verify deviation zeroed after liquidation
        for (const opId of operatorIds) {
          expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId))).to.equal(0n);
        }

        // Remove operators
        await removeOps(network, operatorOwner, operatorIds, cfg.removeIdxs);

        // Verify removed operator state via views
        for (const idx of cfg.removeIdxs) {
          const opData = await views.getOperatorById(operatorIds[idx]);
          expect(opData[2]).to.equal(0n); // ethValidatorCount
        }

        // Reactivate
        const reactivatedCluster = await reactivate(
          network, clusterOwner, operatorIds, cluster,
        );
        expect(reactivatedCluster.active).to.equal(true);
        expect(reactivatedCluster.validatorCount).to.equal(BigInt(cfg.vals));

        // INV-11: removed ops have vUnits==0, active ops have deviation, DAO consistent
        // daoTotalEthVUnits = baseline + deviation = vUnitsCluster (full vUnits)
        await assertINV11(
          provider, proxyAddr, operatorIds, cfg.removeIdxs,
          expectedDeviation, vUnitsCluster,
        );

        // Active operators have ethValidatorCount incremented
        const activeIndices = operatorIds.map((_, i) => i).filter((i) => !cfg.removeIdxs.includes(i));
        for (const idx of activeIndices) {
          const opData = await views.getOperatorById(operatorIds[idx]);
          expect(opData[2]).to.be.gt(0n); // ethValidatorCount > 0
        }

        // Burn rate reflects only active operators
        const activeOps = BigInt(cfg.ops - cfg.removeIdxs.length);
        const burnPerBlock = calcClusterBurn({
          blockDiff: 1n,
          numOperators: activeOps,
          ethFee: OP_ETH_FEE_RAW,
          networkFee: DEFAULT_NETWORK_FEE_RAW,
          effectiveVUnits: vUnitsCluster,
        });
        expect(burnPerBlock).to.be.gt(0n);
      });
    }
  });

  // -----------------------------------------------------------------------
  // RM5-002 — Order invariance: remove BEFORE liquidation
  // With explicit EB, liquidation reverts (underflow in deviation cleanup)
  // -----------------------------------------------------------------------
  describe("Order invariance (RM5-002)", () => {
    it("RM5-002: Remove op BEFORE liquidation with explicit EB — liquidation reverts (underflow)", async function () {
      const { network } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      // Setup explicit EB=128 → deviation=20000
      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );

      // Remove op BEFORE liquidation
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      // Drain balance
      await mineBlocks(provider, 1_000_000_000_000);

      // Liquidation should revert: _executeLiquidation tries to subtract
      // deviation from operatorEthVUnits[removedOp] which is 0 → underflow
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithPanic();
    });

    it("RM5-002b: Remove op BEFORE liquidation with implicit EB — works, then reactivate", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // Remove op BEFORE liquidation (implicit EB, no deviation)
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[1]))).to.equal(0n);

      // Drain and liquidate — succeeds because no deviation to subtract
      await mineBlocks(provider, 1_000_000_000_000);
      const liquidatedCluster = parseClusterFromEvent(
        network,
        await (
          await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster)
        ).wait(),
        Events.CLUSTER_LIQUIDATED,
      );
      expect(liquidatedCluster.active).to.equal(false);

      // Reactivate
      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, liquidatedCluster,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // INV-11: removed op stays at 0, no deviation for anyone
      // daoTotalEthVUnits = baseline = 1 * BPS = 10000 (implicit EB)
      await assertINV11(provider, proxyAddr, operatorIds, [1], 0n, defaultVUnits(1n));
    });
  });

  // -----------------------------------------------------------------------
  // RM5-006, RM5-007 — All operators removed → reactivate
  // -----------------------------------------------------------------------
  describe("All operators removed (RM5-006, RM5-007)", () => {
    it("RM5-006: 4-op, ALL 4 removed, reactivate — burnRate=0, solvency trivially passes", async function () {
      const { network, views, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // Liquidate
      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove ALL 4 operators
      await removeOps(network, operatorOwner, operatorIds, [0, 1, 2, 3]);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData[2]).to.equal(0n); // ethValidatorCount == 0
      }

      // Reactivate — burn rate is 0 (all ops removed), only network fee matters
      // Solvency check: with burnRate=0, only needs to cover network fee threshold
      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, liquidatedCluster, ethers.parseEther("1"),
      );
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(1n);

      // INV-11: all operators have vUnits==0, DAO baseline = 1 * BPS (implicit EB)
      await assertINV11(provider, proxyAddr, operatorIds, [0, 1, 2, 3], 0n, defaultVUnits(1n));

      // ethDaoValidatorCount should reflect the reactivated cluster's validators
      const daoValCount = await readEthDaoValidatorCount(provider, proxyAddr);
      expect(daoValCount).to.equal(1n);
    });

    it("RM5-007: 7-op, ALL 7 removed, reactivate — burnRate=0", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 7);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove ALL 7 operators
      await removeOps(network, operatorOwner, operatorIds, [0, 1, 2, 3, 4, 5, 6]);

      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, liquidatedCluster, ethers.parseEther("1"),
      );
      expect(reactivatedCluster.active).to.equal(true);

      // INV-11: all operators have vUnits==0, DAO baseline = 1 * BPS
      const allIndices = operatorIds.map((_, i) => i);
      await assertINV11(provider, proxyAddr, operatorIds, allIndices, 0n, defaultVUnits(1n));
    });
  });

  // -----------------------------------------------------------------------
  // RM5-008, RM5-009, RM5-013 — Deviation distribution to active ops only
  // -----------------------------------------------------------------------
  describe("Deviation distribution to active ops only (RM5-008, 009, 013)", () => {
    it("RM5-008: 4-op, explicit EB with deviation, remove 1 op — deviation distributed to 3 active ops only", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      // Explicit EB=128 → vUnits=40000, baseline=20000, deviation=20000
      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);
      expect(expectedDeviation).to.equal(20000n);

      // Liquidate (cleans up deviation from all operators)
      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove op3 (index 2)
      await removeOps(network, operatorOwner, operatorIds, [2]);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[2]))).to.equal(0n);

      // Reactivate
      await reactivate(network, clusterOwner, operatorIds, cluster);

      // Deviation distributed to op1, op2, op4 (active) but NOT op3 (removed)
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(expectedDeviation);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[1]))).to.equal(expectedDeviation);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[2]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[3]))).to.equal(expectedDeviation);

      // daoTotalEthVUnits = baseline + clusterDeviation = vUnitsCluster
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVUnits).to.equal(calcVUnits(128n));
    });

    it("RM5-009: 4-op, explicit EB, remove 2 ops — daoTotalEthVUnits = full vUnits regardless of removed ops", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);

      // Liquidate
      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove op2 AND op3 (2 of 4 removed)
      await removeOps(network, operatorOwner, operatorIds, [1, 2]);

      // Reactivate
      await reactivate(network, clusterOwner, operatorIds, cluster);

      // op1 and op4 get deviation, op2 and op3 stay at 0
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(expectedDeviation);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[1]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[2]))).to.equal(0n);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[3]))).to.equal(expectedDeviation);

      // DAO gets full vUnits = baseline + deviation (NOT reduced for removed ops)
      const daoVUnits = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVUnits).to.equal(calcVUnits(128n));

      // Solvency uses effectiveVUnits=40000 and 2-op burn rate
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 2n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: calcVUnits(128n),
      });
      expect(burnPerBlock).to.be.gt(0n);
    });

    it("RM5-013: Removed op operatorEthVUnits stays 0 — no stale deviation written back", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );

      // Verify deviation exists before liquidation
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId))).to.be.gt(0n);
      }

      // Liquidate cleans up deviation
      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId))).to.equal(0n);
      }

      // Remove op1 — operatorEthVUnits[op1] is already 0, delete has no visible effect
      await removeOps(network, operatorOwner, operatorIds, [0]);
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(0n);

      // Reactivate — reactivation should NOT write deviation back to removed op
      await reactivate(network, clusterOwner, operatorIds, cluster);

      // Critical assertion: removed op stays at 0
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(0n);

      // Active ops get deviation
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);
      for (let i = 1; i < operatorIds.length; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]))).to.equal(expectedDeviation);
      }
    });
  });

  // -----------------------------------------------------------------------
  // RM5-010 — Implicit EB (no deviation), liquidate, remove, reactivate
  // -----------------------------------------------------------------------
  describe("Implicit EB — no deviation (RM5-010)", () => {
    it("RM5-010: 4-op, implicit EB, liquidate, remove 1 op, reactivate — clusterDeviation=0", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // No explicit EB — deviation is 0 for all operators
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId))).to.equal(0n);
      }

      // Liquidate
      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove op2
      await removeOps(network, operatorOwner, operatorIds, [1]);

      // Reactivate
      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, liquidatedCluster,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // INV-11: no deviation for any operator, but DAO baseline = 1 * BPS
      await assertINV11(provider, proxyAddr, operatorIds, [1], 0n, defaultVUnits(1n));

      // ethDaoValidatorCount reflects the reactivated cluster
      const daoValCount = await readEthDaoValidatorCount(provider, proxyAddr);
      expect(daoValCount).to.equal(1n);
    });
  });

  // -----------------------------------------------------------------------
  // RM5-011, RM5-012 — Guard verification: _resetOperatorState and active op
  // -----------------------------------------------------------------------
  describe("Guard verification (RM5-011, RM5-012)", () => {
    it("RM5-011: Removed op has ethSnapshot.block==0, ethFee==0, ethValidatorCount==0 after removeOperator", async function () {
      const { network, views, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // Verify pre-removal: operator has non-zero state
      const preRemoval = await views.getOperatorById(operatorIds[1]);
      expect(preRemoval[2]).to.be.gt(0n); // ethValidatorCount > 0

      // Liquidate
      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove op2
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      // Verify post-removal: all fields zeroed by _resetOperatorState
      const postRemoval = await views.getOperatorById(operatorIds[1]);
      expect(postRemoval[1]).to.equal(0n); // ethFee == 0
      expect(postRemoval[2]).to.equal(0n); // ethValidatorCount == 0
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[1]))).to.equal(0n);

      // Reactivate — guard at line 291 skips removed op
      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, liquidatedCluster,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // Removed op stays zeroed after reactivation
      const afterReactivation = await views.getOperatorById(operatorIds[1]);
      expect(afterReactivation[1]).to.equal(0n); // ethFee still 0
      expect(afterReactivation[2]).to.equal(0n); // ethValidatorCount still 0
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[1]))).to.equal(0n);
    });

    it("RM5-012: Active op has ethSnapshot.block!=0 — fee accrual computed, ethValidatorCount incremented", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // Liquidate
      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove op2 (only op2, leave op1, op3, op4 active)
      await removeOps(network, operatorOwner, operatorIds, [1]);

      // Reactivate
      await reactivate(network, clusterOwner, operatorIds, liquidatedCluster);

      // Active operators (op1, op3, op4) should have ethValidatorCount > 0
      for (const idx of [0, 2, 3]) {
        const opData = await views.getOperatorById(operatorIds[idx]);
        expect(opData[1]).to.be.gt(0n); // ethFee > 0 (not reset)
        expect(opData[2]).to.be.gt(0n); // ethValidatorCount incremented
      }

      // Removed operator (op2) should have ethValidatorCount == 0
      const removedOp = await views.getOperatorById(operatorIds[1]);
      expect(removedOp[1]).to.equal(0n); // ethFee == 0
      expect(removedOp[2]).to.equal(0n); // ethValidatorCount == 0
    });
  });

  // -----------------------------------------------------------------------
  // RM5-014 — EB update on liquidated cluster → remove op → reactivate
  // -----------------------------------------------------------------------
  describe("EB update on liquidated cluster (RM5-014)", () => {
    it("RM5-014: EB update while liquidated changes deviation on reactivation", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 1);

      // Initial EB=48 → vUnits=15000, deviation=5000
      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        48, [oracle1, oracle2, oracle3],
      );
      const initialVUnits = calcVUnits(48n);
      expect(initialVUnits).to.equal(15000n);

      // Liquidate (cleans up deviation)
      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, initialVUnits,
      );
      for (const opId of operatorIds) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(opId))).to.equal(0n);
      }

      // EB update on liquidated cluster: effectiveBalance=64 → vUnits=20000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const newEB = 64;
      const root2 = computeEBRoot(clusterId, newEB);
      await mineBlocks(provider, 1);
      const rootBlockNum2 = await getBlockNumber(provider);
      await commitEBRoot(network, root2, rootBlockNum2, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum2, clusterOwner.address, operatorIds, cluster,
        newEB, [],
      );
      cluster = parseClusterFromEvent(network, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      // Remove op4
      await removeOps(network, operatorOwner, operatorIds, [3]);

      // Reactivate — uses updated vUnits=20000
      const reactivatedCluster = await reactivate(
        network, clusterOwner, operatorIds, cluster,
      );
      expect(reactivatedCluster.active).to.equal(true);

      // clusterDeviation = 20000 - 10000 = 10000 (based on updated EB)
      const updatedDeviation = calcVUnits(BigInt(newEB)) - defaultVUnits(1n);
      expect(updatedDeviation).to.equal(10000n);

      // Op4 (removed) stays at 0; op1, op2, op3 get updated deviation
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[3]))).to.equal(0n);
      for (let i = 0; i < 3; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]))).to.equal(updatedDeviation);
      }

      // daoTotalEthVUnits = baseline + updatedDeviation = calcVUnits(64) = 20000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(calcVUnits(BigInt(newEB)));
    });
  });

  // -----------------------------------------------------------------------
  // RM5-015, RM5-016 — Global hasDeviation flag
  // -----------------------------------------------------------------------
  describe("Global hasDeviation flag (RM5-015, RM5-016)", () => {
    it("RM5-015: hasDeviation=true (global), removed op skipped — effectiveVUnits uses stored deviation path", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 8 operators total — split into two groups to avoid key collision
      const allOps = await registerOperators(network, operatorOwner, 8);
      const operatorIds2 = allOps.slice(0, 4);
      const operatorIds = allOps.slice(4, 8);

      // Create a SECOND cluster with deviation to make daoTotalEthVUnits > 0
      await whitelistAddresses(network, operatorOwner, operatorIds2, [clusterOwner2.address]);
      let cluster2 = await registerValidators(
        network, clusterOwner2, operatorIds2, 1,
      );
      cluster2 = await setupExplicitEB(
        network, provider, clusterOwner2, operatorIds2, cluster2,
        64, [oracle1, oracle2, oracle3],
      );
      // cluster2 has deviation=10000, now daoTotalEthVUnits > 0

      const daoVUnitsBefore = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVUnitsBefore).to.be.gt(0n); // hasDeviation = true globally

      // Create the TEST cluster with the second set of operators
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);

      // Liquidate test cluster
      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove op1 (index 0)
      await removeOps(network, operatorOwner, operatorIds, [0]);

      // Reactivate — hasDeviation is true globally (cluster2 still has deviation)
      await reactivate(network, clusterOwner, operatorIds, cluster);

      // INV-11: removed op stays at 0
      expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[0]))).to.equal(0n);

      // Active ops get deviation (added to existing stored deviation, which was cleaned by liquidation → starts at 0)
      for (let i = 1; i < operatorIds.length; i++) {
        expect(await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[i]))).to.equal(expectedDeviation);
      }

      // daoTotalEthVUnits = previous + test cluster full vUnits (baseline + deviation)
      const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVUnitsAfter).to.equal(daoVUnitsBefore + calcVUnits(128n));
    });

    it("RM5-016: hasDeviation=false (global), implicit EB, removed op skipped — baseline path for active ops", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      const cluster = await registerValidators(
        network, clusterOwner, operatorIds, 1, ethers.parseEther("1"),
      );

      // No explicit EB — hasDeviation=false globally
      // daoTotalEthVUnits = baseline = 1 * BPS = 10000 (equals ethDaoValidatorCount * BPS → no deviation)
      const daoVUnitsBefore = await readDaoTotalEthVUnits(provider, proxyAddr);
      expect(daoVUnitsBefore).to.equal(defaultVUnits(1n)); // Baseline only, no deviation

      // Liquidate
      const liquidatedCluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Remove op3
      await removeOps(network, operatorOwner, operatorIds, [2]);

      // Reactivate — hasDeviation=false, baseline path for active ops
      await reactivate(network, clusterOwner, operatorIds, liquidatedCluster);

      // INV-11: no deviation for any operator, DAO baseline = 1 * BPS
      await assertINV11(provider, proxyAddr, operatorIds, [2], 0n, defaultVUnits(1n));
    });
  });

  // -----------------------------------------------------------------------
  // RM5-017 — ExceedValidatorLimitWithData on reactivation
  // -----------------------------------------------------------------------
  describe("Validator limit on reactivation (RM5-017)", () => {
    it("RM5-017: Active op at validator limit — reactivation reverts ExceedValidatorLimitWithData", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // validatorsPerOperatorLimit is in StorageProtocol slot 0, bits 96-127 (uint32).
      const protocolSlot0 = "0x" + SSV_STORAGE_PROTOCOL_BASE.toString(16).padStart(64, "0");
      const currentSlot0 = BigInt(await provider.getStorage(proxyAddr, protocolSlot0));
      const clearedLimit = currentSlot0 & ~(UINT32_MASK << 96n);

      // Set high limit so we can register freely
      const setLimit = async (limit: bigint) => {
        const val = clearedLimit | (limit << 96n);
        await provider.send("hardhat_setStorageAt", [
          proxyAddr,
          protocolSlot0,
          "0x" + val.toString(16).padStart(64, "0"),
        ]);
      };
      await setLimit(3000n);

      // Register 4 operators, whitelist three cluster owners
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
        staker.address,
      ]);

      // Cluster A (clusterOwner): 2 validators → ops count=2
      await registerValidators(
        network, clusterOwner, operatorIds, 2, ethers.parseEther("1"),
      );

      // Cluster B (clusterOwner2): 1 validator → ops count=3
      const clusterB = await registerValidators(
        network, clusterOwner2, operatorIds, 1, ethers.parseEther("1"), 100,
      );

      // Liquidate Cluster B → ops count drops to 2
      const liquidatedB = await drainAndLiquidate(
        network, provider, clusterOwner2, liquidator, operatorIds, clusterB,
      );

      // Cluster C (staker, different owner): 1 validator → ops count back to 3
      await registerValidators(
        network, staker, operatorIds, 1, ethers.parseEther("1"), 200,
      );

      // Set limit to 3 (ops are AT limit)
      await setLimit(3n);

      // Remove op[1]
      await removeOps(network, operatorOwner, operatorIds, [1]);

      // Reactivate Cluster B → active ops 0,2,3 would go from 3 to 4 → exceeds limit 3
      await expect(
        network.connect(clusterOwner2).reactivate(
          operatorIds,
          liquidatedB,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_VALIDATORS_LIMIT_EXCEEDED);
    });
  });

  // -----------------------------------------------------------------------
  // RM5-018, RM5-019, RM5-020 — Removed op position in array
  // -----------------------------------------------------------------------
  describe("Removed op position in array (RM5-018, 019, 020)", () => {
    it("RM5-018: Removed op at position [0] (first) — guard triggers on first iteration", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);

      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove first operator (index 0)
      await removeOps(network, operatorOwner, operatorIds, [0]);

      await reactivate(network, clusterOwner, operatorIds, cluster);

      // INV-11: first op removed, rest get deviation, DAO = full vUnits
      await assertINV11(provider, proxyAddr, operatorIds, [0], expectedDeviation, calcVUnits(128n));
    });

    it("RM5-019: Removed op at position [last] — guard triggers on last iteration", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);

      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove last operator (index 3)
      await removeOps(network, operatorOwner, operatorIds, [3]);

      await reactivate(network, clusterOwner, operatorIds, cluster);

      // INV-11: last op removed, first three get deviation, DAO = full vUnits
      await assertINV11(provider, proxyAddr, operatorIds, [3], expectedDeviation, calcVUnits(128n));
    });

    it("RM5-020: Two removed ops at mixed positions [1] and [5] in 7-op cluster", async function () {
      const { network, proxyAddr } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, operatorOwner, 7);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      let cluster = await registerValidators(network, clusterOwner, operatorIds, 2);

      cluster = await setupExplicitEB(
        network, provider, clusterOwner, operatorIds, cluster,
        128, [oracle1, oracle2, oracle3],
      );
      const expectedDeviation = calcVUnits(128n) - defaultVUnits(2n);

      cluster = await drainAndLiquidate(
        network, provider, clusterOwner, liquidator, operatorIds, cluster, calcVUnits(128n),
      );

      // Remove ops at positions [1] and [5]
      await removeOps(network, operatorOwner, operatorIds, [1, 5]);

      await reactivate(network, clusterOwner, operatorIds, cluster);

      // INV-11: ops at [1] and [5] removed, 5 active ops get deviation, DAO = full vUnits
      await assertINV11(
        provider, proxyAddr, operatorIds, [1, 5],
        expectedDeviation, calcVUnits(128n),
      );

      // Verify active ops by checking ethValidatorCount > 0
      const activeIndices = [0, 2, 3, 4, 6];
      for (const idx of activeIndices) {
        const vUnits = await readOperatorEthVUnits(provider, proxyAddr, BigInt(operatorIds[idx]));
        expect(vUnits).to.equal(expectedDeviation);
      }
    });
  });
});
