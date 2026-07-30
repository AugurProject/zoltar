import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

function setWidth(element: Element, property: 'clientWidth' | 'scrollWidth', value: number) {
	Object.defineProperty(element, property, {
		configurable: true,
		value,
	})
}

test('responsive docs compact equations and label unavoidable horizontal overflow', async () => {
	const environment = installDomEnvironment('http://localhost/docs/whitepapers/statoblast-whitepaper.html')
	try {
		document.write(`
			<div class="equation" style="padding: 8px">
				<math><mtable><mtr><mtd><mi>x</mi></mtd></mtr></mtable></math>
			</div>
			<div class="table-wrap"><table><tr><td>Wide content</td></tr></table></div>
		`)
		const equation = document.querySelector('.equation')
		const math = document.querySelector('math')
		const tableWrap = document.querySelector('.table-wrap')
		if (equation === null || math === null || tableWrap === null) throw new Error('Responsive documentation fixture is incomplete')

		setWidth(equation, 'clientWidth', 320)
		setWidth(math, 'scrollWidth', 600)
		setWidth(tableWrap, 'clientWidth', 320)
		setWidth(tableWrap, 'scrollWidth', 560)

		const runtime = await Bun.file('docs/assets/js/responsiveDocs.js').text()
		Function(runtime)()
		document.dispatchEvent(new Event('DOMContentLoaded'))

		expect(equation.classList.contains('equation-array')).toBeTrue()
		expect(math.getAttribute('style')).toContain('font-size')
		expect(equation.classList.contains('docs-content-overflows')).toBeTrue()
		expect(equation.getAttribute('tabindex')).toBe('0')
		expect(equation.querySelector('.docs-overflow-cue')?.textContent).toContain('full equation')
		expect(tableWrap.querySelector('.docs-overflow-cue')?.textContent).toContain('full table')
	} finally {
		environment.cleanup()
	}
})
