export type Validator = {
  id: number;
  privateKey: string;
  publicKey: string;
};

export type Operator = {
  id: number;
  operatorKey: string;
  publicKey: string;
};

export type SSVConfig = {
  initialVersion: string,
  operatorMaxFeeIncrease: number,
  declareOperatorFeePeriod: number,
  executeOperatorFeePeriod: number,
  minimalOperatorFee: BigInt,
  minimalBlocksBeforeLiquidation: number,
  minimumLiquidationCollateral: number,
  validatorsPerOperatorLimit: number,
  maximumOperatorFee: BigInt,
};

export type Cluster = {
  validatorCount: number,
  networkFeeIndex: number,
  index: number,
  active: bool,
  balance: BigInt
}

export enum SSVModules {
  SSVOperators,
  SSVClusters,
  SSVDAO,
  SSVViews
};
