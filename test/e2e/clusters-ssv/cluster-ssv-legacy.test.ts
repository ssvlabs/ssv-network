import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
} from "../helpers/index.ts";

const OP_ETH_FEE_UNPACKED = 1_000_000_000n;
const OP_SSV_FEE_UNPACKED = 10_000_000_000n;
const NETWORK_FEE_SSV_RAW = 500n;
const NETWORK_FEE_ETH_RAW = 5_000n;
const MIN_BLOCKS_LIQ_SSV = 100n;
const MIN_LIQ_COLLATERAL_SSV_RAW = 100_000n;

describe("SSV Cluster Legacy Operations", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_ETH_FEE_UNPACKED);

    await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ_SSV);
    await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_SSV_RAW);

    await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(100_000n);

    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
    }

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const harnessAddr = await clusters.getAddress();
    await mockToken.mint(harnessAddr, connection.ethers.parseEther("1000"));
    await clusters.mockSetToken(await mockToken.getAddress());

    return { clusters, operatorIds, mockToken };
  };

  describe("SSV Cluster Self-Liquidation", () => {
    it("Self-liquidation returns correct SSV balance after fee deduction", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvBalance = connection.ethers.parseEther("100");

      const opFeeRaw = OP_SSV_FEE_UNPACKED / DEDUCTED_DIGITS;
      const currentBlock = await provider.getBlockNumber();
      const regBlock = BigInt(currentBlock + 1);

      let cumulativeIndex = 0n;
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const storedIndex = BigInt(snap[0]);
        const storedBlock = BigInt(snap[1]);
        cumulativeIndex += storedIndex + (regBlock - storedBlock) * opFeeRaw;
      }

      const liveNFI = await clusters.getCurrentNetworkFeeIndexSSV() + NETWORK_FEE_SSV_RAW;

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: ssvBalance,
        active: true,
        index: cumulativeIndex,
        networkFeeIndex: liveNFI,
      });

      const publicKey = makePublicKey(1);
      const regTx = await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const regReceipt = await regTx.wait();
      const actualRegBlock = BigInt(regReceipt!.blockNumber);
      expect(actualRegBlock).to.equal(regBlock);

      await mineBlocks(provider, 50);

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      const liqTx = await clusters.liquidateSSV(
        clusterOwner.address, operatorIds, ssvCluster,
      );
      const liqReceipt = await liqTx.wait();
      await expect(liqTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);

      const liqBlock = BigInt(liqReceipt!.blockNumber);
      const blockDiff = liqBlock - regBlock;
      const opIndexDelta = blockDiff * opFeeRaw * 4n;
      const nfIndexDelta = blockDiff * NETWORK_FEE_SSV_RAW;
      const usagePacked = (opIndexDelta + nfIndexDelta) * 2n;
      const expectedUsage = usagePacked * DEDUCTED_DIGITS;
      const expectedRefund = ssvBalance - expectedUsage;

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);

      const clusterAfter = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(clusterAfter.active).to.equal(false);
      expect(clusterAfter.balance).to.equal(0n);
      expect(clusterAfter.index).to.equal(0n);
      expect(clusterAfter.networkFeeIndex).to.equal(0n);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0);
      }
    });

    it("SSV cluster with 0 balance — self-liquidation succeeds, no SSV transfer (edge)", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
    });

    it("Already liquidated SSV cluster reverts (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: false,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await expect(
        clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
    });
  });

  describe("SSV Blocked Operations", () => {
    it("ETH operations revert with IncorrectClusterVersion on SSV cluster", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: DEFAULT_ETH_REGISTER_VALUE,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await expect(
        clusters.registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, ssvCluster,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      const deposit = connection.ethers.parseEther("1");
      await expect(
        clusters.deposit(clusterOwner.address, operatorIds, ssvCluster, { value: deposit }),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        clusters.reactivate(operatorIds, ssvCluster, { value: deposit }),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        clusters.withdraw(operatorIds, deposit, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        clusters.liquidate(clusterOwner.address, operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        clusters.removeValidator(makePublicKey(1), operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      await expect(
        clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster),
      ).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    });

    it("migrateClusterToETH succeeds on SSV cluster", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await expect(
        clusters.migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE }),
      ).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });
  });
});
