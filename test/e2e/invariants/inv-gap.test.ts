/**
 * Invariant Gap Tests (INV-017..020, INV-033, INV-039..045, INV-047, INV-049, INV-050)
 *
 * Tests ALL invariant gaps identified in scenarios-invariants.md:
 * - G4 (vUnit Consistency): INV-017..020
 * - G9 (Version Exclusivity): INV-033
 * - G11 (Removed Op Zero State): INV-039..045
 * - G12 (No Deviation Without EB): INV-047
 * - Composite: INV-049, INV-050
 *
 * Uses ssvNetworkFullFixture with real removeOperator() calls.
 * Reads operatorEthVUnits and daoTotalEthVUnits via diamond storage reads.
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
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  calcVUnits,
} from "../../common/helpers.ts";
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
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

// ---------------------------------------------------------------------------
//  Storage-level helpers: read from EVM diamond storage
// ---------------------------------------------------------------------------

/** SSVStorageEB base slot */
function ebStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
}

/** SSVStorageProtocol base slot */
function protocolStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
}

/** SSVStorage (main) base slot */
function mainStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.main"))) - 1n;
}

/**
 * Read seb.operatorEthVUnits[operatorId] from contract storage.
 * operatorEthVUnits is field index 2 in StorageEB.
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

/**
 * Read sp.daoTotalEthVUnits from contract storage.
 * It's a uint64 in slot 4 of StorageProtocol, at bits [192..255].
 *
 * Slot layout of StorageProtocol:
 *   Slot 0: networkFeeIndexBlockNumber(u32) + daoValidatorCount(u32) + daoIndexBlockNumber(u32) + validatorsPerOperatorLimit(u32) + networkFee(u64) + networkFeeIndex(u64)
 *   Slot 1: daoBalance(u64) + minimumBlocksBeforeLiquidationSSV(u64) + minimumLiquidationCollateralSSV(u64) + declareOperatorFeePeriod(u64)
 *   Slot 2: executeOperatorFeePeriod(u64) + operatorMaxFeeIncrease(u64) + operatorMaxFeeSSV(u64) + ethNetworkFeeIndexBlockNumber(u32) + ethDaoValidatorCount(u32)
 *   Slot 3: ethDaoIndexBlockNumber(u32) + ethNetworkFee(u64) + ethNetworkFeeIndex(u64) + ethDaoBalance(u64) [28 bytes]
 *   Slot 4: minimumLiquidationCollateral(u64) + minimumBlocksBeforeLiquidation(u64) + operatorMaxFee(u64) + daoTotalEthVUnits(u64)
 */
async function readDaoTotalEthVUnits(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  const slot = protocolStorageBaseSlot() + 4n;
  const raw = BigInt(await provider.getStorage(contractAddress, "0x" + slot.toString(16)));
  return (raw >> 192n) & 0xFFFFFFFFFFFFFFFFn;
}

/**
 * Read seb.clusterEB[clusterId].vUnits from contract storage.
 * clusterEB is field index 1 in StorageEB. vUnits is first uint64 in the struct.
 */
async function readClusterEBVUnits(
  provider: any,
  contractAddress: string,
  clusterId: string,
): Promise<bigint> {
  const baseSlot = ebStorageBaseSlot() + 1n; // clusterEB mapping slot
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterId, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw) & 0xFFFFFFFFFFFFFFFFn; // vUnits is first uint64
}

/**
 * Read s.clusters[key] from SSVStorage (main).
 * clusters is field index 1 (second mapping in StorageData).
 */
async function readSSVClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 1n; // clusters mapping slot
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

/**
 * Read s.ethClusters[key] from SSVStorage (main).
 * ethClusters is field index 10 (last mapping in StorageData).
 */
async function readETHClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 10n; // ethClusters mapping slot
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

/**
 * Read operator ethSnapshot.block from SSVStorage.operators mapping.
 * operators is field index 6 in StorageData.
 * Operator struct packing:
 *   Slot 0: validatorCount(4) + fee(8) + owner(20) = 32 bytes
 *   Slot 1: whitelisted(1) + snapshot.block(4) + snapshot.index(8) + snapshot.balance(8) + ethValidatorCount(4) = 25 bytes
 *   Slot 2: ethFee(8) + ethSnapshot.block(4) + ethSnapshot.index(8) + ethSnapshot.balance(8) = 28 bytes
 * ethSnapshot.block is at slot offset 2, bits [64..95].
 */
