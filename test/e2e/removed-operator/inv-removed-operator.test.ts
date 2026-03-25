/**
 * Removed-Operator Invariant Tests (INV-037 to INV-050 + extras)
 *
 * Tests G11 (Removed Operator Zero State) and related invariants across
 * all removed-operator scenarios. Uses REAL removeOperator() — no mocks.
 *
 * G11: If operator.ethSnapshot.block == 0, then seb.operatorEthVUnits[operatorId] == 0
 *
 * The BUG-21 fix added guards (`if (s.operators[operatorId].ethSnapshot.block == 0) continue;`)
 * in _updateOperatorVUnits, _executeLiquidation, and _bulkRemoveValidator. These guards
 * skip removed operators, ensuring G11 holds: operatorEthVUnits[removedOp] stays 0,
 * no Panic(0x11) underflow, and daoTotalEthVUnits only counts active ops.
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  computeClusterId,
  commitEBRoot,
  setupOracles,
  parseClusterFromEvent,
  setupTestContext,
  mineBlocks,
  getBlockNumber,
} from "../../common/helpers.ts";
import {
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  calcVUnits,
} from "../../helpers/fee.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_LIQUIDATION_THRESHOLD,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

// ---------------------------------------------------------------------------
//  Storage-level helpers: read operatorEthVUnits directly from EVM storage
// ---------------------------------------------------------------------------

/** Compute the diamond storage base slot for SSVStorageEB */
function ebStorageBaseSlot(): bigint {
  // uint256(keccak256("ssv.network.storage.eb")) - 1
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
}

/**
 * Read seb.operatorEthVUnits[operatorId] directly from contract storage.
 * operatorEthVUnits is the 3rd field (index 2) in StorageEB.
 */
async function readOperatorEthVUnits(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const baseSlot = ebStorageBaseSlot() + 2n; // operatorEthVUnits mapping slot
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["uint256", "uint256"], [BigInt(operatorId), baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw) & 0xFFFFFFFFFFFFFFFFn; // uint64 mask
}

// ---------------------------------------------------------------------------
//  G11 assertion helper
// ---------------------------------------------------------------------------

/**
 * Assert INV-11 (G11): for a removed operator, all three conditions must hold:
 *   1. operatorEthVUnits[opId] == 0
 *   2. ethValidatorCount == 0
 *   3. isActive == false (implies ethSnapshot.block == 0 when snapshot.block also 0)
 */
async function assertG11Holds(
  views: any,
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
  label: string,
): Promise<void> {
  const opData = await views.getOperatorById(BigInt(operatorId));
  expect(opData.isActive).to.equal(false, `${label}: isActive should be false (ethSnapshot.block == 0)`);
  expect(opData.validatorCount).to.equal(0n, `${label}: ethValidatorCount should be 0`);
  const vUnits = await readOperatorEthVUnits(provider, contractAddress, operatorId);
  expect(vUnits).to.equal(0n, `${label}: operatorEthVUnits should be 0`);
}


// ---------------------------------------------------------------------------
//  EB update helper (commit root with quorum + updateClusterBalance)
// ---------------------------------------------------------------------------

async function performEBUpdate(
  connection: any,
  network: any,
  oracles: HardhatEthersSigner[],
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
): Promise<Cluster> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    { clusterId, effectiveBalance },
  ]);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);

  const tx = await network.updateClusterBalance(
    rootBlockNum,
    clusterOwner.address,
    operatorIds,
    cluster,
    effectiveBalance,
    proofs[clusterId],
  );
  const receipt = await tx.wait();
  return parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
}

// ---------------------------------------------------------------------------
//  Liquidation helper: withdraw to near threshold, mine 1 block, then liquidate
// ---------------------------------------------------------------------------

const NUM_OPERATORS = 4n;

/**
 * Drain a cluster balance via withdraw, then liquidate.
 *
 * For clusters with removed operators, the cumulative operator index can be
 * LESS than cluster.index (because the removed op contributes 0). This causes
 * a uint64 underflow in `updateBalanceWithEB(newIndex - cluster.index)`.
 * We mine 50 blocks first so the active operators' index growth exceeds the
 * removed operator's lost contribution, making the subtraction safe.
 *
 * @param activeOperators Number of active (non-removed) operators in the cluster.
 *   The contract's burn rate and liquidation threshold use only active operators.
 */
