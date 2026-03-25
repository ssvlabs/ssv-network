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

    it("RM1-001: removeOp + EB increase → guard skips removed op", async function () {
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

      // Guard skips removed op — vUnits stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-002: removeOp + EB decrease → guard skips removed op", async function () {
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
      // Guard skips removed op, active ops get -2500
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0 (guard skipped it)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
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

    it("RM1-003: 7 ops, removeOp + EB increase → guard skips removed op", async function () {
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

      // Guard skips removed op — vUnits stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      for (let i = 1; i < 7; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-004: 7 ops, removeOp + EB decrease → guard skips removed op", async function () {
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

      // EB decrease → 32 — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
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

    it("RM1-005: 10 ops, removeOp + EB increase → guard skips removed op", async function () {
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

      // Guard skips removed op — vUnits stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      for (let i = 1; i < 10; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-006: 10 ops, removeOp + EB decrease → guard skips removed op", async function () {
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

      // EB decrease → 32 — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
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

    it("RM1-007: 13 ops, removeOp + EB increase → guard skips removed op", async function () {
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

      // Guard skips removed op — vUnits stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      for (let i = 1; i < 13; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n);
      }
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        12500n,
      );
    });

    it("RM1-008: 13 ops, removeOp + EB decrease → guard skips removed op", async function () {
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

      // EB decrease → 32 — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
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

    it("RM1-009: removeOp + EB increase → guard skips removed op, active ops get deviation", async function () {
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

      // Guard skips removed op — stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Live ops get exactly +2500
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(2500n, `operatorEthVUnits[op${i + 1}] should be 2500`);
      }
    });

    it("RM1-010: removeOp + EB decrease → guard skips removed op", async function () {
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

      // EB decrease → 32 (delta -2500) — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0 (guard skipped it)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n, `operatorEthVUnits[op${i + 1}] should be 0`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-011 / RM1-012: daoTotalEthVUnits verification
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: daoTotalEthVUnits consistency", () => {
    const deployFixture = createFixture(4);

    it("RM1-011: removeOp + EB increase → daoTotalEthVUnits correct, removed op correctly skipped", async function () {
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

      // Guard skips removed op — vUnits stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
    });

    it("RM1-012: removeOp + EB decrease → guard skips removed op, daoTotalEthVUnits correct", async function () {
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

      // EB decrease → 32 (delta -2500) — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
      // daoTotalEthVUnits: 12500 - 2500 = 10000
      expect(await readDaoTotalEthVUnits(provider, proxyAddr)).to.equal(
        10000n,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-013 / RM1-014: Cluster functionality post-EB update
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: cluster operations after EB update with removed op", () => {
    const deployFixture = createFixture(4);

    it("RM1-013: after EB increase with removed op, deposit succeeds (op correctly skipped)", async function () {
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

      // EB increase — guard skips removed op
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
      // Verify deposit increased balance
      expect(BigInt(clusterAfterDep.balance)).to.be.greaterThan(
        BigInt(cluster.balance),
        "cluster balance must increase after deposit",
      );

      // Guard kept removed op at 0 (deposit doesn't change it)
      const vUnitsAfterDep = await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]);
      expect(vUnitsAfterDep).to.equal(0n, "guard must skip removed op");
    });

    it("RM1-014: EB decrease with removed op succeeds — guard skips removed op", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const proxyAddr = await network.getAddress();

      let { cluster } = await registerCluster(
        network,
        clusterOwner,
        operatorIds,
      );
      // EB=40 → deviation +2500 for all ops
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // EB decrease → 32 (delta -2500) — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-015: Remove op BEFORE any explicit EB update
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: remove before any explicit EB", () => {
    const deployFixture = createFixture(4);

    it("RM1-015: remove op before any EB update → first explicit EB correctly skips removed op", async function () {
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

      // Guard skips removed op — stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
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

    it("RM1-016: remove op1 → EB increase → remove op2 → EB decrease succeeds, guard skips both", async function () {
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
      // op1 skipped → stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op1");
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[1]),
      ).to.equal(2500n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[2]),
      ).to.equal(2500n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[3]),
      ).to.equal(2500n);

      // Step 3: Remove op2 — deletes op2's slot to 0
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      // Step 4: EB decrease → 36 (newVUnits=11250, storedVUnits=12500, delta=-1250)
      // Guard skips both op1 and op2
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        36,
      ));

      // Both removed ops stay 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op1");
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[1]),
      ).to.equal(0n, "guard must skip removed op2");
      // Active ops: 2500 - 1250 = 1250
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[2]),
      ).to.equal(1250n);
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[3]),
      ).to.equal(1250n);
      // daoTotalEthVUnits: 12500 - 1250 = 11250
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

    it("RM1-017: remove op → EB increase → EB decrease → guard skips removed op throughout", async function () {
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
      // Guard skips removed op — stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op after EB increase");

      // EB decrease back → 32 (delta -2500)
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));
      // Removed op still 0 (guard skipped both increase and decrease)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op after EB decrease");

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
  // RM1-018 / RM1-019 / RM1-020: Guard correctness verification
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: guard correctness verification", () => {
    const deployFixture = createFixture(4);

    it("RM1-018: guard — EB increase after removeOperator correctly skips deleted slot", async function () {
      // _updateOperatorVUnits guard checks ethSnapshot.block == 0 and skips removed ops.
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

      // Guard correctly skips removed op — stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
    });

    it("RM1-019: guard — EB decrease after removeOperator succeeds", async function () {
      // Guard checks ethSnapshot.block == 0 and skips removed ops,
      // preventing the uint64 underflow that would otherwise occur.
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

      // EB decrease → 32 — guard skips removed op, no underflow
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        32,
      ));

      // Removed op stays 0 (guard prevented underflow)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 2500 - 2500 = 0
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(0n);
      }
    });

    it("RM1-020: guard — chained EB increase + partial decrease, removed op stays zero", async function () {
      // Guard skips removed op on both increase and decrease,
      // so no residual accumulates on the deleted slot.
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

      // EB increase → 40 (delta +2500) — guard skips removed op
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
      ).to.equal(0n, "guard must skip removed op after EB increase");

      // EB decrease → 36 (delta -1250) — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        36,
      ));

      // Removed op stays 0 (guard skipped both increase and decrease)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op after partial decrease");

      // Live ops: 2500 - 1250 = 1250
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(1250n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RM1-021 / RM1-022: Real removeOperator cleanup verification
  // ═══════════════════════════════════════════════════════════
  describe("4-operator: real removeOperator cleanup verification", () => {
    const deployFixture = createFixture(4);

    it("RM1-021: real removeOperator deletes vUnits → EB increase correctly skips removed op", async function () {
      // Real removeOperator() deletes seb.operatorEthVUnits[operatorId],
      // and the guard in _updateOperatorVUnits skips it on EB updates.
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

      // Guard correctly skips removed op — stays 0
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Live ops: 2500 + 2500 = 5000
      for (let i = 1; i < 4; i++) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, operatorIds[i]),
        ).to.equal(5000n);
      }
    });

    it("RM1-022: real removeOperator deletes vUnits → EB decrease succeeds, guard skips removed op", async function () {
      // With real removeOperator (slot=0), guard skips the removed op
      // on EB decrease, preventing the underflow.
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

      // EB decrease → 40 (delta -2500) — guard skips removed op
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // Removed op stays 0 (guard prevented underflow)
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, operatorIds[0]),
      ).to.equal(0n, "guard must skip removed op");
      // Active ops: 5000 - 2500 = 2500
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
    it("RM1-023: shared op removed → EB updates on both clusters correctly skip it", async function () {
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

      // Guard skips removed op1 — stays 0 after Cluster A's update
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, allOpIds[0]),
      ).to.equal(0n, "guard must skip shared removed op1 during Cluster A EB update");

      // EB increase on Cluster B → 48 (delta +5000)
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

      // Guard skips removed op1 — still 0 after Cluster B's update too
      expect(
        await readOperatorEthVUnits(provider, proxyAddr, allOpIds[0]),
      ).to.equal(0n, "guard must skip shared removed op1 during Cluster B EB update");

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

    it("RM1-024: remove all 4 ops → EB increase → guard skips all removed ops", async function () {
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

      // EB increase → 40 (delta +2500). Guard skips all removed ops.
      ({ cluster } = await commitAndUpdateEB(
        network,
        provider,
        clusterOwner,
        operatorIds,
        cluster,
        40,
      ));

      // All operatorEthVUnits stay 0 (guard skipped all)
      for (const opId of operatorIds) {
        expect(
          await readOperatorEthVUnits(provider, proxyAddr, opId),
        ).to.equal(0n, "guard must skip removed op");
      }

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
