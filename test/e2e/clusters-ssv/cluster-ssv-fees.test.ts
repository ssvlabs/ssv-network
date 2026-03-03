import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import { makePublicKey } from "../../common/helpers.ts";
import {
  DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, getBlockNumber, calcSSVClusterFees } from "../helpers/index.ts";
import { ethers } from "ethers";

describe("CM-17 & CM-25: SSV Cluster Fee Mechanics", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  describe("SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      const ssvFeeUnpacked = 2_000n * DEDUCTED_DIGITS;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, ssvFeeUnpacked);
      }

      await clusters.mockSSVNetworkFee(1_000n);
      const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const netFeeIndexReceipt = await netFeeIndexTx.wait();
      const netFeeBlock = netFeeIndexReceipt!.blockNumber;

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());

      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      await clusters.mockMinimumBlocksBeforeLiquidationSSV(0n);
      await clusters.mockMinimumLiquidationCollateralSSV(0n);

      return { clusters, operatorIds, mockToken, netFeeBlock };
    };

    it("Verifies exact SSV fee deduction after 500 blocks with 3 validators", async function () {
      const { clusters, operatorIds, mockToken, netFeeBlock } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvBalance = ethers.parseEther("1000");
      const ssvCluster: Cluster = {
        validatorCount: 3n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ssvBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(
        publicKey,
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      const opSnapshots: { block: bigint; index: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
        opSnapshots.push({ block: BigInt(blockNumber), index: BigInt(index) });
      }

      await mineBlocks(provider, 500);

      const ownerBalanceBefore = await mockToken.balanceOf(clusterOwner.address);

      const tx = await clusters.liquidateSSV(
        clusterOwner.address,
        operatorIds,
        ssvCluster,
      );
      const receipt = await tx.wait();
      const liquidationBlock = BigInt(receipt!.blockNumber);

      const expectedFees = calcSSVClusterFees({
        currentBlock: liquidationBlock,
        opSnapshots,
        opFeeRaw: 2_000n,
        netFeeBlock: BigInt(netFeeBlock),
        netFeeRaw: 1_000n,
        storedNetFeeIndex: 0n,
        validatorCount: 3n,
        clusterIndex: 0n,
        clusterNetworkFeeIndex: 0n,
      });

      const ownerBalanceAfter = await mockToken.balanceOf(clusterOwner.address);
      const ssvRefund = BigInt(ownerBalanceAfter) - BigInt(ownerBalanceBefore);

      const expectedRefund = ssvBalance - expectedFees;
      expect(ssvRefund).to.equal(expectedRefund);

      expect(ssvRefund).to.be.lessThan(ssvBalance);

      const totalFeesDeducted = ssvBalance - ssvRefund;
      expect(totalFeesDeducted).to.equal(expectedFees);

      expect(totalFeesDeducted % DEDUCTED_DIGITS).to.equal(0n,);

      const packedFees = totalFeesDeducted / DEDUCTED_DIGITS;
      const expectedPackedFees = expectedFees / DEDUCTED_DIGITS;
      expect(packedFees).to.equal(expectedPackedFees);
    });
  });

  describe("updateClusterBalance on SSV Cluster — EB Snapshot Only", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      const ssvFeeUnpacked = 1_000n * DEDUCTED_DIGITS;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, ssvFeeUnpacked);
      }

      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      return { clusters, operatorIds };
    };

    it("Only updates EB snapshot on SSV cluster, no fee settlement", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvBalance = ethers.parseEther("100");
      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ssvBalance,
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      const effectiveBalance = 64;
      const blockNum = await getBlockNumber(provider);

      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint32"],
        [clusterId, effectiveBalance],
      );
      const innerHash = ethers.keccak256(encoded);
      const leaf = ethers.keccak256(innerHash);

      await clusters.mockSetEBRoot(blockNum, leaf);

      await mineBlocks(provider, 10);

      const tx = await clusters.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        ssvCluster,
        effectiveBalance,
        [],
      );
      const receipt = await tx.wait();

      await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
      const vUnits = await clusters.getClusterVUnits(clusterId);
      expect(vUnits).to.equal(20_000n);
    });
  });
});
