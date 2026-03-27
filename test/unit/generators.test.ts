import { expect } from "chai";
import {
  genBalanceMove,
  genEBMode,
  genEffectiveBalance,
  genFeePhase,
  genOperatorSetSize,
  genSafeWithdrawalAmount,
  genThresholdEdgeWithdrawalAmount,
  genTimingPlan,
  genUnsafeWithdrawalAmount,
  genValidatorBucket,
} from "../helpers/generators.ts";
import { SeededRNG } from "../simulation/rng.ts";
import { ETH_DEDUCTED_DIGITS } from "../common/constants.ts";

describe("Generative PoC Helpers", () => {
  it("bounded axis generators stay inside the supported ETH-core buckets", function () {
    const rng = new SeededRNG(12345n);

    for (let i = 0; i < 32; i++) {
      expect([4, 7, 10, 13]).to.include(genOperatorSetSize(rng));
      expect([1n, 2n, 4n]).to.include(genValidatorBucket(rng));
      expect(["implicit", "explicit-32", "explicit-high", "explicit-max-safe"]).to.include(genEBMode(rng));
      expect(["flat", "declared", "executed"]).to.include(genFeePhase(rng));
      expect(["deposit", "safe-withdraw", "unsafe-withdraw"]).to.include(genBalanceMove(rng));
      expect(["same-block", "short-delay", "fee-window", "long-delay"]).to.include(genTimingPlan(rng).bucket);
    }
  });

  it("effective balance generation is deterministic and bounded for explicit modes", function () {
    const validatorCount = 4n;

    const explicit32 = genEffectiveBalance(new SeededRNG(1n), validatorCount, "explicit-32");
    const explicitHigh = genEffectiveBalance(new SeededRNG(2n), validatorCount, "explicit-high");
    const explicitMaxSafe = genEffectiveBalance(new SeededRNG(3n), validatorCount, "explicit-max-safe");

    expect(explicit32).to.equal(128n);
    expect(explicitHigh).to.be.greaterThanOrEqual(256n);
    expect(explicitMaxSafe).to.be.greaterThanOrEqual(1024n);
  });

  it("safe and unsafe withdrawals stay within bounded solvency targets", function () {
    const balance = 10n * 10n ** 18n;
    const threshold = 2n * 10n ** 18n;
    const burnPerBlock = 5n * ETH_DEDUCTED_DIGITS;

    const safe = genSafeWithdrawalAmount(new SeededRNG(10n), balance, threshold);
    const thresholdEdge = genThresholdEdgeWithdrawalAmount(balance, threshold, burnPerBlock);
    const unsafe = genUnsafeWithdrawalAmount(new SeededRNG(11n), balance, threshold);

    expect(balance - safe).to.be.greaterThan(threshold);
    expect(balance - thresholdEdge).to.equal(threshold + burnPerBlock);
    expect(balance - unsafe).to.be.lessThan(threshold);
  });
});
