import { expect, test } from 'bun:test'
import { diagramBackgroundElements, enforceDiagramBackground, expandDiagramAttributes, isolateDiagramBackground, restoreDiagramAttributes, restoreDiagramBackground } from '../docs/charts/diagramControl.ts'
import { installDomEnvironment } from '../ui/zoltar/ts/tests/testUtils/domEnvironment.ts'

function setWidth(element: Element, property: 'clientWidth' | 'scrollWidth', value: number) {
	Object.defineProperty(element, property, {
		configurable: true,
		value,
	})
}

test('full-screen diagrams isolate background siblings without inerting their ancestor path', () => {
	const environment = installDomEnvironment('http://localhost/docs/reference/deployment-status.html')
	try {
		document.body.innerHTML = '<header></header><main><section><p>Before</p><figure id="diagram"></figure><p>After</p></section></main><footer></footer>'
		const diagram = document.getElementById('diagram')
		if (diagram === null) throw new Error('Diagram background fixture is missing')
		const header = document.querySelector('header')
		const footer = document.querySelector('footer')
		if (header === null || footer === null) throw new Error('Diagram background state fixture is missing')
		header.inert = true
		expect(diagramBackgroundElements(diagram).map(element => element.tagName)).toEqual(['P', 'P', 'HEADER', 'FOOTER'])
		const background = isolateDiagramBackground(diagram)
		expect(background.map(state => state.inert)).toEqual([false, false, true, false])
		footer.inert = false
		enforceDiagramBackground(background)
		expect(footer.inert).toBeTrue()
		restoreDiagramBackground(background)
		expect(header.inert).toBeTrue()
		expect(footer.inert).toBeFalse()
		diagram.setAttribute('role', 'region')
		const attributes = expandDiagramAttributes(diagram)
		expect(diagram.getAttribute('role')).toBe('dialog')
		expect(diagram.getAttribute('aria-modal')).toBe('true')
		restoreDiagramAttributes(diagram, attributes)
		expect(diagram.getAttribute('role')).toBe('region')
		expect(diagram.getAttribute('aria-modal')).toBeNull()
		diagram.removeAttribute('role')
		const absentAttributes = expandDiagramAttributes(diagram)
		restoreDiagramAttributes(diagram, absentAttributes)
		expect(diagram.getAttribute('role')).toBeNull()
		expect(diagram.getAttribute('aria-modal')).toBeNull()
	} finally {
		environment.cleanup()
	}
})

