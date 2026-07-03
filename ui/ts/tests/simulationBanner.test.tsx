/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from './testUtils/queries'
import { describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'
import { SimulationBanner } from '../components/SimulationBanner.js'
import type { SimulationController } from '../simulation/controller.js'
import { serializeSavedSimulationStateEnvelope } from '../simulation/savedStates.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n

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
		exportState: async name =>
			serializeSavedSimulationStateEnvelope({
				baseScenario: 'baseline',
				name,
				savedAt: '2026-06-02T12:34:56.000Z',
				state: {
					blockCountSinceReset: 0n,
					currentTimestamp: 1n,
					queryDelayMilliseconds: 0,
					repPerEthPrice: 10n ** 18n,
					repPerUsdcPrice: 10n ** 6n,
					selectedAccount,
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
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		simulationSource: {
			kind: 'scenario',
			scenario: 'baseline',
		},
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

function isDetailsElement(element: Element | null): element is HTMLDetailsElement {
	return element instanceof HTMLElement && element.tagName === 'DETAILS'
}

function openAdvancedControls(container: Element): HTMLElement {
	const summary = within(container).getByText('QA controls, prices, and time travel')
	const details = summary.closest('details')
	if (!isDetailsElement(details)) throw new Error('Expected simulation controls to render inside a details disclosure')
	expect(details.open).toBe(false)
	fireEvent.click(summary)
	expect(details.open).toBe(true)
	return details
}

function getElementValue(element: Element) {
	if (!('value' in element)) return undefined
	const value = element.value
	return typeof value === 'string' ? value : undefined
}

describe('SimulationBanner', () => {
	test('shows the selected scenario description', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController({ currentScenario: 'security-pool' })
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByText('One seeded market, one security pool, and one funded vault with an active security bond allowance. Use it to test pool actions and liquidation paths.')).not.toBeNull()
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('labels the scenario and QA account selectors', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByLabelText('Simulation scenario')).toBeTruthy()
			expect(documentQueries.getByLabelText('Simulation QA account')).toBeTruthy()
			const accountSelect = documentQueries.getByLabelText('Simulation QA account')
			const accountOption = accountSelect.querySelector('option')
			if (accountOption === null) throw new Error('Expected QA account option')
			expect(accountOption.getAttribute('value')).toBe(controller.selectedAccount)
			expect(accountOption.textContent).toBe('QA 0x0000…00a1')
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('shows scenario description and bootstrap label while bootstrapping', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController({
			bootstrapLabel: 'Deploying seeded security pool',
			currentScenario: 'security-pool',
			isBootstrapped: false,
			isBootstrapping: true,
		})
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByText('One seeded market, one security pool, and one funded vault with an active security bond allowance. Use it to test pool actions and liquidation paths.')).not.toBeNull()
			expect(documentQueries.getByText('Deploying seeded security pool')).not.toBeNull()
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('refreshes the app after updating the REP/ETH mock price', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const setRepPerEthPrice = mock(() => undefined)
		const controller = createSimulationController({ setRepPerEthPrice })
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const advancedControls = openAdvancedControls(renderedComponent.container)
			const advancedQueries = within(advancedControls)
			const repPerEthLabel = advancedQueries.getByText('REP / ETH mock price')
			const repPerEthInput = repPerEthLabel.parentElement?.querySelector('input')
			if (!(repPerEthInput instanceof HTMLInputElement)) throw new Error('Expected a REP / ETH mock price input')

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

	test('mints REP to the selected QA account and refreshes the app', async () => {
		const domEnvironment = installDomEnvironment()
		const mintRep = mock(async () => undefined)
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController({ mintRep })
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Mint 1 million REP' }))

			await waitFor(() => {
				expect(mintRep).toHaveBeenCalledWith(SIMULATION_REP_MINT_AMOUNT)
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
			const advancedControls = openAdvancedControls(renderedComponent.container)
			const advancedQueries = within(advancedControls)
			expect(advancedQueries.getByText('Actions')).toBeTruthy()
			expect(advancedQueries.getByText('Time travel')).toBeTruthy()

			const expectedPresets = [
				{ label: '+1 hour', seconds: 60n * 60n },
				{ label: '+1 day', seconds: 24n * 60n * 60n },
				{ label: '+1 week', seconds: 7n * 24n * 60n * 60n },
				{ label: '+1 month', seconds: 30n * 24n * 60n * 60n },
				{ label: '+1 year', seconds: 365n * 24n * 60n * 60n },
			] as const

			for (const preset of expectedPresets) {
				expect(advancedQueries.getByRole('button', { name: preset.label })).toBeTruthy()
			}

			for (const [index, preset] of expectedPresets.slice(2).entries()) {
				fireEvent.click(advancedQueries.getByRole('button', { name: preset.label }))
				await waitFor(() => {
					expect(advanceTime).toHaveBeenNthCalledWith(index + 1, preset.seconds)
					expect(onRefresh).toHaveBeenCalledTimes(index + 1)
				})
			}
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('renders saved states in the scenario picker and opens the export modal', async () => {
		const domEnvironment = installDomEnvironment()
		domEnvironment.window.localStorage.setItem(
			'zoltar.simulation.savedStates',
			JSON.stringify([
				{
					baseScenario: 'baseline',
					id: 'saved-baseline-20260602123456',
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:34:56.000Z',
					serialized: serializeSavedSimulationStateEnvelope({
						baseScenario: 'baseline',
						name: 'Saved baseline',
						savedAt: '2026-06-02T12:34:56.000Z',
						state: {
							blockCountSinceReset: 0n,
							currentTimestamp: 1n,
							queryDelayMilliseconds: 0,
							repPerEthPrice: 10n ** 18n,
							repPerUsdcPrice: 10n ** 6n,
							selectedAccount: '0x00000000000000000000000000000000000000a1',
							snapshot: {},
							transactionCountSinceReset: 0n,
							transactionDelayMilliseconds: 0,
						},
						version: 1,
					}),
				},
			]),
		)
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByRole('option', { name: 'Saved baseline' })).toBeTruthy()

			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Export state' }))

			await waitFor(() => {
				const exportDialog = documentQueries.getByRole('dialog')
				expect(within(exportDialog).getByLabelText('JSON state')).toBeTruthy()
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('shows a warning when corrupted saved states are ignored', async () => {
		const domEnvironment = installDomEnvironment()
		domEnvironment.window.localStorage.setItem(
			'zoltar.simulation.savedStates',
			JSON.stringify([
				{
					baseScenario: 'baseline',
					id: 'saved-baseline-20260602123456',
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:34:56.000Z',
					serialized: serializeSavedSimulationStateEnvelope({
						baseScenario: 'baseline',
						name: 'Saved baseline',
						savedAt: '2026-06-02T12:34:56.000Z',
						state: {
							blockCountSinceReset: 0n,
							currentTimestamp: 1n,
							queryDelayMilliseconds: 0,
							repPerEthPrice: 10n ** 18n,
							repPerUsdcPrice: 10n ** 6n,
							selectedAccount: '0x00000000000000000000000000000000000000a1',
							snapshot: {},
							transactionCountSinceReset: 0n,
							transactionDelayMilliseconds: 0,
						},
						version: 1,
					}),
				},
				{
					baseScenario: 'baseline',
					id: 'broken-state',
					name: 'Broken state',
					savedAt: '2026-06-02T12:35:56.000Z',
					serialized: '{bad json',
				},
			]),
		)
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			expect(documentQueries.getByText('Ignored 1 corrupted saved simulation state in browser storage.')).toBeTruthy()
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('lets the user remove corrupted saved states from browser storage', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar?simulate=1&simState=broken-state')
		domEnvironment.window.localStorage.setItem(
			'zoltar.simulation.savedStates',
			JSON.stringify([
				{
					baseScenario: 'baseline',
					id: 'saved-baseline-20260602123456',
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:34:56.000Z',
					serialized: serializeSavedSimulationStateEnvelope({
						baseScenario: 'baseline',
						name: 'Saved baseline',
						savedAt: '2026-06-02T12:34:56.000Z',
						state: {
							blockCountSinceReset: 0n,
							currentTimestamp: 1n,
							queryDelayMilliseconds: 0,
							repPerEthPrice: 10n ** 18n,
							repPerUsdcPrice: 10n ** 6n,
							selectedAccount: '0x00000000000000000000000000000000000000a1',
							snapshot: {},
							transactionCountSinceReset: 0n,
							transactionDelayMilliseconds: 0,
						},
						version: 1,
					}),
				},
				{
					baseScenario: 'baseline',
					id: 'broken-state',
					name: 'Broken state',
					savedAt: '2026-06-02T12:35:56.000Z',
					serialized: '{bad json',
				},
			]),
		)
		const onRefresh = mock(async () => undefined)
		const onEnvironmentChanged = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Remove corrupted saves' }))
			const cleanupDialog = await waitFor(() => documentQueries.getByRole('dialog'))
			fireEvent.click(within(cleanupDialog).getByRole('button', { name: 'Remove corrupted saves' }))

			await waitFor(() => {
				expect(domEnvironment.window.localStorage.getItem('zoltar.simulation.savedStates')).not.toContain('{bad json')
				expect(domEnvironment.window.location.hash).toContain('simScenario=baseline')
				expect(domEnvironment.window.location.hash).not.toContain('simState=')
				expect(onEnvironmentChanged).toHaveBeenCalledTimes(1)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('imports a saved state and navigates to its saved-state URL', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const onEnvironmentChanged = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />)
		const importedState = serializeSavedSimulationStateEnvelope({
			baseScenario: 'baseline',
			name: 'Imported state',
			savedAt: '2026-06-02T12:34:56.000Z',
			state: {
				blockCountSinceReset: 0n,
				currentTimestamp: 1n,
				queryDelayMilliseconds: 0,
				repPerEthPrice: 10n ** 18n,
				repPerUsdcPrice: 10n ** 6n,
				selectedAccount: '0x00000000000000000000000000000000000000a1',
				snapshot: {},
				transactionCountSinceReset: 0n,
				transactionDelayMilliseconds: 0,
			},
			version: 1,
		})

		try {
			const documentQueries = within(renderedComponent.container)
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Import state' }))
			const importDialog = await waitFor(() => documentQueries.getByRole('dialog'))
			const dialogQueries = within(importDialog)
			const textArea = dialogQueries.getByLabelText('JSON state') as HTMLTextAreaElement
			fireEvent.input(textArea, {
				currentTarget: { value: importedState },
				target: { value: importedState },
			})
			fireEvent.click(dialogQueries.getByRole('button', { name: 'Import and load' }))

			await waitFor(() => {
				expect(domEnvironment.window.location.hash).toContain('simState=imported-state-20260602123456')
				expect(onEnvironmentChanged).toHaveBeenCalledTimes(1)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('saves a simulation state and refreshes the loaded saved-state environment', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const onEnvironmentChanged = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Save state' }))
			const saveDialog = await waitFor(() => documentQueries.getByRole('dialog'))
			const dialogQueries = within(saveDialog)
			const nameInput = dialogQueries.getByLabelText('State name') as HTMLInputElement
			fireEvent.input(nameInput, {
				currentTarget: { value: 'Saved via test' },
				target: { value: 'Saved via test' },
			})
			fireEvent.click(dialogQueries.getByRole('button', { name: 'Save' }))

			await waitFor(() => {
				expect(domEnvironment.window.location.hash).toContain('simState=saved-via-test-20260602123456')
				expect(onEnvironmentChanged).toHaveBeenCalledTimes(1)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('switches scenarios through route-state navigation without a full-page reload', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar?simulate=1&simScenario=baseline')
		const onRefresh = mock(async () => undefined)
		const subscribers = new Set<() => void>()
		const controller = createSimulationController({
			subscribe: handler => {
				subscribers.add(handler)
				return () => {
					subscribers.delete(handler)
				}
			},
		})
		const onEnvironmentChanged = mock(async () => {
			controller.currentScenario = 'securitypoolx2'
			controller.simulationSource = {
				kind: 'scenario',
				scenario: 'securitypoolx2',
			}
			for (const subscriber of subscribers) subscriber()
		})
		const pushState = mock(domEnvironment.window.history.pushState.bind(domEnvironment.window.history))
		domEnvironment.window.history.pushState = pushState as typeof domEnvironment.window.history.pushState
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const picker = documentQueries.getAllByRole('combobox')[0]
			if (picker === undefined || picker.tagName !== 'SELECT') throw new Error('Expected the scenario picker')
			fireEvent.change(picker, {
				currentTarget: { value: 'scenario:securitypoolx2' },
				target: { value: 'scenario:securitypoolx2' },
			})

			await waitFor(() => {
				expect(pushState).toHaveBeenCalledTimes(1)
				expect(domEnvironment.window.location.hash).toContain('simScenario=securitypoolx2')
				expect(onEnvironmentChanged).toHaveBeenCalledTimes(1)
				expect(getElementValue(picker)).toBe('scenario:securitypoolx2')
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('shows inline import errors for malformed JSON', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const controller = createSimulationController()
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Import state' }))
			const importDialog = await waitFor(() => documentQueries.getByRole('dialog'))
			const dialogQueries = within(importDialog)
			const textArea = dialogQueries.getByLabelText('JSON state') as HTMLTextAreaElement
			fireEvent.input(textArea, {
				currentTarget: { value: '{bad json' },
				target: { value: '{bad json' },
			})
			fireEvent.click(dialogQueries.getByRole('button', { name: 'Import and load' }))

			await waitFor(() => {
				expect(dialogQueries.getByText(/Failed to update the saved simulation state/i)).toBeTruthy()
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('shows the delete control only for custom saved states', async () => {
		const domEnvironment = installDomEnvironment()
		const onRefresh = mock(async () => undefined)
		const builtInController = createSimulationController()
		const customController = createSimulationController({
			simulationSource: {
				baseScenario: 'baseline',
				kind: 'saved-state',
				name: 'Saved baseline',
				savedAt: '2026-06-02T12:34:56.000Z',
				stateId: 'saved-baseline-20260602123456',
			},
		})
		const builtInRendered = await renderIntoDocument(<SimulationBanner controller={builtInController} onRefresh={onRefresh} />)
		const customRendered = await renderIntoDocument(<SimulationBanner controller={customController} onRefresh={onRefresh} />)

		try {
			const builtInAdvancedControls = openAdvancedControls(builtInRendered.container)
			const customAdvancedControls = openAdvancedControls(customRendered.container)
			expect(within(builtInAdvancedControls).queryByRole('button', { name: 'Delete save' })).toBeNull()
			expect(within(customAdvancedControls).getByRole('button', { name: 'Delete save' })).toBeTruthy()
		} finally {
			await builtInRendered.cleanup()
			await customRendered.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('deletes a saved simulation state and refreshes the fallback scenario environment', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar?simulate=1&simState=saved-baseline-20260602123456')
		domEnvironment.window.localStorage.setItem(
			'zoltar.simulation.savedStates',
			JSON.stringify([
				{
					baseScenario: 'baseline',
					id: 'saved-baseline-20260602123456',
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:34:56.000Z',
					serialized: serializeSavedSimulationStateEnvelope({
						baseScenario: 'baseline',
						name: 'Saved baseline',
						savedAt: '2026-06-02T12:34:56.000Z',
						state: {
							blockCountSinceReset: 0n,
							currentTimestamp: 1n,
							queryDelayMilliseconds: 0,
							repPerEthPrice: 10n ** 18n,
							repPerUsdcPrice: 10n ** 6n,
							selectedAccount: '0x00000000000000000000000000000000000000a1',
							snapshot: {},
							transactionCountSinceReset: 0n,
							transactionDelayMilliseconds: 0,
						},
						version: 1,
					}),
				},
			]),
		)
		const onRefresh = mock(async () => undefined)
		const onEnvironmentChanged = mock(async () => undefined)
		const controller = createSimulationController({
			simulationSource: {
				baseScenario: 'baseline',
				kind: 'saved-state',
				name: 'Saved baseline',
				savedAt: '2026-06-02T12:34:56.000Z',
				stateId: 'saved-baseline-20260602123456',
			},
		})
		const renderedComponent = await renderIntoDocument(<SimulationBanner controller={controller} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />)

		try {
			const documentQueries = within(renderedComponent.container)
			const advancedControls = openAdvancedControls(renderedComponent.container)
			fireEvent.click(within(advancedControls).getByRole('button', { name: 'Delete save' }))
			const deleteDialog = await waitFor(() => documentQueries.getByRole('dialog'))
			fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete save' }))

			await waitFor(() => {
				expect(domEnvironment.window.localStorage.getItem('zoltar.simulation.savedStates')).not.toContain('saved-baseline-20260602123456')
				expect(domEnvironment.window.location.hash).toContain('simScenario=baseline')
				expect(domEnvironment.window.location.hash).not.toContain('simState=')
				expect(onEnvironmentChanged).toHaveBeenCalledTimes(1)
			})
		} finally {
			await renderedComponent.cleanup()
			domEnvironment.cleanup()
		}
	})
})
