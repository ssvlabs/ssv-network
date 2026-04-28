import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  MINIMAL_LIQUIDATION_THRESHOLD,
  NETWORK_FEE,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  defaultVUnits,
  calcLiquidationThreshold,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";
import { ethers } from "ethers";

describe("ETH Cluster Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let anotherOwner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, anotherOwner, oracle1, oracle2, oracle3, oracle4, staker] } = await setupTestContext());
  });

  describe("Withdraw From Empty Cluster (validatorCount == 0)", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("Allows full withdrawal from cluster with 0 validators, skipping liquidation check", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const depositAmount = ethers.parseEther("5");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await mineBlocks(provider, 10);

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        operatorIds,
        cluster,
      );
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt!.blockNumber;
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const blockDiff = BigInt(removeBlock - regBlock);
      const feesDeducted = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const expectedBalance = depositAmount - feesDeducted;

      expect(BigInt(cluster.validatorCount)).to.equal(0n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.balance)).to.equal(expectedBalance);

      const remainingBalance = BigInt(cluster.balance);
      const tx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        remainingBalance,
        cluster,
      );
      await tx.wait();

      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(BigInt(cluster.balance)).to.equal(0n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
    });
  });

  describe("Reactivation With Explicit EB — Deviation Properly Restored", () => {
    const REACTIVATION_NETWORK_FEE_RAW = 5_000n;
    const REACTIVATION_NETWORK_FEE_UNPACKED = REACTIVATION_NETWORK_FEE_RAW * ETH_DEDUCTED_DIGITS;
    const REACTIVATION_ETH_FEE_RAW = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    const deployReactivationFixture = async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);

      await network.updateNetworkFee(REACTIVATION_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      return { network, views, operatorIds };
    };

    it("Restores EB deviation to operators and DAO on reactivation", async function () {
      const { network, views, operatorIds } =
        await networkHelpers.loadFixture(deployReactivationFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      cluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const ebBefore = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(ebBefore).to.equal(effectiveBalance);

      const liqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liquidatedCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liquidatedCluster.active).to.equal(false);

      await mineBlocks(provider, 10);

      const reactivateAmount = ethers.parseEther("10");
      const tx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        liquidatedCluster,
        { value: reactivateAmount },
      );
      const reactivateReceipt = await tx.wait();
      const reactivatedCluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      await expect(tx).to.emit(network, Events.CLUSTER_REACTIVATED);

      const ebAfter = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, reactivatedCluster,
      );
      expect(ebAfter).to.equal(effectiveBalance);
    });
  });

  describe("Withdraw — Operator Snapshots NOT Updated", () => {
    const deployFixture = async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);

      await network.updateMinimumLiquidationCollateral(0n);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      return { network, views, operatorIds };
    };

    it("Correctly computes fees over two withdrawals without updating operator snapshots", async function () {
      const { network, views, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const depositAmount = ethers.parseEther("10");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      await regTx.wait();

      let cluster = await getCurrentClusterState(
        connection, network, clusterOwner.address, operatorIds,
      );

      const burnRateAfterReg = await views.getBurnRate(
        clusterOwner.address, operatorIds, cluster,
      );

      await mineBlocks(provider, 100);

      const withdrawTx1 = await network.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        cluster,
      );
      const receipt1 = await withdrawTx1.wait();
      cluster = parseClusterFromEvent(network, receipt1, Events.CLUSTER_WITHDRAWN);

      const burnRateAfterW1 = await views.getBurnRate(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(burnRateAfterW1).to.equal(burnRateAfterReg);

      const earningsAfterW1: bigint[] = [];
      for (const opId of operatorIds) {
        earningsAfterW1.push(await views.getOperatorEarnings(opId));
      }
      for (let i = 1; i < earningsAfterW1.length; i++) {
        expect(earningsAfterW1[i]).to.equal(earningsAfterW1[0]);
      }

      await mineBlocks(provider, 100);

      const withdrawTx2 = await network.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        cluster,
      );
      const receipt2 = await withdrawTx2.wait();
      cluster = parseClusterFromEvent(network, receipt2, Events.CLUSTER_WITHDRAWN);

      const burnRateAfterW2 = await views.getBurnRate(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(burnRateAfterW2).to.equal(burnRateAfterReg);

      const earningsAfterW2: bigint[] = [];
      for (const opId of operatorIds) {
        earningsAfterW2.push(await views.getOperatorEarnings(opId));
      }
      for (let i = 0; i < earningsAfterW2.length; i++) {
        expect(earningsAfterW2[i]).to.be.greaterThan(earningsAfterW1[i]);
        expect(earningsAfterW2[i]).to.equal(earningsAfterW2[0]);
      }
    });
  });

  describe("Packing Precision — ETH Values That Aren't Divisible By 100_000", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("Reverts when setting operator ETH fee not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 1);

      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);

      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 50_000n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("Accepts operator ETH fee divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 1);
      const validHigherFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      await network.connect(clusterOwner).declareOperatorFee(
        BigInt(operatorIds[0]),
        validHigherFee,
      );
      const { fee } = await views.getOperatorDeclaredFee(operatorIds[0]);
      expect(fee).to.be.equal(validHigherFee);
    });

    it("Allows deposit/withdraw of amounts not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      const oddAmount = 99_999n;
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: oddAmount },
      );
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await network.connect(clusterOwner).withdraw(operatorIds, oddAmount, cluster);
    });
  });

  describe("Liquidation Bounty Exactly Equals Post-Settlement Balance", () => {
    const BOUNTY_NETWORK_FEE_RAW = 5_000n;
    const BOUNTY_NETWORK_FEE_UNPACKED = BOUNTY_NETWORK_FEE_RAW * ETH_DEDUCTED_DIGITS;
    const BOUNTY_MIN_BLOCKS = MINIMAL_LIQUIDATION_THRESHOLD;
    const BOUNTY_ETH_FEE_RAW = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    const deployBountyFixture = async () => {
      const { network, views } = await ssvNetworkFullFixture(connection);

      await network.updateNetworkFee(BOUNTY_NETWORK_FEE_UNPACKED);
      await network.updateLiquidationThresholdPeriod(BOUNTY_MIN_BLOCKS);
      await network.updateMinimumLiquidationCollateral(0n);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      return { network, views, operatorIds };
    };

    it("Bounty equals post-settlement balance, not original balance", async function () {
      const { network, operatorIds } =
        await networkHelpers.loadFixture(deployBountyFixture);
      const provider = connection.ethers.provider;

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: BOUNTY_MIN_BLOCKS,
        numOperators: 4n,
        ethFee: BOUNTY_ETH_FEE_RAW,
        networkFee: BOUNTY_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: threshold },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;

      const regCluster = await getCurrentClusterState(
        connection,
        network as any,
        clusterOwner.address,
        operatorIds,
      );

      await mineBlocks(provider, 20);

      const liquidatorBalanceBefore = await provider.getBalance(anotherOwner.address);

      const liqTx = await network.connect(anotherOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        regCluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const gasUsed = BigInt(liqReceipt!.gasUsed) * BigInt(liqReceipt!.gasPrice);

      const liquidatorBalanceAfter = await provider.getBalance(anotherOwner.address);
      const bounty = liquidatorBalanceAfter - liquidatorBalanceBefore + gasUsed;

      const liquidatedCluster = parseClusterFromEvent(
        network,
        liqReceipt,
        Events.CLUSTER_LIQUIDATED,
      );

      expect(BigInt(liquidatedCluster.balance)).to.equal(0n);
      expect(liquidatedCluster.active).to.equal(false);

      const blockDiff = BigInt(liqBlock - regBlock);
      const burn = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: BOUNTY_ETH_FEE_RAW,
        networkFee: BOUNTY_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      const expectedBounty = burn >= threshold ? 0n : threshold - burn;
      expect(bounty).to.equal(expectedBounty);
    });
  });
});
