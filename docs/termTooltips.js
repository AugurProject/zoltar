const tooltipId = 'term-tooltip'
const skippedAutoTermAncestors = 'a, button, script, style, svg, math, .term'

function normalizeTermKey(value) {
	return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

const rawTermDefinitions = window.protocolTermDefinitions ?? {}
const normalizedTermDefinitions = Object.fromEntries(Object.entries(rawTermDefinitions).map(([term, definition]) => [normalizeTermKey(term), definition]))

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getTermDefinition(value) {
	const trimmedValue = value.trim()
	return normalizedTermDefinitions[normalizeTermKey(trimmedValue)] ?? rawTermDefinitions[trimmedValue]
}

function getAutoTermEntries() {
	return Object.keys(rawTermDefinitions)
		.filter(term => {
			const normalizedTerm = normalizeTermKey(term)
			return term.length > 2 && normalizedTerm !== 'yes' && normalizedTerm !== 'no'
		})
		.sort((left, right) => right.length - left.length)
}

function buildTermPattern() {
	const terms = getAutoTermEntries().map(escapeRegExp)
	return new RegExp(`(^|[^A-Za-z0-9_])(${terms.join('|')})(?=$|[^A-Za-z0-9_])`, 'gi')
}

function createTermElement(text) {
	const element = document.createElement('span')
	element.className = 'term'
	element.tabIndex = 0
	element.textContent = text
	return element
}

function annotateTextNode(textNode, pattern, annotatedTerms) {
	const text = textNode.nodeValue
	if (text === null) return false

	let lastIndex = 0
	let changed = false
	const fragment = document.createDocumentFragment()

	for (const match of text.matchAll(pattern)) {
		const matchedText = match[2]
		const definition = getTermDefinition(matchedText)
		const termKey = normalizeTermKey(matchedText)
		if (definition === undefined || annotatedTerms.has(termKey)) continue

		const prefix = match[1]
		const matchIndex = match.index ?? 0
		const termStart = matchIndex + prefix.length
		if (termStart > lastIndex) {
			fragment.append(document.createTextNode(text.slice(lastIndex, termStart)))
		}

		const termElement = createTermElement(text.slice(termStart, termStart + matchedText.length))
		termElement.dataset.termDefinition = definition
		fragment.append(termElement)
		annotatedTerms.add(termKey)
		lastIndex = termStart + matchedText.length
		changed = true
	}

	if (!changed) return false

	if (lastIndex < text.length) {
		fragment.append(document.createTextNode(text.slice(lastIndex)))
	}
	textNode.replaceWith(fragment)
	return true
}

function annotateProtocolTerms() {
	const pattern = buildTermPattern()
	const annotatedTerms = new Set()
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode(textNode) {
			const parent = textNode.parentElement
			if (parent === null) return NodeFilter.FILTER_REJECT
			if (parent.closest(skippedAutoTermAncestors) !== null) return NodeFilter.FILTER_REJECT
			if (textNode.nodeValue?.trim() === '') return NodeFilter.FILTER_REJECT
			return NodeFilter.FILTER_ACCEPT
		},
	})
	const textNodes = []
	while (walker.nextNode()) {
		textNodes.push(walker.currentNode)
	}
	for (const textNode of textNodes) {
		annotateTextNode(textNode, pattern, annotatedTerms)
	}
}

function removeDuplicateTermTooltips() {
	const seenTerms = new Set()
	for (const element of document.querySelectorAll('.term')) {
		if (!(element instanceof HTMLElement)) continue

		const rawKey = element.getAttribute('data-term') ?? element.textContent ?? ''
		const definition = element.dataset.termDefinition ?? getTermDefinition(rawKey)
		if (definition === undefined) continue

		const termKey = normalizeTermKey(rawKey)
		if (!seenTerms.has(termKey)) {
			seenTerms.add(termKey)
			continue
		}

		element.classList.remove('term')
		element.removeAttribute('tabindex')
		delete element.dataset.termDefinition
		delete element.dataset.hasTooltip
	}
}

