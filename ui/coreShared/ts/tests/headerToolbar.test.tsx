import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { HeaderMetricStrip } from '../components/HeaderMetricStrip.js'
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

	test('sizes the metric strip from its cells and rejects an empty strip', async () => {
		const rendered = await renderIntoDocument(
			<HeaderMetricStrip expanded>
				<div>ETH</div>
				<div>REP</div>
				{undefined}
			</HeaderMetricStrip>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const strip = rendered.container.querySelector('.overview-inline-metrics')
		if (!(strip instanceof HTMLElement)) throw new Error('Expected the metric strip')
		expect(strip.style.getPropertyValue('--overview-metric-columns')).toBe('2')
		expect(strip.classList.contains('mobile-expanded')).toBe(true)
		expect(() => HeaderMetricStrip({ children: undefined })).toThrow('at least one metric cell')
	})
})
