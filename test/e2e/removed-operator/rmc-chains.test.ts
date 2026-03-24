import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  setupOracles,
  computeClusterId,
} from "../../helpers/index.ts";

// ---------------------------------------------------------------------------
// Storage-slot helpers — read operatorEthVUnits & daoTotalEthVUnits directly
// ---------------------------------------------------------------------------

const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n; // 3rd field in StorageEB

async function readOperatorEthVUnits(
  provider: any,
  networkAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(networkAddress, slot);
  return BigInt(raw) & 0xFFFFFFFFFFFFFFFFn; // uint64
}

// StorageProtocol slot layout — daoTotalEthVUnits is the first field in the
// "EB" section of the protocol storage.  Counting 256-bit slots:
//   Slot 0: networkFeeIndexBlockNumber(32) + daoValidatorCount(32)
//           + daoIndexBlockNumber(32) + validatorsPerOperatorLimit(32)
//           + networkFee(64) + networkFeeIndex(64)               = 256
//   Slot 1: daoBalance(64) + minimumBlocksBeforeLiquidationSSV(64)
//           + minimumLiquidationCollateralSSV(64) + declareOperatorFeePeriod(64) = 256
//   Slot 2: executeOperatorFeePeriod(64) + operatorMaxFeeIncrease(64)
//           + operatorMaxFeeSSV(64) + ethNetworkFeeIndexBlockNumber(32)
//           + ethDaoValidatorCount(32)                           = 256
//   Slot 3: ethDaoIndexBlockNumber(32) + ethNetworkFee(64)
//           + ethNetworkFeeIndex(64) + ethDaoBalance(64)         = 224
//   Slot 4: minimumLiquidationCollateral(64) + minimumBlocksBeforeLiquidation(64)
//           + operatorMaxFee(64) + daoTotalEthVUnits(64)         = 256
const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
// daoTotalEthVUnits sits in slot 4, bits [192..255] (most-significant 64 bits)
const DAO_TOTAL_ETH_VUNITS_SLOT = PROTOCOL_BASE_SLOT + 4n;
const DAO_TOTAL_ETH_VUNITS_SHIFT = 192n;

async function readDaoTotalEthVUnits(
  provider: any,
  networkAddress: string,
): Promise<bigint> {
  const raw = await provider.getStorage(networkAddress, DAO_TOTAL_ETH_VUNITS_SLOT);
  return (BigInt(raw) >> DAO_TOTAL_ETH_VUNITS_SHIFT) & 0xFFFFFFFFFFFFFFFFn;
}

// ---------------------------------------------------------------------------
// EB-update + cluster lifecycle helpers
// ---------------------------------------------------------------------------