function ensureTooltipElement() {
	let tooltip = document.getElementById(tooltipId)
	if (tooltip instanceof HTMLDivElement) return tooltip

	tooltip = document.createElement('div')
	tooltip.id = tooltipId
	tooltip.className = 'term-tooltip'
	tooltip.setAttribute('role', 'tooltip')
	tooltip.hidden = true
	tooltip.setAttribute('aria-hidden', 'true')
	document.body.append(tooltip)
	return tooltip
}

function updateTooltipPosition(tooltip, targetRect, pointerX, pointerY) {
	const margin = 12
	const viewportWidth = document.documentElement.clientWidth
	const viewportHeight = document.documentElement.clientHeight

	let left = pointerX ?? targetRect.left + targetRect.width / 2
	let top = pointerY ?? targetRect.top - margin

	const tooltipWidth = tooltip.offsetWidth
	const tooltipHeight = tooltip.offsetHeight

	left = Math.max(margin, Math.min(left - tooltipWidth / 2, viewportWidth - tooltipWidth - margin))

	if (pointerY === undefined) {
		top = targetRect.top - tooltipHeight - margin
	}
	if (top + tooltipHeight > viewportHeight - margin) {
		top = targetRect.top - tooltipHeight - margin
	}
	if (top < margin) {
		top = Math.min(viewportHeight - tooltipHeight - margin, targetRect.bottom + margin)
	}

	tooltip.style.left = `${left}px`
	tooltip.style.top = `${top}px`
}

function applyTermTooltips() {
	annotateProtocolTerms()
	removeDuplicateTermTooltips()
	const tooltip = ensureTooltipElement()

	let activeElement

	function hideTooltip() {
		if (activeElement instanceof HTMLElement) {
			activeElement.removeAttribute('aria-describedby')
		}
		activeElement = undefined
		tooltip.hidden = true
		tooltip.setAttribute('aria-hidden', 'true')
		tooltip.dataset.visible = 'false'
		tooltip.textContent = ''
	}

	function showTooltip(element, pointerX, pointerY) {
		const definition = element.dataset.termDefinition
		if (definition === undefined) return

		if (activeElement instanceof HTMLElement && activeElement !== element) {
			activeElement.removeAttribute('aria-describedby')
		}
		activeElement = element
		element.setAttribute('aria-describedby', tooltipId)
		tooltip.textContent = definition
		tooltip.hidden = false
		tooltip.setAttribute('aria-hidden', 'false')
		tooltip.dataset.visible = 'true'
		updateTooltipPosition(tooltip, element.getBoundingClientRect(), pointerX, pointerY)
	}

	for (const element of document.querySelectorAll('.term')) {
		if (!(element instanceof HTMLElement)) continue

		const rawKey = element.getAttribute('data-term') ?? element.textContent ?? ''
		const definition = element.dataset.termDefinition ?? getTermDefinition(rawKey)
		if (definition === undefined) continue

		element.dataset.termDefinition = definition
		element.dataset.hasTooltip = 'true'
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0')

		element.addEventListener('mouseenter', event => {
			showTooltip(element, event.clientX, event.clientY + 18)
		})
		element.addEventListener('mousemove', event => {
			if (activeElement !== element) return
			updateTooltipPosition(tooltip, element.getBoundingClientRect(), event.clientX, event.clientY + 18)
		})
		element.addEventListener('mouseleave', () => {
			if (activeElement !== element) return
			hideTooltip()
		})
		element.addEventListener('focus', () => {
			showTooltip(element)
		})
		element.addEventListener('blur', () => {
			if (activeElement !== element) return
			hideTooltip()
		})
	}

	document.addEventListener(
		'scroll',
		() => {
			if (!(activeElement instanceof HTMLElement)) return
			updateTooltipPosition(tooltip, activeElement.getBoundingClientRect())
		},
		{ passive: true },
	)

	window.addEventListener('resize', () => {
		if (!(activeElement instanceof HTMLElement)) return
		updateTooltipPosition(tooltip, activeElement.getBoundingClientRect())
	})
}

applyTermTooltips()
