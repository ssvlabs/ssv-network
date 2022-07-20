const fs = require('fs');
const simpleGit = require("simple-git");
const ghpages = require('gh-pages');
const hre = require('hardhat');
const prompts = require('prompts');

const git = simpleGit.default();

export async function publishAbi(name: string) {
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

  let tag = null;
  if (response.createTag) {
    await git.addAnnotatedTag(response.newTag, `new version ${response.newTag}`);
    await git.push('origin', response.newTag);
    tag = response.newTag;
  } else if (response.gitTag !== 'create-tag') {
    tag = response.gitTag;
  }

  if (!tag) throw 'Please select git tag to deploy the contract.';

  const fullNames = await hre.artifacts.getAllFullyQualifiedNames();
  const contract = fullNames.find((item: string) => item.includes(`/${name}.sol`));

  const { abi, contractName } = await hre.artifacts.readArtifact(contract);
  const dir = `${hre.config.paths.root}/dist`;
  await fs.promises.mkdir(`${dir}/abi/${tag}`, { recursive: true });
  await fs.promises.writeFile(`${dir}/abi/${tag}/${contractName.toLowerCase()}.json`, `${JSON.stringify(abi, null, 2)}\n`, { flag: 'w' });
  await ghpages.publish(dir);
  console.log(`> ${name} contract abi published to:`, `https://bloxapp.github.io/ssv-network/abi/${tag}/${contractName.toLowerCase()}.json`);
}