## SSVStaking Unit Tests

This directory contains unit tests for the SSVStaking module, which handles SSV token staking, cSSV minting, and ETH rewards distribution in the SSV Network.

### Running Tests

- Run all unit tests under this suite: `npx hardhat test test/unit/SSVStaking/*.test.ts`
- Or use the helper script from repo root: `./test/unit/SSVStaking/run-tests.sh`

### Test Coverage

The tests cover:

#### stake.test.ts
- Successful staking of SSV tokens with cSSV minting and event emission
- User index updates after staking
- Delegation creation to default oracles with oracle weight distribution
- Zero amount validation
- Minimum stake amount validation
- Multiple stakes from same user
- SSV token transfer verification
- **Storage checks**: Delegation data (oracle IDs and amounts) stored correctly

#### requestUnstake.test.ts
- Successful unstake request with cSSV burning and event emission
- Withdrawal request creation with correct unlock time
- Proportional delegation removal
- Zero amount validation
- Cooldown active error (only one pending withdrawal allowed)
- Unstake amount exceeds balance validation
- Full balance unstaking
- **Storage checks**: Withdrawal request (amount and unlock time) stored correctly

#### withdrawUnlocked.test.ts
- Successful withdrawal after cooldown period with event emission
- Withdrawal request clearing after withdrawal
- Nothing to withdraw validation
- Cooldown not finished validation
- Partial cooldown validation
- Exact unlock time withdrawal
- **Storage checks**: Withdrawal request cleared from storage after successful withdrawal

#### claimEthRewards.test.ts
- Successful ETH rewards claiming with event emission
- Accrued balance reduction after claiming
- Nothing to claim validation (no rewards)
- Nothing to claim validation (amount too small)
- Insufficient balance validation
- Fee syncing before claiming
- **Storage checks**: Updated accrued balance stored correctly after claiming

#### syncFees.test.ts
- Staking pool balance update with event emission
- accEthPerShare update with new fees
- No change when no new fees
- No change when total staked is zero
- DAO balance syncing
- Multiple sync calls
- **Storage checks**: Updated pool balance and accEthPerShare stored correctly

#### rescueERC20.test.ts
- Successful rescue of accidentally sent ERC20 tokens with event emission
- Correct amount transfer to recipient
- Zero address validation (token)
- Zero address validation (recipient)
- Invalid token validation (SSV not rescuable)
- Invalid token validation (cSSV not rescuable)
- Zero amount validation
- Partial token rescue

### Dependencies

Hardhat will build artifacts on demand; make sure dependencies are installed before running (`npm install`).
