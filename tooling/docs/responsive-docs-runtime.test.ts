import { expect, test } from 'bun:test'
import { enforceDiagramBackground, expandDiagramAttributes, isolateDiagramBackground, restoreDiagramAttributes, restoreDiagramBackground } from '../../docs/charts/diagramControl.ts'
import { installDomEnvironment } from '../../ui/coreShared/ts/tests/testUtils/domEnvironment.ts'

function setWidth(element: Element, property: 'clientWidth' | 'scrollWidth', value: number) {
	Object.defineProperty(element, property, {
		configurable: true,
		value,
	})
}

// A reflowable table only overflows while it is laid out as a table; as cards it fits its column.
function setTableScrollWidth(container: Element, tableWidth: number, cardWidth: number) {
	Object.defineProperty(container, 'scrollWidth', {
		configurable: true,
		get: () => (container.querySelector('table')?.classList.contains('docs-table-cards') === true ? cardWidth : tableWidth),
	})
}

function mockMatchMedia(matchingQuery: string | undefined) {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (query: string) => ({
			matches: query === matchingQuery,
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
		const background = isolateDiagramBackground(diagram)
		expect(background.map(state => state.element.tagName)).toEqual(['P', 'P', 'HEADER', 'FOOTER'])
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
			<pre class="code-scroll" tabindex="0"><code>bun run deploy:testnet -- --rpc-url=https://rpc.example</code></pre>
			<pre class="code-scroll" tabindex="0" data-short-command><code>unset PRIVATE_KEY</code></pre>
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
		const wideCommand = document.querySelector('pre.code-scroll:not([data-short-command])')
		const shortCommand = document.querySelector('pre.code-scroll[data-short-command]')
		if (wideCommand === null || shortCommand === null) throw new Error('Code block fixtures are incomplete')
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
		setWidth(wideCommand, 'clientWidth', 320)
		setWidth(wideCommand, 'scrollWidth', 760)
		setWidth(shortCommand, 'clientWidth', 320)
		setWidth(shortCommand, 'scrollWidth', 320)
		mockMatchMedia('(max-width: 640px)')

		const runtime = await Bun.file('docs/assets/js/responsiveDocs.js').text()
		Function(runtime)()
		document.dispatchEvent(new Event('DOMContentLoaded'))

		const bareTableContainer = document.querySelector('.docs-auto-table-scroll')
		if (bareTableContainer === null) throw new Error('Bare table was not placed in a responsive container')
		const responsiveTable = bareTableContainer.querySelector('table')
		const complexTable = document.querySelector('[data-complex-table]')
		if (responsiveTable === null || complexTable === null) throw new Error('Responsive table fixtures are incomplete')
		setWidth(bareTableContainer, 'clientWidth', 320)
		setTableScrollWidth(bareTableContainer, 640, 320)
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
		expect(wideCommand.querySelector('.docs-overflow-cue')?.textContent).toContain('full command')
		expect(shortCommand.querySelector('.docs-overflow-cue')).toBeNull()
		expect(responsiveTable.classList.contains('docs-responsive-table')).toBeTrue()
		expect(responsiveTable.classList.contains('docs-table-cards')).toBeTrue()
		expect(bareTableContainer.hasAttribute('role')).toBeFalse()
		expect(bareTableContainer.hasAttribute('aria-label')).toBeFalse()
		expect(tableWrap.getAttribute('role')).toBe('region')
		expect(tableWrap.getAttribute('tabindex')).toBe('0')
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

test('wide desktop tables reflow into cards, and only a table that still scrolls becomes a named region', async () => {
	const environment = installDomEnvironment('http://localhost/docs/reference/contracts/securitypool.html')
	try {
		document.write(`
			<h2>State-changing interactions</h2>
			<table data-wide-table>
				<thead><tr><th>Transaction</th><th>Caller</th><th>Effect</th></tr></thead>
				<tbody><tr><td><code>depositRep(amount)</code></td><td>Vault owner</td><td>Moves REP into the pool</td></tr></tbody>
			</table>
			<h2>Fitting reference</h2>
			<table data-fitting-table>
				<thead><tr><th>Name</th><th>Meaning</th></tr></thead>
				<tbody><tr><td>Safety</td><td>A forbidden transition cannot succeed.</td></tr></tbody>
			</table>
			<h2>Complex layout</h2>
			<table data-complex-table>
				<thead><tr><th colspan="2">Merged heading</th></tr></thead>
				<tbody><tr><td>One</td><td>Two</td></tr></tbody>
			</table>
		`)
		mockMatchMedia(undefined)
		Function(await Bun.file('docs/assets/js/responsiveDocs.js').text())()
		document.dispatchEvent(new Event('DOMContentLoaded'))

		const container = (selector: string) => {
			const table = document.querySelector(selector)
			const wrapper = table?.parentElement
			if (table === null || !(wrapper instanceof HTMLElement) || !wrapper.classList.contains('docs-auto-table-scroll')) throw new Error(`${selector} was not wrapped in a responsive container`)
			return { table, wrapper }
		}
		const wide = container('[data-wide-table]')
		const fitting = container('[data-fitting-table]')
		const complex = container('[data-complex-table]')
		for (const { wrapper } of [wide, fitting, complex]) setWidth(wrapper, 'clientWidth', 700)
		setTableScrollWidth(wide.wrapper, 1400, 700)
		setTableScrollWidth(fitting.wrapper, 700, 700)
		setTableScrollWidth(complex.wrapper, 1100, 1100)
		window.dispatchEvent(new Event('resize'))
		await Bun.sleep(20)

		expect(wide.table.classList.contains('docs-table-cards')).toBeTrue()
		expect(wide.wrapper.hasAttribute('role')).toBeFalse()
		expect(wide.wrapper.hasAttribute('tabindex')).toBeFalse()
		expect(wide.wrapper.querySelector('.docs-overflow-cue')).toBeNull()

		expect(fitting.table.classList.contains('docs-table-cards')).toBeFalse()
		expect(fitting.wrapper.hasAttribute('role')).toBeFalse()
		expect(fitting.wrapper.hasAttribute('tabindex')).toBeFalse()

		expect(complex.table.classList.contains('docs-table-cards')).toBeFalse()
		expect(complex.wrapper.getAttribute('role')).toBe('region')
		expect(complex.wrapper.getAttribute('aria-label')).toBe('Complex layout table')
		expect(complex.wrapper.getAttribute('tabindex')).toBe('0')
		expect(complex.wrapper.firstElementChild?.classList.contains('docs-overflow-cue')).toBeTrue()

		setTableScrollWidth(complex.wrapper, 700, 700)
		window.dispatchEvent(new Event('resize'))
		await Bun.sleep(20)
		expect(complex.wrapper.hasAttribute('role')).toBeFalse()
		expect(complex.wrapper.hasAttribute('aria-label')).toBeFalse()
		expect(complex.wrapper.hasAttribute('tabindex')).toBeFalse()
		expect(complex.wrapper.querySelector('.docs-overflow-cue')).toBeNull()
	} finally {
		environment.cleanup()
	}
})
