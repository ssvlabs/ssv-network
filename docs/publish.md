# SSV Network

### [Intro](../README.md) | [Architecture](architecture.md) | [Setup](setup.md) | [Tasks](tasks.md) | [Local development](local-dev.md) | [Roles](roles.md) | Publish

## Prerequisites

- Ensure you have [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) installed.
- An npm account. [Sign up here](https://www.npmjs.com/signup) if you don't have one.

## Prepare Package

Before publishing, make sure your `package.json` is properly set up:

- `name`: The package name (must be unique on npm).
- `version`: The current version of the package.
- `description`: A brief description of your package.
- `main`: The entry point of your package (usually `index.js`).
- `scripts`: Any scripts you want to include, like build or test scripts.
- `author`: The author's name and contact information.
- `repository`: The repository URL where your code is located.
- `keywords`: An array of keywords to help users discover your package.
- `files`: An array of file patterns that describes which files should be included when your package is installed.
- `dependencies` and `devDependencies`: Any required packages.

## Authenticate with npm

- Log in to your npm account from the command line:

```bash
npm login
```

- Enter your npm username, password, and email address when prompted.

## Configure GitHub Actions for Automated Publishing

- Create a `.github/workflows/publish.yaml` file in your project.
- Define the npm publishing process using GitHub Actions:

```
name: Publish npm package

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Use Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm install

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

```

- Add your npm token `NPM_TOKEN` to the GitHub repository secrets (Settings > Secrets).

## Publish Package

- Push some changes to the `main` branch of the `ssv_network` GitHub repository.
- The GitHub Actions workflow will automatically publish the package to npm.
