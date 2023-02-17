# Time-locked functions

SSVNetwork contract supports execution of these functions via time-locked implementation:

- UpdateNetworkFee
- WithdrawNetworkEarnings
- UpdateLiquidationThresholdPeriod

## How it works

1. The contract owner calls the time-locked fucntion with the required parameters.

2. For that call (function name + parameter), the lock period of 2 days starts. The event `FunctionLocked` is emitted.

3. If the owner calls the function with the same parameter before the release time, the transaction is reverted with the `FunctionIsLocked` error. Only after the 2 days period passes, the function can be executed by the contract owner.


There could be multiple locked executions at the same time for the same function, for example:  

`UpdateNetworkFee(200000000)` with release time: Tue 7 Feb, 1:40  
`UpdateNetworkFee(350000000)` with release time: Wed 8 Feb, 11:20  

Every call can be executed at the specified release time that can be taken from the `FunctionLocked` event.

As this functionality is expected to be used by authorized accounts and consumed after scheduled, there is no implementation to delete or expire unused time-locked schedules.

## FunctionLocked event

When a time-locked function is called to schedule the execution, the event `FunctionLocked` is emitted with these parameters:

- functionSelector (`bytes4`): Function selector of the function called.
- releaseTime (`uint64`): Unix timestamp representing the time the execution of the call can be performed.
- functionData (`bytes`): Encoded representation of the function selector + values of the parameters, generated with `abi.encodeWithSelector`.

### How to parse event data

Here is an example of how to be aware of the locked functions via event data. We will use `SSVNetork` contract ABI and [ethers](https://docs.ethers.org/v6/) library and simulate the execution of `updateNetworkFee` function.

```
// Load contract ABI
const ABI = require("../SSVNetwork.json");

// Load provider, signer account and contract
const provider = new ethers.providers.JsonRpcProvider(process.env.INFURA_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const ssvNetwork = new ethers.Contract(process.env.SSVNETWORK_ADDRESS, abi, signer);

// Execute first call
const tx = await (await ssvNetwork.updateNetworkFee(700000000)).wait();

// Decode FunctionLocked event log 
const decodedLog = ssvNetwork.interface.parseLog(tx.logs[0]).args;

// sample output for decodedLog
[
    '0x1f1f9fd5',
    BigNumber { value: "1676803803" },
    '0x1f1f9fd50000000000000000000000000000000000000000000000000000000029b92700',
    functionSelector: '0x1f1f9fd5',
    releaseTime: BigNumber { value: "1676803803" },
    functionData: '0x1f1f9fd50000000000000000000000000000000000000000000000000000000029b92700'
]

// Decode data parameters passed to updateNetworkFee call
const functionData = ssvNetwork.interface.decodeFunctionData('updateNetworkFee', decodedLog.functionData);
// sample output for functionData
[
  BigNumber { value: "700000000" },
  fee: BigNumber { value: "700000000" }
]
```

As more time-locked functions with different parameter sets can be added in the future, to parse the event properly you can create an object with function selectors as ids and function names as values like this:

```
const TIME_LOCKED_FUNCTIONS = {
    '0x1f1f9fd5': 'updateNetworkFee',
    '0xd2231741': 'withdrawNetworkEarnings',
    '0x6512447d': 'updateLiquidationThresholdPeriod'
};
```

And filter `decodedLog` output by `functionSelector` property to get the right function name to pass to `decodeFunctionData` step.






