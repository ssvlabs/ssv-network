import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  parseClusterFromEvent,
  extractEventArgs,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  SMALL_ETH_REGISTER_VALUE,
  DEDUCTED_DIGITS,
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEFAULT_OPERATOR_ETH_FEE,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { mineBlocks, registerOperatorsSSV, whitelistAddresses } from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;


describe("Full End-to-End — SSV Cluster Creation -> Fee Accrual -> Migration -> ETH Fee Accrual -> Withdraw -> Verify All Balances", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, operatorOwner] } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(connection);

    const operatorIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const expectedId = await legacyNetwork.connect(clusterOwner)
        .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      await legacyNetwork.connect(clusterOwner)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      operatorIds.push(Number(expectedId));
    }

    const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
    await ssvToken.mint(clusterOwner.address, ssvDeposit);
    await ssvToken.connect(clusterOwner).approve(
      await legacyNetwork.getAddress(), ssvDeposit,
    );

    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
    );
    let cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection, legacyNetwork, legacyViews,
    );

    return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster, ssvDeposit };
  };

  it("Verifies complete economic correctness across full lifecycle", async function () {
    const { network, views, ssvToken, operatorIds, cluster, ssvDeposit } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await mineBlocks(provider, 500);

    const ssvBalanceBefore = await views.getBalanceSSV(
      clusterOwner.address, operatorIds, cluster,
    );
    const ssvBurnRate = await views.getBurnRateSSV(
      clusterOwner.address, operatorIds, cluster,
    );
    expect(ssvBalanceBefore).to.be.greaterThan(0n);
    expect(ssvBalanceBefore).to.be.lessThan(ssvDeposit);

    const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

    const ethDeposit = ethers.parseEther("10");
    const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
      operatorIds, cluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

    const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const actualSSVRefund = BigInt(migrateEventArgs.ssvRefunded);

    const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
    const tokenRefund = ownerSSVAfter - ownerSSVBefore;
    expect(tokenRefund).to.equal(actualSSVRefund);

    const expectedRefund = ssvBalanceBefore - ssvBurnRate;
    expect(actualSSVRefund).to.equal(expectedRefund);
    expect(actualSSVRefund).to.be.lessThan(ssvDeposit);

    const totalSSVFees = ssvDeposit - actualSSVRefund;
    expect(totalSSVFees % DEDUCTED_DIGITS).to.equal(0n);
    expect(actualSSVRefund + totalSSVFees).to.equal(ssvDeposit);

    const migratedCluster = parseClusterFromEvent(
      network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH,
    );
    expect(BigInt(migratedCluster.balance)).to.equal(ethDeposit);
    expect(migratedCluster.active).to.equal(true);
    expect(BigInt(migratedCluster.validatorCount)).to.equal(2n);

    await mineBlocks(provider, 200);

    const ethBalanceAfterAccrual = await views.getBalance(
      clusterOwner.address, operatorIds, migratedCluster,
    );
    expect(ethBalanceAfterAccrual).to.be.lessThan(ethDeposit);
    expect(ethBalanceAfterAccrual).to.be.greaterThan(0n);

    const withdrawAmount = ethers.parseEther("1");
    const ownerETHBefore = await provider.getBalance(clusterOwner.address);

    const withdrawTx = await network.connect(clusterOwner).withdraw(
      operatorIds,
      withdrawAmount,
      migratedCluster,
    );
    const withdrawReceipt = await withdrawTx.wait();
    await expect(withdrawTx).to.emit(network, Events.CLUSTER_WITHDRAWN);

    const clusterAfterWithdraw = parseClusterFromEvent(
      network, withdrawReceipt, Events.CLUSTER_WITHDRAWN,
    );

    expect(BigInt(clusterAfterWithdraw.balance)).to.be.lessThan(ethDeposit - withdrawAmount);
    expect(BigInt(clusterAfterWithdraw.balance)).to.be.greaterThan(0n);

    const ownerETHAfter = await provider.getBalance(clusterOwner.address);
    const gasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;
    expect(ownerETHAfter).to.equal(ownerETHBefore + withdrawAmount - gasCost);

    for (const opId of operatorIds) {
      const opETH = await views.getOperatorById(opId);
      expect(opETH.validatorCount).to.equal(2);
      const opSSV = await views.getOperatorByIdSSV(opId);
      expect(opSSV.validatorCount).to.equal(0);
    }

    expect(await views.getNetworkValidatorsCount()).to.equal(2);

    const finalBalance = await views.getBalance(
      clusterOwner.address, operatorIds, clusterAfterWithdraw,
    );
    expect(finalBalance).to.be.lessThanOrEqual(BigInt(clusterAfterWithdraw.balance));
    expect(finalBalance).to.be.greaterThan(0n);
  });

  describe("CAT-1-1: Healthy Legacy Cluster -> Upgrade -> Migration -> ETH Lifecycle", () => {
    const deployCat11Fixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
      await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const totalSsvDeposit = TOKEN_REGISTER_AMOUNT * 3n;
      await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), totalSsvDeposit,
      );

      const validatorKeys = [makePublicKey(1101), makePublicKey(1102), makePublicKey(1103)];
      let cluster = EMPTY_CLUSTER;
      for (const key of validatorKeys) {
        await legacyNetwork.connect(clusterOwner).registerValidator(
          key,
          operatorIds,
          DEFAULT_SHARES,
          TOKEN_REGISTER_AMOUNT,
          cluster,
        );
        cluster = await getCurrentClusterState(
          connection, legacyNetwork, clusterOwner.address, operatorIds,
        );
      }

      await mineBlocks(connection.ethers.provider, 100);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return {
        network: newNetwork,
        views: newViews,
        ssvToken,
        operatorIds,
        cluster,
        validatorKeys,
        totalSsvDeposit,
      };
    };

    it("Pins the exact CAT-1-1 legacy-to-ETH lifecycle", async function () {
      const { network, views, ssvToken, operatorIds, cluster, validatorKeys, totalSsvDeposit } =
        await networkHelpers.loadFixture(deployCat11Fixture);
      const provider = connection.ethers.provider;

      expect(await views.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_SSV);

      const preMigrationBalance = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(preMigrationBalance).to.be.greaterThan(0n);
      expect(preMigrationBalance).to.be.lessThan(totalSsvDeposit);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1199), operatorIds, DEFAULT_SHARES, cluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).deposit(
          clusterOwner.address, operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds, cluster, { value: SMALL_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, SMALL_ETH_REGISTER_VALUE, cluster),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      const removeTx = await network.connect(clusterOwner).removeValidator(
        validatorKeys[0], operatorIds, cluster,
      );
      const removeReceipt = await removeTx.wait();
      const clusterAfterRemove = parseClusterFromEvent(
        network, removeReceipt, Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(2n);
      expect(clusterAfterRemove.active).to.equal(true);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        const opETH = await views.getOperatorById(opId);
        expect(opSSV.validatorCount).to.equal(2);
        expect(opETH.validatorCount).to.equal(0);
      }

      await expect(
        network.connect(clusterOwner).registerValidator(
          validatorKeys[0], operatorIds, DEFAULT_SHARES, clusterAfterRemove,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_VERSION);

      const ssvBalanceBefore = await views.getBalanceSSV(
        clusterOwner.address, operatorIds, clusterAfterRemove,
      );
      const ssvBurnRate = await views.getBurnRateSSV(
        clusterOwner.address, operatorIds, clusterAfterRemove,
      );
      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        clusterAfterRemove,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const migrateEventArgs = extractEventArgs(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const migratedCluster = parseClusterFromEvent(
        network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH,
      );
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const actualRefund = ownerSSVAfter - ownerSSVBefore;
      const expectedRefund = ssvBalanceBefore - ssvBurnRate;

      expect(actualRefund).to.equal(migrateEventArgs.ssvRefunded);
      expect(actualRefund).to.equal(expectedRefund);
      expect(BigInt(migrateEventArgs.ethDeposited)).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(await views.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        views.getBalanceSSV(clusterOwner.address, operatorIds, migratedCluster),
      ).to.be.revertedWithCustomError(views, Errors.INCORRECT_CLUSTER_VERSION);
      expect(await views.getBalance(clusterOwner.address, operatorIds, migratedCluster)).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.validatorCount).to.equal(2n);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        const opETH = await views.getOperatorById(opId);
        expect(opSSV.validatorCount).to.equal(0);
        expect(opETH.validatorCount).to.equal(2);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      await mineBlocks(provider, 50);

      const registerTx = await network.connect(clusterOwner).registerValidator(
        validatorKeys[0],
        operatorIds,
        DEFAULT_SHARES,
        migratedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const registerReceipt = await registerTx.wait();
      const clusterAfterRegister = parseClusterFromEvent(
        network, registerReceipt, Events.VALIDATOR_ADDED,
      );
      expect(clusterAfterRegister.validatorCount).to.equal(3n);
      expect(await views.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        views.getBalanceSSV(clusterOwner.address, operatorIds, clusterAfterRegister),
      ).to.be.revertedWithCustomError(views, Errors.INCORRECT_CLUSTER_VERSION);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        const opETH = await views.getOperatorById(opId);
        expect(opSSV.validatorCount).to.equal(0);
        expect(opETH.validatorCount).to.equal(3);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }
      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      const depositTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        clusterAfterRegister,
        { value: SMALL_ETH_REGISTER_VALUE },
      );
      const depositReceipt = await depositTx.wait();
      const clusterAfterDeposit = parseClusterFromEvent(
        network, depositReceipt, Events.CLUSTER_DEPOSITED,
      );
      expect(clusterAfterDeposit.active).to.equal(true);
      expect(clusterAfterDeposit.validatorCount).to.equal(3n);

      const partialWithdrawAmount = ethers.parseEther("0.5");
      const withdrawTx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        partialWithdrawAmount,
        clusterAfterDeposit,
      );
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfterWithdraw = parseClusterFromEvent(
        network, withdrawReceipt, Events.CLUSTER_WITHDRAWN,
      );

      expect(await views.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        views.getBalanceSSV(clusterOwner.address, operatorIds, clusterAfterWithdraw),
      ).to.be.revertedWithCustomError(views, Errors.INCORRECT_CLUSTER_VERSION);
      expect(await views.getBalance(clusterOwner.address, operatorIds, clusterAfterWithdraw)).to.equal(clusterAfterWithdraw.balance);
      expect(clusterAfterWithdraw.active).to.equal(true);
      expect(clusterAfterWithdraw.validatorCount).to.equal(3n);

      for (const opId of operatorIds) {
        const opSSV = await views.getOperatorByIdSSV(opId);
        const opETH = await views.getOperatorById(opId);
        expect(opSSV.validatorCount).to.equal(0);
        expect(opETH.validatorCount).to.equal(3);
        expect(BigInt(opETH.fee)).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(3);
      expect(clusterAfterWithdraw.balance).to.be.greaterThan(0n);
      expect(clusterAfterWithdraw.balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE * 2n + SMALL_ETH_REGISTER_VALUE);
    });
  });
});
