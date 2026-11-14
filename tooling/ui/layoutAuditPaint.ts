import type { LayoutAuditTools, TextAtom } from './layoutAuditTools.ts'

/**
 * Paint-order checks confirmed against what the viewport shows: overlapping text (`text-overlap`), text behind opaque boxes or pinned bars (`obscured`), and intersecting controls (`control-overlap`).
 * Injected with `Function.prototype.toString`, so it must stay self-contained apart from the `tools` argument.
 */
export function auditPaint(tools: LayoutAuditTools) {
	const { viewportWidth, viewportHeight, scrollX, scrollY, styleOf, round, px, snippet, describeSegment, textOf, accessibleLabel, report, textAtoms, controls, fullAudit, isPopupLayer, pinnedAncestor, isPositionedDecoration, overlapCause } = tools
	// ---------- Text overlap and occlusion ----------

	const isTransparent = (color: string) => /rgba\(\d+, \d+, \d+, 0(?:\.0\d*)?\)|transparent/.test(color)
	const isOpaque = (element: Element) => {
		const style = styleOf(element)
		if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement) return true
		if (style.backgroundImage !== 'none' && !style.backgroundImage.startsWith('radial-gradient')) return true
		const match = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)
		if (match?.[1] === undefined) return false
		const parts = match[1].split(',').map(part => Number.parseFloat(part))
		return isTransparent(style.backgroundColor) ? false : parts.length < 4 || (parts[3] ?? 1) >= 0.85
	}
	const commonLayer = (first: Element, second: Element) => pinnedAncestor(first) === pinnedAncestor(second)

	// Two text runs from different nodes that cover the same pixels.
	const cellSize = 64
	const grid = new Map<string, { atom: TextAtom; rect: DOMRect }[]>()
	for (const atom of textAtoms) {
		for (const rect of atom.rects) {
			for (let x = Math.floor((rect.left + scrollX) / cellSize); x <= Math.floor((rect.right + scrollX) / cellSize); x++) {
				for (let y = Math.floor((rect.top + scrollY) / cellSize); y <= Math.floor((rect.bottom + scrollY) / cellSize); y++) {
					const key = `${x.toString()}:${y.toString()}`
					const cell = grid.get(key) ?? []
					cell.push({ atom, rect })
					grid.set(key, cell)
				}
			}
		}
	}
	const comparedPairs = new Set<string>()
	const atomIds = new Map<TextAtom, number>(textAtoms.map((atom, index) => [atom, index]))
	for (const cell of grid.values()) {
		for (let first = 0; first < cell.length; first++) {
			for (let second = first + 1; second < cell.length; second++) {
				const a = cell[first]
				const b = cell[second]
				if (a === undefined || b === undefined || a.atom === b.atom) continue
				const ids = [atomIds.get(a.atom) ?? 0, atomIds.get(b.atom) ?? 0].sort((left, right) => left - right)
				const pairKey = `${ids.join(':')}:${round(a.rect.top).toString()}:${round(b.rect.top).toString()}`
				if (comparedPairs.has(pairKey)) continue
				comparedPairs.add(pairKey)
				const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
				const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
				if (width < 4 || height < Math.min(a.rect.height, b.rect.height) * 0.45) continue
				if (a.atom.owner.contains(b.atom.owner) && isPositionedDecoration(b.atom.owner)) continue
				if (b.atom.owner.contains(a.atom.owner) && isPositionedDecoration(a.atom.owner)) continue
				if (!commonLayer(a.atom.owner, b.atom.owner) && (isPopupLayer(a.atom.owner) || isPopupLayer(b.atom.owner) || pinnedAncestor(a.atom.owner) !== undefined || pinnedAncestor(b.atom.owner) !== undefined)) continue
				if (isPopupLayer(a.atom.owner) !== isPopupLayer(b.atom.owner)) continue
				// Confirm in the paint order that neither run is hidden behind an opaque box.
				const centerX = Math.max(a.rect.left, b.rect.left) + width / 2
				const centerY = Math.max(a.rect.top, b.rect.top) + height / 2
				// Overlaps outside the viewport are confirmed at the scroll step that shows them.
				if (centerX < 0 || centerX >= viewportWidth || centerY < 0 || centerY >= viewportHeight) continue
				{
					const stack = document.elementsFromPoint(centerX, centerY)
					const indexOf = (owner: Element) => stack.findIndex(element => element === owner || owner.contains(element))
					const aIndex = indexOf(a.atom.owner)
					const bIndex = indexOf(b.atom.owner)
					const lower = aIndex > bIndex ? a : b
					const lowerIndex = Math.max(aIndex, bIndex)
					if (lowerIndex > 0 && stack.slice(0, lowerIndex).some(element => !element.contains(lower.atom.owner) && isOpaque(element))) continue
				}
				report({
					kind: 'text-overlap',
					severity: 'high',
					element: a.atom.owner,
					related: b.atom.owner,
					signatureText: `${a.atom.text}|${b.atom.text}`,
					message: `Text overlaps other text: "${snippet(a.atom.text, 40)}" (\`${describeSegment(a.atom.owner)}\`) and "${snippet(b.atom.text, 40)}" (\`${describeSegment(b.atom.owner)}\`) are drawn on top of each other over a ${px(width)}×${px(height)} area.`,
					fix: overlapCause(a.atom.owner, b.atom.owner),
				})
			}
		}
	}

	// Text hidden behind opaque, non-popup boxes. Pinned bars only count when the page cannot scroll the text out from under them.
	const maxScrollY = document.documentElement.scrollHeight - viewportHeight
	for (const atom of textAtoms) {
		if (isPopupLayer(atom.owner)) continue
		for (const rect of atom.rects) {
			const x = rect.left + Math.min(rect.width / 2, 12)
			const y = rect.top + rect.height / 2
			if (x < 0 || x >= viewportWidth || y < 0 || y >= viewportHeight) continue
			const top = document.elementFromPoint(x, y)
			if (top === null || top === atom.owner || atom.owner.contains(top) || top.contains(atom.owner)) continue
			if (isPopupLayer(top)) continue
			const stack = document.elementsFromPoint(x, y)
			const ownerIndex = stack.findIndex(element => element === atom.owner || element.contains(atom.owner))
			if (ownerIndex <= 0) continue
			const covers = stack.slice(0, ownerIndex).filter(element => !element.contains(atom.owner) && isOpaque(element))
			const cover = covers[0]
			if (cover === undefined) continue
			const pinned = pinnedAncestor(cover)
			if (pinned !== undefined && pinnedAncestor(atom.owner) !== pinned) {
				const pinnedRect = pinned.getBoundingClientRect()
				const atBottom = pinnedRect.bottom >= viewportHeight - 2
				const atTop = pinnedRect.top <= 2
				const stuck = (atBottom && scrollY >= maxScrollY - 2) || (atTop && scrollY <= 2 && styleOf(pinned).position === 'fixed')
				if (!stuck) continue
			}
			const coverRect = cover.getBoundingClientRect()
			report({
				kind: 'obscured',
				severity: 'high',
				element: atom.owner,
				elementRect: rect,
				related: cover,
				signatureText: atom.text,
				message:
					pinned === undefined
						? `Text is hidden behind another element: "${snippet(atom.text, 40)}" is covered by \`${describeSegment(cover)}\` (${px(coverRect.width)}×${px(coverRect.height)}).`
						: `Text stays hidden under the ${styleOf(pinned).position} bar \`${describeSegment(pinned)}\` even when the page is scrolled as far as it goes: "${snippet(atom.text, 40)}" sits behind it.`,
				fix: pinned === undefined ? overlapCause(atom.owner, cover) : `Reserve space for the bar: pad the end of the scrolling content by the bar's height (${px(pinned.getBoundingClientRect().height)}).`,
			})
			break
		}
	}

	// Interactive controls whose boxes intersect.
	for (let first = 0; fullAudit && first < controls.length; first++) {
		const a = controls[first]
		if (a === undefined) continue
		const aRect = a.getBoundingClientRect()
		for (let second = first + 1; second < controls.length; second++) {
			const b = controls[second]
			if (b === undefined || a.contains(b) || b.contains(a)) continue
			const bRect = b.getBoundingClientRect()
			const width = Math.min(aRect.right, bRect.right) - Math.max(aRect.left, bRect.left)
			const height = Math.min(aRect.bottom, bRect.bottom) - Math.max(aRect.top, bRect.top)
			if (width <= 3 || height <= 3) continue
			if (!commonLayer(a, b) || isPopupLayer(a) !== isPopupLayer(b)) continue
			if (a.matches('label') || b.matches('label') || a.closest('label')?.contains(b) === true || b.closest('label')?.contains(a) === true) continue
			// A visually hidden native input under its styled control is intentional.
			if ([a, b].some(element => element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio') && Number(styleOf(element).opacity) < 0.1)) continue
			report({
				kind: 'control-overlap',
				severity: 'high',
				element: a,
				related: b,
				message: `Controls overlap: "${textOf(a) || accessibleLabel(a) || describeSegment(a)}" and "${textOf(b) || accessibleLabel(b) || describeSegment(b)}" share a ${px(width)}×${px(height)} area, so one covers part of the other and clicks can land on the wrong control.`,
				fix: overlapCause(a, b),
			})
		}
	}
}
