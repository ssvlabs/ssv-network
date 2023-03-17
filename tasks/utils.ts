const fs = require('fs').promises;

export const generateABI = async (hre: any, contractNames: string[], contractAddresses: string[]) => {
    // Only extract ABIs for mainnet or goerli deployments
    if (hre.network.name == 'goerli' || hre.network.name == 'mainnet') {
        await fs.mkdir('abi/', { recursive: true });

        for (let i = 0; i < contractNames.length; i++) {
            const { abi, contractName } = await hre.artifacts.readArtifact(contractNames[i]);

            await fs.writeFile(`abi/${contractName}.json`, `${JSON.stringify(abi, null, 2)}\n`, { flag: 'w' });
        }
    }
}