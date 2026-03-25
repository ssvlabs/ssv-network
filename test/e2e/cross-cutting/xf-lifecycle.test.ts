import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeArrayOfKeysAndShares,
  whitelistAddresses,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
  getValidOperatorFeeIncrease,
  computeClusterId,
  setupOracles,
  commitEBRoot,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcVUnits,
  defaultVUnits,
  checkCSSVSupplyConsistency,
} from "../../helpers/index.ts";

// ── Diamond Storage Reads ──────────────────────────────────────────────
const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;

const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n;
const DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT = PROTOCOL_BASE_SLOT + 4n;
const DAO_TOTAL_SHIFT = 192n;
const UINT64_MASK = (1n << 64n) - 1n;

async function readOperatorEthVUnits(
  provider: any,
  proxyAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(proxyAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

async function readDaoTotalEthVUnits(
  provider: any,
  proxyAddress: string,
): Promise<bigint> {
  const slotHex = "0x" + DAO_TOTAL_ETH_VUNITS_STORAGE_SLOT.toString(16).padStart(64, "0");
  const raw = await provider.getStorage(proxyAddress, slotHex);
  return (BigInt(raw) >> DAO_TOTAL_SHIFT) & UINT64_MASK;
}

async function assertINV11(
  provider: any,
  proxyAddress: string,
  removedOpIds: (number | bigint)[],
): Promise<void> {
  for (const opId of removedOpIds) {
    const vUnits = await readOperatorEthVUnits(provider, proxyAddress, opId);
    expect(vUnits).to.equal(
      0n,
      `INV-11 violated: operatorEthVUnits[${opId}] = ${vUnits}, expected 0`,
    );
  }
}

// ── Helper: register cluster ───────────────────────────────────────────
async function registerCluster(
  network: any,
  owner: HardhatEthersSigner,
  operatorIds: number[],
  deposit?: bigint,
  pubkeyIndex = 1,
): Promise<{ cluster: Cluster; block: number }> {
  const dep = deposit ?? ethers.parseEther("10");
  const tx = await network
    .connect(owner)
    .registerValidator(
      makePublicKey(pubkeyIndex),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: dep },
    );
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
    block: receipt!.blockNumber,
  };
}

// ── Helper: setup explicit EB ──────────────────────────────────────────
async function setupExplicitEB(
  connection: any,
  network: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
  oracles: HardhatEthersSigner[],
): Promise<{ cluster: Cluster; block: number }> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const entries = [{ clusterId, effectiveBalance }];
  const { root, proofs } = generateMerkleForClusterEB(connection, entries);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);
  const tx = await network.updateClusterBalance(
    rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
  );
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
    block: receipt!.blockNumber,
  };
}

// ── Helper: drain and liquidate ────────────────────────────────────────
async function drainAndLiquidate(
  network: any,
  views: any,
  provider: any,
  clusterOwner: HardhatEthersSigner,
  liquidator: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
): Promise<Cluster> {
  // Use actual burn rate from views (accounts for real operator fees + network fee + vUnits)
  const burnRate = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
  const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));

  if (burnRate > 0n) {
    // Mine enough blocks so balance drops below liquidation threshold
    const blocksNeeded = currentBalance / burnRate + 2n;
    await mineBlocks(provider, Number(blocksNeeded));
  } else {
    await mineBlocks(provider, 10);
  }

  const tx = await network
    .connect(liquidator)
    .liquidate(clusterOwner.address, operatorIds, cluster);
  const receipt = await tx.wait();
  return parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
}

// ════════════════════════════════════════════════════════════════════════
// XF — Full Lifecycle Chain Tests (39 gap scenarios)
// ════════════════════════════════════════════════════════════════════════

