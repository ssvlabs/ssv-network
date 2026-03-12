import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from "../../common/constants.ts";
import {
  checkValidatorCountConsistency,
  type TrackedCluster,
} from "../helpers/index.ts";
import { Events } from "../../common/events.ts";

describe("Cross-Cutting: Validator Count Invariant", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner1: HardhatEthersSigner;
  let owner2: HardhatEthersSigner;
  let owner3: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [owner1, owner2, owner3, operatorOwner] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Validator Count Through Liquidation Cycle", () => {
    it("maintains ethDaoValidatorCount == Σ(active clusters) through register → liquidate → reactivate", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      // Register 4 operators with same fee
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        owner1.address,
        owner2.address,
        owner3.address,
      ]);

      // Track all clusters for invariant checking
      const clusters: TrackedCluster[] = [];

      // STEP 1: Register first cluster (owner1, 1 validator)
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

      // ✓ Invariant: ethDaoValidatorCount = 1
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(1);

      // STEP 2: Register second cluster (owner2, 2 validators, same operators)
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

      // ✓ Invariant: ethDaoValidatorCount = 1 + 2 = 3
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      // STEP 3: Register third cluster (owner3, 1 validator, same operators)
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

      // ✓ Invariant: ethDaoValidatorCount = 1 + 2 + 1 = 4
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(4);

      // STEP 4: Liquidate cluster1 by owner (no time/collateral restrictions)
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

      // Mark cluster1 as inactive
      clusters[0].active = false;

      // ✓ Invariant: ethDaoValidatorCount = 2 + 1 = 3 (cluster1 liquidated)
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      // STEP 5: Liquidate cluster2 by owner as well
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

      // Mark cluster2 as inactive
      clusters[1].active = false;

      // ✓ Invariant: ethDaoValidatorCount = 1 (only cluster3 active)
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(1);

      // STEP 6: Reactivate cluster1
      const cluster1Liq = await getCurrentClusterState(
        connection,
        network,
        owner1.address,
        operatorIds,
      );

      expect(cluster1Liq.active).to.equal(false); // Verify it's liquidated

      const txReact = await network.connect(owner1).reactivate(
        operatorIds,
        cluster1Liq,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await txReact.wait();

      // Mark cluster1 as active again
      clusters[0].active = true;

      // ✓ Invariant: ethDaoValidatorCount = 1 + 1 = 2 (cluster1 + cluster3)
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      // STEP 7: Reactivate cluster2
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

      // Mark cluster2 as active again
      clusters[1].active = true;

      // ✓ Invariant: ethDaoValidatorCount = 1 + 2 + 1 = 4 (all clusters active again)
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(4);
    });

    it("prevents double-counting when operators are shared across clusters", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      // Register 4 operators
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        owner1.address,
        owner2.address,
      ]);

      const clusters: TrackedCluster[] = [];

      // Create 2 clusters with SAME operators
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

      // Verify: ethDaoValidatorCount = 2
      await checkValidatorCountConsistency(views, clusters);
      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      // Show that operator counts would incorrectly sum to 8:
      let totalFromOperators = 0n;
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        totalFromOperators += BigInt(op.validatorCount);
      }

      // Each operator serves 2 validators across both clusters
      expect(totalFromOperators).to.equal(8n); // 4 operators * 2 validators = 8

      // But ethDaoValidatorCount correctly counts unique validators
      expect(await views.getNetworkValidatorsCount()).to.equal(2n);
    });
  });
});
