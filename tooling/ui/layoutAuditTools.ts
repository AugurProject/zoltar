import type { LayoutAuditOptions, LayoutElementInfo, LayoutFinding, LayoutRect } from './layoutAudit.ts'

/** How far a box reaches past another on each side, in CSS pixels. */
export type Overhang = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/** A run of painted text: one text node, its owning element, and its line boxes. */
export type TextAtom = { readonly node: Text; readonly owner: Element; readonly rects: DOMRect[]; readonly text: string }

/**
 * Shared measurement and reporting helpers for the in-page layout audit (see `layoutAudit.ts`). Injected with
 * `Function.prototype.toString`, so it must stay self-contained: no imports other than types, and no module scope.
 */
export function createLayoutAuditTools(options: LayoutAuditOptions) {
	const tolerance = options.tolerance ?? 2
	const viewportWidth = document.documentElement.clientWidth
	const viewportHeight = window.innerHeight
	const scrollX = window.scrollX
	const scrollY = window.scrollY
	const findings: LayoutFinding[] = []
	const seen = new Set<string>()
	let nextScanId = Number(document.documentElement.getAttribute('data-layout-scan-next') ?? '1')

	const styleCache = new Map<Element, CSSStyleDeclaration>()
	const styleOf = (element: Element) => {
		let style = styleCache.get(element)
		if (style === undefined) {
			style = getComputedStyle(element)
			styleCache.set(element, style)
		}
		return style
	}
	const round = (value: number) => Math.round(value)
	const px = (value: number) => `${round(value).toString()}px`
	const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
	const snippet = (value: string, limit = 60) => {
		const text = normalize(value)
		return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
	}
	const toDocumentRect = (rect: DOMRect | DOMRectReadOnly): LayoutRect => ({ x: round(rect.left + scrollX), y: round(rect.top + scrollY), width: round(rect.width), height: round(rect.height) })
	const isRoot = (element: Element) => element === document.documentElement || element === document.body

	// ---------- Visibility ----------

	const isVisuallyHiddenBox = (element: Element) => {
		const style = styleOf(element)
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return true
		if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return true
		if (style.position === 'absolute' || style.position === 'fixed') {
			const rect = element.getBoundingClientRect()
			// Screen-reader-only boxes and skip links parked far outside the page.
			if (rect.width <= 1 && rect.height <= 1) return true
			if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0) return true
		}
		return false
	}
	const hiddenCache = new Map<Element, boolean>()
	const isHidden = (element: Element): boolean => {
		const cached = hiddenCache.get(element)
		if (cached !== undefined) return cached
		const parent = element.parentElement
		// `checkVisibility` also catches content Chromium keeps laid out but skips painting, such as the body of a closed
		// `<details>` (`content-visibility: hidden`), whose boxes would otherwise read as overlapping or overflowing.
		const hidden = (element instanceof SVGElement && !(element instanceof SVGSVGElement)) || isVisuallyHiddenBox(element) || !element.checkVisibility() || element.closest('[hidden], [inert], template') !== null || (parent !== null && !isRoot(parent) && isHidden(parent))
		hiddenCache.set(element, hidden)
		return hidden
	}
	const inScope = (element: Element) => options.scope === undefined || element.closest(options.scope) !== null

	// ---------- Descriptions ----------

	const describeSegment = (element: Element) => {
		const tag = element.tagName.toLowerCase()
		if (element.id !== '' && !/\d{3,}|:/.test(element.id)) return `${tag}#${element.id}`
		const classes = [...element.classList].filter(name => !name.startsWith('layout-scan')).slice(0, 2)
		const role = element.getAttribute('role')
		return `${tag}${classes.map(name => `.${name}`).join('')}${classes.length === 0 && role !== null ? `[role=${role}]` : ''}`
	}
	const pathOf = (element: Element) => {
		const segments: string[] = []
		for (let current: Element | null = element; current !== null && !isRoot(current) && segments.length < 5; current = current.parentElement) {
			segments.unshift(describeSegment(current))
			if (current.matches('main, header, nav, footer, aside, [role=dialog], dialog')) break
		}
		return segments.join(' > ')
	}
	const classesOf = (element: Element) => {
		const classes: string[] = []
		for (let current: Element | null = element; current !== null && !isRoot(current) && classes.length < 6; current = current.parentElement) {
			for (const name of current.classList) if (!classes.includes(name)) classes.push(name)
		}
		return classes
	}
	const textOf = (element: Element) => {
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return snippet(element.value === '' ? element.placeholder : element.value)
		if (element instanceof HTMLSelectElement) return snippet(element.selectedOptions[0]?.text ?? '')
		return snippet(element instanceof HTMLElement ? element.innerText : (element.textContent ?? ''))
	}
	const accessibleLabel = (element: Element) => {
		const labelledBy = element.getAttribute('aria-labelledby')
		if (labelledBy !== null) {
			const text = labelledBy
				.split(/\s+/)
				.map(id => document.getElementById(id)?.textContent ?? '')
				.join(' ')
			if (normalize(text) !== '') return normalize(text)
		}
		return normalize(element.getAttribute('aria-label'))
	}
	const contextOf = (element: Element) => {
		for (let current: Element | null = element; current !== null && !isRoot(current); current = current.parentElement) {
			if (!current.matches('section, article, form, fieldset, aside, nav, header, [role=dialog], dialog, [role=tabpanel], details, main, table')) continue
			const label = accessibleLabel(current)
			if (label !== '') return snippet(label, 80)
			const heading = current.querySelector('h1, h2, h3, h4, h5, legend, caption, summary')
			const headingText = heading instanceof HTMLElement ? normalize(heading.innerText.split('\n')[0]) : ''
			if (headingText !== '') return snippet(headingText, 80)
		}
		const pageHeading = document.querySelector('h1')
		return snippet(pageHeading instanceof HTMLElement ? pageHeading.innerText : document.title, 80)
	}
	const infoOf = (element: Element, rect?: DOMRect | DOMRectReadOnly): LayoutElementInfo => {
		let scanId = element.getAttribute('data-layout-scan-id')
		if (scanId === null) {
			scanId = (nextScanId++).toString()
			element.setAttribute('data-layout-scan-id', scanId)
		}
		return { path: pathOf(element), classes: classesOf(element), text: textOf(element), rect: toDocumentRect(rect ?? element.getBoundingClientRect()), scanId }
	}
	const report = (finding: Omit<LayoutFinding, 'signature' | 'context' | 'element' | 'related'> & { element: Element; elementRect?: DOMRect | DOMRectReadOnly; related?: Element; signatureText?: string }) => {
		if (!inScope(finding.element)) return
		const element = infoOf(finding.element, finding.elementRect)
		const related = finding.related === undefined ? undefined : infoOf(finding.related)
		const signature = `${finding.kind}|${element.path}|${finding.signatureText ?? element.text}${related === undefined ? '' : `|${related.path}`}`
		if (seen.has(signature)) return
		seen.add(signature)
		findings.push({ kind: finding.kind, severity: finding.severity, signature, message: finding.message, fix: finding.fix, context: contextOf(finding.element), element, ...(related === undefined ? {} : { related }) })
	}

	// ---------- Cause analysis ----------

	const longestUnbreakableRun = (text: string) => text.split(/[\s​-]+/).reduce((longest, word) => (word.length > longest.length ? word : longest), '')
	const isFlexOrGridItem = (element: Element) => {
		const parent = element.parentElement
		if (parent === null) return false
		const display = styleOf(parent).display
		return display.includes('flex') || display.includes('grid')
	}
	/** Explains why a box is wider than the space it is given. */
	const widthCause = (element: Element, textHint?: string, contentOwners: readonly Element[] = []): string => {
		const style = styleOf(element)
		const reasons: string[] = []
		const longest = longestUnbreakableRun(textHint ?? textOf(element))
		if (longest.length >= 16 && style.overflowWrap !== 'anywhere' && style.wordBreak !== 'break-all') reasons.push(`the unbreakable text "${snippet(longest, 48)}" cannot wrap; allow it to with \`overflow-wrap: anywhere\` or truncate it`)
		const noWrap = [element, ...contentOwners].find(owner => ['nowrap', 'pre'].includes(styleOf(owner).whiteSpace))
		if (noWrap !== undefined) reasons.push(`\`white-space: ${styleOf(noWrap).whiteSpace}\` on \`${describeSegment(noWrap)}\` keeps the text on one line`)
		if (style.minWidth !== 'auto' && style.minWidth !== '0px' && style.minWidth !== '') reasons.push(`\`min-width: ${style.minWidth}\` keeps the box wide`)
		if (/^\d/.test(element instanceof HTMLElement ? element.style.width : '')) reasons.push('an inline width is set')
		for (let current: Element | null = element; current !== null && !isRoot(current); current = current.parentElement) {
			const currentStyle = styleOf(current)
			if (isFlexOrGridItem(current) && currentStyle.minWidth === 'auto' && currentStyle.overflowX === 'visible') {
				reasons.push(`\`${describeSegment(current)}\` is a ${styleOf(current.parentElement ?? current).display.includes('grid') ? 'grid' : 'flex'} item with the default \`min-width: auto\`, so it cannot shrink below its content; give it \`min-width: 0\``)
				break
			}
			if (currentStyle.display === 'table' || current.tagName === 'TABLE') {
				reasons.push(`it sits in the table \`${describeSegment(current)}\`, which is as wide as its widest cells; wrap the table in a horizontal scroll container or stack it at narrow widths`)
				break
			}
			if (currentStyle.gridTemplateColumns !== 'none' && currentStyle.display.includes('grid') && /\d+px/.test(currentStyle.gridTemplateColumns) && current !== element) {
				const columns = currentStyle.gridTemplateColumns.split(' ').length
				if (columns > 1) {
					reasons.push(`the grid \`${describeSegment(current)}\` keeps ${columns.toString()} columns (${currentStyle.gridTemplateColumns}); collapse it to fewer columns at this width`)
					break
				}
			}
		}
		return reasons.length === 0 ? 'its content is wider than the space available' : reasons.slice(0, 2).join('; ')
	}

	// ---------- Collect content atoms ----------

	const textAtoms: TextAtom[] = []
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode: node => {
			if (normalize(node.textContent) === '') return NodeFilter.FILTER_REJECT
			const owner = node.parentElement
			if (owner === null || isHidden(owner) || owner.closest('script, style, noscript, svg, option, select, textarea') !== null) return NodeFilter.FILTER_REJECT
			return NodeFilter.FILTER_ACCEPT
		},
	})
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (!(node instanceof Text) || node.parentElement === null) continue
		const range = document.createRange()
		range.selectNodeContents(node)
		const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5 && rect.height > 0.5)
		if (rects.length === 0) continue
		textAtoms.push({ node, owner: node.parentElement, rects, text: normalize(node.textContent) })
	}
	const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=checkbox], [role=radio], [role=switch], summary')].filter(element => !isHidden(element) && element.getClientRects().length > 0)

	const fullAudit = options.viewportChecksOnly !== true

	// ---------- Shared layout helpers ----------

	const isScrolling = (style: CSSStyleDeclaration, axis: 'x' | 'y') => {
		const overflow = axis === 'x' ? style.overflowX : style.overflowY
		return overflow === 'auto' || overflow === 'scroll'
	}
	const describeOverhang = (value: Overhang, axes: { x: boolean; y: boolean }) => {
		const parts: string[] = []
		if (axes.x && value.right > tolerance) parts.push(`${px(value.right)} on the right`)
		if (axes.x && value.left > tolerance) parts.push(`${px(value.left)} on the left`)
		if (axes.y && value.bottom > tolerance) parts.push(`${px(value.bottom)} at the bottom`)
		if (axes.y && value.top > tolerance) parts.push(`${px(value.top)} at the top`)
		return parts.join(' and ')
	}
	function isInline(element: Element) {
		return styleOf(element).display === 'inline'
	}
	function blockAncestor(element: Element) {
		let current: Element = element
		while (current.parentElement !== null && isInline(current)) current = current.parentElement
		return current
	}
	const isPopupLayer = (element: Element) => element.closest('[role=dialog], dialog, [role=menu], [role=listbox], [role=tooltip], [popover], [aria-modal=true], .tooltip, .popover, .app-settings-menu') !== null
	const pinnedAncestor = (element: Element) => {
		for (let current: Element | null = element; current !== null && !isRoot(current); current = current.parentElement) {
			const position = styleOf(current).position
			if (position === 'fixed' || position === 'sticky') return current
		}
		return undefined
	}
	function isPositionedDecoration(element: Element) {
		const position = styleOf(element).position
		return position === 'absolute' && element.getAttribute('aria-hidden') === 'true'
	}
	function overlapCause(first: Element, second: Element) {
		for (const element of [first, second]) {
			for (let current: Element | null = element; current !== null && !isRoot(current); current = current.parentElement) {
				const style = styleOf(current)
				if (style.position === 'absolute') return `\`${describeSegment(current)}\` is absolutely positioned and does not reserve space; place it in the flow or reserve room for it.`
				if (Number.parseFloat(style.marginTop) < 0 || Number.parseFloat(style.marginLeft) < 0) return `\`${describeSegment(current)}\` has a negative margin that pulls it over its neighbour.`
				if (style.height !== 'auto' && current.scrollHeight > current.clientHeight + tolerance && style.overflowY === 'visible') return `\`${describeSegment(current)}\` has a fixed height (${style.height}) shorter than its content, which then paints over the next element; let it grow.`
			}
		}
		const lineHeight = Number.parseFloat(styleOf(first).lineHeight)
		const fontSize = Number.parseFloat(styleOf(first).fontSize)
		if (Number.isFinite(lineHeight) && lineHeight < fontSize) return `The line height (${styleOf(first).lineHeight}) is smaller than the font size (${styleOf(first).fontSize}); increase it.`
		return 'One of the boxes is narrower or shorter than its content and overflows into the other; let the content wrap or give it room.'
	}
	const lineTops = (rects: readonly DOMRect[]) => {
		const tops: number[] = []
		for (const rect of rects) if (!tops.some(top => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top)
		return tops.length
	}

	const finish = () => {
		document.documentElement.setAttribute('data-layout-scan-next', nextScanId.toString())
		return findings
	}
	return {
		tolerance,
		viewportWidth,
		viewportHeight,
		scrollX,
		scrollY,
		findings,
		seen,
		styleCache,
		styleOf,
		round,
		px,
		normalize,
		snippet,
		toDocumentRect,
		isRoot,
		isVisuallyHiddenBox,
		hiddenCache,
		isHidden,
		inScope,
		describeSegment,
		pathOf,
		classesOf,
		textOf,
		accessibleLabel,
		contextOf,
		infoOf,
		report,
		longestUnbreakableRun,
		isFlexOrGridItem,
		widthCause,
		textAtoms,
		walker,
		controls,
		fullAudit,
		isScrolling,
		describeOverhang,
		isInline,
		blockAncestor,
		isPopupLayer,
		pinnedAncestor,
		isPositionedDecoration,
		overlapCause,
		lineTops,
		options,
		finish,
	}
}

export type LayoutAuditTools = ReturnType<typeof createLayoutAuditTools>
