import { deployAll } from "./deployAll.js";

export async function fullNetworkFixture(connection: any) {
  return deployAll(connection, {
    // todo: align with real values
    ssvTokenAddress: "0x0000000000000000000000000000000000000001",
    params: {
      minimumBlocksBeforeLiquidation: 10n,
      minimumLiquidationCollateral: 100n * (10n ** 18n),
      validatorsPerOperatorLimit: 1000n,
      declareOperatorFeePeriod: 100n,
      executeOperatorFeePeriod: 100n,
      operatorMaxFeeIncrease: 100n,
      defaultOracleIds: [1n, 2n, 3n, 4n],
      quorumBps: 5000n,
    },
  });
}