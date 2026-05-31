import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  setupTestContext,
  computeClusterId,
  mockEBAndUpdate,
  registerAndParseCluster,
  parseClusterFromEvent,
} from "../common/helpers.ts";
import { BPS_DENOMINATOR } from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { ethers } from "ethers";

/**
 * vUnits deviation accumulator round-trip invariant
 *
 * After a full cluster lifecycle cycle
 *   register -> updateClusterBalance(EB up) -> liquidate -> reactivate -> updateClusterBalance(EB down to baseline)
 * the DAO-wide accumulators must satisfy the deviation-only model identity:
 *   sp.daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR
 * (i.e. every per-operator deviation has netted to zero).
 *
 * Why this invariant?
 *   The deviation-only model (per OperatorLib.updateSnapshotSt and the protocol
 *   spec) says sp.daoTotalEthVUnits = sum over operators of
 *   (storedDeviation + baseline). So the identity above holds iff every
 *   operator's stored deviation has rolled back to zero across the cycle. A
 *   clean liquidation/reactivation cycle MUST net deviations to zero -- otherwise
 *   networkTotalEarnings (ProtocolLib.sol) either over- or under-collects against
 *   the cluster owners' real obligations.
 *
 * The Echidna suite's `echidna_vunits_deviation_consistent` property at
 * SSVAccountingEchidna.sol:1023 asserts the WEAKER identity
 * `daoTotalEthVUnits == sum(clusterEB.vUnits)` -- which can mirror a corruption
 * because both sides read from the same storage the SUT writes. This test
 * asserts the STRONGER endpoint identity (the deviation MUST net to zero, not
 * merely be consistent with itself) on a deterministic state-machine sequence
 * that the Echidna `action_*` surface does not chain together.
 */
describe("vUnits deviation invariant: register -> EB-up -> liquidate -> reactivate -> EB-down round-trips DAO accumulators", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  // Zero fees -> no fee-index drift dimension (orthogonal to the vUnits
  // deviation invariant we are probing).
  const OPERATOR_FEE = 0n;
  const NETWORK_FEE = 0n;
  const MIN_BLOCKS_BEFORE_LIQUIDATION = 2n;
  // Cluster funding: large enough to register without immediate liquidation,
  // small enough that raising the collateral floor in step 3 forces liquidation.
  const FUND = ethers.parseEther("1");
  // collateral floor above FUND to force liquidate in step 3.
  // PackedETH unpacks raw uint64 -> raw * ETH_DEDUCTED_DIGITS (= raw * 100_000).
  // raw = 2e13 -> 2 ETH floor.
  const FORCE_LIQ_COLLATERAL: bigint = 20_000_000_000_000n;

  const EB_HIGH = 64;     // 2x baseline (per validator)
  const EB_BASELINE = 32; // DEFAULT_EB_PER_VALIDATOR

  const deployClustersWithZeroFees = async () => {
    const result = await ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
    const { clusters } = result;
    await clusters.mockEthNetworkFee(NETWORK_FEE);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_BEFORE_LIQUIDATION);
    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockSetMinBlocksBetweenUpdates(0);
    return result;
  };

  it("DAO accumulator round-trips to baseline across the full lifecycle", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithZeroFees);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    // ---- pre-cycle ----
    expect(await clusters.getDaoEthValidatorCount()).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);

    // ---- step 1: register 1 validator ----
    const clusterAfterRegister = await registerAndParseCluster(clusters, operatorIds, 1, FUND);
    expect(clusterAfterRegister.active).to.equal(true);
    expect(clusterAfterRegister.balance).to.equal(FUND);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(1n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);

    // ---- step 2: updateClusterBalance EB-up to 64 ETH ----
    const { cluster: clusterAfterEBUp } = await mockEBAndUpdate(
      clusters,
      clusterOwner.address,
      operatorIds,
      clusterAfterRegister,
      EB_HIGH,
      1,
    );
    expect(clusterAfterEBUp.active).to.equal(true);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(1n);
    // EB=64 -> vUnits = (64/32) * BPS_DENOMINATOR = 2 * BPS_DENOMINATOR
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(2n * BPS_DENOMINATOR);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(2n * BPS_DENOMINATOR);

    // ---- step 3: liquidate (force via collateral floor) ----
    // burnRate is zero (no fees) so we cannot drive natural liquidation; raise
    // the collateral floor above cluster.balance to make isLiquidatableWithVUnits
    // at ClusterLib.sol:104 return true.
    await clusters.mockMinimumLiquidationCollateral(FORCE_LIQ_COLLATERAL);

    const liqTx = await clusters.connect(liquidator).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterEBUp,
    );
    const liqReceipt = await liqTx.wait();
    const clusterAfterLiquidate = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiquidate.active).to.equal(false);
    expect(clusterAfterLiquidate.balance).to.equal(0n);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    // per-operator deviation should be cleared after liquidation
    for (const opId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
    }
    // clusterEB.vUnits is INTENTIONALLY preserved across liquidate -> reactivate
    // (SSV-8 by-design per the 2026-04 Quantstamp v2.0.0 audit response).
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(2n * BPS_DENOMINATOR);

    // Drop the collateral floor so reactivate accepts FUND.
    await clusters.mockMinimumLiquidationCollateral(0n);

    // ---- step 4: reactivate ----
    const reactivateTx = await clusters.reactivate(operatorIds, clusterAfterLiquidate, { value: FUND });
    const reactivateReceipt = await reactivateTx.wait();
    const clusterAfterReactivate = parseClusterFromEvent(
      clusters,
      reactivateReceipt,
      Events.CLUSTER_REACTIVATED,
    );

    expect(clusterAfterReactivate.active).to.equal(true);
    expect(clusterAfterReactivate.balance).to.equal(FUND);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(1n);
    // The persisted clusterEB.vUnits is re-added on reactivate, so DAO accumulator
    // is back to baseline + persisted deviation.
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(2n * BPS_DENOMINATOR);

    // ---- step 5: updateClusterBalance EB-down to baseline (32 ETH) ----
    const { cluster: clusterAfterEBDown } = await mockEBAndUpdate(
      clusters,
      clusterOwner.address,
      operatorIds,
      clusterAfterReactivate,
      EB_BASELINE,
      2,
    );
    expect(clusterAfterEBDown.active).to.equal(true);

    // ---- TIER-A invariant assertion (post-cycle) ----
    const daoTotalEthVUnits = await clusters.getDaoTotalEthVUnits();
    const ethDaoValidatorCount = await clusters.getDaoEthValidatorCount();
    const baseline = BigInt(ethDaoValidatorCount) * BPS_DENOMINATOR;

    expect(daoTotalEthVUnits).to.equal(
      baseline,
      "TIER-A INVARIANT: daoTotalEthVUnits must equal ethDaoValidatorCount * BPS_DENOMINATOR after full cycle",
    );
    // Per-operator deviation must also round-trip to zero.
    for (const opId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(opId)).to.equal(
        0n,
        `Per-operator deviation for operator ${opId} should be zero post-cycle`,
      );
    }
    // clusterEB.vUnits should reflect the new baseline-EB (1 validator @ 32 ETH).
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
  });
});
