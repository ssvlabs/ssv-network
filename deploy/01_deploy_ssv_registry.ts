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
/*

const {ethers, upgrades} = require("hardhat");
module.exports = async ({getNamedAccounts, deployments}) => {
    const {deploy, save} = deployments;
    const {deployer} = await getNamedAccounts();

    const UsdPlusToken = await ethers.getContractFactory('UsdPlusToken');
    const proxy = await upgrades.deployProxy(UsdPlusToken, {kind: 'uups'});
    console.log('Deploy UsdPlusToken Proxy done -> ' + proxy.address);

    const impl = await upgrades.upgradeProxy(proxy, UsdPlusToken);
    console.log('Deploy UsdPlusToken Impl  done -> ' + impl.address);

    const artifact = await deployments.getExtendedArtifact('UsdPlusToken');
    let proxyDeployments = {
        address: proxy.address,
        ...artifact
    }

    await save('UsdPlusToken', proxyDeployments);
};

module.exports.tags = ['base', 'UsdPlusToken'];
*/