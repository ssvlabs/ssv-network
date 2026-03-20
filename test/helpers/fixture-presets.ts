import type { NetworkConnection } from "hardhat/types/network";
import {
  ssvOperatorsHarnessFixture,
  ssvClustersHarnessFixture,
  ssvValidatorsHarnessFixture,
  ssvDAOHarnessFixture,
  ssvStakingHarnessFixture,
} from "../setup/fixtures.ts";
import {
  MAXIMUM_OPERATORS_FEE,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  OPERATOR_MAX_FEE_INCREASE,
} from "../common/constants.ts";

export const defaultOperatorsFixture = (connection: NetworkConnection<"generic">) =>
  ssvOperatorsHarnessFixture(
    connection,
    MAXIMUM_OPERATORS_FEE,
    DECLARE_OPERATOR_FEE_PERIOD,
    EXECUTE_OPERATOR_FEE_PERIOD,
    OPERATOR_MAX_FEE_INCREASE,
  );

export const defaultClustersFixture = (connection: NetworkConnection<"generic">, operatorCount = 4, operatorFee = 0n) =>
  ssvClustersHarnessFixture(connection, operatorCount, operatorFee);

export const defaultValidatorsFixture = (connection: NetworkConnection<"generic">, operatorCount = 4, operatorFee = 0n) =>
  ssvValidatorsHarnessFixture(connection, operatorCount, operatorFee);

export const defaultDAOFixture = (connection: NetworkConnection<"generic">) =>
  ssvDAOHarnessFixture(connection);

export const defaultStakingFixture = (connection: NetworkConnection<"generic">) =>
  ssvStakingHarnessFixture(connection);
