import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { createRef } from 'preact'
import { RouteHeader } from '../components/RouteHeader.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('RouteHeader', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('keeps a plain title row unless an aside is given', async () => {
		const rendered = await renderIntoDocument(<RouteHeader title='Markets' />)
		cleanupRenderedComponent = rendered.cleanup
		const row = document.querySelector('.route-title-row')
		expect(row?.className).toBe('route-title-row')
		expect(row?.querySelector('h2')?.hasAttribute('tabindex')).toBe(false)
		expect(document.querySelector('.route-title-aside')).toBeNull()
	})

	test('places the aside beside an object title and exposes the title as a focus target', async () => {
		const titleRef = createRef<HTMLHeadingElement>()
		const rendered = await renderIntoDocument(<RouteHeader eyebrow={<a href='#/market'>All markets</a>} title='Will it rain?' titleAside={<span className='badge'>Open</span>} titleRef={titleRef} />)
		cleanupRenderedComponent = rendered.cleanup
		const row = document.querySelector('.route-title-row')
		expect(row?.classList.contains('has-aside')).toBe(true)
		expect(row?.querySelector('.route-title-aside .badge')?.textContent).toBe('Open')
		expect(titleRef.current?.textContent).toBe('Will it rain?')
		expect(titleRef.current?.getAttribute('tabindex')).toBe('-1')
		expect(document.querySelector('.route-eyebrow a')?.getAttribute('href')).toBe('#/market')
	})
})
