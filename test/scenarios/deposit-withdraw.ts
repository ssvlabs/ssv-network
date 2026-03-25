/**
 * Scenario: Deposit → Mine → Withdraw (happy path)
 *
 * Exercises: PASS outcome on all steps.
 *
 * 1. Deposit ETH into an active cluster
 * 2. Mine some blocks (fees accrue)
 * 3. Withdraw a portion of the balance
 *
 * All steps should succeed and assertions should pass.
 */

import { ethers } from "ethers";
import type { Scenario } from "../simulation/scenario-types.ts";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import { parseClusterFromReceipt } from "../simulation/bookkeeping.ts";

export const depositWithdrawScenario: Scenario = {
  id: "deposit-withdraw-happy",
  tags: ["cluster", "deposit", "withdraw", "happy-path"],

  async run(ctx: ScenarioContext) {
    // Find an active cluster and tell the context to snapshot it
    const record = ctx.pickCluster();
    ctx.setActiveCluster(record);
    const depositAmount = ethers.parseEther("1");

    // Step 1: Deposit ETH
    await ctx.step(
      "deposit",
      async () => {
        await ctx.provider.send("hardhat_setBalance", [
          record.owner,
          "0x" + (depositAmount + ethers.parseEther("10")).toString(16),
        ]);
        const tx = await ctx.contracts.network
          .connect(record.ownerSigner)
          .deposit(record.owner, record.operatorIds, record.cluster, {
            value: depositAmount,
          });
        const receipt = await tx.wait();
        const updated = parseClusterFromReceipt(
          ctx.contracts.network,
          receipt,
          "ClusterDeposited",
        );
        if (updated) record.cluster = updated;
      },
      async (pre, post) => {
        // Contract ETH balance should increase by deposit amount
        const diff = post.contractEthBalance - pre.contractEthBalance;
        if (diff < depositAmount) {
          throw new Error(
            `Contract balance increased by ${diff}, expected >= ${depositAmount}`,
          );
        }
      },
    );

    // Step 2: Mine blocks
    await ctx.step(
      "mine-blocks",
      async () => {
        await ctx.mineBlocks(100);
      },
      async (_pre, _post) => {
        // Block number should have advanced
        // No assertion needed — just validating the step works
      },
    );

    // Step 3: Withdraw a small amount
    const withdrawAmount = ethers.parseEther("0.1");
    await ctx.step(
      "withdraw",
      async () => {
        const tx = await ctx.contracts.network
          .connect(record.ownerSigner)
          .withdraw(record.operatorIds, withdrawAmount, record.cluster);
        const receipt = await tx.wait();
        const updated = parseClusterFromReceipt(
          ctx.contracts.network,
          receipt,
          "ClusterWithdrawn",
        );
        if (updated) record.cluster = updated;
      },
      async (pre, post) => {
        // Contract ETH balance should decrease
        if (post.contractEthBalance >= pre.contractEthBalance) {
          throw new Error(
            `Contract balance did not decrease after withdrawal`,
          );
        }
      },
    );
  },
};
