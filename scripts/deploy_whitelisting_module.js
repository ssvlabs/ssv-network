// scripts/updateModule.js

const { ethers } = require("hardhat");
const { JsonRpcProvider, Wallet } = require("ethers"); // Import directly from ethers

require("dotenv").config();

async function main() {
    // Retrieve environment variables
    const {
        HOLESKY_ETH_NODE_URL,
        HOLESKY_OWNER_PRIVATE_KEY,
    } = process.env;

    if (!HOLESKY_ETH_NODE_URL || !HOLESKY_OWNER_PRIVATE_KEY) {
        throw new Error("Please ensure HOLESKY_ETH_NODE_URL, HOLESKY_OWNER_PRIVATE_KEY, and SSVNETWORK_PROXY_ADDRESS are set in your .env file.");
    }

    // Initialize provider and signer using Ethers
    const provider = new JsonRpcProvider(HOLESKY_ETH_NODE_URL);
    const signer = new Wallet(HOLESKY_OWNER_PRIVATE_KEY, provider);

    console.log(`Connected to network: ${await provider.getNetwork().then(n => n.name)} (Chain ID: ${await provider.getNetwork().then(n => n.chainId)})`);
    console.log(`Using signer address: ${signer.address}`);

    // Retrieve the SSVNetwork contract instance
    const SSVNetwork = await ethers.getContractFactory("SSVNetwork", signer);
    const ssvNetwork = SSVNetwork.attach('0x8383d719377047b1B8824CbB7f8ba7f24F12c715');

    // Define the parameters for updateModule
    const moduleId = 4;
    const moduleAddress = '0x040781525e91927f840FF5280BDd7A8A7D68274B';

    console.log(`Updating module with ID: ${moduleId} to address: ${moduleAddress}`);

    // Execute the updateModule function
    const tx = await ssvNetwork.updateModule(moduleId, moduleAddress);

    console.log(`Transaction sent. Hash: ${tx.hash}`);

    // Wait for the transaction to be mined
    const receipt = await tx.wait();

    if (receipt.status === 1) {
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
        console.log(`Module with ID ${moduleId} successfully updated to address ${moduleAddress}`);
    } else {
        console.error(`Transaction failed. See Etherscan for details: https://etherscan.io/tx/${tx.hash}`);
    }
}

// Execute the script and handle errors
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error executing updateModule:", error);
        process.exit(1);
    });