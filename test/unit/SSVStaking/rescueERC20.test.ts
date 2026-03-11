import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `rescueERC20()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner, recipient] } = await setupTestContext());
  });

  const deployWithExtraToken = async () => {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);

    const randomToken = await connection.ethers.deployContract("MockToken");
    await randomToken.waitForDeployment();

    await randomToken.mint(owner.address, connection.ethers.parseEther("1000"));

    const rescueAmount = connection.ethers.parseEther("100");
    await randomToken.transfer(await staking.getAddress(), rescueAmount);

    return { staking, ssvToken, cssvToken, randomToken, rescueAmount };
  };

  const deployWithNonStandardToken = async () => {
    const { staking } = await ssvStakingHarnessFixture(connection);

    const nonStandardToken = await connection.ethers.deployContract("NonStandardERC20Mock");
    await nonStandardToken.waitForDeployment();

    await nonStandardToken.mint(owner.address, connection.ethers.parseEther("1000"));

    const rescueAmount = connection.ethers.parseEther("100");
    await nonStandardToken.transfer(await staking.getAddress(), rescueAmount);

    return { staking, nonStandardToken, rescueAmount };
  };

  it("Rescues accidentally sent ERC20 tokens and emits ERC20Rescued event", async function () {
    const { staking, randomToken, rescueAmount } =
      await networkHelpers.loadFixture(deployWithExtraToken);

    const tokenAddress = await randomToken.getAddress();
    const tx = await trackGas(
      staking.rescueERC20(tokenAddress, recipient.address, rescueAmount),
      [GasGroup.RESCUE_ERC20]
    );

    await expect(tx)
      .to.emit(staking, Events.ERC20_RESCUED)
      .withArgs(tokenAddress, recipient.address, rescueAmount);

    const recipientBalance = await randomToken.balanceOf(recipient.address);
    expect(recipientBalance).to.equal(rescueAmount);
  });

  it("Transfers the correct amount to the recipient", async function () {
    const { staking, randomToken, rescueAmount } =
      await networkHelpers.loadFixture(deployWithExtraToken);

    const balanceBefore = await randomToken.balanceOf(recipient.address);
    
    await trackGas(
      staking.rescueERC20(
        await randomToken.getAddress(),
        recipient.address,
        rescueAmount
      ),
      [GasGroup.RESCUE_ERC20]
    );

    const balanceAfter = await randomToken.balanceOf(recipient.address);
    expect(balanceAfter - balanceBefore).to.equal(rescueAmount);
  });

  it("Rescues non-standard ERC20 tokens that do not return a value", async function () {
    const { staking, nonStandardToken, rescueAmount } =
      await networkHelpers.loadFixture(deployWithNonStandardToken);

    const tokenAddress = await nonStandardToken.getAddress();

    await expect(
      trackGas(
        staking.rescueERC20(tokenAddress, recipient.address, rescueAmount),
        [GasGroup.RESCUE_ERC20]
      )
    )
      .to.emit(staking, Events.ERC20_RESCUED)
      .withArgs(tokenAddress, recipient.address, rescueAmount);

    expect(await nonStandardToken.balanceOf(recipient.address)).to.equal(rescueAmount);
  });

  it("Is reverted with 'ZeroAddress' when token address is zero", async function () {
    const { staking } = await networkHelpers.loadFixture(deployWithExtraToken);

    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const amount = connection.ethers.parseEther("1");

    await expect(
      staking.rescueERC20(zeroAddress, recipient.address, amount)
    ).to.be.revertedWithCustomError(staking, Errors.ZERO_ADDRESS);
  });

  it("Is reverted with 'ZeroAddress' when recipient address is zero", async function () {
    const { staking, randomToken } = await networkHelpers.loadFixture(deployWithExtraToken);

    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const amount = connection.ethers.parseEther("1");

    await expect(
      staking.rescueERC20(await randomToken.getAddress(), zeroAddress, amount)
    ).to.be.revertedWithCustomError(staking, Errors.ZERO_ADDRESS);
  });

  it("Is reverted with 'InvalidToken' when trying to rescue SSV token", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(deployWithExtraToken);

    const amount = connection.ethers.parseEther("1");

    await expect(
      staking.rescueERC20(await ssvToken.getAddress(), recipient.address, amount)
    ).to.be.revertedWithCustomError(staking, Errors.INVALID_TOKEN);
  });

  it("Is reverted with 'InvalidToken' when trying to rescue cSSV token", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployWithExtraToken);

    const amount = connection.ethers.parseEther("1");

    await expect(
      staking.rescueERC20(await cssvToken.getAddress(), recipient.address, amount)
    ).to.be.revertedWithCustomError(staking, Errors.INVALID_TOKEN);
  });

  it("Is reverted with 'ZeroAmount' when amount is zero", async function () {
    const { staking, randomToken } = await networkHelpers.loadFixture(deployWithExtraToken);

    await expect(
      staking.rescueERC20(await randomToken.getAddress(), recipient.address, 0n)
    ).to.be.revertedWithCustomError(staking, Errors.ZERO_AMOUNT);
  });

  it("Allows partial rescue of tokens", async function () {
    const { staking, randomToken, rescueAmount } =
      await networkHelpers.loadFixture(deployWithExtraToken);

    const partialAmount = rescueAmount / 2n;
    await trackGas(
      staking.rescueERC20(
        await randomToken.getAddress(),
        recipient.address,
        partialAmount
      ),
      [GasGroup.RESCUE_ERC20]
    );

    const recipientBalance = await randomToken.balanceOf(recipient.address);
    expect(recipientBalance).to.equal(partialAmount);

    const contractBalance = await randomToken.balanceOf(await staking.getAddress());
    expect(contractBalance).to.equal(rescueAmount - partialAmount);
  });
});
