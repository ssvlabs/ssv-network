import { expect } from "chai";
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
  EMPTY_CLUSTER,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
  generateMerkleForClusterEB,
} from "../../helpers/index.ts";
import { ethers } from "ethers";

// ═════════════════════════════════════════════════════════════
// Diamond storage slot constants
// ═════════════════════════════════════════════════════════════
const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;

// operatorEthVUnits is the 3rd field (index 2) in StorageEB — each mapping takes 1 slot
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n;

// daoTotalEthVUnits is in slot (protocol_base + 4), packed at bits [192:255]
// Slot layout of StorageProtocol:
//   slot 0: networkFeeIndexBlockNumber(u32), daoValidatorCount(u32), daoIndexBlockNumber(u32),
//           validatorsPerOperatorLimit(u32), networkFee(u64), networkFeeIndex(u64)
//   slot 1: daoBalance(u64), minBlocksBeforeLiqSSV(u64), minLiqCollateralSSV(u64), declareOpFeePeriod(u64)
//   slot 2: executeOpFeePeriod(u64), opMaxFeeIncrease(u64), opMaxFeeSSV(u64),
//           ethNetFeeIdxBlock(u32), ethDaoValCount(u32)
//   slot 3: ethDaoIdxBlock(u32), ethNetFee(u64), ethNetFeeIdx(u64), ethDaoBalance(u64) = 28 bytes
//   slot 4: minLiqCollateral(u64), minBlocksBeforeLiq(u64), opMaxFee(u64), daoTotalEthVUnits(u64)
const DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT = PROTOCOL_BASE_SLOT + 4n;
const DAO_TOTAL_SHIFT = 192n; // bits 192..255 within slot 4
const UINT64_MASK = (1n << 64n) - 1n;