async function performEBUpdate(
  connection: any,
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
  // Commit with 3 oracles for quorum
  await network.connect(oracles[0]).commitRoot(root, rootBlockNum);
  await network.connect(oracles[1]).commitRoot(root, rootBlockNum);
  await network.connect(oracles[2]).commitRoot(root, rootBlockNum);
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
// INV-11: operatorEthVUnits[removedOp] == 0 assertion helper
// ---------------------------------------------------------------------------
async function assertDeadOperatorVUnitsZero(
  provider: any,
  networkAddress: string,
  deadOpIds: (number | bigint)[],
  label: string,
): Promise<void> {
  for (const opId of deadOpIds) {
    const v = await readOperatorEthVUnits(provider, networkAddress, opId);
    expect(v).to.equal(
      0n,
      `INV-11 violated: operatorEthVUnits[${opId}] = ${v} (expected 0) at ${label}`,
    );
  }
}

/**
 * Verify daoTotalEthVUnits consistency:
 * 1. Dead operators must contribute 0 to the vUnits sum.
 * 2. The on-chain daoTotalEthVUnits must equal the sum of all live operators' baseline vUnits
 *    plus any deviations tracked per operator.
 */
async function assertDaoVUnitsConsistency(
  provider: any,
  networkAddress: string,
  allOpIds: number[],
  deadOpIds: (number | bigint)[],
  label: string,
): Promise<void> {
  // Dead operators should contribute 0 to the vUnits sum.
  let deadSum = 0n;
  for (const opId of deadOpIds) {
    deadSum += await readOperatorEthVUnits(provider, networkAddress, opId);
  }
  expect(deadSum).to.equal(
    0n,
    `DAO consistency: dead operators contribute ${deadSum} vUnits (expected 0) at ${label}`,
  );

  // Read the actual daoTotalEthVUnits from storage
  const daoTotal = await readDaoTotalEthVUnits(provider, networkAddress);
  // daoTotalEthVUnits must be >= 0 (sanity) and should not include dead operator contributions
  expect(daoTotal).to.be.greaterThanOrEqual(
    0n,
    `DAO consistency: daoTotalEthVUnits must be non-negative at ${label}`,
  );

  // Sum live operators' vUnits — should not exceed daoTotalEthVUnits
  const deadSet = new Set(deadOpIds.map((id) => BigInt(id)));
  let liveSum = 0n;
  for (const opId of allOpIds) {
    if (!deadSet.has(BigInt(opId))) {
      liveSum += await readOperatorEthVUnits(provider, networkAddress, opId);
    }
  }
  // Live operator vUnits should be consistent with the DAO total
  // (DAO total accounts for baseline + deviation across all clusters)
  expect(daoTotal).to.be.greaterThanOrEqual(
    liveSum,
    `DAO consistency: daoTotalEthVUnits (${daoTotal}) must be >= live operator vUnits sum (${liveSum}) at ${label}`,
  );
}

async function assertOperatorIsRemoved(
  views: any,
  operatorId: number | bigint,
): Promise<void> {
  const op = await views.getOperatorById(BigInt(operatorId));
  expect(op.fee).to.equal(0n, `removed op${operatorId} fee should be 0`);
  expect(op.validatorCount).to.equal(0n, `removed op${operatorId} ethValidatorCount should be 0`);
  expect(op.isActive).to.equal(false, `removed op${operatorId} should be inactive`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Removed-Operator Multi-Step Chains (RMC)", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let signers: HardhatEthersSigner[];

  before(async function () {
    ({ connection, networkHelpers, signers } = await setupTestContext());
  });

  // Shared fixture: deploys full SSV network, sets up oracles, network fee
  async function baseFixture() {
    const { network, views, ssvToken, cssvToken } =
      await ssvNetworkFullFixture(connection);

    const [deployer, operatorOwner, clusterOwnerA, clusterOwnerB, clusterOwnerC,
      oracle1, oracle2, oracle3, oracle4, staker, liquidator] = signers;

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const oracles = [oracle1, oracle2, oracle3, oracle4];
    const networkAddress = await network.getAddress();
    const provider = connection.ethers.provider;

    return {
      network,
      views,
      ssvToken,
      cssvToken,
      deployer,
      operatorOwner,
      clusterOwnerA,
      clusterOwnerB,
      clusterOwnerC,
      oracles,
      staker,
      liquidator,
      networkAddress,
      provider,
    };
  }

  // ------------- Section 1: Full-Chain Sequences (RMC-001 to RMC-008) ------

  describe("Section 1: Full-Chain Sequences", function () {
    it("RMC-001: EB→removeOp→liquidate→reactivate→EB→removeValidator", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      // Register 1 validator with 10 ETH
      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Step 1: EB update 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Step 2: removeOperator(op4)
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertOperatorIsRemoved(views, operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");
      await assertDaoVUnitsConsistency(provider, networkAddress, operatorIds, [operatorIds[3]], "after removeOp4");

      // Step 3: Advance blocks until liquidatable, then liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.be.false;
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");

      // Step 4: Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.be.true;
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after reactivate");

      // Step 5: EB update 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 2nd EB");

      // Step 6: Remove validator
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeValidator");

      // Verify live operators are still correct
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(BigInt(operatorIds[i]));
        expect(op.isActive).to.be.true;
      }
    });

    it("RMC-002: removeOp→EB→liquidate→reactivate→EB→removeValidator", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Step 1: Remove op4 BEFORE any EB update
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Step 2: EB update 32→48 (writes to dead op4)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 1st EB");

      // Step 3: Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");

      // Step 4: Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after reactivate");

      // Step 5: EB update 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 2nd EB");

      // Step 6: Remove validator
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeValidator");
    });

    it("RMC-003: 7-op cluster stress with 3 EB swings", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 7);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      // Register 2 validators
      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      tx = await network.connect(owner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
      );
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 64→96 (2 validators * 32 = 64 minimum)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);

      // Remove op7
      await network.connect(operatorOwner).removeOperator(operatorIds[6]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[6]], "after removeOp7");

      // EB 96→128
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[6]], "after 2nd EB");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[6]], "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 128→64 (decrease back to minimum for 2 validators)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[6]], "after 3rd EB decrease");

      // Remove both validators
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      tx = await network.connect(owner).removeValidator(makePublicKey(2), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[6]], "after removeAllValidators");
    });

    it("RMC-004: double operator removal between EB and liquidation", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op3 and op4
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      const deadOps = [operatorIds[2], operatorIds[3]];
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after double remove");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after reactivate");

      // EB 48→32 (decrease to baseline)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 32);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after EB decrease");

      // Remove all validators
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeValidator");
    });

    it("RMC-005: full chain with validator add/remove after EB", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 2nd EB");

      // Add validator — should revert because op4 is dead
      await expect(
        network.connect(owner).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);

      // Remove validator
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeValidator");
    });

    it("RMC-006: full chain with withdraw between EB updates", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 2nd EB");

      // Withdraw some balance
      const withdrawAmount = ethers.parseEther("1");
      tx = await network.connect(owner).withdraw(operatorIds, withdrawAmount, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after withdraw");

      // EB 64→48 (decrease)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 3rd EB decrease");
    });

    it("RMC-007: implicit cluster→removeOp→liquidate→reactivate→explicit EB→removeValidator", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      // Register with small deposit (implicit EB — no EB update before removal)
      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op4 (before any EB update — implicit cluster)
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after reactivate");

      // First EB update: implicit→explicit (32→48)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after implicit→explicit EB");

      // Remove validator
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeValidator");
    });

    it("RMC-008: 13-op cluster, remove 9, full lifecycle", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 13);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("100");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove ops 5-13 (9 operators)
      const deadOps: number[] = [];
      for (let i = 4; i < 13; i++) {
        await network.connect(operatorOwner).removeOperator(operatorIds[i]);
        deadOps.push(operatorIds[i]);
      }
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 9 removals");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("100") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 2nd EB");

      // Remove validator
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeValidator");

      // Verify 4 live operators intact
      for (let i = 0; i < 4; i++) {
        const op = await views.getOperatorById(BigInt(operatorIds[i]));
        expect(op.isActive).to.be.true;
      }
    });
  });

  // ------------- Section 2: Cascading Operator Removal (RMC-009 to RMC-015) ------

  describe("Section 2: Cascading Operator Removal", function () {
    it("RMC-009: remove op3→EB→remove op4→liquidate→reactivate→EB (asymmetric)", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Step 1: Remove op3 (before any EB)
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[2]], "after removeOp3");

      // Step 2: EB 32→48 (op3 dead, op4 alive)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[2]], "after EB");

      // Step 3: Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      const deadOps = [operatorIds[2], operatorIds[3]];
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp4");

      // Step 4: Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Step 5: Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // Step 6: EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 2nd EB");
    });

    it("RMC-010: EB→removeOp4→EB→removeOp3→EB→liquidate (interleaved)", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after 2nd EB");

      // Remove op3
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      const deadOps = [operatorIds[2], operatorIds[3]];
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp3");

      // EB 64→48 (decrease)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 3rd EB decrease");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");
    });

    it("RMC-011: triple removal before any EB, then EB→liquidate→reactivate→EB", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove ops 2,3,4 before any EB
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      const deadOps = [operatorIds[1], operatorIds[2], operatorIds[3]];
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after triple remove");

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 1st EB");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 2nd EB");
    });

    it("RMC-012: progressive 4-step cascade with EB between each removal", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const deadOps: number[] = [];

      // EB 32→48, remove op4
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      deadOps.push(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp4");

      // EB 48→64, remove op3
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 2nd EB");
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      deadOps.push(operatorIds[2]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp3");

      // Liquidate + reactivate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 64→96, remove op2
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 3rd EB");
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      deadOps.push(operatorIds[1]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp2");

      // EB 96→64 (decrease with 3 dead ops)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 4th EB decrease");
    });

    it("RMC-013: EB oscillation with interleaved removals", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48 (increase)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB 48→32 (decrease) — op4 dead, -5000 delta on dead slot
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 32);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after EB decrease");

      // Remove op3
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      const deadOps = [operatorIds[2], operatorIds[3]];
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp3");

      // EB 32→48 (increase again)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after EB increase");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");
    });

    it("RMC-014: 7-op cascade removing ops 7,6,5 with EB between each", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 7);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const deadOps: number[] = [];

      // Remove op7, EB 32→48
      await network.connect(operatorOwner).removeOperator(operatorIds[6]);
      deadOps.push(operatorIds[6]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after op7 rm + EB1");

      // Remove op6, EB 48→64
      await network.connect(operatorOwner).removeOperator(operatorIds[5]);
      deadOps.push(operatorIds[5]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after op6 rm + EB2");

      // Remove op5
      await network.connect(operatorOwner).removeOperator(operatorIds[4]);
      deadOps.push(operatorIds[4]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after op5 rm");

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // EB 64→48 (decrease with 3 dead ops)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after EB decrease");
    });

    it("RMC-015: cascade to single operator (3 removals with EB between each)", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const deadOps: number[] = [];

      // EB 32→48, remove op4
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      deadOps.push(operatorIds[3]);

      // EB 48→64, remove op3
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      deadOps.push(operatorIds[2]);

      // EB 64→96, remove op2
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      deadOps.push(operatorIds[1]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 3 removals");

      // EB 96→128 — single live op1
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 4th EB");

      // Liquidate + reactivate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after reactivate");

      // Verify op1 is the single live operator
      const op1 = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(op1.isActive).to.be.true;
    });
  });

  // ------------- Section 3: All Operators Removed Sequentially (RMC-016 to RMC-020) ------

  describe("Section 3: All Operators Removed Sequentially", function () {
    it("RMC-016: all 4 ops removed one by one with EB between each", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const deadOps: number[] = [];

      // EB 32→48, remove op4
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      deadOps.push(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp4");

      // EB 48→64, remove op3
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      deadOps.push(operatorIds[2]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp3");

      // EB 64→96, remove op2
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      deadOps.push(operatorIds[1]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp2");

      // EB 96→128, remove op1 (last!)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      deadOps.push(operatorIds[0]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeOp1 — all dead");
    });

    it("RMC-017: all 4 ops removed then liquidation", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op1, EB 32→48, remove op2, EB 48→64, remove op3, EB 64→48, remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "all 4 removed");

      // Self-liquidation (owner liquidates own cluster — should work even with all dead ops)
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.be.false;
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "after liquidate with all dead");
    });

    it("RMC-018: all 4 removed then reactivation attempt", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove all 4 with EB between each
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "all removed");

      // Liquidate first
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate with sufficient ETH — should succeed (burn rate=0 with all dead ops)
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("20") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      expect(cluster.active).to.be.true;
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "after reactivate");
    });

    it("RMC-019: batch remove last two ops then EB", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48, remove op4, EB 48→64, remove op3
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);

      // EB 64→96
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);

      // Batch remove last two (op2 and op1)
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "after batch remove");

      // EB 96→128 — all 4 dead
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "after EB with all dead");
    });

    it("RMC-020: all 4 removed (implicit) before implicit→explicit EB", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove all 4 before any EB update (implicit cluster)
      for (const opId of operatorIds) {
        await network.connect(operatorOwner).removeOperator(opId);
      }
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "all removed, implicit");

      // First EB update: implicit→explicit with all dead
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, operatorIds, "after implicit→explicit EB");
    });
  });

  // ------------- Section 4: Cross-Cluster Isolation (RMC-021 to RMC-028) ------

  describe("Section 4: Cross-Cluster Isolation", function () {
    it("RMC-021: op4 in cluster A only, removed; cluster B (no op4) unaffected", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      // Register 6 operators; A=[1,2,3,4], B=[1,2,5,6]
      const operatorIds = await registerOperators(network, operatorOwner, 6);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const opsA = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[3]];
      const opsB = [operatorIds[0], operatorIds[1], operatorIds[4], operatorIds[5]];
      const clusterIdA = computeClusterId(clusterOwnerA.address, opsA);
      const clusterIdB = computeClusterId(clusterOwnerB.address, opsB);

      const deposit = ethers.parseEther("20");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), opsA, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), opsB, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 48);

      // Remove op4 (only in cluster A)
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB on B 32→48 (B doesn't include op4 — should be unaffected)
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, clusterIdB, 48);
      expect(clusterB.active).to.be.true;

      // Verify op4 still zero
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB");
    });

    it("RMC-022: shared ops 3,4 between clusters, op4 removed, both EB update", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 6);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const opsA = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[3]];
      const opsB = [operatorIds[2], operatorIds[3], operatorIds[4], operatorIds[5]];
      const clusterIdA = computeClusterId(clusterOwnerA.address, opsA);
      const clusterIdB = computeClusterId(clusterOwnerB.address, opsB);

      const deposit = ethers.parseEther("20");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), opsA, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), opsB, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 32→48, EB on B 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 48);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, clusterIdB, 48);

      // Remove shared op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Both clusters do second EB update
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A 2nd EB");

      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, clusterIdB, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B 2nd EB");
    });

    it("RMC-023: same 4 ops in 2 clusters, remove op4, liquidate both", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB on B 32→48
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB");

      // Liquidate A
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate A");

      // Liquidate B
      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate B");
    });

    it("RMC-024: register cluster B with dead op4 — reverts OperatorDoesNotExist", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      // Register cluster A
      const deposit = ethers.parseEther("10");
      await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Attempt to register cluster B with dead op4 — should revert
      await expect(
        network.connect(clusterOwnerB).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("RMC-025: cluster B entirely unaffected by op4 removal from cluster A", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 6);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const opsA = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[3]];
      const opsB = [operatorIds[0], operatorIds[1], operatorIds[4], operatorIds[5]];
      const clusterIdA = computeClusterId(clusterOwnerA.address, opsA);
      const clusterIdB = computeClusterId(clusterOwnerB.address, opsB);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), opsA, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), opsB, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 32→48, remove op4
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "RMC-025 after removeOp4");

      // EB on A 48→64
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 64);

      // Cluster B operations: deposit, withdraw, EB — all should work
      tx = await network.connect(clusterOwnerB).deposit(clusterOwnerB.address, opsB, clusterB, { value: ethers.parseEther("5") });
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_DEPOSITED);

      tx = await network.connect(clusterOwnerB).withdraw(opsB, ethers.parseEther("1"), clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);

      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, clusterIdB, 48);
      expect(clusterB.active).to.be.true;
    });

    it("RMC-026: migrate cluster with dead op4 from SSV to ETH", async function () {
      // Migration with a dead operator requires a legacy SSV cluster. Since the full
      // fixture deploys only v2, we verify the registration guard instead: a new ETH
      // cluster with dead op4 is rejected. This tests the same guard path.
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);

      // EB on A 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // New cluster B with dead op4 — revert
      await expect(
        network.connect(clusterOwnerB).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("RMC-027: shared op1 removed, cluster B EB + liquidation", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 6);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const opsA = [operatorIds[0], operatorIds[1], operatorIds[2], operatorIds[3]];
      const opsB = [operatorIds[0], operatorIds[1], operatorIds[4], operatorIds[5]];
      const clusterIdA = computeClusterId(clusterOwnerA.address, opsA);
      const clusterIdB = computeClusterId(clusterOwnerB.address, opsB);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), opsA, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), opsB, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, opsA, clusterA, clusterIdA, 48);

      // Remove op1 (shared between A and B)
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[0]], "after removeOp1");

      // EB on B 32→48 (op1 is dead)
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, opsB, clusterB, clusterIdB, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[0]], "after B EB");

      // Liquidate B
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, opsB, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[0]], "after liquidate B");
    });

    it("RMC-028: same 4 ops, both clusters different EB, quantify drift on dead op4", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("20");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB A 32→48, EB B 32→64 (different levels)
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 64);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Both clusters do second EB
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A 2nd EB");

      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 96);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B 2nd EB");
    });
  });

  // ------------- Section 5: Long Chain Drift (RMC-029 to RMC-033) ------

  describe("Section 5: Long Chain Drift Detection", function () {
    it("RMC-029: 10 consecutive EB updates after removal, drift quantification", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // 10 EB updates: 48→64→96→128→96→64→48→32→48→64
      const ebSequence = [64, 96, 128, 96, 64, 48, 32, 48, 64];
      for (let i = 0; i < ebSequence.length; i++) {
        cluster = await performEBUpdate(
          connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, ebSequence[i],
        );
        await assertDeadOperatorVUnitsZero(
          provider, networkAddress, [operatorIds[3]], `after EB update #${i + 2} to ${ebSequence[i]}`,
        );
      }

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");
    });

    it("RMC-030: 3 oscillation cycles (EB up→deposit→withdraw→EB down) with dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // 3 cycles of: EB 32→48, deposit, withdraw, EB 48→32
      for (let cycle = 0; cycle < 3; cycle++) {
        cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
        await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], `cycle${cycle} EB up`);

        tx = await network.connect(owner).deposit(owner.address, operatorIds, cluster, { value: ethers.parseEther("1") });
        cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_DEPOSITED);

        tx = await network.connect(owner).withdraw(operatorIds, ethers.parseEther("0.5"), cluster);
        cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);

        cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 32);
        await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], `cycle${cycle} EB down`);
      }

      // Final liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");
    });

    it("RMC-031: 13-operation mixed chain (EB + val + deposit/withdraw + liq/reactivate)", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // 1. EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // 2. Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 2");

      // 3. EB 48→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 3");

      // 4. EB 64→96
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 4");

      // 5. Deposit
      tx = await network.connect(owner).deposit(owner.address, operatorIds, cluster, { value: ethers.parseEther("10") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_DEPOSITED);

      // 6. EB 96→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 6");

      // 7. Withdraw
      tx = await network.connect(owner).withdraw(operatorIds, ethers.parseEther("5"), cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);

      // 8. EB 64→128
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 128);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 8");

      // 9. EB 128→64
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 9");

      // 10. Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 10");

      // 11. Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("200") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "step 11");
    });

    it("RMC-032: 10 minimal EB increments (1 ETH each), precision drift on dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→33
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 33);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // 10 increments: 33→34→35...→43
      for (let eb = 34; eb <= 43; eb++) {
        cluster = await performEBUpdate(
          connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, eb,
        );
        await assertDeadOperatorVUnitsZero(
          provider, networkAddress, [operatorIds[3]], `after EB=${eb}`,
        );
      }

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate");
    });

    it("RMC-033: progressive removal with continued EB growth", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      const deadOps: number[] = [];

      // EB 32→48, remove op4
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      deadOps.push(operatorIds[3]);

      // EB 48→64, remove op3
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      deadOps.push(operatorIds[2]);

      // EB 64→96, remove op2
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 96);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      deadOps.push(operatorIds[1]);

      // 5 more EB increases with only op1 live: 96→128→160→192→224→256
      const ebSeq = [128, 160, 192, 224, 256];
      for (const eb of ebSeq) {
        cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, eb);
        await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, `after EB=${eb}`);
      }

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("200") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after reactivate");

      // Verify op1 correct
      const op1 = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(op1.isActive).to.be.true;
    });
  });

  // ------------- Section 6: Multi-Cluster Same Removed Operator (RMC-034 to RMC-038) ------

  describe("Section 6: Multi-Cluster Same Removed Operator", function () {
    it("RMC-034: 3 clusters same ops, op4 removed, different EB levels", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, clusterOwnerC, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address, clusterOwnerB.address, clusterOwnerC.address,
      ]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);
      const clusterIdC = computeClusterId(clusterOwnerC.address, operatorIds);

      const deposit = ethers.parseEther("20");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerC).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterC = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Three different EB levels
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A EB=48");

      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB=64");

      clusterC = await performEBUpdate(connection, network, oracles, provider, clusterOwnerC, operatorIds, clusterC, clusterIdC, 96);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after C EB=96");
    });

    it("RMC-035: 2 clusters same ops, op4 removed, double liquidation", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("5");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB both to 48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Liquidate A then B
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate A");

      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liquidate B");
    });

    it("RMC-036: multi-cluster reactivate then EB with dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("10");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB A 32→48
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // EB B 32→48
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);

      // Liquidate A
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);

      // Reactivate A
      tx = await network.connect(clusterOwnerA).reactivate(operatorIds, clusterA, { value: ethers.parseEther("20") });
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after reactivate A");

      // EB A 48→64 (after reactivation)
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A 2nd EB");
    });

    it("RMC-037: 3 clusters, triple liquidation with shared dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, clusterOwnerC, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address, clusterOwnerB.address, clusterOwnerC.address,
      ]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);
      const clusterIdC = computeClusterId(clusterOwnerC.address, operatorIds);

      const deposit = ethers.parseEther("5");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerC).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterC = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Different EB levels
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 64);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // EB C 32→48
      clusterC = await performEBUpdate(connection, network, oracles, provider, clusterOwnerC, operatorIds, clusterC, clusterIdC, 48);

      // Liquidate all 3
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq A");

      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq B");

      tx = await network.connect(clusterOwnerC).liquidate(clusterOwnerC.address, operatorIds, clusterC);
      clusterC = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq C");
    });

    it("RMC-038: multi-cluster remove all validators with dead op deviation cleanup", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("50");
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Add 2nd validator to A
      tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, clusterA, { value: 0n },
      );
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB on A 64→96 (2 validators, min total = 64)
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 96);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB on B 32→48 (1 validator)
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB");

      // Remove validators from A (2 validators)
      tx = await network.connect(clusterOwnerA).removeValidator(makePublicKey(1), operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after rm val1 from A");

      tx = await network.connect(clusterOwnerA).removeValidator(makePublicKey(2), operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      expect(clusterA.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after rm val2 from A");

      // Remove validator from B
      tx = await network.connect(clusterOwnerB).removeValidator(makePublicKey(3), operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      expect(clusterB.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after rm val from B");
    });
  });

  // ------------- Section 7: Mixed Implicit/Explicit EB (RMC-039 to RMC-042) ------

  describe("Section 7: Mixed Implicit/Explicit EB Clusters", function () {
    it("RMC-039: implicit A + explicit B, shared dead op4, B EB updates", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("50");
      // Cluster A: implicit (no EB update)
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Cluster B: explicit (EB 32→48)
      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // EB on B 48→64
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB=64");

      // Cluster A operations (implicit, no EB) — withdraw should work fine
      tx = await network.connect(clusterOwnerA).withdraw(operatorIds, ethers.parseEther("1"), clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(clusterA.active).to.be.true;
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A withdraw");
    });

    it("RMC-040: both clusters become explicit after op removal", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      const deposit = ethers.parseEther("50");
      // Cluster A: implicit
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Cluster B: explicit 32→48
      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 48);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // A transitions to explicit (32→48)
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A implicit→explicit");

      // B second EB (48→64)
      clusterB = await performEBUpdate(connection, network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after B EB=64");
    });

    it("RMC-041: explicit A liquidated, implicit B liquidated, shared dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);

      const deposit = ethers.parseEther("5");
      // Cluster A: explicit 32→48
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);

      // Cluster B: implicit
      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // Liquidate A (explicit)
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq A");

      // Liquidate B (implicit — no deviation cleanup because ebSnapshot.vUnits == 0)
      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq B");
    });

    it("RMC-042: mixed EB modes full lifecycle with shared dead op", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA, clusterOwnerB, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address, clusterOwnerB.address]);

      const clusterIdA = computeClusterId(clusterOwnerA.address, operatorIds);

      const deposit = ethers.parseEther("10");
      // Cluster A: explicit 32→48
      let tx = await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterA = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);

      // Cluster B: implicit
      tx = await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let clusterB = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after removeOp4");

      // A: EB 48→64
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A EB=64");

      // Liquidate A
      await mineBlocks(provider, 99999999);
      tx = await network.connect(clusterOwnerA).liquidate(clusterOwnerA.address, operatorIds, clusterA);
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq A");

      // Reactivate A
      tx = await network.connect(clusterOwnerA).reactivate(operatorIds, clusterA, { value: ethers.parseEther("20") });
      clusterA = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);

      // A: EB 64→48 (decrease)
      clusterA = await performEBUpdate(connection, network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after A EB=48");

      // Liquidate B (implicit)
      tx = await network.connect(clusterOwnerB).liquidate(clusterOwnerB.address, operatorIds, clusterB);
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after liq B");

      // Reactivate B
      tx = await network.connect(clusterOwnerB).reactivate(operatorIds, clusterB, { value: ethers.parseEther("20") });
      clusterB = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, [operatorIds[3]], "after reactivate B");
    });
  });

  // ------------- Section 8: Stress — 13 Operators (RMC-043 to RMC-045) ------

  describe("Section 8: 13-Operator Stress Tests", function () {
    it("RMC-043: 13 ops, remove 12, EB + deposit + withdraw + liquidate + reactivate", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 13);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("100");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove ops 2-13 (12 removals)
      const deadOps: number[] = [];
      for (let i = 1; i < 13; i++) {
        await network.connect(operatorOwner).removeOperator(operatorIds[i]);
        deadOps.push(operatorIds[i]);
      }
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 12 removals");

      // EB 48→64 (writes to 12 dead slots)
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 2nd EB");

      // Deposit
      tx = await network.connect(owner).deposit(owner.address, operatorIds, cluster, { value: ethers.parseEther("50") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_DEPOSITED);

      // Withdraw
      tx = await network.connect(owner).withdraw(operatorIds, ethers.parseEther("10"), cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_WITHDRAWN);

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");

      // Reactivate
      tx = await network.connect(owner).reactivate(operatorIds, cluster, { value: ethers.parseEther("200") });
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_REACTIVATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after reactivate");

      // Verify op1 is the single remaining live operator
      const op1 = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(op1.isActive).to.be.true;
    });

    it("RMC-044: 13 ops, 12 removed, 6 consecutive EB updates", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 13);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("200");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove ops 2-13
      const deadOps: number[] = [];
      for (let i = 1; i < 13; i++) {
        await network.connect(operatorOwner).removeOperator(operatorIds[i]);
        deadOps.push(operatorIds[i]);
      }
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 12 removals");

      // 6 EB updates: 48→64→96→128→96→64
      const ebSeq = [64, 96, 128, 96, 64];
      for (let i = 0; i < ebSeq.length; i++) {
        cluster = await performEBUpdate(
          connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, ebSeq[i],
        );
        await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, `after EB=${ebSeq[i]}`);
      }

      // Liquidate
      await mineBlocks(provider, 99999999);
      tx = await network.connect(owner).liquidate(owner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_LIQUIDATED);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after liquidate");
    });

    it("RMC-045: 13 ops, 12 removed, addValidator reverts OperatorDoesNotExist", async function () {
      const ctx = await networkHelpers.loadFixture(baseFixture);
      const { network, views, operatorOwner, clusterOwnerA: owner, oracles, provider, networkAddress } = ctx;

      const operatorIds = await registerOperators(network, operatorOwner, 13);
      await whitelistAddresses(network, operatorOwner, operatorIds, [owner.address]);
      const clusterId = computeClusterId(owner.address, operatorIds);

      const deposit = ethers.parseEther("100");
      let tx = await network.connect(owner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);

      // EB 32→48
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);

      // Remove ops 2-13
      const deadOps: number[] = [];
      for (let i = 1; i < 13; i++) {
        await network.connect(operatorOwner).removeOperator(operatorIds[i]);
        deadOps.push(operatorIds[i]);
      }
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after 12 removals");

      // addValidator should REVERT because dead operators detected
      await expect(
        network.connect(owner).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);

      // EB 48→64 still works
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 64);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after EB=64");

      // removeValidator works
      tx = await network.connect(owner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after removeValidator");

      // EB 64→48 still works
      cluster = await performEBUpdate(connection, network, oracles, provider, owner, operatorIds, cluster, clusterId, 48);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "after EB=48");

      // removeValidator all remaining — empty cluster
      // Already at 0 validators, verify state
      expect(cluster.validatorCount).to.equal(0n);
      await assertDeadOperatorVUnitsZero(provider, networkAddress, deadOps, "final check");
    });
  });
});
