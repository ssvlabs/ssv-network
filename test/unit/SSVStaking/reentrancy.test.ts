import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Errors } from "../../common/errors.ts";
import { ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { setupTestContext } from "../../common/helpers.ts";

describe("SSVStaking reentrancy guard", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  it("Blocks reentrancy during ETH rewards claim", async function () {
    const { staking } = await ssvStakingHarnessFixture(connection);

    const malicious = await connection.ethers.deployContract(
      "MaliciousClaimEthRewards",
      [await staking.getAddress()]
    );
    await malicious.waitForDeployment();

    const maliciousAddress = await malicious.getAddress();
    const stakingAddress = await staking.getAddress();

    const accrued = connection.ethers.parseEther("0.1");
    const packedAccrued = accrued / ETH_DEDUCTED_DIGITS;
    await staking.mockSetUserAccrued(maliciousAddress, accrued);
    await staking.mockSetStakingEthPoolBalance(packedAccrued + 1_000_000n);
    await staking.mockSetEthDaoBalance(packedAccrued + 1_000_000n);

    await networkHelpers.setBalance(stakingAddress, connection.ethers.parseEther("1"));

    await expect(malicious.attack()).to.be.revertedWithCustomError(staking, Errors.ETH_TRANSFER_FAILED);
  });

  // NOTE: withdrawUnlocked reentrancy test is not included because:
  // - SSVToken is a standard ERC20 with no callbacks (no receive() or hooks)
  // - ERC20.transfer() does not call back to the recipient
  // - Therefore, reentrancy during withdrawUnlocked is not possible in production
  // - The nonReentrant modifier on withdrawUnlocked is defensive but protects against no real attack
  //
  // The same applies to stake() and requestUnstake() - they only interact with standard
  // ERC20 tokens (SSV and cSSV) which have no callback mechanisms.
  //
  // claimEthRewards() is different because it sends ETH, which triggers the receive() hook.
});
