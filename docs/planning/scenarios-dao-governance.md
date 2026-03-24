# Scenarios — DAO Governance (DA-001 to DA-050)

**Worker:** W2-D (DAO Governance)
**Scope:** All SSVDAO functions EXCEPT `commitRoot` (owned by W1-H). Plus SSVNetwork proxy functions `setFeeRecipientAddress` and `updateModule`.
**Source contracts:** `contracts/modules/SSVDAO.sol`, `contracts/libraries/ProtocolLib.sol`, `contracts/SSVNetwork.sol`
**Spec references:** SPEC.md §12, FLOWS.md §6

---

## Scenario Table

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| DA-001 | updateNetworkFee | Set ETH network fee from 0 to non-zero; verify fee index snapshot, DAO earnings settlement, and `NetworkFeeUpdated` event | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:29-35, ProtocolLib.sol:40-46 |
| DA-002 | updateNetworkFee | Increase ETH network fee with active clusters; verify old fee accrual settled, new fee applies from next block, no double-counting | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:29-35, ProtocolLib.sol:40-46, ProtocolLib.sol:65-68 |
| DA-003 | updateNetworkFee | Decrease ETH network fee; verify DAO earnings settled at old rate, fee index updated, event emits old and new fees | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:29-35 |
| DA-004 | updateNetworkFee | Set ETH network fee to 0; verify accrual stops, event emits (oldFee, 0) | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:29-35 |
| DA-005 | updateNetworkFee | Non-owner calls updateNetworkFee; verify revert with Ownable error | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:29 (delegatecall via onlyOwner proxy) |
| DA-006 | updateNetworkFeeSSV | Set SSV network fee from 0 to non-zero; verify SSV fee index snapshot, SSV DAO earnings settlement, and `NetworkFeeUpdatedSSV` event | `entry:updateNetworkFeeSSV; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:40-46, ProtocolLib.sol:53-58 |
| DA-007 | updateNetworkFeeSSV | Increase SSV network fee with active SSV clusters; verify old fee settled, new fee forward-only | `entry:updateNetworkFeeSSV; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:40-46, ProtocolLib.sol:53-58, ProtocolLib.sol:74-77 |
| DA-008 | updateNetworkFeeSSV | Non-owner calls updateNetworkFeeSSV; verify revert | `entry:updateNetworkFeeSSV; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:40 |
| DA-009 | withdrawNetworkSSVEarnings | Withdraw partial SSV network earnings; verify daoBalance reduced, token transfer, `NetworkEarningsWithdrawn` event | `entry:withdrawNetworkSSVEarnings; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:51-68 |
| DA-010 | withdrawNetworkSSVEarnings | Withdraw all available SSV network earnings; verify daoBalance becomes 0, daoIndexBlockNumber updated | `entry:withdrawNetworkSSVEarnings; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:51-68, ProtocolLib.sol:97-99 |
| DA-011 | withdrawNetworkSSVEarnings | Withdraw more than available SSV earnings; verify revert with `InsufficientBalance` | `entry:withdrawNetworkSSVEarnings; version:ssv; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:58-60 |
| DA-012 | withdrawNetworkSSVEarnings | Non-owner calls withdrawNetworkSSVEarnings; verify revert | `entry:withdrawNetworkSSVEarnings; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:51 |
| DA-013 | withdrawNetworkSSVEarnings | Withdraw when no earnings (zero balance, no clusters); verify revert with `InsufficientBalance` for any amount > 0 | `entry:withdrawNetworkSSVEarnings; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:56-60 |
| DA-014 | updateOperatorFeeIncreaseLimit | Set operator fee increase limit to valid BPS value (e.g. 1000 = 10%); verify storage updated, `OperatorFeeIncreaseLimitUpdated` event | `entry:updateOperatorFeeIncreaseLimit; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:73-79 |
| DA-015 | updateOperatorFeeIncreaseLimit | Set operator fee increase limit to 0; verify allowed (0% increase = freeze), event emitted | `entry:updateOperatorFeeIncreaseLimit; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:73-79 |
| DA-016 | updateOperatorFeeIncreaseLimit | Set operator fee increase limit to BPS_DENOMINATOR (10000 = 100%); verify allowed (boundary), event emitted | `entry:updateOperatorFeeIncreaseLimit; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:73-79 |
| DA-017 | updateOperatorFeeIncreaseLimit | Set operator fee increase limit above BPS_DENOMINATOR (10001); verify revert with `InvalidOperatorFeeIncreaseLimit` | `entry:updateOperatorFeeIncreaseLimit; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:74-76 |
| DA-018 | updateOperatorFeeIncreaseLimit | Non-owner calls updateOperatorFeeIncreaseLimit; verify revert | `entry:updateOperatorFeeIncreaseLimit; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:73 |
| DA-019 | updateDeclareOperatorFeePeriod | Set declare period to valid value; verify storage updated, `DeclareOperatorFeePeriodUpdated` event | `entry:updateDeclareOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:85-87 |
| DA-020 | updateDeclareOperatorFeePeriod | Set declare period to 0; verify allowed, event emitted | `entry:updateDeclareOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:85-87 |
| DA-021 | updateDeclareOperatorFeePeriod | Non-owner calls updateDeclareOperatorFeePeriod; verify revert | `entry:updateDeclareOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:85 |
| DA-022 | updateExecuteOperatorFeePeriod | Set execute period to valid value; verify storage updated, `ExecuteOperatorFeePeriodUpdated` event | `entry:updateExecuteOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:91-96 |
| DA-023 | updateExecuteOperatorFeePeriod | Set execute period to 0; verify allowed, event emitted | `entry:updateExecuteOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:91-96 |
| DA-024 | updateExecuteOperatorFeePeriod | Non-owner calls updateExecuteOperatorFeePeriod; verify revert | `entry:updateExecuteOperatorFeePeriod; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:91 |
| DA-025 | updateLiquidationThresholdPeriod | Set ETH liquidation threshold to exactly MINIMAL_LIQUIDATION_THRESHOLD (21480); verify storage updated, `LiquidationThresholdPeriodUpdated` event | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:101-108 |
| DA-026 | updateLiquidationThresholdPeriod | Set ETH liquidation threshold above minimum (e.g. 50190); verify accepted, event emitted | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:101-108 |
| DA-027 | updateLiquidationThresholdPeriod | Set ETH liquidation threshold below minimum (21479); verify revert with `NewBlockPeriodIsBelowMinimum` | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:102-104 |
| DA-028 | updateLiquidationThresholdPeriod | Set ETH liquidation threshold to 0; verify revert with `NewBlockPeriodIsBelowMinimum` | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:102-104 |
| DA-029 | updateLiquidationThresholdPeriod | Non-owner calls updateLiquidationThresholdPeriod; verify revert | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:101 |
| DA-030 | updateLiquidationThresholdPeriodSSV | Set SSV liquidation threshold to exactly 21480; verify storage updated, `LiquidationThresholdPeriodSSVUpdated` event | `entry:updateLiquidationThresholdPeriodSSV; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:113-120 |
| DA-031 | updateLiquidationThresholdPeriodSSV | Set SSV liquidation threshold below minimum (21479); verify revert with `NewBlockPeriodIsBelowMinimum` | `entry:updateLiquidationThresholdPeriodSSV; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:114-116 |
| DA-032 | updateMinimumLiquidationCollateral | Set ETH minimum liquidation collateral to non-zero; verify packed storage, `MinimumLiquidationCollateralUpdated` event | `entry:updateMinimumLiquidationCollateral; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:125-128 |
| DA-033 | updateMinimumLiquidationCollateral | Set ETH minimum liquidation collateral to 0; verify allowed, event emitted | `entry:updateMinimumLiquidationCollateral; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:125-128 |
| DA-034 | updateMinimumLiquidationCollateralSSV | Set SSV minimum liquidation collateral to non-zero; verify packed storage, `MinimumLiquidationCollateralSSVUpdated` event | `entry:updateMinimumLiquidationCollateralSSV; version:ssv; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:133-136 |
| DA-035 | updateMaximumOperatorFee | Set max operator fee above current min fee; verify packed storage, `OperatorMaximumFeeUpdated` event | `entry:updateMaximumOperatorFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:141-149 |
| DA-036 | updateMaximumOperatorFee | Set max operator fee below current minimum operator ETH fee; verify revert with `InvalidOperatorFeeRange` | `entry:updateMaximumOperatorFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:143-145 |
| DA-037 | updateMaximumOperatorFee | Set max operator fee equal to current minimum; verify accepted (boundary), event emitted | `entry:updateMaximumOperatorFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:141-149 |
| DA-038 | updateMinimumOperatorEthFee | Set min operator ETH fee below current max; verify packed storage, `MinimumOperatorEthFeeUpdated` event | `entry:updateMinimumOperatorEthFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:155-163 |
| DA-039 | updateMinimumOperatorEthFee | Set min operator ETH fee above current max; verify revert with `InvalidOperatorFeeRange` | `entry:updateMinimumOperatorEthFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:157-159 |
| DA-040 | updateMinimumOperatorEthFee | Set min operator ETH fee equal to current max; verify accepted (boundary), event emitted | `entry:updateMinimumOperatorEthFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:155-163 |
| DA-041 | replaceOracle | Replace existing oracle with new valid address; verify `OracleReplaced` event, old oracle cleared from `oracleIdOf`, new oracle mapped | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:226-249 |
| DA-042 | replaceOracle | Replace oracle with zero address; verify revert with `ZeroAddress` | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:229 |
| DA-043 | replaceOracle | Replace oracle with oracleId = 0; verify revert with `InvalidOracleId` | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:228 |
| DA-044 | replaceOracle | Replace oracle with oracleId > MAX_DELEGATION_SLOTS (5); verify revert with `InvalidOracleId` | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:228 |
| DA-045 | replaceOracle | Replace oracle with address already assigned to different oracleId; verify revert with `OracleAlreadyAssigned` | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:242-243 |
| DA-046 | replaceOracle | Replace oracle with same address as current; verify revert with `SameOracleAddressNotAllowed` | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:232-234 |
| DA-047 | updateQuorumBps | Set quorum to valid mid-range value (e.g. 5000 = 50%); verify storage updated, `QuorumUpdated` event | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:254-260 |
| DA-048 | updateQuorumBps | Set quorum to 0; verify revert with `InvalidQuorum` (SEC-20 fix) | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:255-257 |
| DA-049 | updateQuorumBps | Set quorum to BPS_DENOMINATOR (10000 = 100%); verify accepted (boundary), event emitted | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:254-260 |
| DA-050 | updateQuorumBps | Set quorum above BPS_DENOMINATOR (10001); verify revert with `InvalidQuorum` | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:255-257 |
| DA-051 | updateQuorumBps | Set quorum to 1 (minimum valid BPS); verify accepted, event emitted | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:254-260 |
| DA-052 | updateUnstakeCooldownDuration | Set cooldown to valid duration (e.g. 604800 = 7 days); verify storage updated, `CooldownDurationUpdated` event | `entry:updateUnstakeCooldownDuration; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:265-268 |
| DA-053 | updateUnstakeCooldownDuration | Set cooldown to 0; verify allowed (instant unstake), event emitted | `entry:updateUnstakeCooldownDuration; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:265-268 |
| DA-054 | updateUnstakeCooldownDuration | Non-owner calls updateUnstakeCooldownDuration; verify revert | `entry:updateUnstakeCooldownDuration; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:265 |
| DA-055 | updateMinBlocksBetweenUpdates | Set min blocks between updates to valid value (e.g. 100); verify storage updated, `MinBlocksBetweenUpdatesUpdated` event | `entry:updateMinBlocksBetweenUpdates; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:273-276 |
| DA-056 | updateMinBlocksBetweenUpdates | Set min blocks between updates to 0; verify allowed (no interval restriction), event emitted | `entry:updateMinBlocksBetweenUpdates; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:273-276 |
| DA-057 | updateMinBlocksBetweenUpdates | Non-owner calls updateMinBlocksBetweenUpdates; verify revert | `entry:updateMinBlocksBetweenUpdates; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVDAO.sol:273 |
| DA-058 | setFeeRecipientAddress | Any caller sets fee recipient to valid address; verify `FeeRecipientAddressUpdated(msg.sender, recipientAddress)` event (not owner-restricted) | `entry:setFeeRecipientAddress; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVNetwork.sol:197-199 |
| DA-059 | setFeeRecipientAddress | Set fee recipient to zero address; verify event emitted (no validation in contract) | `entry:setFeeRecipientAddress; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVNetwork.sol:197-199 |
| DA-060 | updateModule | Owner updates a module to valid contract address; verify `ModuleUpgraded` event, storage updated | `entry:updateModule; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVNetwork.sol:411-413, CoreLib.sol:89-94 |
| DA-061 | updateModule | Update module to EOA (non-contract) address; verify revert with `TargetModuleDoesNotExistWithData` | `entry:updateModule; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | CoreLib.sol:90 |
| DA-062 | updateModule | Non-owner calls updateModule; verify revert with Ownable error | `entry:updateModule; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:yes` | ☐ | SSVNetwork.sol:411 |
| DA-063 | updateNetworkFee + cluster ops | Change ETH network fee mid-cluster-operation: register validators → change fee → deposit → verify cluster balance uses old fee up to change block and new fee after | `entry:updateNetworkFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:29-35, ProtocolLib.sol:22-24, ProtocolLib.sol:40-46 |
| DA-064 | updateLiquidationThresholdPeriod + liquidation | Increase liquidation threshold retroactively makes existing cluster liquidatable; verify cluster that was solvent before parameter change becomes liquidatable after | `entry:updateLiquidationThresholdPeriod; version:eth; eb:explicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:101-108 |
| DA-065 | updateMinimumLiquidationCollateral + reactivate | Increase minimum collateral; verify existing liquidated cluster reactivation requires meeting new higher collateral | `entry:updateMinimumLiquidationCollateral; version:eth; eb:implicit; cluster:liquidated; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:125-128 |
| DA-066 | updateMaximumOperatorFee + declareOperatorFee | Lower max operator fee; verify existing operator cannot execute a previously declared fee that now exceeds the new maximum | `entry:updateMaximumOperatorFee; version:eth; eb:implicit; cluster:active; ops:4; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:141-149 |
| DA-067 | updateMinimumOperatorEthFee + registerOperator | Increase min operator ETH fee; verify new operator registration below new minimum fails with `FeeTooLow` | `entry:updateMinimumOperatorEthFee; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:155-163 |
| DA-068 | replaceOracle + commitRoot | Replace oracle then old oracle attempts `commitRoot`; verify old oracle reverts with `NotOracle`, new oracle succeeds | `entry:replaceOracle; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:226-249 |
| DA-069 | updateQuorumBps + commitRoot | Lower quorum BPS so previously-insufficient votes now reach quorum on next oracle vote; verify root commits | `entry:updateQuorumBps; version:both; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:254-260 |
| DA-070 | updateLiquidationThresholdPeriod | Set ETH liquidation threshold to max uint64; verify accepted, event emitted (extreme boundary) | `entry:updateLiquidationThresholdPeriod; version:eth; eb:implicit; cluster:none; ops:none; remove_mode:none; revert:no` | ☐ | SSVDAO.sol:101-108 |

---

## Detailed Scenario Blocks

### DA-002 — ETH Network Fee Increase With Active Clusters (Fee Index Settlement)

**Purpose:** Verify that when the DAO increases the ETH network fee, all earnings accrued under the old fee are properly settled in `ethDaoBalance` before the new fee takes effect. No double-counting or fee gap.

**Preconditions:**
1. Owner account deployed and configured
2. 4 operators registered with ETH fees
3. 1 cluster with 1 validator registered (active, implicit EB = 32 ETH baseline = 10000 vUnits)
4. ETH network fee set to `oldFee` (e.g. 3,550,929,823 wei/block)
5. Advance 100 blocks to accumulate DAO earnings

**Steps:**
1. Record `ethNetworkFeeIndex`, `ethDaoBalance`, `ethDaoIndexBlockNumber` before update
2. Call `updateNetworkFee(newFee)` where `newFee = oldFee * 2`
3. Record `ethNetworkFeeIndex`, `ethDaoBalance`, `ethDaoIndexBlockNumber` after update

**Expected:**
- `ethDaoBalance` after = `oldBalance + (currentBlock - oldDaoIndexBlockNumber) * oldFee * daoTotalEthVUnits / BPS_DENOMINATOR`
- `ethNetworkFeeIndex` after = `oldIndex + (currentBlock - oldFeeIndexBlockNumber) * oldFee`
- `ethNetworkFeeIndexBlockNumber` = `block.number` at time of call
- `ethDaoIndexBlockNumber` = `block.number` at time of call
- Event `NetworkFeeUpdated(unpack(oldFee), newFee)` emitted
- After 100 more blocks, DAO earnings accrue at `newFee` rate (no gap, no overlap)

**Invariants:**
- ETH conservation: contract balance >= sum of cluster balances + operator earnings + DAO earnings
- No double-counting: earnings at old rate stop exactly at update block

---

### DA-010 — Withdraw All Available SSV Network Earnings

**Purpose:** Verify that withdrawing the exact total of available SSV network earnings zeroes out the daoBalance and transfers tokens correctly.

**Preconditions:**
1. Owner account deployed
2. SSV network fee set to non-zero
3. At least 1 SSV cluster with validators active for sufficient blocks
4. Known `networkTotalEarningsSSV()` value (can be computed: `daoBalance + (block.number - daoIndexBlockNumber) * networkFee * daoValidatorCount`)

**Steps:**
1. Compute exact available earnings via view function or manual calculation
2. Call `withdrawNetworkSSVEarnings(exactAmount)` as owner
3. Verify SSV token balance of owner increased by `amount`
4. Verify `sp.daoBalance` is 0
5. Verify `sp.daoIndexBlockNumber` == `block.number`

**Expected:**
- SSV token transfer of `amount` to `msg.sender`
- `daoBalance` = `networkTotalEarningsSSV() - shrunkAmount` which is 0 (modulo packing precision)
- `daoIndexBlockNumber` = `block.number`
- Event `NetworkEarningsWithdrawn(amount, owner)`
- Subsequent call with any amount > 0 reverts with `InsufficientBalance`

**Invariants:**
- SSV conservation: tokens transferred out == reduction in DAO balance
- Reentrancy guard: `nonReentrant` modifier prevents re-entry during token transfer

---

### DA-017 — Operator Fee Increase Limit Above BPS_DENOMINATOR (Revert)

**Purpose:** Verify that setting the operator fee increase limit above 10000 BPS (100%) reverts.

**Preconditions:**
1. Owner account deployed
2. Current `operatorMaxFeeIncrease` set to any valid value

**Steps:**
1. Call `updateOperatorFeeIncreaseLimit(10001)` as owner
2. Call `updateOperatorFeeIncreaseLimit(type(uint64).max)` as owner

**Expected:**
- Both calls revert with `InvalidOperatorFeeIncreaseLimit()`
- Storage `operatorMaxFeeIncrease` unchanged
- No event emitted

**Edge cases:**
- Exactly 10000 should succeed (DA-016)
- 0 should succeed (DA-015 — freeze operator fees)

---

### DA-036 — Max Operator Fee Below Minimum (Revert Cross-Validation)

**Purpose:** Verify the cross-validation between `operatorMaxFee` and `minimumOperatorEthFee` prevents an invalid fee range where max < min.

**Preconditions:**
1. Owner account deployed
2. `minimumOperatorEthFee` = 1,065,200,000 (packed)
3. `operatorMaxFee` = 5,326,300,000 (packed)

**Steps:**
1. Call `updateMaximumOperatorFee(1_065_100_000)` — value below current min
2. Verify revert with `InvalidOperatorFeeRange()`
3. Call `updateMaximumOperatorFee(1_065_200_000)` — value equal to current min
4. Verify succeeds

**Expected:**
- Step 2: revert, no storage change, no event
- Step 4: storage `operatorMaxFee` = `pack(1_065_200_000)`, `OperatorMaximumFeeUpdated(1_065_200_000)` emitted
- Symmetric check: after step 4, calling `updateMinimumOperatorEthFee(1_065_300_000)` should revert (min > max)

**Note:** Values must be divisible by `ETH_DEDUCTED_DIGITS` (100,000) for `PackedETHLib.pack()`. Values not divisible will revert with `MaxPrecisionExceeded`.

---

### DA-045 — Replace Oracle With Address Already Assigned to Different ID

**Purpose:** Verify that assigning the same oracle address to two different oracle IDs is prevented by the `OracleAlreadyAssigned` guard.

**Preconditions:**
1. Owner account deployed
2. Oracle 1 = `addr_A`, Oracle 2 = `addr_B` (both registered via `initializeSSVStaking`)
3. `oracleIdOf[addr_A]` = 1, `oracleIdOf[addr_B]` = 2

**Steps:**
1. Call `replaceOracle(2, addr_A)` as owner — try to assign addr_A (already oracle 1) to oracle 2
2. Verify revert with `OracleAlreadyAssigned()`

**Expected:**
- Revert because `oracleIdOf[addr_A] == 1` and `1 != 2`
- No storage mutation
- No event emitted

**Edge case:**
- `replaceOracle(1, addr_A)` should revert with `SameOracleAddressNotAllowed` (same slot, same address)

---

### DA-048 — Quorum BPS Set to Zero (SEC-20 Fix Verification)

**Purpose:** Verify the SEC-20 fix: setting quorum to 0 is rejected. A zero quorum would make `threshold = 0`, allowing any single oracle vote to commit a root (or even commit with zero votes), bypassing the intended quorum mechanism.

**Preconditions:**
1. Owner account deployed
2. Current `quorumBps` set to valid value (e.g. 7500)

**Steps:**
1. Call `updateQuorumBps(0)` as owner
2. Verify revert with `InvalidQuorum()`

**Expected:**
- Revert
- `quorumBps` remains at 7500
- No `QuorumUpdated` event

**Security context:** Without this check, `threshold = (frozenVotingSupply * 0) / 10000 = 0`, so `accumulatedWeight >= 0` would always be true, meaning a single oracle vote with any weight commits the root. This bypasses the entire quorum mechanism.

---

### DA-063 — Network Fee Change Mid-Cluster-Operation (Fee Index Continuity)

**Purpose:** Verify that changing the ETH network fee during the life of an active cluster produces correct fee accrual — old fee applies up to the change block, new fee applies after. The fee index is monotonically increasing and the cluster's `networkFeeIndex` snapshot captures the correct accumulated value.

**Preconditions:**
1. Owner account with 4 operators registered
2. Cluster registered at block B0 with 1 validator, network fee index = I0
3. Network fee = F1 (e.g. 3,550,929,823 wei/block)
4. Advance 100 blocks to block B1

**Steps:**
1. At block B1: call `updateNetworkFee(F2)` where F2 = F1 * 3
2. Verify `ethNetworkFeeIndex` = I0 + (B1 - B0) * F1
3. Advance 50 blocks to block B2
4. At block B2: call `deposit()` to the cluster (triggers fee settlement)
5. Verify cluster's network fee deduction = `(currentFeeIndex - cluster.networkFeeIndex) * vUnits / BPS_DENOMINATOR`

**Expected:**
- At B2: `currentNetworkFeeIndex = I1 + (B2 - B1) * F2` where `I1 = I0 + (B1 - B0) * F1`
- Cluster fee deduction covers both periods correctly
- DAO earnings: phase 1 at F1, phase 2 at F2
- No gap block (fee index is continuous at B1)
- No double-counted block

**Invariants:**
- ETH conservation holds
- `ethNetworkFeeIndex` is monotonically non-decreasing
- `ethNetworkFeeIndexBlockNumber` always equals the last update block

---

### DA-064 — Liquidation Threshold Increase Retroactively Affects Existing Clusters

**Purpose:** Verify that increasing the liquidation threshold period can make an existing cluster that was previously solvent become liquidatable, since the parameter change applies globally and retroactively.

**Preconditions:**
1. 4 operators registered, cluster registered with 1 validator
2. Cluster funded with balance sufficient for `minimumBlocksBeforeLiquidation = 21480` but insufficient for a higher threshold
3. `minimumBlocksBeforeLiquidation` currently set to 21480

**Steps:**
1. Verify cluster is NOT liquidatable with current threshold (21480)
2. Call `updateLiquidationThresholdPeriod(100000)` — increase to ~14 days
3. Verify cluster IS now liquidatable (balance no longer covers the longer runway)
4. Third-party calls `liquidate()` on the cluster — succeeds

**Expected:**
- Step 1: `isLiquidatable` returns false
- Step 3: `isLiquidatable` returns true (same cluster, same balance, different threshold)
- Step 4: liquidation succeeds, cluster marked liquidated
- This demonstrates that governance parameter changes have immediate retroactive effect on all existing clusters

**Security note:** DAO governance should consider existing cluster health before increasing liquidation thresholds. There is no grace period — the change is instant.

---

### DA-066 — Lower Max Operator Fee Blocks Pending Fee Execution

**Purpose:** Verify that lowering the maximum operator fee prevents an operator from executing a previously declared fee increase that now exceeds the new cap, even though the declaration was valid at the time.

**Preconditions:**
1. `operatorMaxFee` set to 5,326,300,000 (operatorMaxFee in storage)
2. Operator registered with fee = 1,000,000,000
3. Operator declares new fee = 5,000,000,000 (within old max)
4. Declaration period passes

**Steps:**
1. Call `updateMaximumOperatorFee(3,000,000,000)` as owner — lower max below declared fee
2. Operator calls `executeOperatorFee()` within execution window
3. Verify revert with `FeeTooHigh`

**Expected:**
- Fee declaration was valid when made (5B < 5.3B old max)
- After max lowered to 3B, the declared fee (5B) exceeds the new max
- `executeOperatorFee` checks `fee > operatorMaxFee` at execution time and reverts
- Operator must cancel and re-declare at or below the new max

**Note:** The `reduceOperatorFee` path does not check against max (only reduces), so the operator can still reduce fee.

---

### DA-068 — Replace Oracle Then Old Oracle Attempts commitRoot

**Purpose:** Verify the oracle replacement flow end-to-end: after replacing an oracle, the old address loses commitRoot privileges and the new address gains them.

**Preconditions:**
1. 4 oracles initialized: oracle 1 = `addr_old`, oracles 2-4 = other addresses
2. cSSV supply > 0 (for voting weight)
3. `quorumBps` = 7500 (3/4 needed)

**Steps:**
1. Call `replaceOracle(1, addr_new)` as owner
2. Verify event `OracleReplaced(1, addr_old, addr_new)`
3. `addr_old` calls `commitRoot(root, blockNum)` — verify revert with `NotOracle`
4. `addr_new` calls `commitRoot(root, blockNum)` — verify succeeds, emits `WeightedRootProposed`
5. Oracle 2 and 3 also vote — verify root commits at quorum

**Expected:**
- `oracleIdOf[addr_old]` = 0 after replacement
- `oracleIdOf[addr_new]` = 1 after replacement
- `oracles[1]` = `addr_new`
- Old oracle's previous votes on pending commitments remain counted (not revoked)
- New oracle can vote on new commitments with oracle ID 1

**Invariants:**
- Oracle set size unchanged (still 4)
- Outstanding votes for pending roots are not affected by oracle rotation

---

## Summary

- **Total scenarios:** 70 (DA-001 through DA-070)
- **Happy-path scenarios:** 38
- **Revert scenarios:** 22
- **Cross-function / integration scenarios:** 10 (DA-063 through DA-070, DA-051, DA-059)
- **Detailed blocks:** 10 (DA-002, DA-010, DA-017, DA-036, DA-045, DA-048, DA-063, DA-064, DA-066, DA-068)

### Coverage Matrix

| Function | Happy | Revert | Integration | Total |
|----------|-------|--------|-------------|-------|
| updateNetworkFee | 3 (DA-001/002/003) | 1 (DA-005) | 2 (DA-004, DA-063) | 6 |
| updateNetworkFeeSSV | 2 (DA-006/007) | 1 (DA-008) | — | 3 |
| withdrawNetworkSSVEarnings | 2 (DA-009/010) | 3 (DA-011/012/013) | — | 5 |
| updateOperatorFeeIncreaseLimit | 3 (DA-014/015/016) | 2 (DA-017/018) | — | 5 |
| updateDeclareOperatorFeePeriod | 2 (DA-019/020) | 1 (DA-021) | — | 3 |
| updateExecuteOperatorFeePeriod | 2 (DA-022/023) | 1 (DA-024) | — | 3 |
| updateLiquidationThresholdPeriod | 2 (DA-025/026) | 3 (DA-027/028/029) | 2 (DA-064, DA-070) | 7 |
| updateLiquidationThresholdPeriodSSV | 1 (DA-030) | 1 (DA-031) | — | 2 |
| updateMinimumLiquidationCollateral | 2 (DA-032/033) | — | 1 (DA-065) | 3 |
| updateMinimumLiquidationCollateralSSV | 1 (DA-034) | — | — | 1 |
| updateMaximumOperatorFee | 2 (DA-035/037) | 1 (DA-036) | 1 (DA-066) | 4 |
| updateMinimumOperatorEthFee | 2 (DA-038/040) | 1 (DA-039) | 1 (DA-067) | 4 |
| replaceOracle | 1 (DA-041) | 4 (DA-042/043/044/046) | 2 (DA-045, DA-068) | 7 |
| updateQuorumBps | 3 (DA-047/049/051) | 2 (DA-048/050) | 1 (DA-069) | 6 |
| updateUnstakeCooldownDuration | 2 (DA-052/053) | 1 (DA-054) | — | 3 |
| updateMinBlocksBetweenUpdates | 2 (DA-055/056) | 1 (DA-057) | — | 3 |
| setFeeRecipientAddress | 2 (DA-058/059) | — | — | 2 |
| updateModule | 1 (DA-060) | 2 (DA-061/062) | — | 3 |

---

## Audit Gaps (Added post-audit)

> Identified by code-level branch analysis. These scenarios cover branches and edge conditions not addressed by the original DA-001 through DA-070 set.

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| DA-071 | updateNetworkFee | Non-owner calls — revert with Ownable error. Explicit non-owner test. | `entry:updateNetworkFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:29 |
| DA-072 | updateNetworkFeeSSV | Non-owner calls — revert with Ownable error. | `entry:updateNetworkFeeSSV; version:ssv; revert:yes` | [ ] | SSVDAO.sol:40 |
| DA-073 | updateOperatorFeeIncreaseLimit | Non-owner calls — revert. (Duplicates DA-018 but ensures explicit coverage.) | `entry:updateOperatorFeeIncreaseLimit; revert:yes` | [ ] | SSVDAO.sol:73 |
| DA-074 | updateLiquidationThresholdPeriod | Non-owner calls — revert. (Duplicates DA-029 but ensures explicit coverage.) | `entry:updateLiquidationThresholdPeriod; revert:yes` | [ ] | SSVDAO.sol:101 |
| DA-075 | updateLiquidationThresholdPeriodSSV | Non-owner calls — revert. | `entry:updateLiquidationThresholdPeriodSSV; version:ssv; revert:yes` | [ ] | SSVDAO.sol:113 |
| DA-076 | updateMinimumLiquidationCollateral | Non-owner calls — revert. | `entry:updateMinimumLiquidationCollateral; version:eth; revert:yes` | [ ] | SSVDAO.sol:125 |
| DA-077 | updateMinimumLiquidationCollateralSSV | Non-owner calls — revert. | `entry:updateMinimumLiquidationCollateralSSV; version:ssv; revert:yes` | [ ] | SSVDAO.sol:133 |
| DA-078 | updateMaximumOperatorFee | Non-owner calls — revert. | `entry:updateMaximumOperatorFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:141 |
| DA-079 | updateNetworkFee | Fee precision: non-divisible value — revert `MaxPrecisionExceeded` from `pack()`. | `entry:updateNetworkFee; version:eth; revert:yes` | [ ] | ProtocolLib.sol:40-46, SSVPackedLib.sol |
| DA-080 | updateNetworkFeeSSV | Fee precision: non-divisible SSV fee value — revert from `pack()`. | `entry:updateNetworkFeeSSV; version:ssv; revert:yes` | [ ] | ProtocolLib.sol:53-58, SSVPackedLib.sol |
| DA-081 | updateMaximumOperatorFee | Fee precision: non-divisible value — revert `MaxPrecisionExceeded` from `pack()`. | `entry:updateMaximumOperatorFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:141-149, SSVPackedLib.sol |
| DA-082 | updateMinimumOperatorEthFee | Fee precision: non-divisible value — revert `MaxPrecisionExceeded` from `pack()`. | `entry:updateMinimumOperatorEthFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:155-163, SSVPackedLib.sol |
| DA-083 | updateMinimumLiquidationCollateral | Packing overflow: value exceeding `uint64` max after packing — revert `MaxValueExceeded`. | `entry:updateMinimumLiquidationCollateral; version:eth; revert:yes` | [ ] | SSVDAO.sol:125-128, SSVPackedLib.sol |
| DA-084 | updateMinimumLiquidationCollateralSSV | Packing overflow: value exceeding `uint64` max after packing — revert. | `entry:updateMinimumLiquidationCollateralSSV; version:ssv; revert:yes` | [ ] | SSVDAO.sol:133-136, SSVPackedLib.sol |
| DA-085 | updateNetworkFee | Packing overflow: fee exceeding `uint64` max after packing — revert `MaxValueExceeded`. | `entry:updateNetworkFee; version:eth; revert:yes` | [ ] | ProtocolLib.sol:40-46, SSVPackedLib.sol |
| DA-086 | updateNetworkFeeSSV | SSV fee update with active ETH clusters — verify only SSV fee index is affected, ETH fee index unchanged. No cross-contamination. | `entry:updateNetworkFeeSSV; version:ssv; cluster:active; revert:no` | [ ] | SSVDAO.sol:40-46, ProtocolLib.sol:53-58 |
| DA-087 | updateNetworkFee | ETH fee update with active SSV clusters — verify only ETH fee index is affected, SSV fee index unchanged. | `entry:updateNetworkFee; version:eth; cluster:active; revert:no` | [ ] | SSVDAO.sol:29-35, ProtocolLib.sol:40-46 |
| DA-088 | replaceOracle | Replace oracle for empty slot (first assignment) — verify succeeds, address mapped, event emitted. | `entry:replaceOracle; revert:no` | [ ] | SSVDAO.sol:226-249 |
| DA-089 | replaceOracle | Non-owner calls `replaceOracle` — revert with Ownable error. | `entry:replaceOracle; revert:yes` | [ ] | SSVDAO.sol:226 |
| DA-090 | updateModule | Zero address for module — verify revert `TargetModuleDoesNotExistWithData` (code.length == 0). | `entry:updateModule; revert:yes` | [ ] | SSVNetwork.sol:411-413, CoreLib.sol:90 |
| DA-091 | updateQuorumBps | Non-owner calls — revert with Ownable error. | `entry:updateQuorumBps; revert:yes` | [ ] | SSVDAO.sol:254 |
| DA-092 | updateMinBlocksBetweenUpdates | Non-owner calls — revert. | `entry:updateMinBlocksBetweenUpdates; revert:yes` | [ ] | SSVDAO.sol:273 |
| DA-093 | withdrawNetworkSSVEarnings | Withdraw exactly 0 amount — verify behavior (revert or no-op). | `entry:withdrawNetworkSSVEarnings; version:ssv; revert:yes` | [ ] | SSVDAO.sol:51-68 |
| DA-094 | updateMinimumOperatorEthFee | Non-owner calls — revert. | `entry:updateMinimumOperatorEthFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:155 |
| DA-095 | updateMaximumOperatorFee | Packing overflow: value exceeding `uint64` max after packing — revert `MaxValueExceeded`. | `entry:updateMaximumOperatorFee; version:eth; revert:yes` | [ ] | SSVDAO.sol:141-149, SSVPackedLib.sol |