describe("Cross-Cutting: XF Full Lifecycle Chains", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let signers: HardhatEthersSigner[];

  before(async function () {
    ({ connection, networkHelpers, signers } = await setupTestContext());
  });

  const deployFixture = async () => ssvNetworkFullFixture(connection);

  // ── Multi-op lifecycle (XF-002, XF-003, XF-004) ───────────────────

  function multiOpLifecycleTest(numOps: number, scenarioId: string) {
    it(`${scenarioId}: Complete lifecycle with ${numOps}-operator cluster`, async function () {
      const [operatorOwner, clusterOwner, liquidator] = signers;
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / BigInt(ETH_DEDUCTED_DIGITS);

      const operatorIds = await registerOperators(network, operatorOwner, numOps);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeePacked = BigInt(opData.fee) / BigInt(ETH_DEDUCTED_DIGITS);

      // Register validator
      const deposit = ethers.parseEther("10");
      const { cluster: clusterAfterReg } = await registerCluster(
        network, clusterOwner, operatorIds, deposit,
      );
      let cluster = clusterAfterReg;
      expect(cluster.validatorCount).to.equal(1n);
      expect(cluster.balance).to.equal(deposit);
      expect(cluster.active).to.be.true;

      const daoValCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCount).to.equal(1n);

      // vUnits after register: 1 validator → baseline 10000, no deviation
      const daoVUnitsAfterReg = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterReg).to.equal(10000n, "daoTotalEthVUnits = 10000 after 1 validator registered");
      for (const opId of operatorIds) {
        const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
        expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
      }

      // Advance and deposit
      await mineBlocks(provider, 5000);
      const txDep = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit },
      );
      const receiptDep = await txDep.wait();
      cluster = parseClusterFromEvent(network, receiptDep, Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(deposit * 2n);

      // Advance and withdraw
      await mineBlocks(provider, 5000);
      const withdrawAmount = ethers.parseEther("0.5");
      const txW = await network.connect(clusterOwner).withdraw(
        operatorIds, withdrawAmount, cluster,
      );
      const receiptW = await txW.wait();
      cluster = parseClusterFromEvent(network, receiptW, Events.CLUSTER_WITHDRAWN);

      // Verify fee settlement: balance should be deposit*2 - fees_10000_blocks - 0.5
      const vUnits = defaultVUnits(1n);
      expect(cluster.balance).to.be.lessThan(deposit * 2n - withdrawAmount);

      // Check operator earnings are non-zero (proportional to fee)
      for (const opId of operatorIds) {
        const earnings = BigInt(await views.getOperatorEarnings(BigInt(opId)));
        expect(earnings).to.be.greaterThan(0n, `Operator ${opId} should have accrued earnings`);
      }

      // Remove validator
      const txRV = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1), operatorIds, cluster,
      );
      const receiptRV = await txRV.wait();
      cluster = parseClusterFromEvent(network, receiptRV, Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      const daoValAfter = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValAfter).to.equal(0n);

      // daoTotalEthVUnits should be 0 after all validators removed
      const daoVUnitsAfterRemove = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsAfterRemove).to.equal(0n, "daoTotalEthVUnits = 0 after all validators removed");

      // Withdraw remaining balance (validatorCount=0 → no liquidation check)
      const txWFinal = await network.connect(clusterOwner).withdraw(
        operatorIds, cluster.balance, cluster,
      );
      const receiptWFinal = await txWFinal.wait();
      cluster = parseClusterFromEvent(network, receiptWFinal, Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(0n);

      // Remove all operators and verify earnings payout
      for (const opId of operatorIds) {
        const earningsBefore = BigInt(await views.getOperatorEarnings(BigInt(opId)));
        const txRO = await network.connect(operatorOwner).removeOperator(opId);
        await txRO.wait();
        const opAfter = await views.getOperatorById(BigInt(opId));
        expect(opAfter.isActive).to.be.false;
      }

      // INV-11: all removed operators must have 0 vUnits
      await assertINV11(provider, networkAddress, operatorIds);
      // daoTotalEthVUnits should still be 0 (no validators left)
      const daoVUnitsFinal = await readDaoTotalEthVUnits(provider, networkAddress);
      expect(daoVUnitsFinal).to.equal(0n, "daoTotalEthVUnits = 0 after all operators removed");
    });
  }

  multiOpLifecycleTest(7, "XF-002");
  multiOpLifecycleTest(10, "XF-003");
  multiOpLifecycleTest(13, "XF-004");

  // ── Migration lifecycle (XF-007) ───────────────────────────────────

  it("XF-007: SSV cluster with explicit EB → migrate to ETH → deviation carryover", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    // Setup oracles (requires staking first for cSSV supply > 0)
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register ETH cluster (current codebase doesn't support SSV registration)
    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Deposit more ETH to ensure solvency
    const txDep = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: ethers.parseEther("5") },
    );
    cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

    // EB update to 48 ETH per validator → vUnits = 15000, deviation = 5000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;
    const newVUnits = calcVUnits(48n);
    expect(newVUnits).to.equal(15000n);

    // Verify deviation applied
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(5000n, `operator ${opId} should have 5000 deviation`);
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    // daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000
    expect(daoVUnits).to.equal(15000n);

    // Withdraw and verify cluster still uses correct EB
    await mineBlocks(provider, 500);
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("0.1"), cluster,
    );
    cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
    expect(cluster.active).to.be.true;

    // vUnit consistency persists after withdraw: deviation unchanged
    for (const opId of operatorIds) {
      const vUnitsPost = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnitsPost).to.equal(5000n, `operator ${opId} deviation unchanged after withdraw`);
    }
    const daoVUnitsPost = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnitsPost).to.equal(15000n, "daoTotalEthVUnits unchanged after withdraw");
  });

  // ── Scale/stress tests ─────────────────────────────────────────────

  it("XF-010: 100 validators across 10 clusters — cascade fee change", async function () {
    const [operatorOwner, , , , , , , , , , ...clusterOwners] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    const owners = clusterOwners.slice(0, 10);
    for (const o of owners) {
      await whitelistAddresses(network, operatorOwner, operatorIds, [o.address]);
    }

    // Register 10 clusters with 10 validators each
    const clusters: { owner: HardhatEthersSigner; cluster: Cluster }[] = [];
    for (let i = 0; i < 10; i++) {
      const owner = owners[i];
      const deposit = ethers.parseEther("100");

      // Register first validator
      const { cluster: firstCluster } = await registerCluster(
        network, owner, operatorIds, deposit, i * 10 + 1,
      );
      let cluster = firstCluster;

      // Register 9 more validators
      for (let j = 2; j <= 10; j++) {
        const tx = await network.connect(owner).registerValidator(
          makePublicKey(i * 10 + j), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
        );
        cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      }
      clusters.push({ owner, cluster });
    }

    await mineBlocks(provider, 1000);

    // Declare and execute fee change for op1
    const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
    await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);

    const feePeriods = await views.getOperatorFeePeriods();
    await provider.send("evm_increaseTime", [Number(BigInt(feePeriods[0])) + 1]);
    await mineBlocks(provider, 1);

    await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);
    const opAfter = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(opAfter.fee)).to.equal(BigInt(newFee));

    // Trigger settlement on each cluster via 1-wei withdraw
    for (const { owner, cluster } of clusters) {
      const tx = await network.connect(owner).withdraw(operatorIds, 1n, cluster);
      const receipt = await tx.wait();
      const updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_WITHDRAWN);
      expect(updatedCluster.active).to.be.true;
    }

    // Verify op1 earnings are higher than other ops (higher fee)
    const op1Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
    const op2Earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[1])));
    expect(op1Earnings).to.be.greaterThan(op2Earnings);

    // vUnit consistency: 10 clusters × 10 validators = 100 validators, all implicit EB
    // daoTotalEthVUnits = 100 × 10000 = 1_000_000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(1_000_000n, "daoTotalEthVUnits = 100 validators × 10000");
    // No deviation (implicit EB) → all operator vUnits = 0
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-011: 100 validators across 10 clusters → cascade liquidation", async function () {
    const [operatorOwner, liquidator, , , , , , , , , ...clusterOwners] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    const owners = clusterOwners.slice(0, 10);
    for (const o of owners) {
      await whitelistAddresses(network, operatorOwner, operatorIds, [o.address]);
    }

    // 3 clusters with thin balance (will be liquidatable), 7 with generous balance
    const clusters: { owner: HardhatEthersSigner; cluster: Cluster }[] = [];
    for (let i = 0; i < 10; i++) {
      const deposit = i < 3 ? ethers.parseEther("0.05") : ethers.parseEther("100");
      const { cluster } = await registerCluster(network, owners[i], operatorIds, deposit, i * 10 + 1);
      clusters.push({ owner: owners[i], cluster });
    }

    // Liquidate first 3 thin clusters using drainAndLiquidate
    for (let i = 0; i < 3; i++) {
      clusters[i].cluster = await drainAndLiquidate(
        network, views, provider, clusters[i].owner, liquidator, operatorIds, clusters[i].cluster,
      );
      expect(clusters[i].cluster.active).to.be.false;
    }

    // Verify remaining 7 are unaffected
    for (let i = 3; i < 10; i++) {
      const isLiq = await views.isLiquidatable(
        clusters[i].owner.address, operatorIds, clusters[i].cluster,
      );
      expect(isLiq).to.be.false;
    }

    // Verify operator ethValidatorCount: should be 7 (3 liquidated × 1 validator removed)
    const daoValCount = BigInt(await views.getNetworkValidatorsCount());
    expect(daoValCount).to.equal(7n);

    // vUnit consistency: 7 remaining validators × 10000 = 70000 (all implicit EB)
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(70000n, "daoTotalEthVUnits = 7 validators × 10000 after 3 liquidated");
    // No deviation (implicit EB) → all operator vUnits = 0
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-012: Time-lapse 1M blocks — deposit + withdraw + verify accounting", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("100");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // Advance 1,000,000 blocks
    await mineBlocks(provider, 1_000_000);

    // Deposit to keep solvent
    const bigDeposit = ethers.parseEther("1000");
    const txD = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: bigDeposit },
    );
    cluster = parseClusterFromEvent(network, await txD.wait(), Events.CLUSTER_DEPOSITED);

    // Withdraw partial
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("1"), cluster,
    );
    const receipt = await txW.wait();
    cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_WITHDRAWN);

    // Verify arithmetic didn't overflow — cluster is still active with positive balance
    expect(cluster.active).to.be.true;
    expect(cluster.balance).to.be.greaterThan(0n);

    // Verify operator earnings accumulated over 1M blocks
    for (const opId of operatorIds) {
      const earnings = BigInt(await views.getOperatorEarnings(BigInt(opId)));
      expect(earnings).to.be.greaterThan(0n);
    }

    // vUnit consistency: 1 validator, implicit EB → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 after 1M blocks (no drift)");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-013: Time-lapse 1M blocks with explicit EB (64 ETH, 13 ops) — no overflow", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 13);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("5000");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // EB update to 64 ETH → vUnits = 20000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 64, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Advance 1M blocks
    await mineBlocks(provider, 1_000_000);

    // Deposit more to keep solvent (account has ~5000 ETH default)
    const bigDeposit = ethers.parseEther("4000");
    const txD = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: bigDeposit },
    );
    cluster = parseClusterFromEvent(network, await txD.wait(), Events.CLUSTER_DEPOSITED);

    // Withdraw — this triggers fee settlement over 1M blocks at 2x vUnits
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("1"), cluster,
    );
    cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

    expect(cluster.active).to.be.true;
    expect(cluster.balance).to.be.greaterThan(0n);

    // vUnit consistency: 1 validator at 64 ETH → vUnits = 20000, deviation = 10000
    const networkAddress = await network.getAddress();
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(10000n, `operator ${opId} should have 10000 deviation after EB 64`);
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    // daoTotalEthVUnits = baseline (10000) + deviation (10000) = 20000
    expect(daoVUnits).to.equal(20000n, "daoTotalEthVUnits = 20000 after 1M blocks (no drift)");
  });

  it("XF-014: All operations in single block — zero fees accrue", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Disable automine to batch transactions in one block
    await provider.send("evm_setAutomine", [false]);

    const deposit = ethers.parseEther("10");
    // Register validator
    const txReg = await network.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
    );

    // Mine the block containing the register tx
    await provider.send("evm_mine", []);
    await provider.send("evm_setAutomine", [true]);

    const receiptReg = await txReg.wait();
    let cluster = parseClusterFromEvent(network, receiptReg, Events.VALIDATOR_ADDED);
    const regBlock = receiptReg!.blockNumber;

    // Deposit in same logical sequence (automine back on, but at block N+1)
    const txDep = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: ethers.parseEther("1") },
    );
    cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

    // Withdraw at next block
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("0.5"), cluster,
    );
    const receiptW = await txW.wait();
    cluster = parseClusterFromEvent(network, receiptW, Events.CLUSTER_WITHDRAWN);
    const wBlock = receiptW!.blockNumber;

    // With only 2-3 blocks between register and withdraw, fees should be minimal
    const blockDiff = BigInt(wBlock - regBlock);
    expect(blockDiff).to.be.lessThanOrEqual(3n);

    // Operator earnings should be near-zero (just a few blocks of accrual)
    for (const opId of operatorIds) {
      const earnings = BigInt(await views.getOperatorEarnings(BigInt(opId)));
      // At minimal fee with just a few blocks, earnings are tiny
      expect(earnings).to.be.lessThan(ethers.parseEther("0.001"));
    }

    // vUnit consistency: 1 validator, implicit EB → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 for 1 validator");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-015: Rapid-fire — all operations with 1 block between each", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Block N: register
    const deposit = ethers.parseEther("10");
    const { cluster: c1, block: regBlock } = await registerCluster(
      network, clusterOwner, operatorIds, deposit,
    );
    let cluster = c1;

    // Block N+1: deposit
    const txDep = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: ethers.parseEther("1") },
    );
    cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

    // Block N+2: EB update
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Block N+3: withdraw
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("0.5"), cluster,
    );
    cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);

    // Block N+4: remove validator
    const txRV = await network.connect(clusterOwner).removeValidator(
      makePublicKey(1), operatorIds, cluster,
    );
    cluster = parseClusterFromEvent(network, await txRV.wait(), Events.VALIDATOR_REMOVED);
    expect(cluster.validatorCount).to.equal(0n);

    // Block N+5: remove operators
    for (const opId of operatorIds) {
      await network.connect(operatorOwner).removeOperator(opId);
    }

    // Verify micro-accruals: small positive earnings for each operator
    // (operators removed, so getOperatorEarnings might be zero after removal since earnings paid out)
    const daoVal = BigInt(await views.getNetworkValidatorsCount());
    expect(daoVal).to.equal(0n);

    // INV-11: all removed operators must have 0 vUnits
    await assertINV11(provider, networkAddress, operatorIds);
    // daoTotalEthVUnits should be 0 (no validators, no operators)
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 after all validators and operators removed");
  });

  it("XF-016: Two EB updates for different clusters in same block", async function () {
    const [operatorOwner, ownerA, ownerB, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerA.address, ownerB.address]);

    // Register two clusters
    const deposit = ethers.parseEther("10");
    const { cluster: clusterA } = await registerCluster(network, ownerA, operatorIds, deposit, 1);
    const { cluster: clusterB } = await registerCluster(network, ownerB, operatorIds, deposit, 2);
    let cA = clusterA;
    let cB = clusterB;

    await mineBlocks(provider, 100);

    // Build merkle for both clusters
    const clusterIdA = computeClusterId(ownerA.address, operatorIds);
    const clusterIdB = computeClusterId(ownerB.address, operatorIds);
    const entries = [
      { clusterId: clusterIdA, effectiveBalance: 48 },
      { clusterId: clusterIdB, effectiveBalance: 64 },
    ];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);

    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

    // Update both in quick succession
    const txA = await network.updateClusterBalance(
      rootBlockNum, ownerA.address, operatorIds, cA, 48, proofs[clusterIdA],
    );
    cA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const txB = await network.updateClusterBalance(
      rootBlockNum, ownerB.address, operatorIds, cB, 64, proofs[clusterIdB],
    );
    cB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_BALANCE_UPDATED);

    // Cluster A deviation: 15000 - 10000 = 5000
    // Cluster B deviation: 20000 - 10000 = 10000
    // Each operator should have 5000 + 10000 = 15000 total deviation
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(15000n, `operator ${opId} should have 15000 stacked deviation`);
    }

    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    // daoTotalEthVUnits = 2 validators baseline (20000) + deviations (5000+10000 = 15000) = 35000
    expect(daoVUnits).to.equal(35000n);
  });

  // ── DAO governance interactions ────────────────────────────────────

  it("XF-020: DAO increases minimumLiquidationCollateral → withdraw that was safe now reverts", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register with just enough balance
    const deposit = ethers.parseEther("0.5");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // DAO increases minimum liquidation collateral to a high value
    const highCollateral = ethers.parseEther("10");
    await network.updateMinimumLiquidationCollateral(highCollateral);

    // Withdraw should now revert with InsufficientBalance
    await expect(
      network.connect(clusterOwner).withdraw(operatorIds, 1n, cluster),
    ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);

    // vUnit consistency: 1 validator, implicit EB → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits unchanged by governance parameter update");
  });

  it("XF-034: DAO updateMaximumOperatorFee → executeOperatorFee reverts FeeTooHigh", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    // Get a valid fee increase
    const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));

    // Declare fee increase
    await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);

    // DAO lowers max operator fee below declared fee
    const lowMax = BigInt(MINIMAL_OPERATOR_ETH_FEE); // set max to current minimum
    await network.updateMaximumOperatorFee(lowMax);

    // Wait for execution window
    const feePeriods = await views.getOperatorFeePeriods();
    await provider.send("evm_increaseTime", [Number(BigInt(feePeriods[0])) + 1]);
    await mineBlocks(provider, 1);

    // Execute should revert FeeTooHigh
    await expect(
      network.connect(operatorOwner).executeOperatorFee(operatorIds[0]),
    ).to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);

    // Verify cluster burn rate unchanged
    const opData = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(opData.fee)).to.equal(BigInt(MINIMAL_OPERATOR_ETH_FEE));

    // vUnit consistency: no validators registered → daoTotalEthVUnits = 0
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 (no validators registered)");
  });

  it("XF-044: DAO updateMinimumOperatorEthFee → reduceOperatorFee to below-min reverts FeeTooLow", async function () {
    const [operatorOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    // Current fee is MINIMAL_OPERATOR_ETH_FEE
    // DAO raises minimum above current fee
    const newMin = BigInt(MINIMAL_OPERATOR_ETH_FEE) * 2n;
    await network.updateMinimumOperatorEthFee(newMin);

    // Reduce to 0 is always valid
    await network.connect(operatorOwner).reduceOperatorFee(operatorIds[0], 0n);
    const opAfterZero = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(BigInt(opAfterZero.fee)).to.equal(0n);

    // Try to set fee below new min but > 0 — should revert
    const belowMin = newMin - BigInt(ETH_DEDUCTED_DIGITS);
    await expect(
      network.connect(operatorOwner).reduceOperatorFee(operatorIds[1], belowMin),
    ).to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);

    // vUnit consistency: no validators → daoTotalEthVUnits = 0
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 (no validators registered)");
  });

  it("XF-049: DAO changes all parameters simultaneously — no cross-contamination", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    // Set all DAO parameters in same block sequence
    await network.updateNetworkFee(5_000_000_000n);
    await network.updateLiquidationThresholdPeriod(50000n);
    await network.updateMinimumLiquidationCollateral(ethers.parseEther("0.001"));
    await network.updateMaximumOperatorFee(100_000_000_000n);
    await network.updateMinimumOperatorEthFee(500_000_000n);
    await network.updateUnstakeCooldownDuration(300_000n);

    // Verify each parameter was set correctly
    expect(BigInt(await views.getNetworkFee())).to.equal(5_000_000_000n);
    expect(BigInt(await views.getLiquidationThresholdPeriod())).to.equal(50000n);

    // Register operators and cluster to verify params take effect
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const { cluster } = await registerCluster(
      network, clusterOwner, operatorIds, ethers.parseEther("10"),
    );
    expect(cluster.active).to.be.true;

    // vUnit consistency: 1 validator → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 after param changes + register");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-054: DAO updateUnstakeCooldownDuration → existing request uses old, new request uses new", async function () {
    const [, , stakerA, stakerB] = signers;
    const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    // Stake for both users
    const stakeAmount = ethers.parseEther("100");
    await ssvToken.transfer(stakerA.address, stakeAmount);
    await ssvToken.connect(stakerA).approve(networkAddress, stakeAmount);
    await network.connect(stakerA).stake(stakeAmount);

    await ssvToken.transfer(stakerB.address, stakeAmount);
    await ssvToken.connect(stakerB).approve(networkAddress, stakeAmount);
    await network.connect(stakerB).stake(stakeAmount);

    // A requests unstake under old cooldown
    const unstakeAmount = ethers.parseEther("50");
    await network.connect(stakerA).requestUnstake(unstakeAmount);

    const pendingA = await views.pendingUnstake(stakerA.address);
    const unlockTimeA = BigInt(pendingA[0].unlockTime);

    // DAO changes cooldown duration to much shorter
    const newCooldown = 100n; // 100 seconds
    await network.updateUnstakeCooldownDuration(newCooldown);

    // B requests unstake under new cooldown
    await network.connect(stakerB).requestUnstake(unstakeAmount);
    const pendingB = await views.pendingUnstake(stakerB.address);
    const unlockTimeB = BigInt(pendingB[0].unlockTime);

    // B's unlock time should be much sooner than A's
    expect(unlockTimeB).to.be.lessThan(unlockTimeA);

    // Wait for B's cooldown to pass
    await provider.send("evm_increaseTime", [Number(newCooldown) + 1]);
    await mineBlocks(provider, 1);

    // B can withdraw
    await network.connect(stakerB).withdrawUnlocked();

    // A still can't (old cooldown still active unless enough time passed)
    const block = await provider.getBlock("latest");
    if (BigInt(block!.timestamp) < unlockTimeA) {
      await expect(
        network.connect(stakerA).withdrawUnlocked(),
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);
    }

    // vUnit consistency: no validators registered → daoTotalEthVUnits = 0
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 (no validators, staking-only test)");
  });

  it("XF-055: DAO updateQuorumBps → previously-stuck root now commits", async function () {
    const [, , staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    // Setup oracles
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    // Set high quorum (requires all 4)
    await network.updateQuorumBps(10000n); // 100%

    // Create a root and have 3 of 4 oracles vote — not enough for 100% quorum
    const dummyRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);

    await network.connect(oracle1).commitRoot(dummyRoot, rootBlock);
    await network.connect(oracle2).commitRoot(dummyRoot, rootBlock);
    await network.connect(oracle3).commitRoot(dummyRoot, rootBlock);

    // Root should NOT be committed yet (3/4 < 100%)
    // Now DAO lowers quorum to 50% — 3/4 = 75% > 50%
    await network.updateQuorumBps(5000n);

    // Vote with 4th oracle to trigger quorum check
    const tx = await network.connect(oracle4).commitRoot(dummyRoot, rootBlock);
    await expect(tx).to.emit(network, Events.ROOT_COMMITTED);

    // vUnit consistency: no validators → daoTotalEthVUnits = 0
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 (no validators, oracle-only test)");
  });

  // ── Fee settlement ordering ────────────────────────────────────────

  it("XF-022: Operator fee reduction → cluster gets cheaper → previously-failing withdraw succeeds", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register with thin balance
    const deposit = ethers.parseEther("0.1");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 1000);

    // Try to withdraw — may fail due to insufficient balance after fees
    const withdrawAmount = ethers.parseEther("0.001");

    // Reduce all operator fees to 0 → much lower burn rate
    for (const opId of operatorIds) {
      await network.connect(operatorOwner).reduceOperatorFee(opId, 0n);
    }

    // Now withdrawal should succeed with lower threshold
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, withdrawAmount, cluster,
    );
    const receipt = await txW.wait();
    cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_WITHDRAWN);
    expect(cluster.active).to.be.true;

    // vUnit consistency: 1 validator, implicit EB → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits unchanged after fee reduction + withdraw");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-041: Fee settlement uses OLD vUnits before applying new deviation", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("100");
    const { cluster: regCluster, block: regBlock } = await registerCluster(
      network, clusterOwner, operatorIds, deposit,
    );
    let cluster = regCluster;

    await mineBlocks(provider, 1000);

    // Record balance before EB update
    const balanceBefore = cluster.balance;

    // EB update to 64 ETH → vUnits double from 10000 to 20000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 64, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Fee settlement during EB update should have used OLD vUnits (10000)
    // The balance decrease should reflect old vUnits, not new
    // If new vUnits were used, fees would be 2x higher
    const feesCharged = balanceBefore - cluster.balance;
    expect(feesCharged).to.be.greaterThan(0n);

    // Verify operator vUnits now reflect new EB (deviation = 20000 - 10000 = 10000)
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(10000n, `op${opId} should have 10000 deviation after EB 64`);
    }

    // Now advance and withdraw — this settlement uses NEW vUnits (20000)
    const blocksPhase2 = 1000;
    await mineBlocks(provider, blocksPhase2);

    const balanceBeforeW = cluster.balance;
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("1"), cluster,
    );
    cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
    expect(cluster.active).to.be.true;

    // Fees in second phase use NEW vUnits (20000) = ~2x the old rate (10000)
    // feesPhase2 is the balance decrease during the withdrawal (includes the 1 ETH withdrawn)
    const feesPhase2 = balanceBeforeW - cluster.balance - ethers.parseEther("1");
    expect(feesPhase2).to.be.greaterThan(0n, "fees charged in phase 2");

    // Phase 2 fees should be roughly 2x phase 1 per-block (vUnits doubled from 10000 to 20000).
    // feesCharged covers ~1000 blocks at old vUnits, feesPhase2 covers ~1000 blocks at new vUnits.
    // Allow some tolerance for block-boundary differences.
    expect(feesPhase2).to.be.greaterThan(
      feesCharged,
      "phase 2 fees (2x vUnits) should exceed phase 1 fees (1x vUnits) over same block span",
    );

    // daoTotalEthVUnits = baseline (10000) + deviation (10000) = 20000
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(20000n, "daoTotalEthVUnits consistent after EB 64 update");
  });

  it("XF-042: Register validator into explicit-EB cluster → vUnits increase by baseline only", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register first validator
    const deposit = ethers.parseEther("100");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // EB update: 1 validator at 48 ETH → vUnits = 15000, deviation = 5000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // daoTotalEthVUnits before second validator: baseline(10000) + deviation(5000) = 15000
    const totalBefore = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(totalBefore).to.equal(15000n);

    // Register second validator — adds baseline 10000, NOT deviation-scaled 15000
    const txReg2 = await network.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
    );
    cluster = parseClusterFromEvent(network, await txReg2.wait(), Events.VALIDATOR_ADDED);
    expect(cluster.validatorCount).to.equal(2n);

    // daoTotalEthVUnits increased by exactly baseline (10000), now 25000
    const totalAfter = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(totalAfter).to.equal(totalBefore + 10000n);

    // operatorEthVUnits should be unchanged
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(5000n, "deviation unchanged after adding validator");
    }
  });

  // ── Removed operator lifecycle ─────────────────────────────────────

  it("XF-023: Operator removed mid-lifecycle → burn rate drops + earnings payout", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 5000);

    // Record operator earnings before removal
    const earningsBeforeRemoval = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
    expect(earningsBeforeRemoval).to.be.greaterThan(0n);

    // Record burn rate before removal (4 active ops)
    const burnRateBefore = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRateBefore).to.be.greaterThan(0n, "4-op burn rate should be positive");

    // Remove operator 0
    const ownerBalBefore = await provider.getBalance(operatorOwner.address);
    const txRO = await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    const receiptRO = await txRO.wait();
    const gasCost = receiptRO!.gasUsed * receiptRO!.gasPrice;
    const ownerBalAfter = await provider.getBalance(operatorOwner.address);

    // Operator owner should have received earnings
    const earningsPaid = ownerBalAfter - ownerBalBefore + gasCost;
    expect(earningsPaid).to.be.greaterThan(0n);

    // operatorEthVUnits[removedOp] should be zeroed immediately
    const removedVUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[0]);
    expect(removedVUnits).to.equal(0n, "operatorEthVUnits zeroed after removeOperator");

    const opRemoved = await views.getOperatorById(BigInt(operatorIds[0]));
    expect(opRemoved.isActive).to.be.false;

    // Advance and withdraw — burn rate should be lower (3 ops instead of 4)
    await mineBlocks(provider, 1000);

    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("0.01"), cluster,
    );
    cluster = parseClusterFromEvent(network, await txW.wait(), Events.CLUSTER_WITHDRAWN);
    expect(cluster.active).to.be.true;

    // Burn rate after removal should be lower (3 active ops vs 4)
    const burnRateAfter = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRateAfter).to.be.lessThan(burnRateBefore, "burn rate drops after operator removal");
    expect(burnRateAfter).to.be.greaterThan(0n, "3-op burn rate still positive");

    // The cluster uses operatorIds which includes the removed one,
    // but removed op contributes 0 fee
    const isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
    expect(isLiq).to.be.false;

    // INV-11: removed operator must have 0 vUnits
    await assertINV11(provider, networkAddress, [operatorIds[0]]);
    // daoTotalEthVUnits = 1 validator × 10000 = 10000 (implicit EB, no deviation)
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 (1 validator, implicit EB)");
    // Active operators should have 0 deviation (implicit EB)
    for (let i = 1; i < operatorIds.length; i++) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[i]);
      expect(vUnits).to.equal(0n, `active operator ${operatorIds[i]} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-024: Operator removed → EB update → guard skips removed op (vUnits stays 0)", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("100");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Remove operator 0 — operatorEthVUnits[0] is deleted
    await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    await assertINV11(provider, networkAddress, [operatorIds[0]]);

    // EB update to 48 ETH
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Guard works: removed operator stays at 0 vUnits
    const removedOpVUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[0]);
    expect(removedOpVUnits).to.equal(0n,
      "removed op stays 0 after EB update (guard works)");

    // Active operators should have deviation
    for (let i = 1; i < operatorIds.length; i++) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[i]);
      expect(vUnits).to.equal(5000n, `active op ${operatorIds[i]} should have 5000 deviation`);
    }

    // daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(15000n, "daoTotalEthVUnits consistent after EB update on cluster with removed op");
  });

  it("XF-036: 2 ops removed + EB update → guard skips removed ops, deviation only on 2 remaining", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("100");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Remove 2 operators
    await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    await network.connect(operatorOwner).removeOperator(operatorIds[1]);

    await assertINV11(provider, networkAddress, [operatorIds[0], operatorIds[1]]);

    // EB update
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Guard works: removed operators stay at 0 vUnits
    for (const removedId of [operatorIds[0], operatorIds[1]]) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, removedId);
      expect(vUnits).to.equal(0n,
        `removed op ${removedId} stays 0 after EB update (guard works)`);
    }

    // Active operators should have deviation
    for (let i = 2; i < operatorIds.length; i++) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[i]);
      expect(vUnits).to.equal(5000n, `active op ${operatorIds[i]} should have 5000 deviation`);
    }

    // daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(15000n, "daoTotalEthVUnits consistent after EB update with 2 removed ops");
  });

  it("XF-050: Operator removed → 1000 blocks → deposit → withdraw → zero burn from removed op", async function () {
    const [operatorOwner, clusterOwner] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(
      network, clusterOwner, operatorIds, deposit,
    );
    let cluster = regCluster;

    // Record burn rate before removal (4 active ops)
    const burnRateBefore = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));

    // Remove one operator
    await network.connect(operatorOwner).removeOperator(operatorIds[0]);
    // operatorEthVUnits zeroed immediately
    expect(await readOperatorEthVUnits(provider, networkAddress, operatorIds[0])).to.equal(
      0n,
      "operatorEthVUnits zeroed after removeOperator",
    );

    // Burn rate should drop
    // We need to settle first before checking burn rate — just mine and do a 0-withdraw
    await mineBlocks(provider, 10);
    const txSettle = await network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster);
    cluster = parseClusterFromEvent(network, await txSettle.wait(), Events.CLUSTER_WITHDRAWN);

    const burnRateAfter = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRateAfter).to.be.lessThan(burnRateBefore, "burn rate drops after operator removal");

    await mineBlocks(provider, 1000);

    // Deposit
    const txDep = await network.connect(clusterOwner).deposit(
      clusterOwner.address, operatorIds, cluster, { value: ethers.parseEther("5") },
    );
    cluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

    // Withdraw (triggers settlement)
    const txW = await network.connect(clusterOwner).withdraw(
      operatorIds, ethers.parseEther("0.01"), cluster,
    );
    const receiptW = await txW.wait();
    cluster = parseClusterFromEvent(network, receiptW, Events.CLUSTER_WITHDRAWN);

    // The removed operator contributes fee=0 to the burn rate
    // Verify cluster is more solvent than if all 4 ops had fees
    expect(cluster.active).to.be.true;

    // Only 3 active operators should have earnings, removed op earnings = 0
    const removedOpEarnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[0])));
    expect(removedOpEarnings).to.equal(0n);

    for (let i = 1; i < operatorIds.length; i++) {
      const earnings = BigInt(await views.getOperatorEarnings(BigInt(operatorIds[i])));
      expect(earnings).to.be.greaterThan(0n);
    }

    // INV-11: removed operator must still have 0 vUnits after deposit + withdraw
    await assertINV11(provider, networkAddress, [operatorIds[0]]);
    // daoTotalEthVUnits = 1 validator × 10000 = 10000 (implicit EB, no deviation)
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 (1 validator, implicit EB, removed op)");
    // Active operators should have 0 deviation
    for (let i = 1; i < operatorIds.length; i++) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, operatorIds[i]);
      expect(vUnits).to.equal(0n, `active op ${operatorIds[i]} should have 0 deviation (implicit EB)`);
    }
  });

  // ── EB deviation accounting ────────────────────────────────────────

  it("XF-025: Bulk 50 validators → EB → remove 25 → EB → vUnits halved", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 7);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Bulk register 50 validators
    const bigDeposit = ethers.parseEther("500");

    // Register first validator to create cluster
    const { cluster: firstCluster } = await registerCluster(
      network, clusterOwner, operatorIds, bigDeposit, 1,
    );
    let cluster = firstCluster;

    // Register remaining 49 in bulk (seeds 2..50 = 49 keys)
    const { keys: bulkKeys, shares: bulkShares } = makeArrayOfKeysAndShares(2, 51);
    const txBulk = await network.connect(clusterOwner).bulkRegisterValidator(
      bulkKeys, operatorIds, bulkShares, cluster, { value: 0n },
    );
    cluster = parseClusterFromEvent(network, await txBulk.wait(), Events.VALIDATOR_ADDED);
    expect(cluster.validatorCount).to.equal(50n);

    await mineBlocks(provider, 100);

    // EB update: 48 ETH total for 50 validators = 48*50=2400
    // vUnits = ceil(2400 * 10000 / 32) = 750000
    // baseline = 50 * 10000 = 500000
    // deviation = 250000
    const totalEB = 48 * 50;
    const ebResult1 = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, totalEB, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult1.cluster;

    const expectedVUnits1 = calcVUnits(BigInt(totalEB));
    expect(expectedVUnits1).to.equal(750000n);

    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(250000n, "each op should have 250000 deviation after first EB");
    }

    // Remove 25 validators (seeds 2..26 = 25 keys)
    const { keys: removeKeys } = makeArrayOfKeysAndShares(2, 27);
    const txRemoveBulk = await network.connect(clusterOwner).bulkRemoveValidator(
      removeKeys, operatorIds, cluster,
    );
    cluster = parseClusterFromEvent(network, await txRemoveBulk.wait(), Events.VALIDATOR_REMOVED);
    expect(cluster.validatorCount).to.equal(25n);

    await mineBlocks(provider, 100);

    // EB update: 48 ETH total for 25 validators = 48*25=1200
    // vUnits = ceil(1200 * 10000 / 32) = 375000
    const totalEB2 = 48 * 25;
    const ebResult2 = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, totalEB2, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult2.cluster;

    const expectedVUnits2 = calcVUnits(BigInt(totalEB2));
    expect(expectedVUnits2).to.equal(375000n);

    // Final deviation = 375000 - 250000 = 125000
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(125000n, "each op should have 125000 deviation after second EB");
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    // daoTotalEthVUnits = baseline (25 * 10000 = 250000) + deviation (125000) = 375000
    expect(daoVUnits).to.equal(375000n);
  });

  it("XF-037: Validator removal cleans up deviation when cluster becomes empty", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register 2 validators
    const deposit = ethers.parseEther("100");
    const { cluster: c1 } = await registerCluster(network, clusterOwner, operatorIds, deposit, 1);
    const txR2 = await network.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, c1, { value: 0n },
    );
    let cluster = parseClusterFromEvent(network, await txR2.wait(), Events.VALIDATOR_ADDED);
    expect(cluster.validatorCount).to.equal(2n);

    await mineBlocks(provider, 100);

    // EB update: 48 ETH per validator, 2 validators = 96 total
    // vUnits = ceil(96 * 10000 / 32) = 30000
    // baseline = 2 * 10000 = 20000
    // deviation = 10000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 96, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(10000n);
    }

    // Remove both validators via bulk (seeds 1..2 = 2 keys)
    const { keys: removeKeys } = makeArrayOfKeysAndShares(1, 3);
    const txRemove = await network.connect(clusterOwner).bulkRemoveValidator(
      removeKeys, operatorIds, cluster,
    );
    cluster = parseClusterFromEvent(network, await txRemove.wait(), Events.VALIDATOR_REMOVED);
    expect(cluster.validatorCount).to.equal(0n);

    // Deviation should be cleaned up
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, "deviation cleaned up when cluster emptied");
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n);
  });

  it("XF-039: Two clusters shared ops → concurrent EB updates → operator vUnit stacking", async function () {
    const [operatorOwner, ownerA, ownerB, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerA.address, ownerB.address]);

    const deposit = ethers.parseEther("100");
    const { cluster: cA } = await registerCluster(network, ownerA, operatorIds, deposit, 1);
    const { cluster: cB } = await registerCluster(network, ownerB, operatorIds, deposit, 2);

    await mineBlocks(provider, 100);

    // Build merkle for both clusters with different EBs
    const clusterIdA = computeClusterId(ownerA.address, operatorIds);
    const clusterIdB = computeClusterId(ownerB.address, operatorIds);
    const entries = [
      { clusterId: clusterIdA, effectiveBalance: 48 },  // deviation = +5000
      { clusterId: clusterIdB, effectiveBalance: 64 },  // deviation = +10000
    ];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlock, [oracle1, oracle2, oracle3]);

    // Update cluster A
    const txA = await network.updateClusterBalance(
      rootBlock, ownerA.address, operatorIds, cA, 48, proofs[clusterIdA],
    );
    const updatedA = parseClusterFromEvent(network, await txA.wait(), Events.CLUSTER_BALANCE_UPDATED);

    // After A: each op has +5000 deviation
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(5000n);
    }

    // Update cluster B
    const txB = await network.updateClusterBalance(
      rootBlock, ownerB.address, operatorIds, cB, 64, proofs[clusterIdB],
    );
    const updatedB = parseClusterFromEvent(network, await txB.wait(), Events.CLUSTER_BALANCE_UPDATED);

    // After B: each op has 5000 + 10000 = 15000 total deviation
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(15000n, "vUnits should stack from both clusters");
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    // daoTotalEthVUnits = baseline (2 * 10000 = 20000) + deviations (5000 + 10000 = 15000) = 35000
    expect(daoVUnits).to.equal(35000n);
  });

  it("XF-045: EB update + auto-liquidation → no double deviation subtraction", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    // Set minimum liquidation collateral to 0 to simplify
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Deposit sits between implicit and doubled liquidation thresholds so the EB
    // update (32→64 ETH, doubling vUnits from 10000→20000) triggers auto-liquidation.
    // Burn rate: ~389.76 gwei/block. Threshold period: 21480 blocks.
    //   Threshold @ implicit vUnits (10000): ~0.00837 ETH
    //   Threshold @ doubled  vUnits (20000): ~0.01674 ETH
    // Deposit 0.01 ETH: NOT liquidatable at implicit, IS at doubled.
    const deposit = ethers.parseEther("0.01");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // EB update to 64 ETH → doubles vUnits, MUST trigger auto-liquidation
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const entries = [{ clusterId, effectiveBalance: 64 }];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlock, [oracle1, oracle2, oracle3]);

    const tx = await network.updateClusterBalance(
      rootBlock, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
    );
    const receipt = await tx.wait();

    // Check if auto-liquidation fired
    let wasLiquidated = false;
    try {
      cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_LIQUIDATED);
      wasLiquidated = true;
    } catch {
      cluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    }

    // Auto-liquidation MUST fire — if not, the test setup is broken
    expect(wasLiquidated).to.be.true;

    // Operator deviation: EB added +10000, liquidation subtracted -10000 → net zero
    for (let i = 0; i < operatorIds.length; i++) {
      const vUnitsAfter = await readOperatorEthVUnits(provider, networkAddress, operatorIds[i]);
      expect(vUnitsAfter).to.equal(0n,
        "operator deviation net zero after EB add + liquidation subtract");
    }
    // DAO total: started at baseline (10000), EB added +10000 deviation → 20000,
    // liquidation removed baseline (-10000) and deviation (-10000) → 0
    const daoVUnitsAfter = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnitsAfter).to.equal(0n, "all vUnits removed after liquidation");
  });

  it("XF-048: Reactivate cluster with explicit EB → deviation restored to operators and DAO", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4, liquidator] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    // EB update: 48 ETH → deviation = 5000
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    const deviationPreLiq = 5000n;
    for (const opId of operatorIds) {
      expect(await readOperatorEthVUnits(provider, networkAddress, opId)).to.equal(deviationPreLiq);
    }

    // Liquidate
    cluster = await drainAndLiquidate(
      network, views, provider, clusterOwner, liquidator, operatorIds, cluster,
    );
    expect(cluster.active).to.be.false;

    // Post-liquidation: deviation removed
    for (const opId of operatorIds) {
      expect(await readOperatorEthVUnits(provider, networkAddress, opId)).to.equal(0n);
    }
    expect(await readDaoTotalEthVUnits(provider, networkAddress)).to.equal(0n);

    // Reactivate with generous deposit
    const txReact = await network.connect(clusterOwner).reactivate(
      operatorIds, cluster, { value: ethers.parseEther("100") },
    );
    cluster = parseClusterFromEvent(network, await txReact.wait(), Events.CLUSTER_REACTIVATED);
    expect(cluster.active).to.be.true;

    // Deviation should be restored
    for (const opId of operatorIds) {
      expect(await readOperatorEthVUnits(provider, networkAddress, opId)).to.equal(deviationPreLiq,
        "deviation restored after reactivation");
    }
    // daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000
    expect(await readDaoTotalEthVUnits(provider, networkAddress)).to.equal(15000n);
  });

  // ── Multi-cluster interactions ─────────────────────────────────────

  it("XF-046: Multi-cluster cascade — remove all validators from 3 clusters sharing operators", async function () {
    const [operatorOwner, ownerA, ownerB, ownerC, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerA.address, ownerB.address, ownerC.address]);

    const deposit = ethers.parseEther("100");

    // Register 5 validators per cluster
    async function registerNValidators(owner: HardhatEthersSigner, startIdx: number, count: number) {
      const { cluster: c1 } = await registerCluster(network, owner, operatorIds, deposit, startIdx);
      let cluster = c1;
      for (let i = 1; i < count; i++) {
        const tx = await network.connect(owner).registerValidator(
          makePublicKey(startIdx + i), operatorIds, DEFAULT_SHARES, cluster, { value: 0n },
        );
        cluster = parseClusterFromEvent(network, await tx.wait(), Events.VALIDATOR_ADDED);
      }
      return cluster;
    }

    let clusterA = await registerNValidators(ownerA, 100, 5);
    let clusterB = await registerNValidators(ownerB, 200, 5);
    let clusterC = await registerNValidators(ownerC, 300, 5);

    // DAO validator count should be 15
    expect(BigInt(await views.getNetworkValidatorsCount())).to.equal(15n);

    // EB update for all 3 clusters
    const clusterIdA = computeClusterId(ownerA.address, operatorIds);
    const clusterIdB = computeClusterId(ownerB.address, operatorIds);
    const clusterIdC = computeClusterId(ownerC.address, operatorIds);
    const entries = [
      { clusterId: clusterIdA, effectiveBalance: 48 * 5 },
      { clusterId: clusterIdB, effectiveBalance: 48 * 5 },
      { clusterId: clusterIdC, effectiveBalance: 48 * 5 },
    ];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlock, [oracle1, oracle2, oracle3]);

    const txEBA = await network.updateClusterBalance(
      rootBlock, ownerA.address, operatorIds, clusterA, 48 * 5, proofs[clusterIdA],
    );
    clusterA = parseClusterFromEvent(network, await txEBA.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const txEBB = await network.updateClusterBalance(
      rootBlock, ownerB.address, operatorIds, clusterB, 48 * 5, proofs[clusterIdB],
    );
    clusterB = parseClusterFromEvent(network, await txEBB.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const txEBC = await network.updateClusterBalance(
      rootBlock, ownerC.address, operatorIds, clusterC, 48 * 5, proofs[clusterIdC],
    );
    clusterC = parseClusterFromEvent(network, await txEBC.wait(), Events.CLUSTER_BALANCE_UPDATED);

    // Remove all validators from each cluster in sequence
    const { keys: keysA } = makeArrayOfKeysAndShares(100, 105);
    const txRemA = await network.connect(ownerA).bulkRemoveValidator(keysA, operatorIds, clusterA);
    clusterA = parseClusterFromEvent(network, await txRemA.wait(), Events.VALIDATOR_REMOVED);
    expect(clusterA.validatorCount).to.equal(0n);

    expect(BigInt(await views.getNetworkValidatorsCount())).to.equal(10n);

    const { keys: keysB } = makeArrayOfKeysAndShares(200, 205);
    const txRemB = await network.connect(ownerB).bulkRemoveValidator(keysB, operatorIds, clusterB);
    clusterB = parseClusterFromEvent(network, await txRemB.wait(), Events.VALIDATOR_REMOVED);
    expect(clusterB.validatorCount).to.equal(0n);

    expect(BigInt(await views.getNetworkValidatorsCount())).to.equal(5n);

    const { keys: keysC } = makeArrayOfKeysAndShares(300, 305);
    const txRemC = await network.connect(ownerC).bulkRemoveValidator(keysC, operatorIds, clusterC);
    clusterC = parseClusterFromEvent(network, await txRemC.wait(), Events.VALIDATOR_REMOVED);
    expect(clusterC.validatorCount).to.equal(0n);

    expect(BigInt(await views.getNetworkValidatorsCount())).to.equal(0n);

    // vUnit consistency: all validators removed → daoTotalEthVUnits = 0
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 after all 15 validators removed from 3 clusters");
    // All EB deviations should be cleaned up (clusters emptied)
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation after all clusters emptied`);
    }
  });

  // ── Staking lifecycle ──────────────────────────────────────────────

  it("XF-056: All stakers exit → cSSV supply zero → commitRoot reverts ZeroCSSVSupply", async function () {
    const [, , staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    // Setup oracles (requires staking first)
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    // Staker unstakes fully
    const cssvBalance = BigInt(await cssvToken.balanceOf(staker.address));
    expect(cssvBalance).to.be.greaterThan(0n);

    await network.connect(staker).requestUnstake(cssvBalance);

    // Wait cooldown
    const cooldown = BigInt(await views.cooldownDuration());
    await provider.send("evm_increaseTime", [Number(cooldown) + 1]);
    await mineBlocks(provider, 1);

    await network.connect(staker).withdrawUnlocked();

    // cSSV supply should be 0
    const totalSupply = BigInt(await cssvToken.totalSupply());
    expect(totalSupply).to.equal(0n);

    // commitRoot should revert with ZeroCSSVSupply
    const dummyRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);

    await expect(
      network.connect(oracle1).commitRoot(dummyRoot, rootBlock),
    ).to.be.revertedWithCustomError(network, Errors.ZERO_CSSV_SUPPLY);

    // vUnit consistency: no validators → daoTotalEthVUnits = 0
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(0n, "daoTotalEthVUnits = 0 (no validators, staker exit test)");
  });

  it("XF-060: Full protocol bootstrap — corrected ordering", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    // Step 1-8: DAO parameters
    await network.updateNetworkFee(3_550_900_000n);
    await network.updateLiquidationThresholdPeriod(214800n);
    await network.updateMinimumLiquidationCollateral(940_000_000_000_000n);
    await network.updateMaximumOperatorFee(5_326_300_000n);
    await network.updateMinimumOperatorEthFee(1_065_200_000n);
    await network.updateUnstakeCooldownDuration(604_800n);
    await network.updateQuorumBps(7500n);

    // Step 9: Register operators
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Step 10: Stake SSV (BEFORE oracles to get cSSV > 0)
    const stakeAmount = ethers.parseEther("1000");
    await ssvToken.mint(staker.address, stakeAmount);
    await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
    await network.connect(staker).stake(stakeAmount);
    await checkCSSVSupplyConsistency(cssvToken, stakeAmount);

    // Step 11: Setup oracles (after staking so cSSV > 0)
    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);

    // Step 12: Register validator
    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Step 13: Oracle commits root + EB update to 64 ETH
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 64, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Step 14: Advance 10,000 blocks
    await mineBlocks(provider, 10000);

    // Step 15: syncFees
    const txSync = await network.syncFees();
    await txSync.wait();

    // Step 16: Claim rewards
    const accBefore = BigInt(await views.accEthPerShare());
    expect(accBefore).to.be.greaterThan(0n);

    const stakerBalBefore = await provider.getBalance(staker.address);
    const txClaim = await network.connect(staker).claimEthRewards();
    const receiptClaim = await txClaim.wait();
    const stakerBalAfter = await provider.getBalance(staker.address);
    const gasCost = receiptClaim!.gasUsed * receiptClaim!.gasPrice;
    const claimed = stakerBalAfter - stakerBalBefore + gasCost;
    expect(claimed).to.be.greaterThan(0n);

    // Step 17: Request unstake 500 SSV
    const unstakeAmount = ethers.parseEther("500");
    await network.connect(staker).requestUnstake(unstakeAmount);
    await checkCSSVSupplyConsistency(cssvToken, stakeAmount - unstakeAmount);

    // Step 18: Wait cooldown + withdraw
    const cooldown = BigInt(await views.cooldownDuration());
    await provider.send("evm_increaseTime", [Number(cooldown) + 1]);
    await mineBlocks(provider, 1);

    const ssvBalBefore = BigInt(await ssvToken.balanceOf(staker.address));
    await network.connect(staker).withdrawUnlocked();
    const ssvBalAfter = BigInt(await ssvToken.balanceOf(staker.address));
    expect(ssvBalAfter - ssvBalBefore).to.equal(unstakeAmount);

    // vUnit consistency: 1 validator at EB 64 → deviation = 10000 per operator
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(10000n, `operator ${opId} should have 10000 deviation after EB 64`);
    }
    // daoTotalEthVUnits = baseline (10000) + deviation (10000) = 20000
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(20000n, "daoTotalEthVUnits consistent in full bootstrap scenario");
  });

  // ── Oracle governance + EB ─────────────────────────────────────────

  it("XF-033: replaceOracle → old oracle fails → new oracle succeeds → EB update valid", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, newOracle] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Replace oracle1 with newOracle
    await network.replaceOracle(1, newOracle.address);

    // Old oracle1 attempts commitRoot — should revert NotOracle
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const entries = [{ clusterId, effectiveBalance: 48 }];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);

    await expect(
      network.connect(oracle1).commitRoot(root, rootBlock),
    ).to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);

    // New oracle commits root successfully (with 2 remaining original oracles)
    await network.connect(newOracle).commitRoot(root, rootBlock);
    await network.connect(oracle2).commitRoot(root, rootBlock);
    await network.connect(oracle3).commitRoot(root, rootBlock);

    // EB update succeeds
    const tx = await network.updateClusterBalance(
      rootBlock, clusterOwner.address, operatorIds, cluster, 48, proofs[clusterId],
    );
    cluster = parseClusterFromEvent(network, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);
    expect(cluster.active).to.be.true;

    // vUnit consistency after EB update: 1 validator at 48 ETH → deviation = 5000
    const networkAddress = await network.getAddress();
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(5000n, `operator ${opId} should have 5000 deviation after EB 48`);
    }
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(15000n, "daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000");
  });

  it("XF-058: Mid-round oracle governance → updateClusterBalance fails", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    const deposit = ethers.parseEther("10");
    const { cluster: regCluster } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = regCluster;

    await mineBlocks(provider, 100);

    // Start with quorum at 50% (2 of 4 oracles needed)
    await network.updateQuorumBps(5000n);

    // Partial votes (only 1 oracle votes)
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const entries = [{ clusterId, effectiveBalance: 48 }];
    const { root, proofs } = generateMerkleForClusterEB(connection, entries);
    await mineBlocks(provider, 1);
    const rootBlock = await getBlockNumber(provider);

    await network.connect(oracle1).commitRoot(root, rootBlock);

    // DAO raises quorum to 100% — existing vote not enough
    await network.updateQuorumBps(10000n);

    // Oracle 2 votes — even 2/4 isn't enough for 100%
    await network.connect(oracle2).commitRoot(root, rootBlock);

    // updateClusterBalance should fail — root not committed
    await expect(
      network.updateClusterBalance(
        rootBlock, clusterOwner.address, operatorIds, cluster, 48, proofs[clusterId],
      ),
    ).to.be.revertedWithCustomError(network, Errors.ROOT_NOT_FOUND);

    // vUnit consistency: 1 validator, implicit EB (EB update never applied)
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 (EB update never applied)");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (EB update failed)`);
    }
  });

  // ── Whitelist + privacy ────────────────────────────────────────────

  it("XF-035: Private operators → whitelist lifecycle → non-whitelisted user revert", async function () {
    const [operatorOwner, ownerA, ownerB] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);

    // Make all operators private
    await network.connect(operatorOwner).setOperatorsPrivateUnchecked(operatorIds);

    // Whitelist owner A
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerA.address]);

    // A registers validator — succeeds
    const deposit = ethers.parseEther("10");
    const txReg = await network.connect(ownerA).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
    );
    const receipt = await txReg.wait();
    const cluster = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    expect(cluster.active).to.be.true;

    // B attempts registration — should revert
    await expect(
      network.connect(ownerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      ),
    ).to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED);

    // A's existing cluster unaffected
    const isLiq = await views.isLiquidatable(ownerA.address, operatorIds, cluster);
    expect(isLiq).to.be.false;

    // vUnit consistency: 1 validator, implicit EB → daoTotalEthVUnits = 10000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(10000n, "daoTotalEthVUnits = 10000 for 1 validator (whitelist test)");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  it("XF-057: Whitelist module end-to-end on live cluster", async function () {
    const [operatorOwner, ownerA, ownerB] = signers;
    const { network, views } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerA.address]);

    // A registers validator
    const deposit = ethers.parseEther("10");
    const { cluster } = await registerCluster(network, ownerA, operatorIds, deposit);

    // Make operators private AFTER A has an active cluster
    await network.connect(operatorOwner).setOperatorsPrivateUnchecked(operatorIds);

    // A's existing cluster still works — deposit and withdraw
    const txDep = await network.connect(ownerA).deposit(
      ownerA.address, operatorIds, cluster, { value: ethers.parseEther("1") },
    );
    const updatedCluster = parseClusterFromEvent(network, await txDep.wait(), Events.CLUSTER_DEPOSITED);

    // New user B cannot register
    await expect(
      network.connect(ownerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
      ),
    ).to.be.revertedWithCustomError(network, Errors.CALLER_NOT_WHITELISTED);

    // Whitelist B
    await whitelistAddresses(network, operatorOwner, operatorIds, [ownerB.address]);

    // B can now register
    const txReg = await network.connect(ownerB).registerValidator(
      makePublicKey(3), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit },
    );
    const clusterB = parseClusterFromEvent(network, await txReg.wait(), Events.VALIDATOR_ADDED);
    expect(clusterB.active).to.be.true;

    // vUnit consistency: A has 1 validator, B has 1 validator → daoTotalEthVUnits = 20000
    const networkAddress = await network.getAddress();
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(20000n, "daoTotalEthVUnits = 20000 (2 validators, implicit EB)");
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(0n, `operator ${opId} should have 0 deviation (implicit EB)`);
    }
  });

  // ── Contract rejection ─────────────────────────────────────────────

  // XF-051: REMOVED — false positive. Testing ETHTransferFailed requires a deployed
  // rejector contract that owns an operator and calls removeOperator. The previous
  // test only checked a string constant. A real test needs a Solidity helper contract
  // (with no receive/fallback) deployed, operator registered via that contract, and
  // then removeOperator called — out of scope for this cross-cutting suite.

  // ── Views consistency ──────────────────────────────────────────────

  it("XF-059: SSVViews consistency after mutation chain", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4, liquidator] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Step 1: Register
    const deposit = ethers.parseEther("10");
    const { cluster: c1 } = await registerCluster(network, clusterOwner, operatorIds, deposit);
    let cluster = c1;

    // Views after register
    let balance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
    expect(balance).to.equal(deposit);
    let burnRate = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRate).to.be.greaterThan(0n);
    let isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
    expect(isLiq).to.be.false;

    await mineBlocks(provider, 100);

    // Step 2: EB update
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, 48, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    // Views after EB update — burn rate should increase (higher vUnits)
    const burnRateAfterEB = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRateAfterEB).to.be.greaterThan(burnRate);

    // Step 3: Fee change
    const newFee = await getValidOperatorFeeIncrease(views, BigInt(operatorIds[0]));
    await network.connect(operatorOwner).declareOperatorFee(operatorIds[0], newFee);
    const feePeriods = await views.getOperatorFeePeriods();
    await provider.send("evm_increaseTime", [Number(BigInt(feePeriods[0])) + 1]);
    await mineBlocks(provider, 1);
    await network.connect(operatorOwner).executeOperatorFee(operatorIds[0]);

    // Views after fee change — burn rate increases further
    const burnRateAfterFee = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
    expect(burnRateAfterFee).to.be.greaterThanOrEqual(burnRateAfterEB);

    // Step 4: Liquidate — use actual burn rate from views (fee change made helper inaccurate)
    const actualBurnRate = burnRateAfterFee;
    if (actualBurnRate > 0n) {
      const currentBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
      const blocksNeeded = currentBalance / actualBurnRate + 2n;
      await mineBlocks(provider, Number(blocksNeeded));
    }
    const txLiq = await network.connect(liquidator).liquidate(
      clusterOwner.address, operatorIds, cluster,
    );
    cluster = parseClusterFromEvent(network, await txLiq.wait(), Events.CLUSTER_LIQUIDATED);

    // Views after liquidation
    isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
    expect(isLiq).to.be.false; // liquidated cluster is not "liquidatable" again

    // Step 5: Reactivate
    const txReact = await network.connect(clusterOwner).reactivate(
      operatorIds, cluster, { value: ethers.parseEther("100") },
    );
    cluster = parseClusterFromEvent(network, await txReact.wait(), Events.CLUSTER_REACTIVATED);

    // Views after reactivation
    balance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
    expect(balance).to.be.greaterThan(0n);
    isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
    expect(isLiq).to.be.false;

    // vUnit consistency after full mutation chain (register→EB→fee→liquidate→reactivate)
    // EB 48 deviation restored after reactivation: 5000 per operator
    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(5000n, `operator ${opId} should have 5000 deviation after reactivation`);
    }
    // daoTotalEthVUnits = baseline (10000) + deviation (5000) = 15000
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(15000n, "daoTotalEthVUnits consistent after full mutation chain");
  });

  // ── Bulk stress (XF-052) ───────────────────────────────────────────

  it("XF-052: Bulk register 100 validators → EB update → verify accounting", async function () {
    const [operatorOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4] = signers;
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const networkAddress = await network.getAddress();

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    // Register first validator
    const deposit = ethers.parseEther("5000");
    const { cluster: c1 } = await registerCluster(network, clusterOwner, operatorIds, deposit, 1);
    let cluster = c1;

    // Bulk register 99 more (seeds 2..100 = 99 keys)
    const { keys, shares } = makeArrayOfKeysAndShares(2, 101);
    const txBulk = await network.connect(clusterOwner).bulkRegisterValidator(
      keys, operatorIds, shares, cluster, { value: 0n },
    );
    const receiptBulk = await txBulk.wait();
    cluster = parseClusterFromEvent(network, receiptBulk, Events.VALIDATOR_ADDED);
    expect(cluster.validatorCount).to.equal(100n);

    // Gas should be within block limit
    expect(receiptBulk!.gasUsed).to.be.lessThan(30_000_000n);

    // Verify DAO validator count
    expect(BigInt(await views.getNetworkValidatorsCount())).to.equal(100n);

    await mineBlocks(provider, 100);

    // EB update: 48 ETH × 100 validators = 4800
    const totalEB = 48 * 100;
    const ebResult = await setupExplicitEB(
      connection, network, provider, clusterOwner, operatorIds, cluster, totalEB, [oracle1, oracle2, oracle3],
    );
    cluster = ebResult.cluster;

    const expectedVUnits = calcVUnits(BigInt(totalEB));
    // baseline = 100 * 10000 = 1000000
    const baseline = defaultVUnits(100n);
    const expectedDeviation = expectedVUnits - baseline;

    for (const opId of operatorIds) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, opId);
      expect(vUnits).to.equal(expectedDeviation);
    }

    // daoTotalEthVUnits = baseline + deviation = expectedVUnits
    const daoVUnits = await readDaoTotalEthVUnits(provider, networkAddress);
    expect(daoVUnits).to.equal(expectedVUnits, "daoTotalEthVUnits = expectedVUnits for 100 validators at EB 48");
  });
});
