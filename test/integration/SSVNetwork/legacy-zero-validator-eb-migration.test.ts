import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  commitEBRoot,
  calcOperatorFeeAccrual,
  computeClusterId,
  computeEBRoot,
  defaultVUnits,
  extractEventArgs,
  getBlockNumber,
  getCurrentClusterState,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  registerOperatorsSSV,
  setupOracles,
  setupTestContext,
  whitelistAddresses,
} from "../../helpers/index.js";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

describe("SSVNetwork Integration - legacy zero-validator EB migration", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [operatorOwner, clusterOwner, oracle1, oracle2, oracle3, oracle4, staker],
    } = await setupTestContext());
  });

  const deployFixture = async () => ssvNetworkFullPreUpgradeFixture(connection);

  it("clears stale legacy EB when all SSV validators are removed before migration", async function () {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await networkHelpers.loadFixture(deployFixture);

    const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
    await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

    const publicKeys = [makePublicKey(1), makePublicKey(2)];
    const ssvDeposit = TOKEN_REGISTER_AMOUNT * BigInt(publicKeys.length);
    await ssvToken.mint(clusterOwner.address, ssvDeposit);
    await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);

    await legacyNetwork.connect(clusterOwner).registerValidator(
      publicKeys[0],
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      EMPTY_CLUSTER,
    );
    let cluster = await getCurrentClusterState(
      connection,
      legacyNetwork,
      clusterOwner.address,
      operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      publicKeys[1],
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      cluster,
    );
    cluster = await getCurrentClusterState(
      connection,
      legacyNetwork,
      clusterOwner.address,
      operatorIds,
    );
    expect(BigInt(cluster.validatorCount)).to.equal(2n);

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection,
      legacyNetwork,
      legacyViews,
    );

    await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const inflatedEffectiveBalance = 4096;
    const root = computeEBRoot(clusterId, inflatedEffectiveBalance);

    await mineBlocks(connection.ethers.provider, 1);
    const rootBlock = await getBlockNumber(connection.ethers.provider);
    await commitEBRoot(newNetwork, root, rootBlock, [oracle1, oracle2, oracle3]);

    const updateTx = await newNetwork
      .connect(clusterOwner)
      .updateClusterBalance(
        rootBlock,
        clusterOwner.address,
        operatorIds,
        cluster,
        inflatedEffectiveBalance,
        [],
      );
    const clusterAfterEB = parseClusterFromEvent(
      newNetwork,
      await updateTx.wait(),
      Events.CLUSTER_BALANCE_UPDATED,
    );

    expect(
      await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB),
    ).to.equal(inflatedEffectiveBalance);

    const removeTx = await newNetwork
      .connect(clusterOwner)
      .bulkRemoveValidator(publicKeys, operatorIds, clusterAfterEB);
    const clusterAfterRemove = parseClusterFromEvent(
      newNetwork,
      await removeTx.wait(),
      Events.VALIDATOR_REMOVED,
    );

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(
      await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterRemove),
    ).to.equal(0);

    const migrateTx = await newNetwork
      .connect(clusterOwner)
      .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 });
    const migrateReceipt = await migrateTx.wait();
    const migrateArgs = extractEventArgs(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const clusterAfterMigrate = parseClusterFromEvent(
      newNetwork,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    expect(migrateArgs.ethDeposited).to.equal(0n);
    expect(migrateArgs.effectiveBalance).to.equal(0);
    expect(clusterAfterMigrate.validatorCount).to.equal(0n);
    expect(clusterAfterMigrate.balance).to.equal(0n);
    expect(clusterAfterMigrate.active).to.equal(true);
    expect(await newViews.isLiquidatable(clusterOwner.address, operatorIds, clusterAfterMigrate)).to.equal(false);
    expect(
      await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterMigrate),
    ).to.equal(0);

    const earningsBefore = await Promise.all(
      operatorIds.map((operatorId) => newViews.getOperatorEarnings(operatorId)),
    );

    await mineBlocks(connection.ethers.provider, 1000);

    const earningsAfter = await Promise.all(
      operatorIds.map((operatorId) => newViews.getOperatorEarnings(operatorId)),
    );

    for (let i = 0; i < operatorIds.length; i++) {
      expect(earningsAfter[i]).to.equal(earningsBefore[i]);
    }
  });

  it("does not leak stale legacy EB into shared operators when another ETH cluster uses them", async function () {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;
    const clusterOwnerB = staker;

    const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
    await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [
      clusterOwner.address,
      clusterOwnerB.address,
    ]);

    const publicKeysA = [makePublicKey(11), makePublicKey(12)];
    const ssvDeposit = TOKEN_REGISTER_AMOUNT * BigInt(publicKeysA.length);
    await ssvToken.mint(clusterOwner.address, ssvDeposit);
    await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);

    await legacyNetwork.connect(clusterOwner).registerValidator(
      publicKeysA[0],
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      EMPTY_CLUSTER,
    );
    let clusterA = await getCurrentClusterState(
      connection,
      legacyNetwork,
      clusterOwner.address,
      operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      publicKeysA[1],
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      clusterA,
    );
    clusterA = await getCurrentClusterState(
      connection,
      legacyNetwork,
      clusterOwner.address,
      operatorIds,
    );

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection,
      legacyNetwork,
      legacyViews,
    );

    await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const clusterIdA = computeClusterId(clusterOwner.address, operatorIds);
    const inflatedEffectiveBalance = 4096;
    const rootA = computeEBRoot(clusterIdA, inflatedEffectiveBalance);

    await mineBlocks(provider, 1);
    const rootBlockA = await getBlockNumber(provider);
    await commitEBRoot(newNetwork, rootA, rootBlockA, [oracle1, oracle2, oracle3]);

    const updateTxA = await newNetwork
      .connect(clusterOwner)
      .updateClusterBalance(
        rootBlockA,
        clusterOwner.address,
        operatorIds,
        clusterA,
        inflatedEffectiveBalance,
        [],
      );
    const clusterAAfterEB = parseClusterFromEvent(
      newNetwork,
      await updateTxA.wait(),
      Events.CLUSTER_BALANCE_UPDATED,
    );

    const removeTxA = await newNetwork
      .connect(clusterOwner)
      .bulkRemoveValidator(publicKeysA, operatorIds, clusterAAfterEB);
    const clusterAAfterRemove = parseClusterFromEvent(
      newNetwork,
      await removeTxA.wait(),
      Events.VALIDATOR_REMOVED,
    );
    expect(clusterAAfterRemove.validatorCount).to.equal(0n);

    const migrateTxA = await newNetwork
      .connect(clusterOwner)
      .migrateClusterToETH(operatorIds, clusterAAfterRemove, { value: 0 });
    const migrateReceiptA = await migrateTxA.wait();
    const migrateArgsA = extractEventArgs(newNetwork, migrateReceiptA, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(migrateArgsA.effectiveBalance).to.equal(0);

    const registerTxB = await newNetwork
      .connect(clusterOwnerB)
      .registerValidator(
        makePublicKey(21),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
    const registerReceiptB = await registerTxB.wait();
    const clusterB = parseClusterFromEvent(
      newNetwork,
      registerReceiptB,
      Events.VALIDATOR_ADDED,
    );
    const registerBlockB = BigInt(registerReceiptB!.blockNumber);

    const earningsBeforeTouch = await Promise.all(
      operatorIds.map((operatorId) => newViews.getOperatorEarnings(BigInt(operatorId))),
    );

    for (let i = 0; i < operatorIds.length; i++) {
      expect(earningsBeforeTouch[i]).to.equal(0n);
    }

    await mineBlocks(provider, 1000);

    const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);
    const rootB = computeEBRoot(clusterIdB, 32);
    const rootBlockB = await getBlockNumber(provider);
    await commitEBRoot(newNetwork, rootB, rootBlockB, [oracle1, oracle2, oracle3]);

    const touchTxB = await newNetwork
      .connect(clusterOwnerB)
      .updateClusterBalance(
        rootBlockB,
        clusterOwnerB.address,
        operatorIds,
        clusterB,
        32,
        [],
      );
    const touchReceiptB = await touchTxB.wait();
    const touchBlockB = BigInt(touchReceiptB!.blockNumber);

    const earningsAfterTouch = await Promise.all(
      operatorIds.map((operatorId) => newViews.getOperatorEarnings(BigInt(operatorId))),
    );
    const operatorFeeRaw =
      (await newViews.getOperatorFee(BigInt(operatorIds[0]))) / ETH_DEDUCTED_DIGITS;
    const expectedDelta = calcOperatorFeeAccrual(
      touchBlockB - registerBlockB,
      operatorFeeRaw,
      defaultVUnits(1n),
    ) * ETH_DEDUCTED_DIGITS;

    for (let i = 0; i < operatorIds.length; i++) {
      expect(earningsAfterTouch[i] - earningsBeforeTouch[i]).to.equal(expectedDelta);
    }
  });
});
