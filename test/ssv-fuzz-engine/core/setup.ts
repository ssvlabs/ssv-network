import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { Cluster } from "../../common/types.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./types.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../../helpers/keys.ts";
import { parseClusterFromEvent } from "../../helpers/cluster.ts";
import { Events } from "../../common/events.ts";
import { setAccountBalance } from "../../helpers/blocks.ts";

export function alignFee(raw: bigint): bigint {
  return (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

export async function registerFuzzOperators(
  ctx: FuzzContext<any>,
  owner: HardhatEthersSigner,
  count: number,
  fees: bigint[],
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const fee = fees[i] ?? MINIMAL_OPERATOR_ETH_FEE;
    const key = makeOperatorKey(1000 + i);
    const id = await ctx.network.connect(owner).registerOperator.staticCall(key, fee, true);
    await ctx.network.connect(owner).registerOperator(key, fee, true);
    records.push({ id: Number(id), fee, owner });
  }
  return records;
}

export async function registerFuzzCluster(
  ctx: FuzzContext<any>,
  clusterOwner: HardhatEthersSigner,
  operatorOwner: HardhatEthersSigner,
  operatorIds: number[],
  validatorCount: number,
  depositValue: bigint = DEFAULT_ETH_REGISTER_VALUE,
  keyOffset: number = 2000,
): Promise<ClusterRecord> {
  await ctx.network.connect(operatorOwner).setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

  const totalDeposit = depositValue * BigInt(validatorCount);
  await setAccountBalance(ctx.provider, clusterOwner.address, totalDeposit + 10n ** 18n);

  const validatorKeys: string[] = [];
  const sharesData: string[] = [];
  for (let i = 0; i < validatorCount; i++) {
    validatorKeys.push(makePublicKey(keyOffset + i));
    sharesData.push(DEFAULT_SHARES);
  }

  const tx = await ctx.network.connect(clusterOwner).bulkRegisterValidator(
    validatorKeys,
    operatorIds,
    sharesData,
    EMPTY_CLUSTER,
    { value: totalDeposit },
  );
  const receipt = await tx.wait();
  const cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);

  return { cluster, operatorIds, owner: clusterOwner, validatorKeys };
}
