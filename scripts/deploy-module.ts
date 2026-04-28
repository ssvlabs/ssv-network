import { parseArg, getEthers, getDeployer, deployContract } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";

async function main() {
    const targetNetwork = parseArg("network");
    const ethers = await getEthers(targetNetwork);
    await getDeployer(ethers);

    const moduleName = parseArg("module");

    const moduleEnumKey = moduleName as keyof typeof SSVModules;
    if (SSVModules[moduleEnumKey] === undefined) {
        throw new Error(`Invalid module: ${moduleName}`);
    }

    let args: any[] = [];
    const argsIndex = process.argv.indexOf("--args");
    if (argsIndex !== -1) {
        const argsValue = process.argv[argsIndex + 1];
        if (argsValue) {
            try {
                args = JSON.parse(argsValue);
                if (!Array.isArray(args)) {
                    throw new Error("Args must be a JSON array");
                }
            } catch (err) {
                throw new Error(`Invalid --args JSON: ${argsValue}. Expected array like [1, "hello", true]`);
            }
        }
    }

    await deployContract(ethers, moduleName, args);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});