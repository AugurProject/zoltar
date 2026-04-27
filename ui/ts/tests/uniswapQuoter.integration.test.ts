/// <reference types="bun-types" />

/**
 * Integration tests — these hit the real Ethereum mainnet RPC.
 * They verify on-chain behavior and are intentionally separate from the unit tests
 * in uniswapQuoter.test.ts which mock all contract calls.
 */

import { describe, expect, test } from 'bun:test'
import { createPublicClient, http, zeroAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { ETH_ADDRESS, REP_ADDRESS, USDC_ADDRESS, quoteExactInput, quoteRepForEth, quoteRepForEthV3, quoteEthForRep, quoteTokenForEth } from '../lib/uniswapQuoter.js'

const RPC_URL = 'https://ethereum.dark.florist'

const client = createPublicClient({
	chain: mainnet,
	transport: http(RPC_URL),
})

const ONE_ETH = 10n ** 18n
const ONE_REP = 10n ** 18n

void describe('Uniswap V4 Quoter — integration', () => {
	// Sanity check: ETH/USDC 0.05% pool is established and should always return a price
	void describe('ETH/USDC (0.05% pool — known to exist on V4)', () => {
		void test('quotes 1 ETH → USDC and returns a plausible price', async () => {
			const usdcOut = await quoteExactInput(client, ETH_ADDRESS, USDC_ADDRESS, ONE_ETH, { fee: 500, tickSpacing: 10 })
			// At time of writing ETH is roughly $2 191 — assert a wide range to keep test non-brittle
			expect(usdcOut).toBeGreaterThan(100n * 10n ** 6n) // > $100 USDC
			expect(usdcOut).toBeLessThan(100_000n * 10n ** 6n) // < $100 000 USDC
		})

		void test('quotes 1 USDC → ETH and returns a plausible price', async () => {
			const ethOut = await quoteExactInput(client, USDC_ADDRESS, ETH_ADDRESS, 1n * 10n ** 6n, { fee: 500, tickSpacing: 10 })
			// 1 USDC should buy a small fraction of ETH (more than 0 wei, less than 1 ETH)
			expect(ethOut).toBeGreaterThan(0n)
			expect(ethOut).toBeLessThan(ONE_ETH)
		})
	})

	// REP does not have any V4 pools at time of writing.
	// These tests document the current on-chain reality and are expected to throw.
	// If REP V4 pools are ever created, these tests will start returning prices instead.
	void describe('REP/ETH — no V4 pool exists yet', () => {
		void test('quoteRepForEth throws because no V4 REP pool exists', async () => {
			await expect(quoteRepForEth(client, ONE_REP)).rejects.toThrow()
		})

		void test('quoteEthForRep throws because no V4 REP pool exists', async () => {
			await expect(quoteEthForRep(client, ONE_ETH)).rejects.toThrow()
		})

		void test('quoteTokenForEth(REP) throws for all standard fee tiers', async () => {
			for (const poolConfig of [
				{ fee: 100, tickSpacing: 1 },
				{ fee: 500, tickSpacing: 10 },
				{ fee: 3000, tickSpacing: 60 },
				{ fee: 10000, tickSpacing: 200 },
			]) {
				await expect(quoteTokenForEth(client, REP_ADDRESS, ONE_REP, poolConfig)).rejects.toThrow()
			}
		})
	})

	void describe('REP/USDC — no V4 pool exists yet', () => {
		void test('quoteExactInput(REP→USDC) throws because no V4 REP pool exists', async () => {
			await expect(quoteExactInput(client, REP_ADDRESS, USDC_ADDRESS, ONE_REP)).rejects.toThrow()
		})

		void test('quoteEthForToken(USDC via REP) throws for all standard fee tiers', async () => {
			for (const poolConfig of [
				{ fee: 100, tickSpacing: 1 },
				{ fee: 500, tickSpacing: 10 },
				{ fee: 3000, tickSpacing: 60 },
				{ fee: 10000, tickSpacing: 200 },
			]) {
				await expect(quoteExactInput(client, REP_ADDRESS, USDC_ADDRESS, ONE_REP, poolConfig)).rejects.toThrow()
			}
		})
	})

	// REP/WETH V3 1% pool is the live source used as fallback when V4 is unavailable
	void describe('REP/ETH — Uniswap V3 (1% pool)', () => {
		void test('quoteRepForEthV3 returns a plausible REP price in ETH', async () => {
			const ethOut = await quoteRepForEthV3(client, ONE_REP)
			// At time of writing REP is roughly $0.40 and ETH ~$2 191 → ~0.00018 ETH per REP
			// Assert a wide range to avoid brittleness
			expect(ethOut).toBeGreaterThan(10n ** 12n) // > 0.000001 ETH
			expect(ethOut).toBeLessThan(10n ** 18n) // < 1 ETH
		})
	})

	void describe('address constants', () => {
		void test('ETH_ADDRESS is zeroAddress', () => {
			expect(ETH_ADDRESS).toBe(zeroAddress)
		})

		void test('REP_ADDRESS is a valid checksummed address accepted by viem', async () => {
			// If REP_ADDRESS had a bad checksum, getBlockNumber would still work but this
			// call would throw an address validation error before any RPC call is made.
			await expect(
				client.readContract({
					address: REP_ADDRESS,
					abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
					functionName: 'decimals',
				}),
			).resolves.toBe(18)
		})

		void test('USDC_ADDRESS is a valid checksummed address with 6 decimals', async () => {
			await expect(
				client.readContract({
					address: USDC_ADDRESS,
					abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
					functionName: 'decimals',
				}),
			).resolves.toBe(6)
		})
	})
})
