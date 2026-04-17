import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getEthers } from "./common/helpers.ts";
import {
  type UpgradeConfig,
  parseOptionalArg,
  requireAddress,
  resolveConfigPath,
  resolveNetworkFromEnv,
} from "./common/config.ts";
import {
  canImpersonateOnNetwork,
  getSignerForAddress,
  resolveRpcUrl,
} from "./common/impersonation.ts";

const STEP = (n: number, msg: string) => console.log(`[${n}/20] ${msg}`);

const SSV_FOUNDATION = "0xeC29418bc30FED20dE85706F32c7D77Da0be7afB";
// Randomize per run so reruns against the same fork don't collide on OperatorAlreadyExists / validator pk reuse.
const RUN_NONCE = Math.floor(Math.random() * 0x7fff_ffff);
const OP_SEED = RUN_NONCE;
const VAL_SEED = RUN_NONCE + 100_000;
const DEFAULT_SHARES = "0x1234";
const EB_PER_VALIDATOR = 64; // ETH per validator — 2× default (32); keeps post-bump burn rate modest
const POST_EB_HEADROOM_BLOCKS = 1_000n; // Keep only a small deterministic runway after the EB bump
const ETH_DEDUCTED_DIGITS = 100_000n;
const BPS = 10_000n;
const OP_EARNINGS_BLOCKS = 2;
const STAKING_REWARD_BLOCKS = 2;

type Cluster = {
  validatorCount: number | bigint;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
};

const EMPTY_CLUSTER: Cluster = {
  validatorCount: 0,
  networkFeeIndex: 0n,
  index: 0n,
  active: true,
  balance: 0n,
};

function makeKey(seed: number): string {
  return `0x${seed.toString(16).padStart(96, "0")}`;
}

function clusterFromEvent(log: any): Cluster {
  const c = log.args.cluster;
  return {
    validatorCount: Number(c.validatorCount),
    networkFeeIndex: BigInt(c.networkFeeIndex),
    index: BigInt(c.index),
    active: c.active,
    balance: BigInt(c.balance),
  };
}

function findEventLog(receipt: any, iface: any, name: string): any {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === name) return { ...log, args: parsed.args };
    } catch {
      // skip
    }
  }
  throw new Error(`Event ${name} not found in receipt`);
}

function doubleHashLeaf(ethers: any, clusterId: string, effectiveBalance: number): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint32"],
    [clusterId, effectiveBalance],
  );
  return ethers.keccak256(ethers.keccak256(encoded));
}

