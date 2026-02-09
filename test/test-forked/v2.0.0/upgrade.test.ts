import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getForkedConnection } from "../../setup/fork.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  getCurrentClusterState,
  makeOperatorKey,
  makePublicKey,
  makePublicKeys,
  whitelistAddresses,
  registerOperators,
  calculateInitialBurnRate,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_EB_PER_VALIDATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  PRECISION_FACTOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { deployContract } from "../../../scripts/common/helpers.ts";
import { ForkConfig } from "./config.ts";
import { ssvNetworkFullForkedFixture } from "../../setup/fixtures.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";


const RUN_FORK = process.env.RUN_FORK === "true";
const suite = RUN_FORK ? describe : describe.skip;

/** Mainnet uses SSV token only; operator fee is in SSV (uint256). Use mainnet minimum (1e9) to stay below mainnet operatorMaxFee. */
const MAINNET_MINIMAL_OPERATOR_FEE = 1_000_000_000n;

/** ERC20 _balances mapping is typically at slot 1 (slot 0 = _totalSupply). Set SSV balance for an address via storage so we don't rely on a whale. */
async function setSSVBalanceViaStorage(
  connection: NetworkConnection<"generic">,
  tokenAddress: string,
  accountAddress: string,
  amount: bigint,
  balanceMappingSlot = 1
) {
  const ethers = connection.ethers;
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [accountAddress, balanceMappingSlot]
    )
  );
  const valueHex = "0x" + amount.toString(16).padStart(64, "0");
  await connection.ethers.provider.send("hardhat_setStorageAt", [
    tokenAddress,
    slot,
    valueHex,
  ]);
}

