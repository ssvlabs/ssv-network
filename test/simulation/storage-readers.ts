/**
 * Shared storage reader helpers for direct slot access.
 *
 * Extracted from e2e tests (inv-gap.test.ts, xg-migration-staking.test.ts)
 * to avoid duplication across simulation and test code.
 *
 * Uses diamond storage pattern with deterministic slot computation.
 */

import { ethers } from "ethers";

// --- Base storage slots (keccak256(slotName) - 1) ---

const MAIN_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.main"))) - 1n;
const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;
const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
// --- Mapping/offset slots ---

/** operatorEthVUnits mapping: EB_BASE_SLOT + 2 */
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n;

/** clusterEB mapping: EB_BASE_SLOT + 1 */
const CLUSTER_EB_MAPPING_SLOT = EB_BASE_SLOT + 1n;

/** operators mapping: MAIN_BASE_SLOT + 6 */
const OPERATORS_MAPPING_SLOT = MAIN_BASE_SLOT + 6n;

/** daoTotalEthVUnits is packed at PROTOCOL_BASE_SLOT + 4, bits [192..255] */
const DAO_TOTAL_ETH_VUNITS_SLOT = PROTOCOL_BASE_SLOT + 4n;
const DAO_TOTAL_SHIFT = 192n;

const UINT64_MASK = (1n << 64n) - 1n;
const UINT32_MASK = (1n << 32n) - 1n;

const coder = ethers.AbiCoder.defaultAbiCoder();

// --- Public reader functions ---

/**
 * Read an operator's ethVUnits from the operatorEthVUnits mapping.
 */
export async function readOperatorEthVUnits(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    coder.encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(contractAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

/**
 * Read the DAO total ETH vUnits from protocol storage.
 */
export async function readDaoTotalEthVUnits(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  const slotHex = "0x" + DAO_TOTAL_ETH_VUNITS_SLOT.toString(16);
  const raw = await provider.getStorage(contractAddress, slotHex);
  return (BigInt(raw) >> DAO_TOTAL_SHIFT) & UINT64_MASK;
}

/**
 * Read a cluster's EB vUnits from the clusterEB mapping.
 */
export async function readClusterEBVUnits(
  provider: any,
  contractAddress: string,
  clusterId: string,
): Promise<bigint> {
  const slot = ethers.keccak256(
    coder.encode(
      ["bytes32", "uint256"],
      [clusterId, CLUSTER_EB_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(contractAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

/**
 * Read an operator's ETH snapshot block from the operators mapping.
 * Layout: operator struct base + 2, bits [64..95] = ethSnapshot.block (uint32).
 */
export async function readOperatorEthSnapshotBlock(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const operatorBaseSlot = BigInt(
    ethers.keccak256(
      coder.encode(
        ["uint256", "uint256"],
        [BigInt(operatorId), OPERATORS_MAPPING_SLOT],
      ),
    ),
  );
  const slot = operatorBaseSlot + 2n;
  const slotHex = "0x" + slot.toString(16);
  const raw = BigInt(await provider.getStorage(contractAddress, slotHex));
  return (raw >> 64n) & UINT32_MASK;
}

/**
 * Read an operator's ETH snapshot index from the operators mapping.
 *
 * Operator struct Slot 2 layout:
 *   bits [0..63]   = ethFee (PackedETH)
 *   bits [64..95]  = ethSnapshot.block (uint32)
 *   bits [96..159] = ethSnapshot.index (uint64)
 *   bits [160..223]= ethSnapshot.balance (PackedETH)
 */
export async function readOperatorEthSnapshotIndex(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const operatorBaseSlot = BigInt(
    ethers.keccak256(
      coder.encode(
        ["uint256", "uint256"],
        [BigInt(operatorId), OPERATORS_MAPPING_SLOT],
      ),
    ),
  );
  const slot = operatorBaseSlot + 2n;
  const slotHex = "0x" + slot.toString(16);
  const raw = BigInt(await provider.getStorage(contractAddress, slotHex));
  return (raw >> 96n) & UINT64_MASK;
}

/**
 * Read an operator's ETH fee from the operators mapping.
 *
 * Operator struct Slot 2, bits [0..63] = ethFee (PackedETH = uint64).
 */
export async function readOperatorEthFee(
  provider: any,
  contractAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const operatorBaseSlot = BigInt(
    ethers.keccak256(
      coder.encode(
        ["uint256", "uint256"],
        [BigInt(operatorId), OPERATORS_MAPPING_SLOT],
      ),
    ),
  );
  const slot = operatorBaseSlot + 2n;
  const slotHex = "0x" + slot.toString(16);
  const raw = BigInt(await provider.getStorage(contractAddress, slotHex));
  return raw & UINT64_MASK;
}
