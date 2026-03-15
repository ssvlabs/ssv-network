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
  DEDUCTED_DIGITS,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
  MINIMAL_OPERATOR_ETH_FEE,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks } from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;


describe("Full End-to-End — SSV Cluster Creation -> Fee Accrual -> Migration -> ETH Fee Accrual -> Withdraw -> Verify All Balances", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
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
});
