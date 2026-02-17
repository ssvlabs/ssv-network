/**
 * Regression Tests: Validator & Cluster Bugs
 *
 * These tests assert the CORRECT behavior for cluster operations involving EB tracking.
 * They are expected to FAIL on the current code, proving the bugs are real.
 * Once fixes land, they should flip to passing.
 *
 * BUG-4: Double deviation cleanup on removeValidator for liquidated clusters with explicit EB.
 *        _executeLiquidation cleans up operatorEthVUnits deviation, but doesn't clear
 *        ebSnapshot.vUnits. Then removeValidator tries to clean up the same deviation again,
 *        causing an arithmetic underflow revert.
 *
 * ===== VERIFIED FIXED =====
 * The following bugs from the mainnet readiness checklist have been verified as fixed
 * in the current codebase:
 *
 * BUG-1: ensureETHDefaults overwritten by stale memory copy
 *   Status: FIXED — Code was refactored so ensureETHDefaults() runs on the storage reference
 *   at OperatorLib.sol:200 BEFORE the memory copy at line 201. The existing test
 *   "Initializes ETH defaults for legacy SSV operators" (registerValidator.test.ts:60)
 *   confirms the fix.
 *
 * BUG-3: ensureETHDefaults resurrects removed operators
 *   Status: NOT EXPLOITABLE — Removed operators have both snapshot.block=0 and
 *   ethSnapshot.block=0, which causes ensureOperatorExist() (OperatorLib.sol:159-163)
 *   to revert with OperatorDoesNotExist before ensureETHDefaults() is reached.
 *
 * BUG-5: _liquidateAfterEBUpdateIfNeeded condition too strict for ETH-only operators
 *   Status: FIXED — The condition at SSVClusters.sol:546 now checks only
 *   op.ethSnapshot.block != 0 (not both snapshots), correctly handling ETH-only operators.
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import { makePublicKey, createCluster, parseClusterFromEvent } from "../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  VUNITS_PRECISION,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";

describe("Regression: Validator & Cluster Bugs", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return connection.ethers.keccak256(
      connection.ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  describe("BUG-4: Double deviation cleanup reverts removeValidator on liquidated cluster", () => {
    const deployClustersFixture = async () =>
      ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);

    it("Allows removing a validator from a liquidated cluster with explicit EB", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployClustersFixture);

      // Step 1: Register a validator (creates ETH cluster with validatorCount=1)
      const publicKey = makePublicKey(1);
      const registerTx = await clusters.registerValidator(
        publicKey,
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const registerReceipt = await registerTx.wait();
      const clusterAfterRegister = parseClusterFromEvent(
        clusters,
        registerReceipt,
        Events.VALIDATOR_ADDED
      );

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Step 2: Set up explicit EB tracking with deviation
      // baseline = 1 validator * VUNITS_PRECISION = 10,000
      // set cluster vUnits to 15,000 (deviation of 5,000 above baseline)
      const clusterVUnits = VUNITS_PRECISION + 5000n; // 15,000
      const deviation = 5000n;

      await clusters.mockSetClusterVUnits(clusterId, clusterVUnits);

      // Set per-operator deviation (each operator carries the full deviation of this cluster)
      for (const opId of operatorIds) {
        await clusters.mockSetOperatorEthVUnits(opId, deviation);
      }
      // Set DAO total deviation (sum across all operators)
      await clusters.mockSetDaoTotalEthVUnits(deviation * BigInt(operatorIds.length));

      // Step 3: Liquidate the cluster
      // Owner can self-liquidate without needing the cluster to be liquidatable.
      // This triggers _executeLiquidation which:
      //   - Decrements ethValidatorCount (via updateClusterOperators)
      //   - Cleans up deviation from operatorEthVUnits (subtracts 5000 from each)
      //   - Cleans up deviation from daoTotalEthVUnits
      //   - Does NOT clear ebSnapshot.vUnits (stays at 15,000)
      const liquidateTx = await clusters.liquidate(
        clusterOwner.address,
        operatorIds,
        clusterAfterRegister
      );
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(
        clusters,
        liquidateReceipt,
        Events.CLUSTER_LIQUIDATED
      );

      // Verify post-liquidation state:
      // - Operator deviations cleaned to 0
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(
          0n,
          "Operator deviation should be 0 after liquidation cleanup"
        );
      }
      // - But ebSnapshot.vUnits NOT cleared (this is the root cause of the bug)
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(
        clusterVUnits,
        "EB snapshot vUnits should NOT be cleared by liquidation"
      );

      // Step 4: Remove the validator from the liquidated cluster
      //
      // _bulkRemoveValidator flow for liquidated clusters:
      //   1. Skips operator snapshot updates (cluster.active == false)
      //   2. cluster.validatorCount -= 1 → 0
      //   3. Enters EB cleanup: ebSnapshot.vUnits = 15000 > 0
      //      - Subtracts baseline: ebSnapshot.vUnits -= 10000 → 5000
      //      - validatorCount == 0, so cleans up remaining: 5000
      //      - operatorEthVUnits[i] -= 5000 → 0 - 5000 → UNDERFLOW!
      //
      // The deviation was already cleaned during liquidation (step 3), but
      // ebSnapshot.vUnits was not zeroed, so removeValidator tries to clean
      // it again, causing an arithmetic underflow.
      //
      // EXPECTED: Transaction succeeds (deviation already cleaned, skip redundant cleanup)
      // ACTUAL (BUG): Reverts with Panic(0x11) — arithmetic underflow
      const removeTx = await clusters.removeValidator(publicKey, operatorIds, liquidatedCluster);
      await removeTx.wait();
    });
  });
});
