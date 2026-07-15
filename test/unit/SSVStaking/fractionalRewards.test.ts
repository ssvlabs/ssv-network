import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";

const PRECISION = 10n ** 18n;
const ETH_DEDUCTED_DIGITS = 100_000n;
const TOTAL_CSSV_SUPPLY = 10n ** 24n;
const ACCOUNT_BALANCE = 1_000_000_000n;
const FEE_STEP_PACKED = 9_000_000_000n;
const ROUNDS = 10;

describe("SSVStaking fractional reward settlement", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let attacker: HardhatEthersSigner;
  let victim: HardhatEthersSigner;
  let control: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [attacker, victim, control],
    } = await setupTestContext());
  });

  const deployFixture = async () => defaultStakingFixture(connection);

  async function impersonate(address: string) {
    await connection.ethers.provider.send("hardhat_impersonateAccount", [
      address,
    ]);
    await connection.ethers.provider.send("hardhat_setBalance", [
      address,
      "0x1000000000000000000",
    ]);
    return connection.ethers.getSigner(address);
  }

  async function transferWithProductionHook(
    staking: any,
    cssvToken: any,
    cssvSigner: any,
    from: HardhatEthersSigner,
    to: string,
    amount: bigint,
  ) {
    await staking
      .connect(cssvSigner)
      .onCSSVTransfer(from.address, to, amount);
    await cssvToken.connect(from).transfer(to, amount);
  }

  it("preserves fractional rewards across unsolicited dust transfers", async function () {
    const { staking, cssvToken } =
      await networkHelpers.loadFixture(deployFixture);

    const cssvSigner = await impersonate(await cssvToken.getAddress());

    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(0n);

    await cssvToken.mint(victim.address, ACCOUNT_BALANCE);
    await cssvToken.mint(control.address, ACCOUNT_BALANCE);
    await cssvToken.mint(
      attacker.address,
      TOTAL_CSSV_SUPPLY - (2n * ACCOUNT_BALANCE),
    );

    const expectedIndexStep =
      (FEE_STEP_PACKED * ETH_DEDUCTED_DIGITS * PRECISION) /
      TOTAL_CSSV_SUPPLY;
    expect(expectedIndexStep).to.equal(900_000_000n);

    for (let round = 1; round <= ROUNDS; round++) {
      await staking.mockSetEthDaoBalance(
        FEE_STEP_PACKED * BigInt(round),
      );

      await transferWithProductionHook(
        staking,
        cssvToken,
        cssvSigner,
        attacker,
        victim.address,
        1n,
      );
    }

    await transferWithProductionHook(
      staking,
      cssvToken,
      cssvSigner,
      attacker,
      control.address,
      1n,
    );

    expect(await staking.getAccEthPerShare()).to.equal(
      expectedIndexStep * BigInt(ROUNDS),
    );
    expect(await staking.getUserAccrued(victim.address)).to.equal(9n);
    expect(await staking.getUserAccrued(control.address)).to.equal(9n);
    expect(await cssvToken.balanceOf(victim.address)).to.equal(
      ACCOUNT_BALANCE + BigInt(ROUNDS),
    );
  });
});
