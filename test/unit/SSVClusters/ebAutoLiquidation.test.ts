import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";

// Operator fee: 1e10 wei/block (packed = 1e10 / 1e5 = 1e5)
const OPERATOR_FEE = 10_000_000_000n; // 1e10 wei/block

describe("F-2: EB auto-liquidation uses OLD vUnits after EB update", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  it("Cluster survives EB-increase auto-liquidation check but is liquidatable externally afterwards", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // --- Setup liquidation parameters ---
    // Set a network fee so liquidation threshold is meaningful
    const networkFeeRate = 100_000n; // packed fee units
    await clusters.mockEthNetworkFee(networkFeeRate);

    // minimumBlocksBeforeLiquidation: how many blocks of runway the cluster must have
    const minBlocksBeforeLiq = 100n;
    await clusters.mockMinimumBlocksBeforeLiquidation(minBlocksBeforeLiq);

    // Set minimum collateral to 0 so only threshold matters
    await clusters.mockMinimumLiquidationCollateral(0n);

    // --- Step 1: Register a validator with a carefully chosen deposit ---
    //
    // At EB=32 (baseline, vUnits=10000), the burn rate per block is:
    //   4 operators * packedOpFee + networkFee = 4 * 100_000 + 100_000 = 500_000 packed/block
    //   Liquidation threshold = minBlocks * totalRate * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS
    //                         = 100 * 500_000 * 10_000 / 10_000 * 100_000
    //                         = 100 * 500_000 * 100_000
    //                         = 5_000_000_000_000 wei (0.000005 ETH)
    //
    // At EB=2048 (vUnits=640000, 64x baseline), the threshold becomes:
    //   = 100 * 500_000 * 640_000 / 10_000 * 100_000
    //   = 100 * 500_000 * 64 * 100_000
    //   = 320_000_000_000_000 wei (0.00032 ETH)
    //
    // So deposit enough to be above threshold at 32 ETH rate, but below at 2048 ETH rate.
    const depositValue = ethers.parseEther("0.0001"); // 100_000_000_000_000 wei

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    expect(clusterAfterReg.active).to.equal(true);
    expect(clusterAfterReg.balance).to.be.gt(0n);

    // --- Step 2: Set initial EB to 32 (baseline) ---
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum1 = 1;
    const initialEB = 32;
    const root1 = getEBRoot(clusterId, initialEB);
    await clusters.mockSetEBRoot(ebBlockNum1, root1);

    const ebTx1 = await clusters.updateClusterBalance(
      ebBlockNum1,
      clusterOwner.address,
      operatorIds,
      clusterAfterReg,
      initialEB,
      []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Verify cluster is active and vUnits are at baseline
    expect(clusterAfterEB32.active).to.equal(true);
    const vUnitsAfterEB32 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAfterEB32).to.equal(VUNITS_PRECISION); // 10000 = 1 validator at 32 ETH

    // Verify cluster is NOT liquidatable at baseline rate
    await expect(
      clusters.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterAfterEB32
      )
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

    // --- Step 3: Oracle reports EB increase to 2048 ETH (64x) ---
    // This is the critical step. The auto-liquidation check inside
    // updateClusterBalance uses the OLD vUnits (10000) instead of the
    // new vUnits (640000). So the cluster won't be auto-liquidated
    // even though it should be at the new rate.
    const ebBlockNum2 = 2;
    const newEB = 2048;
    const root2 = getEBRoot(clusterId, newEB);
    await clusters.mockSetEBRoot(ebBlockNum2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      ebBlockNum2,
      clusterOwner.address,
      operatorIds,
      clusterAfterEB32,
      newEB,
      []
    );
    const ebReceipt2 = await ebTx2.wait();
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    // --- Step 4: Verify the bug ---
    // The cluster should still be active (auto-liquidation didn't fire)
    // because it checked with OLD vUnits (10000) where the cluster was solvent.
    expect(clusterAfterEB2048.active).to.equal(true,
      "BUG REPRODUCED: Cluster survived EB increase auto-liquidation check using OLD vUnits");

    // Verify that the new vUnits ARE now stored (they were applied after the check)
    const vUnitsAfterEB2048 = await clusters.getClusterVUnits(clusterId);
    const expectedNewVUnits = ((BigInt(newEB) * VUNITS_PRECISION) + 31n) / 32n;
    expect(vUnitsAfterEB2048).to.equal(expectedNewVUnits);
    expect(vUnitsAfterEB2048).to.equal(640000n); // 2048 * 10000 / 32

    // --- Step 5: Prove the cluster IS liquidatable now (external call) ---
    // The cluster is now deeply underwater at the new 2048 ETH rate,
    // but it wasn't auto-liquidated. An external liquidator can still catch it.
    const liquidateTx = await clusters.connect(liquidator).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB2048
    );
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(
      clusters,
      liquidateReceipt,
      Events.CLUSTER_LIQUIDATED
    );

    expect(clusterAfterLiquidation.active).to.equal(false,
      "External liquidation succeeds — proving the cluster WAS insolvent at new rate");
    expect(clusterAfterLiquidation.balance).to.equal(0n);

    // This test demonstrates the design limitation:
    // - Auto-liquidation during EB update: uses OLD vUnits → cluster escapes
    // - External liquidation after EB update: uses NEW vUnits → cluster caught
    // The gap between these two checks is the window where the cluster is
    // active but underwater, requiring an external liquidator to step in.
  });

  it("Auto-liquidation works correctly when cluster is insolvent at OLD vUnits too", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Set liquidation parameters
    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // Register with enough deposit to pass InsufficientBalance check,
    // but small enough that mining blocks will drain it below threshold
    const depositValue = ethers.parseEther("0.0001");
    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    // Set initial EB=32 (baseline)
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum1 = 1;
    const root1 = getEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(ebBlockNum1, root1);

    const ebTx1 = await clusters.updateClusterBalance(
      ebBlockNum1,
      clusterOwner.address,
      operatorIds,
      clusterAfterReg,
      32,
      []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Mine many blocks to drain the cluster below threshold even at baseline rate.
    // Per block burn at baseline: 4 * 100_000 + 100_000 = 500_000 packed = 500_000 * 100_000 = 50_000_000_000 wei/block
    // Threshold at baseline: 100 * 500_000 * 10_000 / 10_000 * 100_000 = 5_000_000_000_000 wei
    // Deposit: 100_000_000_000_000 wei. After ~2000 blocks: 100e12 - 2000*50e9 = 0 wei
    await networkHelpers.mine(2500);

    // Now do EB update — cluster should be auto-liquidated because it's
    // already insolvent at the OLD rate
    const ebBlockNum2 = 2;
    const root2 = getEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(ebBlockNum2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      ebBlockNum2,
      clusterOwner.address,
      operatorIds,
      clusterAfterEB32,
      2048,
      []
    );
    const ebReceipt2 = await ebTx2.wait();

    // When insolvent at OLD rate, auto-liquidation should fire
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterEB2048.active).to.equal(false,
      "Auto-liquidation correctly fires when cluster is insolvent at OLD vUnits");
  });
});
