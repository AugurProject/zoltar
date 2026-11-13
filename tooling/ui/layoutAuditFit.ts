import type { LayoutAuditTools, TextAtom } from './layoutAuditTools.ts'
import type { LayoutSeverity } from './layoutAudit.ts'

/**
 * Fit checks: squeezed columns, words split mid-word, wrapping tab and badge labels, field text wider than its field, and dialogs larger than the viewport.
 * Injected with `Function.prototype.toString`, so it must stay self-contained apart from the `tools` argument.
 */
export function auditFit(tools: LayoutAuditTools) {
	const { tolerance, viewportWidth, viewportHeight, styleOf, px, snippet, isRoot, isHidden, describeSegment, report, widthCause, textAtoms, fullAudit, isScrolling, describeOverhang, blockAncestor, pinnedAncestor, lineTops } = tools
	// ---------- Squeezed boxes ----------

	const squeezedOwners = new Set<Element>()
	for (const atom of fullAudit ? textAtoms : []) {
		const block = blockAncestor(atom.owner)
		if (squeezedOwners.has(block)) continue
		const words = atom.text.split(' ').filter(word => word !== '')
		const lines = lineTops(atom.rects)
		const fontSize = Number.parseFloat(styleOf(atom.owner).fontSize)
		const blockWidth = block.getBoundingClientRect().width
		const oneWordPerLine = words.length >= 3 && lines >= 4 && lines >= words.length * 0.75
		const tooNarrow = words.length >= 2 && blockWidth > 0 && blockWidth < fontSize * 3 && lines >= 2
		if (!oneWordPerLine && !tooNarrow) continue
		squeezedOwners.add(block)
		report({
			kind: 'squeezed',
			severity: 'medium',
			element: block,
			signatureText: atom.text,
			message: `Text is squeezed into a column too narrow to read: "${snippet(atom.text, 50)}" wraps onto ${lines.toString()} lines (${words.length.toString()} words) in \`${describeSegment(block)}\`, which is only ${px(blockWidth)} wide.`,
			fix: `Give the box a usable minimum width or stack it below its neighbours at this width; ${widthCause(block.parentElement ?? block)}.`,
		})
	}

	// Ordinary words broken across lines.
	for (const atom of fullAudit ? textAtoms : []) {
		const style = styleOf(atom.owner)
		if (style.overflowWrap === 'normal' && style.wordBreak === 'normal') continue
		if (atom.rects.length < 2 || style.hyphens === 'auto') continue
		const text = atom.node.data
		const wordPattern = /\p{L}[\p{L}'’]{2,19}/gu
		for (let match = wordPattern.exec(text); match !== null; match = wordPattern.exec(text)) {
			// Hashes, addresses, and other long tokens are meant to break anywhere.
			const tokenStart = text.lastIndexOf(' ', match.index) + 1
			const tokenEnd = text.indexOf(' ', match.index)
			const token = text.slice(tokenStart, tokenEnd === -1 ? text.length : tokenEnd)
			if (token.length > 24 || /^(0x)?[0-9a-f]{6,}/i.test(token) || /\d/.test(match[0])) continue
			const range = document.createRange()
			range.setStart(atom.node, match.index)
			range.setEnd(atom.node, match.index + match[0].length)
			const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5)
			if (lineTops(rects) < 2) continue
			const block = blockAncestor(atom.owner)
			report({
				kind: 'broken-word',
				severity: 'medium',
				element: block,
				signatureText: match[0],
				message: `A word is split across lines: "${match[0]}" in "${snippet(atom.text, 50)}" breaks mid-word because \`${describeSegment(block)}\` is only ${px(block.getBoundingClientRect().width)} wide (\`overflow-wrap: ${style.overflowWrap}\`, \`word-break: ${style.wordBreak}\`).`,
				fix: `Give the box room for whole words, or limit forced breaking to unbreakable values such as addresses; ${widthCause(block.parentElement ?? block)}.`,
			})
			break
		}
	}

	// Tab, segmented-control, and badge labels that wrap. Buttons are left out: a long action label wrapping inside a
	// full-width button is an intended layout. Tab bars pinned to the viewport edge use two-line cells by design.
	// Only painted text counts, so visually hidden labels of icon buttons are ignored.
	const atomsByControl = new Map<Element, TextAtom[]>()
	const labelSelector = '[role=tab], .view-tab, .badge, .chip, .pill, .tag, .status-chip'
	for (const atom of fullAudit ? textAtoms : []) {
		const control = atom.owner.closest(labelSelector)
		if (control === null || pinnedAncestor(control) !== undefined) continue
		const list = atomsByControl.get(control) ?? []
		list.push(atom)
		atomsByControl.set(control, list)
	}
	for (const [control, atoms] of atomsByControl) {
		const text = atoms.map(atom => atom.text).join(' ')
		const words = text.split(' ').filter(word => word !== '')
		if (words.length === 0 || words.length > 4 || text.length > 40) continue
		// Count lines per text run: a label and a status placed on separate rows are not a wrapped label.
		const lines = Math.max(...atoms.map(atom => lineTops(atom.rects)))
		if (lines < 2) continue
		// A label wider than all the room its container has must wrap; only report a label squeezed by its neighbours.
		const controlStyle = styleOf(control)
		const chrome = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, property) => sum + Number.parseFloat(controlStyle.getPropertyValue(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`))), 0)
		const oneLineWidth = atoms.flatMap(atom => atom.rects).reduce((sum, lineRect) => sum + lineRect.width, 0) + chrome
		const parent = control.parentElement
		if (parent !== null) {
			const parentStyle = styleOf(parent)
			const room = parent.clientWidth - Number.parseFloat(parentStyle.paddingLeft) - Number.parseFloat(parentStyle.paddingRight)
			if (oneLineWidth > room + tolerance) continue
		}
		const rect = control.getBoundingClientRect()
		report({
			kind: 'wrapped-label',
			severity: 'low',
			element: control,
			signatureText: text,
			message: `A short label wraps onto ${lines.toString()} lines: "${text}" in \`${describeSegment(control)}\` (${px(rect.width)} wide).`,
			fix: `Keep the label on one line with \`white-space: nowrap\` and let the row wrap instead, or give the control more room; ${widthCause(control.parentElement ?? control)}.`,
		})
	}

	// ---------- Form fields ----------

	const canvas = document.createElement('canvas')
	const context2d = canvas.getContext('2d')
	const textWidth = (text: string, element: Element) => {
		if (context2d === null) return 0
		const style = styleOf(element)
		context2d.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
		const spacing = Number.parseFloat(style.letterSpacing)
		return context2d.measureText(text).width + (Number.isFinite(spacing) ? spacing * text.length : 0)
	}
	for (const field of fullAudit ? document.querySelectorAll('input, select') : []) {
		if (isHidden(field) || field.getClientRects().length === 0) continue
		if (field instanceof HTMLInputElement && !['text', 'number', 'search', 'email', 'url', 'tel', ''].includes(field.type)) continue
		const style = styleOf(field)
		const available = field.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - (field instanceof HTMLSelectElement ? 4 : 0)
		const candidates: { label: string; text: string; severity: LayoutSeverity }[] = []
		// A typed or prefilled value scrolls inside its input, so only text the reader cannot scroll to counts: the
		// placeholder and the selected option of a closed select.
		if (field instanceof HTMLInputElement) {
			if (field.value === '' && field.placeholder !== '') candidates.push({ label: 'placeholder', text: field.placeholder, severity: 'medium' })
		} else if (field instanceof HTMLSelectElement) {
			const option = field.selectedOptions[0]
			if (option !== undefined) candidates.push({ label: 'selected option', text: option.text, severity: 'medium' })
		}
		for (const candidate of candidates) {
			const needed = textWidth(candidate.text, field)
			if (needed <= available + tolerance) continue
			report({
				kind: 'field-clipped',
				severity: candidate.severity,
				element: field,
				signatureText: candidate.label,
				message: `The ${candidate.label} does not fit its field: "${snippet(candidate.text, 50)}" needs about ${px(needed)} but \`${describeSegment(field)}\` leaves ${px(available)} for text, so the end is cut off.`,
				fix: `Widen the field (it is ${px(field.getBoundingClientRect().width)} wide), shorten the ${candidate.label}, or move the explanation into the field's label or hint; ${widthCause(field)}.`,
			})
		}
	}

	// ---------- Dialogs ----------

	for (const dialog of fullAudit ? document.querySelectorAll('[role=dialog], dialog[open], [aria-modal=true]') : []) {
		if (isHidden(dialog) || dialog.getClientRects().length === 0) continue
		const rect = dialog.getBoundingClientRect()
		const amount = { left: -rect.left, right: rect.right - viewportWidth, top: -rect.top, bottom: rect.bottom - viewportHeight }
		if (Math.max(amount.left, amount.right, amount.top, amount.bottom) <= tolerance) continue
		let scrollable = false
		for (let current: Element | null = dialog; current !== null; current = current.parentElement) {
			const style = styleOf(current)
			if ((isScrolling(style, 'y') && current.scrollHeight > current.clientHeight) || (isRoot(current) && styleOf(dialog).position !== 'fixed')) {
				scrollable = true
				break
			}
		}
		if (scrollable && amount.left <= tolerance && amount.right <= tolerance) continue
		report({
			kind: 'dialog-overflow',
			severity: 'high',
			element: dialog,
			message: `A dialog does not fit the ${viewportWidth.toString()}×${viewportHeight.toString()} viewport and cannot be scrolled: \`${describeSegment(dialog)}\` (${px(rect.width)}×${px(rect.height)}) extends ${describeOverhang(amount, { x: true, y: true })} past the screen.`,
			fix: 'Cap the dialog at the viewport (`max-height: 100dvh`, `max-width: 100vw` minus margins) and make its body scroll.',
		})
	}
}
