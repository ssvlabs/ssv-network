import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Errors } from "../../common/errors.ts";

const PRECISION = 10n ** 18n;

describe("SSVStaking function `onCSSVTransfer()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker, receiver] = await connection.ethers.getSigners();
  });

  const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

  async function impersonate(address: string) {
    await connection.ethers.provider.send("hardhat_impersonateAccount", [address]);
    await connection.ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
    return connection.ethers.getSigner(address);
  }

  it("Is reverted with 'NotCSSV' when caller is not the cSSV token", async function () {
    const { staking } = await networkHelpers.loadFixture(deployStakingFixture);

    await expect(
      staking.onCSSVTransfer(staker.address, receiver.address, 1n)
    ).to.be.revertedWithCustomError(staking, Errors.NOT_CSSV);
  });

  it("Settles rewards for sender and receiver and updates user indexes", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const cssvAddress = await cssvToken.getAddress();
    const cssvSigner = await impersonate(cssvAddress);

    // Prevent _syncFees from changing accEthPerShare during the call.
    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);

    const accEthPerShare = 2n * PRECISION;
    await staking.mockSetAccEthPerShare(accEthPerShare);
    await staking.mockSetUserIndex(staker.address, PRECISION);
    await staking.mockSetUserIndex(receiver.address, PRECISION);

    const stakerBalance = 100n;
    const receiverBalance = 200n;
    await cssvToken.mint(staker.address, stakerBalance);
    await cssvToken.mint(receiver.address, receiverBalance);

    await staking.connect(cssvSigner).onCSSVTransfer(
      staker.address,
      receiver.address,
      1n
    );

    const stakerAccrued = await staking.getUserAccrued(staker.address);
    const receiverAccrued = await staking.getUserAccrued(receiver.address);
    expect(stakerAccrued).to.equal(stakerBalance);
    expect(receiverAccrued).to.equal(receiverBalance);

    const stakerIndex = await staking.getUserIndex(staker.address);
    const receiverIndex = await staking.getUserIndex(receiver.address);
    expect(stakerIndex).to.equal(accEthPerShare);
    expect(receiverIndex).to.equal(accEthPerShare);
  });
});
