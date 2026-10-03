import { operatorHeader } from '../src/dashboard/header.ts'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const guidePath = path.join(projectRoot, 'docs', 'operator-guide.html')
const guide = await readFile(guidePath, 'utf8')
// The dashboard renders these documents as one reference page, so they are validated together.
const referenceDocumentNames = ['README.md', 'EXECUTION.md', 'CONFIGURATION.md', 'MARKETS.md', 'RECOVERY.md']
const referenceDocuments = await Promise.all(referenceDocumentNames.map(async name => ({ contents: await readFile(path.join(projectRoot, name), 'utf8'), name })))
const readme = referenceDocuments.map(document => document.contents).join('\n\n')
const dashboard = (await readFile(path.join(projectRoot, 'src', 'dashboard', 'index.html'), 'utf8')).replace('<!-- operator-header -->', operatorHeader)
const diagramSpecs = JSON.parse(await readFile(path.join(projectRoot, 'docs', 'diagram-specs.json'), 'utf8')) as Record<string, unknown>

const markdownAnchorList = (contents: string) => {
	let fenced = false
	return contents
		.split('\n')
		.filter(line => {
			if (line.trimStart().startsWith('```')) fenced = !fenced
			return !fenced && /^#{1,6} /.test(line)
		})
		.map(line =>
			line
				.replace(/^#{1,6} /, '')
				.trim()
				.toLowerCase()
				.replace(/[`']/g, '')
				.replace(/[^a-z0-9 -]/g, '')
				.replace(/\s+/g, '-'),
		)
}

const markdownAnchors = (contents: string) => new Set(markdownAnchorList(contents))

/** Relative Markdown links between the reference documents, and to the shared bot guide, must name an existing heading. */
const assertReferenceLinksResolve = async (documentName: string, contents: string) => {
	for (const match of contents.matchAll(/\]\(([^)\s]+)\)/g)) {
		const href = match[1]
		assert.ok(href !== undefined)
		if (/^[a-z]+:/i.test(href)) continue
		const [relativePath = '', fragment] = href.split('#', 2)
		const targetPath = relativePath === '' ? path.join(projectRoot, documentName) : path.resolve(projectRoot, relativePath)
		await access(targetPath)
		if (fragment === undefined || fragment === '' || path.extname(targetPath).toLowerCase() !== '.md') continue
		assert.ok(markdownAnchors(await readFile(targetPath, 'utf8')).has(fragment), `Missing Markdown fragment ${href} from ${documentName}`)
	}
}

const assertLocalLinksResolve = async (documentPath: string, contents: string) => {
	for (const match of contents.matchAll(/href="([^"]+)"/g)) {
		const href = match[1]
		assert.ok(href !== undefined)
		if (href.startsWith('/') || /^[a-z]+:/i.test(href)) continue

		const [relativePath = '', fragment] = href.split('#', 2)
		const targetPath = relativePath === '' ? documentPath : path.resolve(path.dirname(documentPath), relativePath)
		await access(targetPath)
		if (fragment === undefined || fragment === '') continue

		const target = targetPath === documentPath ? contents : await readFile(targetPath, 'utf8')
		if (path.extname(targetPath).toLowerCase() === '.md') {
			assert.ok(markdownAnchors(target).has(fragment), `Missing Markdown fragment ${href} from ${documentPath}`)
		} else {
			assert.match(target, new RegExp(`\\bid="${fragment.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`), `Missing HTML fragment ${href} from ${documentPath}`)
		}
	}
}

assert.doesNotMatch(`${guide}\n${readme}`, /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/m)
assert.doesNotMatch(`${guide}\n${readme}`, /\.\.\/docs\//, 'Arbitrager documentation must not depend on the protocol documentation tree')
assert.match(guide, /Uniswap V2, V3, and\s+hookless V4/)
assert.match(readme, /Uniswap V2, V3, or hookless V4/)
assert.match(readme, /### Executor public surface/)
assert.match(readme, /`dispute` is a lower-level, unhedged funding helper/)
assert.match(readme, /legacy\s+journal without durable dispute evidence is marked for manual reconciliation/)
assert.match(readme, /`runtime\.logLookbackBlocks` to `0` to disable event discovery, or from `1` through\s+`256`/)

const dashboardRoutes = new Set(['/overview', '/operations', '/games', '/markets', '/settings'])
for (const match of readme.matchAll(/\]\((http:\/\/127\.0\.0\.1:4173\/[^)]*)\)/g)) {
	const target = new URL(match[1] ?? '')
	assert.ok(dashboardRoutes.has(target.pathname), `README links to unknown dashboard route ${target.pathname}`)
	if (target.hash !== '') assert.match(dashboard, new RegExp(`\\bid="${target.hash.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `README dashboard link has missing target ${target.href}`)
}

const referenceAnchors = referenceDocuments.flatMap(document => markdownAnchorList(document.contents))
assert.equal(new Set(referenceAnchors).size, referenceAnchors.length, 'Reference documents must not repeat a heading because they render as one page')
for (const document of referenceDocuments) await assertReferenceLinksResolve(document.name, document.contents)
for (const match of guide.matchAll(/href="\/documentation\/reference#([^"]+)"/g)) {
	assert.ok(match[1] !== undefined && referenceAnchors.includes(match[1]), `Operator guide links to missing reference heading ${match[1] ?? ''}`)
}

await assertLocalLinksResolve(guidePath, guide)
const fixturePath = path.join(projectRoot, 'docs', 'market-fixture.html')
await assertLocalLinksResolve(fixturePath, await readFile(fixturePath, 'utf8'))

for (const chartId of ['fig-open-oracle-arbitrager-lifecycle', 'fig-open-oracle-arbitrager-profit']) {
	assert.ok(diagramSpecs[chartId] !== undefined, `Missing local diagram specification ${chartId}`)
	assert.match(guide, new RegExp(`data-plot-chart="${chartId}"`))
}

for (const relativePath of ['docs/operator-guide.css', 'docs/shared.css', 'docs/chart-runtime.js', 'docs/assets/dashboard-overview.png', 'docs/assets/dashboard-markets.png']) {
	await access(path.join(projectRoot, relativePath))
}
