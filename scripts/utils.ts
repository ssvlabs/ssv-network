const simpleGit = require("simple-git");
const prompts = require('prompts');

const git = simpleGit.default();

export async function generateGitTag() {
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
            validate: (value: any) => {
                if (gitTagChoices.some(item => item.value === value)) return 'Tag already registered';
                return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? true : 'Tag name must follow SemVer spec: major.minor.patch';
            }
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

    let tag: string = '';
    if (response.createTag) {
        await git.addAnnotatedTag(response.newTag, `new version ${response.newTag}`);
        await git.push('origin', response.newTag);
        tag = response.newTag;
    } else if (response.gitTag !== 'create-tag') {
        tag = response.gitTag;
    }

    if (!tag) throw 'Please specify a git tag to deploy the contract.';
    return tag;
}