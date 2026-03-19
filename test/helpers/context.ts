import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpersType } from "../common/types.ts";
import { getTestConnection } from "../setup/connection.ts";

export interface TestContext {
  connection: NetworkConnection<"generic">;
  networkHelpers: NetworkHelpersType;
  signers: HardhatEthersSigner[];
}

export async function setupTestContext(): Promise<TestContext> {
  const { connection, networkHelpers } = await getTestConnection();
  const signers = await connection.ethers.getSigners();
  return { connection, networkHelpers, signers };
}
