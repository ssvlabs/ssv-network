import hre from "hardhat";

export interface Cluster {
  validatorCount: bigint;
  networkFeeIndex: bigint;
  index: bigint;
  balance: bigint;
  active: boolean;
}

export interface Operator {
  owner: string;
  ethFee: bigint;
  ethValidatorCount: bigint;
  whitelistedAddress: string;
  isPrivate: boolean;
  isActive: boolean;
}

export interface OperatorSSV {
  owner: string;
  fee: bigint;
  validatorCount: bigint;
  whitelistedAddress: string;
  isPrivate: boolean;
  isActive: boolean;
}

export interface UnstakeRequest {
  amount: bigint;
  unlockTime: bigint;
}

export type ClusterTuple = readonly [
  validatorCount: bigint,
  networkFeeIndex: bigint,
  index: bigint,
  active: boolean,
  balance: bigint
];

export type OperatorTuple = readonly [
  owner: string,
  ethFee: bigint,
  ethValidatorCount: bigint,
  whitelistedAddress: string,
  isPrivate: boolean,
  isActive: boolean
];

export enum SSVModules {
  SSVOperators = 0,
  SSVClusters = 1,
  SSVDAO = 2,
  SSVViews = 3,
  SSVOperatorsWhitelist = 4,
  SSVStaking = 5,
  SSVValidators = 6
}

export type NetworkHelpersType =
  Awaited<ReturnType<typeof hre.network.connect>>["networkHelpers"];