test('responsive docs compact equations and label unavoidable equation and table overflow', async () => {
	const environment = installDomEnvironment('http://localhost/docs/explanation/statoblast.html')
	try {
		document.write(`
			<div class="equation" style="padding: 8px">
				<math>
					<mtable>
						<mtr>
							<mtd><mi>scaledWithdrawal</mi></mtd>
							<mtd><mo>=</mo></mtd>
							<mtd>
								<mfrac>
									<mrow><mi>amountToWithdrawAttoRep</mi><mo>·</mo><mi>actualForkThreshold</mi></mrow>
									<mi>nonDecisionThresholdAttoRep</mi>
								</mfrac>
								<mspace linebreak="newline"></mspace>
								<mtext> if forkTime &lt;= escalationGameEndDate</mtext>
							</mtd>
						</mtr>
					</mtable>
				</math>
			</div>
			<div class="equation" data-regular-equation style="padding: 8px">
				<math><mrow><mi>unbreakableValue</mi><mo>=</mo><mi>anotherUnbreakableValue</mi></mrow></math>
			</div>
			<div class="equation" data-matrix-equation style="padding: 8px">
				<math><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr></mtable></math>
			</div>
			<div class="equation" data-piecewise-equation style="padding: 8px">
				<math>
					<mtable>
						<mtr>
							<mtd><mi>result</mi></mtd>
							<mtd><mo>=</mo></mtd>
							<mtd>
								<mtable>
									<mtr><mtd><mn>1</mn></mtd><mtd><mtext>if accepted</mtext></mtd></mtr>
									<mtr><mtd><mn>0</mn></mtd><mtd><mtext>otherwise</mtext></mtd></mtr>
								</mtable>
							</mtd>
						</mtr>
					</mtable>
				</math>
			</div>
			<div class="table-wrap"><table><tr><td>Wide content</td></tr></table></div>
			<table class="wide-table invalid-table" aria-label="Deployment mapping">
				<thead><tr><th>Contract</th><th>Purpose</th></tr></thead>
				<tbody><tr><td>SecurityPool</td><td>Bare wide content</td></tr></tbody>
			</table>
			<table data-complex-table>
				<thead><tr><th colspan="2">Complex heading</th></tr></thead>
				<tbody><tr><td>One</td><td>Two</td></tr></tbody>
			</table>
		`)
		const equation = document.querySelector('.equation')
		const math = document.querySelector('math')
		const regularEquation = document.querySelector('[data-regular-equation]')
		const regularMath = regularEquation?.querySelector('math') ?? null
		const matrixEquation = document.querySelector('[data-matrix-equation]')
		const matrixMath = matrixEquation?.querySelector('math') ?? null
		const piecewiseEquation = document.querySelector('[data-piecewise-equation]')
		const piecewiseMath = piecewiseEquation?.querySelector('math') ?? null
		const tableWrap = document.querySelector('.table-wrap')
		if (equation === null || math === null || regularEquation === null || regularMath === null || matrixEquation === null || matrixMath === null || piecewiseEquation === null || piecewiseMath === null || tableWrap === null) {
			throw new Error('Responsive documentation fixture is incomplete')
		}

		setWidth(equation, 'clientWidth', 320)
		setWidth(math, 'scrollWidth', 600)
		setWidth(regularEquation, 'clientWidth', 320)
		setWidth(regularMath, 'scrollWidth', 600)
		setWidth(matrixEquation, 'clientWidth', 320)
		setWidth(matrixMath, 'scrollWidth', 600)
		setWidth(piecewiseEquation, 'clientWidth', 320)
		setWidth(piecewiseMath, 'scrollWidth', 600)
		setWidth(tableWrap, 'clientWidth', 320)
		setWidth(tableWrap, 'scrollWidth', 560)
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			value: (query: string) => ({
				matches: query === '(max-width: 640px)',
				media: query,
				onchange: undefined,
				addEventListener() {},
				removeEventListener() {},
				addListener() {},
				removeListener() {},
				dispatchEvent() {
					return true
				},
			}),
		})

		const runtime = await Bun.file('docs/assets/js/responsiveDocs.js').text()
		Function(runtime)()
		document.dispatchEvent(new Event('DOMContentLoaded'))

		const bareTableContainer = document.querySelector('.docs-auto-table-scroll')
		if (bareTableContainer === null) throw new Error('Bare table was not placed in a responsive container')
		const responsiveTable = bareTableContainer.querySelector('table')
		const complexTable = document.querySelector('[data-complex-table]')
		if (responsiveTable === null || complexTable === null) throw new Error('Responsive table fixtures are incomplete')
		setWidth(bareTableContainer, 'clientWidth', 320)
		setWidth(bareTableContainer, 'scrollWidth', 640)
		window.dispatchEvent(new Event('resize'))
		await Bun.sleep(20)

		expect(equation.classList.contains('equation-array')).toBeTrue()
		const compactEquation = equation.querySelector('.docs-equation-compact')
		const compactText = compactEquation?.textContent?.replaceAll('\u200b', '')
		expect(compactEquation?.getAttribute('aria-hidden')).toBe('true')
		expect(compactText).toContain('scaledWithdrawal')
		expect(compactText).toContain('amountToWithdrawAttoRep · actualForkThreshold) / (nonDecisionThresholdAttoRep')
		expect(compactText).toContain('if forkTime <= escalationGameEndDate')
		expect(math.querySelector('mo')?.getAttribute('linebreak')).toBe('goodbreak')
		expect(math.querySelector('mo')?.getAttribute('linebreakstyle')).toBe('after')
		expect(math.querySelector('mspace')?.getAttribute('linebreak')).toBe('newline')
		expect(equation.classList.contains('equation-compact-active')).toBeTrue()
		expect(equation.classList.contains('docs-content-overflows')).toBeFalse()
		expect(equation.hasAttribute('tabindex')).toBeFalse()
		expect(equation.querySelector('.docs-overflow-cue')).toBeNull()
		expect(regularMath.getAttribute('style')).toContain('font-size')
		expect(regularEquation.classList.contains('docs-content-overflows')).toBeTrue()
		expect(regularEquation.getAttribute('tabindex')).toBe('0')
		expect(regularEquation.querySelector('.docs-overflow-cue')?.textContent).toContain('full equation')
		expect(matrixEquation.classList.contains('equation-array')).toBeTrue()
		expect(matrixEquation.classList.contains('equation-compact-active')).toBeFalse()
		expect(matrixMath.getAttribute('style')).toContain('font-size')
		expect(matrixEquation.querySelector('.docs-overflow-cue')?.textContent).toContain('full equation')
		expect(piecewiseEquation.classList.contains('equation-array')).toBeTrue()
		expect(piecewiseEquation.classList.contains('equation-compact-active')).toBeTrue()
		expect(piecewiseEquation.querySelector('.docs-equation-compact')?.textContent).toContain('if accepted')
		expect(piecewiseEquation.querySelectorAll('.docs-equation-compact-case')).toHaveLength(2)
		expect(piecewiseEquation.classList.contains('docs-content-overflows')).toBeFalse()
		expect(piecewiseEquation.querySelector('.docs-overflow-cue')).toBeNull()
		expect(tableWrap.querySelector('.docs-overflow-cue')?.textContent).toContain('full table')
		expect(bareTableContainer.getAttribute('role')).toBe('region')
		expect(bareTableContainer.getAttribute('aria-label')).toBe('Deployment mapping')
		expect(responsiveTable.classList.contains('docs-responsive-table')).toBeTrue()
		expect(responsiveTable.classList.contains('wide-table')).toBeTrue()
		expect(responsiveTable.classList.contains('invalid-table')).toBeTrue()
		expect(responsiveTable.querySelector('tbody td')?.getAttribute('data-docs-label')).toBe('Contract')
		expect(responsiveTable.querySelector('tbody td:nth-child(2)')?.getAttribute('data-docs-label')).toBe('Purpose')
		expect(bareTableContainer.hasAttribute('tabindex')).toBeFalse()
		expect(bareTableContainer.querySelector('.docs-overflow-cue')).toBeNull()
		expect(complexTable.classList.contains('docs-table-scroll-only')).toBeTrue()
	} finally {
		environment.cleanup()
	}
})
