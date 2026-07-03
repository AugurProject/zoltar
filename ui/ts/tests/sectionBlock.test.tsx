import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SectionBlock } from '../components/SectionBlock.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('SectionBlock', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders explicit visual hierarchy variants as classes', async () => {
		const renderedComponent = await renderIntoDocument(
			<div>
				<SectionBlock title='Surface' variant='surface'>
					<p>Primary workspace</p>
				</SectionBlock>
				<SectionBlock title='Plain' variant='plain'>
					<p>Structural section</p>
				</SectionBlock>
				<SectionBlock title='Embedded' variant='embedded'>
					<p>Subsection</p>
				</SectionBlock>
				<SectionBlock title='Default'>
					<p>Legacy default</p>
				</SectionBlock>
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const sections = Array.from(document.body.querySelectorAll('.section-block'))
		expect(sections.map(section => section.className)).toEqual(['section-block tone-default density-balanced surface', 'section-block tone-default density-balanced plain', 'section-block tone-default density-balanced embedded', 'section-block tone-default density-balanced default'])
	})
})
