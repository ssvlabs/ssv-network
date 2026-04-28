import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  setupTestContext,
  generateMerkleForClusterEB,
  makeOperatorKey,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

describe("Operator fee change + EB burn rate interaction", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const EB_64 = 64;

  const deployNetworkForFeeEbFixture = async () => {
    const { network, ssvToken } = await ssvNetworkFullFixture(connection);
    const [deployer, operatorOwner, clusterOwner, oracle1, oracle2, oracle3, oracle4, staker] =
      await connection.ethers.getSigners();

    await network.connect(deployer).replaceOracle(1, oracle1.address);
    await network.connect(deployer).replaceOracle(2, oracle2.address);
    await network.connect(deployer).replaceOracle(3, oracle3.address);
    await network.connect(deployer).replaceOracle(4, oracle4.address);

    await ssvToken.transfer(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);
    await network.connect(deployer).updateNetworkFee(0n);

    return {
      network,
      operatorOwner,
      clusterOwner,
      oracles: [oracle1, oracle2, oracle3] as HardhatEthersSigner[],
    };
  };

  const registerOperatorsWithFee = async (
    network: any,
    owner: HardhatEthersSigner,
    fee: bigint,
    count = 4
  ): Promise<bigint[]> => {
    const operatorIds: bigint[] = [];
    for (let i = 0; i < count; i += 1) {
      const operatorId = await network
        .connect(owner)
        .registerOperator.staticCall(makeOperatorKey(i + 1), fee, true);
      await network.connect(owner).registerOperator(makeOperatorKey(i + 1), fee, true);
      operatorIds.push(operatorId);
    }
    return operatorIds;
  };

  const clusterIdFor = (ownerAddress: string, operatorIds: bigint[]): string =>
    ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );

  const commitRootForCluster = async (
    network: any,
    oracles: HardhatEthersSigner[],
    clusterId: string,
    effectiveBalance: number
  ): Promise<{ blockNum: number; proof: string[] }> => {
    const { root, proofs } = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance }]);

    await networkHelpers.mine(1);
    const blockNum = await connection.ethers.provider.getBlockNumber();

    await network.connect(oracles[0]).commitRoot(root, blockNum);
    await network.connect(oracles[1]).commitRoot(root, blockNum);
    await network.connect(oracles[2]).commitRoot(root, blockNum);

    return { blockNum, proof: proofs[clusterId] };
  };

  const settleClusterAtEB = async (
    network: any,
    oracles: HardhatEthersSigner[],
    clusterOwner: HardhatEthersSigner,
    operatorIds: bigint[],
    cluster: Cluster,
    effectiveBalance: number
  ): Promise<{ cluster: Cluster; blockNumber: bigint }> => {
    const clusterId = clusterIdFor(clusterOwner.address, operatorIds);
    const { blockNum, proof } = await commitRootForCluster(network, oracles, clusterId, effectiveBalance);

    const tx = await network.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      proof
    );
    const receipt = await tx.wait();

    return {
      cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
      blockNumber: BigInt(receipt!.blockNumber),
    };
  };

  const registerAndSetEb64Cluster = async (
    network: any,
    operatorOwner: HardhatEthersSigner,
    clusterOwner: HardhatEthersSigner,
    oracles: HardhatEthersSigner[],
    operatorFee: bigint
  ): Promise<{ operatorIds: bigint[]; cluster: Cluster; settledBlock: bigint }> => {
    const operatorIds = await registerOperatorsWithFee(network, operatorOwner, operatorFee);
    await network.connect(operatorOwner).setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

    const registerTx = await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(network, registerReceipt, Events.VALIDATOR_ADDED);

    const settled = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      clusterAfterRegister,
      EB_64
    );

    return { operatorIds, cluster: settled.cluster, settledBlock: settled.blockNumber };
  };

  it("Operator fee increase on EB=64 cluster doubles burn rate", async function () {
    const { network, operatorOwner, clusterOwner, oracles } =
      await networkHelpers.loadFixture(deployNetworkForFeeEbFixture);

    const { operatorIds, cluster: clusterAtEb64 } = await registerAndSetEb64Cluster(
      network,
      operatorOwner,
      clusterOwner,
      oracles,
      MINIMAL_OPERATOR_ETH_FEE
    );

    const windowBlocks = 120n;

    await networkHelpers.mine(windowBlocks);
    const beforeIncrease = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      clusterAtEb64,
      EB_64
    );
    const deductionBeforeIncrease = clusterAtEb64.balance - beforeIncrease.cluster.balance;

    const doubledFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
    for (const operatorId of operatorIds) {
      await network.connect(operatorOwner).declareOperatorFee(operatorId, doubledFee);
    }

    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    for (const operatorId of operatorIds) {
      await network.connect(operatorOwner).executeOperatorFee(operatorId);
    }

    const afterIncreaseSettle = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      beforeIncrease.cluster,
      EB_64
    );

    await networkHelpers.mine(windowBlocks);
    const afterIncreaseWindow = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      afterIncreaseSettle.cluster,
      EB_64
    );
    const deductionAfterIncrease =
      afterIncreaseSettle.cluster.balance - afterIncreaseWindow.cluster.balance;

    expect(deductionAfterIncrease).to.equal(deductionBeforeIncrease * 2n);
  });

  it("Operator fee reduction on EB-weighted cluster lowers burn proportionally", async function () {
    const { network, operatorOwner, clusterOwner, oracles } =
      await networkHelpers.loadFixture(deployNetworkForFeeEbFixture);

    const highFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
    const { operatorIds, cluster: clusterAtEb64 } = await registerAndSetEb64Cluster(
      network,
      operatorOwner,
      clusterOwner,
      oracles,
      highFee
    );

    const windowBlocks = 120n;

    await networkHelpers.mine(windowBlocks);
    const highFeeWindow = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      clusterAtEb64,
      EB_64
    );
    const highFeeDeduction = clusterAtEb64.balance - highFeeWindow.cluster.balance;

    for (const operatorId of operatorIds) {
      await network.connect(operatorOwner).reduceOperatorFee(operatorId, MINIMAL_OPERATOR_ETH_FEE);
    }

    const afterReduceSettle = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      highFeeWindow.cluster,
      EB_64
    );

    await networkHelpers.mine(windowBlocks);
    const lowFeeWindow = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      afterReduceSettle.cluster,
      EB_64
    );
    const lowFeeDeduction = afterReduceSettle.cluster.balance - lowFeeWindow.cluster.balance;

    expect(highFeeDeduction).to.equal(lowFeeDeduction * 2n);
  });

  it("Fee execution boundary with EB=64 applies old and new rates to correct block ranges", async function () {
    const { network, operatorOwner, clusterOwner, oracles } =
      await networkHelpers.loadFixture(deployNetworkForFeeEbFixture);

    const { operatorIds, cluster: clusterAtEb64, settledBlock } = await registerAndSetEb64Cluster(
      network,
      operatorOwner,
      clusterOwner,
      oracles,
      MINIMAL_OPERATOR_ETH_FEE
    );

    const targetOperator = operatorIds[0];
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await network.connect(operatorOwner).declareOperatorFee(targetOperator, newFee);
    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    const executeTx = await network.connect(operatorOwner).executeOperatorFee(targetOperator);
    const executeReceipt = await executeTx.wait();
    const executeBlock = BigInt(executeReceipt!.blockNumber);

    await networkHelpers.mine(120n);

    const finalSettlement = await settleClusterAtEB(
      network,
      oracles,
      clusterOwner,
      operatorIds,
      clusterAtEb64,
      EB_64
    );
    const finalBlock = finalSettlement.blockNumber;

    const oldPackedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const newPackedFee = newFee / ETH_DEDUCTED_DIGITS;

    const oldSpanBlocks = executeBlock - settledBlock;
    const newSpanBlocks = finalBlock - executeBlock;

    const expectedIndexDelta =
      oldSpanBlocks * (oldPackedFee * 4n) +
      newSpanBlocks * (oldPackedFee * 3n + newPackedFee);

    const expectedDeduction =
      ((expectedIndexDelta * 20_000n) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const actualDeduction = clusterAtEb64.balance - finalSettlement.cluster.balance;
    expect(actualDeduction).to.equal(expectedDeduction);
  });
});
