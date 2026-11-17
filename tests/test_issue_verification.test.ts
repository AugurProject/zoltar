// SPDX-License-Identifier: UNLICENSED
import { describe, it, expect, beforeAll } from "bun:test";
import { ethers } from "ethers";
import hre from "hardhat";

/**
 * These tests verify that the newly added upper‑bound check on `rewardDuration`
 * prevents the overflow bug described in issue #<placeholder>. The contract
 * should revert when the sum of the initial timestamp and the vesting duration
 * exceeds the `uint48` maximum, and it should deploy successfully for valid
 * parameters.
 */

describe("SecurityPoolCapitalFeeStreams – reward duration bounds", () => {
  let signer: ethers.Signer;
  let authority: string;

  beforeAll(async () => {
    const accounts = await hre.ethers.getSigners();
    signer = accounts[0];
    authority = await signer.getAddress();
  });

  it("reverts on deployment when timestamp + duration overflows uint48", async () => {
    const factory = await hre.ethers.getContractFactory("SecurityPoolCapitalFeeStreams", signer);
    const maxUint48 = (2n ** 48n) - 1n;
    const now = Math.floor(Date.now() / 1000);
    // Choose a duration that will overflow when added to `now`.
    const overflowDuration = Number(maxUint48 - BigInt(now) + 1n);
    await expect(
      factory.deploy(authority, now, overflowDuration)
    ).rejects.toThrow(/Invalid fee duration/);
  });

  it("deploys successfully when parameters are within bounds", async () => {
    const factory = await hre.ethers.getContractFactory("SecurityPoolCapitalFeeStreams", signer);
    const now = Math.floor(Date.now() / 1000);
    const safeDuration = 30 * 24 * 60 * 60; // 30 days, comfortably below the uint48 ceiling
    const contract = await factory.deploy(authority, now, safeDuration);
    await contract.deployed();
    // Verify immutable fields are set correctly.
    expect(await contract.capitalLedger()).toBe(authority);
    expect(Number(await contract.rewardDuration())).toBe(safeDuration);
    expect(Number(await contract.releasedThrough())).toBe(now);
  });
});
