import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

describe("SSVStaking withdrawUnlocked gas scaling", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const setupWithdrawals = (count: number) => {
    async function fixture() {
      const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);
      const amountPerRequest = 1n;
      const totalAmount = amountPerRequest * BigInt(count);

      await ssvToken.transfer(await staking.getAddress(), totalAmount);

      for (let i = 0; i < count; i++) {
        await staking.mockSetWithdrawal(staker.address, amountPerRequest, 0);
      }

      return { staking };
    }

    return fixture;
  };

  it("measures withdrawUnlocked gas for many pending requests", async function () {
    const baseCounts = [10, 50, 100, 500, 1000, 2000];
    const step = 250;
    const maxCount = 10_000;
    const counts = [...baseCounts];
    for (let count = baseCounts[baseCounts.length - 1] + step; count <= maxCount; count += step) {
      counts.push(count);
    }

    const targetTxGasLimit = 16_777_216n;
    const reportBlockGasLimit = 60_000_000n;
    const block = await connection.ethers.provider.getBlock("latest");
    const blockGasLimit = block?.gasLimit ?? 0n;
    const txGasLimit =
      blockGasLimit > 0n && blockGasLimit < targetTxGasLimit ? blockGasLimit : targetTxGasLimit;

    const resultsByCount = new Map<
      number,
      { gasUsed?: bigint; status: "ok" | "oog"; note?: string }
    >();
    let lastOkCount: number | null = null;
    let firstOogCount: number | null = null;

    const runWithdraw = async (count: number) => {
      const { staking } = await networkHelpers.loadFixture(setupWithdrawals(count));
      try {
        const tx = await staking.connect(staker).withdrawUnlocked({ gasLimit: txGasLimit });
        const receipt = await tx.wait();
        return { status: "ok" as const, gasUsed: receipt.gasUsed };
      } catch (error: any) {
        const message = error?.message ?? String(error);
        if (message.includes("out of gas") || message.includes("ran out of gas")) {
          return { status: "oog" as const };
        }
        throw error;
      }
    };

    for (const count of counts) {
      const result = await runWithdraw(count);
      resultsByCount.set(count, result);
      if (result.status === "ok") {
        lastOkCount = count;
        continue;
      }
      firstOogCount = count;
      break;
    }

    if (lastOkCount !== null && firstOogCount !== null && firstOogCount - lastOkCount > 1) {
      let low = lastOkCount + 1;
      let high = firstOogCount - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        let result = resultsByCount.get(mid);
        if (!result) {
          result = await runWithdraw(mid);
          resultsByCount.set(mid, result);
        }
        if (result.status === "ok") {
          lastOkCount = mid;
          low = mid + 1;
        } else {
          firstOogCount = mid;
          high = mid - 1;
        }
      }
    }

    const sortedResults = Array.from(resultsByCount.entries())
      .sort(([countA], [countB]) => countA - countB)
      .map(([count, result]) => ({ count, ...result }));

    if (lastOkCount !== null) {
      const maxOkResult = sortedResults.find(result => result.count === lastOkCount);
      if (maxOkResult) {
        maxOkResult.note = "maxOk@txGasCap";
      }
    }
    if (firstOogCount !== null) {
      const minOogResult = sortedResults.find(result => result.count === firstOogCount);
      if (minOogResult) {
        minOogResult.note = "minOOG@txGasCap";
      }
    }

    const rows = sortedResults.map(result => [
      result.count.toString(),
      result.status === "ok" && result.gasUsed !== undefined ? result.gasUsed.toString() : "OOG",
      txGasLimit.toString(),
      reportBlockGasLimit.toString(),
      result.note ?? "",
    ]);

    const headers = ["requests", "gasUsed", "txGasCap", "blockGasLimit", "note"];
    const widths = headers.map((header, index) =>
      Math.max(
        header.length,
        ...rows.map(row => row[index].length)
      )
    );

    const separator = `+-${widths.map(width => "-".repeat(width)).join("-+-")}-+`;
    const formatRow = (cells: string[]) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;

    // eslint-disable-next-line no-console
    console.log("\nwithdrawUnlocked gas report");
    // eslint-disable-next-line no-console
    console.log(separator);
    // eslint-disable-next-line no-console
    console.log(formatRow(headers));
    // eslint-disable-next-line no-console
    console.log(separator);
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(formatRow(row));
    }
    // eslint-disable-next-line no-console
    console.log(separator);

    let perRequest: bigint | null = null;
    let base: bigint | null = null;
    let approxMax: bigint | null = null;
    let approxMaxAtTxGasCap: bigint | null = null;

    const okResults = sortedResults.filter(
      (result): result is { count: number; gasUsed: bigint; status: "ok"; note?: string } =>
        result.status === "ok" && result.gasUsed !== undefined
    );

    if (okResults.length >= 2 && txGasLimit > 0n) {
      const last = okResults[okResults.length - 1];
      const prev = okResults[okResults.length - 2];
      const deltaCount = last.count - prev.count;
      const deltaGas = last.gasUsed - prev.gasUsed;

      if (deltaGas > 0n) {
        perRequest = deltaGas / BigInt(deltaCount);
        base = last.gasUsed - perRequest * BigInt(last.count);
        approxMax = (txGasLimit - base) / perRequest;
        approxMaxAtTxGasCap = (targetTxGasLimit - base) / perRequest;
      }
    }

    if (perRequest && base && approxMax && approxMaxAtTxGasCap) {
      const estimateHeaders = ["metric", "value"];
      const estimateRows = [
        ["perRequestGas", perRequest.toString()],
        ["baseGas", base.toString()],
        ["approxMaxRequests", approxMax.toString()],
        ["approxMaxRequestsAtTxGasCap", approxMaxAtTxGasCap.toString()],
        ...(lastOkCount !== null ? [["maxOkRequests", lastOkCount.toString()]] : []),
        ...(firstOogCount !== null ? [["minOogRequests", firstOogCount.toString()]] : []),
      ];
      const estimateWidths = estimateHeaders.map((header, index) =>
        Math.max(
          header.length,
          ...estimateRows.map(row => row[index].length)
        )
      );
      const estimateSeparator = `+-${estimateWidths.map(width => "-".repeat(width)).join("-+-")}-+`;
      const formatEstimateRow = (cells: string[]) =>
        `| ${cells.map((cell, i) => cell.padEnd(estimateWidths[i])).join(" | ")} |`;

      // eslint-disable-next-line no-console
      console.log("\nestimates");
      // eslint-disable-next-line no-console
      console.log(estimateSeparator);
      // eslint-disable-next-line no-console
      console.log(formatEstimateRow(estimateHeaders));
      // eslint-disable-next-line no-console
      console.log(estimateSeparator);
      for (const row of estimateRows) {
        // eslint-disable-next-line no-console
        console.log(formatEstimateRow(row));
      }
      // eslint-disable-next-line no-console
      console.log(estimateSeparator);
    }

    expect(sortedResults.length).to.be.greaterThan(0);
    expect(sortedResults.length).to.be.lessThanOrEqual(counts.length + 16);
    expect(lastOkCount !== null).to.equal(true);
    expect(firstOogCount !== null).to.equal(true);
  });
});