suite("SSVNetwork upgrade scenarios", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  async function getMainnetFixture() {
    const ethers = connection.ethers;
    const networkFactory = await ethers.getContractFactory("contracts/mainnet-fork/SSVNetwork.sol:SSVNetwork");
    const viewsFactory = await ethers.getContractFactory("contracts/mainnet-fork/SSVNetworkViews.sol:SSVNetworkViews");
    const ssvTokenFactory = await ethers.getContractFactory("contracts/mainnet-fork/token/SSVToken.sol:SSVToken");

    const network = networkFactory.attach(ForkConfig.SSV_NETWORK_ADDRESS) as any;
    const views = viewsFactory.attach(ForkConfig.SSV_NETWORK_VIEWS) as any;
    const ssvToken = ssvTokenFactory.attach(ForkConfig.SSV_TOKEN) as any;
  

    return { network, views, ssvToken };
  }

  const deployFullSSVNetworkForkFixture = async () => {
    return ssvNetworkFullForkedFixture(connection);
  };

  async function registerOperatorsMainnet(network: any, count: number): Promise<number[]> {
    const operatorIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const expectedId = await network.connect(operatorOwner).registerOperator.staticCall(
        makeOperatorKey(i + 1),
        MAINNET_MINIMAL_OPERATOR_FEE,
        true
      );
      const tx = await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(i + 1), MAINNET_MINIMAL_OPERATOR_FEE, true);
      await tx.wait();
      operatorIds.push(Number(expectedId));
    }
    return operatorIds.sort((a, b) => a - b);
  }

  async function registerOperatorsWithFeesMainnet(network: any, count: number, fees: bigint[]): Promise<number[]> {
    const operatorIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const expectedId = await network.connect(operatorOwner).registerOperator.staticCall(
        makeOperatorKey(i + 1),
        fees[i],
        true
      );
      const tx = await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(i + 1), fees[i], true);
      await tx.wait();
      operatorIds.push(Number(expectedId));
    }
    return operatorIds.sort((a, b) => a - b);
  }

  before(async function () {
    ({ connection, networkHelpers } = await getForkedConnection());
    [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();

    for (const signer of [operatorOwner, clusterOwner, randomUser]) {
      await connection.ethers.provider.send("hardhat_impersonateAccount", [signer.address]);
      await connection.ethers.provider.send("hardhat_setBalance", [signer.address, "0x56bc75e2d63100000"]);
    }

    operatorOwner = await connection.ethers.getSigner(operatorOwner.address);
    clusterOwner = await connection.ethers.getSigner(clusterOwner.address);
    randomUser = await connection.ethers.getSigner(randomUser.address);

  });

  describe("Non-Migrated old clusters from mainnet", async function () {
    it("pays fees in same rhythm before and after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(18);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      let clusterData = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      let burnRateSSV = await mainnetViews.getBurnRate(clusterOwner.address, operatorIds, clusterData);
      let balanceBefore = await mainnetViews.getBalance(clusterOwner.address, operatorIds, clusterData);

      await connection.networkHelpers.mine(100);

      let balanceAfter = await mainnetViews.getBalance(clusterOwner.address, operatorIds, clusterData);

      let calculatedAmount = burnRateSSV * 100n;
      let actualAmount = balanceBefore - balanceAfter;

      await expect(calculatedAmount).to.be.equal(actualAmount);

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      burnRateSSV = await forkedViews.getBurnRateSSV(clusterOwner.address, operatorIds, clusterData);
      balanceBefore = await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData);

      await connection.networkHelpers.mine(100);

      balanceAfter = await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData);

      calculatedAmount = burnRateSSV * 100n;
      actualAmount = balanceBefore - balanceAfter;

      await expect(calculatedAmount).to.be.equal(actualAmount);
      await expect(await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData))
      .to.be.equal(false);
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, clusterData))
      .to.be.equal(false);

    });

    it("can become liquidable after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(2);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      // Deposit enough to cover threshold + ~200k blocks worth of fees
      // This ensures it's not liquidatable initially but becomes liquidable after mining ~200k blocks
      const blocksBuffer = 200000n;
      const enoughDeposit = requiredDeposit + (burnRate * blocksBuffer);

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("1") // Small buffer for approvals
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      const receipt = await tx.wait();
      const registrationBlock = receipt!.blockNumber;

      const expectedCluster = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is not liquidated before upgrade
      await expect(await mainnetViews.isLiquidatable(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);
      await expect(await mainnetViews.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);

      // Upgrade contract to new implementation
      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      // Get cluster data right after upgrade - this matches what's stored on-chain after upgrade
      // Store the block number when we got this data so we can search from there if needed
      const upgradeBlock = await connection.ethers.provider.getBlockNumber();
      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      
      // Assert isLiquidatableSSV is false initially
      await expect(await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(false);

      // Mine blocks until cluster becomes liquidable
      // With deposit of threshold + 200k blocks buffer, mine enough blocks to burn through the buffer
      // Use the same clusterData throughout - view functions handle balance updates internally
      let attempts = 0;
      let isLiquidatable = false;
      const maxAttempts = 20;
      while (attempts < maxAttempts) {
        // Mine blocks first
        await connection.networkHelpers.mine(100000);
        attempts++;
        
        // Check if liquidatable after mining - this internally handles balance updates based on current block number
        // We use the same clusterData from right after upgrade - the view function calculates current balance
        isLiquidatable = await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData);
        if (isLiquidatable) {
          break;
        }
      }

      // Assert isLiquidatableSSV becomes true after mining
      await expect(isLiquidatable).to.be.equal(true, "Cluster should become liquidable after mining blocks");
      await expect(await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(true);
      
      // Assert cluster is still not liquidated (using same clusterData - isLiquidated just checks active flag)
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(false);
    });

    it("can be liquidated (self) after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(3);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      // Use a large SSV deposit (1000 SSV tokens)
      const largeSSVDeposit = ethers.parseEther("1000");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        largeSSVDeposit + ethers.parseEther("100") // Extra for gas/approvals
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, largeSSVDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        largeSSVDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const expectedCluster = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is not liquidated before upgrade
      await expect(await mainnetViews.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);

      // Upgrade contract to new implementation
      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      // Get cluster data after upgrade
      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Get SSV balance of clusterOwner before liquidation
      const ownerBalanceBefore = await forkedSSVToken.balanceOf(clusterOwner.address);
      const clusterBalanceSSV = await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData);

      // Owner can liquidate own cluster anytime
      const liquidateTx = await forkedNetwork.connect(clusterOwner).liquidateSSV(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      await liquidateTx.wait();

      // Get cluster state after liquidation
      const liquidatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is liquidated
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster))
        .to.be.equal(true);

      // Assert clusterOwner received SSV - check that it's close to the cluster balance
      // (allowing small differences due to fees/rounding)
      const ownerBalanceAfter = await forkedSSVToken.balanceOf(clusterOwner.address);
      const receivedAmount = ownerBalanceAfter - ownerBalanceBefore;
      // Check that received amount is close to cluster balance (within 1 SSV token tolerance)
      // The cluster balance should be close to 1000 SSV tokens (minus any fees deducted)
      const tolerance = ethers.parseEther("1");
      await expect(receivedAmount).to.be.at.least(clusterBalanceSSV - tolerance);
      await expect(receivedAmount).to.be.at.most(clusterBalanceSSV + tolerance);
      // Verify it's a large amount close to 1000 SSV tokens (allowing for fees that may have been deducted)
      const expectedMinAmount = ethers.parseEther("999"); // At least 999 SSV tokens
      await expect(receivedAmount).to.be.at.least(expectedMinAmount);

      // Assert cluster balance is 0 (can't use getBalanceSSV on liquidated cluster - it reverts)
      // Check the balance from the liquidated cluster data instead
      await expect(BigInt(liquidatedCluster.balance)).to.be.equal(0n);
    });

    it("can be liquidated (stranger) after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(4);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      // Deposit enough to cover threshold + ~200k blocks worth of fees
      // This ensures it's not liquidatable initially but becomes liquidable after mining ~200k blocks
      const blocksBuffer = 200000n;
      const enoughDeposit = requiredDeposit + (burnRate * blocksBuffer);

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("1") // Small buffer for approvals
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const expectedCluster = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is not liquidated before upgrade
      await expect(await mainnetViews.isLiquidated(clusterOwner.address, operatorIds, expectedCluster))
        .to.be.equal(false);

      // Upgrade contract to new implementation
      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      // Get cluster data right after upgrade - this matches what's stored on-chain after upgrade
      // We'll reuse this same clusterData throughout mining - view functions handle balance updates internally
      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert isLiquidatableSSV is false initially
      await expect(await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(false);

      // Try to liquidate as stranger - should fail with ClusterNotLiquidatable error
      await expect(
        forkedNetwork.connect(randomUser).liquidateSSV(
          clusterOwner.address,
          operatorIds,
          clusterData
        )
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.CLUSTER_NOT_LIQUIDATABLE);

      // Mine blocks until cluster becomes liquidable
      // With deposit of threshold + 200k blocks buffer, mine enough blocks to burn through the buffer
      // Use the same clusterData throughout - view functions handle balance updates internally
      let attempts = 0;
      let isLiquidatable = false;
      const maxAttempts = 20;
      while (attempts < maxAttempts) {
        // Mine blocks first
        await connection.networkHelpers.mine(100000);
        attempts++;
        
        // Check if liquidatable after mining - this internally handles balance updates based on current block number
        // We use the same clusterData from right after upgrade - the view function calculates current balance
        isLiquidatable = await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData);
        if (isLiquidatable) {
          break;
        }
      }

      // Assert isLiquidatableSSV is true after mining
      await expect(isLiquidatable).to.be.equal(true, "Cluster should become liquidable after mining blocks");
      await expect(await forkedViews.isLiquidatableSSV(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(true);

      // Get SSV balance of randomUser before liquidation
      const strangerBalanceBefore = await forkedSSVToken.balanceOf(randomUser.address);
      const clusterBalanceSSV = await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData);

      // Stranger can now liquidate
      const liquidateTx = await forkedNetwork.connect(randomUser).liquidateSSV(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      await liquidateTx.wait();

      // Get cluster state after liquidation
      const liquidatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is liquidated
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster))
        .to.be.equal(true);

      // Assert randomUser received SSV - check that it's close to the cluster balance
      // (allowing small differences due to fees/rounding)
      const strangerBalanceAfter = await forkedSSVToken.balanceOf(randomUser.address);
      const receivedAmount = strangerBalanceAfter - strangerBalanceBefore;
      // Check that received amount is close to cluster balance (within 1 SSV token tolerance)
      const tolerance = ethers.parseEther("1");
      await expect(receivedAmount).to.be.at.least(clusterBalanceSSV - tolerance);
      await expect(receivedAmount).to.be.at.most(clusterBalanceSSV + tolerance);

      // Assert cluster balance is 0 (can't use getBalanceSSV on liquidated cluster - it reverts)
      // Check the balance from the liquidated cluster data instead
      await expect(BigInt(liquidatedCluster.balance)).to.be.equal(0n);
    });

    it("if liquidated before, can't be reactivated after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(5);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + 20n ** 18n;

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + 10n ** 18n
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      let clusterState = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Liquidate cluster on mainnet BEFORE upgrade
      const liquidateTx = await mainnetNetwork.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterState
      );
      await liquidateTx.wait();

      // Assert cluster is liquidated
      clusterState = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      await expect(await mainnetViews.isLiquidated(clusterOwner.address, operatorIds, clusterState))
        .to.be.equal(true);

      // Upgrade network
      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      // Get cluster state after upgrade (should still be liquidated)
      const clusterDataAfterUpgrade = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Assert cluster is still liquidated
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, clusterDataAfterUpgrade))
        .to.be.equal(true);

      // Try to call reactivate after upgrade - should revert with IncorrectClusterVersion
      // because reactivate only works for ETH clusters, not SSV clusters
      await expect(
        forkedNetwork.connect(clusterOwner).reactivate(
          operatorIds,
          clusterDataAfterUpgrade,
          { value: 1n }
        )
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("has cluster version ssv after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(6);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const version = await forkedViews.getClusterAssetType(clusterOwner.address, operatorIds);
      await expect(version).to.be.equal(CLUSTER_VERSION_SSV);
    });

    it("has EB = 32 right after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(7);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const effectiveBalance = await forkedViews.getEffectiveBalance(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      await expect(effectiveBalance).to.be.equal(Number(DEFAULT_ETH_EB_PER_VALIDATOR));
    });

    it("can't add a new validator to the cluster after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(8);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const otherValidatorKey = makePublicKey(88);
      await expect(
        forkedNetwork.connect(clusterOwner).registerValidator(
          otherValidatorKey,
          operatorIds,
          DEFAULT_SHARES,
          clusterData,
          { value: 0n }
        )
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("can't deposit more ssv on existing cluster after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(9);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");
      const extraDeposit = ethers.parseEther("50");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + extraDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit + extraDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      let clusterState = await getCurrentClusterState(
        connection,
        mainnetNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      await mainnetNetwork.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        extraDeposit,
        clusterState
      );

      const { network: forkedNetwork } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(
        forkedNetwork.connect(clusterOwner).deposit(
          clusterOwner.address,
          operatorIds,
          clusterData,
          { value: 0n }
        )
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("can't withdraw ssv after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(10);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const withdrawAmount = ethers.parseEther("10");
      await expect(
        forkedNetwork.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, clusterData)
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });
  });

  describe("Operators before and after upgrade", async function () {
    it("will get rewards in same rhythm before and after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(10);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const earningsBeforeBlocks = await mainnetViews.getOperatorEarnings(operatorIds[0]);
      await expect(earningsBeforeBlocks).to.be.equal(0n);

      await connection.networkHelpers.mine(100);

      const earningsAfter100BeforeUpgrade = await mainnetViews.getOperatorEarnings(operatorIds[0]);
      const earnedIn100BlocksBeforeUpgrade = earningsAfter100BeforeUpgrade - earningsBeforeBlocks;

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const earningsRightAfterUpgrade = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      await connection.networkHelpers.mine(100);
      const earningsAfter100AfterUpgrade = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      const earnedIn100BlocksAfterUpgrade = earningsAfter100AfterUpgrade - earningsRightAfterUpgrade;

      await expect(earnedIn100BlocksBeforeUpgrade).to.be.equal(earnedIn100BlocksAfterUpgrade);
    });

    it("can be removed (owner will get 0 eth and correct ssv amount) after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(11);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await connection.networkHelpers.mine(500);

      const expectedSSV = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      const ssvBalanceBefore = await forkedSSVToken.balanceOf(operatorOwner.address);
      const ethBalanceBefore = await connection.ethers.provider.getBalance(operatorOwner.address);

      const removeTx = await forkedNetwork.connect(operatorOwner).removeOperator(operatorIds[0]);
      const receipt = await removeTx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const ssvBalanceAfter = await forkedSSVToken.balanceOf(operatorOwner.address);
      const ethBalanceAfter = await connection.ethers.provider.getBalance(operatorOwner.address);

      const ssvReceived = ssvBalanceAfter - ssvBalanceBefore;
      const ethReceived = ethBalanceAfter - ethBalanceBefore + gasCost;

      const tolerance = ethers.parseEther("1");
      await expect(ssvReceived).to.be.at.least(expectedSSV - tolerance);
      await expect(ssvReceived).to.be.at.most(expectedSSV + tolerance);
      await expect(ethReceived).to.be.equal(0n);
    });

    it.skip("can declare fee before, execute fee after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(12);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      const currentFee = await mainnetViews.getOperatorFee(operatorIds[0]);
      const newFee = (currentFee * (PRECISION_FACTOR + 500n)) / PRECISION_FACTOR;
      await mainnetNetwork.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await connection.networkHelpers.time.increase(
        DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD + 1n
      );
      await connection.networkHelpers.mine(1);

      await forkedNetwork.connect(operatorOwner).executeOperatorFee(operatorIds[0]);

      const feeSSV = await forkedViews.getOperatorFeeSSV(operatorIds[0]);
      const feeETH = await forkedViews.getOperatorFee(operatorIds[0]);
      await expect(feeSSV).to.be.equal(newFee);
      await expect(feeETH).to.be.equal(0n);
    });

    it("can declare fee before, cancel it after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(13);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const originalFee = await mainnetViews.getOperatorFee(operatorIds[0]);
      const differentFee = (originalFee * (PRECISION_FACTOR + 500n)) / PRECISION_FACTOR;
      await mainnetNetwork.connect(operatorOwner).declareOperatorFee(operatorIds[0], differentFee);

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await forkedNetwork.connect(operatorOwner).cancelDeclaredOperatorFee(operatorIds[0]);

      const feeSSV = await forkedViews.getOperatorFeeSSV(operatorIds[0]);
      const feeETH = await forkedViews.getOperatorFee(operatorIds[0]);
      await expect(feeSSV).to.be.equal(originalFee);
      await expect(feeETH).to.be.equal(0n);
    });

    it.skip("can reduce fee before, reduce fee after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(14);
      // Use a higher starting fee (2_000_000_000n) so that after two 5% reductions it's still above
      // the upgraded contract's minimumOperatorEthFee (1_770_000_000n)
      const operatorIds = await registerOperatorsWithFeesMainnet(mainnetNetwork, 4, [2_000_000_000n, 2_000_000_000n, 2_000_000_000n, 2_000_000_000n]);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const F = await mainnetViews.getOperatorFee(operatorIds[0]);
      const DEDUCTED_DIGITS = 10_000_000n;
      // Calculate 5% reduction and round down to nearest multiple of DEDUCTED_DIGITS
      const XRaw = (F * (PRECISION_FACTOR - 500n)) / PRECISION_FACTOR;
      const X = (XRaw / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;
      await mainnetNetwork.connect(operatorOwner).reduceOperatorFee(operatorIds[0], X);

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const feeSSVAfterFirst = await forkedViews.getOperatorFeeSSV(operatorIds[0]);
      const feeETHAfterFirst = await forkedViews.getOperatorFee(operatorIds[0]);
      await expect(feeSSVAfterFirst).to.be.equal(X);
      await expect(feeETHAfterFirst).to.be.equal(0n);

      // Calculate second 5% reduction and round down to nearest multiple of DEDUCTED_DIGITS
      const X2Raw = (X * (PRECISION_FACTOR - 500n)) / PRECISION_FACTOR;
      const X2 = (X2Raw / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;
      await forkedNetwork.connect(operatorOwner).reduceOperatorFee(operatorIds[0], X2);

      const feeSSVAfterSecond = await forkedViews.getOperatorFeeSSV(operatorIds[0]);
      const feeETHAfterSecond = await forkedViews.getOperatorFee(operatorIds[0]);
      await expect(feeSSVAfterSecond).to.be.equal(X2);
      await expect(feeETHAfterSecond).to.be.equal(0n);
    });

    it("can partially withdraw SSV after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(15);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      await connection.networkHelpers.mine(250);

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await connection.networkHelpers.mine(250);

      const totalSSV = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      const DEDUCTED_DIGITS = 10_000_000n;
      const withdrawAmount = (totalSSV / 2n / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;

      const ssvBalanceBefore = await forkedSSVToken.balanceOf(operatorOwner.address);

      await forkedNetwork.connect(operatorOwner).withdrawOperatorEarningsSSV(operatorIds[0], withdrawAmount);
      const ssvBalanceAfter = await forkedSSVToken.balanceOf(operatorOwner.address);

      const ssvReceived = ssvBalanceAfter - ssvBalanceBefore;
      const tolerance = ethers.parseEther("1");
      await expect(ssvReceived).to.be.at.least(withdrawAmount - tolerance);
      await expect(ssvReceived).to.be.at.most(withdrawAmount + tolerance);

      const remainingSSV = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);

      const expectedRemaining = totalSSV - withdrawAmount;

      await expect(remainingSSV).to.be.at.least(expectedRemaining - tolerance);
      await expect(remainingSSV).to.be.at.most(expectedRemaining + tolerance);
    });

    it("can fully withdraw SSV after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(16);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await connection.networkHelpers.mine(500);

      const expectedSSV = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      const ssvBalanceBefore = await forkedSSVToken.balanceOf(operatorOwner.address);
      await forkedNetwork.connect(operatorOwner).withdrawAllOperatorEarningsSSV(operatorIds[0]);
      const ssvBalanceAfter = await forkedSSVToken.balanceOf(operatorOwner.address);

      const ssvReceived = ssvBalanceAfter - ssvBalanceBefore;
      const tolerance = ethers.parseEther("1");
      await expect(ssvReceived).to.be.at.least(expectedSSV - tolerance);
      await expect(ssvReceived).to.be.at.most(expectedSSV + tolerance);

      await expect(await forkedViews.getOperatorEarningsSSV(operatorIds[0])).to.be.equal(0n);
      await expect(await forkedViews.getOperatorEarnings(operatorIds[0])).to.be.equal(0n);
    });

    it("can fully withdraw only SSV with AllVersion function after upgrade", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(17);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      const tx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await tx.wait();

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      await connection.networkHelpers.mine(500);

      const expectedSSV = await forkedViews.getOperatorEarningsSSV(operatorIds[0]);
      const ssvBalanceBefore = await forkedSSVToken.balanceOf(operatorOwner.address);
      const ethBalanceBefore = await connection.ethers.provider.getBalance(operatorOwner.address);

      const withdrawTx = await forkedNetwork.connect(operatorOwner).withdrawAllVersionOperatorEarnings(operatorIds[0]);
      const receipt = await withdrawTx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const ssvBalanceAfter = await forkedSSVToken.balanceOf(operatorOwner.address);
      const ethBalanceAfter = await connection.ethers.provider.getBalance(operatorOwner.address);

      const ssvReceived = ssvBalanceAfter - ssvBalanceBefore;
      const ethReceived = ethBalanceAfter - ethBalanceBefore + gasCost;

      const tolerance = ethers.parseEther("1");
      await expect(ssvReceived).to.be.at.least(expectedSSV - tolerance);
      await expect(ssvReceived).to.be.at.most(expectedSSV + tolerance);
      await expect(ethReceived).to.be.equal(0n);

      await expect(await forkedViews.getOperatorEarningsSSV(operatorIds[0])).to.be.equal(0n);
      await expect(await forkedViews.getOperatorEarnings(operatorIds[0])).to.be.equal(0n);
    });
  });
  describe("Migration tests", async function () {
    it("old clusters can migrate", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(20);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("10");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);
      const ssvBalanceBeforeUser = await ssvToken.balanceOf(clusterOwner.address);
      const storedBalanceBeforeContract = BigInt(clusterData.balance);
      const migrateTx = await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });
      const receipt = await migrateTx.wait();

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );


      const ssvBalanceAfterUser = await ssvToken.balanceOf(clusterOwner.address);
      await expect(ssvBalanceAfterUser).to.be.equal(ssvBalanceBeforeUser + storedBalanceBeforeContract);
      const ssvBalanceAfterContract = await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData);
      await expect(ssvBalanceAfterContract).to.be.equal(0n);

      await expect(migrateTx).to.emit(forkedNetwork, Events.CLUSTER_MIGRATED_TO_ETH);

      const clusterDataAfter = parseClusterFromEvent(
        forkedNetwork as any,
        receipt!,
        Events.CLUSTER_MIGRATED_TO_ETH
      );
      const balanceETH = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterDataAfter);
      await expect(balanceETH).to.be.equal(ethDepositX);

      const version = await forkedViews.getClusterAssetType(clusterOwner.address, operatorIds);
      await expect(version).to.be.equal(CLUSTER_VERSION_ETH);

      const effectiveBalance = await forkedViews.getEffectiveBalance(
        clusterOwner.address,
        operatorIds,
        clusterDataAfter
      );
      await expect(effectiveBalance).to.be.equal(Number(DEFAULT_ETH_EB_PER_VALIDATOR));
      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterDataAfter)).to.be.equal(
        false
      );
    });

    it("new clusters are already migrated", async function () {
      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const validatorKey = makePublicKey(21);
      const operatorIds = await registerOperators(forkedNetwork, operatorOwner, 4);
      await whitelistAddresses(forkedNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await forkedViews.getNetworkFee();
      const minBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const minCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await forkedViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (requiredDeposit + 10n ** 18n).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: requiredDeposit }
      );

      const clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const version = await forkedViews.getClusterAssetType(clusterOwner.address, operatorIds);
      await expect(version).to.be.equal(CLUSTER_VERSION_ETH);

      const balance = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      await expect(balance).to.be.equal(requiredDeposit);
      const effectiveBalance = await forkedViews.getEffectiveBalance(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      await expect(effectiveBalance).to.be.equal(Number(DEFAULT_ETH_EB_PER_VALIDATOR));
      const expectedBurnRate = await calculateInitialBurnRate(forkedViews, operatorIds, clusterData);
      await expect(await forkedViews.getBurnRate(clusterOwner.address, operatorIds, clusterData)).to.be.equal(
        expectedBurnRate
      );
      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData)).to.be.equal(false);
      await expect(await forkedViews.getBalanceSSV(clusterOwner.address, operatorIds, clusterData)).to.be.equal(0n);
      await expect(await forkedViews.getBurnRateSSV(clusterOwner.address, operatorIds, clusterData)).to.be.equal(0n);
    });

    it("old clusters after migration will pay correct fees per block", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(22);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDeposit = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDeposit + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDeposit,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const balanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      await expect(balanceBefore).to.be.equal(ethDeposit);

      await connection.networkHelpers.mine(100);

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const balanceAfter = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const burnRatePerBlock = await forkedViews.getBurnRate(clusterOwner.address, operatorIds, clusterData);

      const expectedConsumed = burnRatePerBlock * 100n;
      const actualConsumed = balanceBefore - balanceAfter;
      await expect(actualConsumed).to.be.equal(expectedConsumed);
    });

    it("new clusters will pay correct fees per block", async function () {
      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const validatorKey = makePublicKey(23);
      const operatorIds = await registerOperators(forkedNetwork, operatorOwner, 4);
      await whitelistAddresses(forkedNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await forkedViews.getNetworkFee();
      const minBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const minCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await forkedViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (requiredDeposit + 10n ** 18n).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: requiredDeposit }
      );

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const balanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      await expect(balanceBefore).to.be.equal(requiredDeposit);

      await connection.networkHelpers.mine(100);

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const balanceAfter = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const burnRatePerBlock = await forkedViews.getBurnRate(clusterOwner.address, operatorIds, clusterData);

      const expectedConsumed = burnRatePerBlock * 100n;
      const actualConsumed = balanceBefore - balanceAfter;
      await expect(actualConsumed).to.be.equal(expectedConsumed);
    });

    it("migrated clusters can be liquidated (self)", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(24);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      const migrateTx = await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });
      await migrateTx.wait();

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData)).to.be.equal(false);

      const ownerEthBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);
      const clusterBalanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const ownerSSVBalanceBefore = await forkedSSVToken.balanceOf(clusterOwner.address);

      const liquidateTx = await forkedNetwork.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      const liquidateReceipt = await liquidateTx.wait();
      const gasUsed = liquidateReceipt!.gasUsed * liquidateReceipt!.gasPrice;

      const liquidatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster)).to.be.equal(true);

      const ownerEthBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      const ethReceived = ownerEthBalanceAfter - ownerEthBalanceBefore + gasUsed;
      const tolerance = ethers.parseEther("0.1");
      await expect(ethReceived).to.be.at.least(clusterBalanceBefore - tolerance);
      await expect(ethReceived).to.be.at.most(clusterBalanceBefore + tolerance);

      const ownerSSVBalanceAfter = await forkedSSVToken.balanceOf(clusterOwner.address);
      await expect(ownerSSVBalanceAfter).to.be.equal(ownerSSVBalanceBefore);
    });

    it("migrated clusters can be liquidated (stranger)", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(25);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("1");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData)).to.be.equal(false);

      let attempts = 0;
      let isLiquidatable = false;
      const maxAttempts = 50;
      while (attempts < maxAttempts && !isLiquidatable) {
        await connection.networkHelpers.mine(100000);
        attempts++;
        isLiquidatable = await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData);
        if (isLiquidatable) {
          break;
        }
      }

      await expect(isLiquidatable).to.be.equal(true, "Cluster should become liquidable after mining blocks");

      const strangerEthBalanceBefore = await connection.ethers.provider.getBalance(randomUser.address);
      const clusterBalanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const strangerSSVBalanceBefore = await forkedSSVToken.balanceOf(randomUser.address);

      const liquidateTx = await forkedNetwork.connect(randomUser).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      const liquidateReceipt = await liquidateTx.wait();
      const gasUsed = liquidateReceipt!.gasUsed * liquidateReceipt!.gasPrice;

      const liquidatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster)).to.be.equal(true);

      const strangerEthBalanceAfter = await connection.ethers.provider.getBalance(randomUser.address);
      const ethReceived = strangerEthBalanceAfter - strangerEthBalanceBefore + gasUsed;
      const tolerance = ethers.parseEther("0.1");
      await expect(ethReceived).to.be.at.least(clusterBalanceBefore - tolerance);
      await expect(ethReceived).to.be.at.most(clusterBalanceBefore + tolerance);

      const strangerSSVBalanceAfter = await forkedSSVToken.balanceOf(randomUser.address);
      await expect(strangerSSVBalanceAfter).to.be.equal(strangerSSVBalanceBefore);
    });

    it("migrated clusters can be reactivated", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(26);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews, ssvToken: forkedSSVToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData)).to.be.equal(false);

      const ownerEthBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);
      const clusterBalanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const ownerSSVBalanceBefore = await forkedSSVToken.balanceOf(clusterOwner.address);

      const liquidateTx = await forkedNetwork.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      const liquidateReceipt = await liquidateTx.wait();
      const gasUsed = liquidateReceipt!.gasUsed * liquidateReceipt!.gasPrice;

      const liquidatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster)).to.be.equal(true);

      const ownerEthBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      const ethReceived = ownerEthBalanceAfter - ownerEthBalanceBefore + gasUsed;
      const tolerance = ethers.parseEther("0.1");
      await expect(ethReceived).to.be.at.least(clusterBalanceBefore - tolerance);
      await expect(ethReceived).to.be.at.most(clusterBalanceBefore + tolerance);

      const ownerSSVBalanceAfter = await forkedSSVToken.balanceOf(clusterOwner.address);
      await expect(ownerSSVBalanceAfter).to.be.equal(ownerSSVBalanceBefore);

      const reactivationAmount = ethThreshold + ethers.parseEther("100");
      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (reactivationAmount + ethers.parseEther("10")).toString(16),
      ]);

      const reactivateTx = await forkedNetwork.connect(clusterOwner).reactivate(operatorIds, liquidatedCluster, {
        value: reactivationAmount,
      });
      await reactivateTx.wait();

      const reactivatedCluster = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, reactivatedCluster)).to.be.equal(false);
      await expect(reactivatedCluster.active).to.be.equal(true);

      const reactivatedBalance = await forkedViews.getBalance(clusterOwner.address, operatorIds, reactivatedCluster);
      await expect(reactivatedBalance).to.be.equal(reactivationAmount);
    });

    it("only owner can withdraw from migrated clusters", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(27);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const clusterBalanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const withdrawAmount = clusterBalanceBefore / 2n;

      await expect(
        forkedNetwork.connect(randomUser).withdraw(operatorIds, withdrawAmount, clusterData)
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.CLUSTER_DOES_NOT_EXISTS);

      const ownerEthBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

      const withdrawTx = await forkedNetwork.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, clusterData);
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

      const ownerEthBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      const ethReceived = ownerEthBalanceAfter - ownerEthBalanceBefore + gasUsed;
      const tolerance = ethers.parseEther("0.1");
      await expect(ethReceived).to.be.at.least(withdrawAmount - tolerance);
      await expect(ethReceived).to.be.at.most(withdrawAmount + tolerance);

      const clusterDataAfter = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const clusterBalanceAfter = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterDataAfter);
      const expectedRemaining = clusterBalanceBefore - withdrawAmount;
      await expect(clusterBalanceAfter).to.be.at.least(expectedRemaining - tolerance);
      await expect(clusterBalanceAfter).to.be.at.most(expectedRemaining + tolerance);
    });

    it("only owner can deposit migrated clusters", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(28);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const depositAmount = ethers.parseEther("10");
      const incorrectClusterData = {
        ...clusterData,
        balance: clusterData.balance + 1n,
      };

      await expect(
        forkedNetwork.connect(randomUser).deposit(clusterOwner.address, operatorIds, incorrectClusterData, {
          value: depositAmount,
        })
      ).to.be.revertedWithCustomError(forkedNetwork, Errors.INCORRECT_CLUSTER_STATE);

      const clusterBalanceBefore = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (depositAmount + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).deposit(clusterOwner.address, operatorIds, clusterData, {
        value: depositAmount,
      });

      const clusterDataAfter = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );
      const clusterBalanceAfter = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterDataAfter);
      const expectedBalance = clusterBalanceBefore + depositAmount;
      const tolerance = ethers.parseEther("0.1");
      await expect(clusterBalanceAfter).to.be.at.least(expectedBalance - tolerance);
      await expect(clusterBalanceAfter).to.be.at.most(expectedBalance + tolerance);
    });

    it.only("migrated cluster fees are correctly adjusted after operators removal", async function () {
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      const validatorKey = makePublicKey(29);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const networkFee = await mainnetViews.getNetworkFee();
      const minBlocks = await mainnetViews.getLiquidationThresholdPeriod();
      const minCollateral = await mainnetViews.getMinimumLiquidationCollateral();
      let sumOpFees = 0n;
      for (const id of operatorIds) {
        sumOpFees += await mainnetViews.getOperatorFee(id);
      }
      const burnRate = sumOpFees + networkFee;
      const threshold = burnRate * minBlocks;
      const requiredDeposit = threshold > minCollateral ? threshold : minCollateral;
      const enoughDeposit = requiredDeposit + ethers.parseEther("100");

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        clusterOwner.address,
        enoughDeposit + ethers.parseEther("10")
      );
      await ssvToken.connect(clusterOwner).approve(mainnetNetwork.target, enoughDeposit);

      await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );

      const { network: forkedNetwork, views: forkedViews } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const ethNetworkFee = await forkedViews.getNetworkFee();
      const ethMinBlocks = await forkedViews.getLiquidationThresholdPeriod();
      const ethMinCollateral = await forkedViews.getMinimumLiquidationCollateral();
      let sumEthOpFees = 0n;
      for (const id of operatorIds) {
        sumEthOpFees += await forkedViews.getOperatorFee(id);
      }
      const ethBurnRate = sumEthOpFees + ethNetworkFee;
      const ethThreshold = ethBurnRate * ethMinBlocks;
      const ethDepositX = (ethThreshold > ethMinCollateral ? ethThreshold : ethMinCollateral) + ethers.parseEther("100");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Set all operator fees to equal the network fee
      // This ensures that when we remove operators, the fee reduction is predictable
      // We need to do incremental increases due to OPERATOR_MAX_FEE_INCREASE limit (100% per increase)
      const operatorMaxFeeIncrease = await forkedViews.getOperatorFeeIncreaseLimit();
      
      async function setOperatorFeeToTarget(operatorId: number, targetFee: bigint) {
        let currentFee = await forkedViews.getOperatorFee(operatorId);
        
        if (currentFee === targetFee) {
          return; // Already at target
        }
        
        if (currentFee > targetFee) {
          // Decrease immediately
          await forkedNetwork.connect(operatorOwner).reduceOperatorFee(operatorId, targetFee);
          return;
        }
        
        // Increase incrementally until we reach target
        while (currentFee < targetFee) {
          // Calculate max allowed increase: currentFee * 2 (100% increase)
          const maxAllowedFee = (currentFee * (PRECISION_FACTOR + operatorMaxFeeIncrease) + PRECISION_FACTOR - 1n) / PRECISION_FACTOR;
          const nextFee = maxAllowedFee < targetFee ? maxAllowedFee : targetFee;
          
          // Declare the fee increase
          await forkedNetwork.connect(operatorOwner).declareOperatorFee(operatorId, nextFee);
          
          // Wait for declare and execute periods
          await connection.networkHelpers.time.increase(
            DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD + 1n
          );
          await connection.networkHelpers.mine(1);
          
          // Execute the fee change
          await forkedNetwork.connect(operatorOwner).executeOperatorFee(operatorId);
          
          // Update current fee for next iteration
          currentFee = await forkedViews.getOperatorFee(operatorId);
          
          if (currentFee >= targetFee) {
            break; // Reached or exceeded target
          }
        }
      }
      
      // Set all operator fees to network fee
      for (const operatorId of operatorIds) {
        await setOperatorFeeToTarget(operatorId, ethNetworkFee);
      }

      // Verify all operator fees are now equal to network fee
      for (const operatorId of operatorIds) {
        const operatorFee = await forkedViews.getOperatorFee(operatorId);
        await expect(operatorFee).to.be.equal(ethNetworkFee);
      }
 
      const balanceBefore4Operators = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      await connection.networkHelpers.mine(1000);

      const balanceAfter4Operators = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const consumedWith4Operators = balanceBefore4Operators - balanceAfter4Operators;

      await forkedNetwork.connect(operatorOwner).removeOperator(operatorIds[2]);
      await forkedNetwork.connect(operatorOwner).removeOperator(operatorIds[3]);

      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const balanceBefore2Operators = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      await connection.networkHelpers.mine(1000);

      const balanceAfter2Operators = await forkedViews.getBalance(clusterOwner.address, operatorIds, clusterData);
      const consumedWith2Operators = balanceBefore2Operators - balanceAfter2Operators;

      // With 4 operators + 1 network fee = 5 components total
      // Removing 2 operators means 2/5 = 40% reduction
      // So fees should be 60% of original (or 40% less)
      // consumedWith2Operators should be 60% of consumedWith4Operators
      const expectedConsumedWith2Operators = (consumedWith4Operators * 60n) / 100n;
      const tolerance = expectedConsumedWith2Operators / 100n;
      await expect(consumedWith2Operators).to.be.at.least(expectedConsumedWith2Operators - tolerance);
      await expect(consumedWith2Operators).to.be.at.most(expectedConsumedWith2Operators + tolerance);
    });
  });
});
