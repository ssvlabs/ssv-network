import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER, VUNITS_PRECISION, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

describe("Network fee update impact on active clusters", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

  const deployFixture = async () => ssvClustersHarnessFixture(connection);


  it("Increase ETH network fee cluster burns faster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const fee1 = 1_000n;
    await clusters.mockEthNetworkFee(fee1);
    await clusters.mockCurrentNetworkFeeIndex(0n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      { ...EMPTY_CLUSTER },
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const registerReceipt = await registerTx.wait();
    let cluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const blocksPerPeriod = 500;
    await networkHelpers.mine(blocksPerPeriod);

    const w1Tx = await clusters.withdraw(operatorIds, 0n, cluster);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const burnP1 = cluster.balance - clusterAfterP1.balance;

    const currentIndex = await clusters.getCurrentNetworkFeeIndex();
    await clusters.mockCurrentNetworkFeeIndex(currentIndex);
    const fee2 = 3_000n;
    await clusters.mockEthNetworkFee(fee2);

    await networkHelpers.mine(blocksPerPeriod);

    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    expect(burnP2).to.be.greaterThan(burnP1);

    const registerBlock = BigInt(registerReceipt!.blockNumber);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const p1Blocks = w1Block - registerBlock;
    const expectedBurnP1 = p1Blocks * fee1 * ETH_DEDUCTED_DIGITS;
    expect(burnP1).to.equal(expectedBurnP1);

    expect(burnP2).to.be.greaterThan(0n);
    expect(clusterAfterP2.balance).to.be.greaterThan(0n);
  });

  it("Decrease ETH network fee cluster burn rate decreases", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const fee1 = 3_000n;
    await clusters.mockEthNetworkFee(fee1);
    await clusters.mockCurrentNetworkFeeIndex(0n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      { ...EMPTY_CLUSTER },
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const registerReceipt = await registerTx.wait();
    let cluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const blocksPerPeriod = 500;
    await networkHelpers.mine(blocksPerPeriod);

    const w1Tx = await clusters.withdraw(operatorIds, 0n, cluster);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterP1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const burnP1 = cluster.balance - clusterAfterP1.balance;

    const currentIndex = await clusters.getCurrentNetworkFeeIndex();
    await clusters.mockCurrentNetworkFeeIndex(currentIndex);
    const fee2 = 1_000n;
    await clusters.mockEthNetworkFee(fee2);

    await networkHelpers.mine(blocksPerPeriod);

    const w2Tx = await clusters.withdraw(operatorIds, 0n, clusterAfterP1);
    const w2Receipt = await w2Tx.wait();
    const clusterAfterP2 = parseClusterFromEvent(clusters, w2Receipt, Events.CLUSTER_WITHDRAWN);
    const burnP2 = clusterAfterP1.balance - clusterAfterP2.balance;

    expect(burnP2).to.be.lessThan(burnP1);

    const registerBlock = BigInt(registerReceipt!.blockNumber);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const p1Blocks = w1Block - registerBlock;
    const expectedBurnP1 = p1Blocks * fee1 * ETH_DEDUCTED_DIGITS;
    expect(burnP1).to.equal(expectedBurnP1);

    expect(burnP2).to.be.greaterThan(0n);
    expect(clusterAfterP2.balance).to.be.greaterThan(0n);
  });

  it("Network fee with EB-weighted cluster vUnit scaling applied", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const fee = 2_000n;
    await clusters.mockEthNetworkFee(fee);
    await clusters.mockCurrentNetworkFeeIndex(0n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      { ...EMPTY_CLUSTER },
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const registerReceipt = await registerTx.wait();
    let cluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const explicitVUnits = 15_000n;
    await clusters.mockSetClusterVUnits(clusterId, explicitVUnits);

    const blocksToMine = 500;
    await networkHelpers.mine(blocksToMine);

    const w1Tx = await clusters.withdraw(operatorIds, 0n, cluster);
    const w1Receipt = await w1Tx.wait();
    const clusterAfterW1 = parseClusterFromEvent(clusters, w1Receipt, Events.CLUSTER_WITHDRAWN);
    const actualBurn = cluster.balance - clusterAfterW1.balance;

    const registerBlock = BigInt(registerReceipt!.blockNumber);
    const w1Block = BigInt(w1Receipt!.blockNumber);
    const totalBlocks = w1Block - registerBlock;

    const networkFeeIndexDelta = totalBlocks * fee;
    const scaledUnits = (networkFeeIndexDelta * explicitVUnits) / VUNITS_PRECISION;
    const expectedBurn = scaledUnits * ETH_DEDUCTED_DIGITS;
    expect(actualBurn).to.equal(expectedBurn);

    const defaultVUnits = VUNITS_PRECISION;
    const defaultScaledUnits = (networkFeeIndexDelta * defaultVUnits) / VUNITS_PRECISION;
    const defaultBurn = defaultScaledUnits * ETH_DEDUCTED_DIGITS;

    expect(actualBurn).to.be.greaterThan(defaultBurn);
    expect(actualBurn * defaultVUnits).to.equal(defaultBurn * explicitVUnits);
  });
});
