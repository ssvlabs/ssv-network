import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  extractEventArgs,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  BPS_DENOMINATOR,
  NETWORK_FEE_ETH,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, makeOperatorKey, setAccountBalance } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE = 10_000_000_000n;

describe("Migration Regression: removed operator frozen ETH index phantom fee", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let owner1: HardhatEthersSigner;
  let owner2: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner1, owner2] } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(connection);

    const operatorIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const expectedId = await legacyNetwork.connect(owner1)
        .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
      await legacyNetwork.connect(owner1)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
      operatorIds.push(Number(expectedId));
    }

    await ssvToken.mint(owner1.address, TOKEN_REGISTER_AMOUNT);
    await ssvToken.connect(owner1).approve(
      await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
    );

    await legacyNetwork.connect(owner1).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
    );
    const cluster = await getCurrentClusterState(
      connection, legacyNetwork, owner1.address, operatorIds,
    );

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection, legacyNetwork, legacyViews,
    );

    await setAccountBalance(connection.ethers.provider, owner2.address, DEFAULT_ETH_REGISTER_VALUE * 4n);

    const regTx = await newNetwork.connect(owner2).registerValidator(
      makePublicKey(100), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const regReceipt = await regTx.wait();
    const ethInitBlock = regReceipt!.blockNumber;

    await mineBlocks(connection.ethers.provider, 100);

    const owner2Cluster = parseClusterFromEvent(newNetwork, regReceipt, Events.VALIDATOR_ADDED);
    await newNetwork.connect(owner2).registerValidator(
      makePublicKey(101), operatorIds, DEFAULT_SHARES, owner2Cluster,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );

    const removedOpIndex = 0;
    const removedOpId = operatorIds[removedOpIndex];
    const removeTx = await newNetwork.connect(owner1).removeOperator(removedOpId);
    const removeReceipt = await removeTx.wait();
    const removeBlock = removeReceipt!.blockNumber;

    const packedDefault = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const frozenEthIndex = BigInt(removeBlock - ethInitBlock) * packedDefault;

    return {
      network: newNetwork,
      views: newViews,
      operatorIds,
      cluster,
      removedOpId,
      frozenEthIndex,
      ethInitBlock,
    };
  };

  it("Removed operator dangerous state: isActive==false, fee==0, frozen ethSnapshot.index preserved", async function () {
    const { views, removedOpId, frozenEthIndex } =
      await networkHelpers.loadFixture(deployFixture);

    const opView = await views.getOperatorById(removedOpId);
    expect(opView.isActive).to.equal(false);
    expect(BigInt(opView.fee)).to.equal(0n);
    expect(BigInt(opView.validatorCount)).to.equal(0n);
    expect(frozenEthIndex).to.be.greaterThan(0n);
  });

  it("Migrated cluster.index must include frozen ETH index from removed operator", async function () {
    const { network, views, operatorIds, cluster, frozenEthIndex, ethInitBlock } =
      await networkHelpers.loadFixture(deployFixture);

    const activeOpCount = 3n;
    const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const valCount = BigInt(cluster.validatorCount);
    const vUnits = valCount * BPS_DENOMINATOR;
    const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
    const burnRate = activeOpCount * packedOpFee;
    const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
    const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
    const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
      ? liquidationThreshold
      : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

    const ethDeposit = minViable + DEFAULT_ETH_REGISTER_VALUE;
    const migrateTx = await network.connect(owner1).migrateClusterToETH(
      operatorIds, cluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    const migrateBlock = migrateReceipt!.blockNumber;
    const activeOpsIndex = activeOpCount * BigInt(migrateBlock - ethInitBlock) * packedOpFee;
    const expectedFixClusterIndex = activeOpsIndex + frozenEthIndex;
    expect(BigInt(migratedCluster.index)).to.equal(
      expectedFixClusterIndex,
      "FIX: cluster.index must include frozen ETH index from removed operator",
    );
  });

  it("getBalance immediately after migration must equal deposited ETH (no phantom fee)", async function () {
    const { network, views, operatorIds, cluster, frozenEthIndex } =
      await networkHelpers.loadFixture(deployFixture);

    const valCount = BigInt(cluster.validatorCount);
    const activeOpCount = 3n;
    const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
    const burnRate = activeOpCount * packedOpFee;
    const vUnits = valCount * BPS_DENOMINATOR;
    const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
    const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
    const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
      ? liquidationThreshold
      : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

    const ethDeposit = minViable + DEFAULT_ETH_REGISTER_VALUE;
    const migrateTx = await network.connect(owner1).migrateClusterToETH(
      operatorIds, cluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    const phantomFee = (frozenEthIndex * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    expect(phantomFee).to.be.greaterThan(0n);

    const balance = BigInt(
      await views.getBalance(owner1.address, operatorIds, migratedCluster),
    );
    expect(balance).to.equal(
      ethDeposit,
      "FIX: getBalance must equal deposited ETH — no phantom fee deduction from frozen ethSnapshot.index",
    );
  });

  it("Phantom fees must not cause premature liquidation on a well-funded cluster", async function () {
    const { network, views, operatorIds, cluster, frozenEthIndex } =
      await networkHelpers.loadFixture(deployFixture);

    const valCount = BigInt(cluster.validatorCount);
    const activeOpCount = 3n;
    const packedOpFee = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const packedNetFee = NETWORK_FEE_ETH / ETH_DEDUCTED_DIGITS;
    const burnRate = activeOpCount * packedOpFee;
    const vUnits = valCount * BPS_DENOMINATOR;
    const thresholdUnits = (MINIMUM_BLOCKS_BEFORE_LIQUIDATION * (burnRate + packedNetFee) * vUnits) / BPS_DENOMINATOR;
    const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
    const minViable = liquidationThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
      ? liquidationThreshold
      : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

    const phantomFee = (frozenEthIndex * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
    const perBlockBurn = ((burnRate + packedNetFee) * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const ethDeposit = minViable + perBlockBurn * 10n;
    const migrateTx = await network.connect(owner1).migrateClusterToETH(
      operatorIds, cluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    const isLiq = await views.isLiquidatable(owner1.address, operatorIds, migratedCluster);
    expect(isLiq).to.equal(
      false,
      "FIX: cluster with 10-block buffer above threshold must not be liquidatable",
    );

    await expect(
      network.connect(owner2).liquidate(owner1.address, operatorIds, migratedCluster),
    ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });
});