async function readOperatorEthSnapshotBlock(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const operatorsMapSlot = mainStorageBaseSlot() + 6n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const operatorBaseSlot = BigInt(ethers.keccak256(
    coder.encode(["uint256", "uint256"], [BigInt(operatorId), operatorsMapSlot]),
  ));
  const slot = operatorBaseSlot + 2n;
  const raw = BigInt(await provider.getStorage(contractAddress, "0x" + slot.toString(16)));
  return (raw >> 64n) & 0xFFFFFFFFn;
}

/**
 * Compute the cluster data hash matching ClusterLib.hashClusterData:
 * keccak256(abi.encodePacked(validatorCount, networkFeeIndex, index, balance, active))
 */
function computeClusterHash(cluster: Cluster): bigint {
  return BigInt(ethers.solidityPackedKeccak256(
    ["uint32", "uint64", "uint64", "uint256", "bool"],
    [BigInt(cluster.validatorCount), BigInt(cluster.networkFeeIndex),
     BigInt(cluster.index), BigInt(cluster.balance), cluster.active],
  ));
}

// ---------------------------------------------------------------------------
//  G11 assertion helpers
// ---------------------------------------------------------------------------

async function assertG11Holds(
  views: any,
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
  label: string,
): Promise<void> {
  const opData = await views.getOperatorById(BigInt(operatorId));
  expect(opData.isActive).to.equal(false, `${label}: isActive should be false`);
  const vUnits = await readOperatorEthVUnits(provider, contractAddress, operatorId);
  expect(vUnits).to.equal(0n, `${label}: operatorEthVUnits should be 0`);
  const ethSnapBlock = await readOperatorEthSnapshotBlock(provider, contractAddress, operatorId);
  expect(ethSnapBlock).to.equal(0n, `${label}: ethSnapshot.block should be 0`);
}


// ---------------------------------------------------------------------------
//  EB update helper
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
//  Drain + liquidate helper
// ---------------------------------------------------------------------------

