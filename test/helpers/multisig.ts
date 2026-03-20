import type { BaseContract, ContractTransactionResponse } from "ethers";

export async function deployMultisig(ethers: any): Promise<any> {
  const multisig = await ethers.deployContract("MockMultisig");
  await multisig.waitForDeployment();
  return multisig;
}

export async function multisigExec(
  multisig: any,
  target: BaseContract,
  method: string,
  args: any[] = [],
): Promise<ContractTransactionResponse> {
  const data = target.interface.encodeFunctionData(method, args);
  return multisig.exec(await target.getAddress(), data);
}
