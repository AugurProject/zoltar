;(() => {
	const overflowThreshold = 1
	const minimumEquationFontSize = 13

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
		math.style.removeProperty('font-size')

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
		overflowCue(container, container.scrollWidth > container.clientWidth + overflowThreshold, label)
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

	function refresh() {
		prepareTableContainers()
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