---

## ask-codex Review Findings

### Corrections

- **DA-002 and DA-063**: Use `3,550,929,823` as fee example — this is NOT divisible by 100,000 so it would revert `MaxPrecisionExceeded` at SSVPackedLib.sol:11 before any fee-index assertions. Fix to use a valid fee (e.g., 3,550,900,000).

### Additional Scenarios

| ID | Flow | Purpose | Tags | Tested | File References |
|----|------|---------|------|--------|-----------------|
| DA-096 | updateNetworkFee | Fee not divisible by 100,000 → revert `MaxPrecisionExceeded` from ProtocolLib.sol:45 via SSVPackedLib.sol:11. | `entry:updateNetworkFee; revert:yes` | [ ] | SSVDAO.sol:54, ProtocolLib.sol:45, SSVPackedLib.sol:11 |
| DA-097 | updateNetworkFee | Fee exceeds uint64 max after packing → revert `MaxValueExceeded`. | `entry:updateNetworkFee; revert:yes` | [ ] | SSVPackedLib.sol:10 |
| DA-098 | updateLiquidationThresholdPeriodSSV | Non-owner call → revert (onlyOwner). Tests access control. | `entry:updateLiquidationThresholdPeriodSSV; revert:yes` | [ ] | SSVNetwork.sol:368 |
| DA-099 | updateMinimumLiquidationCollateral | Non-owner call → revert. | `entry:updateMinimumLiquidationCollateral; revert:yes` | [ ] | SSVNetwork.sol:372 |
| DA-100 | updateMinimumLiquidationCollateralETH | Non-owner call → revert. | `entry:updateMinimumLiquidationCollateralETH; revert:yes` | [ ] | SSVNetwork.sol:376 |
| DA-101 | updateMaximumOperatorFee | Non-owner call → revert. | `entry:updateMaximumOperatorFee; revert:yes` | [ ] | SSVNetwork.sol:380 |
| DA-102 | replaceOracle | Non-owner call → revert. | `entry:replaceOracle; revert:yes` | [ ] | SSVNetwork.sol:396 |
| DA-103 | updateQuorumBps | Non-owner call → revert. | `entry:updateQuorumBps; revert:yes` | [ ] | SSVNetwork.sol:400 |
| DA-104 | updateOperatorFeeIncreaseLimit | Set to 0 → freeze all positive fee increases. Downstream: declareOperatorFee reverts at SSVOperators.sol:131 for any increase. | `entry:updateOperatorFeeIncreaseLimit; revert:no` | [ ] | SSVDAO.sol, SSVOperators.sol:131 |
| DA-105 | updateDeclareOperatorFeePeriod+updateExecuteOperatorFeePeriod | Set both to 0 → zero-width window. Downstream: declare+execute in same block. | `entry:updateDeclareOperatorFeePeriod; revert:no` | [ ] | SSVOperators.sol:137-138 |
| DA-106 | updateDeclareOperatorFeePeriod | Change period after declaration — stored window timestamps are NOT retroactively changed. Verify old window still valid. | `entry:updateDeclareOperatorFeePeriod; revert:no` | [ ] | SSVOperators.sol:137-138 |
| DA-107 | replaceOracle | Replace into empty slot (oracle address was already zero) — hits guard at SSVDAO.sol:237. Then verify evicted address becomes reusable after SSVDAO.sol:238 clears reverse mapping. | `entry:replaceOracle; revert:no` | [ ] | SSVDAO.sol:237, 238, 246 |
| DA-108 | updateNetworkFeeSSV | Set SSV network fee and verify continuity/settlement interaction at ProtocolLib.sol:56,98. No existing scenario ties SSV fee to downstream settlement. | `entry:updateNetworkFeeSSV; revert:no` | [ ] | ProtocolLib.sol:56, 98 |
| DA-109 | updateLiquidationThresholdPeriod | Verify ETH liquidation threshold change affects SSV liquidation checks at SSVClusters.sol:97,100,101 and ClusterLib.sol:48. | `entry:updateLiquidationThresholdPeriod; revert:no` | [ ] | SSVClusters.sol:97, 100, 101, ClusterLib.sol:48 |
| DA-110 | updateUnstakeCooldownDuration | Verify downstream: cooldownDuration feeds SSVStaking.sol:87,101. | `entry:updateUnstakeCooldownDuration; revert:no` | [ ] | SSVStaking.sol:87, 101 |
| DA-111 | updateMinBlocksBetweenUpdates | Verify downstream: minBlocksBetweenUpdates feeds SSVClusters.sol:428. | `entry:updateMinBlocksBetweenUpdates; revert:no` | [ ] | SSVClusters.sol:428 |

