import hre from 'hardhat';
import { expect } from 'chai';

describe('Effective Balance Roundtrip Tests', () => {
  let testContract: any;

  before(async () => {
    const { ethers } = await hre.network.connect();
    const factory = await ethers.getContractFactory('EffectiveBalanceTest');
    testContract = await factory.deploy();
    await testContract.waitForDeployment();
  });

  describe('Roundtrip conversion', () => {
    const testCases = [
      { effectiveBalance: 0, expectedVUnits: 0n, description: '0 ETH (edge case)' },
      { effectiveBalance: 1, expectedVUnits: 313n, description: '1 ETH (minimum)' },
      { effectiveBalance: 31, expectedVUnits: 9688n, description: '31 ETH (below 1 validator)' },
      { effectiveBalance: 32, expectedVUnits: 10000n, description: '32 ETH (1 validator, exact)' },
      { effectiveBalance: 33, expectedVUnits: 10313n, description: '33 ETH (ceiling)' },
      { effectiveBalance: 63, expectedVUnits: 19688n, description: '63 ETH' },
      { effectiveBalance: 64, expectedVUnits: 20000n, description: '64 ETH (2 validators, exact)' },
      { effectiveBalance: 100, expectedVUnits: 31250n, description: '100 ETH' },
      { effectiveBalance: 515, expectedVUnits: 160938n, description: '515 ETH (ceiling)' },
      { effectiveBalance: 1000, expectedVUnits: 312500n, description: '1000 ETH' },
      { effectiveBalance: 2048, expectedVUnits: 640000n, description: '2048 ETH (max per validator)' },
    ];

    for (const { effectiveBalance, expectedVUnits, description } of testCases) {
      it(`${description}`, async () => {
        const [vUnits, result, success] = await testContract.testRoundtrip(effectiveBalance);
        expect(success).to.be.true;
        expect(result).to.equal(effectiveBalance);
        expect(vUnits).to.equal(expectedVUnits);
      });
    }
  });
});
