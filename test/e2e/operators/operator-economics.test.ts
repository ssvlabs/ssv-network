import { expect } from 'chai';
import type { NetworkConnection } from 'hardhat/types/network';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { getTestConnection } from '../../setup/connection.ts';
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { getCurrentClusterState, makeOperatorKey, makePublicKey, whitelistAddresses } from '../../common/helpers.ts';
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
} from '../../common/constants.ts';
import { calcOperatorFeeAccrual, defaultVUnits, getBlockNumber, getTxBlock, mineBlocks } from '../helpers/index.ts';
import { Events } from '../../common/events.ts';
import { Errors } from '../../common/errors.ts';
import { ethers } from 'ethers';

describe("Operator Economics", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwnerA: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    operatorOwner = signers[0];
    clusterOwnerA = signers[1];
    clusterOwnerB = signers[2];
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  async function registerOps(
    network: any,
    count: number,
    fee: bigint,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 1; i <= count; i++) {
      const id = await network
        .connect(operatorOwner)
        .registerOperator.staticCall(makeOperatorKey(i), fee, false);
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(i), fee, false);
      ids.push(Number(id));
    }
    return ids;
  }

  async function fundAndRegisterValidator(
    network: any,
    provider: any,
    signer: HardhatEthersSigner,
    operatorIds: number[],
    pubkey: string,
    depositEth: bigint,
    cluster: any,
  ) {
    return await network
      .connect(signer)
      .registerValidator(pubkey, operatorIds, DEFAULT_SHARES, cluster, {
        value: depositEth,
      });
  }

  describe("Operator Earnings Accumulation and Withdrawal", () => {
    it("Verifies exact earnings math with partial and full withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);

      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        DEFAULT_ETH_REGISTER_VALUE,
        EMPTY_CLUSTER,
      );

      const regBlock = BigInt(await getBlockNumber(provider));

      await mineBlocks(provider, 100);

      const vUnits = defaultVUnits(1n);
      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarnings1 = calcOperatorFeeAccrual(earningsViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earnings1 = await views.getOperatorEarnings(1n);
      expect(earnings1).to.equal(expectedEarnings1);

      const half = (earnings1 / (2n * ETH_DEDUCTED_DIGITS)) * ETH_DEDUCTED_DIGITS;
      const partialTx = await network
        .connect(operatorOwner)
        .withdrawOperatorEarnings(1n, half);
      await expect(partialTx).to.emit(network, Events.OPERATOR_WITHDRAWN);

      const partialBlock = BigInt(await getTxBlock(partialTx));
      const expectedAfterPartial = calcOperatorFeeAccrual(partialBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS - half;
      const earningsAfterPartial = await views.getOperatorEarnings(1n);
      expect(earningsAfterPartial).to.equal(expectedAfterPartial);

      await mineBlocks(provider, 50);
      const fullTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(1n);
      await expect(fullTx).to.emit(network, Events.OPERATOR_WITHDRAWN);
    });
  });

  describe("Fee Change During Active Cluster", () => {
    it("Verifies continuous fee accrual across fee change boundary", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const deposit = ethers.parseEther("30");
      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        deposit,
        EMPTY_CLUSTER,
      );

      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      for (let i = 2; i <= 3; i++) {
        await network
          .connect(clusterOwnerA)
          .registerValidator(
            makePublicKey(i),
            operatorIds,
            DEFAULT_SHARES,
            cluster,
            { value: ethers.parseEther("5") },
          );
        cluster = await getCurrentClusterState(
          connection,
          network,
          clusterOwnerA.address,
          operatorIds,
        );
      }

      const earningsBeforeDeclare = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );

      await mineBlocks(provider, 50);

      const currentFee = await views.getOperatorFee(BigInt(operatorIds[0]));
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(BigInt(operatorIds[0]), newFee);

      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await provider.send("evm_mine", []);

      const earningsBeforeExecute = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeExecute).to.be.greaterThan(earningsBeforeDeclare);

      const executeTx = await network
        .connect(operatorOwner)
        .executeOperatorFee(BigInt(operatorIds[0]));
      await executeTx.wait();

      const feeAfter = await views.getOperatorFee(BigInt(operatorIds[0]));
      expect(feeAfter).to.equal(newFee);

      await mineBlocks(provider, 100);

      const earningsAfterNewFee = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterNewFee).to.be.greaterThan(earningsBeforeExecute);

      const earningsOp2 = await views.getOperatorEarnings(
        BigInt(operatorIds[1]),
      );
      expect(earningsAfterNewFee).to.be.greaterThan(earningsOp2);
    });
  });

  describe("Multi-Cluster Operator — Earnings From Multiple Clusters", () => {
    it("Operator earns from two clusters, correct accounting on partial removal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
        clusterOwnerB.address,
      ]);

      const regA1Tx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        DEFAULT_ETH_REGISTER_VALUE,
        EMPTY_CLUSTER,
      );
      const blockA1 = BigInt(await getTxBlock(regA1Tx));
      let clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      const regA2Tx = await network
        .connect(clusterOwnerA)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          clusterA,
          { value: ethers.parseEther("5") },
        );
      const blockA2 = BigInt(await getTxBlock(regA2Tx));

      const regBTx = await network.connect(clusterOwnerB).bulkRegisterValidator(
        [makePublicKey(10), makePublicKey(11), makePublicKey(12)],
        operatorIds,
        [DEFAULT_SHARES, DEFAULT_SHARES, DEFAULT_SHARES],
        EMPTY_CLUSTER,
        { value: ethers.parseEther("20") },
      );
      const blockB = BigInt(await getTxBlock(regBTx));

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(opData.validatorCount).to.equal(5n);

      await mineBlocks(provider, 100);

      const viewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsAt100 = (
        calcOperatorFeeAccrual(blockA2 - blockA1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(blockB - blockA2, packedFee, defaultVUnits(2n)) +
        calcOperatorFeeAccrual(viewBlock - blockB, packedFee, defaultVUnits(5n))
      ) * ETH_DEDUCTED_DIGITS;
      const earningsAt100 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAt100).to.equal(expectedEarningsAt100);

      clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(1), operatorIds, clusterA);

      clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(2), operatorIds, clusterA);

      const opDataAfter = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opDataAfter.validatorCount).to.equal(3n);

      await mineBlocks(provider, 100);

      const earningsAt200 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAt200).to.be.greaterThan(earningsAt100);

      const earningsOp2 = await views.getOperatorEarnings(
        BigInt(operatorIds[1]),
      );
      const earningsOp3 = await views.getOperatorEarnings(
        BigInt(operatorIds[2]),
      );
      const earningsOp4 = await views.getOperatorEarnings(
        BigInt(operatorIds[3]),
      );
      expect(earningsAt200).to.equal(earningsOp2);
      expect(earningsAt200).to.equal(earningsOp3);
      expect(earningsAt200).to.equal(earningsOp4);
    });
  });

  describe("Operator Removal After All Validators Removed", () => {
    it("Removes validators then operator, verifies final earnings withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const reg1Tx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        DEFAULT_ETH_REGISTER_VALUE,
        EMPTY_CLUSTER,
      );
      const blockR1 = BigInt(await getTxBlock(reg1Tx));
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      const reg2Tx = await network
        .connect(clusterOwnerA)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          cluster,
          { value: ethers.parseEther("5") },
        );
      const blockR2 = BigInt(await getTxBlock(reg2Tx));

      await mineBlocks(provider, 100);

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      const removeVal1Tx = await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      const blockV1 = BigInt(await getTxBlock(removeVal1Tx));

      const opAfterRemove1 = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemove1.validatorCount).to.equal(1n);

      await mineBlocks(provider, 50);

      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      const removeVal2Tx = await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(2), operatorIds, cluster);
      const blockV2 = BigInt(await getTxBlock(removeVal2Tx));

      const opAfterRemove2 = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemove2.validatorCount).to.equal(0n);

      await mineBlocks(provider, 50);

      const expectedEarnings = (
        calcOperatorFeeAccrual(blockR2 - blockR1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(blockV1 - blockR2, packedFee, defaultVUnits(2n)) +
        calcOperatorFeeAccrual(blockV2 - blockV1, packedFee, defaultVUnits(1n))
      ) * ETH_DEDUCTED_DIGITS;

      const earningsBeforeRemoval = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeRemoval).to.equal(expectedEarnings);
      await mineBlocks(provider, 50);
      const earningsAfterMoreBlocks = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterMoreBlocks).to.equal(earningsBeforeRemoval);

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(BigInt(operatorIds[0]));
      const removeReceipt = await removeTx.wait();
      const removeGas =
        removeReceipt!.gasUsed * removeReceipt!.gasPrice;

      await expect(removeTx)
        .to.emit(network, Events.OPERATOR_REMOVED)
        .withArgs(BigInt(operatorIds[0]));

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const netTransfer = ownerBalAfter - ownerBalBefore + removeGas;
      expect(netTransfer).to.equal(expectedEarnings);
      expect(netTransfer).to.equal(earningsBeforeRemoval);

      const opAfterRemoval = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemoval.isActive).to.equal(false);
      expect(opAfterRemoval.owner).to.equal(operatorOwner.address); // owner preserved

      await expect(
        network.connect(operatorOwner).removeOperator(BigInt(operatorIds[0])),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  describe("withdrawAllVersionOperatorEarnings — Combined ETH + SSV", () => {
    it("Withdraws both ETH and SSV earnings in single call", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const regTx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        DEFAULT_ETH_REGISTER_VALUE,
        EMPTY_CLUSTER,
      );
      const regBlock = BigInt(await getTxBlock(regTx));
      const vUnits = defaultVUnits(1n);

      await mineBlocks(provider, 100);

      const ethViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEthEarnings = calcOperatorFeeAccrual(ethViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const ethEarnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(ethEarnings).to.equal(expectedEthEarnings);

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(BigInt(operatorIds[0]));
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;
      const withdrawBlock = BigInt(await getTxBlock(withdrawTx));

      const expectedTransfer = calcOperatorFeeAccrual(withdrawBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const netTransfer = ownerBalAfter - ownerBalBefore + gasUsed;
      expect(netTransfer).to.equal(expectedTransfer);

      const earningsAfter = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfter).to.be.lessThan(ethEarnings);
    });

    it("Only ETH earnings, no SSV — SSV transfer skipped", async () => {
      const { network } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOps(network, 4, MINIMAL_OPERATOR_ETH_FEE);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        DEFAULT_ETH_REGISTER_VALUE,
        EMPTY_CLUSTER,
      );

      await mineBlocks(provider, 50);

      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(BigInt(operatorIds[0]));
      const receipt = await withdrawTx.wait();
      expect(receipt!.status).to.equal(1);
    });

    it("Zero earnings in both versions — no reverts, no transfers", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(1n);
      const receipt = await withdrawTx.wait();
      expect(receipt!.status).to.equal(1);
    });
  });
});
