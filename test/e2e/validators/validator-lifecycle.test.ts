/**
 * OV-4 to OV-10: Validator Lifecycle Tests
 *
 * Covers: register validator (new cluster, existing cluster, private operators),
 * bulk register, remove validator, remove last validator, and full lifecycle.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makeOperatorKey,
  makePublicKey,
  makePublicKeys,
  whitelistAddresses,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  NETWORK_FEE,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcOperatorFeeAccrual,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Validator Lifecycle (OV-4 to OV-10)", function () {
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

  /** Helper: register N operators with given fee */
  async function registerOps(
    network: any,
    count: number,
    fee: bigint,
    isPrivate = false,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 1; i <= count; i++) {
      const id = await network
        .connect(operatorOwner)
        .registerOperator.staticCall(makeOperatorKey(i), fee, isPrivate);
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(i), fee, isPrivate);
      ids.push(Number(id));
    }
    return ids;
  }

  /** Fund an account with ETH */
  async function fundAccount(
    provider: any,
    address: string,
    amount: bigint,
  ) {
    await provider.send("hardhat_setBalance", [
      address,
      "0x" + (amount + 10n ** 18n).toString(16),
    ]);
  }

  // =========================================================================
  // OV-4: Register Validator — New Cluster with 4 Public Operators
  // =========================================================================
  describe("OV-4: Register Validator — New Cluster with 4 Public Operators", () => {
    it("OV-4: registers validator, verifies default ETH fee applied, fees accrue correctly", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      // Verify operators created
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.fee).to.equal(fee);
        expect(opData.validatorCount).to.equal(0n);
        expect(opData.isActive).to.equal(true);
      }

      // Whitelist cluster owner and fund
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, depositEth);

      // Register validator
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      const regReceipt = await regTx.wait();
      const regBlock = BigInt(regReceipt.blockNumber);

      // Verify ValidatorAdded event
      await expect(regTx).to.emit(network, "ValidatorAdded");

      // Verify operator state after registration
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(1n);
      }

      // Verify cluster state
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.balance)).to.equal(depositEth);

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Verify operator earnings after 100 blocks
      const viewBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = viewBlock - regBlock;
      const vUnits = defaultVUnits(1n);
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earnings).to.equal(expectedEarnings);

      // Verify cluster balance decreased
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const expectedClusterBalance = depositEth - expectedBurn;
      const clusterBalance = await views.getBalance(
        clusterOwner.address,
        operatorIds,
        cluster,
      );
      expect(clusterBalance).to.be.lessThan(depositEth);
      expect(clusterBalance).to.equal(expectedClusterBalance);
    });

    it("OV-4 edge: register on operators with fee=0 — zero fee accrual", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, 0n);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, depositEth);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );

      await mineBlocks(provider, 100);

      // Free operators should have 0 earnings
      const earnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earnings).to.equal(0n);
    });
  });

  // =========================================================================
  // OV-5: Register Validator — Existing Cluster with Fee Settlement
  // =========================================================================
  describe("OV-5: Register Validator — Existing Cluster with Fee Settlement", () => {
    it("OV-5: adds validator to existing cluster, settles fees from first period", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const deposit1 = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, deposit1);

      // Register first validator
      const reg1Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: deposit1 },
        );
      const block1 = BigInt(await getTxBlock(reg1Tx));

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);

      // Advance 50 blocks
      await mineBlocks(provider, 50);

      // Record operator earnings before second registration
      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const vUnits1 = defaultVUnits(1n);
      const expectedEarningsBeforeSecond = calcOperatorFeeAccrual(earningsViewBlock - block1, packedFee, vUnits1) * ETH_DEDUCTED_DIGITS;
      const earningsBeforeSecond = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeSecond).to.equal(expectedEarningsBeforeSecond);

      // Register second validator
      const deposit2 = ethers.parseEther("5");
      await fundAccount(provider, clusterOwner.address, deposit2);

      const reg2Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          cluster,
          { value: deposit2 },
        );
      const block2 = BigInt(await getTxBlock(reg2Tx));

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Verify cluster now has 2 validators
      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      // Verify each operator has 2 validators
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(2n);
      }

      // Verify cluster balance = deposit1 + deposit2 - fees for first period
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const firstPeriodBurn = calcClusterBurn({
        blockDiff: block2 - block1,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits1,
      });
      const expectedClusterBalance = deposit1 + deposit2 - firstPeriodBurn;
      expect(BigInt(cluster.balance)).to.be.lessThan(deposit1 + deposit2);
      expect(BigInt(cluster.balance)).to.equal(expectedClusterBalance);

      // Advance 100 more blocks at 2-validator rate
      await mineBlocks(provider, 100);

      // Verify earnings increased (now earning at 2-validator rate)
      const earningsAfterSecondPeriod = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterSecondPeriod).to.be.greaterThan(
        earningsBeforeSecond,
      );
    });
  });

  // =========================================================================
  // OV-6: Register Validator on Private Operators — Whitelist Enforcement
  // =========================================================================
  describe("OV-6: Register Validator on Private Operators", () => {
    it("OV-6: non-whitelisted caller reverts, whitelisted caller succeeds", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 private operators with custom fee
      const customFee = 5_000_000_000n; // 5 gwei
      const operatorIds = await registerOps(network, 4, customFee, true);

      // Verify operators are private
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.isPrivate).to.equal(true);
      }

      // Step 1: Non-whitelisted caller should fail
      const depositEth = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, depositEth);

      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(1),
            operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: depositEth },
          ),
      ).to.be.revertedWithCustomError(
        network,
        "CallerNotWhitelistedWithData",
      );

      // Step 2: Whitelist caller
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      // Step 3: Now registration should succeed
      await fundAccount(provider, clusterOwner.address, depositEth);
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      await regTx.wait();

      // Verify operators use custom fee (not default)
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.fee).to.equal(customFee);
        expect(opData.validatorCount).to.equal(1n);
      }
    });

    it("OV-6 edge: mix of public and private operators in same cluster", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 2 public and 2 private operators
      const fee = MINIMAL_OPERATOR_ETH_FEE;
      // Register public ops
      for (let i = 1; i <= 2; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }
      // Register private ops
      for (let i = 3; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, true);
      }

      const operatorIds = [1, 2, 3, 4];

      // Without whitelisting, should fail on private operators
      const depositEth = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, depositEth);
      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(1),
            operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: depositEth },
          ),
      ).to.be.revertedWithCustomError(
        network,
        "CallerNotWhitelistedWithData",
      );

      // Whitelist for private operators only
      await whitelistAddresses(network, operatorOwner, [3, 4], [
        clusterOwner.address,
      ]);

      // Now should succeed
      await fundAccount(provider, clusterOwner.address, depositEth);
      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
    });
  });

  // =========================================================================
  // OV-7: Bulk Register Validators (3 validators at once)
  // =========================================================================
  describe("OV-7: Bulk Register Validators", () => {
    it("OV-7: bulk registers 3 validators, verifies counts and events", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("30");
      await fundAccount(provider, clusterOwner.address, depositEth);

      const pubkeys = [makePublicKey(1), makePublicKey(2), makePublicKey(3)];
      const shares = [DEFAULT_SHARES, DEFAULT_SHARES, DEFAULT_SHARES];

      const bulkTx = await network
        .connect(clusterOwner)
        .bulkRegisterValidator(pubkeys, operatorIds, shares, EMPTY_CLUSTER, {
          value: depositEth,
        });
      const bulkReceipt = await bulkTx.wait();

      // Verify 3 ValidatorAdded events emitted
      const validatorAddedEvents = bulkReceipt.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === "ValidatorAdded";
        } catch {
          return false;
        }
      });
      expect(validatorAddedEvents.length).to.equal(3);

      // Verify cluster state
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(3n);
      expect(BigInt(cluster.balance)).to.equal(depositEth);

      // Verify each operator has 3 validators
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(3n);
      }

      // Verify contract received ETH
      const networkAddress = await network.getAddress();
      const contractBalance = await provider.getBalance(networkAddress);
      expect(contractBalance).to.be.greaterThanOrEqual(depositEth);
    });

    it("OV-7 edge: bulk register with 0 public keys reverts EmptyPublicKeysList", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await fundAccount(provider, clusterOwner.address, ethers.parseEther("10"));

      await expect(
        network
          .connect(clusterOwner)
          .bulkRegisterValidator([], operatorIds, [], EMPTY_CLUSTER, {
            value: ethers.parseEther("10"),
          }),
      ).to.be.revertedWithCustomError(network, "EmptyPublicKeysList");
    });

    it("OV-7 edge: bulk register with mismatched lengths reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await fundAccount(provider, clusterOwner.address, ethers.parseEther("10"));

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(2)],
          operatorIds,
          [DEFAULT_SHARES], // mismatched
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(
        network,
        "PublicKeysSharesLengthMismatch",
      );
    });

    it("OV-7 edge: bulk register with duplicate key reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await fundAccount(provider, clusterOwner.address, ethers.parseEther("20"));

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(1)], // duplicate
          operatorIds,
          [DEFAULT_SHARES, DEFAULT_SHARES],
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        ),
      ).to.be.revertedWithCustomError(
        network,
        "ValidatorAlreadyExistsWithData",
      );
    });
  });

  // =========================================================================
  // OV-8: Remove Validator — Fee Settlement and Count Adjustment
  // =========================================================================
  describe("OV-8: Remove Validator — Fee Settlement and Count Adjustment", () => {
    it("OV-8: removes validator from 2-validator cluster, settles fees correctly", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("10");
      await fundAccount(provider, clusterOwner.address, depositEth * 2n);

      // Register 2 validators
      const reg1Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      const blockR1 = BigInt(await getTxBlock(reg1Tx));
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await fundAccount(provider, clusterOwner.address, depositEth);
      const reg2Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          cluster,
          { value: ethers.parseEther("5") },
        );
      const blockR2 = BigInt(await getTxBlock(reg2Tx));
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      // Advance 100 blocks (fees accruing at 2-validator rate)
      await mineBlocks(provider, 100);

      // Record state before removal
      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsBeforeRemove = (
        calcOperatorFeeAccrual(blockR2 - blockR1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(earningsViewBlock - blockR2, packedFee, defaultVUnits(2n))
      ) * ETH_DEDUCTED_DIGITS;
      const earningsBeforeRemove = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeRemove).to.equal(expectedEarningsBeforeRemove);

      const clusterBalanceBefore = await views.getBalance(
        clusterOwner.address,
        operatorIds,
        cluster,
      );

      // Remove first validator
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      const removeTx = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      await removeTx.wait();

      await expect(removeTx).to.emit(network, "ValidatorRemoved");

      // Verify cluster state
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(cluster.active).to.equal(true);

      // Verify operator validator count decreased
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(1n);
      }

      // Verify earnings settled on removal
      const earningsAfterRemove = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterRemove).to.be.greaterThan(earningsBeforeRemove);

      // Verify second validator still exists
      // (Would revert if we try to remove a non-existent one)
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      const remove2Tx = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(2), operatorIds, cluster);
      await remove2Tx.wait();
    });

    it("OV-8 edge: remove non-existent validator reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await fundAccount(provider, clusterOwner.address, ethers.parseEther("10"));

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: ethers.parseEther("10") },
        );

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Try to remove a validator that doesn't exist
      await expect(
        network
          .connect(clusterOwner)
          .removeValidator(makePublicKey(999), operatorIds, cluster),
      ).to.be.revertedWithCustomError(
        network,
        "IncorrectValidatorStateWithData",
      );
    });
  });

  // =========================================================================
  // OV-9: Remove Last Validator — Cluster Balance Preservation
  // =========================================================================
  describe("OV-9: Remove Last Validator — Cluster Balance Preservation", () => {
    it("OV-9: removes last validator, cluster persists with remaining balance", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("5");
      await fundAccount(provider, clusterOwner.address, depositEth);

      // Register 1 validator
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      const regBlock = BigInt(await getTxBlock(regTx));

      // Advance 50 blocks
      await mineBlocks(provider, 50);

      // Remove last validator
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      const removeTx = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeBlock = BigInt(await getTxBlock(removeTx));

      // Verify cluster state after removal
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
      expect(cluster.active).to.equal(true); // cluster not deactivated

      // Cluster balance should equal deposit minus fees burned during the active period
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const burn = calcClusterBurn({
        blockDiff: removeBlock - regBlock,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      expect(BigInt(cluster.balance)).to.equal(depositEth - burn);

      // Verify each operator has 0 validators
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(0n);
      }

      // Step 2: Withdraw remaining balance
      const ownerBalBefore = await provider.getBalance(
        clusterOwner.address,
      );
      const remainingBalance = BigInt(cluster.balance);
      const withdrawTx = await network
        .connect(clusterOwner)
        .withdraw(operatorIds, remainingBalance, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt.gasUsed * withdrawReceipt.gasPrice;

      const ownerBalAfter = await provider.getBalance(
        clusterOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(
        remainingBalance,
      );
    });
  });

  // =========================================================================
  // OV-10: Full Validator Lifecycle — Register, Advance, Remove, Advance, Verify
  // =========================================================================
  describe("OV-10: Full Validator Lifecycle", () => {
    it("OV-10: register → advance → remove → advance → withdraw — verifies complete lifecycle", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = 2_000_000_000n; // 2 gwei
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 20_000
      const networkFee = NETWORK_FEE;
      const packedNetworkFee = networkFee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("20");
      await fundAccount(provider, clusterOwner.address, depositEth);

      // Phase 1: Register validator
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      const regReceipt = await regTx.wait();
      const regBlock = BigInt(regReceipt.blockNumber);

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.balance)).to.equal(depositEth);

      // Phase 2: Advance 100 blocks
      await mineBlocks(provider, 100);

      // Verify earnings accrued
      const vUnits = defaultVUnits(1n);
      const phase2ViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsPhase2 = calcOperatorFeeAccrual(phase2ViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earningsPhase2 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsPhase2).to.equal(expectedEarningsPhase2);

      // Phase 3: Remove validator
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      const balanceBeforeRemove = BigInt(cluster.balance);

      const removeTx = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeBlock = BigInt(await getTxBlock(removeTx));

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(0n);

      // Cluster balance decreased due to fee settlement
      const expectedBurn = calcClusterBurn({
        blockDiff: removeBlock - regBlock,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const balanceAfterRemove = BigInt(cluster.balance);
      expect(balanceAfterRemove).to.be.lessThan(depositEth);
      expect(balanceAfterRemove).to.equal(depositEth - expectedBurn);

      // Phase 4: Advance 50 blocks — no validators, no new fees
      await mineBlocks(provider, 50);

      // Operator earnings should not change (0 validators)
      const earningsPhase4 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      // The view function call itself takes a block, but with 0 validators
      // the earnings formula gives 0 additional
      const earningsPhase4Later = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsPhase4Later).to.equal(earningsPhase4);

      // Phase 5: Withdraw operator earnings
      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(BigInt(operatorIds[0]));
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt.gasUsed * withdrawReceipt.gasPrice;

      await expect(withdrawTx).to.emit(network, "OperatorWithdrawn");

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const operatorWithdrawal = ownerBalAfter - ownerBalBefore + gasUsed;
      // 0 validators since removal, so withdrawal = earningsPhase4 (no extra accrual)
      expect(operatorWithdrawal).to.equal(earningsPhase4);

      // Verify after withdrawal, earnings are 0 (or minimal from new block)
      const earningsAfterWithdraw = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterWithdraw).to.equal(0n); // 0 validators → 0 accrual

      // Verify system conservation:
      // clusterBalance + Σ(operatorEarnings) + daoEarnings == depositEth
      const networkEarnings = await views.getNetworkEarnings();
      let totalOpEarnings = 0n;
      for (const opId of operatorIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }
      // Op 1 was withdrawn, others weren't
      totalOpEarnings += operatorWithdrawal;

      // Total system: clusterBalance + totalOpEarnings + networkEarnings
      const totalSystem =
        balanceAfterRemove + totalOpEarnings + networkEarnings;
      // Should equal original deposit (within rounding due to packing)
      // Allow for small rounding from packed arithmetic
      const diff =
        totalSystem > depositEth
          ? totalSystem - depositEth
          : depositEth - totalSystem;
      expect(diff).to.be.lessThanOrEqual(
        ETH_DEDUCTED_DIGITS * 10n, // Allow for rounding in packed math
      );
    });

    it("OV-10: verifies exact fee math with block-precise accounting", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = 2_000_000_000n; // 2 gwei
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 20_000
      const networkFee = NETWORK_FEE;
      const packedNetworkFee = networkFee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("20");
      await fundAccount(provider, clusterOwner.address, depositEth);

      // Register validator
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: depositEth },
        );
      const regReceipt = await regTx.wait();
      const regBlock = BigInt(regReceipt.blockNumber);

      // Advance exactly 100 blocks
      await mineBlocks(provider, 100);

      // Calculate expected earnings using fee-calculator
      // Each operator: accrual = (blockDiff * packedFee * vUnits) / VUNITS_PRECISION
      // With 1 validator: vUnits = 10_000
      // Need to check actual block diff by querying
      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;

      const vUnits = defaultVUnits(1n); // 10_000
      const expectedAccrualPacked = calcOperatorFeeAccrual(
        blockDiff,
        packedFee,
        vUnits,
      );
      const expectedAccrualWei = expectedAccrualPacked * ETH_DEDUCTED_DIGITS;

      // Get actual earnings — view calls are static (eth_call) and don't mine blocks
      const actualEarnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(actualEarnings).to.equal(expectedAccrualWei);

      // Verify cluster balance via views
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      const expectedClusterBurn = calcClusterBurn({
        blockDiff,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const expectedClusterBalance = depositEth - expectedClusterBurn;
      const clusterBalance = await views.getBalance(
        clusterOwner.address,
        operatorIds,
        cluster,
      );

      // cluster balance should be less than deposit (fees were burned)
      expect(clusterBalance).to.be.lessThan(depositEth);
      expect(clusterBalance).to.equal(expectedClusterBalance);

      // Verify conservation: cluster + all operator earnings + network earnings ≈ deposit
      const networkEarnings = await views.getNetworkEarnings();
      let totalOpEarnings = 0n;
      for (const opId of operatorIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }
      const totalSystem = clusterBalance + totalOpEarnings + networkEarnings;
      const conservationDiff = totalSystem > depositEth
        ? totalSystem - depositEth
        : depositEth - totalSystem;
      // Allow for rounding from packed arithmetic
      expect(conservationDiff).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS * 100n);
    });
  });
});
