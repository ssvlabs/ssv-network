import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  calcClusterBurn,
  defaultVUnits,
  calcLiquidationThreshold,
  checkAccumulatorMonotonicity,
  checkCSSVSupplyConsistency,
} from "../../helpers/index.ts";

describe("Cross-Cutting: Staking Integration", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, clusterOwner2, staker, userA, userB] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Multi-Staker Revenue Distribution Through State Changes", () => {
    it("Correctly distributes rewards pro-rata across multiple stakers through EB changes", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const stakeA = ethers.parseEther("100");
      await ssvToken.transfer(userA.address, stakeA);
      await ssvToken.connect(userA).approve(networkAddress, stakeA);
      await network.connect(userA).stake(stakeA);

      const cssvBalanceA = BigInt(await cssvToken.balanceOf(userA.address));
      expect(cssvBalanceA).to.equal(stakeA);

      const deposit = ethers.parseEther("10");
      const txReg = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const receiptReg = await txReg.wait();
      const registerBlock = receiptReg!.blockNumber;

      let prevAccEthPerShare = BigInt(await views.accEthPerShare());

      await mineBlocks(provider, 50);

      const stakeB = ethers.parseEther("300");
      await ssvToken.transfer(userB.address, stakeB);
      await ssvToken.connect(userB).approve(networkAddress, stakeB);
      const txStakeB = await network.connect(userB).stake(stakeB);
      const receiptStakeB = await txStakeB.wait();
      const stakeBBlock = receiptStakeB!.blockNumber;

      let currentAccEthPerShare = BigInt(await views.accEthPerShare());
      checkAccumulatorMonotonicity(prevAccEthPerShare, currentAccEthPerShare);
      prevAccEthPerShare = currentAccEthPerShare;

      await checkCSSVSupplyConsistency(cssvToken, stakeA + stakeB);

      await mineBlocks(provider, 50);

      const aBalanceBefore = await provider.getBalance(userA.address);
      const txClaimA = await network.connect(userA).claimEthRewards();
      const receiptClaimA = await txClaimA.wait();

      currentAccEthPerShare = BigInt(await views.accEthPerShare());
      checkAccumulatorMonotonicity(prevAccEthPerShare, currentAccEthPerShare);

      const aBalanceAfter = await provider.getBalance(userA.address);
      const claimAAmount = aBalanceAfter - aBalanceBefore + receiptClaimA!.gasUsed * receiptClaimA!.gasPrice;
      const claimABlock = receiptClaimA!.blockNumber;

      const PRECISION = 10n ** 18n;
      const phase1Blocks = BigInt(stakeBBlock - registerBlock);
      const phase1FeesWei = phase1Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeA;

      const phase2Blocks = BigInt(claimABlock - stakeBBlock);
      const phase2FeesWei = phase2Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const totalSupplyPhase2 = stakeA + stakeB;
      const delta2 = (phase2FeesWei * PRECISION) / totalSupplyPhase2;

      const expectedClaimARaw = (stakeA * (delta1 + delta2)) / PRECISION;
      const expectedClaimA = expectedClaimARaw - (expectedClaimARaw % ETH_DEDUCTED_DIGITS);
      expect(claimAAmount).to.equal(expectedClaimA);

      const bBalanceBefore = await provider.getBalance(userB.address);
      const txClaimB = await network.connect(userB).claimEthRewards();
      const receiptClaimB = await txClaimB.wait();

      const bBalanceAfter = await provider.getBalance(userB.address);
      const claimBAmount = bBalanceAfter - bBalanceBefore + receiptClaimB!.gasUsed * receiptClaimB!.gasPrice;
      const claimBBlock = receiptClaimB!.blockNumber;

      const phase3Blocks = BigInt(claimBBlock - claimABlock);
      const phase3FeesWei = phase3Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const delta3 = (phase3FeesWei * PRECISION) / totalSupplyPhase2;

      const expectedClaimBRaw = (stakeB * (delta2 + delta3)) / PRECISION;
      const expectedClaimB = expectedClaimBRaw - (expectedClaimBRaw % ETH_DEDUCTED_DIGITS);
      expect(claimBAmount).to.equal(expectedClaimB);

      expect(claimAAmount).to.be.greaterThan(claimBAmount);

      const totalClaimed = claimAAmount + claimBAmount;
      const expectedTotal = expectedClaimA + expectedClaimB;
      expect(totalClaimed).to.equal(expectedTotal);
    });
  });

  describe("Staking Rewards Through Liquidation Event", () => {
    it("Correctly adjusts reward rate when cluster is liquidated", async function () {
      const { network, views, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address, clusterOwner2.address,
      ]);

      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      const ethFeeWei = BigInt(opData.fee);
      const ethFeePacked = ethFeeWei / ETH_DEDUCTED_DIGITS;

      const stakeAmount = ethers.parseEther("10");
      await ssvToken.transfer(staker.address, stakeAmount);
      await ssvToken.connect(staker).approve(networkAddress, stakeAmount);
      await network.connect(staker).stake(stakeAmount);

      const vUnits1 = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: vUnits1,
      });

      const liqThresholdPeriod = BigInt(await views.getLiquidationThresholdPeriod());
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: liqThresholdPeriod,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: vUnits1,
      });

      const depositA = liqThreshold + burnPerBlock * 200n;
      const txA = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositA },
      );
      const receiptA = await txA.wait();
      let clusterA = parseClusterFromEvent(network, receiptA, Events.VALIDATOR_ADDED);

      const depositB = liqThreshold + burnPerBlock * 500n;
      await network.connect(clusterOwner2).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositB },
      );

      const daoValCount = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCount).to.equal(2n);

      let prevAccEthPerShare = BigInt(await views.accEthPerShare());

      await mineBlocks(provider, 100);

      await mineBlocks(provider, 200);

      const isLiq = await views.isLiquidatable(clusterOwner.address, operatorIds, clusterA);
      expect(isLiq).to.be.true;

      const txLiq = await network.connect(userA).liquidate(
        clusterOwner.address, operatorIds, clusterA,
      );
      const receiptLiq = await txLiq.wait();
      clusterA = parseClusterFromEvent(network, receiptLiq, Events.CLUSTER_LIQUIDATED);
      expect(clusterA.active).to.be.false;

      const daoValCountAfterLiq = BigInt(await views.getNetworkValidatorsCount());
      expect(daoValCountAfterLiq).to.equal(1n);

      await mineBlocks(provider, 100);

      const stakerBalanceBefore = await provider.getBalance(staker.address);
      const txClaim = await network.connect(staker).claimEthRewards();
      const receiptClaim = await txClaim.wait();
      const stakerBalanceAfter = await provider.getBalance(staker.address);
      const claimedAmount = stakerBalanceAfter - stakerBalanceBefore + receiptClaim!.gasUsed * receiptClaim!.gasPrice;

      const PRECISION = 10n ** 18n;
      const accAtClaim = BigInt(await views.accEthPerShare());
      const expectedRewardRaw = (stakeAmount * accAtClaim) / PRECISION;
      const expectedPayout = expectedRewardRaw - (expectedRewardRaw % ETH_DEDUCTED_DIGITS);
      expect(claimedAmount).to.equal(expectedPayout);

      const remainingDao = BigInt(await views.getNetworkEarnings());
      expect(remainingDao).to.be.lessThanOrEqual(ETH_DEDUCTED_DIGITS);

      const finalAccEthPerShare = BigInt(await views.accEthPerShare());
      checkAccumulatorMonotonicity(prevAccEthPerShare, finalAccEthPerShare);
    });
  });

  describe("cSSV Transfer Mid-Revenue-Accrual", () => {
    it("Correctly settles rewards for both parties at pre-transfer balances", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      const networkFeeWei = BigInt(await views.getNetworkFee());
      const networkFeePacked = networkFeeWei / ETH_DEDUCTED_DIGITS;

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const stakeA = ethers.parseEther("100");
      await ssvToken.transfer(userA.address, stakeA);
      await ssvToken.connect(userA).approve(networkAddress, stakeA);
      await network.connect(userA).stake(stakeA);

      const cssvBalA = BigInt(await cssvToken.balanceOf(userA.address));
      expect(cssvBalA).to.equal(stakeA);
      const cssvBalB = BigInt(await cssvToken.balanceOf(userB.address));
      expect(cssvBalB).to.equal(0n);

      const deposit = ethers.parseEther("10");
      const txReg = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const receiptReg = await txReg.wait();

      let prevAccEthPerShare = BigInt(await views.accEthPerShare());

      await mineBlocks(provider, 50);

      const transferAmount = ethers.parseEther("50");
      const txTransfer = await cssvToken.connect(userA).transfer(userB.address, transferAmount);
      const receiptTransfer = await txTransfer.wait();

      const cssvBalAAfter = BigInt(await cssvToken.balanceOf(userA.address));
      const cssvBalBAfter = BigInt(await cssvToken.balanceOf(userB.address));
      expect(cssvBalAAfter).to.equal(ethers.parseEther("50"));
      expect(cssvBalBAfter).to.equal(ethers.parseEther("50"));

      const accAfterTransfer = BigInt(await views.accEthPerShare());
      checkAccumulatorMonotonicity(prevAccEthPerShare, accAfterTransfer);
      prevAccEthPerShare = accAfterTransfer;

      await checkCSSVSupplyConsistency(cssvToken, stakeA);

      await mineBlocks(provider, 50);

      const aBalanceBeforeClaim = await provider.getBalance(userA.address);
      const txClaimA = await network.connect(userA).claimEthRewards();
      const receiptClaimA = await txClaimA.wait();
      const aBalanceAfterClaim = await provider.getBalance(userA.address);
      const claimAAmount = aBalanceAfterClaim - aBalanceBeforeClaim + receiptClaimA!.gasUsed * receiptClaimA!.gasPrice;

      const accAfterClaimA = BigInt(await views.accEthPerShare());
      checkAccumulatorMonotonicity(prevAccEthPerShare, accAfterClaimA);

      const bBalanceBeforeClaim = await provider.getBalance(userB.address);
      const txClaimB = await network.connect(userB).claimEthRewards();
      const receiptClaimB = await txClaimB.wait();
      const bBalanceAfterClaim = await provider.getBalance(userB.address);
      const claimBAmount = bBalanceAfterClaim - bBalanceBeforeClaim + receiptClaimB!.gasUsed * receiptClaimB!.gasPrice;

      const claimABlock = receiptClaimA!.blockNumber;
      const claimBBlock = receiptClaimB!.blockNumber;
      const transferBlock = receiptTransfer!.blockNumber;
      const regBlock = receiptReg!.blockNumber;
      const PRECISION = 10n ** 18n;

      const phase1Blocks = BigInt(transferBlock - regBlock);
      const phase1FeesWei = phase1Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const delta1 = (phase1FeesWei * PRECISION) / stakeA;

      const phase2Blocks = BigInt(claimABlock - transferBlock);
      const phase2FeesWei = phase2Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const delta2 = (phase2FeesWei * PRECISION) / stakeA;

      const accruedAFromTransfer = (stakeA * delta1) / PRECISION;
      const pendingAAtClaim = (transferAmount * delta2) / PRECISION;
      const totalARaw = accruedAFromTransfer + pendingAAtClaim;
      const expectedClaimA = totalARaw - (totalARaw % ETH_DEDUCTED_DIGITS);
      expect(claimAAmount).to.equal(expectedClaimA);

      const phase3Blocks = BigInt(claimBBlock - claimABlock);
      const phase3FeesWei = phase3Blocks * networkFeePacked * ETH_DEDUCTED_DIGITS;
      const delta3 = (phase3FeesWei * PRECISION) / stakeA;

      const pendingB = (transferAmount * (delta2 + delta3)) / PRECISION;
      const expectedClaimB = pendingB - (pendingB % ETH_DEDUCTED_DIGITS);

      expect(claimBAmount).to.equal(expectedClaimB);

      const totalClaimed = claimAAmount + claimBAmount;
      const expectedTotal = expectedClaimA + expectedClaimB;
      expect(totalClaimed).to.equal(expectedTotal);
    });
  });
});
