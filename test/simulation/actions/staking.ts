/**
 * Staking actions for Monte Carlo simulation.
 *
 * - actionStakeSSV
 * - actionRequestUnstake
 * - actionWithdrawUnlocked
 * - actionClaimEthRewards
 */

import { ethers } from "ethers";
import type { SimulationState, ActionResult } from "../types.ts";
import {
  trackStakingFlow,
  trackRewardsClaimed,
} from "../bookkeeping.ts";

const MINIMAL_STAKING_AMOUNT = 1_000_000_000n;


/**
 * Provision SSV tokens to an address via hardhat_setStorageAt.
 */
async function provisionSSV(
  provider: any,
  ssvToken: any,
  recipient: string,
  amount: bigint,
): Promise<void> {
  const tokenAddr = await ssvToken.getAddress();
  const balanceSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [recipient, 0],
    ),
  );
  await provider.send("hardhat_setStorageAt", [
    tokenAddr,
    balanceSlot,
    ethers.zeroPadValue(ethers.toBeHex(amount), 32),
  ]);
}

/**
 * Stake a random amount of SSV tokens for a random staker.
 */
export async function actionStakeSSV(state: SimulationState): Promise<ActionResult> {
  const NAME = "stake";

  if (state.stakerPool.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no staker accounts" };
  }

  const staker = state.rng.pick(state.stakerPool);
  const addr = await staker.signer.getAddress();
  const minStake = 10n * 10n ** 18n;
  const maxStake = 1000n * 10n ** 18n;
  const stakeAmount = state.rng.nextInRange(minStake, maxStake);

  if (stakeAmount < MINIMAL_STAKING_AMOUNT) {
    return { name: NAME, success: false, revertReason: "SKIP: below minimum" };
  }

  try {
    await provisionSSV(state.provider, state.ssvToken, addr, stakeAmount * 2n);

    await state.provider.send("hardhat_setBalance", [
      addr,
      "0x" + (10n ** 18n).toString(16),
    ]);

    const networkAddr = await state.network.getAddress();
    await state.ssvToken.connect(staker.signer).approve(networkAddr, stakeAmount);

    const tx = await state.network.connect(staker.signer).stake(stakeAmount);
    const receipt = await tx.wait();

    staker.cssvBalance += stakeAmount;
    trackStakingFlow(state, "in", stakeAmount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Request unstake for a random staker who holds cSSV.
 */
export async function actionRequestUnstake(state: SimulationState): Promise<ActionResult> {
  const NAME = "requestUnstake";

  const stakersWithBalance = state.stakerPool.filter((s) => s.cssvBalance > 0n);
  if (stakersWithBalance.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no stakers with cSSV" };
  }

  const staker = state.rng.pick(stakersWithBalance);
  const pct = state.rng.nextInRange(10n, 50n);
  const unstakeAmount = (staker.cssvBalance * pct) / 100n;

  if (unstakeAmount === 0n) {
    return { name: NAME, success: false, revertReason: "SKIP: unstake amount rounds to 0" };
  }

  try {
    const tx = await state.network.connect(staker.signer).requestUnstake(unstakeAmount);
    const receipt = await tx.wait();
    let unlockBlock = BigInt(state.currentBlock + 50120);
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = state.network.interface.parseLog(log);
        if (parsed?.name === "UnstakeRequested") {
          const unlockTime = BigInt(parsed.args[2]);
          const block = await state.provider.getBlock("latest");
          const currentTimestamp = BigInt(block.timestamp);
          const blocksRemaining = (unlockTime - currentTimestamp) / 12n;
          unlockBlock = BigInt(receipt!.blockNumber) + blocksRemaining;
          break;
        }
      } catch {
        continue;
      }
    }

    staker.cssvBalance -= unstakeAmount;
    staker.pendingRequests.push({ amount: unstakeAmount, unlockBlock });

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Withdraw unlocked SSV for a staker with expired cooldown.
 */
export async function actionWithdrawUnlocked(state: SimulationState): Promise<ActionResult> {
  const NAME = "withdrawUnlocked";

  const currentBlockBig = BigInt(state.currentBlock);
  const stakersWithUnlocked = state.stakerPool.filter((s) =>
    s.pendingRequests.some((u) => u.unlockBlock <= currentBlockBig),
  );
  if (stakersWithUnlocked.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no unlocked requests" };
  }

  const staker = state.rng.pick(stakersWithUnlocked);

  try {
    const tx = await state.network.connect(staker.signer).withdrawUnlocked();
    const receipt = await tx.wait();

    const unlockedAmount = staker.pendingRequests
      .filter((u) => u.unlockBlock <= currentBlockBig)
      .reduce((sum, u) => sum + u.amount, 0n);

    staker.pendingRequests = staker.pendingRequests.filter(
      (u) => u.unlockBlock > currentBlockBig,
    );

    trackStakingFlow(state, "out", unlockedAmount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Claim ETH rewards for a random staker with cSSV.
 */
export async function actionClaimEthRewards(state: SimulationState): Promise<ActionResult> {
  const NAME = "claimEthRewards";

  const stakersWithBalance = state.stakerPool.filter((s) => s.cssvBalance > 0n);
  if (stakersWithBalance.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no stakers with cSSV" };
  }

  const staker = state.rng.pick(stakersWithBalance);
  const addr = await staker.signer.getAddress();

  try {
    const claimable = await state.views.previewClaimableEth(addr);

    const tx = await state.network.connect(staker.signer).claimEthRewards();
    const receipt = await tx.wait();

    trackRewardsClaimed(state, BigInt(claimable));
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}
