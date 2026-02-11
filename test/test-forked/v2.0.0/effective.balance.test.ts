import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getForkedConnection } from "../../setup/fork.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  getCurrentClusterState,
  makeOperatorKey,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
} from "../../common/helpers.ts";
import {
  CLUSTER_VERSION_ETH,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_EB_PER_VALIDATOR,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ForkConfig } from "./config.ts";
import { ssvNetworkFullForkedFixture } from "../../setup/fixtures.ts";
import { ethers } from "ethers";
import { artifacts } from "hardhat";

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

suite("SSVNetwork effective balance scenarios", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  async function getMainnetFixture() {
    const ethers = connection.ethers;
    
    // Use artifacts.readArtifact pattern like fixtures.ts for better reliability
    const networkArtifact = await artifacts.readArtifact("contracts/mainnet-fork/SSVNetwork.sol:SSVNetwork");
    const networkFactory = await ethers.getContractFactoryFromArtifact(networkArtifact);
    
    const viewsArtifact = await artifacts.readArtifact("contracts/mainnet-fork/SSVNetworkViews.sol:SSVNetworkViews");
    const viewsFactory = await ethers.getContractFactoryFromArtifact(viewsArtifact);
    
    const ssvTokenArtifact = await artifacts.readArtifact("contracts/mainnet-fork/token/SSVToken.sol:SSVToken");
    const ssvTokenFactory = await ethers.getContractFactoryFromArtifact(ssvTokenArtifact);

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

  before(async function () {
    ({ connection, networkHelpers } = await getForkedConnection());
    [operatorOwner, clusterOwner, randomUser] = await connection.ethers.getSigners();

    for (const signer of [operatorOwner, clusterOwner, randomUser]) {
      await connection.ethers.provider.send("hardhat_impersonateAccount", [signer.address]);
      await connection.ethers.provider.send("hardhat_setBalance", [
        signer.address,
        "0x56bc75e2d63100000", // 100 ETH
      ]);
    }

    operatorOwner = await connection.ethers.getSigner(operatorOwner.address);
    clusterOwner = await connection.ethers.getSigner(clusterOwner.address);
    randomUser = await connection.ethers.getSigner(randomUser.address);
  });

  describe("Effective Balance Update", () => {
    it("should update EfBalance when adding new validator to same cluster", async function () {
      // Step 1: Fork mainnet and get mainnet contracts
      const { network: mainnetNetwork, views: mainnetViews, ssvToken } =
        await networkHelpers.loadFixture(getMainnetFixture);

      // Step 2: Register operators on mainnet
      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperatorsMainnet(mainnetNetwork, 4);
      await whitelistAddresses(mainnetNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

      // Step 3: Calculate required deposit and set SSV balance
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

      // Step 4: Register validator on mainnet
      const registerTx = await mainnetNetwork.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        enoughDeposit,
        EMPTY_CLUSTER
      );
      await registerTx.wait();

      // Step 5: Upgrade contract
      const { network: forkedNetwork, views: forkedViews, daoSigner, ssvToken: forkedSsvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFullSSVNetworkForkFixture);

      // Step 6: Get cluster data before migration
      let clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Step 7: Calculate ETH deposit for migration
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

      // Step 8: Set ETH balance and migrate cluster
      await connection.ethers.provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (ethDepositX + ethers.parseEther("10")).toString(16),
      ]);

      const migrateTx = await forkedNetwork.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterData, {
        value: ethDepositX,
      });
      const receipt = await migrateTx.wait();

      // Step 9: Get updated cluster data after migration
      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      // Step 10: Assertions
      // Assert cluster is not liquidated
      await expect(await forkedViews.isLiquidated(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(false);

      // Assert cluster is not liquidatable
      await expect(await forkedViews.isLiquidatable(clusterOwner.address, operatorIds, clusterData))
        .to.be.equal(false);

      // Assert cluster asset type is ETH
      const version = await forkedViews.getClusterAssetType(clusterOwner.address, operatorIds);
      await expect(version).to.be.equal(CLUSTER_VERSION_ETH);

      // Step 11: Update cluster effective balance to 2048 ETH
      // Calculate clusterId
      const clusterId = connection.ethers.keccak256(
        connection.ethers.solidityPacked(
          ["address", "uint64[]"],
          [clusterOwner.address, operatorIds]
        )
      );

      // Generate merkle tree for effective balance of 2048 ETH
      const effectiveBalance = 2048; // 2048 ETH
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance }
      ]);

      // Step 11a: Stake SSV tokens to give oracles weight
      // Oracles need weight from staked SSV tokens to commit roots
      // Mint SSV tokens and stake them
      await setSSVBalanceViaStorage(
        connection,
        ForkConfig.SSV_TOKEN,
        randomUser.address,
        STAKE_AMOUNT + ethers.parseEther("1")
      );
      await forkedSsvToken.connect(randomUser).approve(forkedNetwork.target, ethers.MaxUint256);
      await forkedNetwork.connect(randomUser).stake(STAKE_AMOUNT);

      // Set up oracles (get signers and replace existing oracles)
      const oracles = (await connection.ethers.getSigners()).slice(10, 14);
      
      // Set balances for oracles
      for (const oracle of oracles) {
        await connection.ethers.provider.send("hardhat_setBalance", [
          oracle.address,
          "0x56bc75e2d63100000", // 100 ETH
        ]);
      }

      // Replace oracles (need to be done by DAO)
      await forkedNetwork.connect(daoSigner).replaceOracle(1, oracles[0].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(2, oracles[1].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(3, oracles[2].address);
      await forkedNetwork.connect(daoSigner).replaceOracle(4, oracles[3].address);

      // Mine a very large number of blocks to ensure we're ahead of any
      // previously committed block from the forked mainnet state
      // This prevents StaleBlockNumber error when committing roots
      // Using 2,000,000 blocks to handle even very high mainnet latestCommittedBlock values
      // Note: This is safe because we're using the current block number after mining
      await connection.ethers.provider.send("hardhat_mine", [
        "0x1e8480" // Mine 2,000,000 blocks (hex: 0x1e8480)
      ]);
      
      // Get current block number after all setup and mining
      // This block number will definitely be ahead of any latestCommittedBlock from mainnet
      const block = await connection.ethers.provider.getBlock('latest');
      const blockNum = block!.number;

      // Commit root (need 3 out of 4 oracles for quorum)
      for (let i = 0; i < 3; i++) {
        await forkedNetwork.connect(oracles[i]).commitRoot(root, blockNum);
      }

      // Verify root is committed
      await expect(await forkedViews.getCommittedRoot(blockNum)).to.be.equal(root);

      // Update cluster balance
      const clusterStruct = {
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
        clusterStruct,
        effectiveBalance,
        proofs[clusterId]
      );
      await updateTx.wait();

      // Step 12: Verify effective balance was updated
      clusterData = await getCurrentClusterState(
        connection,
        forkedNetwork as any,
        clusterOwner.address,
        operatorIds
      );

      const updatedEffectiveBalance = await forkedViews.getEffectiveBalance(
        clusterOwner.address,
        operatorIds,
        clusterData
      );
      await expect(updatedEffectiveBalance).to.be.equal(effectiveBalance);
    });
  });
});
