import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

function setWidth(element: Element, property: 'clientWidth' | 'scrollWidth', value: number) {
	Object.defineProperty(element, property, {
		configurable: true,
		value,
	})
}

test('responsive docs compact equations and label unavoidable equation and table overflow', async () => {
	const environment = installDomEnvironment('http://localhost/docs/whitepapers/statoblast-whitepaper.html')
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
									<mrow><mi>amountToWithdraw</mi><mo>·</mo><mi>actualForkThreshold</mi></mrow>
									<mi>nonDecisionThreshold</mi>
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
			<table aria-label="Deployment mapping"><tr><td>Bare wide content</td></tr></table>
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
		setWidth(bareTableContainer, 'clientWidth', 320)
		setWidth(bareTableContainer, 'scrollWidth', 640)
		window.dispatchEvent(new Event('resize'))
		await Bun.sleep(20)

		expect(equation.classList.contains('equation-array')).toBeTrue()
		const compactEquation = equation.querySelector('.docs-equation-compact')
		const compactText = compactEquation?.textContent?.replaceAll('\u200b', '')
		expect(compactEquation?.getAttribute('aria-hidden')).toBe('true')
		expect(compactText).toContain('scaledWithdrawal')
		expect(compactText).toContain('amountToWithdraw · actualForkThreshold) / (nonDecisionThreshold')
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
		expect(piecewiseEquation.classList.contains('equation-compact-active')).toBeFalse()
		expect(piecewiseEquation.querySelector('.docs-equation-compact')).toBeNull()
		expect(piecewiseMath.getAttribute('style')).toContain('font-size')
		expect(piecewiseEquation.querySelector('.docs-overflow-cue')?.textContent).toContain('full equation')
		expect(tableWrap.querySelector('.docs-overflow-cue')?.textContent).toContain('full table')
		expect(bareTableContainer.getAttribute('role')).toBe('region')
		expect(bareTableContainer.getAttribute('aria-label')).toBe('Deployment mapping')
		expect(bareTableContainer.getAttribute('tabindex')).toBe('0')
		expect(bareTableContainer.querySelector('.docs-overflow-cue')?.textContent).toContain('full table')
	} finally {
		environment.cleanup()
	}
})
