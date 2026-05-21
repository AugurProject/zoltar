/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from '@testing-library/dom'
import { describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'
import { SimulationBanner } from '../components/SimulationBanner.js'
import type { SimulationController } from '../simulation/controller.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createSimulationController(overrides: Partial<SimulationController> = {}): SimulationController {
	const selectedAccount = '0x00000000000000000000000000000000000000a1' as Address

	return {
		accounts: [selectedAccount],
		advanceTime: async () => undefined,
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentTimestamp: 1n,
		currentScenario: 'baseline',
		dispose: async () => undefined,
		isActive: true,
		isBootstrapped: true,
		isBootstrapping: false,
		mineBlock: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		setQueryDelayMilliseconds: () => undefined,
		setRepPerEthPrice: () => undefined,
		setRepPerUsdcPrice: () => undefined,
		setTransactionDelayMilliseconds: () => undefined,
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		waitUntilReady: async () => undefined,
		...overrides,
	}
}

describe('SimulationBanner', () => {
	test('refreshes the app after updating the REP/ETH mock price', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const setRepPerEthPrice = mock(() => undefined)
		const controller = createSimulationController({ setRepPerEthPrice })
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const repPerEthLabel = documentQueries.getByText('REP / ETH mock price')
			const repPerEthInput = repPerEthLabel.parentElement?.querySelector('input')
			if (!(repPerEthInput instanceof HTMLInputElement)) {
				throw new Error('Expected a REP / ETH mock price input')
			}

			fireEvent.input(repPerEthInput, {
				currentTarget: { value: '2' },
				target: { value: '2' },
			})
			fireEvent.change(repPerEthInput, {
				currentTarget: { value: '2' },
				target: { value: '2' },
			})

			await waitFor(() => {
				expect(setRepPerEthPrice).toHaveBeenCalledWith(2n * 10n ** 18n)
				expect(onRefresh).toHaveBeenCalledTimes(1)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('renders grouped time presets and advances time for the new durations', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const advanceTime = mock(async () => undefined)
		const controller = createSimulationController({ advanceTime })
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByText('Actions')).toBeTruthy()
			expect(documentQueries.getByText('Time travel')).toBeTruthy()

			const expectedPresets = [
				{ label: '+1 hour', seconds: 60n * 60n },
				{ label: '+1 day', seconds: 24n * 60n * 60n },
				{ label: '+1 week', seconds: 7n * 24n * 60n * 60n },
				{ label: '+1 month', seconds: 30n * 24n * 60n * 60n },
				{ label: '+1 year', seconds: 365n * 24n * 60n * 60n },
			] as const

			for (const preset of expectedPresets) {
				expect(documentQueries.getByRole('button', { name: preset.label })).toBeTruthy()
			}

			for (const preset of expectedPresets.slice(2)) {
				fireEvent.click(documentQueries.getByRole('button', { name: preset.label }))
				await waitFor(() => {
					expect(advanceTime).toHaveBeenCalledWith(preset.seconds)
				})
			}

			await waitFor(() => {
				expect(onRefresh).toHaveBeenCalledTimes(3)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})
})
