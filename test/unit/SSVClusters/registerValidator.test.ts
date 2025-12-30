import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvClustersHarnessFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { calculateUpdatedClusterState, clusterToTuple, makePublicKey } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import type { BigNumberish } from 'ethers';
import { Errors } from '../../common/errors.ts';

describe("SSVClusters function `registerValidator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  it("Registers a new validator, creates new cluster with the expected data and emits correct events", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const initialDaoCount = BigInt(await clusters.getDaoEthValidatorCount());
    const initialDaoBalance = BigInt(await clusters.getDaoEthBalance());
    const initialDaoIndexBlock = BigInt(await clusters.getDaoEthIndexBlockNumber());
    const initialOpCounts = await Promise.all(operatorIds.map(async (opId: BigNumberish) => BigInt(await clusters.getOperatorEthValidatorCount(opId))));
    const initialSnapshots = await Promise.all(operatorIds.map(async (opId: BigNumberish) => await clusters.getOperatorEthSnapshot(opId)));
    const initialBlock = BigInt(await connection.ethers.provider.getBlockNumber());

    const publicKey = makePublicKey(1);

    const tx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const expectedCluster = await calculateUpdatedClusterState(
      clusters,
      clusterOwner.address,
      operatorIds,
      EMPTY_CLUSTER,
      connection,
      false,
      DEFAULT_ETH_REGISTER_VALUE,
      1n // deltaValidatorCount
    );

    await expect(tx).to.emit(clusters, Events.VALIDATOR_ADDED).withArgs(clusterOwner.address, operatorIds, publicKey, DEFAULT_SHARES, clusterToTuple(expectedCluster));

    const hashedValidator = connection.ethers.keccak256(connection.ethers.solidityPacked(["bytes", "address"], [publicKey, clusterOwner.address]));
    const expectedValidatorData = connection.ethers.keccak256(connection.ethers.solidityPacked(["uint64[]"], [operatorIds]));
    expect(await clusters.getValidatorData(publicKey, clusterOwner.address)).to.equal(expectedValidatorData);

    const hashedCluster = connection.ethers.keccak256(connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]));
    const expectedClusterTuple = clusterToTuple(expectedCluster);
    const hashTuple = [
      expectedCluster.validatorCount,
      expectedCluster.networkFeeIndex,
      expectedCluster.index,
      expectedCluster.balance,
      expectedCluster.active
    ];
    const expectedClusterHash = connection.ethers.keccak256(
      connection.ethers.solidityPacked(["uint32", "uint64", "uint64", "uint256", "bool"], hashTuple)
    );
    expect(await clusters.getClusterHash(hashedCluster)).to.equal(expectedClusterHash);

    expect(BigInt(await clusters.getDaoEthValidatorCount())).to.equal(initialDaoCount + 1n);
    expect(BigInt(await clusters.getDaoEthBalance())).to.gte(initialDaoBalance);
    const afterBlock = BigInt(await connection.ethers.provider.getBlockNumber());
    expect(BigInt(await clusters.getDaoEthIndexBlockNumber())).to.equal(afterBlock);

    for (let j = 0; j < operatorIds.length; j++) {
      const opId = operatorIds[j];
      expect(BigInt(await clusters.getOperatorEthValidatorCount(opId))).to.equal(initialOpCounts[j] + 1n);

      const [afterIndex, afterBlockNum, afterBalance] = await clusters.getOperatorEthSnapshot(opId);
      const initialIndex = BigInt(initialSnapshots[j][0]);
      const initialBlockNum = BigInt(initialSnapshots[j][1]);
      const initialBalance = BigInt(initialSnapshots[j][2]);
      const fee = BigInt(await clusters.getOperatorEthFee(opId));

      const deltaBlocks = afterBlock - initialBlockNum;
      const expectedIndex = initialIndex + deltaBlocks * fee;
      expect(BigInt(afterIndex)).to.equal(expectedIndex);

      const initialVUnits = BigInt(await clusters.getOperatorEthVUnits(opId));
      if (initialVUnits > 0n && deltaBlocks > 0n) {
        const delta = (deltaBlocks * fee * initialVUnits) / 10000n;
        expect(BigInt(afterBalance)).to.equal(initialBalance + delta);
      } else {
        expect(BigInt(afterBalance)).to.equal(initialBalance);
      }

      expect(BigInt(afterBlockNum)).to.equal(afterBlock);
    }

    const afterClusterVUnits = BigInt(await clusters.getClusterVUnits(hashedCluster));
    expect(afterClusterVUnits).to.equal(0n);
    for (const opId of operatorIds) {
      const afterOpVUnits = BigInt(await clusters.getOperatorEthVUnits(opId));
      expect(afterOpVUnits).to.equal(0n);
    }
  });

  it("Fuzz: Registers a new validator, creates new cluster with the expected data and emits correct events", async function () {
    const fuzzRuns = 100;
    for (let i = 0; i < fuzzRuns; i++) {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture); // Moved this inside to reset each time

      const initialDaoCount = BigInt(await clusters.getDaoEthValidatorCount());
      const initialDaoBalance = BigInt(await clusters.getDaoEthBalance());
      const initialOpCounts = await Promise.all(operatorIds.map(async (opId: BigNumberish) => BigInt(await clusters.getOperatorEthValidatorCount(opId))));
      const initialSnapshots = await Promise.all(operatorIds.map(async (opId: BigNumberish) => await clusters.getOperatorEthSnapshot(opId)));

      const pkSeed = Math.floor(Math.random() * 1000) + 1;
      const publicKey = makePublicKey(pkSeed);

      const depositEth = Math.floor(Math.random() * 90) + 10;
      const depositValue = connection.ethers.parseEther(depositEth.toString());

      const tx = await clusters.registerValidator(
        publicKey,
        operatorIds,
        DEFAULT_SHARES,
        0,
        EMPTY_CLUSTER,
        { value: depositValue }
      );

      const expectedCluster = await calculateUpdatedClusterState(
        clusters,
        clusterOwner.address,
        operatorIds,
        EMPTY_CLUSTER,
        connection,
        false,
        depositValue,
        1n // deltaValidatorCount
      );

      await expect(tx).to.emit(clusters, Events.VALIDATOR_ADDED).withArgs(
        clusterOwner.address,
        operatorIds,
        publicKey,
        DEFAULT_SHARES,
        clusterToTuple(expectedCluster)
      );

      const expectedValidatorData = connection.ethers.keccak256(connection.ethers.solidityPacked(["uint64[]"], [operatorIds]));
      expect(await clusters.getValidatorData(publicKey, clusterOwner.address)).to.equal(expectedValidatorData);

      const hashedCluster = connection.ethers.keccak256(connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]));
      const hashTuple = [
        expectedCluster.validatorCount,
        expectedCluster.networkFeeIndex,
        expectedCluster.index,
        expectedCluster.balance,
        expectedCluster.active
      ];
      const expectedClusterHash = connection.ethers.keccak256(
        connection.ethers.solidityPacked(["uint32", "uint64", "uint64", "uint256", "bool"], hashTuple)
      );
      expect(await clusters.getClusterHash(hashedCluster)).to.equal(expectedClusterHash);

      expect(BigInt(await clusters.getDaoEthValidatorCount())).to.equal(initialDaoCount + 1n);
      expect(BigInt(await clusters.getDaoEthBalance())).to.gte(initialDaoBalance);
      const afterBlock = BigInt(await connection.ethers.provider.getBlockNumber());
      expect(BigInt(await clusters.getDaoEthIndexBlockNumber())).to.equal(afterBlock);

      for (let j = 0; j < operatorIds.length; j++) {
        const opId = operatorIds[j];
        expect(BigInt(await clusters.getOperatorEthValidatorCount(opId))).to.equal(initialOpCounts[j] + 1n);

        const [afterIndex, afterBlockNum, afterBalance] = await clusters.getOperatorEthSnapshot(opId);
        const initialIndex = BigInt(initialSnapshots[j][0]);
        const initialBlockNum = BigInt(initialSnapshots[j][1]);
        const initialBalance = BigInt(initialSnapshots[j][2]);
        const fee = BigInt(await clusters.getOperatorEthFee(opId));

        const deltaBlocks = afterBlock - initialBlockNum;
        const expectedIndex = initialIndex + deltaBlocks * fee;
        expect(BigInt(afterIndex)).to.equal(expectedIndex);

        const initialVUnits = BigInt(await clusters.getOperatorEthVUnits(opId));
        if (initialVUnits > 0n && deltaBlocks > 0n) {
          const delta = (deltaBlocks * fee * initialVUnits) / 10000n;
          expect(BigInt(afterBalance)).to.equal(initialBalance + delta);
        } else {
          expect(BigInt(afterBalance)).to.equal(initialBalance);
        }

        expect(BigInt(afterBlockNum)).to.equal(afterBlock);
      }

      const afterClusterVUnits = BigInt(await clusters.getClusterVUnits(hashedCluster));
      expect(afterClusterVUnits).to.equal(0n);
      for (const opId of operatorIds) {
        const afterOpVUnits = BigInt(await clusters.getOperatorEthVUnits(opId));
        expect(afterOpVUnits).to.equal(0n);
      }
    }
  });

  it("Is reverted with 'InvalidPublicKeyLength' when public key is empty or has invalid length", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const emptyPublicKey = '0x';
    const invalidLengthPublicKey = makePublicKey(1) + "11";

    await expect(clusters.registerValidator(
      emptyPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);

    await expect(clusters.registerValidator(
      invalidLengthPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PUBLIC_KEYS_LENGTH);
  });

  it("Is reverter with 'PublicKeysSharesLengthMismatch' if there is a mismatch between public keys and shares", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.bulkRegisterValidator(
      [makePublicKey(1)], // 1 pk
      operatorIds,
      [], // 0 shares
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH);
  });

  it("Is reverted with 'ValidatorAlreadyExistsWithData' if trying to register already existing key", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    await clusters.registerValidator(publicKey, operatorIds, DEFAULT_SHARES, 0, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });

    await expect(clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
      )).to.be.revertedWithCustomError(clusters, Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA).withArgs(publicKey);
  });

  it("Is reverted with 'InvalidOperatorIdsLength' if the length is not allowed one for clusters", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [2n, 1n, 2n];

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_OPERATOR_IDS_LENGTH);
  });

  it("Is reverted with 'UnsortedOperatorsList' if the list of operator ids is not sorted", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const operatorIds = [4n, 3n, 2n, 1n]; // no duplicates, just unsorted

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.UNSORTED_OPERATORS_LIST);
  });

  it("Is reverted with 'OperatorsListNotUnique' if the list of operator ids has duplications", async function () {
    const { clusters } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    let operatorIds = [1n, 1n, 2n, 4n]; // sorted but has duplicate

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.OPERATORS_LIST_NOT_UNIQUE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when trying to register to a liquidated cluster", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    EMPTY_CLUSTER.active = false;

    await expect(clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });
});