---

## Coverage Verification (W4)

**Verified by:** Coverage verification worker
**Date:** 2026-03-24
**Method:** Cross-referenced each scenario against actual test files in `test/unit/SSVDAO/`, `test/integration/SSVNetwork/`, `test/integration/SSVNetwork.test.ts`, `test/sanity/`, and `test/e2e/staking/staking-rewards.test.ts`.

### Classification Key

| Value | Meaning |
|-------|---------|
| `yes` | Scenario is directly tested with assertions matching the scenario purpose |
| `partial:mock` | Tested via harness mock setters rather than real end-to-end flow |
| `partial:weak` | Test exists but assertions are incomplete or tangential |
| `no` | No test found covering this scenario |

### Coverage Table

| ID | Tested | remove_mode | Test File | Notes |
|----|--------|-------------|-----------|-------|
| DA-001 | yes | none | unit/SSVDAO/updateNetworkFee.test.ts | Sets fee 0→non-zero, verifies event + storage |
| DA-002 | yes | none | e2e/staking/staking-rewards.test.ts | "Network Fee Raise staking Rewards" — real cluster, verifies old fee settled, new fee applies |
| DA-003 | yes | none | unit/SSVDAO/updateNetworkFee.test.ts + e2e/staking/staking-rewards.test.ts | Fee decrease tested in unit (event) + e2e (settlement math) |
| DA-004 | yes | none | unit/SSVDAO/updateNetworkFee.test.ts + e2e/staking/staking-rewards.test.ts | "Zero Network Fee do no generate new staking rewards" — fee→0 stops accrual |
| DA-005 | yes | none | unit/SSVDAO/accessControl.test.ts | "Non-owner calls updateNetworkFee" revert tested |
| DA-006 | yes | none | unit/SSVDAO/updateNetworkFeeSSV.test.ts | Sets SSV fee, verifies event |
| DA-007 | no | none | — | No test for SSV fee increase with active SSV clusters + settlement verification |
| DA-008 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert for updateNetworkFeeSSV |
| DA-009 | yes | none | unit/SSVDAO/withdrawNetworkSSVEarnings.test.ts | Partial withdrawal, verifies balance reduction + event |
| DA-010 | yes | none | unit/SSVDAO/withdrawNetworkSSVEarnings.test.ts | Full withdrawal verified |
| DA-011 | yes | none | unit/SSVDAO/withdrawNetworkSSVEarnings.test.ts | Withdraw more than available → InsufficientBalance revert |
| DA-012 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert for withdrawNetworkSSVEarnings |
| DA-013 | no | none | — | No explicit test for withdraw when zero earnings (no clusters) |
| DA-014 | yes | none | unit/SSVDAO/updateOperatorFeeIncreaseLimit.test.ts | Valid BPS, storage + event verified |
| DA-015 | yes | none | unit/SSVDAO/updateOperatorFeeIncreaseLimit.test.ts | Set to 0 — freeze test exists |
| DA-016 | yes | none | unit/SSVDAO/updateOperatorFeeIncreaseLimit.test.ts | Set to BPS_DENOMINATOR boundary tested |
| DA-017 | yes | none | unit/SSVDAO/updateOperatorFeeIncreaseLimit.test.ts | Above BPS_DENOMINATOR → revert |
| DA-018 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert tested |
| DA-019 | yes | none | unit/SSVDAO/updateDeclareOperatorFeePeriod.test.ts | Valid value, storage + event |
| DA-020 | yes | none | unit/SSVDAO/updateDeclareOperatorFeePeriod.test.ts | Set to 0 verified |
| DA-021 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert tested |
| DA-022 | yes | none | unit/SSVDAO/updateExecuteOperatorFeePeriod.test.ts | Valid value, storage + event |
| DA-023 | yes | none | unit/SSVDAO/updateExecuteOperatorFeePeriod.test.ts | Set to 0 verified |
| DA-024 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert tested |
| DA-025 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | Exact MINIMAL threshold verified |
| DA-026 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | Above minimum verified |
| DA-027 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | Below minimum → NewBlockPeriodIsBelowMinimum revert |
| DA-028 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | Zero → revert (tested alongside DA-027 "below minimum" cases) |
| DA-029 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert tested |
| DA-030 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | SSV threshold at 21480, storage + event |
| DA-031 | yes | none | unit/SSVDAO/updateLiquidationThresholdPeriod.test.ts | SSV threshold below minimum → revert |
| DA-032 | yes | none | unit/SSVDAO/updateMinimumLiquidationCollateral.test.ts | Non-zero ETH collateral, packed storage + event |
| DA-033 | yes | none | unit/SSVDAO/updateMinimumLiquidationCollateral.test.ts | Zero collateral → allowed |
| DA-034 | yes | none | unit/SSVDAO/updateMinimumLiquidationCollateral.test.ts | SSV collateral non-zero, packed storage + event |
| DA-035 | yes | none | unit/SSVDAO/updateMaximumOperatorFee.test.ts | Max fee above min → storage + event |
| DA-036 | yes | none | unit/SSVDAO/updateMaximumOperatorFee.test.ts | Max fee below min → InvalidOperatorFeeRange revert |
| DA-037 | no | none | — | No explicit test for max fee == min fee boundary |
| DA-038 | yes | none | unit/SSVDAO/updateMinimumOperatorEthFee.test.ts | Min fee below max → storage + event |
| DA-039 | yes | none | unit/SSVDAO/updateMinimumOperatorEthFee.test.ts | Min fee above max → InvalidOperatorFeeRange revert |
| DA-040 | no | none | — | No explicit test for min fee == max fee boundary |
| DA-041 | yes | none | unit/SSVDAO/replaceOracle.test.ts | Replace oracle, OracleReplaced event, mapping verified |
| DA-042 | yes | none | unit/SSVDAO/replaceOracle.test.ts | Replace with zero address → ZeroAddress revert |
| DA-043 | yes | none | unit/SSVDAO/replaceOracle.test.ts + sanity/replace-oracle-invalid-id.test.ts | OracleId 0 → InvalidOracleId revert |
| DA-044 | yes | none | sanity/replace-oracle-invalid-id.test.ts | OracleId > MAX_DELEGATION_SLOTS → InvalidOracleId revert |
| DA-045 | yes | none | unit/SSVDAO/replaceOracle.test.ts | Address already assigned → OracleAlreadyAssigned revert |
| DA-046 | yes | none | unit/SSVDAO/replaceOracle.test.ts | Same address → SameOracleAddressNotAllowed revert |
| DA-047 | yes | none | unit/SSVDAO/setQuorumBps.test.ts | Valid mid-range BPS, storage + event |
| DA-048 | yes | none | unit/SSVDAO/setQuorumBps.test.ts | Zero → InvalidQuorum revert |
| DA-049 | yes | none | unit/SSVDAO/setQuorumBps.test.ts | BPS_DENOMINATOR boundary → accepted |
| DA-050 | yes | none | unit/SSVDAO/setQuorumBps.test.ts | Above BPS_DENOMINATOR → InvalidQuorum revert |
| DA-051 | yes | none | unit/SSVDAO/setQuorumBps.test.ts | Minimum 1 BPS → accepted |
| DA-052 | yes | none | unit/SSVDAO/setUnstakeCooldownDuration.test.ts | Valid duration, storage + event |
| DA-053 | yes | none | unit/SSVDAO/setUnstakeCooldownDuration.test.ts | Zero → allowed (instant unstake) |
| DA-054 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert tested |
| DA-055 | yes | none | unit/SSVDAO/setMinBlocksBetweenUpdates.test.ts | Valid value, storage + event |
| DA-056 | yes | none | unit/SSVDAO/setMinBlocksBetweenUpdates.test.ts | Zero → allowed |
| DA-057 | no | none | — | No non-owner revert test for updateMinBlocksBetweenUpdates (not in accessControl.test.ts) |
| DA-058 | yes | none | integration/SSVNetwork.test.ts | "Emits the correct event with the correct input data" for setFeeRecipientAddress |
| DA-059 | no | none | — | No test for setting fee recipient to zero address |
| DA-060 | no | none | — | No unit/integration test for updateModule happy path (only access control in accessControl.test.ts) |
| DA-061 | no | none | — | No test for updateModule with EOA → TargetModuleDoesNotExistWithData revert |
| DA-062 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner revert for updateModule tested |
| DA-063 | no | none | — | No test for fee change mid-cluster-operation with deposit verification |
| DA-064 | no | none | — | No test for threshold increase making existing cluster liquidatable |
| DA-065 | no | none | — | No test for increased minimum collateral affecting reactivation |
| DA-066 | no | none | — | No test for lowered max fee blocking a pending declared fee |
| DA-067 | no | none | — | No test for increased min fee blocking new operator registration |
| DA-068 | yes | none | integration/SSVNetwork/dao.test.ts + unit/SSVDAO/commitRoot.test.ts | "Oracle replaced mid-vote" — old oracle reverts NotOracle, new oracle succeeds on subsequent block |
| DA-069 | yes | none | integration/SSVNetwork/dao.test.ts + unit/SSVDAO/commitRoot.test.ts | "Lowering quorumBps between votes causes second vote to cross new threshold" |
| DA-070 | no | none | — | No test for max uint64 liquidation threshold boundary |
| DA-071 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateNetworkFee revert — duplicate of DA-005 |
| DA-072 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateNetworkFeeSSV revert — duplicate of DA-008 |
| DA-073 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateOperatorFeeIncreaseLimit revert — duplicate of DA-018 |
| DA-074 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateLiquidationThresholdPeriod revert — duplicate of DA-029 |
| DA-075 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateLiquidationThresholdPeriodSSV revert |
| DA-076 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMinimumLiquidationCollateral revert |
| DA-077 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMinimumLiquidationCollateralSSV revert |
| DA-078 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMaximumOperatorFee revert |
| DA-079 | no | none | — | No test for ETH network fee non-divisible precision revert |
| DA-080 | no | none | — | No test for SSV network fee non-divisible precision revert |
| DA-081 | no | none | — | No test for max operator fee non-divisible precision revert |
| DA-082 | no | none | — | No test for min operator fee non-divisible precision revert |
| DA-083 | no | none | — | No test for minimum liquidation collateral packing overflow |
| DA-084 | no | none | — | No test for SSV minimum liquidation collateral packing overflow |
| DA-085 | no | none | — | No test for network fee packing overflow |
| DA-086 | no | none | — | No test for SSV fee isolation from ETH fee index |
| DA-087 | no | none | — | No test for ETH fee isolation from SSV fee index |
| DA-088 | no | none | — | No test for first oracle assignment to empty slot |
| DA-089 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner replaceOracle revert covered |
| DA-090 | no | none | — | No test for updateModule with zero address |
| DA-091 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateQuorumBps revert covered |
| DA-092 | no | none | — | No non-owner revert test for updateMinBlocksBetweenUpdates (not in accessControl.test.ts) |
| DA-093 | no | none | — | No test for withdrawNetworkSSVEarnings with zero amount |
| DA-094 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMinimumOperatorEthFee revert covered |
| DA-095 | no | none | — | No test for max operator fee packing overflow |
| DA-096 | no | none | — | No test for network fee non-divisible by 100,000 precision revert |
| DA-097 | no | none | — | No test for network fee uint64 packing overflow |
| DA-098 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateLiquidationThresholdPeriodSSV revert covered |
| DA-099 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMinimumLiquidationCollateral revert covered |
| DA-100 | yes | none | unit/SSVDAO/accessControl.test.ts | Non-owner updateMinimumLiquidationCollateralSSV revert covered |
| DA-101 | yes | none | unit/SSVDAO/accessControl.test.ts | updateMaximumOperatorFee non-owner revert covered |
| DA-102 | yes | none | unit/SSVDAO/accessControl.test.ts | replaceOracle non-owner revert covered (via SSVNetwork proxy) |
| DA-103 | yes | none | unit/SSVDAO/accessControl.test.ts | updateQuorumBps non-owner revert covered |
| DA-104 | no | none | — | No test for fee increase limit 0 blocking declareOperatorFee |
| DA-105 | no | none | — | No test for zero declare+execute period enabling same-block declare+execute |
| DA-106 | no | none | — | No test for period change not retroactively affecting stored windows |
| DA-107 | no | none | — | No test for replace oracle into empty slot |
| DA-108 | no | none | — | No test for SSV fee continuity/settlement interaction |
| DA-109 | no | none | — | No test for ETH threshold change affecting SSV liquidation checks |
| DA-110 | no | none | — | No downstream test for cooldownDuration feeding SSVStaking |
| DA-111 | no | none | — | No downstream test for minBlocksBetweenUpdates feeding SSVClusters |

### Summary

| Status | Count | Percentage |
|--------|-------|------------|
| yes | 73 | 66% |
| partial:mock | 0 | 0% |
| partial:weak | 0 | 0% |
| no | 38 | 34% |
| **Total** | **111** | **100%** |

**Key gaps (no coverage):**
- DA-007: SSV fee increase with active clusters (settlement verification)
- DA-013: Withdraw SSV earnings when zero balance
- DA-037, DA-040: Boundary tests (max==min fee)
- DA-057, DA-092: Non-owner revert for updateMinBlocksBetweenUpdates
- DA-059: setFeeRecipientAddress with zero address
- DA-060, DA-061, DA-090: updateModule happy path, EOA revert, zero address
- DA-063–DA-067: Cross-cutting integration scenarios (fee/threshold changes affecting downstream operations)
- DA-070: Max uint64 liquidation threshold boundary
- DA-082–DA-088: Packing overflow, precision, and fee isolation tests
- DA-093: Withdraw zero amount
- DA-095–DA-097: Packing overflow edge cases
- DA-104–DA-111: Downstream impact scenarios (fee limit freeze, zero-width window, period change non-retroactivity, etc.)