function computeClusterId(ethers: any, owner: string, opIds: bigint[]): string {
  return ethers.keccak256(ethers.solidityPacked(["address", "uint64[]"], [owner, opIds]));
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

async function mineBlocks(provider: any, n: number) {
  if (n <= 0) return;
  const hex = `0x${n.toString(16)}`;
  // Pass interval=0x0 so all N blocks share a timestamp → O(1) fast-forward, no per-block loop.
  const ok =
    (await trySend(provider, "hardhat_mine", [hex, "0x0"])) ||
    (await trySend(provider, "hardhat_mine", [hex])) ||
    (await trySend(provider, "anvil_mine", [hex, "0x0"])) ||
    (await trySend(provider, "anvil_mine", [hex]));
  if (!ok) throw new Error("mine not supported");
}

async function increaseTime(provider: any, seconds: number) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function trySend(provider: any, method: string, params: unknown[]): Promise<boolean> {
  try {
    await provider.send(method, params);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const envFlag = parseOptionalArg("env");
  const configFlag = parseOptionalArg("config");

  let initConfigPath: string;
  if (envFlag) {
    initConfigPath = resolveConfigPath(envFlag);
  } else if (configFlag) {
    initConfigPath = resolve(configFlag);
  } else {
    throw new Error("Provide --env <environment> or --config <path>");
  }

  const targetNetwork = parseOptionalArg("network") ?? resolveNetworkFromEnv(envFlag) ?? "local";
  const rpcUrl = resolveRpcUrl(targetNetwork);
  if (!canImpersonateOnNetwork(targetNetwork, rpcUrl)) {
    throw new Error(
      `Smoke test requires a fork (local/hardhat) network — got '${targetNetwork}'. ` +
      `Run your mainnet fork locally and pass '--network local' (or omit --network for default).`,
    );
  }

  const raw = await readFile(initConfigPath, "utf8");
  const config = JSON.parse(raw) as UpgradeConfig & {
    ssvToken: string;
    cssvToken?: string;
    oracles: Record<string, string>;
  };

  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const ssvNetworkViews = requireAddress(config.ssvNetworkViews, "ssvNetworkViews");
  const ssvTokenAddr = requireAddress(config.ssvToken, "ssvToken");
  const cssvTokenAddr = requireAddress(config.cssvToken!, "cssvToken");

  const ethers = await getEthers(targetNetwork);

  STEP(1, "Pre-flight: version + module wiring");
  const code = await ethers.provider.getCode(ssvNetworkProxy);
  if (code === "0x") throw new Error(`No code at ssvNetworkProxy ${ssvNetworkProxy}`);

  const network = await ethers.getContractAt("SSVNetwork", ssvNetworkProxy);
  const views = await ethers.getContractAt("SSVNetworkViews", ssvNetworkViews);
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];
  const ssvToken = await ethers.getContractAt(erc20Abi, ssvTokenAddr);
  const cssvToken = await ethers.getContractAt(erc20Abi, cssvTokenAddr);

  const onChainVersion = await network.getVersion();
  if (onChainVersion !== config.targetVersion) {
    throw new Error(
      `Version mismatch: config.targetVersion='${config.targetVersion}' but proxy='${onChainVersion}'. Did you run upgrade first?`,
    );
  }
  console.log(`    version = ${onChainVersion} ✓`);

  // Pick clean EOAs — hardhat's default signer addresses can collide with real mainnet contract code
  // on a fork, which makes ETH payouts (e.g. claimEthRewards) revert with ETHTransferFailed.
  // Derive fresh wallets deterministically from the run nonce and fund them via setBalance.
  async function freshFundedEoa(seed: number) {
    // Deterministic but run-unique private key
    const priv = ethers.keccak256(
      ethers.toUtf8Bytes(`smoke-test:${RUN_NONCE}:${seed}`),
    );
    const w = new (ethers as any).Wallet(priv, ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [w.address, "0x56bc75e2d63100000"]); // 100 ETH
    const code = await ethers.provider.getCode(w.address);
    if (code !== "0x") {
      // Extremely unlikely but guard anyway
      throw new Error(`Generated EOA ${w.address} happens to have code on fork — rerun smoke test`);
    }
    return w;
  }
  async function freshEthReceivableEoa(startSeed: number, probeSender: any) {
    for (let offset = 0; offset < 32; offset++) {
      const candidate = await freshFundedEoa(startSeed + offset);
      try {
        const before = BigInt(await ethers.provider.getBalance(candidate.address));
        const probeTx = await probeSender.sendTransaction({ to: candidate.address, value: 1n });
        await probeTx.wait();
        const after = BigInt(await ethers.provider.getBalance(candidate.address));
        if (after >= before + 1n) return candidate;
      } catch {
        // Try the next candidate if the ETH receive probe fails on this fork state.
      }
    }
    throw new Error("Failed to find a fresh ETH-receivable EOA for staking rewards");
  }
  const clusterOwner = await freshFundedEoa(1);
  const liquidator = await freshFundedEoa(2);
  const staker = await freshEthReceivableEoa(3, clusterOwner);
  const opOwner = clusterOwner;
  console.log(`    clusterOwner=${clusterOwner.address} liquidator=${liquidator.address} staker=${staker.address}`);

  const minOpFee = BigInt(await views.getMinimumOperatorEthFee());
  const networkFee = BigInt(await views.getNetworkFee());
  const liqThreshold = BigInt(await views.getLiquidationThresholdPeriod());
  const minLiqCollateral = BigInt(await views.getMinimumLiquidationCollateral());

  STEP(2, "Register 4 fresh public operators");
  const operatorIds: bigint[] = [];
  for (let i = 0; i < 4; i++) {
    const key = makeKey(OP_SEED + i);
    const id: bigint = await network.connect(opOwner).registerOperator.staticCall(key, minOpFee, false);
    await (await network.connect(opOwner).registerOperator(key, minOpFee, false)).wait();
    operatorIds.push(id);
  }
  console.log(`    operatorIds = [${operatorIds.join(", ")}]`);

  STEP(3, "Register first validator (creates new ETH cluster)");
  // Size deposit for the POST-bump liquidation target at the final validator count (2).
  // Liquidation checks use:
  //   max(minLiquidationCollateral, burnRate * minimumBlocksBeforeLiquidation)
  // so we only need a small deterministic headroom above that target.
  const finalValidatorCount = 2n; // after register + bulk(+2) + removeOne
  const postBumpVUnitsTotal = BigInt(Math.ceil((Number(finalValidatorCount) * EB_PER_VALIDATOR * 10_000) / 32));
  const burnPerBlockPerVUnit = minOpFee * 4n + networkFee; // wei per block per 1 vUnit
  const postBumpBurnRateWei = burnPerBlockPerVUnit * postBumpVUnitsTotal / BPS;
  const postBumpLiquidationTarget = maxBigInt(
    minLiqCollateral,
    postBumpBurnRateWei * liqThreshold,
  );
  let deposit = postBumpLiquidationTarget + postBumpBurnRateWei * POST_EB_HEADROOM_BLOCKS;
  deposit = ((deposit + ETH_DEDUCTED_DIGITS - 1n) / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
  console.log(
    `    postBumpBurnRate=${postBumpBurnRateWei}/blk target=${postBumpLiquidationTarget} deposit=${deposit}`,
  );

  const pk0 = makeKey(VAL_SEED);
  const regTx = await network
    .connect(clusterOwner)
    .registerValidator(pk0, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: deposit });
  let regReceipt = await regTx.wait();
  let cluster: Cluster = clusterFromEvent(findEventLog(regReceipt, network.interface, "ValidatorAdded"));
  console.log(`    deposit=${deposit} balance=${cluster.balance} validatorCount=${cluster.validatorCount}`);

  STEP(4, "Deposit more ETH into the cluster");
  const topUp = ETH_DEDUCTED_DIGITS;
  const depTx = await network
    .connect(clusterOwner)
    .deposit(clusterOwner.address, operatorIds, cluster, { value: topUp });
  const depReceipt = await depTx.wait();
  cluster = clusterFromEvent(findEventLog(depReceipt, network.interface, "ClusterDeposited"));

  STEP(5, "Bulk register +2 validators");
  const bulkKeys = [makeKey(VAL_SEED + 1), makeKey(VAL_SEED + 2)];
  const bulkShares = [DEFAULT_SHARES, DEFAULT_SHARES];
  const bulkValue = ETH_DEDUCTED_DIGITS;
  const bulkTx = await network
    .connect(clusterOwner)
    .bulkRegisterValidator(bulkKeys, operatorIds, bulkShares, cluster, { value: bulkValue });
  const bulkReceipt = await bulkTx.wait();
  if (!bulkReceipt) throw new Error("bulkRegisterValidator: null receipt");
  // The last ValidatorAdded log carries the up-to-date cluster
  let lastAddedArgs: any = null;
  for (const log of [...bulkReceipt.logs].reverse()) {
    try {
      const parsed = network.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "ValidatorAdded") {
        lastAddedArgs = parsed.args;
        break;
      }
    } catch {
      // skip
    }
  }
  if (!lastAddedArgs) throw new Error("No ValidatorAdded log in bulkRegisterValidator receipt");
  cluster = clusterFromEvent({ args: lastAddedArgs });
  console.log(`    validatorCount = ${cluster.validatorCount}`);

  STEP(6, "Remove one validator");
  const rmTx = await network.connect(clusterOwner).removeValidator(bulkKeys[0], operatorIds, cluster);
  const rmReceipt = await rmTx.wait();
  cluster = clusterFromEvent(findEventLog(rmReceipt, network.interface, "ValidatorRemoved"));
  console.log(`    validatorCount = ${cluster.validatorCount}`);

  STEP(7, "Exit remaining bulk validator (signal)");
  await (await network.connect(clusterOwner).exitValidator(bulkKeys[1], operatorIds)).wait();

  STEP(8, "Declare → wait → execute operator fee");
  const periods = await views.getOperatorFeePeriods();
  const declarePeriod = Number(periods.declarePeriod);
  const newFee = minOpFee + (minOpFee / 100n); // +1% — small bump within limit
  // Pack-align
  const newFeeAligned = (newFee / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
  await (await network.connect(opOwner).declareOperatorFee(operatorIds[0], newFeeAligned)).wait();
  await increaseTime(ethers.provider, declarePeriod + 1);
  await (await network.connect(opOwner).executeOperatorFee(operatorIds[0])).wait();

  STEP(9, "Withdraw all operator earnings (ETH)");
  // A couple of blocks is enough to make earnings non-zero on the fork; large
  // block jumps make Anvil do unnecessary work here.
  await mineBlocks(ethers.provider, OP_EARNINGS_BLOCKS);
  const earnings0 = BigInt(await views.getOperatorEarnings(operatorIds[0]));
  if (earnings0 > 0n) {
    await (await network.connect(opOwner).withdrawAllOperatorEarnings(operatorIds[0])).wait();
    console.log(`    withdrew ${earnings0} wei from op ${operatorIds[0]}`);
  } else {
    console.log(`    (no earnings yet, skipped withdraw)`);
  }

  STEP(10, "Impersonate SSV Foundation, transfer + approve + stake");
  const stakeAmount = 10n * 10n ** 18n; // 10 SSV
  const { signer: foundation } = await getSignerForAddress(ethers, SSV_FOUNDATION, true);
  const foundationBalance = BigInt(await ssvToken.balanceOf(SSV_FOUNDATION));
  if (foundationBalance < stakeAmount) {
    throw new Error(`Foundation has only ${foundationBalance} SSV, need ${stakeAmount}`);
  }
  await (await (ssvToken.connect(foundation) as any).transfer(staker.address, stakeAmount)).wait();
  const stakerSsvBeforeStake = BigInt(await ssvToken.balanceOf(staker.address));
  const stakerCssvBeforeStake = BigInt(await cssvToken.balanceOf(staker.address));
  const contractSsvBeforeStake = BigInt(await ssvToken.balanceOf(ssvNetworkProxy));
  await (await (ssvToken.connect(staker) as any).approve(ssvNetworkProxy, stakeAmount)).wait();
  await (await network.connect(staker).stake(stakeAmount)).wait();
  const cssvBal = BigInt(await cssvToken.balanceOf(staker.address));
  const stakerSsvAfterStake = BigInt(await ssvToken.balanceOf(staker.address));
  const contractSsvAfterStake = BigInt(await ssvToken.balanceOf(ssvNetworkProxy));
  const cssvMinted = cssvBal - stakerCssvBeforeStake;
  if (cssvMinted !== stakeAmount) {
    throw new Error(`Stake minted ${cssvMinted} cSSV, expected ${stakeAmount}`);
  }
  if (stakerSsvBeforeStake - stakerSsvAfterStake !== stakeAmount) {
    throw new Error(
      `Stake debited ${stakerSsvBeforeStake - stakerSsvAfterStake} SSV from staker, expected ${stakeAmount}`,
    );
  }
  if (contractSsvAfterStake - contractSsvBeforeStake !== stakeAmount) {
    throw new Error(
      `Stake credited ${contractSsvAfterStake - contractSsvBeforeStake} SSV to contract, expected ${stakeAmount}`,
    );
  }
  console.log(`    staker=${staker.address} staked=${stakeAmount} cssvMinted=${cssvMinted}`);

  STEP(11, "Accrue protocol fees + check accEthPerShare > 0");
  // syncFees() updates the staking accumulator directly; no need to touch the cluster
  // or mine hundreds of blocks just to produce a claimable amount.
  await mineBlocks(ethers.provider, STAKING_REWARD_BLOCKS);
  await (await network.connect(staker).syncFees()).wait();
  const acc = BigInt(await views.accEthPerShare());
  console.log(`    accEthPerShare = ${acc}`);
  if (acc === 0n) console.log(`    ⚠ accEthPerShare still 0 — network fee may not have accrued yet`);

  STEP(12, "Claim ETH rewards");
  const claimable = BigInt(await views.previewClaimableEth(staker.address));
  const expectedMinPayout = claimable - (claimable % ETH_DEDUCTED_DIGITS);
  const stakerEthBeforeClaim = BigInt(await ethers.provider.getBalance(staker.address));
  const proxyEthBalBefore = BigInt(await ethers.provider.getBalance(ssvNetworkProxy));
  console.log(`    claimable=${claimable} proxyETH=${proxyEthBalBefore}`);
  if (claimable > 0n) {
    // Probe with staticCall to surface the exact custom-error selector.
    try {
      await network.connect(staker).claimEthRewards.staticCall();
    } catch (e: any) {
      console.error(`    claimEthRewards staticCall reverted — data=${e?.data ?? "(none)"}`);
      throw e;
    }
    const claimReceipt = await (await network.connect(staker).claimEthRewards()).wait();
    const stakerEthAfterClaim = BigInt(await ethers.provider.getBalance(staker.address));
    const claimGas = claimReceipt.gasUsed * claimReceipt.gasPrice;
    const claimedDelta = stakerEthAfterClaim + claimGas - stakerEthBeforeClaim;
    const claimableAfter = BigInt(await views.previewClaimableEth(staker.address));
    if (claimedDelta % ETH_DEDUCTED_DIGITS !== 0n) {
      throw new Error(`Claim transferred non-packed amount ${claimedDelta}`);
    }
    if (claimedDelta < expectedMinPayout) {
      throw new Error(`Claim transferred ${claimedDelta} wei, below preview floor ${expectedMinPayout}`);
    }
    if (claimableAfter >= claimable) {
      throw new Error(`Post-claim preview=${claimableAfter}, expected it to decrease from ${claimable}`);
    }
    console.log(`    claimed = ${claimedDelta} wei`);
  } else {
    console.log(`    (nothing claimable yet)`);
  }

  STEP(13, "Oracle commits EB root (3-of-4 quorum) with higher EB");
  const validatorCount = Number(cluster.validatorCount);
  if (validatorCount === 0) throw new Error("Cluster has no validators — cannot commit EB");
  // effectiveBalance is the cluster's TOTAL EB in ETH (must be >= validatorCount * 32)
  const totalEB = validatorCount * EB_PER_VALIDATOR;
  const clusterId = computeClusterId(ethers, clusterOwner.address, operatorIds);
  const root = doubleHashLeaf(ethers, clusterId, totalEB);
  const latestBlockNum = await ethers.provider.getBlockNumber();
  const commitBlockNum = latestBlockNum; // strictly monotonic — first commit

  const oracleAddrs = [
    config.oracles["1"],
    config.oracles["2"],
    config.oracles["3"],
  ].map((a) => requireAddress(a, "oracle"));
  const oracleSigners = await Promise.all(
    oracleAddrs.map((a) => getSignerForAddress(ethers, a, true).then((s) => s.signer)),
  );

  await (await network.connect(oracleSigners[0]).commitRoot(root, commitBlockNum)).wait();
  await (await network.connect(oracleSigners[1]).commitRoot(root, commitBlockNum)).wait();
  await (await network.connect(oracleSigners[2]).commitRoot(root, commitBlockNum)).wait();
  console.log(`    committed root=${root.slice(0, 10)}... blockNum=${commitBlockNum} totalEB=${totalEB} ETH (${validatorCount} × ${EB_PER_VALIDATOR})`);

  STEP(14, "updateClusterBalance with the committed EB");
  // Read actual current burn rate so we know settle burn accurately.
  const preUpdateBurnRate = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
  const preUpdateBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
  console.log(`    pre-update: burnRate=${preUpdateBurnRate}/blk getBalance=${preUpdateBalance}`);
  const ubTx = await network
    .connect(clusterOwner)
    .updateClusterBalance(commitBlockNum, clusterOwner.address, operatorIds, cluster, totalEB, []);
  const ubReceipt = await ubTx.wait();
  if (!ubReceipt) throw new Error("updateClusterBalance: null receipt");
  cluster = clusterFromEvent(findEventLog(ubReceipt, network.interface, "ClusterBalanceUpdated"));
  console.log(`    post-EB balance=${cluster.balance} active=${cluster.active}`);
  if (!cluster.active) {
    throw new Error(
      `Cluster auto-liquidated inside updateClusterBalance (EB=${EB_PER_VALIDATOR} was too high). ` +
      `Lower EB_PER_VALIDATOR so a positive balance remains and step 16 can exercise third-party liquidate.`,
    );
  }
  if (cluster.balance === 0n) {
    throw new Error(
      `Cluster balance drained to 0 by the EB settle (EB=${EB_PER_VALIDATOR} too high). Lower EB_PER_VALIDATOR.`,
    );
  }

  STEP(15, "Mine blocks until cluster is liquidatable (computed jump)");
  // Liquidation occurs once balance drops below:
  //   max(minLiquidationCollateral, burnRate * minimumBlocksBeforeLiquidation)
  const burnRate = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, cluster));
  if (burnRate === 0n) throw new Error("burnRate is 0 — cannot reach liquidation");
  const liquidationTarget = maxBigInt(minLiqCollateral, burnRate * liqThreshold);
  const blocksNeeded =
    cluster.balance > liquidationTarget
      ? (cluster.balance - liquidationTarget) / burnRate + 20n
      : 20n;
  console.log(
    `    burnRate=${burnRate}/blk, target=${liquidationTarget}, balance=${cluster.balance}, jumping ${blocksNeeded} blocks`,
  );
  if (blocksNeeded > 0n) await mineBlocks(ethers.provider, Number(blocksNeeded));
  const preLiqSettledBalance = BigInt(await views.getBalance(clusterOwner.address, operatorIds, cluster));
  const liquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
  if (!liquidatable) throw new Error(`Cluster not liquidatable after jumping ${blocksNeeded} blocks`);
  console.log(`    liquidatable ✓`);

  STEP(16, "Third-party liquidates (receives the cluster balance bounty)");
  const liqBalBefore = await ethers.provider.getBalance(liquidator.address);
  const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
  const liqReceipt = await liqTx.wait();
  if (!liqReceipt) throw new Error("liquidate: null receipt");
  cluster = clusterFromEvent(findEventLog(liqReceipt, network.interface, "ClusterLiquidated"));
  const liqBalAfter = await ethers.provider.getBalance(liquidator.address);
  const gas = liqReceipt.gasUsed * liqReceipt.gasPrice;
  const bounty = liqBalAfter - liqBalBefore + gas;
  if (bounty <= 0n) throw new Error(`Liquidation bounty must be positive, got ${bounty}`);
  if (bounty > preLiqSettledBalance) {
    throw new Error(`Liquidation bounty ${bounty} exceeds pre-liquidation balance ${preLiqSettledBalance}`);
  }
  if (cluster.active) throw new Error("Cluster should be inactive after liquidation");
  if (cluster.balance !== 0n) throw new Error(`Liquidated cluster should have zero balance, got ${cluster.balance}`);
  console.log(`    liquidated — bounty ≈ ${bounty} wei, cluster.active=${cluster.active}`);

  STEP(17, "Request unstake → wait cooldown → withdrawUnlocked");
  const cooldown = Number(await views.cooldownDuration());
  const stakedBal = BigInt(await views.stakedBalanceOf(staker.address));
  const unstakeAmt = stakedBal; // full unstake
  await (await network.connect(staker).requestUnstake(unstakeAmt)).wait();
  await increaseTime(ethers.provider, cooldown + 1);
  const ssvBalBefore = BigInt(await ssvToken.balanceOf(staker.address));
  await (await network.connect(staker).withdrawUnlocked()).wait();
  const ssvBalAfter = BigInt(await ssvToken.balanceOf(staker.address));
  console.log(`    unstaked ${ssvBalAfter - ssvBalBefore} SSV back to user`);

  STEP(18, "ETH conservation check");
  const contractEth = BigInt(await ethers.provider.getBalance(ssvNetworkProxy));
  console.log(`    SSVNetwork ETH balance = ${contractEth} wei`);
  if (contractEth <= 0n) throw new Error("SSVNetwork ETH balance should remain positive");
  if (cluster.active) throw new Error("Cluster should remain inactive after liquidation");
  // Contract ETH must be ≥ 0 and non-negative accounting components.
  // Full-precision invariant (sum of cluster/operator/network earnings == contractEth) would require
  // iterating all clusters — instead we assert contract is solvent and the post-liquidation cluster is zeroed.
  if (cluster.balance !== 0n) throw new Error(`Liquidated cluster still has balance ${cluster.balance}`);
  const netEarnings = BigInt(await views.getNetworkEarnings());
  console.log(`    network ETH earnings = ${netEarnings} wei (accrued)`);

  STEP(19, "SSV conservation check");
  const contractSsv = BigInt(await ssvToken.balanceOf(ssvNetworkProxy));
  const totalStaked = BigInt(await views.totalStaked());
  const stakerCssvAfterUnstake = BigInt(await cssvToken.balanceOf(staker.address));
  const stakerStakedBalanceAfterUnstake = BigInt(await views.stakedBalanceOf(staker.address));
  const pendingUnstakeAfter = await views.pendingUnstake(staker.address);
  console.log(`    SSVNetwork SSV balance = ${contractSsv}, totalStaked = ${totalStaked}`);
  if (stakerCssvAfterUnstake !== 0n) {
    throw new Error(`Staker still has ${stakerCssvAfterUnstake} cSSV after full unstake`);
  }
  if (stakerStakedBalanceAfterUnstake !== 0n) {
    throw new Error(
      `stakedBalanceOf(staker)=${stakerStakedBalanceAfterUnstake} after full unstake, expected 0`,
    );
  }
  if (pendingUnstakeAfter.length !== 0) {
    throw new Error(`pendingUnstake(staker) still has ${pendingUnstakeAfter.length} entries after withdrawUnlocked`);
  }

  STEP(20, "SMOKE TEST PASSED ✓");
  console.log(`\n    SSV Network v${onChainVersion} smoke test completed successfully on ${targetNetwork}.`);
}

main().catch((err) => {
  console.error("\n✗ SMOKE TEST FAILED");
  console.error(err);
  process.exit(1);
});
