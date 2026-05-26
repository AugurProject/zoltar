/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { waitFor, within } from '@testing-library/dom'
import type { Address } from 'viem'
import { createPublicClient, http } from 'viem'
import type { SimulationController } from '../simulation/controller.js'
import { useRepPrices } from '../hooks/useRepPrices.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { ChainBackend, ReadClient } from '../lib/chainBackend.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createSimulationController(): SimulationController {
	const selectedAccount = '0x00000000000000000000000000000000000000a1' as Address

	return {
		accounts: [],
		advanceTime: async () => undefined,
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentTimestamp: 0n,
		currentScenario: 'baseline',
		dispose: async () => undefined,
		isActive: true,
		isBootstrapped: true,
		isBootstrapping: false,
		mintRep: async () => undefined,
		mineBlock: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		setRepPerEthPrice: () => undefined,
		setRepPerUsdcPrice: () => undefined,
		setQueryDelayMilliseconds: () => undefined,
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		setTransactionDelayMilliseconds: () => undefined,
		waitUntilReady: async () => undefined,
	}
}

function PriceProbe() {
	const { repPerEthPrice, repUsdcPrice } = useRepPrices()

	return (
		<div>
			<span data-testid='rep-per-eth'>{repPerEthPrice?.toString() ?? '-'}</span>
			<span data-testid='rep-per-usdc'>{repUsdcPrice?.toString() ?? '-'}</span>
		</div>
	)
}

describe('useRepPrices', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		resetActiveEnvironmentForTesting()
	})

	test('loads simulation mock REP prices using the active profile REP token', async () => {
		const profile = createFakeSimulationProfile()
		const readClient: ReadClient = {
			...createPublicClient({
				chain: profile.chain,
				transport: http('http://127.0.0.1:8545'),
			}),
		}
		readClient.readContract = async () => 'REP' as never
		readClient.simulateContract = async () => {
			throw new Error('Simulation mock pricing should not hit the onchain quoter')
		}
		const backend: ChainBackend = {
			...createFakeBackend({ profile }),
			createReadClient: () => readClient,
		}

		const resetEnvironment = installActiveEnvironmentForTesting(backend, createSimulationController())

		const renderedComponent = await renderIntoDocument(<PriceProbe />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getByTestId('rep-per-eth').textContent).toBe((10n ** 18n).toString())
			expect(documentQueries.getByTestId('rep-per-usdc').textContent).toBe((10n ** 6n).toString())
		})
		resetEnvironment()
	})
})
