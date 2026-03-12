import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  makePublicKeys,
  makeOperatorKey,
  whitelistAddresses,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
  calcOperatorFeeAccrual,
} from "../helpers/index.ts";

describe("Validator Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, otherAccount] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  async function setupDefaultCluster(
    network: any,
    provider: any,
    owner: HardhatEthersSigner,
    opOwner: HardhatEthersSigner = operatorOwner,
    fee: bigint = MINIMAL_OPERATOR_ETH_FEE,
    operatorCount: number = 4,
  ): Promise<number[]> {
    const opIds: number[] = [];
    for (let i = 0; i < operatorCount; i++) {
      const seed = Math.floor(Math.random() * 100000) + i;
      await network
        .connect(opOwner)
        .registerOperator(makeOperatorKey(seed), fee, false);
      // IDs are sequential
      opIds.push(i + 1);
    }
    await whitelistAddresses(network, opOwner, opIds, [owner.address]);
    return opIds;
  }


  describe("Register Validator — Revert Cases", () => {
    it("Reverts with EmptyPublicKeysList on bulk register with empty array", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [],
          opIds,
          [],
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.EMPTY_PUBLIC_KEYS_LIST,
      );
    });

    it("Reverts with PublicKeysSharesLengthMismatch on mismatched key/share arrays", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(2)],
          opIds,
          [DEFAULT_SHARES],
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH,
      );
    });

    it("Reverts with InvalidPublicKeyLength on short public key", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // 32-byte key (should be 48)
      const shortKey = "0x" + "aa".repeat(32);

      await expect(
        network.connect(clusterOwner).registerValidator(
          shortKey,
          opIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INVALID_PUBLIC_KEYS_LENGTH,
      );
    });

    it("Reverts with InvalidOperatorIdsLength for < 4 operators", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          opIds.slice(0, 3), // only 3 operators
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INVALID_OPERATOR_IDS_LENGTH,
      );
    });

    it("Reverts with InvalidOperatorIdsLength for 5 operators (not 4,7,10,13)", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 5 operators
      const opIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i + 1);
      }
      await whitelistAddresses(network, operatorOwner, opIds, [clusterOwner.address]);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          opIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INVALID_OPERATOR_IDS_LENGTH,
      );
    });

    it("Reverts with UnsortedOperatorsList for unsorted operators", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const unsorted = [opIds[2], opIds[0], opIds[1], opIds[3]];

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          unsorted,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.UNSORTED_OPERATORS_LIST,
      );
    });

    it("Reverts with OperatorsListNotUnique for duplicate operators", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Duplicate: [1, 1, 2, 3]
      const dups = [opIds[0], opIds[0], opIds[1], opIds[2]];

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          dups,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.OPERATORS_LIST_NOT_UNIQUE,
      );
    });

    it("Reverts with ValidatorAlreadyRegistered when registering same validator twice", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const pk = makePublicKey(1);

      await network.connect(clusterOwner).registerValidator(
        pk,
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await expect(
        network.connect(clusterOwner).registerValidator(
          pk,
          opIds,
          DEFAULT_SHARES,
          cluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_ALREADY_REGISTERED,
      );
    });

    it("Reverts with IncorrectClusterState when passing wrong cluster struct", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const wrongCluster = { ...EMPTY_CLUSTER, validatorCount: 99n };

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(2),
          opIds,
          DEFAULT_SHARES,
          wrongCluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INCORRECT_CLUSTER_STATE,
      );
    });
  });

  describe("Remove Validator — Revert Cases", () => {
    it("Reverts with ValidatorDoesNotExist for non-existent validator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await expect(
        network.connect(clusterOwner).removeValidator(
          makePublicKey(999),
          opIds,
          cluster,
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_DOES_NOT_EXIST,
      );
    });

    it("Reverts with IncorrectValidatorStateWithData when wrong owner removes", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await expect(
        network.connect(otherAccount).removeValidator(
          makePublicKey(1),
          opIds,
          cluster,
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.CLUSTER_DOES_NOT_EXIST,
      );
    });

    it("Reverts with IncorrectClusterState with stale cluster struct", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await expect(
        network.connect(clusterOwner).removeValidator(
          makePublicKey(1),
          opIds,
          EMPTY_CLUSTER,
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INCORRECT_CLUSTER_STATE,
      );
    });

    it("Reverts with ValidatorDoesNotExist for bulk remove with empty array", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await expect(
        network.connect(clusterOwner).bulkRemoveValidator(
          [],
          opIds,
          cluster,
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_DOES_NOT_EXIST,
      );
    });
  });

  describe("Race condition — register and remove in same block", () => {
    it("Register then remove in same block — no double-counting", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster1 = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await mineBlocks(provider, 100);

      await provider.send("evm_setAutomine", [false]);

      const regPromise = network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        opIds,
        DEFAULT_SHARES,
        cluster1,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      const regTx = await regPromise;
      await regTx.wait();

      const cluster2 = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await provider.send("evm_setAutomine", [false]);

      const removePromise = network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        cluster2,
      );

      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      const removeTx = await removePromise;
      await removeTx.wait();

      const cluster3 = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      expect(BigInt(cluster3.validatorCount)).to.equal(1n);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }
    });
  });


  describe("Cluster balance underflow protection", () => {
    it("Cluster balance floors at 0 when fees exceed balance", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await mineBlocks(provider, 1_100_000_000);
      const balance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );

      expect(balance).to.equal(0n);
    });
  });

  describe("Exit validator — signal only, no state change", () => {
    it("exitValidator emits event but makes no state change", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const clusterBefore = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      const opStateBefore = await views.getOperatorById(BigInt(opIds[0]));

      const exitTx = await network
        .connect(clusterOwner)
        .exitValidator(makePublicKey(1), opIds);

      await expect(exitTx).to.emit(network, Events.VALIDATOR_EXITED);

      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(
        BigInt(clusterBefore.validatorCount),
      );

      const opStateAfter = await views.getOperatorById(BigInt(opIds[0]));
      expect(opStateAfter.validatorCount).to.equal(opStateBefore.validatorCount);

      const clusterCurrent = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        clusterCurrent,
      );
      await expect(removeTx).to.emit(network, Events.VALIDATOR_REMOVED);
    });

    it("exitValidator reverts with ValidatorDoesNotExist for non-existent validator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await expect(
        network
          .connect(clusterOwner)
          .exitValidator(makePublicKey(999), opIds),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_DOES_NOT_EXIST,
      );
    });

    it("exitValidator reverts with wrong operator IDs", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      for (let i = 0; i < 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(9000 + i), MINIMAL_OPERATOR_ETH_FEE, false);
      }
      const wrongOpIds = [5, 6, 7, 8];

      await expect(
        network
          .connect(clusterOwner)
          .exitValidator(makePublicKey(1), wrongOpIds),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INCORRECT_VALIDATOR_STATE,
      );
    });
  });

  describe("DAO network fee earnings — consistency with cluster accounting", () => {
    it("DAO earnings match cluster network fee payments", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      await mineBlocks(provider, 100);

      const viewBlock = BigInt(await getBlockNumber(provider));
      const daoBlockDiff = viewBlock - regBlock;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const daoEarningsUnits = (daoBlockDiff * packedNetworkFee * vUnits) / VUNITS_PRECISION;
      const expectedDaoEarnings = daoEarningsUnits * ETH_DEDUCTED_DIGITS;

      const daoEarnings = await views.getNetworkEarnings();
      expect(daoEarnings).to.equal(expectedDaoEarnings);

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      const currentBalance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );

      const totalFeesCharged = DEFAULT_ETH_REGISTER_VALUE - currentBalance;

      let totalOpEarnings = 0n;
      for (const opId of opIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }

      const sum = totalOpEarnings + daoEarnings;
      const diff = totalFeesCharged > sum ? totalFeesCharged - sum : sum - totalFeesCharged;
      expect(diff).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS * 4n);
    });
  });

  describe("Operator registration then immediate validator registration — same block", () => {
    it("Register operators and validator in same block — no error from zero blockDiff", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await provider.send("evm_setAutomine", [false]);

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(700 + i), fee, false);
      }
      const opIds = [1, 2, 3, 4];

      await network
        .connect(operatorOwner)
        .setOperatorsWhitelists(opIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(BigInt(cluster.balance)).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      await mineBlocks(provider, 1);
      const earnings = await views.getOperatorEarnings(1n);

      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const expectedEarnings = calcOperatorFeeAccrual(1n, packedFee, defaultVUnits(1n)) * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedEarnings);
    });
  });

  describe("Large number of operators (13) — gas and correctness", () => {
    it("Register validator with 13 operators — correct state and reasonable gas", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const opIds: number[] = [];
      for (let i = 1; i <= 13; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(800 + i), MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds, [
        clusterOwner.address,
      ]);

      const bigDeposit = ethers.parseEther("50");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: bigDeposit },
      );

      const receipt = await regTx.wait();

      expect(receipt!.gasUsed).to.be.greaterThan(0);

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(BigInt(cluster.balance)).to.equal(bigDeposit);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }

      await mineBlocks(provider, 100);

      const regBlock = BigInt(receipt!.blockNumber);
      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;

      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: 13n,
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const expectedBalance = bigDeposit - expectedBurn;

      const currentBalance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );
      expect(currentBalance).to.equal(expectedBalance);

      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      for (const opId of opIds) {
        const earnings = await views.getOperatorEarnings(BigInt(opId));
        expect(earnings).to.equal(expectedEarnings);
      }
    });
  });

  describe("Validator registration with explicit EB (post-updateClusterBalance)", () => {
    it("Adding validator to explicit-EB cluster adds default vUnits baseline", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        opIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(3),
        opIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      expect(BigInt(cluster.validatorCount)).to.equal(3n);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(3);
      }
    });
  });

  describe("Validator removal with implicit/explicit EB — full cluster empty", () => {
    it("Remove last validator — cluster persists with remaining balance", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      await mineBlocks(provider, 50);

      let cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        cluster,
      );
      const removeBlock = BigInt(await getTxBlock(removeTx));
      await expect(removeTx).to.emit(network, Events.VALIDATOR_REMOVED);

      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const blockDiff = removeBlock - regBlock;
      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - expectedBurn;

      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(0n);
      expect(clusterAfter.active).to.be.true;
      expect(BigInt(clusterAfter.balance)).to.equal(expectedBalance);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(0);
      }

      const withdrawTx = await network.connect(clusterOwner).withdraw(
        opIds,
        BigInt(clusterAfter.balance),
        clusterAfter,
      );
      await expect(withdrawTx).to.emit(network, Events.CLUSTER_WITHDRAWN);
    });
  });

  describe("Bulk remove validators — multiple removals in one transaction", () => {
    it("Bulk remove 3 of 5 validators — correct state after", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const keys = makePublicKeys(5, 1);
      let cluster = EMPTY_CLUSTER;

      for (let i = 0; i < 5; i++) {
        await network.connect(clusterOwner).registerValidator(
          keys[i],
          opIds,
          DEFAULT_SHARES,
          cluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        cluster = await getCurrentClusterState(
          connection, network, clusterOwner.address, opIds,
        );
      }

      expect(BigInt(cluster.validatorCount)).to.equal(5n);

      await mineBlocks(provider, 100);

      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      const keysToRemove = [keys[0], keys[1], keys[2]];
      const bulkRemoveTx = await network
        .connect(clusterOwner)
        .bulkRemoveValidator(keysToRemove, opIds, cluster);

      const receipt = await bulkRemoveTx.wait();

      const removedEvents = receipt!.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === Events.VALIDATOR_REMOVED;
        } catch {
          return false;
        }
      });
      expect(removedEvents.length).to.equal(3);

      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(2n);

      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(2);
      }

      const clusterForRemove = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      await expect(
        network.connect(clusterOwner).removeValidator(
          keys[3],
          opIds,
          clusterForRemove,
        ),
      ).to.emit(network, Events.VALIDATOR_REMOVED);
    });
  });

  describe("Deposit and withdraw — no side effects on operator state", () => {
    it("Deposit and withdraw do not change operator validator counts", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        opIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      const opsBefore: { validatorCount: number; fee: bigint }[] = [];
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        opsBefore.push({
          validatorCount: Number(op.validatorCount),
          fee: op.fee,
        });
      }

      const depositAmount = ethers.parseEther("5");
      const depositTx = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, opIds, cluster, {
          value: depositAmount,
        });
      await expect(depositTx).to.emit(network, Events.CLUSTER_DEPOSITED);

      for (let i = 0; i < opIds.length; i++) {
        const op = await views.getOperatorById(BigInt(opIds[i]));
        expect(op.validatorCount).to.equal(opsBefore[i].validatorCount);
        expect(op.fee).to.equal(opsBefore[i].fee);
      }

      const clusterAfterDeposit = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfterDeposit.balance)).to.equal(
        BigInt(cluster.balance) + depositAmount,
      );

      const withdrawAmount = ethers.parseEther("3");
      const withdrawTx = await network
        .connect(clusterOwner)
        .withdraw(opIds, withdrawAmount, clusterAfterDeposit);
      await expect(withdrawTx).to.emit(network, Events.CLUSTER_WITHDRAWN);

      for (let i = 0; i < opIds.length; i++) {
        const op = await views.getOperatorById(BigInt(opIds[i]));
        expect(op.validatorCount).to.equal(opsBefore[i].validatorCount);
      }

      const clusterAfterWithdraw = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfterWithdraw.validatorCount)).to.equal(2n);
    });
  });
});
