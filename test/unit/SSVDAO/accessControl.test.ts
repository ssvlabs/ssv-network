import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { MINIMAL_LIQUIDATION_THRESHOLD } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { setupTestContext } from "../../common/helpers.ts";

describe("SSVDAO governance access control (via SSVNetwork)", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let signers: HardhatEthersSigner[];

  before(async function () {
    ({ connection, networkHelpers, signers } = await setupTestContext());
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  const getNonOwner = async (network: any): Promise<HardhatEthersSigner> => {
    const ownerAddress = await network.owner();
    const nonOwner = signers.find((signer) => signer.address !== ownerAddress);
    if (!nonOwner) {
      throw new Error("Failed to find a non-owner signer for access control tests");
    }
    return nonOwner;
  };

  const governanceCalls: Array<{
    fnName: string;
    invoke: (network: any, nonOwner: HardhatEthersSigner) => Promise<unknown>;
  }> = [
    {
      fnName: "updateNetworkFee",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateNetworkFee(0n),
    },
    {
      fnName: "updateNetworkFeeSSV",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateNetworkFeeSSV(0n),
    },
    {
      fnName: "withdrawNetworkSSVEarnings",
      invoke: (network, nonOwner) => network.connect(nonOwner).withdrawNetworkSSVEarnings(0n),
    },
    {
      fnName: "updateOperatorFeeIncreaseLimit",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateOperatorFeeIncreaseLimit(0n),
    },
    {
      fnName: "updateDeclareOperatorFeePeriod",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateDeclareOperatorFeePeriod(0n),
    },
    {
      fnName: "updateExecuteOperatorFeePeriod",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateExecuteOperatorFeePeriod(0n),
    },
    {
      fnName: "updateLiquidationThresholdPeriod",
      invoke: (network, nonOwner) =>
        network.connect(nonOwner).updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD),
    },
    {
      fnName: "updateLiquidationThresholdPeriodSSV",
      invoke: (network, nonOwner) =>
        network.connect(nonOwner).updateLiquidationThresholdPeriodSSV(MINIMAL_LIQUIDATION_THRESHOLD),
    },
    {
      fnName: "updateMinimumLiquidationCollateral",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateMinimumLiquidationCollateral(0n),
    },
    {
      fnName: "updateMinimumLiquidationCollateralSSV",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateMinimumLiquidationCollateralSSV(0n),
    },
    {
      fnName: "updateMaximumOperatorFee",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateMaximumOperatorFee(0n),
    },
    {
      fnName: "updateMinimumOperatorEthFee",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateMinimumOperatorEthFee(0n),
    },
    {
      fnName: "setUnstakeCooldownDuration",
      invoke: (network, nonOwner) => network.connect(nonOwner).setUnstakeCooldownDuration(0n),
    },
    {
      fnName: "replaceOracle",
      invoke: (network, nonOwner) => network.connect(nonOwner).replaceOracle(1, nonOwner.address),
    },
    {
      fnName: "setQuorumBps",
      invoke: (network, nonOwner) => network.connect(nonOwner).setQuorumBps(0),
    },
    {
      fnName: "updateModule",
      invoke: (network, nonOwner) => network.connect(nonOwner).updateModule(0, nonOwner.address),
    },
    {
      fnName: "rescueERC20",
      invoke: (network, nonOwner) => network.connect(nonOwner).rescueERC20(nonOwner.address, nonOwner.address, 0n),
    },
  ];

  for (const testCase of governanceCalls) {
    it(`reverts for non-owner on ${testCase.fnName}()`, async function () {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const nonOwner = await getNonOwner(network);

      await expect(testCase.invoke(network, nonOwner))
        .to.be.revertedWith(Errors.OWNABLE_CALLER_NOT_OWNER);
    });
  }
});
