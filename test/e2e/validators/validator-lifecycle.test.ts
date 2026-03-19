import { expect } from 'chai';
import type { NetworkConnection } from 'hardhat/types/network';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { getCurrentClusterState, makeOperatorKey, makePublicKey, whitelistAddresses, setupTestContext } from '../../common/helpers.ts';
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
} from '../../common/constants.ts';
import {
  calcClusterBurn,
  calcOperatorFeeAccrual,
  defaultVUnits,
  getBlockNumber,
  getTxBlock,
  mineBlocks,
} from '../../helpers/index.ts';
import { ethers } from 'ethers';
import { Errors } from '../../common/errors.ts';
import { Events } from '../../common/events.ts';

describe("Validator Lifecycle", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

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

  describe("Register Validator — New Cluster with 4 Public Operators", () => {
    it("Registers validator, verifies default ETH fee applied, fees accrue correctly", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const regReceipt = await regTx.wait();
      const regBlock = BigInt(regReceipt!.blockNumber);

      await expect(regTx).to.emit(network, Events.VALIDATOR_ADDED);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(1n);
      }

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.balance)).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      await mineBlocks(provider, 100);

      const viewBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = viewBlock - regBlock;
      const vUnits = defaultVUnits(1n);
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earnings).to.equal(expectedEarnings);

      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const expectedBurn = calcClusterBurn({
        blockDiff,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits,
      });
      const expectedClusterBalance = DEFAULT_ETH_REGISTER_VALUE - expectedBurn;
      const clusterBalance = await views.getBalance(
        clusterOwner.address,
        operatorIds,
        cluster,
      );
      expect(clusterBalance).to.equal(expectedClusterBalance);
    });

    it("Register on operators with fee=0 — zero fee accrual", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, 0n);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );

      await mineBlocks(provider, 100);

      const earnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earnings).to.equal(0n);
    });
  });

  describe("Register Validator — Existing Cluster with Fee Settlement", () => {
    it("Adds validator to existing cluster, settles fees from first period", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const reg1Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const block1 = BigInt(await getTxBlock(reg1Tx));

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);

      await mineBlocks(provider, 50);

      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const vUnits1 = defaultVUnits(1n);
      const expectedEarningsBeforeSecond = calcOperatorFeeAccrual(earningsViewBlock - block1, packedFee, vUnits1) * ETH_DEDUCTED_DIGITS;
      const earningsBeforeSecond = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeSecond).to.equal(expectedEarningsBeforeSecond);

      const deposit2 = ethers.parseEther("5");

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

      expect(BigInt(cluster.validatorCount)).to.equal(2n);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(2n);
      }

      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const firstPeriodBurn = calcClusterBurn({
        blockDiff: block2 - block1,
        numOperators: BigInt(operatorIds.length),
        ethFee: packedFee,
        networkFee: packedNetworkFee,
        effectiveVUnits: vUnits1,
      });
      const expectedClusterBalance = DEFAULT_ETH_REGISTER_VALUE + deposit2 - firstPeriodBurn;
      expect(BigInt(cluster.balance)).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE + deposit2);
      expect(BigInt(cluster.balance)).to.equal(expectedClusterBalance);

      await mineBlocks(provider, 100);

      const earningsAfterSecondPeriod = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterSecondPeriod).to.be.greaterThan(
        earningsBeforeSecond,
      );
    });
  });

  describe("Register Validator on Private Operators", () => {
    it("Non-whitelisted caller reverts, whitelisted caller succeeds", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const customFee = 5_000_000_000n;
      const operatorIds = await registerOps(network, 4, customFee, true);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.isPrivate).to.equal(true);
      }

      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(1),
            operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.CALLER_NOT_WHITELISTED,
      );

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      await regTx.wait();

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.fee).to.equal(customFee);
        expect(opData.validatorCount).to.equal(1n);
      }
    });

    it("Mix of public and private operators in same cluster", async () => {
      const { network } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      for (let i = 1; i <= 2; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }
      for (let i = 3; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, true);
      }

      const operatorIds = [1, 2, 3, 4];

      await expect(
        network
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(1),
            operatorIds,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.CALLER_NOT_WHITELISTED,
      );

      await whitelistAddresses(network, operatorOwner, [3, 4], [
        clusterOwner.address,
      ]);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
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

  describe("Bulk Register Validators", () => {
    it("Bulk registers 3 validators, verifies counts and events", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("30");

      const pubkeys = [makePublicKey(1), makePublicKey(2), makePublicKey(3)];
      const shares = [DEFAULT_SHARES, DEFAULT_SHARES, DEFAULT_SHARES];

      const bulkTx = await network
        .connect(clusterOwner)
        .bulkRegisterValidator(pubkeys, operatorIds, shares, EMPTY_CLUSTER, {
          value: depositEth,
        });
      const bulkReceipt = await bulkTx.wait();

      const validatorAddedEvents = bulkReceipt!.logs.filter((log: any) => {
        try {
          const parsed = network.interface.parseLog(log);
          return parsed?.name === Events.VALIDATOR_ADDED;
        } catch {
          return false;
        }
      });
      expect(validatorAddedEvents.length).to.equal(3);

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(3n);
      expect(BigInt(cluster.balance)).to.equal(depositEth);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(3n);
      }

      const networkAddress = await network.getAddress();
      const contractBalance = await provider.getBalance(networkAddress);
      expect(contractBalance).to.be.greaterThanOrEqual(depositEth);
    });

    it("Bulk register with 0 public keys reverts EmptyPublicKeysList", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await expect(
        network
          .connect(clusterOwner)
          .bulkRegisterValidator([], operatorIds, [], EMPTY_CLUSTER, {
            value: DEFAULT_ETH_REGISTER_VALUE,
          }),
      ).to.be.revertedWithCustomError(network, Errors.EMPTY_PUBLIC_KEYS_LIST);
    });

    it("Bulk register with mismatched lengths reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(2)],
          operatorIds,
          [DEFAULT_SHARES],
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.PUBLIC_KEYS_SHARES_LENGTH_MISMATCH,
      );
    });

    it("Bulk register with duplicate key reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await expect(
        network.connect(clusterOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(1)],
          operatorIds,
          [DEFAULT_SHARES, DEFAULT_SHARES],
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_ALREADY_REGISTERED,
      );
    });
  });

  describe("Remove Validator — Fee Settlement and Count Adjustment", () => {
    it("Removes validator from 2-validator cluster, settles fees correctly", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const reg1Tx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const blockR1 = BigInt(await getTxBlock(reg1Tx));
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

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

      await mineBlocks(provider, 100);

      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsBeforeRemove = (
        calcOperatorFeeAccrual(blockR2 - blockR1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(earningsViewBlock - blockR2, packedFee, defaultVUnits(2n))
      ) * ETH_DEDUCTED_DIGITS;
      const earningsBeforeRemove = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeRemove).to.equal(expectedEarningsBeforeRemove);

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

      await expect(removeTx).to.emit(network, Events.VALIDATOR_REMOVED);

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(1n);
      expect(cluster.active).to.equal(true);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(1n);
      }

      const earningsAfterRemove = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterRemove).to.be.greaterThan(earningsBeforeRemove);

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

    it("Remove non-existent validator reverts with ValidatorDoesNotExist", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await expect(
        network
          .connect(clusterOwner)
          .removeValidator(makePublicKey(999), operatorIds, cluster),
      ).to.be.revertedWithCustomError(
        network,
        Errors.VALIDATOR_DOES_NOT_EXIST,
      );
    });
  });

  describe("Remove Last Validator — Cluster Balance Preservation", () => {
    it("Removes last validator, cluster persists with remaining balance", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("5");

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
      await mineBlocks(provider, 50);

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

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
      expect(cluster.active).to.equal(true);

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

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(BigInt(opId));
        expect(opData.validatorCount).to.equal(0n);
      }

      const ownerBalBefore = await provider.getBalance(
        clusterOwner.address,
      );
      const remainingBalance = BigInt(cluster.balance);
      const withdrawTx = await network
        .connect(clusterOwner)
        .withdraw(operatorIds, remainingBalance, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

      const ownerBalAfter = await provider.getBalance(
        clusterOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(
        remainingBalance,
      );
    });
  });

  describe("Full Validator Lifecycle", () => {
    it("Register → advance → remove → advance → withdraw — verifies complete lifecycle", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = 2_000_000_000n;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("20");

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
      const regBlock = BigInt(regReceipt!.blockNumber);

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );
      expect(BigInt(cluster.balance)).to.equal(depositEth);

      await mineBlocks(provider, 100);

      const vUnits = defaultVUnits(1n);
      const phase2ViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsPhase2 = calcOperatorFeeAccrual(phase2ViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earningsPhase2 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsPhase2).to.equal(expectedEarningsPhase2);

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

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

      await mineBlocks(provider, 50);

      const earningsPhase4 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );

      const earningsPhase4Later = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsPhase4Later).to.equal(earningsPhase4);

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(BigInt(operatorIds[0]));
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

      await expect(withdrawTx).to.emit(network, Events.OPERATOR_WITHDRAWN);

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const operatorWithdrawal = ownerBalAfter - ownerBalBefore + gasUsed;
      expect(operatorWithdrawal).to.equal(earningsPhase4);

      const earningsAfterWithdraw = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterWithdraw).to.equal(0n);

      const networkEarnings = await views.getNetworkEarnings();
      let totalOpEarnings = 0n;
      for (const opId of operatorIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }
      totalOpEarnings += operatorWithdrawal;

      const totalSystem =
        balanceAfterRemove + totalOpEarnings + networkEarnings;

      const diff =
        totalSystem > depositEth
          ? totalSystem - depositEth
          : depositEth - totalSystem;
      expect(diff).to.be.lessThanOrEqual(
        ETH_DEDUCTED_DIGITS * 10n,
      );
    });

    it("Verifies exact fee math with block-precise accounting", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = 2_000_000_000n;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      const depositEth = ethers.parseEther("20");

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
      const regBlock = BigInt(regReceipt!.blockNumber);

      await mineBlocks(provider, 100);

      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;

      const vUnits = defaultVUnits(1n);
      const expectedAccrualPacked = calcOperatorFeeAccrual(
        blockDiff,
        packedFee,
        vUnits,
      );
      const expectedAccrualWei = expectedAccrualPacked * ETH_DEDUCTED_DIGITS;

      const actualEarnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(actualEarnings).to.equal(expectedAccrualWei);

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

      expect(clusterBalance).to.be.lessThan(depositEth);
      expect(clusterBalance).to.equal(expectedClusterBalance);

      const networkEarnings = await views.getNetworkEarnings();
      let totalOpEarnings = 0n;
      for (const opId of operatorIds) {
        totalOpEarnings += await views.getOperatorEarnings(BigInt(opId));
      }
      const totalSystem = clusterBalance + totalOpEarnings + networkEarnings;
      const conservationDiff = totalSystem > depositEth
        ? totalSystem - depositEth
        : depositEth - totalSystem;
      expect(conservationDiff).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS * 100n);
    });
  });
});
