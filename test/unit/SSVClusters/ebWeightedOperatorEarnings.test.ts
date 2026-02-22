import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const OPERATOR_FEE = 10_000_000_000n;

describe("EB-weighted operator earnings accumulation", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner1: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner1, clusterOwner2] = await connection.ethers.getSigners();
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

  it("operator earns proportionally from two clusters with EB=32 and EB=64", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const deposit = ethers.parseEther("100");

    const regTx1 = await clusters.connect(clusterOwner1).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const regTx2 = await clusters.connect(clusterOwner2).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const clusterId1 = getClusterId(clusterOwner1.address, operatorIds);
    const root1 = getEBRoot(clusterId1, 32);
    await clusters.mockSetEBRoot(1, root1);
    const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
      1, clusterOwner1.address, operatorIds, cluster1, 32, []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const clusterId2 = getClusterId(clusterOwner2.address, operatorIds);
    const root2 = getEBRoot(clusterId2, 64);
    await clusters.mockSetEBRoot(2, root2);
    await clusters.connect(clusterOwner2).updateClusterBalance(
      2, clusterOwner2.address, operatorIds, cluster2, 64, []
    );

    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(30000n);
    const [, , balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blocksMined = (await connection.ethers.provider.getBlockNumber()) - blockBeforeMine;

    await clusters.connect(clusterOwner1).removeValidator(makePublicKey(1), operatorIds, clusterAfterEB1);

    const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
    const earned = balanceAfter - balanceBefore;

    const blocksDelta = BigInt(blocksMined + 1);
    const expected = packedFee * blocksDelta * 30000n / VUNITS_PRECISION;
    expect(earned).to.equal(expected);

    const flatBaseline = packedFee * blocksDelta * 20000n / VUNITS_PRECISION;
    expect(earned).to.be.greaterThan(flatBaseline);
  });

  it("earnings split correctly at fee change boundary with EB-weighted vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const deposit = ethers.parseEther("100");

    const regTx = await clusters.connect(clusterOwner1).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
    );
    const receipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

    const clusterId = getClusterId(clusterOwner1.address, operatorIds);
    const root1 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);
    const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
      1, clusterOwner1.address, operatorIds, clusterAfterReg, 64, []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);
    expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(20000n);

    const [, snapshotBlock1, balancePhase1Start] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

    await networkHelpers.mine(50);

    const root2 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(2, root2);
    const ebTx2 = await clusters.connect(clusterOwner1).updateClusterBalance(
      2, clusterOwner1.address, operatorIds, clusterAfterEB1, 64, []
    );
    const ebReceipt2 = await ebTx2.wait();
    const clusterAfterEB2 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    const [, snapshotBlock2, balancePhase1End] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

    const phase1Blocks = BigInt(snapshotBlock2) - BigInt(snapshotBlock1);
    const expectedPhase1Delta = packedFee * phase1Blocks * 20000n / VUNITS_PRECISION;
    expect(balancePhase1End - balancePhase1Start).to.equal(expectedPhase1Delta);

    const NEW_OPERATOR_FEE = 5_000_000_000n;
    const newPackedFee = NEW_OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    await clusters.mockSetOperatorFee(operatorIds[0], NEW_OPERATOR_FEE);

    await networkHelpers.mine(50);

    const root3 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(3, root3);
    await clusters.connect(clusterOwner1).updateClusterBalance(
      3, clusterOwner1.address, operatorIds, clusterAfterEB2, 64, []
    );

    const settledBlock3 = await connection.ethers.provider.getBlockNumber();
    const [, , balancePhase2End] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

    const phase2Blocks = BigInt(settledBlock3) - BigInt(snapshotBlock2);
    const expectedPhase2Delta = newPackedFee * phase2Blocks * 20000n / VUNITS_PRECISION;
    expect(balancePhase2End - balancePhase1End).to.equal(expectedPhase2Delta);

    expect(balancePhase2End - balancePhase1End).to.be.lt(balancePhase1End - balancePhase1Start);
  });

  it("operator snapshot balance equals expected EB-weighted ETH after settlement", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const deposit = ethers.parseEther("100");

    const regTx = await clusters.connect(clusterOwner1).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
    );
    const receipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

    const clusterId = getClusterId(clusterOwner1.address, operatorIds);
    const root1 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);
    const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
      1, clusterOwner1.address, operatorIds, clusterAfterReg, 64, []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const [, snapshotBlock1, balanceAtSnapshot] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

    await networkHelpers.mine(100);
    const root2 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(2, root2);
    await clusters.connect(clusterOwner1).updateClusterBalance(
      2, clusterOwner1.address, operatorIds, clusterAfterEB1, 64, []
    );

    const harnessAddress = await clusters.getAddress();
    const harnessEthBefore = await connection.ethers.provider.getBalance(harnessAddress);
    await clusters.connect(clusterOwner1).mockWithdrawAllEthEarnings(operatorIds[0]);
    const withdrawalBlock = await connection.ethers.provider.getBlockNumber();
    const harnessEthAfter = await connection.ethers.provider.getBalance(harnessAddress);

    const totalBlocksDelta = BigInt(withdrawalBlock) - BigInt(snapshotBlock1);
    const newEarningsPacked = packedFee * totalBlocksDelta * 20000n / VUNITS_PRECISION;
    const expectedETH = (balanceAtSnapshot + newEarningsPacked) * ETH_DEDUCTED_DIGITS;
    expect(harnessEthBefore - harnessEthAfter).to.equal(expectedETH);

    const [, , balanceAfterWithdraw] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
    expect(balanceAfterWithdraw).to.equal(0n);
  });
});
