/// <reference types="bun-types" />

/**
 * Integration tests — these hit the real Ethereum mainnet RPC.
 * They verify on-chain behavior and are intentionally separate from the unit tests
 * in uniswapQuoter.test.ts which mock all contract calls.
 */

import { describe as baseDescribe, expect, test } from 'bun:test'
import { createPublicClient, http, zeroAddress } from '@zoltar/shared/ethereum'
import { mainnet } from '@zoltar/shared/ethereum'
import { ETH_ADDRESS, REP_ADDRESS, USDC_ADDRESS, quoteExactInput } from '../../protocol/uniswapQuoter.js'

const RPC_URL = 'https://ethereum.dark.florist'

const client = createPublicClient({
	chain: mainnet,
	transport: http(RPC_URL),
})

const ATTO_ETH_PER_ETH = 10n ** 18n
const describe = process.env['RUN_MAINNET_INTEGRATION_TESTS'] === '1' ? baseDescribe : baseDescribe.skip

void describe('Uniswap mainnet smoke checks', () => {
	// Sanity check: ETH/USDC 0.05% pool is established and should always return a price
	void describe('ETH/USDC (0.05% pool — known to exist on V4)', () => {
		void test('quotes 1 ETH → USDC and returns a plausible price', async () => {
			const usdcOut = await quoteExactInput(client, ETH_ADDRESS, USDC_ADDRESS, ATTO_ETH_PER_ETH, { fee: 500, tickSpacing: 10 })
			// At time of writing ETH is roughly $2 191 — assert a wide range to keep test non-brittle
			expect(usdcOut).toBeGreaterThan(100n * 10n ** 6n) // > $100 USDC
			expect(usdcOut).toBeLessThan(100_000n * 10n ** 6n) // < $100 000 USDC
		})

		void test('quotes 1 USDC → ETH and returns a plausible price', async () => {
			const ethOut = await quoteExactInput(client, USDC_ADDRESS, ETH_ADDRESS, 1n * 10n ** 6n, { fee: 500, tickSpacing: 10 })
			// 1 USDC should buy a small fraction of ETH (more than 0 attoETH, less than 1 ETH)
			expect(ethOut).toBeGreaterThan(0n)
			expect(ethOut).toBeLessThan(ATTO_ETH_PER_ETH)
		})
	})

	void describe('address constants', () => {
		void test('ETH_ADDRESS is zeroAddress', () => {
			expect(ETH_ADDRESS).toBe(zeroAddress)
		})

		void test('REP_ADDRESS is a valid checksummed address accepted by the shared address validator', async () => {
			// If REP_ADDRESS had a bad checksum, getBlockNumber would still work but this
			// call would throw an address validation error before any RPC call is made.
			const repDecimals = await client.readContract({
				address: REP_ADDRESS,
				abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
				functionName: 'decimals',
			})
			if (typeof repDecimals !== 'bigint') {
				throw new Error('REP decimals should decode to a bigint')
			}
			if (repDecimals !== 18n) throw new Error('Expected REP decimals to be 18')
		})

		void test('USDC_ADDRESS is a valid checksummed address with 6 decimals', async () => {
			const usdcDecimals = await client.readContract({
				address: USDC_ADDRESS,
				abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
				functionName: 'decimals',
			})
			if (typeof usdcDecimals !== 'bigint') {
				throw new Error('USDC decimals should decode to a bigint')
			}
			if (usdcDecimals !== 6n) throw new Error('Expected USDC decimals to be 6')
		})
	})
})
