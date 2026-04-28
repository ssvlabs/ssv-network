import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../common/types.ts";
import { setupTestContext } from "../common/helpers.ts";
import { ETH_DEDUCTED_DIGITS, DEDUCTED_DIGITS } from "../common/constants.ts";
import { Errors } from "../common/errors.ts";

describe("SSVPackedLib and SSVCoreTypes", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let harness: any;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployFixture = async () => {
    const contract = await connection.ethers.deployContract("PackedLibHarness");
    await contract.waitForDeployment();
    return { harness: contract };
  };

  beforeEach(async function () {
    ({ harness } = await networkHelpers.loadFixture(deployFixture));
  });

  describe("SSVCoreTypes constants", () => {
    it("PACKED_ETH_ZERO is 0", async function () {
      expect(await harness.getPackedEthZero()).to.equal(0n);
    });

    it("PACKED_SSV_ZERO is 0", async function () {
      expect(await harness.getPackedSsvZero()).to.equal(0n);
    });

    it("VERSION_SSV is 0", async function () {
      expect(await harness.getVersionSSV()).to.equal(0n);
    });

    it("VERSION_ETH is 1", async function () {
      expect(await harness.getVersionETH()).to.equal(1n);
    });

    it("VERSION_UNDEFINED is type(uint8).max (255)", async function () {
      expect(await harness.getVersionUndefined()).to.equal(255n);
    });

    it("DEFAULT_OPERATOR_ETH_FEE is 1778_800_000", async function () {
      expect(await harness.getDefaultOperatorEthFee()).to.equal(1778_800_000n);
    });

    it("DEDUCTED_DIGITS is 10_000_000", async function () {
      expect(await harness.getDeductedDigits()).to.equal(DEDUCTED_DIGITS);
    });

    it("ETH_DEDUCTED_DIGITS is 100_000", async function () {
      expect(await harness.getEthDeductedDigits()).to.equal(ETH_DEDUCTED_DIGITS);
    });
  });

  describe("PackedETHLib", () => {
    describe("pack / unpack", () => {
      it("Packs a valid ETH value", async function () {
        const value = 1_000_000n;
        const packed = await harness.ethPack(value);
        expect(packed).to.equal(value / ETH_DEDUCTED_DIGITS);
      });

      it("Unpacks a packed ETH value back to original", async function () {
        const value = 5_000_000n;
        const packed = await harness.ethPack(value);
        const unpacked = await harness.ethUnpack(packed);
        expect(unpacked).to.equal(value);
      });

      it("Pack then unpack is identity for aligned values", async function () {
        const value = 123_456_700_000n;
        const packed = await harness.ethPack(value);
        const unpacked = await harness.ethUnpack(packed);
        expect(unpacked).to.equal(value);
      });

      it("Packs zero", async function () {
        expect(await harness.ethPack(0n)).to.equal(0n);
      });

      it("Unpacks zero", async function () {
        expect(await harness.ethUnpack(0n)).to.equal(0n);
      });

      it("Packs the maximum uint64 * ETH_DEDUCTED_DIGITS value", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        const maxValue = maxUint64 * ETH_DEDUCTED_DIGITS;
        const packed = await harness.ethPack(maxValue);
        expect(packed).to.equal(maxUint64);
      });

      it("Reverts with MaxValueExceeded when value exceeds uint64 range", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        const tooLarge = (maxUint64 + 1n) * ETH_DEDUCTED_DIGITS;
        await expect(harness.ethPack(tooLarge))
          .to.be.revertedWithCustomError(harness, Errors.MAX_VALUE_EXCEEDED);
      });

      it("Reverts with MaxPrecisionExceeded when value is not aligned", async function () {
        await expect(harness.ethPack(1n))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      });

      it("Reverts with MaxPrecisionExceeded for ETH_DEDUCTED_DIGITS - 1", async function () {
        await expect(harness.ethPack(ETH_DEDUCTED_DIGITS - 1n))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      });
    });

    describe("raw", () => {
      it("Returns the raw uint64 value", async function () {
        expect(await harness.ethRaw(42n)).to.equal(42n);
      });

      it("Returns 0 for zero", async function () {
        expect(await harness.ethRaw(0n)).to.equal(0n);
      });
    });

    describe("comparison operators", () => {
      it("eq returns true for equal values", async function () {
        expect(await harness.ethEq(10n, 10n)).to.equal(true);
      });

      it("eq returns false for different values", async function () {
        expect(await harness.ethEq(10n, 20n)).to.equal(false);
      });

      it("neq returns true for different values", async function () {
        expect(await harness.ethNeq(10n, 20n)).to.equal(true);
      });

      it("neq returns false for equal values", async function () {
        expect(await harness.ethNeq(10n, 10n)).to.equal(false);
      });

      it("gt returns true when a > b", async function () {
        expect(await harness.ethGt(20n, 10n)).to.equal(true);
      });

      it("gt returns false when a == b", async function () {
        expect(await harness.ethGt(10n, 10n)).to.equal(false);
      });

      it("gt returns false when a < b", async function () {
        expect(await harness.ethGt(5n, 10n)).to.equal(false);
      });

      it("gte returns true when a > b", async function () {
        expect(await harness.ethGte(20n, 10n)).to.equal(true);
      });

      it("gte returns true when a == b", async function () {
        expect(await harness.ethGte(10n, 10n)).to.equal(true);
      });

      it("gte returns false when a < b", async function () {
        expect(await harness.ethGte(5n, 10n)).to.equal(false);
      });

      it("lt returns true when a < b", async function () {
        expect(await harness.ethLt(5n, 10n)).to.equal(true);
      });

      it("lt returns false when a == b", async function () {
        expect(await harness.ethLt(10n, 10n)).to.equal(false);
      });

      it("lt returns false when a > b", async function () {
        expect(await harness.ethLt(20n, 10n)).to.equal(false);
      });

      it("lte returns true when a < b", async function () {
        expect(await harness.ethLte(5n, 10n)).to.equal(true);
      });

      it("lte returns true when a == b", async function () {
        expect(await harness.ethLte(10n, 10n)).to.equal(true);
      });

      it("lte returns false when a > b", async function () {
        expect(await harness.ethLte(20n, 10n)).to.equal(false);
      });

      it("Comparisons work with zero", async function () {
        expect(await harness.ethEq(0n, 0n)).to.equal(true);
        expect(await harness.ethGt(1n, 0n)).to.equal(true);
        expect(await harness.ethLt(0n, 1n)).to.equal(true);
        expect(await harness.ethGte(0n, 0n)).to.equal(true);
        expect(await harness.ethLte(0n, 0n)).to.equal(true);
      });
    });

    describe("arithmetic operators", () => {
      it("add returns the sum of two packed values", async function () {
        expect(await harness.ethAdd(10n, 20n)).to.equal(30n);
      });

      it("add with zero", async function () {
        expect(await harness.ethAdd(10n, 0n)).to.equal(10n);
        expect(await harness.ethAdd(0n, 10n)).to.equal(10n);
      });

      it("sub returns the difference of two packed values", async function () {
        expect(await harness.ethSub(30n, 10n)).to.equal(20n);
      });

      it("sub to zero", async function () {
        expect(await harness.ethSub(10n, 10n)).to.equal(0n);
      });

      it("sub reverts on underflow", async function () {
        await expect(harness.ethSub(5n, 10n)).to.be.revertedWithPanic(0x11);
      });

      it("add reverts on overflow", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        await expect(harness.ethAdd(maxUint64, 1n)).to.be.revertedWithPanic(0x11);
      });
    });
  });

  describe("PackedSSVLib", () => {
    describe("pack / unpack", () => {
      it("Packs a valid SSV value", async function () {
        const value = 10_000_000n;
        const packed = await harness.ssvPack(value);
        expect(packed).to.equal(value / DEDUCTED_DIGITS);
      });

      it("Unpacks a packed SSV value back to original", async function () {
        const value = 50_000_000n;
        const packed = await harness.ssvPack(value);
        const unpacked = await harness.ssvUnpack(packed);
        expect(unpacked).to.equal(value);
      });

      it("Pack then unpack is identity for aligned values", async function () {
        const value = 1_234_560_000_000n;
        const packed = await harness.ssvPack(value);
        const unpacked = await harness.ssvUnpack(packed);
        expect(unpacked).to.equal(value);
      });

      it("Packs zero", async function () {
        expect(await harness.ssvPack(0n)).to.equal(0n);
      });

      it("Unpacks zero", async function () {
        expect(await harness.ssvUnpack(0n)).to.equal(0n);
      });

      it("Packs the maximum uint64 * DEDUCTED_DIGITS value", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        const maxValue = maxUint64 * DEDUCTED_DIGITS;
        const packed = await harness.ssvPack(maxValue);
        expect(packed).to.equal(maxUint64);
      });

      it("Reverts with MaxValueExceeded when value exceeds uint64 range", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        const tooLarge = (maxUint64 + 1n) * DEDUCTED_DIGITS;
        await expect(harness.ssvPack(tooLarge))
          .to.be.revertedWithCustomError(harness, Errors.MAX_VALUE_EXCEEDED);
      });

      it("Reverts with MaxPrecisionExceeded when value is not aligned", async function () {
        await expect(harness.ssvPack(1n))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      });

      it("Reverts with MaxPrecisionExceeded for DEDUCTED_DIGITS - 1", async function () {
        await expect(harness.ssvPack(DEDUCTED_DIGITS - 1n))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      });
    });

    describe("raw", () => {
      it("Returns the raw uint64 value", async function () {
        expect(await harness.ssvRaw(42n)).to.equal(42n);
      });

      it("Returns 0 for zero", async function () {
        expect(await harness.ssvRaw(0n)).to.equal(0n);
      });
    });

    describe("comparison operators", () => {
      it("eq returns true for equal values", async function () {
        expect(await harness.ssvEq(10n, 10n)).to.equal(true);
      });

      it("eq returns false for different values", async function () {
        expect(await harness.ssvEq(10n, 20n)).to.equal(false);
      });

      it("neq returns true for different values", async function () {
        expect(await harness.ssvNeq(10n, 20n)).to.equal(true);
      });

      it("neq returns false for equal values", async function () {
        expect(await harness.ssvNeq(10n, 10n)).to.equal(false);
      });

      it("gt returns true when a > b", async function () {
        expect(await harness.ssvGt(20n, 10n)).to.equal(true);
      });

      it("gt returns false when a == b", async function () {
        expect(await harness.ssvGt(10n, 10n)).to.equal(false);
      });

      it("gt returns false when a < b", async function () {
        expect(await harness.ssvGt(5n, 10n)).to.equal(false);
      });

      it("lt returns true when a < b", async function () {
        expect(await harness.ssvLt(5n, 10n)).to.equal(true);
      });

      it("lt returns false when a == b", async function () {
        expect(await harness.ssvLt(10n, 10n)).to.equal(false);
      });

      it("lt returns false when a > b", async function () {
        expect(await harness.ssvLt(20n, 10n)).to.equal(false);
      });

      it("Comparisons work with zero", async function () {
        expect(await harness.ssvEq(0n, 0n)).to.equal(true);
        expect(await harness.ssvGt(1n, 0n)).to.equal(true);
        expect(await harness.ssvLt(0n, 1n)).to.equal(true);
      });
    });

    describe("arithmetic operators", () => {
      it("add returns the sum of two packed values", async function () {
        expect(await harness.ssvAdd(10n, 20n)).to.equal(30n);
      });

      it("add with zero", async function () {
        expect(await harness.ssvAdd(10n, 0n)).to.equal(10n);
        expect(await harness.ssvAdd(0n, 10n)).to.equal(10n);
      });

      it("sub returns the difference of two packed values", async function () {
        expect(await harness.ssvSub(30n, 10n)).to.equal(20n);
      });

      it("sub to zero", async function () {
        expect(await harness.ssvSub(10n, 10n)).to.equal(0n);
      });

      it("sub reverts on underflow", async function () {
        await expect(harness.ssvSub(5n, 10n)).to.be.revertedWithPanic(0x11);
      });

      it("add reverts on overflow", async function () {
        const maxUint64 = (1n << 64n) - 1n;
        await expect(harness.ssvAdd(maxUint64, 1n)).to.be.revertedWithPanic(0x11);
      });
    });
  });

  describe("ETH vs SSV scaling factor differences", () => {
    it("Same wei value produces different packed values for ETH vs SSV", async function () {
      const value = 100_000_000_000_000n;
      const ethPacked = await harness.ethPack(value);
      const ssvPacked = await harness.ssvPack(value);
      expect(ethPacked).to.equal(1_000_000_000n);
      expect(ssvPacked).to.equal(10_000_000n);
      expect(ethPacked).to.be.greaterThan(ssvPacked);
    });

    it("ETH allows finer granularity than SSV", async function () {
      const fineValue = ETH_DEDUCTED_DIGITS;
      const ethPacked = await harness.ethPack(fineValue);
      expect(ethPacked).to.equal(1n);

      await expect(harness.ssvPack(fineValue))
        .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("DEFAULT_OPERATOR_ETH_FEE is packable as ETH", async function () {
      const fee = await harness.getDefaultOperatorEthFee();
      const packed = await harness.ethPack(fee);
      expect(packed).to.equal(fee / ETH_DEDUCTED_DIGITS);

      const unpacked = await harness.ethUnpack(packed);
      expect(unpacked).to.equal(fee);
    });
  });

  // ============ _safeUint64 ============

  describe("_safeUint64", () => {
    const MAX_UINT64 = (1n << 64n) - 1n;

    it("passes through zero", async function () {
      expect(await harness.safeUint64(0n)).to.equal(0n);
    });

    it("passes through value within uint64 range", async function () {
      expect(await harness.safeUint64(42n)).to.equal(42n);
    });

    it("passes through max uint64", async function () {
      expect(await harness.safeUint64(MAX_UINT64)).to.equal(MAX_UINT64);
    });

    it("reverts on max uint64 + 1", async function () {
      await expect(harness.safeUint64(MAX_UINT64 + 1n))
        .to.be.revertedWithCustomError(harness, "SafeCastOverflow");
    });

    it("reverts on max uint128", async function () {
      const MAX_UINT128 = (1n << 128n) - 1n;
      await expect(harness.safeUint64(MAX_UINT128))
        .to.be.revertedWithCustomError(harness, "SafeCastOverflow");
    });

    it("reverts on realistic overflow scenario (operator earnings delta)", async function () {
      // Simulates: (blockDiffEthFee * effectiveVUnits) / BPS_DENOMINATOR
      // where both inputs are large uint64 values
      const blockDiffEthFee = MAX_UINT64;
      const effectiveVUnits = MAX_UINT64;
      const delta = (blockDiffEthFee * effectiveVUnits) / 10_000n;
      // delta ≈ 3.39e34, far exceeds uint64 max ≈ 1.84e19
      await expect(harness.safeUint64(delta))
        .to.be.revertedWithCustomError(harness, "SafeCastOverflow");
    });
  });
});
