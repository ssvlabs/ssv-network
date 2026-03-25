import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcVUnits,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

async function getClusterFromEBUpdateTx(network: any, tx: any): Promise<Cluster> {
  const receipt = await tx.wait();
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = network.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === Events.CLUSTER_BALANCE_UPDATED || parsed?.name === Events.CLUSTER_LIQUIDATED) {
      const ct = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: ct[0].toString(), networkFeeIndex: ct[1].toString(),
        index: ct[2].toString(), active: ct[3], balance: ct[4].toString(),
      };
    }
  }
  throw new Error("ClusterBalanceUpdated event not found");
}

// ---------------------------------------------------------------------------
//  Diamond storage reader for daoTotalEthVUnits
// ---------------------------------------------------------------------------
function protocolStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
}

async function readDaoTotalEthVUnits(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  const slot = protocolStorageBaseSlot() + 4n;
  const raw = BigInt(await provider.getStorage(contractAddress, "0x" + slot.toString(16)));
  return (raw >> 192n) & 0xFFFFFFFFFFFFFFFFn;
}

async function readEthDaoValidatorCount(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  // ethDaoValidatorCount is a uint32 in slot 2 of StorageProtocol, at bits [224..255]
  const slot = protocolStorageBaseSlot() + 2n;
  const raw = BigInt(await provider.getStorage(contractAddress, "0x" + slot.toString(16)));
  return (raw >> 224n) & 0xFFFFFFFFn;
}

describe("Operator vUnit Tracking", () => {
  let connection: NetworkConnection<"generic">;

  before(async function () {
    ({ connection } = await setupTestContext());
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

  describe("Operator vUnit Tracking Across Multiple Clusters", () => {
    it("Accumulates vUnit deviations from multiple clusters for the same operator", async function () {
      const { network, views, cssvToken, ssvToken } =
        await ssvNetworkFullFixture(connection);

      const provider = connection.ethers.provider;
      const signers = await connection.ethers.getSigners();
      const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwnerA, clusterOwnerB] = signers;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      await network.replaceOracle(1, oracle1.address);
      await network.replaceOracle(2, oracle2.address);
      await network.replaceOracle(3, oracle3.address);
      await network.replaceOracle(4, oracle4.address);

      await ssvToken.transfer(staker.address, STAKE_AMOUNT);
      await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
      await network.connect(staker).stake(STAKE_AMOUNT);

      const operatorIds = await registerOperators(network, owner, 4);

      await whitelistAddresses(network, owner, operatorIds, [
        clusterOwnerA.address, clusterOwnerB.address,
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

      // INV-015: G4 — before any explicit EB, daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR
      const contractAddr = await network.getAddress();
      const ethDaoValCount = await readEthDaoValidatorCount(provider, contractAddr);
      expect(ethDaoValCount).to.equal(5n, "INV-015: ethDaoValidatorCount == 5 (2 + 3 validators)");
      const daoVUnitsBeforeEB = await readDaoTotalEthVUnits(provider, contractAddr);
      expect(daoVUnitsBeforeEB).to.equal(
        ethDaoValCount * BPS_DENOMINATOR,
        "INV-015: G4 — daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR when no explicit EB",
      );

      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 64,
      );

      await mineBlocks(provider, 5);
      clusterA = await performEBUpdate(
        network, oracles, provider, clusterOwnerA, operatorIds, clusterA, clusterIdA, 96,
      );

      await mineBlocks(provider, 5);
      clusterB = await performEBUpdate(
        network, oracles, provider, clusterOwnerB, operatorIds, clusterB, clusterIdB, 128,
      );

      expect(clusterA.active).to.be.true;
      expect(clusterB.active).to.be.true;

      expect(calcVUnits(96n)).to.equal(30000n);
      expect(calcVUnits(128n)).to.equal(40000n);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(BigInt(opId));
        expect(BigInt(op[2])).to.equal(5n);
      }
    });
  });
});
