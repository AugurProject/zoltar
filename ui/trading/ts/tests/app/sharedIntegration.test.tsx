import { expect, test } from 'bun:test'
import { registerTradingSimulationScenario, TRADING_SIMULATION_SCENARIO } from '../../simulation/index.js'
import { getRegisteredSimulationScenarios } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { tradingActiveEnvironmentDependencies } from '../../app/activeEnvironment.js'
import { AddressValue, Status } from '../../components/Status.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { App, currentRoute, tradingNetworkLabel } from '../../app/App.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { getCurrentRouteHash, getRouteHashSearch, resetRoutingForTesting } from '@zoltar/ui-core-shared/lib/routing.js'
import { getTradingRouteHref, installTradingRouting } from '../../lib/routing.js'

test('Trading registers its shared TEVM scenario and selects its own worker', () => {
	registerTradingSimulationScenario()
	expect(tradingActiveEnvironmentDependencies.appId).toBe('trading')
	expect(getRegisteredSimulationScenarios()).toContain(TRADING_SIMULATION_SCENARIO)
})

test('Trading installs shared routing for simulation scenario navigation', () => {
	const dom = installDomEnvironment('http://localhost/#/liquidity?simulate=1&simScenario=trading')
	try {
		installTradingRouting()
		expect(getCurrentRouteHash()).toBe('#/liquidity')
		expect(getRouteHashSearch()).toBe('?simulate=1&simScenario=trading')
		expect(currentRoute()).toBe('liquidity')
		expect(getTradingRouteHref('#/markets')).toBe('#/markets?simulate=1&simScenario=trading')
	} finally {
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading production links preserve the active simulation route query', async () => {
	const productionSources = ['app/App.tsx', 'components/Status.tsx', 'features/LiveTrading.tsx', 'features/MarketDetail.tsx', 'features/Routes.tsx']
	for (const source of productionSources) {
		const contents = await readFile(join(import.meta.dir, '../..', source), 'utf8')
		expect(contents).not.toMatch(/href=['"]#\//)
	}
})

test('Trading refreshes the active environment when history changes the simulation scenario', async () => {
	const dom = installDomEnvironment('http://localhost/#/markets?simulate=1&simScenario=trading')
	installTradingRouting()
	let environmentInitializations = 0
	const configuration: DeploymentConfiguration = {
		chainId: 31_337,
		chainName: 'Browser Simulation',
		factory: `0x${'22'.repeat(20)}`,
		feeBps: 30,
		router: `0x${'33'.repeat(20)}`,
		rpcUrl: 'http://127.0.0.1/',
		securityPoolFactory: `0x${'11'.repeat(20)}`,
	}
	const rendered = await renderIntoDocument(
		<App
			initializeEnvironment={async () => {
				environmentInitializations += 1
			}}
			loadLiveDeployment={async () => configuration}
		/>,
	)
	try {
		window.history.pushState({}, '', '#/markets?simulate=1&simScenario=baseline')
		window.dispatchEvent(new Event('popstate'))
		await new Promise(resolve => setTimeout(resolve, 10))
		expect(environmentInitializations).toBe(1)
		window.dispatchEvent(new Event('popstate'))
		await new Promise(resolve => setTimeout(resolve, 10))
		expect(environmentInitializations).toBe(1)
	} finally {
		await rendered.cleanup()
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading status and address presentation use coreShared primitives', async () => {
	const dom = installDomEnvironment()
	const address = '0x00000000000000000000000000000000000000a1'
	const rendered = await renderIntoDocument(<Status tone='good'>Trading open</Status>)
	expect(rendered.container.querySelector('.badge.status')?.textContent).toContain('Trading open')
	expect(AddressValue({ value: address }).type).toBe(ReadOnlyAddressValue)
	await rendered.cleanup()
	dom.cleanup()
})

test('Trading preserves its route headers and does not restyle shared disclosures', async () => {
	const css = await readFile(join(import.meta.dir, '..', '..', '..', 'css', 'app.css'), 'utf8')
	expect(css).toContain('.route-header {')
	expect(css).toContain('padding: 0;')
	expect(css).toContain('background: transparent;')
	expect(css).toContain('details:not(.wallet-summary):not(.simulation-banner-details) > summary::after')
})

test('verified deployment status stays accurate in live and simulated environments', () => {
	expect(tradingNetworkLabel('verified')).toBe('Deployment verified')
})

test('the removed demo query cannot select a parallel simulated-data application', async () => {
	const dom = installDomEnvironment('http://localhost/?demo=1&scenario=baseline#/markets')
	const configuration: DeploymentConfiguration = {
		chainId: 31_337,
		chainName: 'Browser Simulation',
		factory: `0x${'22'.repeat(20)}`,
		feeBps: 30,
		router: `0x${'33'.repeat(20)}`,
		rpcUrl: 'http://127.0.0.1/',
		securityPoolFactory: `0x${'11'.repeat(20)}`,
	}
	const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
	await new Promise(resolve => setTimeout(resolve, 10))
	expect(rendered.container.querySelector('.demo-banner')).toBeNull()
	expect(rendered.container.textContent).not.toContain('SIMULATED DATA')
	expect(rendered.container.textContent).not.toContain('Demo mode')
	expect(rendered.container.textContent).toContain('SecurityPools')
	await rendered.cleanup()
	dom.cleanup()
})
