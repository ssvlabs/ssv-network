// import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { BigNumber } from 'ethers';


const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  console.log('\n============================= Deploying SSV Registry ===============================');
  console.log('deployer: ', deployer);

  await deploy('SSVRegistry', {
    from: deployer,
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: 'initialize',
          args: [],  
        }
      }
    },
    gasLimit: BigNumber.from(process.env.GAS),
    log: true,
  });
};

export default func;
func.tags = ['SSVRegistry'];
