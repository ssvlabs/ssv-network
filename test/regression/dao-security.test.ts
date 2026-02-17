/**
 * Regression Tests: DAO Security Issues
 *
 * These tests assert the CORRECT behavior for governance parameter validation.
 * They are expected to FAIL on the current code, proving the bugs are real.
 * Once fixes land, they should flip to passing.
 *
 * SEC-1: setQuorumBps(0) should revert — prevents zero-threshold oracle commits
 * SEC-4: setUnstakeCooldownDuration(0) should revert — prevents instant unstaking
 */
import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import { Errors } from "../common/errors.ts";

describe("Regression: DAO Security Issues", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  describe("SEC-1: setQuorumBps(0) should revert", () => {
    it("Reverts when setting quorum to zero (prevents zero-threshold commits)", async function () {
      const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

      // A zero quorum means any single oracle can commit a root with 0% weight needed.
      // This should be rejected to prevent trivial manipulation of the EB oracle system.
      //
      // EXPECTED: Reverts with InvalidQuorum
      // ACTUAL (BUG): Succeeds, setting quorum to 0
      await expect(dao.setQuorumBps(0))
        .to.be.revertedWithCustomError(dao, Errors.INVALID_QUORUM);
    });
  });

  describe("SEC-4: setUnstakeCooldownDuration(0) should revert", () => {
    it("Reverts when setting cooldown duration to zero (prevents instant unstaking)", async function () {
      const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

      // A zero cooldown allows immediate unstaking, bypassing the security
      // purpose of the cooldown period (preventing flash-loan governance attacks
      // and ensuring oracle quorum votes reflect genuine stake commitment).
      //
      // EXPECTED: The call either reverts, or enforces a minimum duration > 0
      // ACTUAL (BUG): Succeeds and stores 0, allowing zero cooldown
      await dao.setUnstakeCooldownDuration(0);
      const storedDuration = await dao.getCooldownDuration();
      expect(storedDuration).to.not.equal(0n);
    });
  });
});
