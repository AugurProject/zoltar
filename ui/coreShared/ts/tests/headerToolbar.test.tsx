import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HeaderMetricGroup } from '../components/HeaderMetricStrip.js'
import { HeaderToolbar } from '../components/HeaderToolbar.js'
import { LoadingText } from '../components/LoadingText.js'
import { ToolbarField } from '../components/ToolbarField.js'
import { WalletChip, WalletChipPlaceholder } from '../components/WalletChip.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('header toolbar primitives', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	const address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('lays out brand, badges, navigation, controls, and settings in one toolbar row', async () => {
		const rendered = await renderIntoDocument(<HeaderToolbar brand='Zoltar' badges={<span className='badge'>Simulation</span>} navigation={<nav aria-label='Sections' />} controls={<ToolbarField label='Universe'>Genesis</ToolbarField>} settings={<button type='button'>Settings</button>} />)
		cleanupRenderedComponent = rendered.cleanup
		const toolbar = rendered.container.querySelector('.header-toolbar')
		expect([...(toolbar?.children ?? [])].map(child => child.className)).toEqual(['header-toolbar-brand', 'header-toolbar-navigation', 'header-toolbar-controls', 'header-toolbar-settings'])
		expect(toolbar?.querySelector('.header-toolbar-brand > h2.application-brand')?.textContent).toBe('Zoltar')
		expect(toolbar?.querySelector('.header-toolbar-brand > .environment-badge-row .badge')?.textContent).toBe('Simulation')
		expect(toolbar?.querySelector('.toolbar-field .toolbar-field-label')?.textContent).toBe('Universe')
		expect(toolbar?.querySelector('.toolbar-field .toolbar-field-label')?.classList.contains('visually-hidden')).toBe(false)
		expect(toolbar?.querySelector('.toolbar-field .toolbar-field-value')?.textContent).toBe('Genesis')
	})

	test('keeps the universe caption accessible for loading, unavailable, and plain values', async () => {
		const style = document.createElement('style')
		style.textContent = [readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8'), readFileSync(new URL('../../css/controls-and-responsive.css', import.meta.url), 'utf8')].join('\n')
		document.head.appendChild(style)
		try {
			for (const value of [<LoadingText announce={false} />, <span>Unavailable</span>, <span title='Genesis'>Genesis</span>]) {
				const rendered = await renderIntoDocument(
					<HeaderToolbar
						brand='Trading'
						controls={
							<ToolbarField className='universe' hideLabel label='Universe'>
								{value}
							</ToolbarField>
						}
					/>,
				)
				try {
					const caption = rendered.container.querySelector('.toolbar-field.universe .toolbar-field-label')
					if (!(caption instanceof HTMLElement)) throw new Error('Expected the universe caption')
					expect(caption.textContent).toBe('Universe')
					expect(caption.classList.contains('visually-hidden')).toBe(true)
					const captionStyle = getComputedStyle(caption)
					expect(captionStyle.position).toBe('absolute')
					expect(captionStyle.width).toBe('1px')
					expect(captionStyle.height).toBe('1px')
					expect(captionStyle.overflow).toBe('hidden')
					expect(captionStyle.display).not.toBe('none')
					expect(captionStyle.visibility).not.toBe('hidden')
					expect(caption.hasAttribute('aria-hidden')).toBe(false)
					expect(caption.hasAttribute('hidden')).toBe(false)
				} finally {
					await rendered.cleanup()
				}
			}
		} finally {
			style.remove()
		}
	})

	test('provides responsive account text in the wallet chip while copying the full address', async () => {
		const rendered = await renderIntoDocument(<WalletChip address={address} />)
		cleanupRenderedComponent = rendered.cleanup
		expect(rendered.container.querySelector(`.wallet-chip [role="button"][aria-label="Copy address ${address}"]`)).not.toBeNull()
		const explorerLink = rendered.container.querySelector(`.wallet-chip a[href="https://sepolia.etherscan.io/address/${address}"]`)
		expect(explorerLink?.querySelector('.address-value-abbreviated')?.textContent).toBe('0x8ba1f1…4DBA72')
		expect(explorerLink?.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(rendered.container.querySelector('a button, a a, button button, button a')).toBeNull()
	})

	test('marks a wrong-network account and reserves the slot while loading', async () => {
		const rendered = await renderIntoDocument(
			<div>
				<WalletChip address={address} tone='danger' />
				<WalletChipPlaceholder>Loading…</WalletChipPlaceholder>
			</div>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(rendered.container.querySelector('.wallet-chip.is-danger .wallet-chip-dot')).not.toBeNull()
		expect(rendered.container.querySelector('.wallet-chip.is-placeholder')?.textContent).toBe('Loading…')
	})

	test('labels each metric group, keeps its action in the caption, and rejects an empty group', async () => {
		const rendered = await renderIntoDocument(
			<div className='account-menu-metrics'>
				<HeaderMetricGroup label='Balances'>
					<div>ETH</div>
					<div>REP</div>
					{undefined}
				</HeaderMetricGroup>
				<HeaderMetricGroup label='Prices' action={<button type='button'>Refresh</button>}>
					<div>REP/ETH</div>
				</HeaderMetricGroup>
			</div>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const metrics = rendered.container.querySelector('.account-menu-metrics')
		const groups = [...(metrics?.querySelectorAll(':scope > .overview-metric-group') ?? [])]
		expect(groups.map(group => [group.getAttribute('role'), group.getAttribute('aria-label'), group.querySelectorAll('.overview-metric-group-items > div').length])).toEqual([
			['group', 'Balances', 2],
			['group', 'Prices', 1],
		])
		expect(metrics?.querySelector('section')).toBeNull()
		expect(groups[1]?.querySelector('.overview-metric-group-caption button')?.textContent).toBe('Refresh')
		expect(() => HeaderMetricGroup({ children: undefined, label: 'Empty' })).toThrow('at least one metric cell')
	})
})
