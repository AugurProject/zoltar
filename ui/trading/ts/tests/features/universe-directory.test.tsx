import { beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { UniverseDirectory } from '../../features/UniverseDirectory.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { getTradingEnvironmentLocationKey, installTradingRouting } from '../../lib/routing.js'

const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{ exists: true, forkTime: 1n, outcomeIndex: 0n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n },
			{ exists: false, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n },
		],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 1n,
		...overrides,
	}
}

beforeEach(() => installTradingRouting())

describe('universe directory', () => {
	let cleanupRendered: (() => Promise<void>) | undefined
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/#/universe?universe=1',
	})

	test('describes the selected universe and opens child universes through the shared universe query parameter', async () => {
		const rendered = await renderIntoDocument(<UniverseDirectory configuration={configuration} loadUniverse={async () => createUniverse()} universeId={1n} />)
		cleanupRendered = rendered.cleanup
		const queries = within(rendered.container)
		await waitFor(() => expect(queries.queryByText('Child universes')).not.toBeNull())
		expect(rendered.container.querySelector('.route-header')?.textContent).toContain('Universe')
		expect(rendered.container.querySelectorAll('.entity-card-list .entity-card')).toHaveLength(2)
		expect(rendered.container.textContent).toContain('Yes')
		expect(rendered.container.textContent).toContain('Not deployed')
		// Only an existing child can be opened; the link carries the universe parameter every route reads.
		const selectLinks = Array.from(rendered.container.querySelectorAll<HTMLAnchorElement>('.entity-card .universe-link')).filter(link => link.textContent === 'Select')
		expect(selectLinks).toHaveLength(1)
		expect(selectLinks[0]?.getAttribute('href')).toBe('#/universe?universe=2')
		expect(queries.getByRole('link', { name: 'Go to Genesis universe' }).getAttribute('href')).toBe('#/universe?universe=0')
		expect(rendered.container.querySelector('select')).toBeNull()
	})

	test('marks the selected child, omits the genesis action on genesis, and reports an unknown universe', async () => {
		const rendered = await renderIntoDocument(<UniverseDirectory configuration={configuration} loadUniverse={async () => createUniverse({ universeId: 0n, parentUniverseId: 0n, hasForked: true })} universeId={2n} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('Child universes'))
		expect(Array.from(rendered.container.querySelectorAll('.entity-card .badge')).map(badge => badge.textContent)).toEqual(['Selected', 'Not deployed'])
		await rendered.cleanup()

		const genesis = await renderIntoDocument(<UniverseDirectory configuration={configuration} loadUniverse={async () => createUniverse({ universeId: 0n, childUniverses: [] })} universeId={0n} />)
		cleanupRendered = genesis.cleanup
		await waitFor(() => expect(genesis.container.textContent).toContain('No child universes are deployed for this universe.'))
		expect(within(genesis.container).queryByRole('link', { name: 'Go to Genesis universe' })).toBeNull()
		await genesis.cleanup()

		const missing = await renderIntoDocument(<UniverseDirectory configuration={configuration} loadUniverse={async () => undefined} universeId={9n} />)
		cleanupRendered = missing.cleanup
		await waitFor(() => expect(missing.container.textContent).toContain('Universe 0x9 is not deployed on this network.'))
	})

	test('recovers a failed universe read with a retry', async () => {
		let attempts = 0
		const rendered = await renderIntoDocument(
			<UniverseDirectory
				configuration={configuration}
				loadUniverse={async () => {
					attempts += 1
					if (attempts === 1) throw new Error('RPC unavailable')
					return createUniverse()
				}}
				universeId={1n}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('RPC unavailable'))
		within(rendered.container).getByRole('button', { name: 'Retry' }).click()
		await waitFor(() => expect(rendered.container.textContent).toContain('Child universes'))
		expect(attempts).toBe(2)
	})

	test('the universe route waits for discovery, reports a failed discovery with a retry, and describes the universe once confirmed', async () => {
		let discoveries = 0
		const discoveryStates: string[] = []
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				discoveries += 1
				if (discoveries === 1) throw new Error('registry RPC unavailable')
				return { start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n, 1n], selectedUniverseId: 1n }
			},
		}
		const universesChanges: Array<readonly bigint[]> = []
		const view = (confirmedUniverseId: string | undefined) => (
			<LiveTrading
				route='universe'
				configuration={configuration}
				configurationError={undefined}
				selectedUniverseId='1'
				confirmedUniverseId={confirmedUniverseId}
				loadUniverseSummary={async () => createUniverse()}
				onWorkflowLockChange={() => undefined}
				onUniversesChange={ids => universesChanges.push(ids)}
				onDiscoveryStateChange={state => discoveryStates.push(state)}
				controllerServices={services}
			/>
		)
		const rendered = await renderIntoDocument(view(undefined))
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('Universe discovery failed: registry RPC unavailable'))
		expect(rendered.container.textContent).not.toContain('Security pool discovery failed')
		await waitFor(() => expect(discoveryStates.at(-1)).toBe('error'))
		expect(rendered.container.textContent).not.toContain('Loading universe details')
		expect(rendered.container.querySelector('#app-content, .route-header')?.textContent).toContain('Universe')
		await act(() => within(rendered.container).getByRole('button', { name: 'Retry' }).click())
		await waitFor(() => expect(universesChanges.at(-1)).toEqual([0n, 1n]))
		// The state callback runs from an effect, one commit after the answer itself.
		await waitFor(() => expect(discoveryStates.at(-1)).toBe('ready'))
		// The shell confirms the universe from the discovery result; until then the route keeps its loading state.
		expect(rendered.container.textContent).toContain('Loading universe details')
		expect(rendered.container.textContent).not.toContain('Child universes')
		await act(() => render(view('1'), rendered.container))
		await waitFor(() => expect(rendered.container.textContent).toContain('Child universes'))
		expect(rendered.container.querySelectorAll('.entity-card-list .entity-card')).toHaveLength(2)
	})

	test('redacts an address-bearing discovery error to the universe lead without prefixing it twice', async () => {
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				throw new Error(`call to 0x${'ab'.repeat(20)} reverted`)
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route='universe' configuration={configuration} configurationError={undefined} selectedUniverseId='0' confirmedUniverseId={undefined} onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('Universe discovery failed'))
		const notice = rendered.container.querySelector('[role="alert"]')?.textContent ?? ''
		expect(notice).toBe('Universe discovery failed')
		expect(notice).not.toContain('Security pool')
		expect(notice).not.toContain('0xab')
	})

	test('names a redacted portfolio discovery failure once as well', async () => {
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverAllLiveMarketsInUniverse: async () => {
				throw new Error(`call to 0x${'ab'.repeat(20)} reverted`)
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='0' confirmedUniverseId='0' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('Security pool discovery failed'))
		for (const alert of Array.from(rendered.container.querySelectorAll('[role="alert"]'))) expect(alert.textContent?.match(/Security pool discovery failed/g) ?? []).toHaveLength(1)
	})

	test('changing the universe does not count as an environment change', () => {
		const base = getTradingEnvironmentLocationKey({ hash: '#/market?simulate=1&simScenario=deployed', search: '' })
		expect(getTradingEnvironmentLocationKey({ hash: '#/market?simulate=1&simScenario=deployed&universe=2', search: '' })).toBe(base)
		expect(getTradingEnvironmentLocationKey({ hash: '#/market?simulate=1&simScenario=baseline', search: '' })).not.toBe(base)
	})
})
