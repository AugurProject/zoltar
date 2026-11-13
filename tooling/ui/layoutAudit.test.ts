import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDevToolsSession, type DevToolsSession } from './browserSmoke.mts'
import { getChromiumPath } from './chromiumPath.js'
import { layoutAuditExpression, type LayoutAuditOptions, type LayoutFinding } from './layoutAudit.ts'

// Each fixture is a small page with exactly one kind of layout defect, or with intentional patterns that must stay quiet.
// The pages clip horizontal overflow on the root like the apps do (ui/coreShared/css/base.css).
const BASE_STYLE = 'html, body { margin: 0; overflow-x: clip; font: 16px/1.5 sans-serif } .box { border: 1px solid #888 }'
const viewport = { width: 390, height: 600 }
let session: DevToolsSession

async function audit(body: string, options: LayoutAuditOptions & { readonly scrollToBottom?: boolean } = {}): Promise<LayoutFinding[]> {
	const html = `<!doctype html><html><head><style>${BASE_STYLE}</style></head><body>${body}</body></html>`
	await session.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close()`)
	await session.evaluate('document.fonts.ready.then(() => true)')
	if (options.scrollToBottom === true) await session.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
	const { scrollToBottom: _scrollToBottom, ...auditOptions } = options
	const findings = await session.evaluate(layoutAuditExpression(auditOptions))
	if (!Array.isArray(findings)) throw new Error('The layout audit returned no array')
	return findings as LayoutFinding[]
}

const kinds = (findings: readonly LayoutFinding[]) => findings.map(finding => finding.kind).sort()
const only = (findings: readonly LayoutFinding[], kind: LayoutFinding['kind']) => {
	const matches = findings.filter(finding => finding.kind === kind)
	expect(matches).toHaveLength(1)
	const [match] = matches
	if (match === undefined) throw new Error(`Expected one ${kind} finding`)
	return match
}

beforeAll(async () => {
	const chromiumPath = process.env['CHROMIUM_PATH'] ?? getChromiumPath()
	if (chromiumPath === undefined) throw new Error('The layout audit tests need Chromium. Install Chromium or set CHROMIUM_PATH.')
	session = await createDevToolsSession(chromiumPath, 'about:blank', viewport)
	await session.send('Runtime.enable')
	await session.send('Page.enable')
	await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
})

afterAll(async () => {
	await session.close()
})

describe('layout audit reports', () => {
	test('content cut off by a box that hides its overflow, with the box, sizes, and hidden amount', async () => {
		const finding = only(await audit('<main><div class="price-cell" style="width: 100px; overflow: hidden"><span style="white-space: nowrap">1,234,567.890 REP per share</span></div></main>'), 'clipped')
		expect(finding.severity).toBe('high')
		expect(finding.element.path).toBe('main > div.price-cell')
		expect(finding.message).toContain('`div.price-cell` (100px')
		expect(finding.message).toContain('on the right of "1,234,567.890 REP per share" is hidden')
		expect(finding.fix).toContain('white-space: nowrap')
	})

	test('vertical clipping by a capped height', async () => {
		const finding = only(await audit('<div class="card" style="max-height: 40px; overflow: hidden; width: 200px">First line of text<br>Second line<br>Third line</div>'), 'clipped')
		expect(finding.message).toContain('of height')
		expect(finding.fix).toContain('max-height: 40px')
	})

	test('ellipsis truncation without the full text, and stays quiet when a title carries it', async () => {
		const truncating = 'width: 120px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis'
		expect(kinds(await audit(`<div style="${truncating}">Settlement window closes tomorrow</div>`))).toEqual(['truncated'])
		expect(await audit(`<div style="${truncating}" title="Settlement window closes tomorrow">Settlement window closes tomorrow</div>`)).toEqual([])
	})

	test('content that runs off the clipped viewport edge, naming the box where the layout breaks', async () => {
		const finding = only(await audit('<main><section class="wide-panel" style="width: 600px"><p>Short text inside a panel that is wider than the phone screen.</p></section></main>'), 'viewport-overflow')
		expect(finding.element.path).toBe('main > section.wide-panel')
		expect(finding.message).toContain('390px-wide screen')
		expect(finding.message).toContain('210px on the right')
	})

	test('an unbreakable value escaping its bordered box', async () => {
		const findings = await audit('<div class="box address" style="width: 200px">0x1234567890abcdef1234567890abcd</div>')
		const finding = only(findings, 'spill')
		expect(finding.related?.path).toBe('div.box.address')
		expect(finding.fix).toContain('overflow-wrap: anywhere')
	})

	test('a grid item that cannot shrink below its content explains min-width', async () => {
		// A monospace value about 250px wide in a 100px track: the item grows past the bordered grid on any font metrics,
		// while staying inside the 390px viewport so the finding is a spill rather than a viewport overflow.
		const findings = await audit('<div class="box" style="display: grid; grid-template-columns: 1fr 1fr; width: 200px; font: 14px monospace"><div class="value">0x1234567890abcdef1234567890ab</div><div>B</div></div>')
		const finding = only(findings, 'spill')
		expect(finding.fix).toContain('`div.value` is a grid item with the default `min-width: auto`')
	})

	test('text drawn over other text', async () => {
		const finding = only(await audit('<div style="position: relative; height: 40px"><span class="label">Total supply</span><span class="value" style="position: absolute; left: 20px; top: 0">12,345 REP</span></div>'), 'text-overlap')
		expect(finding.message).toContain('"Total supply"')
		expect(finding.message).toContain('"12,345 REP"')
		expect(finding.fix).toContain('absolutely positioned')
	})

	test('text hidden behind an opaque element', async () => {
		const finding = only(await audit('<div style="position: relative"><p>Your deposit is locked until the fork resolves.</p><div class="badge-cover" style="position: absolute; top: 0; left: 0; width: 300px; height: 40px; background: #fff"></div></div>'), 'obscured')
		expect(finding.related?.path).toContain('div.badge-cover')
	})

	test('content left under a fixed bottom bar when the page is scrolled to the end', async () => {
		const findings = await audit('<div style="height: 900px"></div><p>Last paragraph of the page.</p><nav class="tab-bar" style="position: fixed; bottom: 0; left: 0; right: 0; height: 80px; background: #fff"></nav>', { scrollToBottom: true })
		const finding = only(findings, 'obscured')
		expect(finding.message).toContain('fixed bar `nav.tab-bar`')
		expect(finding.fix).toContain('80px')
	})

	test('overlapping controls', async () => {
		const finding = only(await audit('<div><button style="width: 120px">Approve</button><button style="margin-left: -40px; width: 120px">Deposit</button></div>'), 'control-overlap')
		expect(finding.message).toContain('"Approve" and "Deposit"')
		expect(finding.fix).toContain('negative margin')
	})

	test('text squeezed into a narrow column', async () => {
		const finding = only(await audit('<div style="display: flex; width: 360px"><div style="flex: 0 0 300px">Main content</div><div class="side" style="flex: 1 1 0; min-width: 0">Reporting window closes soon</div></div>'), 'squeezed')
		expect(finding.element.path).toBe('div > div.side')
	})

	test('an ordinary word broken mid-word', async () => {
		expect(kinds(await audit('<div style="width: 40px; overflow-wrap: anywhere">Settlement</div>'))).toEqual(['broken-word'])
	})

	test('a tab label that wraps', async () => {
		const finding = only(await audit('<div role="tablist" aria-label="Status"><button role="tab" style="width: 60px">Closing soon</button></div>'), 'wrapped-label')
		expect(finding.message).toContain('"Closing soon"')
	})

	test('a placeholder wider than its field', async () => {
		const finding = only(await audit('<input style="width: 90px" placeholder="Question ID, title, or description">'), 'field-clipped')
		expect(finding.message).toContain('placeholder')
	})

	test('a dialog taller than the viewport without scrolling', async () => {
		const findings = await audit('<div role="dialog" aria-label="Deposit" style="position: fixed; top: 20px; left: 20px; width: 300px; height: 1200px; background: #fff">Dialog body</div>')
		expect(only(findings, 'dialog-overflow').message).toContain('at the bottom')
	})
})

describe('layout audit stays quiet for intentional patterns', () => {
	test('scroll containers, visually hidden text, icon buttons, and hidden elements', async () => {
		const findings = await audit(`
			<div style="overflow-x: auto; width: 300px"><table><tr><td style="white-space: nowrap">A very wide table cell that scrolls inside its container</td></tr></table></div>
			<span style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Screen reader only label that is long</span>
			<button style="width: 40px; height: 40px"><svg width="16" height="16" aria-hidden="true"></svg><span style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Activity</span></button>
			<div style="display: none; width: 900px">Hidden wide content</div>
			<p>Ordinary wrapping paragraph text that fits the screen width and wraps normally across several lines.</p>`)
		expect(findings).toEqual([])
	})

	test('menus and sticky headers covering content', async () => {
		const findings = await audit(`
			<header style="position: sticky; top: 0; background: #fff; height: 40px">Header</header>
			<div style="height: 200px"><p>Content under an open menu</p></div>
			<div role="menu" style="position: absolute; top: 40px; left: 0; width: 300px; background: #fff">Menu item</div>
			<div style="height: 1200px"></div>`)
		expect(findings).toEqual([])
	})

	test('custom checkboxes over a transparent native input and absolutely placed decorations', async () => {
		const findings = await audit(`
			<label style="position: relative; display: inline-block"><input type="checkbox" style="position: absolute; inset: 0; opacity: 0; margin: 0"><button type="button">Remember</button></label>
			<div style="position: relative"><span>Status</span><span aria-hidden="true" style="position: absolute; left: 0; top: 0">Status</span></div>`)
		expect(findings.filter(finding => finding.kind === 'control-overlap')).toEqual([])
	})

	test('hashes breaking anywhere, two-row step buttons, wrapping action buttons, and pinned tab bars', async () => {
		const findings = await audit(`
			<div style="width: 120px; overflow-wrap: anywhere">0x2ac1a0609165ac62ab49d5ba3e5290cbbbc365dbc2a1614</div>
			<button role="tab" style="width: 300px"><span style="display: block">Select outcomes</span><span style="display: block">Current</span></button>
			<button style="width: 150px">Credit and withdraw refunds</button>
			<nav style="position: fixed; bottom: 0; left: 0; background: #fff"><a class="view-tab" href="#/questions" style="display: inline-block; width: 90px">Browse questions</a></nav>`)
		expect(findings).toEqual([])
	})

	test('a long value inside an input, which scrolls', async () => {
		expect(await audit('<input style="width: 90px" value="1979.166666666666664885">')).toEqual([])
	})

	test('the body of a closed details element', async () => {
		const findings = await audit(`
			<details><summary>More options</summary>
				<div style="width: 600px"><p>Hidden option text</p><p style="margin-top: -24px">Overlapping hidden text</p></div>
			</details>`)
		expect(findings).toEqual([])
	})

	test('scope limits the report to an open dialog', async () => {
		const findings = await audit('<div style="width: 60px; overflow: hidden; white-space: nowrap">Cut off page text</div><div role="dialog">Dialog text</div>', { scope: '[role=dialog]' })
		expect(findings).toEqual([])
	})
})
