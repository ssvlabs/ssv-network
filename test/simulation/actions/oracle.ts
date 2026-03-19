/**
 * Oracle actions for Monte Carlo simulation.
 *
 * - actionCommitEBRoot — build Merkle tree, achieve quorum, update cluster balances
 * - actionAdvanceBlocks — mine 150-500 random blocks
 */

import { ethers } from "ethers";
import { generateMerkleForClusterEB } from "../../common/helpers.ts";
import type { SimulationState, ActionResult } from "../types.ts";
import { VERSION_ETH } from "../types.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
} from "../bookkeeping.ts";

/**
 * Commit an effective balance Merkle root via oracle quorum, then
 * call updateClusterBalance for each tracked ETH cluster.
 *
 * Steps:
 * 1. Collect all active ETH clusters
 * 2. Build Merkle tree with 32 ETH/validator effective balances
 * 3. Use 3 of oracle signers to achieve quorum
 * 4. Call updateClusterBalance for each cluster with its proof
 */
export async function actionCommitEBRoot(state: SimulationState): Promise<ActionResult> {
  const NAME = "commitRoot";

  const ethClusters = [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && c.cluster.active && c.cluster.validatorCount > 0n,
  );

  if (ethClusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active ETH clusters" };
  }

  if (state.oracleSigners.length < 3) {
    return { name: NAME, success: false, revertReason: "SKIP: need at least 3 oracle signers" };
  }

  const currentBlock = await state.provider.getBlockNumber();
  const oracleBlock = currentBlock - 1;
  if (oracleBlock <= 0) {
    return { name: NAME, success: false, revertReason: "SKIP: block too early" };
  }
  const entries = ethClusters.map((cr) => {
    const id = clusterKey(ethers, cr.owner, cr.operatorIds);
    const effectiveBalance = 32 * Number(cr.cluster.validatorCount);
    return { clusterId: id, effectiveBalance };
  });

  const ethersNs = {
    ethers: {
      keccak256: ethers.keccak256,
      concat: ethers.concat,
      solidityPacked: ethers.solidityPacked,
      AbiCoder: ethers.AbiCoder,
      ZeroHash: ethers.ZeroHash,
    },
  };

  const { root, proofs } = generateMerkleForClusterEB(ethersNs, entries);

  try {
    const oraclesToUse = state.oracleSigners.slice(0, 3);

    for (const oracleSigner of oraclesToUse) {
      const oracleAddr = await oracleSigner.getAddress();
      await state.provider.send("hardhat_setBalance", [
        oracleAddr,
        "0x" + (10n ** 18n).toString(16),
      ]);

      const tx = await state.network
        .connect(oracleSigner)
        .commitRoot(root, oracleBlock);
      await tx.wait();
    }
    let updatedCount = 0;
    for (const cr of ethClusters) {
      const id = clusterKey(ethers, cr.owner, cr.operatorIds);
      const proof = proofs[id];
      if (!proof) continue;

      const effectiveBalance = 32 * Number(cr.cluster.validatorCount);

      try {
        const tx = await state.network
          .connect(cr.ownerSigner)
          .updateClusterBalance(
            oracleBlock,
            cr.owner,
            cr.operatorIds,
            cr.cluster,
            effectiveBalance,
            proof,
          );
        const receipt = await tx.wait();

        const updatedCluster = parseClusterFromReceipt(
          state.network,
          receipt,
          "ClusterBalanceUpdated",
        );
        if (updatedCluster) cr.cluster = updatedCluster;

        updatedCount++;
      } catch {
      }
    }

    state.currentBlock = await state.provider.getBlockNumber();

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Advance 150-500 random blocks (time passage).
 */
export async function actionAdvanceBlocks(state: SimulationState): Promise<ActionResult> {
  const NAME = "mineBlocks";

  const blocks = Number(state.rng.nextInRange(150n, 500n));

  try {
    await state.provider.send("hardhat_mine", ["0x" + blocks.toString(16)]);
    state.currentBlock = await state.provider.getBlockNumber();

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}
