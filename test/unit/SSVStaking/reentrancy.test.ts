import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Errors } from "../../common/errors.ts";
import { ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";

describe("SSVStaking reentrancy guard", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
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
});
