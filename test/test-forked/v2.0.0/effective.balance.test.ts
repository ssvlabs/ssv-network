import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getForkedConnection } from "../../setup/fork.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  generateMerkleForClusterEB,
  getCurrentClusterState,
  makePublicKey,
  makePublicKeys,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  CLUSTER_VERSION_ETH,
  DEFAULT_ETH_EB_PER_VALIDATOR,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  STAKE_AMOUNT,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ForkConfig } from "./config.ts";
import { ssvNetworkFullForkedFixture } from "../../setup/fixtures.ts";
import { ethers } from "ethers";

const RUN_FORK = process.env.RUN_FORK === "true";
const suite = RUN_FORK ? describe : describe.skip;

const EB_STORAGE_POSITION = "ssv.network.storage.eb";
const MAX_UINT64 = (1n << 64n) - 1n;

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

async function getLatestCommittedBlockFromStorage(
  connection: NetworkConnection<"generic">,
  networkAddress: string
): Promise<bigint> {
  const ethers = connection.ethers;
  const baseSlot = BigInt(ethers.keccak256(ethers.toUtf8Bytes(EB_STORAGE_POSITION))) - 1n;
  const latestCommittedBlockSlot = ethers.toBeHex(baseSlot + 3n, 32);

  const rawSlotValue = await ethers.provider.send("eth_getStorageAt", [
    networkAddress,
    latestCommittedBlockSlot,
    "latest",
  ]);

  return BigInt(rawSlotValue) & MAX_UINT64;
}

async function getSafeCommitBlockNumber(
  connection: NetworkConnection<"generic">,
  networkHelpers: NetworkHelpersType,
  networkAddress: string
): Promise<number> {
  const latestCommittedBlock = await getLatestCommittedBlockFromStorage(connection, networkAddress);
  const latestBlock = await connection.ethers.provider.getBlock("latest");
  let currentBlock = BigInt(latestBlock!.number);

  if (currentBlock <= latestCommittedBlock) {
    let blocksToMine = latestCommittedBlock - currentBlock + 1n;
    const mineChunk = 100_000n;

    while (blocksToMine > 0n) {
      const nextChunk = blocksToMine > mineChunk ? mineChunk : blocksToMine;
      await networkHelpers.mine(Number(nextChunk));
      blocksToMine -= nextChunk;
    }

    currentBlock = BigInt((await connection.ethers.provider.getBlock("latest"))!.number);
  }

  return Number(currentBlock);
}

