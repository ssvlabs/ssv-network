# SSV Network Project


This repository contains a SSVNetwork smart contacts project.

## Quick start

The first things you need to do are cloning this repository and installing its dependencies:


```sh
git clone git@github.com:bloxapp/ssv-network.git
cd ssv-network
npm install
```

### Run locally HardHat TestNetwork node

Once installed, to run Hardhat's testing network:


```sh
npx hardhat node
```

For more details about it and how to use MainNet forking you can find [here](https://hardhat.org/hardhat-network/).
  

### Compile contracts

Take a look at `contracts/` folder, you should be able to find:
- `SSVNetwork.sol`: Base contract for SSV Network operations.
- `SSVNetworkViews.sol`: Contract with view functions only to retrive information from SSVNetwork contract.
- `libraries`: Folder which contains library contracts that implement operators, clusters and network functionalities.

To compile them, simply run:

```sh
npx hardhat compile
```
  
## CI/CD Workflow  

### Test contracts

Take a look at `test/` folder, you should be able to find tests related to specific actions.

It comes with tests that use [Ethers.js](https://github.com/ethers-io/ethers.js/).

To run tests, run:
 
```sh
npx hardhat test
```


### Deployment / upgrade process

Please check the [deployment document](./DEPLOYMENT.md) for a detailed step by step guide.

## Modify the limit of validators that an operator can manage
In `SSVNetwork` contract, the state variable `validatorsPerOperatorLimit` is used to represent the máximum number of validators that can be registered per operator. Its default value is `2000`.

To change it, the upgrade process should be fired. The assignement to a new value must be in a new initializer function. Pay special attention to the `reinitializer` modifier where there should be a number higher than the one consumed in previous initialized contracts. More info [here](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Initializable-reinitializer-uint8-)
Example upgrade contract:
```
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "../SSVNetwork.sol";

contract SSVNetwork_v2 is SSVNetwork {
    
    function initializev2(uint32 validatorsPerOperatorLimit_) reinitializer(2) external {
        validatorsPerOperatorLimit = validatorsPerOperatorLimit_;
    }
}
```


## Transfer the ownership of the contract
The process of transferring the ownership of the SSVNetwork contract is implemented using OpenZeppelin's `Ownable2StepUpgradeable` contract, and consists of the following steps:
1. Current owner calls `SSVNetwork`'s `transferOwnership` function with the new owner address as parameter.
2. The new owner calls `SSVNetwork`'s `acceptOwnership` fucntion and the ownership of the contract is transferred.

#### Version tracking

`SSVNetwork` contract keeps its version number using the state variable `version`, which can be queried at any time but is only updated via the upgrade process. The assignement of the new version number takes place in the initializer function of the new contract. We follow [SemVer](https://semver.org/) spec. 

Example upgrade contract:
```
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;

import "./SSVNetwork.sol";

contract SSVNetworkVersionUpgrade is SSVNetwork {
    function initializev2(string calldata _version) external reinitializer(_getInitializedVersion() + 1) {
         version = bytes32(abi.encodePacked((_version)));
    }
}
```
Here a new `_version` is passed to the `initializev2` function that is executed in the upgrade process. The `Initializable._getInitializedVersion()` call picks the latest version of previously initialized contracts and is increased by 1.
