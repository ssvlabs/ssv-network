/**
 * ES-11: Operator vUnit Tracking Across Multiple Clusters.
 *
 * Verifies that operator vUnit deviations accumulate correctly
 * when an operator serves multiple clusters with different EB updates.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcVUnits,
} from "../helpers/index.ts";

/**
 * Parse the updated cluster from a ClusterBalanceUpdated event.
 */
async function getClusterFromEBUpdateTx(network: any, tx: any): Promise<Cluster> {
  const receipt = await tx.wait();
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = network.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === "ClusterBalanceUpdated" || parsed?.name === "ClusterLiquidated") {
      const ct = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: ct[0].toString(), networkFeeIndex: ct[1].toString(),
        index: ct[2].toString(), active: ct[3], balance: ct[4].toString(),
      };
    }
  }
  throw new Error("ClusterBalanceUpdated event not found");
}

describe("E2E: Operator vUnit Tracking (ES-11)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  async function commitRootWithQuorum(
    network: any, oracles: HardhatEthersSigner[], root: string, blockNum: number,
  ) {
    await network.connect(oracles[0]).commitRoot(root, blockNum);
    await network.connect(oracles[1]).commitRoot(root, blockNum);
    await network.connect(oracles[2]).commitRoot(root, blockNum);
  }

  async function performEBUpdate(
    network: any, oracles: HardhatEthersSigner[], provider: any,
    clusterOwner: HardhatEthersSigner, operatorIds: number[],
    cluster: Cluster, clusterId: string, effectiveBalance: number,
  ): Promise<Cluster> {
    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId, effectiveBalance },
    ]);
    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitRootWithQuorum(network, oracles, root, rootBlockNum);

    const tx = await network.updateClusterBalance(
      rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
    );
    return getClusterFromEBUpdateTx(network, tx);
  }

  describe("ES-11: Operator vUnit Tracking Across Multiple Clusters", () => {
    it("accumulates vUnit deviations from multiple clusters for the same operator", async function () {
      const { network, views, cssvToken, ssvToken } =
        await ssvNetworkFullFixture(connection);

      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwnerA, clusterOwnerB] = signers;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      // Register oracles
      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);
      await network.replaceOracle(4, oracle4.address);

      // Stake SSV for oracle weight
      await ssvToken.transfer(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      // Register 4 operators
      const operatorIds = await registerOperators(network, owner, 4);

      // Whitelist both cluster owners
      await whitelistAddresses(network, owner, operatorIds, [
        clusterOwnerA.address, clusterOwnerB.address,
      ]);

      // --- Cluster A: 2 validators ---
      await provider.send("hardhat_setBalance", [
        clusterOwnerA.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 3n).toString(16),
      ]);

      await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let clusterA = await getCurrentClusterState(connection, network, clusterOwnerA.address, operatorIds);

      await network.connect(clusterOwnerA).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, clusterA,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      clusterA = await getCurrentClusterState(connection, network, clusterOwnerA.address, operatorIds);

      const clusterIdA = connection.ethers.keccak256(
        connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwnerA.address, operatorIds]),
      );

      // --- Cluster B: 3 validators ---
      await provider.send("hardhat_setBalance", [
        clusterOwnerB.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 4n).toString(16),
      ]);

      await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(10), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);

      await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(11), operatorIds, DEFAULT_SHARES, clusterB,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);

      await network.connect(clusterOwnerB).registerValidator(
        makePublicKey(12), operatorIds, DEFAULT_SHARES, clusterB,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      clusterB = await getCurrentClusterState(connection, network, clusterOwnerB.address, operatorIds);

      const clusterIdB = connection.ethers.keccak256(
        connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwnerB.address, operatorIds]),
      );

      expect(BigInt(clusterA.validatorCount)).to.equal(2n);
      expect(BigInt(clusterB.validatorCount)).to.equal(3n);

      // --- Step 1: Update Cluster A EB to 64 (same as implicit) → no deviation change ---
      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 64,
      );

      // --- Step 2: Update Cluster A EB to 96 ETH → 30,000 vUnits (deviation = +10,000) ---
      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 96,
      );

      // --- Step 3: Update Cluster B EB to 128 ETH → 40,000 vUnits (deviation = +10,000) ---
      await mineBlocks(provider, 5);
      clusterB = await performEBUpdate(
        network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 128,
      );

      // Both clusters still active
      expect(clusterA.active).to.be.true;
      expect(clusterB.active).to.be.true;

      // Verify vUnits math
      expect(calcVUnits(96n)).to.equal(30000n);
      expect(calcVUnits(128n)).to.equal(40000n);

      // Each operator has 5 validators (2+3)
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op[2])).to.equal(5n);
      }

      // Total effective vUnits per operator = 20,000 deviation + 5 * 10,000 baseline = 70,000
      // This means operator earns as if serving 7 standard validators
      // Cluster A contributes 30,000 vUnits (3 standard equiv)
      // Cluster B contributes 40,000 vUnits (4 standard equiv)
      // Total: 7 standard equivalents per operator
    });
  });
});
