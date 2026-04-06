// Regression test: cluster balance precision — spec formula vs. on-chain getBalance
//
// Walks through a minimal ETH cluster lifecycle step by step, logging every
// balance computation in detail, then demonstrates and explains the discrepancy
// that appears after an effective-balance (EB) update to a non-32-ETH value.

import { assert } from 'chai';
import { getTestConnection } from '../setup/connection.ts';
import { ssvNetworkFullFixture } from '../setup/fixtures.ts';
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
} from '../common/constants.ts';
import { Events } from '../common/events.ts';
import {
  computeClusterId,
  generateMerkleForClusterEB,
  commitEBRoot,
  setupOracles,
} from '../helpers/oracle.ts';
import { parseClusterFromEvent } from '../helpers/cluster.ts';
import { calcClusterBurn, calcVUnits } from '../helpers/fee.ts';
import { makeValKey, parseOperatorId } from './setup.ts';
import { makeOperatorKey } from '../common/helpers.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function registerOp(network: any, owner: any, index: number, fee: bigint): Promise<bigint> {
  const receipt = await (await network.connect(owner).registerOperator(
    makeOperatorKey(index),
    fee,
    false,
  )).wait();
  return parseOperatorId(receipt, network);
}

async function mine(provider: any, n: number): Promise<void> {
  await provider.send('hardhat_mine', ['0x' + n.toString(16)]);
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('Cluster balance: spec formula vs. on-chain getBalance', function () {
  this.timeout(120_000);

  it('exact match before EB update, then shows split-floor discrepancy after 33 ETH EB update', async function () {

    const { connection, networkHelpers } = await getTestConnection();
    const provider = connection.ethers.provider as any;

    async function deployFixture() { return ssvNetworkFullFixture(connection); }
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);

    const signers = await connection.ethers.getSigners();
    const deployer = signers[0];
    const owner    = signers[1];
    const oracle1  = signers[2];
    const oracle2  = signers[3];
    const oracle3  = signers[4];
    const staker   = signers[6];

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3]);

    const BPS        = BPS_DENOMINATOR;           // 10 000
    const ETH_DED    = ETH_DEDUCTED_DIGITS;       // 100 000
    const opFee      = MINIMAL_OPERATOR_ETH_FEE;  // unpacked wei per vUnit per block
    const packedOpFee = opFee / ETH_DED;
    const netFeeWei  = BigInt(await views.getNetworkFee());   // unpacked wei
    const packedNetFee = netFeeWei / ETH_DED;
    const NUM_OPS    = 4n;
    const burnRate   = NUM_OPS * opFee + netFeeWei;           // total wei per vUnit/block

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(  '║  CLUSTER BALANCE WALKTHROUGH — spec formula vs. getBalance  ║');
    console.log(  '╚══════════════════════════════════════════════════════════════╝');

    // ── Register 4 operators ─────────────────────────────────────────────────
    console.log('\n── Operator registration ──────────────────────────────────────');
    const opIds: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await registerOp(network, deployer, i + 1, opFee);
      opIds.push(id);
      console.log(`  op${i + 1} (id=${id}): fee = ${opFee} wei  packed = ${packedOpFee}`);
    }
    console.log(`  Network fee : ${netFeeWei} wei  packed = ${packedNetFee}`);
    console.log(`  burnRate    : ${burnRate} wei per vUnit per block  (= 4×opFee + netFee)`);

    // ── Register cluster (1 validator, default 32 ETH EB) ────────────────────
    console.log('\n── Cluster registration ───────────────────────────────────────');
    const regReceipt = await (await network.connect(owner).registerValidator(
      makeValKey(1),
      opIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    )).wait();
    const regBlock   = BigInt(regReceipt.blockNumber);
    let   lastStruct = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);
    const clusterId  = computeClusterId(owner.address, opIds);
    const defaultVUnits = 1n * BPS;   // 1 validator × 10 000 (= 32 ETH default)

    console.log(`  Block       : ${regBlock}`);
    console.log(`  Validators  : 1  (default EB = 32 ETH)`);
    console.log(`  Initial balance: ${lastStruct.balance} wei`);
    console.log(`  vUnits      : ${defaultVUnits}  (validatorCount × BPS = 1 × ${BPS})`);
    console.log(`  fee/block   : burnRate × vUnits / BPS = ${burnRate} × ${defaultVUnits} / ${BPS} = ${burnRate * defaultVUnits / BPS} wei`);

    // Helper: format a struct for getBalance calls
    const toStructArg = (s: any) => ({
      validatorCount:  s.validatorCount,
      networkFeeIndex: s.networkFeeIndex,
      index:           s.index,
      active:          s.active,
      balance:         s.balance,
    });

    // Helper: compute TS expected balance from lastStruct (spec formula — exact integer)
    const specBalance = (struct: any, blockDiff: bigint, vUnits: bigint): bigint => {
      const feesPerBlock = burnRate * vUnits / BPS;  // exact (ETH_DED/BPS = 10, no remainder)
      return BigInt(struct.balance) - blockDiff * feesPerBlock;
    };

    // Helper: compute fees using the contract's split-floor formula (mirrors updateBalanceWithEB)
    const contractFees = (blockDiff: bigint, vUnits: bigint): bigint =>
      calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPS,
        ethFee:       packedOpFee,   // PACKED (contract index units)
        networkFee:   packedNetFee,  // PACKED
        effectiveVUnits: vUnits,
      });

    // ── Mine 10 blocks, check balance ─────────────────────────────────────────
    console.log('\n── Progress 10 blocks (vUnits = 10 000, default 32 ETH) ───────');
    await mine(provider, 10);
    {
      const cur = BigInt(await provider.getBlockNumber());
      const bd  = cur - regBlock;
      const tsBalance  = specBalance(lastStruct, bd, defaultVUnits);
      const onChain    = BigInt(await views.getBalance(owner.address, opIds, toStructArg(lastStruct)));
      console.log(`  Block       : ${cur}  (blockDiff = ${bd} from reg block ${regBlock})`);
      console.log(`  TS spec     : ${lastStruct.balance} − ${bd} × ${burnRate} × ${defaultVUnits} / ${BPS}`);
      console.log(`              = ${lastStruct.balance} − ${bd * burnRate * defaultVUnits / BPS} = ${tsBalance}`);
      console.log(`  getBalance  : ${onChain}`);
      console.log(`  Match       : ${tsBalance === onChain ? '✓ EXACT (vUnits = BPS → no floor loss)' : `✗ DIFF = ${tsBalance - onChain}`}`);
      assert.equal(onChain, tsBalance, 'balance should match spec exactly at default vUnits');
    }

    // ── Commit Merkle root for 33 ETH EB ─────────────────────────────────────
    console.log('\n── Commit Merkle root: cluster EB = 33 ETH ────────────────────');
    const ebBlockNum = Number(await provider.getBlockNumber());
    const { root, proofs } = generateMerkleForClusterEB(
      { ethers: connection.ethers },
      [{ clusterId, effectiveBalance: 33 }],
    );
    await commitEBRoot(network, root, ebBlockNum, [oracle1, oracle2, oracle3]);
    {
      const cur = BigInt(await provider.getBlockNumber());
      const bd  = cur - regBlock;
      const tsBalance  = specBalance(lastStruct, bd, defaultVUnits);
      const onChain    = BigInt(await views.getBalance(owner.address, opIds, toStructArg(lastStruct)));
      console.log(`  Snapshot block : ${ebBlockNum}`);
      console.log(`  Effective balance in proof : 33 ETH`);
      console.log(`  vUnits after update : ${calcVUnits(33n)}  (ceil(33 × ${BPS} / 32) = ceil(10312.5) = 10313)`);
      console.log(`  Current block : ${cur}  (blockDiff = ${bd})`);
      console.log(`  TS spec     : ${lastStruct.balance} − ${bd} × ${burnRate * defaultVUnits / BPS} = ${tsBalance}`);
      console.log(`  getBalance  : ${onChain}  (vUnits still ${defaultVUnits} until updateClusterBalance)`);
      console.log(`  Match       : ${tsBalance === onChain ? '✓ EXACT' : `✗ DIFF = ${tsBalance - onChain}`}`);
      assert.equal(onChain, tsBalance, 'balance should match at time of root commit');
    }

    // ── Mine 10 blocks (root committed, no updateClusterBalance yet) ──────────
    console.log('\n── Progress 10 blocks (root committed, EB not applied yet) ────');
    await mine(provider, 10);
    {
      const cur = BigInt(await provider.getBlockNumber());
      const bd  = cur - regBlock;
      const tsBalance  = specBalance(lastStruct, bd, defaultVUnits);
      const onChain    = BigInt(await views.getBalance(owner.address, opIds, toStructArg(lastStruct)));
      console.log(`  Block       : ${cur}  (blockDiff = ${bd})`);
      console.log(`  TS spec     : ${lastStruct.balance} − ${bd} × ${burnRate * defaultVUnits / BPS} = ${tsBalance}`);
      console.log(`  getBalance  : ${onChain}  (vUnits still ${defaultVUnits} until updateClusterBalance)`);
      console.log(`  Match       : ${tsBalance === onChain ? '✓ EXACT' : `✗ DIFF = ${tsBalance - onChain}`}`);
      assert.equal(onChain, tsBalance, 'balance should match before EB update is applied');
    }

    // ── updateClusterBalance (applies 33 ETH EB on-chain) ────────────────────
    console.log('\n── updateClusterBalance: apply 33 ETH EB ──────────────────────');
    const ebReceipt = await (await network.connect(owner).updateClusterBalance(
      ebBlockNum,
      owner.address,
      opIds,
      toStructArg(lastStruct),
      33,
      proofs[clusterId],
    )).wait();
    const ebBlock = BigInt(ebReceipt.blockNumber);
    lastStruct = parseClusterFromEvent(network, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
    const newVUnits = calcVUnits(33n);  // 10313

    {
      const cur = ebBlock;
      const bd  = cur - ebBlock;  // 0 — same block as the TX
      const tsBalance  = specBalance(lastStruct, bd, newVUnits);
      const onChain    = BigInt(await views.getBalance(owner.address, opIds, toStructArg(lastStruct)));
      console.log(`  TX block    : ${ebBlock}`);
      console.log(`  New cluster.balance (from event): ${lastStruct.balance}`);
      console.log(`  vUnits now  : ${newVUnits}  (ceil(33 × ${BPS} / 32) = 10313)`);
      console.log(`  New fee/block : burnRate × vUnits / BPS = ${burnRate} × ${newVUnits} / ${BPS} = ${burnRate * newVUnits / BPS} wei`);
      console.log(`  TS spec     : ${lastStruct.balance} − 0 × ${burnRate * newVUnits / BPS} = ${tsBalance}`);
      console.log(`  getBalance  : ${onChain}`);
      console.log(`  Match       : ${tsBalance === onChain ? '✓ EXACT' : `✗ DIFF = ${tsBalance - onChain}`}`);
    }

    // ── Mine 10 blocks with new vUnits ────────────────────────────────────────
    console.log('\n── Progress 10 blocks (vUnits = 10 313, 33 ETH EB active) ─────');
    await mine(provider, 10);
    const finalBlock = BigInt(await provider.getBlockNumber());
    const finalBD    = finalBlock - ebBlock;

    // Spec formula (exact, no floor)
    const specFeePerBlock  = burnRate * newVUnits / BPS;  // exact
    const specTotalFees    = finalBD * specFeePerBlock;
    const specExpected     = BigInt(lastStruct.balance) - specTotalFees;

    // Contract formula (split-floor, mirrors updateBalanceWithEB)
    const conFees          = contractFees(finalBD, newVUnits);
    const conExpected      = BigInt(lastStruct.balance) - conFees;

    // On-chain value
    const onChainFinal     = BigInt(await views.getBalance(owner.address, opIds, toStructArg(lastStruct)));

    // Decompose the split-floor to show exactly why they differ
    const idxOp   = finalBD * NUM_OPS * packedOpFee;
    const idxNet  = finalBD * packedNetFee;
    const remOp   = (idxOp  * newVUnits) % BPS;
    const remNet  = (idxNet * newVUnits) % BPS;
    const discrepancy = specExpected < onChainFinal
      ? onChainFinal - specExpected
      : specExpected - onChainFinal;
    const direction = specExpected < onChainFinal ? 'contract > spec' : 'spec > contract';

    console.log(`  Block       : ${finalBlock}  (blockDiff = ${finalBD} from ebBlock ${ebBlock})`);
    console.log('');
    console.log('  ── SPEC FORMULA (blockDiff × burnRate × vUnits / BPS, exact integer) ──');
    console.log(`     fee/block = ${burnRate} × ${newVUnits} / ${BPS} = ${specFeePerBlock} wei`);
    console.log(`     total fees = ${finalBD} × ${specFeePerBlock} = ${specTotalFees} wei`);
    console.log(`     expected  = ${lastStruct.balance} − ${specTotalFees} = ${specExpected}`);
    console.log('');
    console.log('  ── CONTRACT FORMULA (updateBalanceWithEB split-floor) ────────');
    console.log(`     idxOp  = blockDiff × numOps × packedOpFee = ${finalBD} × ${NUM_OPS} × ${packedOpFee} = ${idxOp}`);
    console.log(`     idxNet = blockDiff × packedNetFee         = ${finalBD} × ${packedNetFee} = ${idxNet}`);
    console.log(`     opUnits  = floor(${idxOp} × ${newVUnits} / ${BPS}) = ${idxOp * newVUnits / BPS}  rem ${remOp}`);
    console.log(`     netUnits = floor(${idxNet} × ${newVUnits} / ${BPS}) = ${idxNet * newVUnits / BPS}  rem ${remNet}`);
    console.log(`     fees     = (${idxOp * newVUnits / BPS} + ${idxNet * newVUnits / BPS}) × ${ETH_DED} = ${conFees} wei`);
    console.log(`     expected = ${lastStruct.balance} − ${conFees} = ${conExpected}`);
    console.log('');
    console.log(`  ── RESULT ────────────────────────────────────────────────────`);
    console.log(`     getBalance (on-chain) : ${onChainFinal}`);
    console.log(`     spec formula          : ${specExpected}`);
    console.log(`     discrepancy           : ${discrepancy} wei  (${direction})`);
    console.log('');
    console.log('  ── WHY? ──────────────────────────────────────────────────────');
    console.log(`     With vUnits = ${newVUnits} (≠ BPS = ${BPS}), the floor in the contract's`);
    console.log(`     updateBalanceWithEB loses fractional packed units separately for`);
    console.log(`     operators and network:`);
    console.log(`       op  remainder : ${idxOp} × ${newVUnits} mod ${BPS} = ${remOp}`);
    console.log(`       net remainder : ${idxNet} × ${newVUnits} mod ${BPS} = ${remNet}`);
    console.log(`       total lost    : (${remOp} + ${remNet}) × (ETH_DED/BPS) = (${remOp} + ${remNet}) × 10 = ${(remOp + remNet) * 10n} wei`);
    console.log(`     The spec formula (ETH_DED/BPS = 10, exact integer) has no floor.`);
    console.log(`     Theoretical max per call: 2 × (BPS−1) × 10 = 199 980 wei.`);
    console.log(`     The floor always rounds DOWN → contract always charges LESS than spec.`);
    console.log(`     Each call resets the snapshot so the error COMPOUNDS — actual magnitude`);
    console.log(`     per call depends on (blockDiff × packedFee × vUnits) % BPS remainders,`);
    console.log(`     which vary by fee values. Proven by the 100-call test below.`);
    console.log(`     With vUnits = BPS (32 ETH default), vUnits/BPS = 1 exactly → no floor → exact match.`);
    console.log('');

    // Assert: on-chain matches the contract (split-floor) formula
    assert.equal(onChainFinal, conExpected,
      'getBalance must match the split-floor contract formula exactly');

    // Assert: discrepancy is within the theoretical maximum
    const maxDiff = (BPS - 1n) * 2n * 10n; // 199 980 wei
    assert.isTrue(discrepancy <= maxDiff,
      `discrepancy ${discrepancy} exceeds theoretical max ${maxDiff}`);

    // Confirm: with default vUnits (32 ETH), there would be zero discrepancy
    const remOpDefault  = (finalBD * NUM_OPS * packedOpFee * BPS) % BPS;
    const remNetDefault = (finalBD * packedNetFee            * BPS) % BPS;
    assert.equal(remOpDefault,  0n, 'with vUnits=BPS: op remainder must be 0');
    assert.equal(remNetDefault, 0n, 'with vUnits=BPS: net remainder must be 0');
    console.log(`  ✓ Confirmed: with vUnits = BPS (32 ETH), both remainders = 0 → exact match.`);
    console.log(`  ✗ With vUnits = ${newVUnits} (33 ETH), discrepancy = ${discrepancy} wei.`);
    console.log('');
  });

  it('cumulative discrepancy compounds over 100 updateClusterBalance calls', async function () {
    const { connection, networkHelpers } = await getTestConnection();
    const provider = connection.ethers.provider as any;

    async function deployFixture() { return ssvNetworkFullFixture(connection); }
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);

    const signers  = await connection.ethers.getSigners();
    const deployer = signers[0];
    const owner    = signers[1];
    const oracle1  = signers[2];
    const oracle2  = signers[3];
    const oracle3  = signers[4];
    const staker   = signers[6];

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3]);

    const BPS          = BPS_DENOMINATOR;
    const ETH_DED      = ETH_DEDUCTED_DIGITS;
    const opFee        = MINIMAL_OPERATOR_ETH_FEE;
    const netFeeWei    = BigInt(await views.getNetworkFee());
    const NUM_OPS      = 4n;
    const burnRate     = NUM_OPS * opFee + netFeeWei;

    const toStruct = (s: any) => ({
      validatorCount:  s.validatorCount,
      networkFeeIndex: s.networkFeeIndex,
      index:           s.index,
      active:          s.active,
      balance:         s.balance,
    });

    // Register 4 operators + cluster
    const opIds: bigint[] = [];
    for (let i = 0; i < 4; i++) opIds.push(await registerOp(network, deployer, i + 1, opFee));

    const regReceipt = await (await network.connect(owner).registerValidator(
      makeValKey(1), opIds, DEFAULT_SHARES, EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    )).wait();
    let lastStruct = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(owner.address, opIds);

    // Initial updateClusterBalance to establish 33 ETH EB (non-BPS vUnits)
    const snap0 = Number(await provider.getBlockNumber());
    const { root: r0, proofs: p0 } = generateMerkleForClusterEB(
      { ethers: connection.ethers }, [{ clusterId, effectiveBalance: 33 }],
    );
    await commitEBRoot(network, r0, snap0, [oracle1, oracle2, oracle3]);
    const init = (await (await network.connect(owner).updateClusterBalance(
      snap0, owner.address, opIds, toStruct(lastStruct), 33, p0[clusterId],
    )).wait())!;
    lastStruct = parseClusterFromEvent(network, init, Events.CLUSTER_BALANCE_UPDATED);
    let lastBlock       = BigInt(init.blockNumber);
    const initialBalance = BigInt(lastStruct.balance);
    const newVUnits      = calcVUnits(33n);  // 10313
    let   totalSpecFees  = 0n;

    // Compute actual per-call remainder to show in header
    const packedOpFee2  = opFee / ETH_DED;
    const packedNetFee2 = netFeeWei / ETH_DED;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(  '║  CUMULATIVE DISCREPANCY — 100 updateClusterBalance calls  ║');
    console.log(  '╚════════════════════════════════════════════════════════════╝');
    console.log(`  vUnits = ${newVUnits} (33 ETH EB)   initialBalance = ${initialBalance} wei`);
    console.log(`  packedOpFee = ${packedOpFee2}   packedNetFee = ${packedNetFee2}`);
    console.log(`  Theoretical max per call: 2 × (BPS−1) × 10 = 199 980 wei`);
    console.log(`  Actual per call depends on (blockDiff × packedFee × vUnits) % BPS — shown below`);
    console.log(`\n  ${'Round'.padEnd(7)} ${'Contract balance'.padEnd(24)} ${'Spec balance'.padEnd(24)} ${'Cumul. diff (wei)'}`);
    console.log(`  ${'─'.repeat(80)}`);

    for (let round = 1; round <= 100; round++) {
      await mine(provider, 10);
      const snapBlock = Number(await provider.getBlockNumber());

      const { root, proofs } = generateMerkleForClusterEB(
        { ethers: connection.ethers }, [{ clusterId, effectiveBalance: 33 }],
      );
      await commitEBRoot(network, root, snapBlock, [oracle1, oracle2, oracle3]);

      const receipt = (await (await network.connect(owner).updateClusterBalance(
        snapBlock, owner.address, opIds, toStruct(lastStruct), 33, proofs[clusterId],
      )).wait())!;

      const updateBlock = BigInt(receipt.blockNumber);
      totalSpecFees += (updateBlock - lastBlock) * burnRate * newVUnits / BPS;
      lastStruct = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
      lastBlock  = updateBlock;

      if (round % 10 === 0) {
        const contractBal = BigInt(lastStruct.balance);
        const specBal     = initialBalance - totalSpecFees;
        const diff        = contractBal - specBal;
        console.log(`  ${String(round).padEnd(7)} ${String(contractBal).padEnd(24)} ${String(specBal).padEnd(24)} ${diff}`);
      }
    }

    const contractFinal = BigInt(lastStruct.balance);
    const specFinal     = initialBalance - totalSpecFees;
    const totalDiff     = contractFinal - specFinal;
    const maxTotal      = 100n * (BPS - 1n) * 2n * 10n;  // 19 998 000 wei

    const perCallActual = totalDiff / 100n;

    console.log(`  ${'─'.repeat(80)}`);
    console.log(`  Total discrepancy after 100 calls : ${totalDiff} wei`);
    console.log(`  Average per call                  : ~${perCallActual} wei`);
    console.log(`  Theoretical max (100 × 199 980)   : ${maxTotal} wei`);
    console.log(`  Note: actual << theoretical max because with these specific fee values,`);
    console.log(`        (blockDiff × packedFee × ${newVUnits}) % ${BPS} produces small remainders.`);
    console.log(`        The bug is real and compounds — magnitude depends on fee params and call frequency.`);
    console.log('');

    assert.isTrue(totalDiff > 0n,
      'contract should retain more balance than spec predicts (split-floor undercharges fees)');
    assert.isTrue(totalDiff <= maxTotal,
      `cumulative discrepancy ${totalDiff} exceeds theoretical max ${maxTotal}`);
  });
});