const NUM_OPERATORS = 4n;

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

  await mineBlocks(provider, 50);

  const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
  const withdrawAmount = currentBalance - 2n * perBlockBurn - liqThreshold;
  const aligned = (withdrawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

  if (aligned > 0n) {
    const wTx = await network.connect(clusterOwner).withdraw(operatorIds, aligned, cluster);
    const wReceipt = await wTx.wait();
    cluster = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);
  }

  await mineBlocks(provider, 1);

  const liqTx = await network.connect(liquidator).liquidate(
    clusterOwner.address, operatorIds, cluster,
  );
  const liqReceipt = await liqTx.wait();
  return parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe("Invariant Gap Tests (INV-017..050)", function () {
  let connection: NetworkConnection<"generic">;
  before(async function () {
    ({ connection } = await setupTestContext());
  });

  // =========================================================================
  //  G4: vUnit Consistency — INV-017, INV-018, INV-019, INV-020
  // =========================================================================

  describe("INV-017: G4 — Liquidation with explicit EB zeroes daoTotalEthVUnits", () => {
    it("After liquidating cluster with EB deviation, daoTotalEthVUnits == 0", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      // Register cluster with 2 validators
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // G4 pre-check: implicit EB → daoTotalEthVUnits == ethDaoValidatorCount * 10000
      const valCountPre = BigInt(await views.getNetworkValidatorsCount());
      expect(valCountPre).to.equal(2n);
      const vUnitsPre = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(vUnitsPre).to.equal(valCountPre * BPS_DENOMINATOR, "INV-017 pre: implicit EB baseline");

      // Set explicit EB = 48 ETH/val → vUnits = ceil(96*10000/32) = 30000
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 96,
      );

      // Check deviation added: 30000 - 20000 = 10000 deviation
      const vUnitsAfterEB = await readDaoTotalEthVUnits(provider, contractAddr);
      const baseline = valCountPre * BPS_DENOMINATOR; // 20000
      const expectedVUnits = calcVUnits(96n); // ceil(96*10000/32) = 30000
      expect(vUnitsAfterEB).to.equal(
        baseline + (expectedVUnits - baseline),
        "INV-017: daoTotalEthVUnits includes deviation after EB update",
      );

      // Liquidate the cluster
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
        expectedVUnits, // use explicit EB vUnits for burn calc
      );

      // Verify liquidated cluster state (validatorCount preserved in struct, DAO count decremented)
      expect(cluster.active).to.equal(false, "INV-017: liquidated cluster active == false");
      expect(BigInt(cluster.validatorCount)).to.equal(2n, "INV-017: liquidated cluster validatorCount preserved");

      // G3: validator count → 0
      expect(await views.getNetworkValidatorsCount()).to.equal(0n, "INV-017: G3 after liquidation");

      // G4: daoTotalEthVUnits should be 0 (no remaining clusters)
      const vUnitsAfterLiq = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(vUnitsAfterLiq).to.equal(0n, "INV-017: daoTotalEthVUnits == 0 after liquidation");

      // All operator vUnits should be 0
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, contractAddr, opId);
        expect(opVUnits).to.equal(0n, `INV-017: operatorEthVUnits[${opId}] == 0`);
      }
    });
  });

  describe("INV-018: G4 — Operator removal + EB update — guard prevents stale vUnit data", () => {
    it("daoTotalEthVUnits correct after EB update — removed operator excluded by guard", async () => {
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

      // EB update writes stale vUnits to removed op
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // G11 holds: guard skips removed op during EB update
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-018 G11");

      // G4 check: removed op has 0 vUnits, only live ops have deviation
      const removedOpVUnits = await readOperatorEthVUnits(provider, contractAddr, operatorIds[0]);
      expect(removedOpVUnits).to.equal(0n, "INV-018: removed op vUnits stays 0");

      // Live ops should have the exact deviation from the EB update
      const liveOpVUnits = await readOperatorEthVUnits(provider, contractAddr, operatorIds[1]);
      const expectedDeviation = calcVUnits(48n) - defaultVUnits(1n); // 15000 - 10000 = 5000
      expect(liveOpVUnits).to.equal(expectedDeviation, "INV-018: live op has exact deviation from EB update");
    });
  });

  describe("INV-019: G4 — Reactivation with prior EB re-adds deviation", () => {
    it("After reactivation, daoTotalEthVUnits includes re-added deviation from stored EB", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

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

      // Set explicit EB = 48 ETH → vUnits = 15000
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      const expectedVUnits = calcVUnits(48n);
      const vUnitsAfterEB = await readDaoTotalEthVUnits(provider, contractAddr);
      const valCount = 1n;
      const deviation = expectedVUnits - valCount * BPS_DENOMINATOR; // 15000 - 10000 = 5000
      expect(vUnitsAfterEB).to.equal(
        valCount * BPS_DENOMINATOR + deviation,
        "INV-019 pre: deviation set after EB update",
      );

      // Liquidate
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
        expectedVUnits,
      );

      // After liquidation: daoTotalEthVUnits should be 0
      expect(await readDaoTotalEthVUnits(provider, contractAddr)).to.equal(0n, "INV-019: vUnits zeroed after liquidation");
      expect(await views.getNetworkValidatorsCount()).to.equal(0n, "INV-019: validator count 0 after liquidation");

      // Reactivate with fresh ETH
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).reactivate(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // G4: daoTotalEthVUnits should include re-added deviation from stored clusterEB
      const vUnitsAfterReactivation = await readDaoTotalEthVUnits(provider, contractAddr);
      const valCountAfter = BigInt(await views.getNetworkValidatorsCount());
      expect(valCountAfter).to.equal(1n, "INV-019: validator count restored");

      // The reactivation re-adds the deviation from stored clusterEB
      expect(vUnitsAfterReactivation).to.equal(
        valCountAfter * BPS_DENOMINATOR + deviation,
        "INV-019: daoTotalEthVUnits includes re-added deviation after reactivation",
      );
    });
  });

  describe("INV-020: G4 — Migration with stored EB adds deviation", () => {
    it("After migration, daoTotalEthVUnits includes migrated cluster deviation", async () => {
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

      // Pre-migration: daoTotalEthVUnits == 0 (no ETH clusters yet)
      const vUnitsPre = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(vUnitsPre).to.equal(0n, "INV-020 pre: no ETH clusters");

      // Migrate SSV cluster to ETH (no prior EB, so no deviation)
      await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // After migration with implicit EB: daoTotalEthVUnits == validatorCount * BPS
      const valCountAfter = BigInt(await newViews.getNetworkValidatorsCount());
      expect(valCountAfter).to.equal(1n, "INV-020: validator count after migration");

      const vUnitsAfter = await readDaoTotalEthVUnits(provider, contractAddr);
      // No deviation because no EB was set pre-migration (vUnitsCluster == 0 → no deviation loop)
      expect(vUnitsAfter).to.equal(
        valCountAfter * BPS_DENOMINATOR,
        "INV-020: daoTotalEthVUnits == baseline after migration (no EB deviation)",
      );

      // All operators should have 0 deviation (no explicit EB)
      for (const opId of operatorIds) {
        const opVUnits = await readOperatorEthVUnits(provider, contractAddr, opId);
        expect(opVUnits).to.equal(0n, `INV-020: operatorEthVUnits[${opId}] == 0 (no EB set)`);
      }
    });
  });

  // =========================================================================
  //  G9: Version Exclusivity — INV-033
  // =========================================================================

  describe("INV-033: G9 — After ETH liquidation, ethClusters[key] != 0 and clusters[key] == 0", () => {
    it("Liquidating ETH cluster maintains version exclusivity", async () => {
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

      const clusterKey = computeClusterId(clusterOwner.address, operatorIds);

      // Get cluster state and compute expected hash before liquidation
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const expectedHashPre = computeClusterHash(cluster);

      // Before liquidation: ethClusters[key] == exact cluster hash, clusters[key] == 0
      const ethHashPre = await readETHClusterHash(provider, contractAddr, clusterKey);
      const ssvHashPre = await readSSVClusterHash(provider, contractAddr, clusterKey);
      expect(ethHashPre).to.equal(expectedHashPre, "INV-033 pre: ethClusters[key] == exact cluster hash");
      expect(ssvHashPre).to.equal(0n, "INV-033 pre: clusters[key] == 0");

      // Drain and liquidate
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
      );

      // Compute expected liquidated cluster hash and verify cluster state
      expect(cluster.active).to.equal(false, "INV-033: liquidated cluster active == false");
      expect(BigInt(cluster.validatorCount)).to.equal(1n, "INV-033: liquidated cluster validatorCount preserved");
      const expectedHashPost = computeClusterHash(cluster);

      // After liquidation: ethClusters[key] == exact liquidated hash, clusters[key] still == 0
      const ethHashPost = await readETHClusterHash(provider, contractAddr, clusterKey);
      const ssvHashPost = await readSSVClusterHash(provider, contractAddr, clusterKey);
      expect(ethHashPost).to.equal(expectedHashPost, "INV-033: ethClusters[key] == exact liquidated hash");
      expect(ssvHashPost).to.equal(0n, "INV-033: clusters[key] == 0 after liquidation");
    });
  });

  // =========================================================================
  //  G11: Removed Operator Zero State — INV-039..045
  // =========================================================================

  describe("INV-039: G11 — Removal + EB update — G11 holds (guard skips removed op)", () => {
    it("EB update after operator removal preserves G11 — guard skips removed op", async () => {
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

      // G11 holds after removal
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-039 pre-EB");

      // EB update on cluster still references removed op
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // G11 HOLDS: guard skips removed op in _updateOperatorVUnits
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-039 post-EB");
    });
  });

  describe("INV-040: G11 — Cascading removal (2 ops) + EB update — G11 holds for both", () => {
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

      // Remove operators 1 and 2
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

  describe("INV-041: G11 — Removal + liquidation with explicit EB — guard prevents underflow", () => {
    it("Liquidation succeeds — guard skips removed operator in deviation cleanup", async () => {
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

      // Set explicit EB first (deviation exists)
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );

      // Remove operator 1 (delete operatorEthVUnits → 0)
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-041 after removal");

      // Drain cluster for liquidation
      const vUnits = calcVUnits(48n);
      await mineBlocks(provider, 50);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
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

      // Verify liquidated cluster state (validatorCount preserved in struct)
      expect(cluster.active).to.equal(false, "INV-041: liquidated cluster active == false");
      expect(BigInt(cluster.validatorCount)).to.equal(1n, "INV-041: liquidated cluster validatorCount preserved");

      // G11 holds after successful liquidation
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-041 G11 holds after liquidation");
    });
  });

  describe("INV-042: G11 — Removal + reactivation, implicit EB — G11 preserved", () => {
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
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-042 after removal");

      // Drain and liquidate (3 active ops)
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      cluster = await drainAndLiquidate(
        network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
        undefined, 3n,
      );

      // Reactivate
      await network.connect(clusterOwner).reactivate(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // G11 preserved: reactivation skips removed op
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-042 after reactivation");
    });
  });

  describe("INV-043: G11 — Removal + migration — G11 preserved (no prior EB)", () => {
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
      const cluster = await getCurrentClusterState(
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

      // Migrate SSV cluster to ETH (no prior EB → no deviation → G11 preserved)
      await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await assertG11Holds(newViews, provider, contractAddr, operatorIds[0], "INV-043 after migration");
    });
  });

  describe("INV-044: G11 — Shared operator removal + multiple EB updates — G11 holds", () => {
    it("Guard prevents stale data from two independent clusters on removed shared operator", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwnerA, clusterOwnerB] = signers;
      const contractAddr = await network.getAddress();

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      // Shared operator 1 + unique operators per cluster
      const opsA = await registerOperators(network, owner, 4); // [1,2,3,4]
      const extraOps: number[] = [];
      for (let i = 5; i <= 7; i++) {
        const expectedId = await network.connect(owner).registerOperator.staticCall(
          makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true,
        );
        await network.connect(owner).registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        extraOps.push(Number(expectedId));
      }
      const opsB = [opsA[0], ...extraOps]; // shared op1 + [5,6,7]

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

      // Remove shared operator 1
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

  describe("INV-045: G11 — Full lifecycle (EB → remove → liquidate) — guard prevents underflow", () => {
    it("Full lifecycle: EB → removal → liquidation succeeds (guard skips removed op)", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner, liquidator] = signers;
      const contractAddr = await network.getAddress();

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

      // Step 1: Set explicit EB
      cluster = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds, cluster, 48,
      );
      const vUnitsAfterEB = await readOperatorEthVUnits(provider, contractAddr, operatorIds[0]);
      const expectedDeviation = calcVUnits(48n) - defaultVUnits(1n); // 15000 - 10000 = 5000
      expect(vUnitsAfterEB).to.equal(expectedDeviation, "INV-045: exact deviation for op1 after EB update");

      // Step 2: Remove operator 1
      await network.connect(owner).removeOperator(BigInt(operatorIds[0]));
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-045 after removal");

      // Step 3: Drain and attempt liquidation
      const vUnits = calcVUnits(48n);
      await mineBlocks(provider, 50);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
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

      // Verify liquidated cluster state (validatorCount preserved in struct)
      expect(cluster.active).to.equal(false, "INV-045: liquidated cluster active == false");
      expect(BigInt(cluster.validatorCount)).to.equal(1n, "INV-045: liquidated cluster validatorCount preserved");

      // G11 holds after successful liquidation
      await assertG11Holds(views, provider, contractAddr, operatorIds[0], "INV-045 G11 holds after liquidation");
    });
  });

  // =========================================================================
  //  G12: No Deviation Without EB — INV-047
  // =========================================================================

  describe("INV-047: G12 — Normal operations without EB update keep clusterEB.vUnits == 0", () => {
    it("Register + deposit + withdraw without EB update → clusterEB.vUnits stays 0", async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, , , , , , clusterOwner] = signers;
      const contractAddr = await network.getAddress();

      const operatorIds = await registerOperators(network, owner, 4);
      await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

      // Register
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      // G12 after register
      let ebVUnits = await readClusterEBVUnits(provider, contractAddr, clusterId);
      expect(ebVUnits).to.equal(0n, "INV-047 after register: clusterEB.vUnits == 0");

      // Deposit
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: ethers.parseEther("5") },
      );

      ebVUnits = await readClusterEBVUnits(provider, contractAddr, clusterId);
      expect(ebVUnits).to.equal(0n, "INV-047 after deposit: clusterEB.vUnits == 0");

      // Advance blocks + withdraw
      await mineBlocks(provider, 100);
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const withdrawAmount = ethers.parseEther("1");
      const aligned = (withdrawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
      await network.connect(clusterOwner).withdraw(operatorIds, aligned, cluster);

      ebVUnits = await readClusterEBVUnits(provider, contractAddr, clusterId);
      expect(ebVUnits).to.equal(0n, "INV-047 after withdraw: clusterEB.vUnits == 0");

      // Verify getVUnits returns fallback (validatorCount * BPS_DENOMINATOR)
      // by checking daoTotalEthVUnits == ethDaoValidatorCount * BPS (no deviation)
      const daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      const valCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoVUnits).to.equal(valCount * BPS_DENOMINATOR, "INV-047: no deviation present");
    });
  });

  // =========================================================================
  //  Composite: INV-049, INV-050
  // =========================================================================

  describe("INV-049: G1+G4 — Mixed SSV/ETH operations verify conservation and vUnit consistency", () => {
    it("Register SSV + ETH clusters, migrate, EB update — G1 and G4 hold after each step", async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [clusterOwnerSSV, oracle1, oracle2, oracle3, oracle4, staker, clusterOwnerETH] = signers;

      // Register SSV operators (ops 1-4) and SSV cluster
      const OP_SSV_FEE = 10_000_000_000n;
      const ssvOperatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwnerSSV)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        await legacyNetwork.connect(clusterOwnerSSV)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
        ssvOperatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwnerSSV.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwnerSSV).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );
      await legacyNetwork.connect(clusterOwnerSSV).registerValidator(
        makePublicKey(1), ssvOperatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const ssvCluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwnerSSV.address, ssvOperatorIds,
      );

      // Upgrade to v2
      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );
      const contractAddr = await newNetwork.getAddress();
      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(newNetwork, ssvToken, staker, oracles);

      // Register ETH operators (ops 5-8) and ETH cluster
      const ethOperatorIds: number[] = [];
      for (let i = 5; i <= 8; i++) {
        const expectedId = await newNetwork.connect(clusterOwnerETH)
          .registerOperator.staticCall(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        await newNetwork.connect(clusterOwnerETH)
          .registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, true);
        ethOperatorIds.push(Number(expectedId));
      }
      await whitelistAddresses(newNetwork, clusterOwnerETH, ethOperatorIds, [clusterOwnerETH.address]);

      await newNetwork.connect(clusterOwnerETH).registerValidator(
        makePublicKey(10), ethOperatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Step 1 checkpoint: G4 — 1 ETH cluster with implicit EB
      let valCount = BigInt(await newViews.getNetworkValidatorsCount());
      expect(valCount).to.equal(1n, "Step 1: 1 ETH cluster");
      let daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(valCount * BPS_DENOMINATOR, "Step 1: G4 baseline");

      // G1: contract ETH balance == exactly the deposit from registration
      const ethBalance1 = BigInt(await provider.getBalance(contractAddr));
      expect(ethBalance1).to.equal(DEFAULT_ETH_REGISTER_VALUE, "Step 1: G1 exact contract ETH balance");

      // Step 2: Migrate SSV cluster to ETH
      await newNetwork.connect(clusterOwnerSSV).migrateClusterToETH(
        ssvOperatorIds, ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // G4: now 2 ETH clusters, both implicit EB
      valCount = BigInt(await newViews.getNetworkValidatorsCount());
      expect(valCount).to.equal(2n, "Step 2: 2 ETH clusters after migration");
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(valCount * BPS_DENOMINATOR, "Step 2: G4 baseline (no EB set)");

      // G1: contract ETH balance increased by exactly the migration deposit
      const ethBalance2 = BigInt(await provider.getBalance(contractAddr));
      expect(ethBalance2).to.equal(ethBalance1 + DEFAULT_ETH_REGISTER_VALUE, "Step 2: G1 exact balance after migration");

      // Step 3: EB update on ETH cluster (EB=48)
      let ethCluster = await getCurrentClusterState(
        connection, newNetwork, clusterOwnerETH.address, ethOperatorIds,
      );
      ethCluster = await performEBUpdate(
        connection, newNetwork, oracles, provider, clusterOwnerETH, ethOperatorIds, ethCluster, 48,
      );

      // G4: daoTotalEthVUnits == valCount * BPS + deviation from ETH cluster
      const expectedVUnits = calcVUnits(48n); // 15000
      const deviationETH = expectedVUnits - 1n * BPS_DENOMINATOR; // 5000
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(
        valCount * BPS_DENOMINATOR + deviationETH,
        "Step 3: G4 with EB deviation",
      );

      // G1 still holds: contract balance unchanged by EB update
      const ethBalance3 = BigInt(await provider.getBalance(contractAddr));
      expect(ethBalance3).to.equal(ethBalance2, "Step 3: G1 unchanged by EB update");
    });
  });

  describe("INV-050: Full lifecycle multi-invariant stress test (G1+G3+G4+G10+G11)", () => {
    it("3 clusters across register, EB, removal, liquidation, reactivation — verify all invariants", async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, ownerA, ownerB, ownerC, liquidator] = signers;
      const contractAddr = await network.getAddress();

      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      const oracles = [oracle1, oracle2, oracle3, oracle4];
      await setupOracles(network, ssvToken, staker, oracles);

      // Register 3 operator sets (12 total)
      const ops1 = await registerOperators(network, owner, 4);
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

      // G3: 3 validators
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 1: G3 = 3");

      // G4: implicit EB → daoTotalEthVUnits == 3 * 10000 = 30000
      let daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(3n * BPS_DENOMINATOR, "Step 1: G4 baseline");

      // G1: contract balance == 30 ETH
      let contractBal = BigInt(await provider.getBalance(contractAddr));
      expect(contractBal).to.equal(DEFAULT_ETH_REGISTER_VALUE * 3n, "Step 1: G1 = 30 ETH");

      // Step 2: EB update on cluster A (EB=48)
      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        connection, network, oracles, provider, ownerA, ops1, clusterA, 48,
      );

      const vUnitsA = calcVUnits(48n); // 15000
      const deviationA = vUnitsA - BPS_DENOMINATOR; // 5000
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(3n * BPS_DENOMINATOR + deviationA, "Step 2: G4 with deviation");

      // Step 3: Remove operator 2 from cluster A's set
      await network.connect(owner).removeOperator(BigInt(ops1[1]));
      await assertG11Holds(views, provider, contractAddr, ops1[1], "Step 3: G11 holds after removal");

      // G3 unchanged
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 3: G3 unchanged");

      // Step 4: Liquidate cluster B
      clusterB = await getCurrentClusterState(connection, network, ownerB.address, ops2);
      clusterB = await drainAndLiquidate(network, views, provider, ownerB, liquidator, ops2, clusterB);

      // Verify liquidated cluster B state (validatorCount preserved in struct)
      expect(clusterB.active).to.equal(false, "Step 4: liquidated clusterB active == false");
      expect(BigInt(clusterB.validatorCount)).to.equal(1n, "Step 4: liquidated clusterB validatorCount preserved");

      // G3: decremented by 1
      expect(await views.getNetworkValidatorsCount()).to.equal(2n, "Step 4: G3 = 2 after liquidation");

      // G10: ops2 operators should have ethValidatorCount = 0
      for (const opId of ops2) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(0n, `Step 4: G10 op ${opId} = 0`);
      }

      // G4: baseline decreased by 1 validator (10000)
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(2n * BPS_DENOMINATOR + deviationA, "Step 4: G4 after liquidation");

      // Step 5: Reactivate cluster B
      clusterB = await getCurrentClusterState(connection, network, ownerB.address, ops2);
      await network.connect(ownerB).reactivate(ops2, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE });

      // G3: back to 3
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 5: G3 = 3 after reactivation");

      // G10: ops2 operators back to ethValidatorCount = 1
      for (const opId of ops2) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1n, `Step 5: G10 op ${opId} = 1`);
      }

      // G4: baseline back to 3 + deviationA
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(3n * BPS_DENOMINATOR + deviationA, "Step 5: G4 restored");

      // Step 6: EB update on cluster A again (with removed op2) — G11 violation
      await mineBlocks(provider, 5);
      clusterA = await getCurrentClusterState(connection, network, ownerA.address, ops1);
      clusterA = await performEBUpdate(
        connection, network, oracles, provider, ownerA, ops1, clusterA, 64,
      );

      // G11 holds: guard skips removed op during EB update
      await assertG11Holds(views, provider, contractAddr, ops1[1], "Step 6: G11 holds after EB update");

      // G3 still 3
      expect(await views.getNetworkValidatorsCount()).to.equal(3n, "Step 6: G3 = 3");

      // G4: new deviation from EB=64
      const vUnitsA2 = calcVUnits(64n); // ceil(64*10000/32) = 20000
      const deviationA2 = vUnitsA2 - BPS_DENOMINATOR; // 10000
      daoVUnits = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnits).to.equal(3n * BPS_DENOMINATOR + deviationA2, "Step 6: G4 with updated deviation");
    });
  });
});
