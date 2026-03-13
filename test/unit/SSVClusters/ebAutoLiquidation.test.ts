import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";

// Operator fee: 1e10 wei/block (packed = 1e10 / 1e5 = 1e5)
const OPERATOR_FEE = 10_000_000_000n; // 1e10 wei/block

describe("EB auto-liquidation on updateClusterBalance", async () => {
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

  const deployClustersWithFeeAndEightOperators = async () => {
    return ssvClustersHarnessFixture(connection, 8, OPERATOR_FEE);
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

  it("Auto-liquidates cluster when EB increase makes it insolvent at new rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // --- Setup liquidation parameters ---
    const networkFeeRate = 100_000n; // packed fee units
    await clusters.mockEthNetworkFee(networkFeeRate);

    const minBlocksBeforeLiq = 100n;
    await clusters.mockMinimumBlocksBeforeLiquidation(minBlocksBeforeLiq);

    // Set minimum collateral to 0 so only threshold matters
    await clusters.mockMinimumLiquidationCollateral(0n);

    // --- Step 1: Register a validator with a carefully chosen deposit ---
    //
    // At EB=32 (baseline, vUnits=10000), the burn rate per block is:
    //   4 operators * packedOpFee + networkFee = 4 * 100_000 + 100_000 = 500_000 packed/block
    //   Liquidation threshold = minBlocks * totalRate * vUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS
    //                         = 100 * 500_000 * 10_000 / 10_000 * 100_000
    //                         = 5_000_000_000_000 wei (0.000005 ETH)
    //
    // At EB=2048 (vUnits=640000, 64x baseline), the threshold becomes:
    //                         = 100 * 500_000 * 640_000 / 10_000 * 100_000
    //                         = 320_000_000_000_000 wei (0.00032 ETH)
    //
    // Deposit is above threshold at 32 ETH rate, but below at 2048 ETH rate.
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
    expect(vUnitsAfterEB32).to.equal(BPS_DENOMINATOR); // 10000 = 1 validator at 32 ETH

    // Verify cluster is NOT liquidatable at baseline rate
    await expect(
      clusters.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterAfterEB32
      )
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

    // --- Step 3: Oracle reports EB increase to 2048 ETH (64x) ---
    // The auto-liquidation check should use the NEW vUnits (640000).
    // Since the cluster's balance is below the threshold at the new rate,
    // it should be auto-liquidated during the updateClusterBalance call.
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

    // --- Step 4: Verify auto-liquidation fired ---
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterEB2048.active).to.equal(false,
      "Auto-liquidation should fire when EB increase makes cluster insolvent at new rate");
    expect(clusterAfterEB2048.balance).to.equal(0n);
  });

  it("Does NOT auto-liquidate when cluster is solvent at new EB rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Setup
    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // Large deposit — solvent even at 2048 ETH rate
    const depositValue = ethers.parseEther("1");
    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    // Set initial EB=32
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root1 = getEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 32, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Increase to 2048 ETH — cluster has plenty of balance, should stay active
    const root2 = getEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB32, 2048, []);
    const ebReceipt2 = await ebTx2.wait();
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAfterEB2048.active).to.equal(true,
      "Cluster with sufficient balance should NOT be auto-liquidated");

    // Verify vUnits updated
    const vUnits = await clusters.getClusterVUnits(clusterId);
    expect(vUnits).to.equal(640000n);

    // Verify external liquidation also fails (cluster is healthy)
    await expect(
      clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB2048)
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Auto-liquidates when cluster is already insolvent at old rate", async function () {
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
    const root1 = getEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 32, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Mine many blocks to drain the cluster below threshold even at baseline rate
    await networkHelpers.mine(2500);

    // EB update — cluster should be auto-liquidated (insolvent at both old and new rate)
    const root2 = getEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB32, 2048, []);
    const ebReceipt2 = await ebTx2.wait();

    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterEB2048.active).to.equal(false,
      "Auto-liquidation correctly fires when cluster is insolvent");
  });

  it("Blocks reentrant guarded calls during updateClusterBalance auto-liquidation callback", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFeeAndEightOperators);

    const Malicious = await connection.ethers.getContractFactory("MaliciousUpdateClusterBalance");
    const malicious = await Malicious.deploy(await clusters.getAddress());
    await malicious.waitForDeployment();

    const liquidationOps = operatorIds.slice(0, 4);
    const withdrawOps = operatorIds.slice(4, 8);
    const maliciousAddress = await malicious.getAddress();

    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const regLiquidationTx = await malicious.registerValidator(
      makePublicKey(1),
      liquidationOps,
      DEFAULT_SHARES,
      createCluster(),
      { value: ethers.parseEther("0.0001") }
    );
    const regLiquidationReceipt = await regLiquidationTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, regLiquidationReceipt, Events.VALIDATOR_ADDED);

    const liquidationClusterId = getClusterId(maliciousAddress, liquidationOps);
    await clusters.mockSetEBRoot(1, getEBRoot(liquidationClusterId, 32));

    const ebTx1 = await clusters.updateClusterBalance(
      1,
      maliciousAddress,
      liquidationOps,
      clusterAfterRegister,
      32,
      []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const regWithdrawTx = await malicious.registerValidator(
      makePublicKey(2),
      withdrawOps,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regWithdrawReceipt = await regWithdrawTx.wait();
    const clusterForWithdraw = parseClusterFromEvent(clusters, regWithdrawReceipt, Events.VALIDATOR_ADDED);

    await malicious.setReentryParams(withdrawOps, 0n, clusterForWithdraw);
    await clusters.mockSetEBRoot(2, getEBRoot(liquidationClusterId, 2048));
    await malicious.setLiquidationParams(2, liquidationOps, clusterAfterEB32, 2048, []);

    const attackTx = await malicious.attack();
    const attackReceipt = await attackTx.wait();
    const clusterAfterAttack = parseClusterFromEvent(clusters, attackReceipt, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterAttack.active).to.equal(false);
    expect(await malicious.attemptedReenter()).to.equal(true);
    expect(await malicious.reenterSucceeded()).to.equal(false);
  });
});
