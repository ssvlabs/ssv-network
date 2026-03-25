import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  getCurrentClusterState,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
//  Diamond storage readers
// ---------------------------------------------------------------------------
function mainStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.main"))) - 1n;
}

async function readETHClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 10n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

function computeClusterKey(ownerAddress: string, operatorIds: number[]): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [ownerAddress, operatorIds.map(BigInt)],
    ),
  );
}
import {
  checkValidatorCountConsistency,
  type TrackedCluster,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";

describe("Cross-Cutting: Validator Count Invariant", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner1: HardhatEthersSigner;
  let owner2: HardhatEthersSigner;
  let owner3: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner1, owner2, owner3, operatorOwner] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Validator Count Through Liquidation Cycle", () => {
    it("maintains ethDaoValidatorCount == Σ(active clusters) through register → liquidate → reactivate", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        owner1.address,
        owner2.address,
        owner3.address,
      ]);
      const clusters: TrackedCluster[] = [];
      const tx1 = await network.connect(owner1).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt1 = await tx1.wait();
      const cluster1 = parseClusterFromEvent(network, receipt1, Events.VALIDATOR_ADDED);

      clusters.push({
        owner: owner1.address,
        operatorIds: operatorIds.map(BigInt),
        validatorCount: 1n,
        active: true,
      });
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(1);
      const tx2a = await network.connect(owner2).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt2a = await tx2a.wait();
      const cluster2Partial = parseClusterFromEvent(network, receipt2a, Events.VALIDATOR_ADDED);

      const tx2b = await network.connect(owner2).registerValidator(
        makePublicKey(3),
        operatorIds,
        DEFAULT_SHARES,
        cluster2Partial,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt2b = await tx2b.wait();
      const cluster2 = parseClusterFromEvent(network, receipt2b, Events.VALIDATOR_ADDED);

      clusters.push({
        owner: owner2.address,
        operatorIds: operatorIds.map(BigInt),
        validatorCount: 2n,
        active: true,
      });
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(3);
      const tx3 = await network.connect(owner3).registerValidator(
        makePublicKey(4),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt3 = await tx3.wait();
      const cluster3 = parseClusterFromEvent(network, receipt3, Events.VALIDATOR_ADDED);

      clusters.push({
        owner: owner3.address,
        operatorIds: operatorIds.map(BigInt),
        validatorCount: 1n,
        active: true,
      });
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(4);

      // INV-034: After registering 3 clusters (owner1:1, owner2:2, owner3:1) on same 4 operators,
      // each operator's ethValidatorCount == 4 (sum of all cluster validator counts)
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(BigInt(opData.validatorCount)).to.equal(4n, `INV-034: operator ${opId} ethValidatorCount == 4 after all registrations`);
      }

      const cluster1ForLiq = await getCurrentClusterState(
        connection,
        network,
        owner1.address,
        operatorIds,
      );

      const txLiq = await network.connect(owner1).liquidate(
        owner1.address,
        operatorIds,
        cluster1ForLiq,
      );
      await txLiq.wait();
      clusters[0].active = false;
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      // INV-035: After liquidating owner1 (1 validator), each operator's ethValidatorCount decremented
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(BigInt(opData.validatorCount)).to.equal(3n, `INV-035: operator ${opId} ethValidatorCount == 3 after liquidating 1-validator cluster`);
      }

      const cluster2Current = await getCurrentClusterState(
        connection,
        network,
        owner2.address,
        operatorIds,
      );

      const cluster2ForLiq = await getCurrentClusterState(
        connection,
        network,
        owner2.address,
        operatorIds,
      );

      const txLiq2 = await network.connect(owner2).liquidate(
        owner2.address,
        operatorIds,
        cluster2ForLiq,
      );
      await txLiq2.wait();
      clusters[1].active = false;
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(1);

      // INV-035: After liquidating owner2 (2 validators), each operator's ethValidatorCount == 1
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(BigInt(opData.validatorCount)).to.equal(1n, `INV-035: operator ${opId} ethValidatorCount == 1 after liquidating 2-validator cluster`);
      }

      const cluster1Liq = await getCurrentClusterState(
        connection,
        network,
        owner1.address,
        operatorIds,
      );

      expect(cluster1Liq.active).to.equal(false);

      const txReact = await network.connect(owner1).reactivate(
        operatorIds,
        cluster1Liq,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await txReact.wait();
      clusters[0].active = true;
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      // INV-024: After reactivation, ethClusters[key] stores updated hash
      const contractAddress = await network.getAddress();
      const provider = connection.ethers.provider;
      const clusterKey1 = computeClusterKey(owner1.address, operatorIds);
      const hashAfterReactivation = await readETHClusterHash(provider, contractAddress, clusterKey1);
      expect(hashAfterReactivation).to.not.equal(0n, "INV-024: ethClusters[key] != 0 after reactivation");

      // INV-036: After reactivation, per-operator ethValidatorCount incremented back
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        // owner1 reactivated with 1 validator + owner3 still active with 1 validator = 2 per operator
        expect(BigInt(opData.validatorCount)).to.equal(2n, `INV-036: operator ${opId} ethValidatorCount == 2 after reactivation`);
      }

      const cluster2Liq = await getCurrentClusterState(
        connection,
        network,
        owner2.address,
        operatorIds,
      );

      expect(cluster2Liq.active).to.equal(false);

      const txReact2 = await network.connect(owner2).reactivate(
        operatorIds,
        cluster2Liq,
        { value: 2n * DEFAULT_ETH_REGISTER_VALUE },
      );
      await txReact2.wait();
      clusters[1].active = true;
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(4);
    });

    it("prevents double-counting when operators are shared across clusters", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        owner1.address,
        owner2.address,
      ]);

      const clusters: TrackedCluster[] = [];
      await network.connect(owner1).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      clusters.push({
        owner: owner1.address,
        operatorIds: operatorIds.map(BigInt),
        validatorCount: 1n,
        active: true,
      });

      await network.connect(owner2).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      clusters.push({
        owner: owner2.address,
        operatorIds: operatorIds.map(BigInt),
        validatorCount: 1n,
        active: true,
      });
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(2);
      let totalFromOperators = 0n;
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        totalFromOperators += BigInt(op.validatorCount);
      }
      expect(totalFromOperators).to.equal(8n);
      expect(await views.getNetworkValidatorsCount()).to.equal(2n);

      // INV-034: Per-operator ethValidatorCount — each operator has 2 validators (1 from each cluster)
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op.validatorCount)).to.equal(2n, `INV-034: operator ${opId} ethValidatorCount == 2 (shared across 2 clusters)`);
      }
    });
  });
});
