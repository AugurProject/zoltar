import { describe, expect, test } from 'bun:test'
import type { UiScreenshotSpec } from './ui-screenshot-specs.mts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractScreenshotReferences, findScreenshotProblems, isScreenshotSourcePath, screenshotAppIds, pickMatch, readPngSize, updateEmbeddingPages, withScreenshotSize } from './ui-screenshots.mts'

const spec: UiScreenshotSpec = { id: 'buy-ticket', app: 'trading', scenario: 'trading-funded', usedBy: ['tutorials/trading-first-trade.html'] }
const outputPath = 'docs/assets/screenshots/trading/buy-ticket.png'
const page = 'tutorials/trading-first-trade.html'
const embed = (attributes: string) => `<p>Intro</p><img src="../assets/screenshots/trading/buy-ticket.png" ${attributes} /><img src="../assets/diagram.png" alt="unrelated" />`

const pngHeader = (width: number, height: number) => {
	const bytes = new Uint8Array(24)
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
	const view = new DataView(bytes.buffer)
	view.setUint32(16, width)
	view.setUint32(20, height)
	return bytes
}

describe('documentation screenshots', () => {
	test('reads PNG dimensions and rejects other files', () => {
		expect(readPngSize(pngHeader(480, 1213))).toEqual({ width: 480, height: 1213 })
		expect(() => readPngSize(new Uint8Array(24))).toThrow('Not a PNG file')
	})

	test('extracts only screenshot embeds, resolved from the page directory', () => {
		expect(extractScreenshotReferences(page, embed('width="480" height="1213" alt="Ticket"'))).toEqual([{ page, src: outputPath, alt: 'Ticket', width: '480', height: '1213' }])
	})

	test('rewrites the size of every matching embed and leaves other images alone', () => {
		const updated = withScreenshotSize(page, embed('width="1" height="1" alt="Ticket"'), outputPath, { width: 480, height: 1213 })
		expect(extractScreenshotReferences(page, updated)).toEqual([{ page, src: outputPath, alt: 'Ticket', width: '480', height: '1213' }])
		expect(updated).toContain('<img src="../assets/diagram.png" alt="unrelated" />')
	})

	test('accepts a consistent set of specs, files, and embeds', () => {
		const references = extractScreenshotReferences(page, embed('width="480" height="1213" alt="Ticket"'))
		expect(findScreenshotProblems({ files: new Map([[outputPath, { width: 480, height: 1213 }]]), references, specs: [spec] })).toEqual([])
	})

	test('reports missing images, stale sizes, missing alt text, unowned embeds, and orphan files', () => {
		const references = extractScreenshotReferences(page, embed('width="1" height="1" alt=""'))
		const orphan = 'docs/assets/screenshots/trading/old.png'
		const problems = findScreenshotProblems({
			files: new Map([
				[outputPath, { width: 480, height: 1213 }],
				[orphan, { width: 1, height: 1 }],
			]),
			references,
			specs: [spec, { ...spec, id: 'sell-ticket' }],
		})
		expect(problems.some(problem => problem.includes('sell-ticket.png is missing'))).toBe(true)
		expect(problems.some(problem => problem.includes('but the image is 480x1213'))).toBe(true)
		expect(problems.some(problem => problem.includes('without alt text'))).toBe(true)
		expect(problems.some(problem => problem.includes(`${orphan} is not produced by any screenshot spec`))).toBe(true)
		expect(findScreenshotProblems({ files: new Map([[outputPath, { width: 1, height: 1 }]]), references, specs: [] }).some(problem => problem.includes('which no entry in tooling/docs/ui-screenshot-specs.mts produces'))).toBe(true)
	})

	test('treats rendering sources as screenshot inputs but not tests or build output', () => {
		expect(isScreenshotSourcePath('trading', 'ui/trading/ts/features/LivePositionControls.tsx')).toBe(true)
		expect(isScreenshotSourcePath('trading', 'ui/coreShared/css/application-surfaces.css')).toBe(true)
		expect(isScreenshotSourcePath('trading', 'ui/coreShared/ts/app/components/ProtocolAppFrame.tsx')).toBe(true)
		expect(isScreenshotSourcePath('trading', 'ui/coreShared/ts/lib/formatters.ts')).toBe(true)
		for (const app of screenshotAppIds()) {
			expect(isScreenshotSourcePath(app, 'ui/coreShared/ts/lib/universeIdentity.ts')).toBe(true)
			expect(isScreenshotSourcePath(app, 'ui/coreShared/ts/lib/oklch.ts')).toBe(true)
		}
		expect(isScreenshotSourcePath('trading', 'ui/coreShared/ts/lib/formattersExtra.ts')).toBe(false)
		expect(isScreenshotSourcePath('trading', 'ui/trading/ts/tests/features/trade.test.tsx')).toBe(false)
		expect(isScreenshotSourcePath('trading', 'ui/trading/js/index.js')).toBe(false)
		expect(isScreenshotSourcePath('trading', 'ui/zoltar/ts/app/App.tsx')).toBe(false)
	})

	test('picks duplicate controls from the start, or from the end with a negative index', () => {
		expect(pickMatch(['page action', 'dialog action'], 0)).toBe('page action')
		expect(pickMatch(['page action', 'dialog action'], -1)).toBe('dialog action')
		expect(pickMatch(['only'], 2)).toBeUndefined()
	})

	test('updates embedding pages and warns instead of failing for a page that does not exist yet', async () => {
		const docsRoot = await mkdtemp(join(tmpdir(), 'docs-screenshots-'))
		try {
			await writeFile(join(docsRoot, 'existing.html'), '<img src="./assets/screenshots/trading/buy-ticket.png" width="1" height="1" alt="Ticket" />')
			const warnings: string[] = []
			await updateEmbeddingPages(docsRoot, { usedBy: ['existing.html', 'missing.html'] }, 'docs/assets/screenshots/trading/buy-ticket.png', { width: 480, height: 1213 }, message => warnings.push(message))
			expect(await readFile(join(docsRoot, 'existing.html'), 'utf8')).toContain('width="480" height="1213"')
			expect(warnings).toEqual([expect.stringContaining('docs/missing.html does not exist yet')])
		} finally {
			await rm(docsRoot, { recursive: true, force: true })
		}
	})
})
