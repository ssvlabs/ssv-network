export async function approveAndStake(staking: any, ssvToken: any, amount: bigint): Promise<void> {
    await ssvToken.approve(await staking.getAddress(), amount);
    await staking.stake(amount);
}
