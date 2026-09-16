import { describe, expect, test } from 'bun:test'
import { createRef } from 'preact'
import { StickyObjectContext } from '../../components/StickyObjectContext.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('StickyObjectContext', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('exposes the title heading as a programmatic focus target through titleRef', async () => {
		const titleRef = createRef<HTMLHeadingElement>()
		const rendered = await renderIntoDocument(<StickyObjectContext title='Will it rain?' items={[{ label: 'Pool', value: '0x1111' }]} titleRef={titleRef} />)
		cleanupRendered = rendered.cleanup

		const heading = rendered.container.querySelector('.sticky-object-context-copy h3')
		expect(heading).not.toBeNull()
		expect(titleRef.current).toBe(heading)
		expect(heading?.getAttribute('tabindex')).toBe('-1')
		titleRef.current?.focus()
		expect(document.activeElement).toBe(heading)
	})

	test('keeps the title heading out of the focus order without titleRef', async () => {
		const rendered = await renderIntoDocument(<StickyObjectContext title='Will it rain?' items={[]} />)
		cleanupRendered = rendered.cleanup

		const heading = rendered.container.querySelector('.sticky-object-context-copy h3')
		expect(heading?.textContent).toBe('Will it rain?')
		expect(heading?.hasAttribute('tabindex')).toBeFalse()
	})
})
