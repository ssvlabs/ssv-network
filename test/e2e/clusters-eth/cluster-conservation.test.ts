import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  addValidatorsToCluster,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from "../../common/constants.ts";
import {
  mineBlocks,
  snapshotContractBalance,
  checkETHConservation,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Conservation Law — Multi-Cluster ETH Balance Tracking", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwnerA: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;
  let clusterOwnerC: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwnerA, clusterOwnerB, clusterOwnerC] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  it("Maintains ETH conservation across deposits, withdrawals, liquidations, and operator withdrawals", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    await whitelistAddresses(network, operatorOwner, operatorIds, [
      clusterOwnerA.address,
      clusterOwnerB.address,
      clusterOwnerC.address,
    ]);

    const depositA = ethers.parseEther("5");
    await network.connect(clusterOwnerA).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: depositA },
    );
    let clusterA = await getCurrentClusterState(connection, network, clusterOwnerA.address, operatorIds);

    clusterA = await addValidatorsToCluster(
      connection,
      network,
      [makePublicKey(2)],
      [DEFAULT_SHARES],
      clusterOwnerA,
      operatorIds,
      clusterA,
    );

    const depositB = ethers.parseEther("3");
    await network.connect(clusterOwnerB).registerValidator(
      makePublicKey(3),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: depositB },
    );
    let clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);

    const depositC = ethers.parseEther("8");
    await network.connect(clusterOwnerC).registerValidator(
      makePublicKey(4),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: depositC },
    );
    let clusterC = await getCurrentClusterState(connection, network, clusterOwnerC.address, operatorIds);

    clusterC = await addValidatorsToCluster(
      connection,
      network,
      [makePublicKey(5), makePublicKey(6)],
      [DEFAULT_SHARES, DEFAULT_SHARES],
      clusterOwnerC,
      operatorIds,
      clusterC,
    );

    let contractBalance = await snapshotContractBalance(provider, networkAddress);
    // The contract received:
    //   depositA (5 ETH) + addValidatorsToCluster for A (DEFAULT_ETH_REGISTER_VALUE = 10 ETH)
    //   + depositB (3 ETH)
    //   + depositC (8 ETH) + addValidatorsToCluster for C (DEFAULT_ETH_REGISTER_VALUE = 10 ETH)
    // Total = 5 + 10 + 3 + 8 + 10 = 36 ETH
    const expectedContractBalance = depositA + DEFAULT_ETH_REGISTER_VALUE + depositB + depositC + DEFAULT_ETH_REGISTER_VALUE;
    expect(contractBalance).to.equal(expectedContractBalance);

    // Verify conservation: contract.ETH >= sum of stored cluster balances
    // (operator earnings and DAO earnings are zero at this point since no settlement happened)
    const clusterABalance = BigInt(clusterA.balance);
    const clusterBBalance = BigInt(clusterB.balance);
    const clusterCBalance = BigInt(clusterC.balance);
    await checkETHConservation(
      networkAddress,
      provider,
      [clusterABalance, clusterBBalance, clusterCBalance],
      [], // no operator earnings yet
      0n, // no staking pool
      0n, // no DAO ETH earnings
    );

    await mineBlocks(provider, 1000);

    const clusterBBalanceView = await views.getBalance(
      clusterOwnerB.address,
      operatorIds,
      clusterB,
    );

    await network.connect(clusterOwnerB).liquidate(
      clusterOwnerB.address,
      operatorIds,
      clusterB,
    );
    clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);


    const withdrawAmount = ethers.parseEther("1");
    await network.connect(clusterOwnerA).withdraw(
      operatorIds,
      withdrawAmount,
      clusterA,
    );
    clusterA = await getCurrentClusterState(connection, network, clusterOwnerA.address, operatorIds);

    const depositExtra = ethers.parseEther("2");
    await network.connect(clusterOwnerC).deposit(
      clusterOwnerC.address,
      operatorIds,
      clusterC,
      { value: depositExtra },
    );
    clusterC = await getCurrentClusterState(connection, network, clusterOwnerC.address, operatorIds);

    const clusterACurrentBalance = BigInt(await views.getBalance(
      clusterOwnerA.address,
      operatorIds,
      clusterA,
    ));

    const clusterCCurrentBalance = BigInt(await views.getBalance(
      clusterOwnerC.address,
      operatorIds,
      clusterC,
    ));

    const finalClusterBalances: bigint[] = [
      clusterACurrentBalance,
      clusterCCurrentBalance,
    ];

    const operatorEarnings: bigint[] = [];
    for (const opId of operatorIds) {
      const earnings = await views.getOperatorEarnings(BigInt(opId));
      operatorEarnings.push(BigInt(earnings));
    }

    const daoEarnings = await views.getNetworkEarnings();

    // INV-1: contract.ETH >= Σ(current cluster balances) + Σ(operator earnings) + DAO earnings
    await checkETHConservation(
      networkAddress,
      provider,
      finalClusterBalances,
      operatorEarnings,
      0n,
      BigInt(daoEarnings),
    );

    expect(await views.isLiquidated(clusterOwnerB, operatorIds, clusterB)).to.be.true;
  });
});
