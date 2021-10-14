# SSV CLI fetch tool

## Quick start

The first things you need to install its
dependencies:

```sh
npm install
```

## Fetch operators and validators to csv files
After first run will be created `.process.cache` file which will store the last block number which was used to grab the data.
Next runs the data will be grabed from the block which was saved in that file.

```sh
NODE_URL=https://eth-goerli.alchemyapi.io/v2/G3aG8wN9V8jKWs0NwZkWf2-img3cH4CU node cmd.js --command fetch
```

## Fill att and eff for validators and export to validators_extra csv file

```sh
node cmd.js --epocs 45891 45893 --command metrics
```
