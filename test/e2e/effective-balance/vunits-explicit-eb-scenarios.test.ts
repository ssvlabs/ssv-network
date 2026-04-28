import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  setupTestContext,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_LIQUIDATION_THRESHOLD,
  OP_ETH_FEE_RAW,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  calcClusterBurn,
  calcLiquidationThreshold,
  calcOperatorFeeAccrual,
  calcVUnits,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
  defaultVUnits,
  getBlockNumber,
  mineBlocks,
  setupOracles,
} from "../../helpers/index.ts";

const NUM_OPERATORS = 4n;
const LIQUIDATION_THRESHOLD_PERIOD = MINIMAL_LIQUIDATION_THRESHOLD;

describe("Explicit EB vUnits scenarios", () => {
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

  const deployFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateLiquidationThresholdPeriod(LIQUIDATION_THRESHOLD_PERIOD);
    await network.updateMinimumLiquidationCollateral(0n);

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    return { network, views, operatorIds };
  };

  async function registerClusterValidators(
    network: any,
    operatorIds: number[],
    validatorCount: number,
    depositPerValidator: bigint = DEFAULT_ETH_REGISTER_VALUE,
  ): Promise<Cluster> {
    let cluster = EMPTY_CLUSTER;

    for (let i = 1; i <= validatorCount; i++) {
      const tx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(i),
        operatorIds,
        DEFAULT_SHARES,
        cluster,
        { value: depositPerValidator },
      );
      const receipt = await tx.wait();
      cluster = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    }

    return cluster;
  }

  async function updateClusterEB(
    network: any,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
  ): Promise<{ cluster: Cluster; blockNumber: bigint }> {
    const provider = connection.ethers.provider;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);

    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

    const tx = await network.connect(clusterOwner).updateClusterBalance(
      rootBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      [],
    );
    const receipt = await tx.wait();

    return {
      cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
      blockNumber: BigInt(receipt.blockNumber),
    };
  }

  it("E-04: higher explicit-EB burn rate is applied after an EB=64 update", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64 } = await updateClusterEB(network, operatorIds, cluster, 64);

    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB64)).to.equal(64);

    const opEarningsAfterEB64 = await views.getOperatorEarnings(BigInt(operatorIds[0]));
    const blocksToMine = 40;
    await mineBlocks(provider, blocksToMine);

    const expectedFeesAtEB64 = calcClusterBurn({
      blockDiff: BigInt(blocksToMine),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });
    const expectedBalance = clusterAfterEB64.balance - expectedFeesAtEB64;

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterEB64),
    ).to.equal(expectedBalance);
    expect(expectedFeesAtEB64).to.equal(calcClusterBurn({
      blockDiff: BigInt(blocksToMine),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    }) * 2n);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterEB64).to.equal(
      calcOperatorFeeAccrual(BigInt(blocksToMine), OP_ETH_FEE_RAW, calcVUnits(64n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("E-06: EB=64 -> EB=128 settles at the old rate and then accrues at the higher rate", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64, blockNumber: firstUpdateBlock } =
      await updateClusterEB(network, operatorIds, cluster, 64);

    const opEarningsAfterEB64 = await views.getOperatorEarnings(BigInt(operatorIds[0]));

    await mineBlocks(provider, 17);

    const { cluster: clusterAfterEB128, blockNumber: secondUpdateBlock } =
      await updateClusterEB(network, operatorIds, clusterAfterEB64, 128);

    const opEarningsAfterEB128 = await views.getOperatorEarnings(BigInt(operatorIds[0]));
    expect(opEarningsAfterEB128 - opEarningsAfterEB64).to.equal(
      calcOperatorFeeAccrual(secondUpdateBlock - firstUpdateBlock, OP_ETH_FEE_RAW, calcVUnits(64n)) * ETH_DEDUCTED_DIGITS,
    );

    const expectedBalanceAtEB128 = clusterAfterEB64.balance - calcClusterBurn({
      blockDiff: secondUpdateBlock - firstUpdateBlock,
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });

    expect(clusterAfterEB128.balance).to.equal(expectedBalanceAtEB128);
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB128)).to.equal(128);

    const postUpdateBlocks = 11;
    await mineBlocks(provider, postUpdateBlocks);

    const expectedPostUpdateBalance = clusterAfterEB128.balance - calcClusterBurn({
      blockDiff: BigInt(postUpdateBlocks),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(128n),
    });

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterEB128),
    ).to.equal(expectedPostUpdateBalance);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterEB128).to.equal(
      calcOperatorFeeAccrual(BigInt(postUpdateBlocks), OP_ETH_FEE_RAW, calcVUnits(128n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("E-08: explicit EB=32 -> EB=64 settles at baseline and then accrues at the higher rate", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB32, blockNumber: firstUpdateBlock } =
      await updateClusterEB(network, operatorIds, cluster, 32);

    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB32)).to.equal(32);

    await mineBlocks(provider, 13);

    const { cluster: clusterAfterEB64, blockNumber: secondUpdateBlock } =
      await updateClusterEB(network, operatorIds, clusterAfterEB32, 64);

    const opEarningsAfterEB64 = await views.getOperatorEarnings(BigInt(operatorIds[0]));

    const expectedBalanceAtEB64 = clusterAfterEB32.balance - calcClusterBurn({
      blockDiff: secondUpdateBlock - firstUpdateBlock,
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    expect(clusterAfterEB64.balance).to.equal(expectedBalanceAtEB64);
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB64)).to.equal(64);

    const postUpdateBlocks = 9;
    await mineBlocks(provider, postUpdateBlocks);

    const expectedPostUpdateBalance = clusterAfterEB64.balance - calcClusterBurn({
      blockDiff: BigInt(postUpdateBlocks),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterEB64),
    ).to.equal(expectedPostUpdateBalance);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterEB64).to.equal(
      calcOperatorFeeAccrual(BigInt(postUpdateBlocks), OP_ETH_FEE_RAW, calcVUnits(64n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("E-09: 3-validator cluster updated to total EB=96 keeps baseline vUnits and burn rate", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 3);
    const { cluster: clusterAfterEB96 } = await updateClusterEB(network, operatorIds, cluster, 96);

    const opEarningsAfterEB96 = await views.getOperatorEarnings(BigInt(operatorIds[0]));
    expect(calcVUnits(96n)).to.equal(defaultVUnits(3n));
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterEB96)).to.equal(96);

    const blocksToMine = 21;
    await mineBlocks(provider, blocksToMine);

    const expectedBalance = clusterAfterEB96.balance - calcClusterBurn({
      blockDiff: BigInt(blocksToMine),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(3n),
    });

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterEB96),
    ).to.equal(expectedBalance);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterEB96).to.equal(
      calcOperatorFeeAccrual(BigInt(blocksToMine), OP_ETH_FEE_RAW, defaultVUnits(3n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("E-11: registering a second validator after EB=64 adds one baseline validator worth of vUnits", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64 } = await updateClusterEB(network, operatorIds, cluster, 64);

    const registerTx = await network.connect(clusterOwner).registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterEB64,
      { value: 0n },
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterSecondValidator = parseClusterFromEvent(
      network,
      registerReceipt,
      Events.VALIDATOR_ADDED,
    );

    expect(clusterAfterSecondValidator.validatorCount).to.equal(2n);
    expect(calcVUnits(64n) + defaultVUnits(1n)).to.equal(calcVUnits(96n));
    expect(
      await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterSecondValidator),
    ).to.equal(96);

    const opEarningsAfterSecondReg = await views.getOperatorEarnings(BigInt(operatorIds[0]));
    const blocksToMine = 14;
    await mineBlocks(provider, blocksToMine);

    const expectedBalance = clusterAfterSecondValidator.balance - calcClusterBurn({
      blockDiff: BigInt(blocksToMine),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(96n),
    });

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterSecondValidator),
    ).to.equal(expectedBalance);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterSecondReg).to.equal(
      calcOperatorFeeAccrual(BigInt(blocksToMine), OP_ETH_FEE_RAW, calcVUnits(96n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("E-13: withdrawing the maximum allowed amount at explicit EB=64 leaves the cluster exactly at the liquidation boundary", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64 } = await updateClusterEB(network, operatorIds, cluster, 64);

    const burnForNextBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });
    const thresholdAtEB64 = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: LIQUIDATION_THRESHOLD_PERIOD,
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });
    const maxWithdrawAmount = clusterAfterEB64.balance - burnForNextBlock - thresholdAtEB64;

    expect(maxWithdrawAmount).to.be.greaterThan(0n);

    const withdrawTx = await network.connect(clusterOwner).withdraw(
      operatorIds,
      maxWithdrawAmount,
      clusterAfterEB64,
    );
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(
      network,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );

    expect(clusterAfterWithdraw.balance).to.equal(thresholdAtEB64);
    expect(await views.isLiquidatable(clusterOwner.address, operatorIds, clusterAfterWithdraw)).to.equal(false);

    await expect(
      network.connect(clusterOwner).withdraw(operatorIds, 1n, clusterAfterWithdraw),
    ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
  });

  it("E-14: depositing into an explicit-EB=64 cluster preserves its effective balance and burn rate", async function () {
    const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64, blockNumber: ebUpdateBlock } =
      await updateClusterEB(network, operatorIds, cluster, 64);

    const opEarningsAfterEB64 = await views.getOperatorEarnings(BigInt(operatorIds[0]));

    const depositAmount = connection.ethers.parseEther("1");
    const depositTx = await network.connect(clusterOwner).deposit(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB64,
      { value: depositAmount },
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(network, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit.balance).to.equal(clusterAfterEB64.balance + depositAmount);
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterDeposit)).to.equal(64);

    const blocksToMine = 12;
    await mineBlocks(provider, blocksToMine);
    const currentBlock = BigInt(await getBlockNumber(provider));

    const expectedBalance = clusterAfterDeposit.balance - calcClusterBurn({
      blockDiff: currentBlock - ebUpdateBlock,
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: calcVUnits(64n),
    });

    expect(
      await views.getBalance(clusterOwner.address, operatorIds, clusterAfterDeposit),
    ).to.equal(expectedBalance);
    expect(await views.getOperatorEarnings(BigInt(operatorIds[0])) - opEarningsAfterEB64).to.equal(
      calcOperatorFeeAccrual(currentBlock - ebUpdateBlock, OP_ETH_FEE_RAW, calcVUnits(64n)) * ETH_DEDUCTED_DIGITS,
    );
  });

  it("R-09: register validator (EB=64) → remove operator → deposit", async function () {
    const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const { cluster: clusterAfterEB64 } = await updateClusterEB(network, operatorIds, cluster, 64);

    const removedOperator = operatorIds[0];
    await network.connect(operatorOwner).removeOperator(removedOperator);

    const depositAmount = connection.ethers.parseEther("1");
    const depositTx = await network.connect(clusterOwner).deposit(
      clusterOwner.address,
      operatorIds,
      clusterAfterEB64,
      { value: depositAmount },
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(network, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit.balance).to.equal(clusterAfterEB64.balance + depositAmount);
  });

  it("RI-02: register validator → remove operator → remove last validator", async function () {
    const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const regBlock = await getBlockNumber(provider);

    const removedOperator = operatorIds[0];
    const removeOpReceipt = await (await network.connect(operatorOwner).removeOperator(removedOperator)).wait();
    const removeOpBlock = BigInt(removeOpReceipt!.blockNumber);

    await mineBlocks(provider, 10);

    const removeTx = await network.connect(clusterOwner).removeValidator(
      makePublicKey(1),
      operatorIds,
      cluster
    );
    const removeReceipt = await removeTx.wait();
    const removeBlock = BigInt(removeReceipt.blockNumber);
    const clusterAfterRemove = parseClusterFromEvent(network, removeReceipt, Events.VALIDATOR_REMOVED);

    // Fees are two-phase: full 4-op rate before removal, 3-op rate after
    const expectedFeeDeduction =
      calcClusterBurn({
        blockDiff: removeOpBlock - BigInt(regBlock),
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      }) +
      calcClusterBurn({
        blockDiff: removeBlock - removeOpBlock,
        numOperators: NUM_OPERATORS - 1n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.be.true;
    expect(clusterAfterRemove.balance).to.equal(cluster.balance - expectedFeeDeduction);
  });

  it("RI-03: register validator → remove operator → withdraw", async function () {
    const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const regBlock = await getBlockNumber(provider);
    
    const removedOperator = operatorIds[0];
    const removeOpReceipt2 = await (await network.connect(operatorOwner).removeOperator(removedOperator)).wait();
    const removeOpBlock2 = BigInt(removeOpReceipt2!.blockNumber);

    await mineBlocks(provider, 10);

    const withdrawAmount = connection.ethers.parseEther("0.1");
    const withdrawTx = await network.connect(clusterOwner).withdraw(
      operatorIds,
      withdrawAmount,
      cluster
    );
    const withdrawReceipt = await withdrawTx.wait();
    const withdrawBlock = BigInt(withdrawReceipt.blockNumber);

    const clusterAfterWithdraw = parseClusterFromEvent(network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    // Fees are two-phase: full 4-op rate before removal, 3-op rate after
    const expectedFeeDeduction =
      calcClusterBurn({
        blockDiff: removeOpBlock2 - BigInt(regBlock),
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      }) +
      calcClusterBurn({
        blockDiff: withdrawBlock - removeOpBlock2,
        numOperators: NUM_OPERATORS - 1n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });

    expect(clusterAfterWithdraw.balance).to.equal(cluster.balance - expectedFeeDeduction - withdrawAmount);
  });

  it("RI-05: register validator → remove operator → reactivate (if liquidated)", async function () {
    const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const cluster = await registerClusterValidators(network, operatorIds, 1);
    const regBlock = await getBlockNumber(provider);

    const removedOperator = operatorIds[0];
    const removeOpReceipt = await (await network.connect(operatorOwner).removeOperator(removedOperator)).wait();
    const removeOpBlock = BigInt(removeOpReceipt!.blockNumber);

    // Phase 1: 4-op rate from registration to operator removal
    const phase1Fees = calcClusterBurn({
      blockDiff: removeOpBlock - BigInt(regBlock),
      numOperators: NUM_OPERATORS,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    // After removal, burn rate and threshold use 3 active operators
    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: LIQUIDATION_THRESHOLD_PERIOD,
      numOperators: NUM_OPERATORS - 1n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    const burnPerBlockAfterRemoval = calcClusterBurn({
      blockDiff: 1n,
      numOperators: NUM_OPERATORS - 1n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    // Remaining balance after phase-1 fees, then drain at 3-op rate
    const balanceAfterPhase1 = cluster.balance - phase1Fees;
    const blocksToLiquidate = (balanceAfterPhase1 - threshold) / burnPerBlockAfterRemoval + 1n;
    await mineBlocks(provider, Number(blocksToLiquidate));
    
    const liquidator = oracle1;
    const liquidateTx = await network.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster
    );
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidate = parseClusterFromEvent(network, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiquidate.active).to.be.false;

    const reactivateAmount = threshold + connection.ethers.parseEther("1");
    const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        clusterAfterLiquidate,
        { value: reactivateAmount }
    );
    const reactivateReceipt = await reactivateTx.wait();
    const clusterAfterReactivate = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

    expect(clusterAfterReactivate.active).to.be.true;
    expect(clusterAfterReactivate.balance).to.equal(clusterAfterLiquidate.balance + reactivateAmount);
  });
});
