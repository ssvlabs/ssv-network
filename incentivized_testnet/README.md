# SSV CLI fetch tool

## Quick start

The first things you need to install its
dependencies:

```sh
npm install
```

Second, describe config settings in `.env` file based on `.env.example`, where:
```sh
NODE_URL= #eth1 node url
BACKEND_URI= #backend domain which returns attr for validators and epoch
CONTRACT_ADDRESS= #ssv contract address
MAX_EPOCHS_PER_REQUEST= #max epochs per request, by default is 100
```

## Fetch operators and validators to csv files
After first run will be created `.process.cache` file which will store the last block number which was used to grab the data.
Next runs the data will be grabed from the block which was saved in that file.

```sh
node cmd.js --command fetch
```

## Fill att and eff for validators and export to validators_extra_<from epoch>-<to epoch> csv file

```sh
node cmd.js --epochs 45891 45893 --command metrics
```
