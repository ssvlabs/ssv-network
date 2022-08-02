// import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { BigNumber } from 'ethers';


const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  console.log('\n============================= Deploying SSV Network ===============================');
  console.log('deployer: ', deployer);

  await deploy('SSVNetwork', {
    from: deployer,
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: 'initialize',
          args: [
            process.env.SSVREGISTRY_ADDRESS,
            process.env.SSVTOKEN_ADDRESS,
            process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
            process.env.OPERATOR_MAX_FEE_INCREASE,
            process.env.DECLARE_OPERATOR_FEE_PERIOD,
            process.env.EXECUTE_OPERATOR_FEE_PERIOD,
          ],  
        },
      },
    },
    gasLimit: BigNumber.from(process.env.GAS),
    log: true,
  });
};

export default func;
func.tags = ['SSVNetwork'];
