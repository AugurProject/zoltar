import type { LayoutAuditTools, Overhang } from './layoutAuditTools.ts'

/**
 * Containment checks: content cut off by a clipping box (`clipped`, `truncated`), escaping a visible box (`spill`), or running past the clipped viewport edge (`viewport-overflow`).
 * Injected with `Function.prototype.toString`, so it must stay self-contained apart from the `tools` argument.
 */
export function auditContainment(tools: LayoutAuditTools) {
	const { tolerance, viewportWidth, styleOf, px, normalize, snippet, isRoot, isHidden, describeSegment, textOf, report, widthCause, textAtoms, controls, fullAudit, isScrolling, describeOverhang, isInline } = tools
	// ---------- Containment: clipping, spilling, viewport overflow ----------

	const isClipping = (style: CSSStyleDeclaration, axis: 'x' | 'y') => {
		const overflow = axis === 'x' ? style.overflowX : style.overflowY
		return overflow === 'hidden' || overflow === 'clip'
	}
	const hasVisibleEdge = (element: Element) => {
		const style = styleOf(element)
		const borders = ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none')
		const background = !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor) || style.backgroundImage !== 'none'
		return borders || background || style.boxShadow !== 'none'
	}
	const isTruncating = (element: Element) => {
		const style = styleOf(element)
		return style.textOverflow === 'ellipsis' || (style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '')
	}
	const hasFullTextNearby = (element: Element, text: string) => {
		for (let current: Element | null = element; current !== null && !isRoot(current); current = current.parentElement) {
			const title = current.getAttribute('title') ?? ''
			const label = current.getAttribute('aria-label') ?? ''
			if ((title !== '' && normalize(title).includes(text.slice(0, 24))) || (label !== '' && normalize(label).includes(text.slice(0, 24)))) return true
			if (current.matches('button, a, [role=button]')) break
		}
		return false
	}
	const overhang = (inner: DOMRect | DOMRectReadOnly, outer: DOMRect | DOMRectReadOnly): Overhang => ({ left: outer.left - inner.left, right: inner.right - outer.right, top: outer.top - inner.top, bottom: inner.bottom - outer.bottom })
	const paddingBox = (element: Element) => {
		const rect = element.getBoundingClientRect()
		const style = styleOf(element)
		const borderLeft = Number.parseFloat(style.borderLeftWidth)
		const borderTop = Number.parseFloat(style.borderTopWidth)
		const width = element.clientWidth === 0 && rect.width > 0 ? rect.width : element.clientWidth
		const height = element.clientHeight === 0 && rect.height > 0 ? rect.height : element.clientHeight
		return new DOMRect(rect.left + borderLeft, rect.top + borderTop, width, height)
	}
	const unionRect = (rects: readonly DOMRect[]) => {
		const left = Math.min(...rects.map(rect => rect.left))
		const top = Math.min(...rects.map(rect => rect.top))
		const right = Math.max(...rects.map(rect => rect.right))
		const bottom = Math.max(...rects.map(rect => rect.bottom))
		return new DOMRect(left, top, right - left, bottom - top)
	}
	type ClipGroup = { readonly container: Element; readonly owners: Set<Element>; texts: string[]; worst: Overhang; axes: { x: boolean; y: boolean } }
	const clipGroups = new Map<Element, ClipGroup>()
	const truncateGroups = new Map<Element, { owners: Set<Element>; texts: string[] }>()
	const spillGroups = new Map<Element, ClipGroup>()
	const viewportGroups = new Map<Element, ClipGroup>()
	const mergeOverhang = (left: Overhang, right: Overhang): Overhang => ({ left: Math.max(left.left, right.left), right: Math.max(left.right, right.right), top: Math.max(left.top, right.top), bottom: Math.max(left.bottom, right.bottom) })
	const addToGroup = (groups: Map<Element, ClipGroup>, container: Element, owner: Element, text: string, amount: Overhang, axes: { x: boolean; y: boolean }) => {
		const group = groups.get(container) ?? { container, owners: new Set<Element>(), texts: [], worst: { left: 0, right: 0, top: 0, bottom: 0 }, axes: { x: false, y: false } }
		group.owners.add(owner)
		if (text !== '' && !group.texts.includes(text) && group.texts.length < 4) group.texts.push(text)
		group.worst = mergeOverhang(group.worst, amount)
		group.axes = { x: group.axes.x || axes.x, y: group.axes.y || axes.y }
		groups.set(container, group)
	}

	/**
	 * Walks from a piece of content up through its containing blocks and records the first box that cuts it off or that
	 * it visibly escapes. A scroll container ends the walk: content inside it can be scrolled to.
	 */
	const checkContainment = (owner: Element, rect: DOMRect, text: string) => {
		let skipUntil: Element | null | undefined
		let positionedEscape = false
		let spilled = false
		for (let current: Element | null = owner; current !== null; current = current.parentElement) {
			const style = styleOf(current)
			if (current !== owner && skipUntil !== undefined) {
				if (current !== skipUntil) continue
				skipUntil = undefined
			}
			if (isRoot(current)) break
			if (!isInline(current)) {
				const box = paddingBox(current)
				const amount = overhang(rect, box)
				const xOut = amount.left > tolerance || amount.right > tolerance
				const yOut = amount.top > tolerance || amount.bottom > tolerance
				const clipsX = isClipping(style, 'x') || style.contain.includes('paint')
				const clipsY = isClipping(style, 'y') || style.contain.includes('paint')
				if ((xOut && clipsX) || (yOut && clipsY)) {
					const axes = { x: xOut && clipsX, y: yOut && clipsY }
					if (isTruncating(current)) {
						const group = truncateGroups.get(current) ?? { owners: new Set<Element>(), texts: [] }
						group.owners.add(owner)
						if (text !== '' && group.texts.length < 4 && !group.texts.includes(text)) group.texts.push(text)
						truncateGroups.set(current, group)
					} else addToGroup(clipGroups, current, owner, text, amount, axes)
					return
				}
				if ((xOut && isScrolling(style, 'x')) || (yOut && isScrolling(style, 'y'))) return
				// Record the first visible box the content escapes, then keep walking: the same content may also be cut off further up.
				if ((xOut || yOut) && !spilled && !positionedEscape && hasVisibleEdge(current)) {
					addToGroup(spillGroups, current, owner, text, amount, { x: xOut, y: yOut })
					spilled = true
				}
				if (isScrolling(style, 'x') && isScrolling(style, 'y')) return
			}
			if (style.position === 'absolute') {
				// Overflow clipping of the boxes between an absolutely positioned box and its containing block does not apply.
				skipUntil = current instanceof HTMLElement ? current.offsetParent : null
				positionedEscape = true
			}
			if (style.position === 'fixed') {
				skipUntil = null
				positionedEscape = true
				break
			}
			if (style.position === 'sticky') positionedEscape = true
		}
		// The root clips horizontal overflow, so content past the viewport edges is cut off for good.
		const amount = { left: -rect.left, right: rect.right - viewportWidth, top: 0, bottom: 0 }
		if (amount.left > tolerance || amount.right > tolerance) {
			addToGroup(viewportGroups, owner, owner, text, amount, { x: true, y: false })
		}
	}

	if (fullAudit) for (const atom of textAtoms) checkContainment(atom.owner, unionRect(atom.rects), atom.text)
	if (fullAudit)
		for (const control of controls) {
			if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) checkContainment(control, control.getBoundingClientRect(), textOf(control))
		}
	if (fullAudit)
		for (const media of document.querySelectorAll('img, svg, canvas, video')) {
			if (media instanceof SVGElement && !(media instanceof SVGSVGElement)) continue
			if (isHidden(media) || media.getClientRects().length === 0) continue
			const rect = media.getBoundingClientRect()
			if (rect.width < 4 || rect.height < 4) continue
			const amount = { left: -rect.left, right: rect.right - viewportWidth, top: 0, bottom: 0 }
			if ((amount.left > tolerance || amount.right > tolerance) && !hasClippingAncestor(media)) addToGroup(viewportGroups, media, media, media.getAttribute('alt') ?? media.getAttribute('aria-label') ?? media.tagName.toLowerCase(), amount, { x: true, y: false })
		}

	function hasClippingAncestor(element: Element) {
		for (let current = element.parentElement; current !== null && !isRoot(current); current = current.parentElement) {
			const style = styleOf(current)
			if (style.overflowX !== 'visible') return true
			if (style.position === 'fixed') return false
		}
		return false
	}

	/** Reduces content groups to their outermost box, so one wide element is reported once instead of once per descendant. */
	const outermostOwners = (owners: Iterable<Element>) => {
		const list = [...owners]
		return list.filter(owner => !list.some(other => other !== owner && other.contains(owner)))
	}
	const textList = (texts: readonly string[]) => texts.map(text => `"${snippet(text, 40)}"`).join(', ')

	for (const group of clipGroups.values()) {
		const container = group.container
		const box = container.getBoundingClientRect()
		const style = styleOf(container)
		const where = describeOverhang(group.worst, group.axes)
		const overflowValue = group.axes.x ? style.overflowX : style.overflowY
		const has = group.axes.x ? container.clientWidth : container.clientHeight
		const needed = has + (group.axes.x ? Math.max(group.worst.left, 0) + Math.max(group.worst.right, 0) : Math.max(group.worst.top, 0) + Math.max(group.worst.bottom, 0))
		const isVertical = group.axes.y && !group.axes.x
		const heightCause = () => {
			if (style.maxHeight !== 'none') return `\`max-height: ${style.maxHeight}\` caps the box`
			if (style.height !== 'auto' && !style.height.endsWith('%')) return `its height is fixed at ${style.height}`
			return 'its height is set by its layout rather than its content'
		}
		const cause = isVertical ? heightCause() : widthCause(container, group.texts.join(' '), [...group.owners])
		report({
			kind: 'clipped',
			severity: 'high',
			element: container,
			signatureText: group.texts.join('|'),
			message: `Content is cut off: \`${describeSegment(container)}\` (${px(box.width)}×${px(box.height)}, \`overflow: ${overflowValue}\`) needs ${px(needed)} ${isVertical ? 'of height' : 'of width'} but has ${px(has)}, so ${where} of ${textList(group.texts)} is hidden.`,
			fix: isVertical ? `Let the box grow with its content or make it scroll; ${cause}.` : `Make the content fit (${cause}), or, if shortening it is acceptable, use \`text-overflow: ellipsis\` and expose the full text in a \`title\`.`,
		})
	}
	for (const [container, group] of truncateGroups) {
		const owners = outermostOwners(group.owners)
		const text = group.texts.join(' ')
		if (owners.every(owner => hasFullTextNearby(owner, text)) || hasFullTextNearby(container, text)) continue
		if (/^0x[0-9a-f]{6,}/i.test(text) && container.closest('[data-copy], .address, .copyable, .hash') !== null) continue
		const style = styleOf(container)
		report({
			kind: 'truncated',
			severity: 'low',
			element: container,
			// One finding per element: the same truncating box shows different values in different states.
			signatureText: '',
			message: `Text is shortened with ${style.textOverflow === 'ellipsis' ? 'an ellipsis' : 'a line clamp'} and the full value is not available: ${textList(group.texts)} does not fit in \`${describeSegment(container)}\` (${px(container.clientWidth)} wide, needs ${px(container.scrollWidth)}).`,
			fix: 'Expose the full text with a `title` or accessible name, or give the box room so the value is not shortened.',
		})
	}
	// Content that also runs off the viewport is reported once, as a viewport overflow.
	for (const group of spillGroups.values()) {
		if ([...group.owners].every(owner => [...viewportGroups.keys()].some(overflowing => overflowing.contains(owner) || owner.contains(overflowing)))) continue
		const container = group.container
		const owners = outermostOwners(group.owners)
		const first = owners[0] ?? container
		const where = describeOverhang(group.worst, group.axes)
		const box = container.getBoundingClientRect()
		report({
			kind: 'spill',
			severity: 'medium',
			element: first,
			related: container,
			signatureText: group.texts.join('|'),
			message: `Content escapes its box: ${textList(group.texts)} reaches ${where} outside \`${describeSegment(container)}\` (${px(box.width)}×${px(box.height)}) and is drawn across its edge.`,
			fix: group.axes.x ? `Make the content fit its box: ${widthCause(first, group.texts.join(' '), [...group.owners])}.` : `Let \`${describeSegment(container)}\` grow with its content instead of fixing its height (height: ${styleOf(container).height}).`,
		})
	}
	const reportedViewportOwners = outermostOwners(viewportGroups.keys())
	for (const owner of reportedViewportOwners) {
		const group = viewportGroups.get(owner)
		if (group === undefined) continue
		// Report the outermost box that crosses the edge while its own parent fits: that boundary is where the layout breaks.
		let culprit: Element = owner
		for (let current = owner.parentElement; current !== null && !isRoot(current); current = current.parentElement) {
			const rect = current.getBoundingClientRect()
			if (rect.right - viewportWidth > tolerance || rect.left < -tolerance) culprit = current
			else break
		}
		const rect = culprit.getBoundingClientRect()
		const where = describeOverhang({ left: -rect.left, right: rect.right - viewportWidth, top: 0, bottom: 0 }, { x: true, y: false }) || describeOverhang(group.worst, { x: true, y: false })
		report({
			kind: 'viewport-overflow',
			severity: 'high',
			element: culprit,
			signatureText: group.texts.join('|'),
			message: `Content runs off the ${viewportWidth.toString()}px-wide screen and is cut off: \`${describeSegment(culprit)}\` is ${px(rect.width)} wide and reaches ${where} past the viewport edge (${textList(group.texts)}). The page clips horizontal overflow, so the reader cannot scroll to it.`,
			fix: `Make it fit the viewport: ${widthCause(culprit, group.texts.join(' '), [...group.owners])}.`,
		})
	}
}
