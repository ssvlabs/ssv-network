/**
 * Regression Tests: Operator & Staking Bugs
 *
 * These tests assert the CORRECT behavior for operator lifecycle and staking rewards.
 * They are expected to FAIL on the current code, proving the bugs are real.
 * Once fixes land, they should flip to passing.
 *
 * BUG-2: _resetOperatorState doesn't clear operator.owner after removal
 * BUG-6: Rewards permanently lost when totalStaked == 0 during fee sync
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.ts";
import { ssvOperatorsHarnessFixture, ssvStakingHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import { makeOperatorKey } from "../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../common/constants.ts";

describe("Regression: Operator & Staking Bugs", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [owner] = await connection.ethers.getSigners();
  });

  describe("BUG-2: operator.owner not cleared after removal", () => {
    const deployOperatorsFixture = async () => ssvOperatorsHarnessFixture(connection);

    it("Clears operator owner to address(0) after removal", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

      // Register an operator
      await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

      // Fund the contract so removal doesn't fail on ETH transfer
      const operatorsAddress = await operators.getAddress();
      await connection.ethers.provider.send("hardhat_setBalance", [
        operatorsAddress,
        `0x${(10_000_000n).toString(16)}`,
      ]);

      // Remove the operator
      await operators.removeOperator(1);

      // After removal, the owner should be cleared to address(0).
      // This is critical because:
      // 1. ensureOperatorExist() uses `owner != address(0)` as existence signal
      // 2. A non-zero owner on a removed operator could bypass existence checks
      // 3. checkOwner() would still pass for the original owner on a removed operator
      //
      // EXPECTED: owner == address(0)
      // ACTUAL (BUG): owner still set to the original owner address
      const operatorData = await operators.getOperator(1);
      expect(operatorData.owner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("BUG-6: Rewards lost when totalStaked == 0", () => {
    const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

    it("Does not advance pool balance when totalStaked is zero (defers fees)", async function () {
      const { staking } = await networkHelpers.loadFixture(deployStakingFixture);

      // Set up: fees have accrued but nobody has staked cSSV yet
      const accruedFees = 1_000_000_000n;
      await staking.mockSetStakingEthPoolBalance(0n);
      await staking.mockSetEthDaoBalance(accruedFees);

      // Call syncFees with zero total staked (no cSSV minted)
      await staking.syncFees();

      // When totalStaked == 0, the pool balance should NOT advance to current DAO balance.
      // If it advances, the fees between poolBalance=0 and poolBalance=accruedFees are
      // permanently lost — no staker will ever receive them because accEthPerShare wasn't
      // incremented (the totalStaked==0 branch skips the accumulator update).
      //
      // Next time syncFees runs with totalStaked > 0, the delta is
      // (newBalance - poolBalance) which would be 0 since poolBalance was already advanced.
      // Those accrued fees simply vanish.
      //
      // The correct behavior is to defer: keep poolBalance at its previous value
      // until someone stakes, so the full delta is distributed to future stakers.
      //
      // EXPECTED: poolBalance remains 0 (fees deferred)
      // ACTUAL (BUG): poolBalance advances to accruedFees (fees permanently lost)
      const poolBalance = await staking.getStakingEthPoolBalance();
      expect(poolBalance).to.equal(0n);
    });
  });
});
