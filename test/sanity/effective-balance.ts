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

  describe('Ceiling division fix', () => {
    // Test cases: values that would lose precision with floor division
    const testCases = [
      { effectiveBalance: 515, description: '515 ETH (loses 1 ETH with old formula)' },
      { effectiveBalance: 32, description: '32 ETH (1 validator, exact)' },
      { effectiveBalance: 64, description: '64 ETH (2 validators, exact)' },
      { effectiveBalance: 33, description: '33 ETH (1 validator + 1)' },
      { effectiveBalance: 63, description: '63 ETH (2 validators - 1)' },
      { effectiveBalance: 100, description: '100 ETH' },
      { effectiveBalance: 1000, description: '1000 ETH' },
      { effectiveBalance: 2048, description: '2048 ETH (max per validator)' },
      { effectiveBalance: 0, description: '0 ETH (edge case)' },
      { effectiveBalance: 1, description: '1 ETH (minimum)' },
      { effectiveBalance: 31, description: '31 ETH (below 1 validator)' },
    ];

    for (const { effectiveBalance, description } of testCases) {
      it(`Roundtrip preserves value: ${description}`, async () => {
        const [result, success] = await testContract.testRoundtrip(effectiveBalance);
        expect(success).to.be.true;
        expect(Number(result)).to.equal(effectiveBalance);
      });
    }
  });

  describe('Old formula (floor division) demonstrates precision loss', () => {
    it('515 ETH loses 1 ETH with old formula', async () => {
      const [result, success] = await testContract.testRoundtripOld(515);
      expect(success).to.be.false; // Old formula fails
      expect(Number(result)).to.equal(514); // Lost 1 ETH
    });

    it('33 ETH loses 1 ETH with old formula', async () => {
      const [result, success] = await testContract.testRoundtripOld(33);
      expect(success).to.be.false;
      expect(Number(result)).to.equal(32);
    });
  });

  describe('Conversion functions', () => {
    it('effectiveBalanceToVUnits: 32 ETH = 10000 vUnits', async () => {
      const vUnits = await testContract.effectiveBalanceToVUnits(32);
      expect(vUnits).to.equal(10000n);
    });

    it('effectiveBalanceToVUnits: 64 ETH = 20000 vUnits', async () => {
      const vUnits = await testContract.effectiveBalanceToVUnits(64);
      expect(vUnits).to.equal(20000n);
    });

    it('vUnitsToEffectiveBalance: 10000 vUnits = 32 ETH', async () => {
      const eb = await testContract.vUnitsToEffectiveBalance(10000);
      expect(Number(eb)).to.equal(32);
    });

    it('vUnitsToEffectiveBalance: 20000 vUnits = 64 ETH', async () => {
      const eb = await testContract.vUnitsToEffectiveBalance(20000);
      expect(Number(eb)).to.equal(64);
    });

    it('Ceiling division rounds up correctly for 515 ETH', async () => {
      // With ceiling: (515 * 10000 + 31) / 32 = 160938
      const vUnits = await testContract.effectiveBalanceToVUnits(515);
      expect(vUnits).to.equal(160938n);

      // Read back: (160938 * 32) / 10000 = 515
      const eb = await testContract.vUnitsToEffectiveBalance(vUnits);
      expect(Number(eb)).to.equal(515);
    });
  });
});
