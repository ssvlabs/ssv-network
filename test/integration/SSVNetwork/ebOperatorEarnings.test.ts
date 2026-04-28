import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import {
  registerOperators,
  registerDefaultCluster,
  registerDefaultClusters,
  generateMerkleForClusterEB,
  computeClusterId,
  setupTestContext,
} from '../../common/helpers.ts';
import {
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  STAKE_AMOUNT,
} from '../../common/constants.ts';
import { Errors } from "../../common/errors.ts";

const BLOCKS_TO_MINE = 100;

describe("SSVNetwork Integration tests - EB-Weighted Operator Earnings", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner] } = await setupTestContext());
  });

  const deployFullSSVNetworkFixture = async () => ssvNetworkFullFixture(connection);

  const setupOracles = async (network: any, ssvToken: any): Promise<HardhatEthersSigner[]> => {
    const allSigners = await connection.ethers.getSigners();
    const staker = allSigners[2];
    const oracles = allSigners.slice(10, 14);

    await ssvToken.mint(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);

    for (let i = 0; i < 4; i++) {
      await network.replaceOracle(i + 1, oracles[i].address);
    }
    return oracles;
  };

  const commitRoot = async (
    network: any,
    oracles: HardhatEthersSigner[],
    root: string,
    blockNum: number,
  ): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await network.connect(oracles[i]).commitRoot(root, blockNum);
    }
  };

  const toClusterArg = (cluster: any) => ({
    validatorCount: Number(cluster.validatorCount),
    networkFeeIndex: cluster.networkFeeIndex,
    index: cluster.index,
    active: cluster.active,
    balance: cluster.balance,
  });

  it("getOperatorEarnings reflects EB=64 uplift (2× vs baseline) after updateClusterBalance", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    const oracles = await setupOracles(network, ssvToken);

    const { cluster, operatorIds } = await registerDefaultCluster(
      connection, network, views, operatorOwner, clusterOwner
    );

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId, effectiveBalance: 64 },
    ]);
    const blockNum = (await connection.ethers.provider.getBlock('latest'))!.number;
    await commitRoot(network, oracles, root, blockNum);

    await network.updateClusterBalance(
      blockNum, clusterOwner.address, operatorIds.map(BigInt),
      toClusterArg(cluster), 64, proofs[clusterId]
    );

    const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);

    await networkHelpers.mine(BLOCKS_TO_MINE);
    const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);

    const expectedDelta = BigInt(BLOCKS_TO_MINE) * packedFee * 20000n / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS;
    expect(expectedDelta).to.equal(BigInt(BLOCKS_TO_MINE) * MINIMAL_OPERATOR_ETH_FEE * 2n);
    expect(earningsAfter - earningsBefore).to.equal(expectedDelta);

    expect(earningsAfter - earningsBefore).to.be.greaterThan(BigInt(BLOCKS_TO_MINE) * MINIMAL_OPERATOR_ETH_FEE);
  });

  it("getOperatorEarnings scales with combined vUnits from two clusters at EB=32 and EB=64", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    const oracles = await setupOracles(network, ssvToken);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    const registered = await registerDefaultClusters(connection, network, operatorIds, operatorOwner, 2);
    const [clusterInfo1, clusterInfo2] = registered.clusters;

    const clusterId1 = computeClusterId(clusterInfo1.owner.address, operatorIds);
    const clusterId2 = computeClusterId(clusterInfo2.owner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId: clusterId1, effectiveBalance: 32 },
      { clusterId: clusterId2, effectiveBalance: 64 },
    ]);

    const blockNum = (await connection.ethers.provider.getBlock('latest'))!.number;
    await commitRoot(network, oracles, root, blockNum);

    await network.updateClusterBalance(
      blockNum, clusterInfo1.owner.address, operatorIds.map(BigInt),
      toClusterArg(clusterInfo1.cluster), 32, proofs[clusterId1]
    );

    await network.updateClusterBalance(
      blockNum, clusterInfo2.owner.address, operatorIds.map(BigInt),
      toClusterArg(clusterInfo2.cluster), 64, proofs[clusterId2]
    );
    const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);

    await networkHelpers.mine(BLOCKS_TO_MINE);
    const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);

    const expectedDelta = BigInt(BLOCKS_TO_MINE) * packedFee * 30000n / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS;
    expect(expectedDelta).to.equal(BigInt(BLOCKS_TO_MINE) * MINIMAL_OPERATOR_ETH_FEE * 3n);
    expect(earningsAfter - earningsBefore).to.equal(expectedDelta);

    expect(earningsAfter - earningsBefore).to.be.gt(BigInt(BLOCKS_TO_MINE) * MINIMAL_OPERATOR_ETH_FEE * 2n);
  });

  it("withdrawAllOperatorEarnings transfers exact EB-weighted ETH after EB=64 accrual", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

    const oracles = await setupOracles(network, ssvToken);

    const { cluster, operatorIds } = await registerDefaultCluster(
      connection, network, views, operatorOwner, clusterOwner
    );

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId, effectiveBalance: 64 },
    ]);
    const blockNum = (await connection.ethers.provider.getBlock('latest'))!.number;
    await commitRoot(network, oracles, root, blockNum);
    await network.updateClusterBalance(
      blockNum, clusterOwner.address, operatorIds.map(BigInt),
      toClusterArg(cluster), 64, proofs[clusterId]
    );

    await networkHelpers.mine(BLOCKS_TO_MINE);

    const earningsBeforeWithdraw = await views.getOperatorEarnings(operatorIds[0]);

    const networkAddress = await network.getAddress();
    const networkEthBefore = await connection.ethers.provider.getBalance(networkAddress);

    await network.connect(operatorOwner).withdrawAllOperatorEarnings(operatorIds[0]);

    const networkEthAfter = await connection.ethers.provider.getBalance(networkAddress);
    const withdrawn = networkEthBefore - networkEthAfter;

    const oneBlockEB64 = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS * 2n * ETH_DEDUCTED_DIGITS;
    expect(withdrawn).to.equal(earningsBeforeWithdraw + oneBlockEB64);

    expect(await views.getOperatorEarnings(operatorIds[0])).to.equal(0n);
    expect(withdrawn).to.be.gte(BigInt(BLOCKS_TO_MINE) * MINIMAL_OPERATOR_ETH_FEE * 2n);
  });

  it("withdrawOperatorEarnings on EB=64 cluster uses explicit-EB weighted accrual", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const oracles = await setupOracles(network, ssvToken);

    const { cluster, operatorIds } = await registerDefaultCluster(
      connection, network, views, operatorOwner, clusterOwner
    );
    const operatorId = operatorIds[0];
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 64 }]);
    const blockNum = (await connection.ethers.provider.getBlock("latest"))!.number;
    await commitRoot(network, oracles, root, blockNum);
    await network.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds.map(BigInt),
      toClusterArg(cluster),
      64,
      proofs[clusterId]
    );

    await networkHelpers.mine(BLOCKS_TO_MINE);
    const earningsBeforeWithdraw = await views.getOperatorEarnings(operatorId);

    await network.connect(operatorOwner).withdrawOperatorEarnings(operatorId, earningsBeforeWithdraw);

    const remainingAfterWithdraw = await views.getOperatorEarnings(operatorId);
    const oneBlockAtEb64 = MINIMAL_OPERATOR_ETH_FEE * 2n;
    expect(remainingAfterWithdraw).to.equal(oneBlockAtEb64);
  });

  it("withdrawOperatorEarnings reverts after removing operator from explicit-EB cluster", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const oracles = await setupOracles(network, ssvToken);

    const { cluster, operatorIds } = await registerDefaultCluster(
      connection, network, views, operatorOwner, clusterOwner
    );
    const operatorId = operatorIds[0];
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 64 }]);
    const blockNum = (await connection.ethers.provider.getBlock("latest"))!.number;
    await commitRoot(network, oracles, root, blockNum);
    await network.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds.map(BigInt),
      toClusterArg(cluster),
      64,
      proofs[clusterId]
    );

    await network.connect(operatorOwner).removeOperator(operatorId);
    await expect(
      network.connect(operatorOwner).withdrawOperatorEarnings(operatorId, ETH_DEDUCTED_DIGITS)
    ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("withdrawOperatorEarnings reflects higher post-update accrual at EB=128", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const oracles = await setupOracles(network, ssvToken);

    const { cluster, operatorIds } = await registerDefaultCluster(
      connection, network, views, operatorOwner, clusterOwner
    );
    const operatorId = operatorIds[0];
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 128 }]);
    const blockNum = (await connection.ethers.provider.getBlock("latest"))!.number;
    await commitRoot(network, oracles, root, blockNum);
    await network.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds.map(BigInt),
      toClusterArg(cluster),
      128,
      proofs[clusterId]
    );

    await networkHelpers.mine(BLOCKS_TO_MINE);
    const earningsBeforeWithdraw = await views.getOperatorEarnings(operatorId);

    await network.connect(operatorOwner).withdrawOperatorEarnings(operatorId, earningsBeforeWithdraw);

    const remainingAfterWithdraw = await views.getOperatorEarnings(operatorId);
    const oneBlockAtEb128 = MINIMAL_OPERATOR_ETH_FEE * 4n;
    expect(remainingAfterWithdraw).to.equal(oneBlockAtEb128);
  });
});
