import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { SectionBlock } from '../components/SectionBlock.js'
import { readCoreSharedCssSource } from './testUtils/coreSharedCss.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('SectionBlock', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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

	test('marks the section root busy only when asked', async () => {
		const renderedComponent = await renderIntoDocument(
			<div>
				<SectionBlock title='Loading' busy>
					<p>Loading rows</p>
				</SectionBlock>
				<SectionBlock title='Ready' busy={false}>
					<p>Rows</p>
				</SectionBlock>
				<SectionBlock title='Static'>
					<p>Never loads</p>
				</SectionBlock>
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const sections = Array.from(document.body.querySelectorAll('.section-block'))
		expect(sections.map(section => section.getAttribute('aria-busy'))).toEqual(['true', 'false', null])
	})

	test('keeps embedded spacing overrides after compact and mobile section padding rules', () => {
		const cssSource = readCoreSharedCssSource()
		const compactRuleIndex = cssSource.indexOf('.section-block.density-compact {')
		const compactEmbeddedRuleIndex = cssSource.indexOf('.section-block.embedded.density-compact {')
		const mobileSectionRuleIndex = cssSource.indexOf('\t.section-block,\n\t.overview-panel {')
		const mobileEmbeddedRuleIndex = cssSource.indexOf('.section-block.embedded {', mobileSectionRuleIndex)

		expect(compactRuleIndex).toBeGreaterThanOrEqual(0)
		expect(compactEmbeddedRuleIndex).toBeGreaterThan(compactRuleIndex)
		expect(mobileSectionRuleIndex).toBeGreaterThanOrEqual(0)
		expect(mobileEmbeddedRuleIndex).toBeGreaterThan(mobileSectionRuleIndex)
	})
})
