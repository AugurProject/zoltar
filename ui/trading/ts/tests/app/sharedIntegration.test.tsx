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
import { tradingNetworkLabel } from '../../app/App.js'

test('Trading registers its shared TEVM scenario and selects its own worker', () => {
	registerTradingSimulationScenario()
	expect(tradingActiveEnvironmentDependencies.appId).toBe('trading')
	expect(getRegisteredSimulationScenarios()).toContain(TRADING_SIMULATION_SCENARIO)
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
	expect(tradingNetworkLabel('baseline', false, 'verified')).toBe('Deployment verified')
	expect(tradingNetworkLabel('baseline', true, 'verified')).toBe('Anvil 31337')
})
