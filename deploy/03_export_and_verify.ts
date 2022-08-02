import fs from 'fs';
import ghpages from 'gh-pages';
import prompts from 'prompts';

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { simpleGit } from 'simple-git';
import { promisify } from 'util';

const publishAbi = async function (hre: HardhatRuntimeEnvironment) {
  const git = simpleGit();
  const { all } = await git.tags();
  const gitTagChoices = [
    { title: '[create new tag]', description: 'Create new git tag before contract deployment', value: 'create-tag' },
    ...all.map((tag: any) => ({ title: tag, value: tag }))
  ];
  const response = await prompts([
    {
      type: 'select',
      name: 'gitTag',
      message: 'Git tag to deploy?',
      choices: gitTagChoices
    },
    {
      type: (prev: any) => prev === 'create-tag' ? 'text' : null,
      name: 'newTag',
      message: `Tag name?`,
      validate: (value: any) => value === '' ? `Sorry, git tag can't be null` : true
    },
    {
      type: (prev: any, values: any) => values.gitTag === 'create-tag' ? 'toggle' : null,
      name: 'createTag',
      initial: true,
      active: 'yes',
      inactive: 'no',
      message: 'Create and publish new tag?'
    }
  ]);

  let tag: any = null;
  if (response.createTag) {
    await git.addAnnotatedTag(response.newTag, `new version ${response.newTag}`);
    await git.push('origin', response.newTag);
    tag = response.newTag;
  } else if (response.gitTag !== 'create-tag') {
    tag = response.gitTag;
  }

  if (!tag) throw 'Please select git tag to deploy the contract.';

  const ssvRegistryArrtifact = await hre.deployments.getArtifact('SSVRegistry');
  const ssvNetworkArrtifact = await hre.deployments.getArtifact('SSVNetwork');

  const dir = `${hre.config.paths.root}/dist`;
  await fs.promises.mkdir(`${dir}/abi/${tag}`, { recursive: true });
  await fs.promises.writeFile(`${dir}/abi/${tag}/SSVRegistry.json`, `${JSON.stringify(ssvRegistryArrtifact.abi, null, 2)}\n`, { flag: 'w' });
  await fs.promises.writeFile(`${dir}/abi/${tag}/SSVNetwork.json`, `${JSON.stringify(ssvNetworkArrtifact.abi, null, 2)}\n`, { flag: 'w' });
  const publish = promisify(ghpages.publish);
  await publish(dir);
  console.log(`> SSVRegistry contract abi published to:`, `https://bloxapp.github.io/ssv-network/abi/${tag}/SSVRegistry.json`);
  console.log(`> SSVNetwork contract abi published to:`, `https://bloxapp.github.io/ssv-network/abi/${tag}/SSVNetwork.json`);
}

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment): Promise<void> => {
  console.log('\n============================= Exporting + Verifying Deployments ===============================');
  await hre.run('export', {
    exportAll: './deployments.json',
  });

  await hre.run('etherscan-verify', {
    solcInput: true,
  });

  await publishAbi(hre);
};

export default func;
func.tags = ['ExportAndVerify'];
func.dependencies = ['SSVRegistry', 'SSVNetwork'];