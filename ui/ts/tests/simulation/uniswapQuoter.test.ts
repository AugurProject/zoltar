/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { createPublicClient, getAddress, http } from '@zoltar/shared/ethereum'
import { USDC_ADDRESS, quoteEthForToken, quoteExactInput, quoteRepForEth, quoteTokenForEth } from '../../protocol/uniswapQuoter.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { serializeSavedSimulationStateEnvelope } from '../../simulation/savedStates.js'
import type { ReadClient } from '../../lib/clients.js'
import { MAINNET_NETWORK_PROFILE } from '../../lib/networkProfile.js'
import { createFakeBackend, createFakeSimulationProfile } from '../testUtils/fakeBackend.js'

afterEach(() => {
	resetActiveEnvironmentForTesting()
})

function createStubReadClient(): ReadClient {
	const readContract: ReadClient['readContract'] = async () => {
		throw new Error('readContract should not be used in this test')
	}
	const simulateContract: ReadClient['simulateContract'] = async () => {
		throw new Error('simulateContract should not be used in this test')
	}
	return {
		...createPublicClient({
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: http('http://127.0.0.1:8545'),
		}),
		readContract,
		simulateContract,
	}
}

describe('simulation Uniswap quotes', () => {
	test('rejects unsupported pairs when only the simulation REP price is available', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		await expect(quoteRepForEth(createStubReadClient(), 1n)).rejects.toThrow('Simulation mock pricing only supports REP / ETH, REP / WETH, and REP / USDC pairs.')
		resetEnvironment()
	})

	test('returns simulation REP/ETH and REP/USDC mock quotes', async () => {
		const profile = createFakeSimulationProfile()
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile }), {
			accounts: [],
			advanceTime: async () => undefined,
			bootstrapError: undefined,
			bootstrapLabel: undefined,
			bootstrapProgress: undefined,
			blockCountSinceReset: 0n,
			currentTimestamp: 0n,
			currentScenario: 'baseline',
			dispose: async () => undefined,
			exportState: async name =>
				serializeSavedSimulationStateEnvelope({
					baseScenario: 'baseline',
					name,
					savedAt: '2026-06-02T12:34:56.000Z',
					state: {
						blockCountSinceReset: 0n,
						currentTimestamp: 0n,
						queryDelayMilliseconds: 0,
						repPerEthPrice: 2n * 10n ** 18n,
						repPerUsdcPrice: 5n * 10n ** 6n,
						selectedAccount: '0x00000000000000000000000000000000000000a1',
						snapshot: {},
						transactionCountSinceReset: 0n,
						transactionDelayMilliseconds: 0,
					},
					version: 1,
				}),
			isActive: true,
			isBootstrapped: true,
			isBootstrapping: false,
			mintRep: async () => undefined,
			mineBlock: async () => undefined,
			queryDelayMilliseconds: 0,
			repPerEthPrice: 2n * 10n ** 18n,
			repPerUsdcPrice: 5n * 10n ** 6n,
			reset: async () => undefined,
			selectAccount: async () => undefined,
			selectedAccount: getAddress('0x00000000000000000000000000000000000000a1'),
			simulationSource: { kind: 'scenario', scenario: 'baseline' },
			setRepPerEthPrice: () => undefined,
			setRepPerUsdcPrice: () => undefined,
			setQueryDelayMilliseconds: () => undefined,
			subscribe: () => () => undefined,
			transactionCountSinceReset: 0n,
			transactionDelayMilliseconds: 0,
			setTransactionDelayMilliseconds: () => undefined,
			waitUntilReady: async () => undefined,
		})
		const client = createStubReadClient()
		client.readContract = async () => 'REP' as never
		await expect(quoteEthForToken(client, profile.genesisRepTokenAddress, 3n * 10n ** 18n)).resolves.toBe(6n * 10n ** 18n)
		await expect(quoteTokenForEth(client, profile.genesisRepTokenAddress, 6n * 10n ** 18n)).resolves.toBe(3n * 10n ** 18n)
		await expect(quoteExactInput(client, profile.genesisRepTokenAddress, USDC_ADDRESS, 2n * 10n ** 18n)).resolves.toBe(10n * 10n ** 6n)
		await expect(quoteExactInput(client, USDC_ADDRESS, profile.genesisRepTokenAddress, 10n * 10n ** 6n)).resolves.toBe(2n * 10n ** 18n)
		resetEnvironment()
	})
})
