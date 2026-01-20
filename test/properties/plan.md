# Echidna Properties Plan

## Operators

### State & Consistency
1. **Uniqueness**: No two active operators should share the same public key.
2. **ID Monotonicity**: Newly registered operator IDs should be strictly greater than previous ones.
3. **Ownership**: A registered operator must have a non-zero owner address.

### Fees
4. **Fee Limits**: `operator.ethFee` must always be less than or equal to `SSVStorageProtocol.operatorMaxFee`.
5. **Fee Minima**: `operator.ethFee` should be either `0` or greater than or equal to `MINIMAL_OPERATOR_ETH_FEE`.
6. **Fee Update Cycle**: 
    - A fee increase must go through the `declare` -> `wait` -> `execute` cycle.
    - `executeOperatorFee` must revert if called before `approvalBeginTime` or after `approvalEndTime`.
    - `executeOperatorFee` must revert if the fee in the request is invalid (though this should be caught at declaration, the state might change).
7. **Fee Reduction**: `reduceOperatorFee` should strictly decrease the fee and apply immediately without a waiting period. If not `0`, the fee should be greater than or equal to `MINIMAL_OPERATOR_ETH_FEE`.

### Earnings & Withdrawals
8. **Solvency**: `operator.ethSnapshot.balance` should never be negative (implicitly handled by uint, but ensuring no underflow attacks).
9. **Withdrawal limit**: Users cannot withdraw more than their accumulated earnings (`ethSnapshot.balance`).
10. **Zero Balance Post-Withdrawal**: `withdrawAllOperatorEarnings` must result in `ethSnapshot.balance == 0`.
11. **Earnings Conservation**: `withdrawOperatorEarnings` decreases `ethSnapshot.balance` by exactly the shrunk amount withdrawn.

### Access Control
12. **Owner Authority**: Functions modifying operator state (`removeOperator`, `declareOperatorFee`, `withdrawOperatorEarnings`, etc.) must revert if called by non-owner.

### Removal
13. **Clean State**: A removed operator (via `removeOperator`) must have:
    - `ethFee == 0`
    - `ethSnapshot.balance == 0`
    - `validatorCount == 0`
    - `owner` kept 
14. **Funds Return on Removal**: Upon removal, if the operator has any remaining earnings (`ethSnapshot.balance` for ETH, `snapshot.balance` for SSV), these must be transferred back to the operator's owner.
    - **ETH Return**: `address(owner).balance` increases by `ethSnapshot.balance.expand()`.
    - **SSV Return**: `IERC20(token).balanceOf(owner)` increases by `snapshot.balance.expand()`.
    - **System Solvency**: The contract's holdings must decrease by the exact amounts paid out.