suite("SSVNetwork effective balance scenarios", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  const deployFullSSVNetworkForkFixture = async () => {
    return ssvNetworkFullForkedFixture(connection);
  };

  before(async function () {
    ({ connection, networkHelpers } = await getForkedConnection());
    [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();

    for (const signer of [operatorOwner, clusterOwner, randomUser]) {
      await connection.ethers.provider.send("hardhat_impersonateAccount", [signer.address]);
      await connection.ethers.provider.send("hardhat_setBalance", [
        signer.address,
        "0x56bc75e2d63100000",
      ]);
    }

    operatorOwner = await connection.ethers.getSigner(operatorOwner.address);
    clusterOwner = await connection.ethers.getSigner(clusterOwner.address);
    randomUser = await connection.ethers.getSigner(randomUser.address);
  });

  describe("Effective Balance Update", () => {
    it("should update EfBalance when adding new validator to same cluster", async function () {
      const { network: forkedNetwork, views: forkedViews, daoSigner, ssvToken: forkedSsvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      const operatorIds = await registerOperators(forkedNetwork, operatorOwner, 4);
      await whitelistAddresses(forkedNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      const initialValidators = 10;
      const clusterKeys = makePublicKeys(initialValidators, 100);
      const clusterShares = Array(initialValidators).fill(DEFAULT_SHARES);
      const initialDeposit = ethers.parseEther("50");

      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (initialDeposit + ethers.parseEther("10")).toString(16),
      ]);

      await forkedNetwork.connect(clusterOwner).bulkRegisterValidator(
        clusterKeys,
        operatorIds,
        clusterShares,
        EMPTY_CLUSTER,
        { value: initialDeposit }
      );

      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      await expect(
        await forkedViews.getClusterAssetType(clusterOwner.address, operatorIds)
      ).to.equal(CLUSTER_VERSION_ETH);
      await expect(
        await forkedViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterData)
      ).to.equal(DEFAULT_ETH_EB_PER_VALIDATOR * BigInt(initialValidators));

      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        randomUser.address,
        STAKE_AMOUNT + ethers.parseEther("1")
      );
      await forkedSsvToken.connect(randomUser).approve(forkedNetwork.target, ethers.MaxUint256);
      await forkedNetwork.connect(randomUser).stake(STAKE_AMOUNT);

      const oracles = (await connection.ethers.getSigners()).slice(10, 14);
      for (const oracle of oracles) {
        await connection.ethers.provider.send("hardhat_setBalance", [
          oracle.address,
          "0x56bc75e2d63100000",
        ]);
      }

      await forkedNetwork.connect(daoSigner).replaceOracle(1, oracles[0].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(2, oracles[1].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(3, oracles[2].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(4, oracles[3].address);

      const clusterId = connection.ethers.keccak256(
        connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds])
      );

      const clusterEffectiveBalance = 10_000;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: clusterEffectiveBalance },
      ]);

      const blockNum = await getSafeCommitBlockNumber(
        connection,
        networkHelpers,
        await forkedNetwork.getAddress()
      );
      for (let i = 0; i < 3; i++) {
        await forkedNetwork.connect(oracles[i]).commitRoot(root, blockNum);
      }

      const clusterStructBeforeEbUpdate = {
        validatorCount: Number(clusterData.validatorCount),
        networkFeeIndex: BigInt(clusterData.networkFeeIndex),
        index: BigInt(clusterData.index),
        active: clusterData.active,
        balance: BigInt(clusterData.balance),
      };

      const updateTx = await forkedNetwork.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds.map(id => BigInt(id)),
        clusterStructBeforeEbUpdate,
        clusterEffectiveBalance,
        proofs[clusterId]
      );
      const updateReceipt = await updateTx.wait();
      const clusterAfterEbUpdate = parseClusterFromEvent(
        forkedNetwork,
        updateReceipt,
        Events.CLUSTER_BALANCE_UPDATED
      );

      await expect(
        await forkedViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEbUpdate)
      ).to.equal(clusterEffectiveBalance);

      const blocksToAge = 10n;
      await connection.networkHelpers.mine(Number(blocksToAge));

      const balanceAfter10Blocks = await forkedViews.getBalance(
        clusterOwner.address,
        operatorIds,
        clusterAfterEbUpdate
      );
      const deductionBeforeRegistration = BigInt(clusterAfterEbUpdate.balance) - balanceAfter10Blocks;
      const ebBurnRatePerBlock = await forkedViews.getBurnRate(
        clusterOwner.address,
        operatorIds,
        clusterAfterEbUpdate
      );
      await expect(deductionBeforeRegistration).to.equal(ebBurnRatePerBlock * blocksToAge);

      const registerDeposit = ethers.parseEther("1");
      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (registerDeposit + ethers.parseEther("1")).toString(16),
      ]);

      const registerTx = await forkedNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(9999),
        operatorIds,
        DEFAULT_SHARES,
        clusterAfterEbUpdate,
        { value: registerDeposit }
      );
      const registerReceipt = await registerTx.wait();
      const clusterAfterRegister = parseClusterFromEvent(
        forkedNetwork,
        registerReceipt,
        Events.VALIDATOR_ADDED
      );

      const observedRegisterDeduction =
        BigInt(clusterAfterEbUpdate.balance) + registerDeposit - BigInt(clusterAfterRegister.balance);

      const clusterIndexDelta = BigInt(clusterAfterRegister.index) - BigInt(clusterAfterEbUpdate.index);
      const networkFeeIndexDelta =
        BigInt(clusterAfterRegister.networkFeeIndex) - BigInt(clusterAfterEbUpdate.networkFeeIndex);

      const validatorCountBefore = BigInt(clusterAfterEbUpdate.validatorCount);
      const expectedFlatDeduction =
        (clusterIndexDelta * validatorCountBefore + networkFeeIndexDelta * validatorCountBefore) *
        ETH_DEDUCTED_DIGITS;

      const vUnitsBefore =
        (BigInt(clusterEffectiveBalance) * VUNITS_PRECISION + (DEFAULT_ETH_EB_PER_VALIDATOR - 1n)) /
        DEFAULT_ETH_EB_PER_VALIDATOR;
      const expectedEbAwareDeduction =
        ((clusterIndexDelta * vUnitsBefore) / VUNITS_PRECISION +
          (networkFeeIndexDelta * vUnitsBefore) / VUNITS_PRECISION) *
        ETH_DEDUCTED_DIGITS;

      await expect(expectedEbAwareDeduction).to.be.greaterThan(expectedFlatDeduction);
      await expect(observedRegisterDeduction).to.equal(expectedEbAwareDeduction);
    });
  });
});
