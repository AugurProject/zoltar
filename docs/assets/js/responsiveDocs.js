;(() => {
	const overflowThreshold = 1
	const minimumEquationFontSize = 13
	const compactEquationQuery = '(max-width: 640px)'
	const suggestedBreakOperators = new Set(['=', '+', '-', '−', '·', '×', '/', '<', '>', '≤', '≥'])
	const definitionRelations = new Set(['=', '<', '>', '≤', '≥', '≈', '≠', ':='])

	function prepareMathBreakHints(math) {
		for (const operator of math.querySelectorAll('mo')) {
			if (!suggestedBreakOperators.has((operator.textContent ?? '').trim())) continue
			if (!operator.hasAttribute('linebreak')) operator.setAttribute('linebreak', 'goodbreak')
			if (!operator.hasAttribute('linebreakstyle')) operator.setAttribute('linebreakstyle', 'after')
		}
	}

	function mathText(node) {
		if (node.nodeType === 3) return node.textContent ?? ''
		if (!(node instanceof Element)) return ''

		const childText = () => Array.from(node.childNodes).map(mathText).join('')
		const children = Array.from(node.children)
		const name = node.localName
		if (name === 'mfrac' && children.length >= 2) {
			return `(${mathText(children[0])}) / (${mathText(children[1])})`
		}
		if (name === 'msup' && children.length >= 2) return `${mathText(children[0])}^(${mathText(children[1])})`
		if (name === 'msub' && children.length >= 2) return `${mathText(children[0])}_(${mathText(children[1])})`
		if (name === 'msubsup' && children.length >= 3) {
			return `${mathText(children[0])}_(${mathText(children[1])})^(${mathText(children[2])})`
		}
		if (name === 'msqrt') return `sqrt(${childText()})`
		if (name === 'mroot' && children.length >= 2) return `root(${mathText(children[0])}, ${mathText(children[1])})`
		if (name === 'mtext') return ` ${node.textContent ?? ''} `
		if (name === 'mo') {
			const operator = (node.textContent ?? '').trim()
			return ['(', ')', '[', ']', '{', '}'].includes(operator) ? operator : ` ${operator} `
		}
		return childText()
	}

	function breakableEquationText(value) {
		return value
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\(\s+/g, '(')
			.replace(/\s+\)/g, ')')
			.replace(/([a-z0-9])([A-Z])/g, '$1\u200b$2')
			.replace(/([=+×·/<>≤≥,])/g, '$1\u200b')
	}

	function prepareCompactEquation(equation, math) {
		const table = math.querySelector('mtable')
		const existing = equation.querySelector(':scope > .docs-equation-compact')
		const rows = table === null ? [] : Array.from(table.querySelectorAll(':scope > mtr'))
		const rowCells = rows.map(row => Array.from(row.children).filter(cell => cell.localName === 'mtd'))
		const isDefinitionTable = rowCells.length > 0 && rowCells.every(cells => cells.length >= 3 && definitionRelations.has(mathText(cells[1]).trim()))
		if (!isDefinitionTable) {
			existing?.remove()
			equation.classList.remove('equation-compact-active')
			return false
		}

		if (existing === null) {
			const compact = document.createElement('div')
			compact.className = 'docs-equation-compact'
			compact.setAttribute('aria-hidden', 'true')
			for (const cells of rowCells) {
				const label = cells[0] === undefined ? '' : mathText(cells[0])
				const relation = cells[1] === undefined ? '' : mathText(cells[1])
				const compactRow = document.createElement('div')
				compactRow.className = 'docs-equation-compact-row'
				const compactLabel = document.createElement('span')
				compactLabel.className = 'docs-equation-compact-label'
				compactLabel.textContent = breakableEquationText(label)
				const compactExpression = document.createElement('span')
				compactExpression.className = 'docs-equation-compact-expression'
				const nestedTable = cells
					.slice(2)
					.map(cell => cell.querySelector('mtable'))
					.find(candidate => candidate !== null)
				if (nestedTable === undefined) {
					compactExpression.textContent = breakableEquationText(`${relation} ${cells.slice(2).map(mathText).join(' ')}`)
				} else {
					const compactRelation = document.createElement('span')
					compactRelation.className = 'docs-equation-compact-relation'
					compactRelation.textContent = breakableEquationText(relation)
					const compactCases = document.createElement('span')
					compactCases.className = 'docs-equation-compact-cases'
					for (const nestedRow of nestedTable.querySelectorAll(':scope > mtr')) {
						const compactCase = document.createElement('span')
						compactCase.className = 'docs-equation-compact-case'
						compactCase.textContent = breakableEquationText(Array.from(nestedRow.children).map(mathText).join(' '))
						compactCases.append(compactCase)
					}
					compactExpression.append(compactRelation, compactCases)
				}
				compactRow.append(compactLabel, compactExpression)
				compact.append(compactRow)
			}
			math.after(compact)
		}

		const compactActive = window.matchMedia(compactEquationQuery).matches
		equation.classList.toggle('equation-compact-active', compactActive)
		return compactActive
	}

	function overflowCue(element, isOverflowing, label) {
		let cue = element.querySelector(':scope > .docs-overflow-cue')
		if (!isOverflowing) {
			cue?.remove()
			element.classList.remove('docs-content-overflows')
			if (element.dataset['docsAddedTabindex'] === 'true') {
				element.removeAttribute('tabindex')
				delete element.dataset['docsAddedTabindex']
			}
			return
		}

		element.classList.add('docs-content-overflows')
		if (!element.hasAttribute('tabindex')) {
			element.tabIndex = 0
			element.dataset['docsAddedTabindex'] = 'true'
		}
		if (cue === null) {
			cue = document.createElement('span')
			cue.className = 'docs-overflow-cue'
			element.append(cue)
		}
		cue.textContent = label
	}

	function fitEquation(equation) {
		const math = equation.querySelector('math')
		if (math === null) return
		equation.classList.toggle('equation-array', math.querySelector('mtable') !== null)
		prepareMathBreakHints(math)
		math.style.removeProperty('font-size')
		if (prepareCompactEquation(equation, math)) {
			overflowCue(equation, false, '')
			return
		}

		const computedStyle = getComputedStyle(equation)
		const availableWidth = equation.clientWidth - Number.parseFloat(computedStyle.paddingLeft) - Number.parseFloat(computedStyle.paddingRight)
		if (availableWidth <= 0) return

		const naturalWidth = math.scrollWidth
		if (naturalWidth > availableWidth + overflowThreshold) {
			const baseFontSize = Number.parseFloat(getComputedStyle(math).fontSize)
			const scale = Math.max(minimumEquationFontSize / baseFontSize, availableWidth / naturalWidth)
			if (scale < 1) math.style.fontSize = `${baseFontSize * scale}px`
		}

		const stillOverflows = math.scrollWidth > availableWidth + overflowThreshold
		overflowCue(equation, stillOverflows, 'Horizontal scrolling reveals the full equation.')
	}

	function markScrollableContent(container) {
		const label = container.matches('.table-wrap, .table-scroll, .docs-auto-table-scroll') ? 'Horizontal scrolling reveals the full table.' : 'Horizontal scrolling reveals the full content.'
		const responsiveTableReflows = window.matchMedia(compactEquationQuery).matches && container.querySelector(':scope > .docs-responsive-table') !== null
		overflowCue(container, !responsiveTableReflows && container.scrollWidth > container.clientWidth + overflowThreshold, label)
	}

	function prepareTableContainers() {
		for (const table of document.querySelectorAll('table')) {
			if (table.closest('.table-wrap, .table-scroll, .docs-auto-table-scroll') !== null) continue
			const container = document.createElement('div')
			container.className = 'docs-auto-table-scroll'
			container.setAttribute('role', 'region')
			const caption = table.querySelector('caption')?.textContent?.replace(/\s+/g, ' ').trim()
			container.setAttribute('aria-label', table.getAttribute('aria-label') ?? caption ?? 'Scrollable table')
			table.before(container)
			container.append(table)
		}
	}

	function prepareResponsiveTables() {
		for (const table of document.querySelectorAll('table')) {
			const headerRows = Array.from(table.querySelectorAll(':scope > thead > tr'))
			const headers = headerRows.length === 1 ? Array.from(headerRows[0].children) : []
			const bodyRows = Array.from(table.querySelectorAll(':scope > tbody > tr'))
			const hasSpanningCells = table.querySelector('[colspan], [rowspan]') !== null
			const hasRegularRows = headers.length > 0 && bodyRows.length > 0 && bodyRows.every(row => row.children.length === headers.length)
			const canReflow = !hasSpanningCells && hasRegularRows
			table.classList.toggle('docs-responsive-table', canReflow)
			table.classList.toggle('docs-table-scroll-only', !canReflow)
			if (!canReflow) continue

			const labels = headers.map(header => (header.textContent ?? '').replace(/\s+/g, ' ').trim())
			for (const row of bodyRows) {
				for (const [index, cell] of Array.from(row.children).entries()) {
					cell.setAttribute('data-docs-label', labels[index] ?? '')
				}
			}
		}
	}

	function refresh() {
		prepareTableContainers()
		prepareResponsiveTables()
		for (const equation of document.querySelectorAll('.equation')) fitEquation(equation)
		for (const container of document.querySelectorAll('.table-wrap, .table-scroll, .docs-auto-table-scroll')) {
			markScrollableContent(container)
		}
	}

	let scheduled = false
	function scheduleRefresh() {
		if (scheduled) return
		scheduled = true
		requestAnimationFrame(() => {
			scheduled = false
			refresh()
		})
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', refresh, { once: true })
	} else {
		refresh()
	}
	window.addEventListener('load', refresh, { once: true })
	window.addEventListener('resize', scheduleRefresh)
	window.addEventListener('docs:charts-rendered', scheduleRefresh)

	if (typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(scheduleRefresh)
		observer.observe(document.documentElement)
	}
})()
