import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const guidePath = path.join(projectRoot, 'docs', 'operator-guide.html')
const guide = await readFile(guidePath, 'utf8')
const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
const diagramSpecs = JSON.parse(await readFile(path.join(projectRoot, 'docs', 'diagram-specs.json'), 'utf8')) as Record<string, unknown>

const markdownAnchors = (contents: string) =>
	new Set(
		contents
			.split('\n')
			.filter(line => /^#{1,6} /.test(line))
			.map(line =>
				line
					.replace(/^#{1,6} /, '')
					.trim()
					.toLowerCase()
					.replace(/[`']/g, '')
					.replace(/[^a-z0-9 -]/g, '')
					.replace(/\s+/g, '-'),
			),
	)

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
assert.match(guide, /Uniswap V3 remains the\s+reference and TWAP anchor/)
assert.match(readme, /Uniswap V2, V3, or hookless V4/)
assert.match(readme, /### Executor public surface/)
assert.match(readme, /`dispute` is a lower-level, unhedged funding helper/)
assert.match(readme, /Legacy\s+journals without a persisted dispute index are the bounded exception/)
assert.match(readme, /retain log\s+history back to the oldest open legacy position's entry block/)

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
