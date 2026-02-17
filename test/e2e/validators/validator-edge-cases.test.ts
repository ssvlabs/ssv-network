/**
 * Validator edge-case tests: OV-19, OV-20, OV-22, OV-25, OV-26, OV-27, OV-30, OV-31, OV-32, OV-33, OV-34, OV-35
 */

import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makePublicKeys,
  makeOperatorKey,
  whitelistAddresses,
  getCurrentClusterState,
  parseClusterFromEvent,
  makeArrayOfKeysAndShares,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  SMALL_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
  calcOperatorFeeAccrual,
  snapshotContractBalance,
} from "../helpers/index.ts";

describe("Validator Edge Cases (OV-19, OV-20, OV-22, OV-25–OV-27, OV-30–OV-35)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, otherAccount, clusterOwner2] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  /**
   * Helper: register 4 operators, whitelist owner, fund owner.
   */
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
    await provider.send("hardhat_setBalance", [
      owner.address,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);
    return opIds;
  }

  // ──── OV-19: Register Validator — Revert Cases ────

  describe("OV-19: Register Validator — Revert Cases", () => {
    it("OV-19a: reverts with EmptyPublicKeysList on bulk register with empty array", async function () {
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

    it("OV-19b: reverts with PublicKeysSharesLengthMismatch on mismatched key/share arrays", async function () {
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

    it("OV-19c: reverts with InvalidPublicKeyLength on short public key", async function () {
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

    it("OV-19d: reverts with InvalidOperatorIdsLength for < 4 operators", async function () {
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

    it("OV-19e: reverts with InvalidOperatorIdsLength for 5 operators (not 4,7,10,13)", async function () {
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
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

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

    it("OV-19f: reverts with UnsortedOperatorsList for unsorted operators", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Unsorted: [3, 1, 2, 4]
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

    it("OV-19g: reverts with OperatorsListNotUnique for duplicate operators", async function () {
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

    it("OV-19h: reverts with ValidatorAlreadyExistsWithData when registering same validator twice", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      const pk = makePublicKey(1);

      // First registration succeeds
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

      // Second registration should revert
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
        Errors.VALIDATOR_ALREADY_EXISTS_WITH_DATA,
      );
    });

    it("OV-19i: reverts with IncorrectClusterState when passing wrong cluster struct", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register first validator
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Try second registration with stale (wrong) cluster state
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

  // ──── OV-20: Remove Validator — Revert Cases ────

  describe("OV-20: Remove Validator — Revert Cases", () => {
    it("OV-20a: reverts with IncorrectValidatorStateWithData for non-existent validator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register a validator
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

      // Try to remove a validator that was never registered
      await expect(
        network.connect(clusterOwner).removeValidator(
          makePublicKey(999),
          opIds,
          cluster,
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INCORRECT_VALIDATOR_STATE,
      );
    });

    it("OV-20b: reverts with IncorrectValidatorStateWithData when wrong owner removes", async function () {
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

      // otherAccount tries to remove — different owner hash means cluster hash mismatch
      // Since cluster is keyed by keccak256(owner, operatorIds), different owner = no cluster found
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

    it("OV-20c: reverts with IncorrectClusterState with stale cluster struct", async function () {
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

      // Pass EMPTY_CLUSTER (stale) instead of current state
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

    it("OV-20d: reverts with ValidatorDoesNotExist for bulk remove with empty array", async function () {
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

  // ──── OV-22: Race Condition — Register and Remove in Same Block ────

  describe("OV-22: Race condition — register and remove in same block", () => {
    it("OV-22: register then remove in same block — no double-counting", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register first validator
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

      // Advance some blocks to accrue fees
      await mineBlocks(provider, 100);

      // Disable auto-mining to execute both in same block
      await provider.send("evm_setAutomine", [false]);

      // Register second validator
      const regPromise = network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        opIds,
        DEFAULT_SHARES,
        cluster1,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // We need to get the updated cluster after the registration
      // Since automine is off, we mine manually
      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      const regTx = await regPromise;
      await regTx.wait();

      const cluster2 = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      // Now register and remove in same block
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

      // Final cluster state
      const cluster3 = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      // After add+remove: validatorCount should be 1 (started 1, added 1 to make 2, removed 1)
      expect(BigInt(cluster3.validatorCount)).to.equal(1n);

      // Operators should each have validatorCount == 1
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }
    });
  });

  // ──── OV-25: Cluster Balance Underflow Protection ────

  describe("OV-25: Cluster balance underflow protection", () => {
    it("OV-25: cluster balance floors at 0 when fees exceed balance", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register with a deposit sufficient to pass liquidation check
      // but small enough that advancing many blocks will exhaust it
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

      // Calculate blocks to exhaust the deposit:
      // Per-block burn in wei = ((4 * packedFee + packedNetworkFee) * vUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS
      // packedFee = 17_700, packedNetworkFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS = 30_000
      // vUnits = 10_000 (1 validator, implicit EB)
      // burn = ((4 * 17_700 + 30_000) * 10_000 / 10_000) * 100_000
      // burn = (70_800 + 30_000) * 100_000 = 100_800 * 100_000 = 10_080_000_000 wei/block
      //
      // Blocks needed to exhaust 10 ETH: 10^19 / 10_080_000_000 ≈ 992_063_492
      // We need MORE than this number of blocks to ensure the balance is fully exhausted.
      // Use 1_100_000_000 to be safe (some blocks may have passed during setup).
      await mineBlocks(provider, 1_100_000_000);

      // Get the cluster balance — should floor at 0, not revert
      const balance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );

      expect(balance).to.equal(0n);
    });
  });

  // ──── OV-26: Exit Validator — Signal Only, No State Change ────

  describe("OV-26: Exit validator — signal only, no state change", () => {
    it("OV-26a: exitValidator emits event but makes no state change", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register validator
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

      // Capture operator state before exit
      const opStateBefore = await views.getOperatorById(BigInt(opIds[0]));

      // Exit validator
      const exitTx = await network
        .connect(clusterOwner)
        .exitValidator(makePublicKey(1), opIds);

      // Verify event emitted
      await expect(exitTx).to.emit(network, "ValidatorExited");

      // Verify NO state change
      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(
        BigInt(clusterBefore.validatorCount),
      );

      const opStateAfter = await views.getOperatorById(BigInt(opIds[0]));
      expect(opStateAfter.validatorCount).to.equal(opStateBefore.validatorCount);

      // Validator can still be removed after exit
      const clusterCurrent = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        clusterCurrent,
      );
      await expect(removeTx).to.emit(network, "ValidatorRemoved");
    });

    it("OV-26b: exitValidator reverts for non-existent validator", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      await expect(
        network
          .connect(clusterOwner)
          .exitValidator(makePublicKey(999), opIds),
      ).to.be.revertedWithCustomError(
        network,
        Errors.INCORRECT_VALIDATOR_STATE,
      );
    });

    it("OV-26c: exitValidator reverts with wrong operator IDs", async function () {
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

      // Register 4 more operators to create a different set
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

  // ──── OV-27: DAO Network Fee Earnings — Consistency ────

  describe("OV-27: DAO network fee earnings — consistency with cluster accounting", () => {
    it("OV-27: DAO earnings match cluster network fee payments", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register validator
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      // Advance blocks
      await mineBlocks(provider, 100);

      // Get DAO network fee earnings — compute exact expected value
      // DAO formula: earningsUnits = (blockDiff * packedNetworkFee * vUnits) / VUNITS_PRECISION
      // earnings = earningsUnits * ETH_DEDUCTED_DIGITS
      // The fixture sets ETH network fee to NETWORK_FEE (382640000000n), packed = 3826400
      const viewBlock = BigInt(await getBlockNumber(provider));
      const daoBlockDiff = viewBlock - regBlock;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const daoEarningsUnits = (daoBlockDiff * packedNetworkFee * vUnits) / VUNITS_PRECISION;
      const expectedDaoEarnings = daoEarningsUnits * ETH_DEDUCTED_DIGITS;

      const daoEarnings = await views.getNetworkEarnings();
      expect(daoEarnings).to.equal(expectedDaoEarnings);

      // Get cluster balance to compute what was paid
      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      const currentBalance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );

      // The deposit minus current balance should account for operator fees + network fees
      // Network fees go to DAO, operator fees go to operators
      const totalFeesCharged = DEFAULT_ETH_REGISTER_VALUE - currentBalance;

      // Sum operator earnings
      let totalOpEarnings = 0n;
      for (const opId of opIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }

      // Conservation: totalFeesCharged == totalOpEarnings + daoEarnings
      // Allow small tolerance for block-boundary effects
      const sum = totalOpEarnings + daoEarnings;
      const diff = totalFeesCharged > sum ? totalFeesCharged - sum : sum - totalFeesCharged;
      expect(diff).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS * 4n); // tolerance of a few packing units
    });
  });

  // ──── OV-30: Operator Registration Then Immediate Validator Registration — Same Block ────

  describe("OV-30: Operator registration then immediate validator registration — same block", () => {
    it("OV-30: register operators and validator in same block — no error from zero blockDiff", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Disable automine
      await provider.send("evm_setAutomine", [false]);

      // Register 4 operators in pending pool
      const fee = MINIMAL_OPERATOR_ETH_FEE;
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(700 + i), fee, false);
      }
      const opIds = [1, 2, 3, 4];

      // Whitelist
      await network
        .connect(operatorOwner)
        .setOperatorsWhitelists(opIds, [clusterOwner.address]);

      // Fund cluster owner
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      // Register validator in the same pending block
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Mine all in one block
      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      // Verify state after same-block operations
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }

      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(BigInt(cluster.balance)).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      // Advance 1 block and verify exact earnings
      await mineBlocks(provider, 1);
      const earnings = await views.getOperatorEarnings(1n);
      // 1 block * packedFee * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS
      // = 1 * 17700 * 10000 / 10000 * 100000 = MINIMAL_OPERATOR_ETH_FEE
      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const expectedEarnings = calcOperatorFeeAccrual(1n, packedFee, defaultVUnits(1n)) * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedEarnings);
    });
  });

  // ──── OV-31: Large Number of Operators (13 Operators) — Gas and Correctness ────

  describe("OV-31: Large number of operators (13) — gas and correctness", () => {
    it("OV-31: register validator with 13 operators — correct state and reasonable gas", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 13 operators
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
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (100n * 10n ** 18n).toString(16),
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

      // Gas should be reasonable (not out-of-gas)
      expect(receipt!.gasUsed).to.be.greaterThan(0);

      // Verify cluster state
      const cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(BigInt(cluster.balance)).to.equal(bigDeposit);

      // Each of 13 operators should have validatorCount = 1
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(1);
      }

      // Advance 100 blocks and verify fee settlement
      await mineBlocks(provider, 100);

      const regBlock = BigInt(receipt!.blockNumber);
      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;

      // Compute exact settled balance
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

      // All 13 operators earn exactly the same (all have ethSnapshot.block = regBlock after registerValidator,
      // and pre-registration phantom index cancels out in the delta)
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      for (const opId of opIds) {
        const earnings = await views.getOperatorEarnings(BigInt(opId));
        expect(earnings).to.equal(expectedEarnings);
      }
    });
  });

  // ──── OV-32: Validator Registration with Explicit EB ────

  describe("OV-32: Validator registration with explicit EB (post-updateClusterBalance)", () => {
    it("OV-32: adding validator to explicit-EB cluster adds default vUnits baseline", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register 2 validators
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

      // At this point, the cluster has implicit EB (no updateClusterBalance called)
      // Adding a 3rd validator should work fine with implicit EB
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

      // Each operator should have validatorCount = 3
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(3);
      }
    });
  });

  // ──── OV-33: Validator Removal with Explicit EB — Full Cluster Empty ────

  describe("OV-33: Validator removal with implicit/explicit EB — full cluster empty", () => {
    it("OV-33: remove last validator — cluster persists with remaining balance", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register 1 validator
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));
      let cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      // Advance to accrue fees
      await mineBlocks(provider, 50);

      // Remove the last (only) validator
      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        cluster,
      );
      const removeBlock = BigInt(await getTxBlock(removeTx));
      await expect(removeTx).to.emit(network, "ValidatorRemoved");

      // Compute exact expected balance at removeValidator time
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

      // Verify cluster
      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(0n);
      expect(clusterAfter.active).to.be.true;
      expect(BigInt(clusterAfter.balance)).to.equal(expectedBalance);

      // Each operator should have validatorCount = 0
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(0);
      }

      // Owner can withdraw remaining balance
      const withdrawTx = await network.connect(clusterOwner).withdraw(
        opIds,
        BigInt(clusterAfter.balance),
        clusterAfter,
      );
      await expect(withdrawTx).to.emit(network, "ClusterWithdrawn");
    });
  });

  // ──── OV-34: Bulk Remove Validators — Multiple Removals in One Transaction ────

  describe("OV-34: Bulk remove validators — multiple removals in one transaction", () => {
    it("OV-34: bulk remove 3 of 5 validators — correct state after", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register 5 validators
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

      // Advance to accrue fees
      await mineBlocks(provider, 100);

      // Get current cluster state for removal
      cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );

      // Bulk remove 3 validators
      const keysToRemove = [keys[0], keys[1], keys[2]];
      const bulkRemoveTx = await network
        .connect(clusterOwner)
        .bulkRemoveValidator(keysToRemove, opIds, cluster);

      const receipt = await bulkRemoveTx.wait();

      // Should emit 3 ValidatorRemoved events
      const removedEvents = receipt!.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === "ValidatorRemoved";
        } catch {
          return false;
        }
      });
      expect(removedEvents.length).to.equal(3);

      // Verify final state
      const clusterAfter = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfter.validatorCount)).to.equal(2n);

      // Operators should have validatorCount = 2
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(op.validatorCount).to.equal(2);
      }

      // Remaining validators (keys[3] and keys[4]) should still be removable
      const clusterForRemove = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      await expect(
        network.connect(clusterOwner).removeValidator(
          keys[3],
          opIds,
          clusterForRemove,
        ),
      ).to.emit(network, "ValidatorRemoved");
    });
  });

  // ──── OV-35: Deposit and Withdraw — Verify No Side Effects on Operator State ────

  describe("OV-35: Deposit and withdraw — no side effects on operator state", () => {
    it("OV-35: deposit and withdraw do not change operator validator counts", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const opIds = await setupDefaultCluster(network, provider, clusterOwner);

      // Register 2 validators
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

      // Capture operator state before deposit
      const opsBefore: { validatorCount: number; fee: bigint }[] = [];
      for (const opId of opIds) {
        const op = await views.getOperatorById(BigInt(opId));
        opsBefore.push({
          validatorCount: op.validatorCount,
          fee: op.fee,
        });
      }

      // ── Deposit ──
      const depositAmount = ethers.parseEther("5");
      const depositTx = await network
        .connect(clusterOwner)
        .deposit(clusterOwner.address, opIds, cluster, {
          value: depositAmount,
        });
      await expect(depositTx).to.emit(network, "ClusterDeposited");

      // Verify operator state unchanged after deposit
      for (let i = 0; i < opIds.length; i++) {
        const op = await views.getOperatorById(BigInt(opIds[i]));
        expect(op.validatorCount).to.equal(opsBefore[i].validatorCount);
        expect(op.fee).to.equal(opsBefore[i].fee);
      }

      // Cluster balance should have increased
      const clusterAfterDeposit = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      // TODO(DISC-OV-8): deposit does NOT settle fees — balance = old + deposit with no deductions
      expect(BigInt(clusterAfterDeposit.balance)).to.equal(
        BigInt(cluster.balance) + depositAmount,
      );

      // ── Withdraw ──
      const withdrawAmount = ethers.parseEther("3");
      const withdrawTx = await network
        .connect(clusterOwner)
        .withdraw(opIds, withdrawAmount, clusterAfterDeposit);
      await expect(withdrawTx).to.emit(network, "ClusterWithdrawn");

      // Verify operator validator counts unchanged after withdraw
      for (let i = 0; i < opIds.length; i++) {
        const op = await views.getOperatorById(BigInt(opIds[i]));
        expect(op.validatorCount).to.equal(opsBefore[i].validatorCount);
      }

      // Cluster validatorCount should remain 2
      const clusterAfterWithdraw = await getCurrentClusterState(
        connection, network, clusterOwner.address, opIds,
      );
      expect(BigInt(clusterAfterWithdraw.validatorCount)).to.equal(2n);
    });
  });
});