// ═════════════════════════════════════════════════════════════
// Storage-reading helpers
// ═════════════════════════════════════════════════════════════
async function readOperatorEthVUnits(
  provider: any,
  proxyAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(proxyAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

async function readDaoTotalEthVUnits(
  provider: any,
  proxyAddress: string,
): Promise<bigint> {
  const slotHex = "0x" + DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT.toString(16);
  const raw = await provider.getStorage(proxyAddress, slotHex);
  return (BigInt(raw) >> DAO_TOTAL_SHIFT) & UINT64_MASK;
}

// ═════════════════════════════════════════════════════════════
// INV-11: Removed operator must have zero operatorEthVUnits
// ═════════════════════════════════════════════════════════════
async function assertINV11(
  provider: any,
  proxyAddress: string,
  removedOpIds: (number | bigint)[],
): Promise<void> {
  for (const opId of removedOpIds) {
    const vUnits = await readOperatorEthVUnits(provider, proxyAddress, opId);
    expect(vUnits).to.equal(
      0n,
      `INV-11 violated: operatorEthVUnits[${opId}] = ${vUnits}, expected 0`,
    );
  }
}

// ═════════════════════════════════════════════════════════════
// Test suite
// ═════════════════════════════════════════════════════════════
describe("RM1: _updateOperatorVUnits + removeOperator", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
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
        operatorOwner,
        clusterOwner,
        clusterOwner2,
        oracle1,
        oracle2,
        oracle3,
        oracle4,
        staker,
      ],
    } = await setupTestContext());
  });

  // ── Parametric fixture factory ──
  function createFixture(numOps: number) {
    async function fixture() {
      const { network, ssvToken } =
        await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      await setupOracles(network, ssvToken, staker, [
        oracle1,
        oracle2,
        oracle3,
        oracle4,
      ]);
      const operatorIds = await registerOperators(
        network,
        operatorOwner,
        numOps,
      );
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);
      return { network, operatorIds, ssvToken };
    }
    return fixture;
  }

  // ── Register 1 validator and return cluster + block ──
  async function registerCluster(
    network: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    deposit?: bigint,
    pubkeyIndex = 1,
  ): Promise<{ cluster: Cluster; block: number }> {
    const dep = deposit ?? connection.ethers.parseEther("10");
    const tx = await network
      .connect(owner)
      .registerValidator(
        makePublicKey(pubkeyIndex),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: dep },
      );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
      block: receipt!.blockNumber,
    };
  }

  // ── Commit EB root + updateClusterBalance ──
  async function commitAndUpdateEB(
    network: any,
    provider: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
  ): Promise<{ cluster: Cluster; block: number }> {
    const clusterId = computeClusterId(owner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [
      oracle1,
      oracle2,
      oracle3,
    ]);
    const tx = await network
      .connect(owner)
      .updateClusterBalance(
        rootBlockNum,
        owner.address,
        operatorIds,
        cluster,
        effectiveBalance,
        [],
      );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(
        network,
        receipt,
        Events.CLUSTER_BALANCE_UPDATED,
      ),
      block: receipt!.blockNumber,
    };
  }

  // ── Multi-cluster EB commit + update (with merkle proofs) ──
  async function commitAndUpdateEBMulti(
    network: any,
    provider: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
    entries: { clusterId: string; effectiveBalance: number }[],
  ): Promise<{ cluster: Cluster; block: number }> {
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [
      oracle1,
      oracle2,
      oracle3,
    ]);
    const clusterId = computeClusterId(owner.address, operatorIds);
    const proof = proofs[clusterId] ?? [];
    const tx = await network
      .connect(owner)
      .updateClusterBalance(
        rootBlockNum,
        owner.address,
        operatorIds,
        cluster,
        effectiveBalance,
        proof,
      );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(
        network,
        receipt,
        Events.CLUSTER_BALANCE_UPDATED,
      ),
      block: receipt!.blockNumber,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // RM1-001 / RM1-002: 4-op basic increase / decrease
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: basic EB change after removeOperator", () => {
    const deployFixture = createFixture(4);

    it("RM1-001: removeOp + EB increase → guard skips removed op, no resurrection", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // Baseline explicit EB=32 (storedVUnits=10000, no delta)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB increase → 40 (newVUnits=12500, delta=+2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-002: removeOp + EB decrease → guard prevents underflow", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → storedVUnits=12500, deviation +2500 for all ops
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      for (const opId of operatorIds) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, opId),
        ).to.equal(2500n);
      }

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 32 (newVUnits=10000, delta=-2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-003 / RM1-004: 7-op variants
  // ═══════════════════════════════════════════════════════════
  describe("7-operator: EB change after removeOperator", () => {
    const deployFixture = createFixture(7);

    it("RM1-003: 7 ops, removeOp + EB increase → 6 live ops get +delta, op1 stays 0", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 7; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-004: 7 ops, removeOp + EB decrease → 6 live ops get -delta, no underflow", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 7; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-005 / RM1-006: 10-op variants
  // ═══════════════════════════════════════════════════════════
  describe("10-operator: EB change after removeOperator", () => {
    const deployFixture = createFixture(10);

    it("RM1-005: 10 ops, removeOp + EB increase → 9 live ops get +delta, op1 stays 0", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 10; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-006: 10 ops, removeOp + EB decrease → 9 live ops get -delta, no underflow", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 10; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-007 / RM1-008: 13-op variants
  // ═══════════════════════════════════════════════════════════
  describe("13-operator: EB change after removeOperator", () => {
    const deployFixture = createFixture(13);

    it("RM1-007: 13 ops, removeOp + EB increase → 12 live ops get +delta, op1 stays 0", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 13; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-008: 13 ops, removeOp + EB decrease → 12 live ops get -delta, no underflow", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 13; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-009 / RM1-010: Per-operator deviation verification
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: per-operator deviation verification", () => {
    const deployFixture = createFixture(4);

    it("RM1-009: removeOp + EB increase → per-operator deviation only on live ops", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Verify all ops start at 0 deviation
      for (const opId of operatorIds) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, opId),
        ).to.equal(0n);
      }

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB increase → 40 (delta +2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Removed op must stay at 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "operatorEthVUnits[removedOp] must be 0");
      // Live ops get exactly +2500
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n, `operatorEthVUnits[op${i + 1}] should be 2500`);
      }
    });

    it("RM1-010: removeOp + EB decrease → per-operator deviation only on live ops", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → deviation +2500 on all ops
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Verify all ops have deviation 2500
      for (const opId of operatorIds) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, opId),
        ).to.equal(2500n);
      }

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 32 (delta -2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "operatorEthVUnits[removedOp] must be 0");
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(
          0n,
          `operatorEthVUnits[op${i + 1}] should be 0 (2500 - 2500)`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-011 / RM1-012: daoTotalEthVUnits verification
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: daoTotalEthVUnits consistency", () => {
    const deployFixture = createFixture(4);

    it("RM1-011: removeOp + EB increase → daoTotalEthVUnits correct (excludes removed op)", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // After register: daoTotalEthVUnits = 1 * 10000 = 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));
      // No vUnit change → still 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      // removeOperator doesn't change daoTotalEthVUnits → still 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );

      // EB increase → 40 (cluster-level delta +2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      // daoTotalEthVUnits: 10000 + 2500 = 12500
      // Note: DAO total uses cluster-level delta, not per-operator
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
    });

    it("RM1-012: removeOp + EB decrease → daoTotalEthVUnits correct", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → daoTotalEthVUnits: 10000 + 2500 = 12500
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 32 (cluster-level delta -2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));
      // daoTotalEthVUnits: 12500 - 2500 = 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-013 / RM1-014: Cluster functionality post-EB update
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: cluster operations after EB update with removed op", () => {
    const deployFixture = createFixture(4);

    it("RM1-013: after EB update with removed op, deposit succeeds", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB increase
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Deposit into the cluster — must succeed
      const depositAmount = connection.ethers.parseEther("2");
      const depTx = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, operatorIds, cluster, {
          value: depositAmount,
        });
      const depReceipt = await depTx.wait();
      const clusterAfterDep = parseClusterFromEvent(
        network,
        depReceipt,
        Events.CLUSTER_DEPOSITED,
      );
      expect(clusterAfterDep.active).to.equal(true);

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
    });

    it("RM1-014: after EB update with removed op, withdraw succeeds", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 then decrease to 32 after removal
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Withdraw from the cluster — must succeed
      const withdrawAmount = connection.ethers.parseEther("1");
      const wTx = await network
        .connect(clusterOwner)
        .withdraw(operatorIds, withdrawAmount, cluster);
      const wReceipt = await wTx.wait();
      const clusterAfterW = parseClusterFromEvent(
        network,
        wReceipt,
        Events.CLUSTER_WITHDRAWN,
      );
      expect(clusterAfterW.active).to.equal(true);

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-015: Remove op BEFORE any explicit EB update
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: remove before any explicit EB", () => {
    const deployFixture = createFixture(4);

    it("RM1-015: remove op before any EB update → first explicit EB skips removed op", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // No explicit EB committed yet. Cluster has implicit vUnits = 10000.
      // All operatorEthVUnits = 0 (no deviation)

      // Remove op1 BEFORE any EB update
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // First explicit EB update: EB=40 → newVUnits=12500
      // storedVUnits fallback: validatorCount * BPS_DENOMINATOR = 10000
      // delta = +2500
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Guard distinguishes "never had deviation" (live ops with ethSnapshot.block!=0)
      // from "removed" (op1 with ethSnapshot.block==0)
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-016: Chained removal
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: chained removal", () => {
    const deployFixture = createFixture(4);

    it("RM1-016: remove op1 → EB update → remove op2 → EB update (chained)", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Step 1: Remove op1
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // Step 2: EB increase → 40 (delta +2500). Guard skips op1.
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      // Checkpoint A: [0, 2500, 2500, 2500]
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[1]),
      ).to.equal(2500n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[2]),
      ).to.equal(2500n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[3]),
      ).to.equal(2500n);

      // Step 3: Remove op2
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      // Step 4: EB decrease → 36 (newVUnits=ceil(36*10000/32)=11250, delta -1250)
      // Guard skips op1 AND op2. Only ops 3,4 get -1250.
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        36,
      ));

      await assertINV11(provider, proxyAddr, [operatorIds[0], operatorIds[1]]);
      // ops 3,4: 2500 - 1250 = 1250
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[2]),
      ).to.equal(1250n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[3]),
      ).to.equal(1250n);

      // daoTotalEthVUnits: 10000 + 2500 - 1250 = 11250
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        11250n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-017: No ghost deviation across increase + decrease
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: ghost deviation check", () => {
    const deployFixture = createFixture(4);

    it("RM1-017: remove op → EB increase → EB decrease → no accumulated ghost deviation", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB increase → 40 (delta +2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      // Assert op1 is 0 after increase
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);

      // EB decrease back → 32 (delta -2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));
      // Assert op1 is STILL 0 — no ghost accumulation
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);

      // Live ops back to 0
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-018 / RM1-019 / RM1-020: Bug reproduction (guard prevents)
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: guard-prevents-bug verification", () => {
    const deployFixture = createFixture(4);

    it("RM1-018: guard prevents resurrection — EB increase after removeOperator does NOT write to deleted slot", async function () {
      // Without the guard, _updateOperatorVUnits would write +deltaAbs to
      // operatorEthVUnits[removedOp], resurrecting the deleted slot.
      // With the guard: slot stays 0.
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // Confirm deleted
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n);

      // EB increase → 40
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // With guard: NOT resurrected
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "Guard must prevent resurrection of deleted slot");

      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
    });

    it("RM1-019: guard prevents underflow — EB decrease after removeOperator succeeds", async function () {
      // Without the guard, subtracting deltaAbs from a deleted (0) slot
      // would cause uint64 underflow → Panic(0x11). With the guard:
      // the removed op is skipped and the tx succeeds.
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → deviation +2500 for all
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 32. Without guard: revert with underflow.
      // With guard: succeeds.
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Tx succeeded (no revert) — the guard prevented the underflow
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      expect(cluster.active).to.equal(true);
    });

    it("RM1-020: guard prevents corruption — chained EB increase + decrease on removed op has no residual state", async function () {
      // Without the guard: increase resurrects slot to deltaAbs, then
      // decrease subtracts — if deltaDecrease <= deltaIncrease, result
      // is non-zero garbage. With guard: always 0.
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB increase → 40 (delta +2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);

      // EB decrease → 36 (delta -1250) — partial decrease
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        36,
      ));

      // With guard: op1 stays 0 (no residual from partial increase-then-decrease)
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);

      // Live ops: 2500 - 1250 = 1250
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(1250n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-021 / RM1-022: Real removeOperator vs mock comparison
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: real removeOperator cleanup verification", () => {
    const deployFixture = createFixture(4);

    it("RM1-021: real removeOperator deletes vUnits → EB increase does not pollute", async function () {
      // Real removeOperator() deletes seb.operatorEthVUnits[operatorId],
      // unlike mockRemoveOperator which leaves stale deviation.
      // This test verifies real removeOperator properly cleans up.
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → gives each op deviation 2500
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(2500n);

      // Real removeOperator: deletes operatorEthVUnits[op1] → slot = 0
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "removeOperator must delete operatorEthVUnits");

      // EB increase → 48 (newVUnits=15000, delta +2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        48,
      ));

      // With real removeOperator + guard: no stale pollution
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      // Live ops: 2500 + 2500 = 5000
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(5000n);
      }
    });

    it("RM1-022: real removeOperator deletes vUnits → EB decrease does not subtract from stale value", async function () {
      // With mockRemoveOperator (stale slot), EB decrease would subtract
      // from the stale value instead of underflowing. With real
      // removeOperator (slot=0), the guard skips the removed op entirely.
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=48 → deviation +5000 for all
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        48,
      ));
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(5000n);

      // Real removeOperator: slot deleted → 0
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 40 (delta -2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Real removeOperator + guard: op1 stays 0 (not 5000-2500=2500)
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      // Live ops: 5000 - 2500 = 2500
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-023: Shared operator across two clusters
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: cross-cluster shared operator", () => {
    it("RM1-023: shared op removed → EB updates on both clusters skip it, no cross-cluster contamination", async function () {
      // Op1 belongs to Cluster A (ops 1,2,3,4) and Cluster B (ops 1,5,6,7)
      const { network, ssvToken } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      await setupOracles(network, ssvToken, staker, [
        oracle1,
        oracle2,
        oracle3,
        oracle4,
      ]);

      // Register 7 operators (shared op1 + 3 for cluster A + 3 for cluster B)
      const allOpIds = await registerOperators(network, operatorOwner, 7);
      await whitelistAddresses(network, operatorOwner, allOpIds, [
        clusterOwner.address,
        clusterOwner2.address,
      ]);

      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      const opsA = [allOpIds[0], allOpIds[1], allOpIds[2], allOpIds[3]];
      const opsB = [allOpIds[0], allOpIds[4], allOpIds[5], allOpIds[6]];

      // Register Cluster A and Cluster B
      let { cluster: clusterA } = await registerCluster(
        network,
        clusterOwner,
        opsA,
      );
      let { cluster: clusterB } = await registerCluster(
        network,
        clusterOwner2,
        opsB,
        undefined,
        2,
      );

      // Set initial explicit EB=32 for both clusters
      const clusterIdA = computeClusterId(clusterOwner.address, opsA);
      const clusterIdB = computeClusterId(clusterOwner2.address, opsB);

      const entries32 = [
        { clusterId: clusterIdA, effectiveBalance: 32 },
        { clusterId: clusterIdB, effectiveBalance: 32 },
      ];
      ({ cluster: clusterA } = await commitAndUpdateEBMulti(
        network,
        provider,
        clusterOwner,
        opsA,
        clusterA,
        32,
        entries32,
      ));
      ({ cluster: clusterB } = await commitAndUpdateEBMulti(
        network,
        provider,
        clusterOwner2,
        opsB,
        clusterB,
        32,
        entries32,
      ));

      // Remove shared op1
      await network.connect(operatorOwner).removeOperator(allOpIds[0]);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, allOpIds[0]),
      ).to.equal(0n);

      // EB increase on Cluster A → 40
      const entriesA40 = [
        { clusterId: clusterIdA, effectiveBalance: 40 },
        { clusterId: clusterIdB, effectiveBalance: 32 },
      ];
      ({ cluster: clusterA } = await commitAndUpdateEBMulti(
        network,
        provider,
        clusterOwner,
        opsA,
        clusterA,
        40,
        entriesA40,
      ));

      // op1 must still be 0 after Cluster A's update
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, allOpIds[0]),
      ).to.equal(0n, "shared op1 stays 0 after Cluster A EB update");

      // EB increase on Cluster B → 48
      const entriesB48 = [
        { clusterId: clusterIdA, effectiveBalance: 40 },
        { clusterId: clusterIdB, effectiveBalance: 48 },
      ];
      ({ cluster: clusterB } = await commitAndUpdateEBMulti(
        network,
        provider,
        clusterOwner2,
        opsB,
        clusterB,
        48,
        entriesB48,
      ));

      // op1 must still be 0 after BOTH clusters' updates
      await assertINV11(provider, proxyAddr, [allOpIds[0]]);

      // Cluster A live ops (ops 2,3,4): +2500
      for (let i = 1; i <= 3; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, allOpIds[i]),
        ).to.equal(2500n);
      }
      // Cluster B live ops (ops 5,6,7): +5000
      for (let i = 4; i <= 6; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, allOpIds[i]),
        ).to.equal(5000n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-024: Remove ALL operators
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: remove all operators", () => {
    const deployFixture = createFixture(4);

    it("RM1-024: remove all 4 ops → EB update → all ops skipped, no state written", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Remove ALL 4 operators
      for (const opId of operatorIds) {
        await network.connect(operatorOwner).removeOperator(opId);
      }

      // Verify all are zeroed
      for (const opId of operatorIds) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, opId),
        ).to.equal(0n);
      }

      // EB increase → 40. Guard skips all 4 operators. No operatorEthVUnits written.
      // But daoTotalEthVUnits still gets updated at cluster level.
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // All operatorEthVUnits remain 0
      await assertINV11(provider, proxyAddr, operatorIds);

      // daoTotalEthVUnits: 10000 + 2500 = 12500 (cluster-level, not per-op)
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-025: Zero-delta EB update (no _updateOperatorVUnits call)
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: zero-delta EB update", () => {
    const deployFixture = createFixture(4);

    it("RM1-025: EB update where newVUnits == storedVUnits → _updateOperatorVUnits not called → removed op irrelevant", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // Set explicit EB=32 → storedVUnits=10000
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB update with same value: EB=32 → newVUnits=10000 = storedVUnits
      // The condition `newVUnits != storedVUnits` at SSVClusters.sol:400 is false
      // → _updateOperatorVUnits is NOT called at all
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0 (trivially, since _updateOperatorVUnits wasn't called)
      await assertINV11(provider, proxyAddr, [operatorIds[0]]);
      // Live ops also stay 0 (no delta applied)
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      // daoTotalEthVUnits unchanged at 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });
});
