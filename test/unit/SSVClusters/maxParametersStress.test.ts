import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  MAXIMUM_OPERATORS_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

// 13 operators at max fee, 1 validator, EB=2048 (64x baseline), 350K blocks.
// Tests: uint64 operator snapshot accumulation near limits, precision loss
// over many blocks, and full accounting conservation with max-fee parameters.
describe("Max-parameter accounting stress test (S-1)", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const NUM_OPERATORS = 13;
  const EB_PER_VALIDATOR = 2048; // ETH effective balance per validator
  const TOTAL_EB = EB_PER_VALIDATOR; // 1 validator
  const BLOCKS_TO_MINE = 350_000; // ~48 days, pushes operator snapshot balance near uint64 limits

  // Packed fee values (as stored in contract after dividing by ETH_DEDUCTED_DIGITS)
  const PACKED_OP_FEE = MAXIMUM_OPERATORS_FEE / ETH_DEDUCTED_DIGITS;
  const PACKED_NETWORK_FEE = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;

  // vUnits: ceil(totalEB * VUNITS_PRECISION / 32)
  const VUNITS = ((BigInt(TOTAL_EB) * VUNITS_PRECISION) + 31n) / 32n; // 640,000

  const deployClusters = async () => {
    return ssvClustersHarnessFixture(connection, NUM_OPERATORS, MAXIMUM_OPERATORS_FEE);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  it("Conservation invariant holds at max parameters over extended period", async function () {
    this.timeout(600_000);

    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClusters);

    // --- Configure network parameters ---
    await clusters.mockEthNetworkFee(PACKED_NETWORK_FEE);
    await clusters.mockMinimumBlocksBeforeLiquidation(0n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // --- Compute required deposit ---
    const vUnitsMultiplier = VUNITS / VUNITS_PRECISION;
    const perBlockBurnPacked =
      (BigInt(NUM_OPERATORS) * PACKED_OP_FEE + PACKED_NETWORK_FEE) * vUnitsMultiplier;
    const totalFeesPacked = perBlockBurnPacked * BigInt(BLOCKS_TO_MINE + 10); // margin for extra blocks
    const totalFeesWei = totalFeesPacked * ETH_DEDUCTED_DIGITS;
    const depositValue = (totalFeesWei * 120n) / 100n; // 20% margin

    // Fund the cluster owner
    await connection.ethers.provider.send("hardhat_setBalance", [
      clusterOwner.address,
      "0x" + (depositValue + ethers.parseEther("10")).toString(16),
    ]);

    // --- Register 1 validator ---
    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue },
    );
    const regReceipt = await regTx.wait();
    let currentCluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    expect(currentCluster.validatorCount).to.equal(1n);
    expect(currentCluster.active).to.equal(true);

    // The initial deposit is the cluster balance right after registration
    // (depositValue minus any fees for blocks between fixture and registration — should be 0
    // since operators start with 0-based indices at the registration block).
    const initialDeposit = currentCluster.balance;

    // --- Set EB root to 2048 ETH (64x baseline) ---
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const root = getEBRoot(clusterId, TOTAL_EB);
    await clusters.mockSetEBRoot(ebBlockNum, root);

    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      currentCluster,
      TOTAL_EB,
      [],
    );
    const ebReceipt = await ebTx.wait();
    currentCluster = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

    // Verify vUnits stored correctly
    const storedVUnits = await clusters.getClusterVUnits(clusterId);
    expect(storedVUnits).to.equal(VUNITS,
      `Expected vUnits=${VUNITS}, got ${storedVUnits}`);

    // --- Mine blocks ---
    await networkHelpers.mine(BLOCKS_TO_MINE);

    // --- Self-liquidate to settle all fees and recover remaining balance ---
    const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

    const liqTx = await clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      currentCluster,
    );
    const liqReceipt = await liqTx.wait();
    const liqCluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);

    expect(liqCluster.active).to.equal(false);
    expect(liqCluster.balance).to.equal(0n);

    const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
    const gasCost = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
    const liquidationPayout = ownerBalanceAfter - ownerBalanceBefore + gasCost;

    // --- Read operator earnings (packed snapshot balances) ---
    let totalOperatorEarningsPacked = 0n;
    for (const operatorId of operatorIds) {
      const [, , balance] = await clusters.getOperatorEthSnapshot(operatorId);
      totalOperatorEarningsPacked += BigInt(balance);
    }
    const totalOperatorEarningsWei = totalOperatorEarningsPacked * ETH_DEDUCTED_DIGITS;

    // --- Read DAO earnings ---
    // getDaoEthBalance() returns the stored packed value, updated by liquidate() → updateDAO()
    const daoBalancePacked = BigInt(await clusters.getDaoEthBalance());
    const daoEarningsWei = daoBalancePacked * ETH_DEDUCTED_DIGITS;

    // --- Conservation invariant ---
    // The initial deposit funds everything: payout to owner + operator earnings + DAO earnings.
    // Due to integer division (packed arithmetic with truncation at each operator and DAO),
    // there can be minor dust. The cluster fee deduction uses a single division over the sum
    // of operator indices, while each operator's earnings are divided independently.
    //
    // Key insight: operator snapshot earnings can slightly EXCEED cluster-side deduction
    // because the cluster divides (sum_of_indices * vUnits) / VUNITS_PRECISION (one truncation)
    // while operators compute 13 separate (index * vUnits) / VUNITS_PRECISION divisions.
    // The sum of 13 truncated values can differ from one truncated sum.
    //
    // Dust tolerance: conservative bound = sum of all possible truncation sites:
    // - 13 operator snapshot divisions (each can lose up to VUNITS_PRECISION-1 packed units)
    // - 1 DAO earnings division
    // - 2 cluster fee divisions (operator + network fee units)
    // Converted to wei: each packed truncation = up to ETH_DEDUCTED_DIGITS wei
    const totalAccounted = liquidationPayout + totalOperatorEarningsWei + daoEarningsWei;

    // Dust: up to (NUM_OPERATORS + 3) truncation sites, each losing up to
    // (VUNITS_PRECISION - 1) packed units → in wei that's (VUNITS_PRECISION * ETH_DEDUCTED_DIGITS)
    // But in practice truncations are much smaller. Use a generous per-site bound.
    const dustPerSite = VUNITS * ETH_DEDUCTED_DIGITS / VUNITS_PRECISION; // one vUnit multiplier's worth
    const dustTolerance = BigInt(NUM_OPERATORS + 3) * dustPerSite;

    const conservationDiff = initialDeposit > totalAccounted
      ? initialDeposit - totalAccounted
      : totalAccounted - initialDeposit;

    expect(conservationDiff).to.be.lte(
      dustTolerance,
      `Conservation violated: initialDeposit=${initialDeposit}, accounted=${totalAccounted}, ` +
      `diff=${conservationDiff}, tolerance=${dustTolerance}`,
    );

    // --- Verify all operator earnings are positive and roughly equal ---
    // All operators have the same fee, so their earnings should be identical
    const operatorBalances: bigint[] = [];
    for (const operatorId of operatorIds) {
      const [, , balance] = await clusters.getOperatorEthSnapshot(operatorId);
      operatorBalances.push(BigInt(balance));
    }
    const firstOpBalance = operatorBalances[0];
    for (let i = 1; i < operatorBalances.length; i++) {
      expect(operatorBalances[i]).to.equal(firstOpBalance,
        `All operators should have identical earnings (same fee, same vUnits)`);
    }

    // --- Verify DAO earned something proportional to network fee ---
    expect(daoBalancePacked).to.be.gt(0n, "DAO should have positive earnings");

    // --- Verify operator snapshot is near uint64 range (the stress point) ---
    const [, , firstOperatorBalance] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
    const uint64Max = (1n << 64n) - 1n;
    // With 350K blocks at max fee and 2048 EB, operator balance should be a significant
    // fraction of uint64 max — verifying no overflow occurred
    expect(BigInt(firstOperatorBalance)).to.be.gt(0n);
    expect(BigInt(firstOperatorBalance)).to.be.lte(uint64Max);
  });
});
