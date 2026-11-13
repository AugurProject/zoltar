import { auditContainment } from './layoutAuditContainment.ts'
import { auditFit } from './layoutAuditFit.ts'
import { auditPaint } from './layoutAuditPaint.ts'
import { createLayoutAuditTools } from './layoutAuditTools.ts'

/**
 * In-page layout audit used by `tooling/ui/layoutScan.mts`.
 *
 * `layoutAuditExpression` builds the script the scanner and tests evaluate in the browser. The audit functions it
 * injects with `Function.prototype.toString` (`layoutAuditTools.ts`, `layoutAuditContainment.ts`, `layoutAuditPaint.ts`,
 * and `layoutAuditFit.ts`) must stay self-contained: no runtime imports and no references to module scope. It measures the rendered page and reports content
 * that a reader cannot see in full:
 *
 * - `viewport-overflow`: content that reaches past the left or right edge of the viewport. The apps clip horizontal
 *   overflow on `html` and `body`, so such content is cut off instead of scrolling.
 * - `clipped`: content cut off by an ancestor with `overflow: hidden` or `clip` and no ellipsis.
 * - `truncated`: text shortened with an ellipsis or a line clamp while no title or accessible name exposes the full text.
 * - `spill`: content that escapes a bordered or filled box whose overflow is visible, so it paints over the box edge.
 * - `text-overlap`: two visible runs of text drawn on top of each other.
 * - `obscured`: text covered by an opaque element that is not a menu, dialog, or tooltip, including content left under
 *   a fixed or sticky bar at the top or bottom of the page.
 * - `control-overlap`: two interactive controls whose boxes intersect.
 * - `squeezed`: a box too narrow for its text (about one word per line, or narrower than three characters).
 * - `broken-word`: an ordinary word split across lines because the box is narrower than the word.
 * - `wrapped-label`: a short button, tab, or badge label that wraps onto several lines.
 * - `field-clipped`: an input placeholder, value, or selected option wider than the field.
 * - `dialog-overflow`: a dialog that extends past the viewport without a way to scroll to the rest.
 *
 * Each finding names the element, the measured sizes, and the most likely cause, so it can be fixed without rerunning
 * the scan. Elements behind a reported finding receive a `data-layout-scan-id` attribute so the scanner can screenshot them.
 */

export type LayoutFindingKind = 'viewport-overflow' | 'clipped' | 'truncated' | 'spill' | 'text-overlap' | 'obscured' | 'control-overlap' | 'squeezed' | 'broken-word' | 'wrapped-label' | 'field-clipped' | 'dialog-overflow'

export type LayoutSeverity = 'high' | 'medium' | 'low'

export type LayoutRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type LayoutElementInfo = {
	/** Short CSS-like path from a landmark down to the element, for example `main > section.pool-card > dd.metric-value`. */
	readonly path: string
	/** Classes of the element and its nearest ancestors, most specific first; used to find the source. */
	readonly classes: readonly string[]
	readonly text: string
	/** Document coordinates in CSS pixels. */
	readonly rect: LayoutRect
	/** `data-layout-scan-id` assigned to the element for highlighting. */
	readonly scanId: string
}

export type LayoutFinding = {
	readonly kind: LayoutFindingKind
	readonly severity: LayoutSeverity
	/** Stable identity across routes, states, and viewports: the kind plus the element path and text, without positions. */
	readonly signature: string
	/** What is wrong, with measurements. */
	readonly message: string
	/** The most likely cause and a fix direction. */
	readonly fix: string
	/** Heading or landmark label of the surrounding section. */
	readonly context: string
	readonly element: LayoutElementInfo
	/** The other party of an overlap, or the box that clips or is spilled out of. */
	readonly related?: LayoutElementInfo
}

export type LayoutAuditOptions = {
	/** Pixels of overhang tolerated before content counts as cut off or spilled. */
	readonly tolerance?: number
	/** Only report elements inside this selector, for example an open dialog. */
	readonly scope?: string
	/**
	 * Only run the checks that depend on the scroll position (text overlap and occlusion are confirmed against what is
	 * painted in the viewport). The scanner runs the full audit once per state and this subset at each further scroll step.
	 */
	readonly viewportChecksOnly?: boolean
}

/** The browser expression that runs the audit and evaluates to its `LayoutFinding[]`. */
export function layoutAuditExpression(options: LayoutAuditOptions = {}) {
	return `(() => { const tools = (${createLayoutAuditTools.toString()})(${JSON.stringify(options)}); (${auditContainment.toString()})(tools); (${auditPaint.toString()})(tools); (${auditFit.toString()})(tools); return tools.finish() })()`
}
