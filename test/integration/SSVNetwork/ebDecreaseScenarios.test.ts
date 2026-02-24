import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  createCluster,
  getCurrentClusterState,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const FEE_PER_BLOCK_BASELINE = 4n * MINIMAL_OPERATOR_ETH_FEE + NETWORK_FEE;

const FEE_PER_BLOCK_64ETH = 2n * FEE_PER_BLOCK_BASELINE;

describe("TEST-6 Integration: EB decrease via oracle commitRoot pipeline", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [deployer, operatorOwner, clusterOwner, oracle1, oracle2, oracle3, oracle4] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => ssvNetworkFullFixture(connection);

  const getClusterId = (ownerAddress: string, operatorIds: number[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds.map(BigInt)])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(
      coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance])
    );
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  const setupOracles = async (network: any, ssvToken: any) => {
    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);
    await network.replaceOracle(4, oracle4.address);

    await ssvToken.mint(deployer.address, STAKE_AMOUNT);
    await ssvToken.connect(deployer).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(deployer).stake(STAKE_AMOUNT);
  };

  const commitEBRoot = async (network: any, root: string, blockNum: number) => {
    await network.connect(oracle1).commitRoot(root, blockNum);
    await network.connect(oracle2).commitRoot(root, blockNum);
    const tx = await network.connect(oracle3).commitRoot(root, blockNum);
    return tx.wait();
  };

  it("EB update via oracle commitRoot: RootCommitted emitted, exact fees settled at baseline rate", async function () {
    const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    await network
      .connect(clusterOwner)
      .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), {
        value: DEFAULT_ETH_REGISTER_VALUE,
      });
    const clusterAfterReg = await getCurrentClusterState(
      connection, network, clusterOwner.address, operatorIds
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    await setupOracles(network, ssvToken); // +7 blocks from registration

    await networkHelpers.mine(5); // +5 blocks
    const ebBlockNum = (await connection.ethers.provider.getBlockNumber()) - 1;

    const root64 = getEBRoot(clusterId, 64);
    const commitReceipt = await commitEBRoot(network, root64, ebBlockNum); // +3 blocks

    // updateClusterBalance: +1 block = 16 total blocks since registration
    const updateTx = await network.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfterReg,
      64,
      [],
    );
    const updateReceipt = await updateTx.wait();

    const clusterAfterUpdate = parseClusterFromEvent(
      network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED
    );

    expect(clusterAfterUpdate.active).to.equal(true);
    expect(clusterAfterUpdate.validatorCount).to.equal(1n);

    // 16 blocks × FEE_PER_BLOCK_BASELINE (fees settled at 32 ETH rate before EB is applied)
    const expectedFeesPaid = 16n * FEE_PER_BLOCK_BASELINE;
    expect(clusterAfterUpdate.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - expectedFeesPaid);
  });

  it("EB decrease (64→32 ETH): fees for 14 blocks charged at double baseline rate", async function () {
    const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    await network
      .connect(clusterOwner)
      .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), {
        value: DEFAULT_ETH_REGISTER_VALUE,
      });
    const clusterAfterReg = await getCurrentClusterState(
      connection, network, clusterOwner.address, operatorIds
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    await setupOracles(network, ssvToken); // +7 blocks from registration

    await networkHelpers.mine(5); // +5 blocks
    const block1 = (await connection.ethers.provider.getBlockNumber()) - 1;
    const root64 = getEBRoot(clusterId, 64);

    await commitEBRoot(network, root64, block1); // +3 blocks

    const update1Tx = await network.updateClusterBalance(
      block1, clusterOwner.address, operatorIds, clusterAfterReg, 64, [],
    );
    const update1Receipt = await update1Tx.wait();

    const clusterAt64 = parseClusterFromEvent(network, update1Receipt, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAt64.active).to.equal(true);
    expect(clusterAt64.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - 16n * FEE_PER_BLOCK_BASELINE);

    await networkHelpers.mine(10); // +10 blocks

    const block2 = (await connection.ethers.provider.getBlockNumber()) - 1;
    const root32 = getEBRoot(clusterId, 32);

    await commitEBRoot(network, root32, block2); // +3 blocks

    // +1 block = 14 total blocks since update1, fees at 64 ETH rate
    const update2Tx = await network.updateClusterBalance(
      block2, clusterOwner.address, operatorIds, clusterAt64, 32, [],
    );
    const update2Receipt = await update2Tx.wait();
    const clusterAt32 = parseClusterFromEvent(network, update2Receipt, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAt32.active).to.equal(true);
    expect(clusterAt32.validatorCount).to.equal(1n);

    // 14 blocks × FEE_PER_BLOCK_64ETH (= 2× baseline) charged during the 64 ETH window
    const expectedFees64ETH = 14n * FEE_PER_BLOCK_64ETH;
    expect(clusterAt32.balance).to.equal(clusterAt64.balance - expectedFees64ETH);
  });
});
