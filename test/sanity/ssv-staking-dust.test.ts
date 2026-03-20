import type { NetworkConnection } from 'hardhat/types/network';
import type { NetworkHelpersType } from '../common/types.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { ssvNetworkFullFixture } from '../setup/fixtures.ts';
import {
  registerOperators,
  registerDefaultClusters,
  buildEBMerkleForDefaultClusters,
  updateClusterBalancesForDefaultClusters,
  commitEBRoot,
  getCurrentClusterState,
  setAccountBalance,
  setupOracles,
  setupTestContext,
} from '../common/helpers.ts';
import { expect } from 'chai';

describe("Dust check in the ssv staking module", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner] } = await setupTestContext());
  });

  const deployFixture = async () => ssvNetworkFullFixture(connection);

  it("Should not leave any dust after all participants withdraw their funds", async function () {
    const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);

    const networkAddress = await network.getAddress();

    await ssvToken.mint(networkAddress, connection.ethers.parseEther("100"));
    await setAccountBalance(connection.ethers.provider, networkAddress, connection.ethers.parseEther("100"));

    const allSigners = await connection.ethers.getSigners();
    const staker = allSigners[2];
    const oracles = allSigners.slice(16, 20);

    await setupOracles(network, ssvToken, staker, oracles);

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    const registered = await registerDefaultClusters(connection, network, operatorIds, operatorOwner, 10);

    const effectiveBalance = 64;
    const merkleData = buildEBMerkleForDefaultClusters(connection, registered, effectiveBalance);

    const blockNum = (await connection.ethers.provider.getBlock('latest'))!.number;

    await commitEBRoot(network, merkleData.root, blockNum, oracles);

    await updateClusterBalancesForDefaultClusters(network, registered, merkleData, blockNum, effectiveBalance);

    const stakers = [allSigners[1], allSigners[3], allSigners[4], allSigners[15], allSigners[16]];
    for (let i = 0; i < stakers.length; i++) {
      const amount = connection.ethers.parseEther((Math.floor(Math.random() * 1000) + 1).toString());
      await ssvToken.mint(stakers[i].address, amount);
      await ssvToken.connect(stakers[i]).approve(networkAddress, amount);
      await network.connect(stakers[i]).stake(amount);
    }

    const clusterStates = [];
    for (const { owner } of registered.clusters) {
      clusterStates.push(await getCurrentClusterState(connection, network, owner.address, operatorIds));
    }

    await networkHelpers.mine(100);

    for (const id of operatorIds) {
      await network.connect(operatorOwner).withdrawAllOperatorEarnings(id);
    }

    const currentNetworkFee = await views.getNetworkFee();
    await network.updateNetworkFee(currentNetworkFee * 2n);

    await networkHelpers.mine(100);

    for (const id of operatorIds) {
      await network.connect(operatorOwner).withdrawAllOperatorEarnings(id);
    }

    await networkHelpers.mine(100);

    for (let i = 0; i < registered.clusters.length; i++) {
      const { owner } = registered.clusters[i];
      await network.connect(owner).liquidate(owner.address, operatorIds, clusterStates[i]);
    }

    await networkHelpers.mine(100);

    for (const id of operatorIds) {
      await network.connect(operatorOwner).withdrawAllOperatorEarnings(id);
    }

    await networkHelpers.mine(100);

    for (const s of stakers) {
      await network.connect(s).claimEthRewards();
      const cssvBalance = await cssvToken.balanceOf(s.address);
      await network.connect(s).requestUnstake(cssvBalance);
    }

    const cooldown = 7 * 24 * 60 * 60 + 1;
    await connection.ethers.provider.send("evm_increaseTime", [cooldown]);
    await connection.ethers.provider.send("evm_mine", []);

    for (const s of stakers) {
      await network.connect(s).withdrawUnlocked();
    }

    const allStakers = [...stakers, staker];
    const unstakers = [];
    for (const s of allStakers) {
      const cssvBalance = await cssvToken.balanceOf(s.address);
      if (cssvBalance > 0n) {
        await network.connect(s).claimEthRewards();
        await network.connect(s).requestUnstake(cssvBalance);
        unstakers.push(s);
      }
    }

    await connection.ethers.provider.send("evm_increaseTime", [cooldown]);
    await connection.ethers.provider.send("evm_mine", []);

    for (const s of unstakers) {
      await network.connect(s).withdrawUnlocked();
    }

    const contractEth = await connection.ethers.provider.getBalance(networkAddress);
    const contractSsv = await ssvToken.balanceOf(networkAddress);

    expect(contractEth).to.be.closeTo(connection.ethers.parseEther("100"), connection.ethers.parseEther("0.0000001"));
    expect(contractSsv).to.equal(connection.ethers.parseEther("100"));
  });
});
