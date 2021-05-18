# Thegrapth subgrapth entity

This folder contains [thegrapth](https://thegraph.com/) subgrapth files to index data for smart contract events.
Read [Documentation](https://thegraph.com/docs/define-a-subgraph) before do any changes.

## Installation
To setup `graph-cli` as global package:

```sh
npm install -g @graphprotocol/graph-cli
```
## Smart contract dependencies
For each data structure update in smart contract, need to update `abi.json` file based on updated ABI json schema.
And run deployment.
## Deploy steps
First, need to pass authorization

```sh
graph auth https://api.thegraph.com/deploy/ <thegraph-key> 
```

After any changes in the files, do the following:

```sh
graph deploy --debug --node https://api.thegraph.com/deploy/ --ipfs https://api.thegraph.com/ipfs/ <path-subgraph>
```
