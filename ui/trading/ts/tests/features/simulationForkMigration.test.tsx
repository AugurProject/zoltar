/// <reference types='bun-types' />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { LiveSettlementControls } from '../../features/LiveSettlementControls.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { loadForkMigrationContext } from '../../protocol/forks.js'
import { createTradingWalletClient, discoverLiveUniverseMarketPage, loadLiveBalances } from '../../protocol/live.js'
import { FORKED_TRADING_SIMULATION_SCENARIO, registerTradingSimulationScenario } from '../../simulation/index.js'
import { buttonByLabel } from '../support/dom.js'

function forkedScenarioConfiguration(backend: SimulationBackend) {
	const addresses = getInfraContractAddresses(backend.profile)
	const plan = getTradingDeploymentPlan(
		{
			chainId: backend.profile.chain.id,
			chainName: backend.profile.displayName,
			defaultRpcUrl: 'http://127.0.0.1/',
			id: 'simulation',
			proxyDeployer: PROXY_DEPLOYER_ADDRESS,
			securityPoolFactory: addresses.securityPoolFactory,
			zoltar: addresses.zoltar,
		},
		30,
	)
	return deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
}

function operationButton(label: string) {
	const match = Array.from(document.querySelectorAll('[aria-label="Settlement operation"] button')).find(button => button.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing ${label} operation`)
	return match
}

describe(`${FORKED_TRADING_SIMULATION_SCENARIO} simulation scenario`, () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry(FORKED_TRADING_SIMULATION_SCENARIO, 1, 'trading')
		await backend.setTransactionDelayMilliseconds(0)
		await backend.setQueryDelayMilliseconds(0)
	}, 300_000)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	test('is registered for the Trading scenario picker', () => {
		registerTradingSimulationScenario()
		expect(getRegisteredSimulationScenarios()).toContain(FORKED_TRADING_SIMULATION_SCENARIO)
		expect(getSimulationScenarioLabel(FORKED_TRADING_SIMULATION_SCENARIO)).toBe('Trading after a fork')
	})

	test('forks the funded market universe while the wallet keeps its parent-universe shares and a branch has a child pool', async () => {
		activateSimulationBackendProfile(backend)
		const client = backend.createReadClient()
		const { markets } = await discoverLiveUniverseMarketPage(client, forkedScenarioConfiguration(backend), 0n)
		const market = markets[0]
		if (market === undefined || market.loadError !== undefined) throw new Error('Forked scenario market is missing')
		expect(market.universeForkTime).toBeGreaterThan(0n)
		expect(market.pair).toBeDefined()
		const account = backend.accounts[0]
		if (account === undefined) throw new Error('Simulation wallet is missing')
		const balances = await loadLiveBalances(client, market, account)
		for (const balance of [balances.yes, balances.no, balances.invalid, balances.lp]) expect(balance).toBeGreaterThan(0n)
		const context = await loadForkMigrationContext(client, market)
		expect(context.kind).toBe('categorical')
		expect(context.availableTargets.map(target => target.label)).toEqual(['Invalid', 'Yes', 'No'])
		expect(context.availableTargets.find(target => target.label === 'Yes')?.canonicalPool).toBeDefined()
	}, 60_000)

	test('enables Fork migration behind the full-balance acknowledgment and migrates the shares on chain', async () => {
		activateSimulationBackendProfile(backend)
		const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=trading-forked')
		const restore = installActiveEnvironmentForTesting(backend, backend)
		const configuration = forkedScenarioConfiguration(backend)
		const client = backend.createReadClient()
		const { markets } = await discoverLiveUniverseMarketPage(client, configuration, 0n)
		const market = markets[0]
		const account = backend.accounts[0]
		if (market === undefined || account === undefined) throw new Error('Forked scenario market or wallet is missing')
		const balances = await loadLiveBalances(client, market, account)
		let refreshes = 0
		const rendered = await renderIntoDocument(
			<LiveSettlementControls
				nowSeconds={100n}
				configuration={configuration}
				market={market}
				balances={balances}
				balanceState='ready'
				balanceError={undefined}
				account={account}
				walletClient={createTradingWalletClient(backend.getProvider(), account)}
				networkMismatchReason={undefined}
				wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
				settings={DEFAULT_TRADE_SETTINGS}
				externallyLocked={false}
				refresh={async () => {
					refreshes += 1
				}}
				onKnownReceipt={() => undefined}
				executeWithCurrentWalletContext={async (_account, _networkFailure, _accountFailure, action) => await action()}
				createGuardedWalletWrite={() => async write => await write()}
				retryBalances={async () => undefined}
				onWorkflowLockChange={() => undefined}
			/>,
		)
		try {
			expect(operationButton('Fork migration').disabled).toBe(false)
			expect(operationButton('Fork migration').getAttribute('aria-pressed')).toBe('true')
			expect(operationButton('Complete set').disabled).toBe(true)
			await waitFor(() => expect(document.body.textContent).toContain('Will this resolve?'), { timeout: 10_000 })
			const yesTarget = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('Yes') === true && candidate.closest('[aria-label="Settlement operation"]') === null && candidate.closest('.enum-dropdown') === null)
			if (!(yesTarget instanceof HTMLButtonElement)) throw new Error('Missing Yes fork target')
			await act(() => yesTarget.click())
			await waitFor(() => expect(document.body.textContent).toContain('Migrates your entire balance'), { timeout: 10_000 })
			const acknowledgment = document.querySelector('.trade-impact-acknowledge input[type="checkbox"]')
			if (!(acknowledgment instanceof HTMLInputElement)) throw new Error('Missing migration acknowledgment')
			expect(acknowledgment.checked).toBe(false)
			expect(acknowledgment.closest('label')?.textContent).toContain('into the selected branches and permanently locks my Yes transfers')
			expect(buttonByLabel('Migrate to 1 branch').disabled).toBe(true)
			await act(() => acknowledgment.click())
			// The action also waits for the migration quote, which can land just after the acknowledgment.
			await waitFor(() => expect(buttonByLabel('Migrate to 1 branch').disabled).toBe(false), { timeout: 10_000 })
			await act(() => buttonByLabel('Migrate to 1 branch').click())
			await waitFor(() => expect(document.body.textContent).toContain('Migrate to 1 branch confirmed.'), { timeout: 20_000 })
			expect(refreshes).toBeGreaterThan(0)
		} finally {
			await rendered.cleanup()
			restore()
			dom.cleanup()
		}
	}, 60_000)
})