async function drainAndLiquidate(
  network: any,
  views: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  liquidator: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveVUnits?: bigint,
  activeOperators?: bigint,
): Promise<Cluster> {
  const vUnits = effectiveVUnits ?? defaultVUnits(BigInt(cluster.validatorCount));
  const numActiveOps = activeOperators ?? NUM_OPERATORS;
  const perBlockBurn = calcClusterBurn({
    blockDiff: 1n,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const liqThreshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
    numOperators: numActiveOps,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });

  // Mine blocks so active operators' index growth exceeds the removed operator's
  // lost contribution, preventing uint64 underflow in fee settlement.
  await mineBlocks(provider, 50);

  // Now getBalance() / withdraw() won't underflow on index subtraction.
  const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));

  // Withdraw to leave just above liqThreshold, accounting for:
  //  - 1 block gap (getBalance view → withdraw tx)
  //  - 1 block buffer for mine(1) + liquidate
  const withdrawAmount = currentBalance - 2n * perBlockBurn - liqThreshold;
  const aligned = (withdrawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

  if (aligned > 0n) {
    const wTx = await network.connect(clusterOwner).withdraw(operatorIds, aligned, cluster);
    const wReceipt = await wTx.wait();
    cluster = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);
  }

  // Mine 1 block to push below threshold
  await mineBlocks(provider, 1);

  // Liquidate
  const liqTx = await network.connect(liquidator).liquidate(
    clusterOwner.address, operatorIds, cluster,
  );
  const liqReceipt = await liqTx.wait();
  return parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe("Removed-Operator Invariant Tests (G11 + Related)", function () {
  let connection: NetworkConnection<"generic">;
  before(async function () {
    ({ connection } = await setupTestContext());
  });

  // ------- INV-037: Clean Removal Baseline -------

  describe("INV-037: Clean removal (no clusters) — G11 holds", () => {
    it("After removing operator with no clusters, G11 holds", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const [owner] = await connection.ethers.getSigners();
      const contractAddr = await network.getAddress();

      await network.connect(owner).registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      // Verify operator is active before removal
      let opData = await views.getOperatorById(1n);
      expect(opData.isActive).to.equal(true);

      await network.connect(owner).removeOperator(1n);

      await assertG11Holds(views, provider, contractAddr, 1, "INV-037");
    });
  });

  // ------- INV-038: Removal with Active Cluster (Implicit EB) -------

  describe("INV-038: Removal with active cluster, implicit EB — G11 holds", () => {
    it("After removing operator from active implicit-EB cluster, G11 holds", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 10);

      // Remove operator 1 (has active cluster)
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-038");

      // Cluster still exists with same validator count
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(cluster.active).to.equal(true);
    });
  });

  // ------- INV-039: Removal + EB Update (PRIMARY BUG PATH) -------

  describe("INV-039: Removal + EB update — G11 holds (guard skips removed op)", () => {
    it("EB update after operator removal preserves G11 — guard skips removed op", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      // Setup oracles + staking (required for commitRoot quorum)
      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // G11 holds immediately after removal
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-039 pre-EB");

      // EB update on cluster (still references removed op in operatorIds)
      // effectiveBalance = 48 ETH/validator → vUnits = ceil(48*10000/32) = 15000
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // G11 HOLDS: guard skips removed op in _updateOperatorVUnits
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-039 post-EB");
    });
  });

  // ------- INV-040: Cascading Removals (2 ops) + EB Update -------

  describe("INV-040: Cascading removal (2 ops) + EB update — G11 holds for both", () => {
    it("EB update after removing 2 operators preserves G11 for both — guard skips them", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Remove operator 1 AND operator 2
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await network.connect(owner).removeOperator(BigInt(operatorIds[1]));

      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-040 op1 pre-EB");
      await assertG11Holds(views, provider, contractAddr, operatorIds[1], "INV-040 op2 pre-EB");

      // EB update — guard skips both removed operators
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-040 op1 post-EB");
      await assertG11Holds(views, provider, contractAddr, operatorIds[1], "INV-040 op2 post-EB");
    });
  });

  // ------- INV-041: Removal + Liquidation with Explicit EB -------

  describe("INV-041: Removal + liquidation with explicit EB — guard prevents underflow", () => {
    it("Liquidation succeeds after operator removal — guard skips removed op in deviation cleanup", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Set explicit EB (creates deviation): 48 ETH/val → vUnits = 15000
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // Remove operator 1 (delete operatorEthVUnits[op1] — was nonzero, now 0)
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-041 after removal");

      // Drain cluster balance via withdrawal to near-liquidatable level
      // Mine blocks first to avoid index underflow in withdraw
      await mineBlocks(provider, 50);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
      const vUnits = calcVUnits(48n);
      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const withdrawAmount = currentBalance - 2n * perBlockBurn - liqThreshold;
      const aligned = (withdrawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
      if (aligned > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(operatorIds, aligned, cluster);
        const wReceipt = await wTx.wait();
        cluster = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);
      }
      await mineBlocks(provider, 1);

      // Guard prevents underflow: liquidation succeeds, skips removed operator
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      cluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // G11 holds after successful liquidation
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-041 G11 holds after liquidation");
    });
  });

  // ------- INV-042: Removal + Reactivation (Implicit EB) -------

  describe("INV-042: Removal + reactivation, implicit EB — G11 preserved", () => {
    it("Reactivation correctly skips removed operator (ethSnapshot.block == 0)", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      // Drain and liquidate
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
        undefined, 3n, // 3 active ops (1 removed)
      );

      // Reactivate with fresh ETH
      await network.connect(clusterOwner).reactivate(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // G11 preserved: reactivation skips removed op (OperatorLib checks ethSnapshot.block != 0)
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-042 after reactivation");
    });
  });

  // ------- INV-043: Removal + Migration -------

  describe("INV-043: Removal + migration — G11 preserved (no prior EB)", () => {
    it("Migration after operator removal preserves G11 when no EB deviation exists", async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [clusterOwner] = signers;

      const OP_SSV_FEE = 10_000_000_000n;
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Upgrade to v2
      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );
      const contractAddr = await newNetwork.getAddress();

      // Remove operator 1
      await newNetwork.connect(clusterOwner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(newViews, provider, contractAddr, operatorIds[0], "INV-043 after removal");

      // Migrate SSV cluster to ETH
      // No prior EB update possible for SSV clusters, so vUnitsCluster == 0
      // Migration deviation loop doesn't execute — G11 preserved
      await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await assertG11Holds(newViews, provider, contractAddr, operatorIds[0], "INV-043 after migration");
    });
  });

  // ------- INV-044: Shared Operator Removal + Multiple EB Updates -------

  describe("INV-044: Shared operator removal + multiple EB updates — G11 holds", () => {
    it("Guard prevents stale data from two independent clusters on removed shared operator", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwnerA, clusterOwnerB] = signers;
      const contractAddr = await network.getAddress();

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      // Operator 1 is shared between cluster A (ops [1,2,3,4]) and cluster B (ops [1,5,6,7])
      const opsA = await registerOperators(network, owner, 4); // IDs: 1,2,3,4
      // Register 3 more for cluster B (ops 5,6,7)
      const extraOps: number[] = [];
      for (let i = 5; i <= 7; i++) {
        const expectedId = await network.connect(owner).registerOperator.staticCall(
          makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true,
        );
        await network.connect(owner).registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        extraOps.push(Number(expectedId));
      }
      const opsB = [opsA[0], ...extraOps]; // shared op1 + 5,6,7

      await whitelistAddresses(network, owner, opsA, [clusterOwnerA.address]);
      await whitelistAddresses(network, owner, opsB, [clusterOwnerB.address]);

      // Register cluster A
      await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), opsA, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let clusterA = await getCurrentClusterState(connection, network, clusterOwnerA.address, opsA);

      // Register cluster B
      await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(10), opsB, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, opsB);

      // Remove the shared operator 1
      await network.connect(owner).removeOperator(BigInt(opsA[0]));
      await assertG11Holds(views, provider, contractAddr, opsA[0], "INV-044 after removal");

      // EB update on cluster A — guard skips removed shared op
      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, 48,
      );

      const vUnitsAfterA = await readOperatorEthVUnits(provider, contractAddr, opsA[0]);
      expect(vUnitsAfterA).to.equal(0n, "INV-044: guard prevents stale data from cluster A");

      // EB update on cluster B — guard also skips removed shared op
      await mineBlocks(provider, 5);
      clusterB = await performEBUpdate(
        connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, 64,
      );

      const vUnitsAfterBoth = await readOperatorEthVUnits(provider, contractAddr, opsA[0]);
      expect(vUnitsAfterBoth).to.equal(0n, "INV-044: guard prevents cumulative stale data");
      await assertG11Holds(views, provider, contractAddr, opsA[0], "INV-044 after both EB updates");
    });
  });

  // ------- INV-045: Full Lifecycle -------

  describe("INV-045: Full lifecycle (register, EB, remove, liquidate) — guard prevents underflow", () => {
    it("Full lifecycle: EB → removal → liquidation succeeds (guard skips removed op)", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

      // DAO config for liquidation
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      // Register with standard balance
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Step 1: Set explicit EB (creates deviation)
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      const vUnitsAfterEB = await readOperatorEthVUnits(provider, contractAddr, operatorIds[0]);
      expect(vUnitsAfterEB).to.be.greaterThan(0n, "Deviation set for op1 after EB update");

      // Step 2: Remove operator 1 (clears operatorEthVUnits)
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-045 after removal");

      // Step 3: Drain balance via withdrawal, then attempt liquidation
      // Mine blocks first to avoid index underflow in withdraw
      await mineBlocks(provider, 50);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
      const vUnits = calcVUnits(48n);
      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n, numOperators: 3n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD, numOperators: 3n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const withdrawAmount = currentBalance - 2n * perBlockBurn - liqThreshold;
      const aligned = (withdrawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
      if (aligned > 0n) {
        const wTx = await network.connect(clusterOwner).withdraw(operatorIds, aligned, cluster);
        const wReceipt = await wTx.wait();
        cluster = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);
      }
      await mineBlocks(provider, 1);

      // Guard prevents underflow: liquidation succeeds, skips removed operator
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      cluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // G11 holds after successful liquidation
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-045 G11 holds after liquidation");
    });
  });

  // ------- INV-014: Validator Count Unchanged on Op Removal (G3) -------

  describe("INV-014: Operator removal does NOT change ethDaoValidatorCount (G3)", () => {
    it("Removing operator preserves DAO validator count — cluster still has validators", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwnerA, clusterOwnerB, clusterOwnerC] = signers;

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [
        clusterOwnerA.address, clusterOwnerB.address, clusterOwnerC.address,
      ]);

      // Register 3 clusters with 1 validator each → total = 3
      await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await network.connect(clusterOwnerC).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const countBefore = await views.getNetworkValidatorsCount();
      expect(countBefore).to.equal(3n);

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      // G3: validator count unchanged — clusters still exist with same validator count
      const countAfter = await views.getNetworkValidatorsCount();
      expect(countAfter).to.equal(3n, "INV-014: ethDaoValidatorCount must not change on operator removal");
    });
  });

  // ------- INV-018: vUnit Consistency After Op Removal + EB (G4+G11) -------

  describe("INV-018: Operator removal + EB update — G4 vUnit consistency check", () => {
    it("After removal + EB update, daoTotalEthVUnits correct — removed op excluded", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      // EB update (writes stale vUnits to removed op)
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // G11 holds: guard skips removed op during EB update
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-018 G11");

      // G4 check: removed op has 0 vUnits, only live ops have deviation
      const removedOpVUnits = await readOperatorEthVUnits(provider, contractAddr, operatorIds[0]);
      expect(removedOpVUnits).to.equal(0n, "INV-018: removed op vUnits stays 0");

      // Live ops should have the deviation from the EB update
      const liveOpVUnits = await readOperatorEthVUnits(provider, contractAddr, operatorIds[1]);
      expect(liveOpVUnits).to.be.greaterThan(0n, "INV-018: live op has vUnits from EB update");
    });
  });

  // ------- INV-050: Full Lifecycle Multi-Invariant Stress Test -------

  describe("INV-050: Full lifecycle multi-invariant stress test", () => {
    it("G1+G3+G4+G10+G11 across register, EB, removal, liquidation, reactivation", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, ownerA, ownerB, ownerC, liquidator] = signers;
      const contractAddr = await network.getAddress();

      // DAO config for liquidation
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      // Register 3 separate operator sets (12 operators total)
      const ops1 = await registerOperators(network, owner, 4); // ops 1-4
      const ops2: number[] = [];
      for (let i = 5; i <= 8; i++) {
        const id = await network.connect(owner).registerOperator.staticCall(
          makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true,
        );
        await network.connect(owner).registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        ops2.push(Number(id));
      }
      const ops3: number[] = [];
      for (let i = 9; i <= 12; i++) {
        const id = await network.connect(owner).registerOperator.staticCall(
          makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true,
        );
        await network.connect(owner).registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        ops3.push(Number(id));
      }

      await whitelistAddresses(network, owner, ops1, [ownerA.address]);
      await whitelistAddresses(network, owner, ops2, [ownerB.address]);
      await whitelistAddresses(network, owner, ops3, [ownerC.address]);

      // Step 1: Register 3 clusters
      await network.connect(ownerA).registerValidator(
        makePublicKey(1), ops1, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await network.connect(ownerB).registerValidator(
        makePublicKey(2), ops2, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await network.connect(ownerC).registerValidator(
        makePublicKey(3), ops3, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      let clusterA = await getCurrentClusterState(connection, network, ownerA.address, ops1);
      let clusterB = await getCurrentClusterState(connection, network, ownerB.address, ops2);
      await getCurrentClusterState(connection, network, ownerC.address, ops3); // cluster C exists but not directly used

      // G3 check: 3 validators total
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 1: G3");

      // Step 2: EB update on cluster 1 (EB = 48)
      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        connection, network, oracles, provider, ownerA, ops1, clusterA, 48,
      );

      // Step 3: Remove operator 2 (from cluster 1's set)
      await network.connect(owner).removeOperator(BigInt(ops1[1]));
      await assertG11Holds(views, provider, contractAddr, ops1[1], "Step 3: G11 after removal");

      // G3 unchanged
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 3: G3");

      // Step 4: Liquidate cluster 2 via drain-and-liquidate
      clusterB = await getCurrentClusterState(connection, network, ownerB.address, ops2);
      clusterB = await drainAndLiquidate(network, views, provider, ownerB, liquidator, ops2, clusterB);

      // G3: decremented by 1
      expect(await views.getNetworkValidatorsCount()).to.equal(2n, "Step 4: G3 after liquidation");

      // G10: ops2 operators should have ethValidatorCount = 0
      for (const opId of ops2) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(0n, `Step 4: G10 op ${opId}`);
      }

      // Step 5: Reactivate cluster 2
      clusterB = await getCurrentClusterState(connection, network, ownerB.address, ops2);
      await network.connect(ownerB).reactivate(ops2, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE });

      // G3: back to 3
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 5: G3 after reactivation");

      // G10: ops2 operators back to ethValidatorCount = 1
      for (const opId of ops2) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1n, `Step 5: G10 op ${opId}`);
      }

      // Step 6: EB update on cluster 1 again (with removed op2) — guard skips removed op
      await mineBlocks(provider, 5);
      clusterA = await getCurrentClusterState(connection, network, ownerA.address, ops1);
      clusterA = await performEBUpdate(
        connection, network, oracles, provider, ownerA, ops1, clusterA, 64,
      );

      // G11 holds: guard skips removed op during EB update
      await assertG11Holds(views, provider, contractAddr, ops1[1], "Step 6: G11 holds after EB update");

      // G3 still 3
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 6: G3");
    });
  });

  // ------- Extra-1: Removal + Validator Removal -------

  describe("Extra: Removal + removeValidator on surviving cluster", () => {
    it("Removing validator from cluster with removed operator preserves G11", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Add second validator
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      // Remove validator from cluster (cluster still references removed op in operatorIds)
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );

      // G11 holds: removeValidator doesn't modify operatorEthVUnits for implicit-EB clusters
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: after removeValidator");

      // G3: validator count decreased
      expect(await views.getNetworkValidatorsCount()).to.equal(1n);
    });
  });

  // ------- Extra-2: Removal + Deposit -------

  describe("Extra: Removal + deposit preserves G11", () => {
    it("Depositing into cluster with removed operator does not touch vUnits", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: after removal");

      // Deposit more ETH into the cluster
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: ethers.parseEther("5") },
      );

      // G11 preserved: deposit doesn't touch operatorEthVUnits
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: after deposit");
    });
  });

  // ------- Extra-3: Removal + Reactivation WITH prior EB -------

  describe("Extra: Removal + reactivation with prior EB deviation — G11 holds throughout", () => {
    it("Guard prevents stale data through full removal+EB+liquidation+reactivation cycle", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

      // DAO config for liquidation
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));

      // EB update — guard skips removed op, vUnits stays 0
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: G11 holds after EB update");

      // Drain and liquidate (EB=48 → vUnits = calcVUnits(48n))
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
        calcVUnits(48n), 3n, // 3 active ops (1 removed)
      );

      // Reactivate
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).reactivate(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // G11 holds throughout: guard prevents stale data at every step
      await assertG11Holds(views, provider, contractAddr, operatorIds[0],
        "Extra: G11 holds after full removal+EB+liquidation+reactivation cycle");
    });
  });

  // ------- Extra-4: Removal + Withdraw on cluster -------

  describe("Extra: Removal + cluster withdraw preserves G11", () => {
    it("Withdrawing from cluster with removed operator does not touch vUnits", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 10);

      // Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: after removal");

      // Withdraw some ETH from cluster
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const withdrawAmount = ethers.parseEther("1");
      await network.connect(clusterOwner).withdraw(
        operatorIds, withdrawAmount, cluster,
      );

      // G11 preserved: withdraw doesn't touch operatorEthVUnits
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "Extra: after withdraw");
    });
  });
});
