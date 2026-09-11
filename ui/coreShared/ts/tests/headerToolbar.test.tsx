import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { HeaderMetricGroup, HeaderMetricStrip } from '../components/HeaderMetricStrip.js'
import { HeaderToolbar } from '../components/HeaderToolbar.js'
import { ToolbarField } from '../components/ToolbarField.js'
import { WalletChip, WalletChipLabel, WalletChipPlaceholder } from '../components/WalletChip.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('header toolbar primitives', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	const address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('lays out brand, badges, controls, and settings in fixed toolbar slots', async () => {
		const rendered = await renderIntoDocument(<HeaderToolbar brand='Zoltar' badges={<span className='badge'>Simulation</span>} controls={<ToolbarField label='Universe'>Genesis</ToolbarField>} settings={<button type='button'>Settings</button>} />)
		cleanupRenderedComponent = rendered.cleanup
		const toolbar = rendered.container.querySelector('.header-toolbar')
		expect([...(toolbar?.children ?? [])].map(child => child.className)).toEqual(['header-toolbar-brand', 'header-toolbar-controls', 'header-toolbar-settings'])
		expect(toolbar?.querySelector('.header-toolbar-brand > h2.application-brand')?.textContent).toBe('Zoltar')
		expect(toolbar?.querySelector('.header-toolbar-brand > .environment-badge-row .badge')?.textContent).toBe('Simulation')
		expect(toolbar?.querySelector('.toolbar-field .toolbar-field-label')?.textContent).toBe('Universe')
		expect(toolbar?.querySelector('.toolbar-field .toolbar-field-value')?.textContent).toBe('Genesis')
	})

	test('abbreviates the account in the wallet chip while copying the full address', async () => {
		const rendered = await renderIntoDocument(
			<div>
				<WalletChip address={address} />
				<summary>
					<WalletChipLabel address={address} />
				</summary>
			</div>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const copyButton = rendered.container.querySelector('.wallet-chip button.address-value')
		expect(copyButton?.getAttribute('title')).toBe(address)
		expect(copyButton?.querySelector('.address-value-abbreviated')?.textContent).toBe('0x8ba1f1…4DBA72')
		expect(copyButton?.querySelector('.address-value-full')?.textContent).toBe(address)
		const staticChip = rendered.container.querySelector('summary .wallet-chip.is-static')
		expect(staticChip?.querySelector('button')).toBeNull()
		expect(staticChip?.querySelector('.address-value')?.getAttribute('title')).toBe(address)
		expect(staticChip?.querySelector('.address-value-abbreviated')?.textContent).toBe('0x8ba1f1…4DBA72')
	})

	test('marks a wrong-network account and reserves the slot while loading', async () => {
		const rendered = await renderIntoDocument(
			<div>
				<WalletChipLabel address={address} tone='danger' />
				<WalletChipPlaceholder>Loading…</WalletChipPlaceholder>
			</div>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(rendered.container.querySelector('.wallet-chip.is-danger .wallet-chip-dot')).not.toBeNull()
		expect(rendered.container.querySelector('.wallet-chip.is-placeholder')?.textContent).toBe('Loading…')
	})

	test('sizes each metric group from its cells and rejects an empty group', async () => {
		const rendered = await renderIntoDocument(
			<HeaderMetricStrip expanded>
				<HeaderMetricGroup label='Balances'>
					<div>ETH</div>
					<div>REP</div>
					{undefined}
				</HeaderMetricGroup>
				<HeaderMetricGroup label='Prices' secondary action={<button type='button'>Refresh</button>}>
					<div>REP/ETH</div>
				</HeaderMetricGroup>
			</HeaderMetricStrip>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const strip = rendered.container.querySelector('.overview-inline-metrics')
		expect(strip?.classList.contains('mobile-expanded')).toBe(true)
		const groups = [...(strip?.querySelectorAll(':scope > .overview-metric-group') ?? [])]
		if (!groups.every(group => group instanceof HTMLElement)) throw new Error('Expected metric groups')
		expect(groups.map(group => [group.getAttribute('role'), group.getAttribute('aria-label'), group.style.getPropertyValue('--overview-metric-columns'), group.classList.contains('is-secondary')])).toEqual([
			['group', 'Balances', '2', false],
			['group', 'Prices', '1', true],
		])
		expect(strip?.querySelector('section')).toBeNull()
		expect(groups[1]?.querySelector('.overview-metric-group-caption button')?.textContent).toBe('Refresh')
		expect(() => HeaderMetricGroup({ children: undefined, label: 'Empty' })).toThrow('at least one metric cell')
	})
})
