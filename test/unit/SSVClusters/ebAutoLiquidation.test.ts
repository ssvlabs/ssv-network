import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";
const OPERATOR_FEE = 10_000_000_000n;

describe("EB auto-liquidation on updateClusterBalance", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const deployClustersWithFeeAndEightOperators = async () => {
    return ssvClustersHarnessFixture(connection, 8, OPERATOR_FEE);
  };



  it("Auto-liquidates cluster when EB increase makes it insolvent at new rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const networkFeeRate = 100_000n;
    await clusters.mockEthNetworkFee(networkFeeRate);

    const minBlocksBeforeLiq = 100n;
    await clusters.mockMinimumBlocksBeforeLiquidation(minBlocksBeforeLiq);
    await clusters.mockMinimumLiquidationCollateral(0n);
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

    expect(clusterAfterReg.active).to.equal(true);
    expect(clusterAfterReg.balance).to.be.gt(0n);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum1 = 1;
    const initialEB = 32;
    const root1 = computeEBRoot(clusterId, initialEB);
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
    expect(clusterAfterEB32.active).to.equal(true);
    const vUnitsAfterEB32 = await clusters.getClusterVUnits(clusterId);
    expect(vUnitsAfterEB32).to.equal(VUNITS_PRECISION);
    await expect(
      clusters.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterAfterEB32
      )
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
    const ebBlockNum2 = 2;
    const newEB = 2048;
    const root2 = computeEBRoot(clusterId, newEB);
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
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterEB2048.active).to.equal(false,
      "Auto-liquidation should fire when EB increase makes cluster insolvent at new rate");
    expect(clusterAfterEB2048.balance).to.equal(0n);
  });

  it("Does NOT auto-liquidate when cluster is solvent at new EB rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);
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
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root1 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 32, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);
    const root2 = computeEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB32, 2048, []);
    const ebReceipt2 = await ebTx2.wait();
    const clusterAfterEB2048 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAfterEB2048.active).to.equal(true,
      "Cluster with sufficient balance should NOT be auto-liquidated");
    const vUnits = await clusters.getClusterVUnits(clusterId);
    expect(vUnits).to.equal(640000n);
    await expect(
      clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB2048)
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Auto-liquidates when cluster is already insolvent at old rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);
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
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root1 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 32, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);
    await networkHelpers.mine(2500);
    const root2 = computeEBRoot(clusterId, 2048);
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

    const liquidationClusterId = computeClusterId(maliciousAddress, liquidationOps);
    await clusters.mockSetEBRoot(1, computeEBRoot(liquidationClusterId, 32));

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
    await clusters.mockSetEBRoot(2, computeEBRoot(liquidationClusterId, 2048));
    await malicious.setLiquidationParams(2, liquidationOps, clusterAfterEB32, 2048, []);

    const attackTx = await malicious.attack();
    const attackReceipt = await attackTx.wait();
    const clusterAfterAttack = parseClusterFromEvent(clusters, attackReceipt, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterAttack.active).to.equal(false);
    expect(await malicious.attemptedReenter()).to.equal(true);
    expect(await malicious.reenterSucceeded()).to.equal(false);
  });
});
