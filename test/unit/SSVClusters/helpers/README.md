## Helper Utilities

This directory contains helper functions and utilities used by SSVClusters unit tests.

### Functions

- **`makePublicKey(seed: number)`** - Generates a deterministic public key from a seed value
- **`makeOperatorKey(seed: number)`** - Generates a deterministic operator key from a seed value
- **`registerOperators(network, owner, count)`** - Registers multiple operators and returns their IDs
- **`asClusterStruct(cluster)`** - Converts a cluster object to the `ClusterStruct` type format
- **`mustEmitEvent(receipt, network, eventName)`** - Extracts the specified event from a transaction receipt and throws an error if the event is not found (asserts the event must exist)
- **`mustNotEmitEvent(receipt, network, eventName)`** - Asserts that the specified event was not emitted in the transaction receipt, throwing an error if it was found

These helpers are used to simplify test setup and data manipulation in the SSVClusters test suite.
