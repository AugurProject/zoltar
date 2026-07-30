import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const guidePath = path.join(projectRoot, 'docs', 'operator-guide.html')
const guide = await readFile(guidePath, 'utf8')
const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
const diagramSpecs = JSON.parse(await readFile(path.join(projectRoot, 'docs', 'diagram-specs.json'), 'utf8')) as Record<string, unknown>

assert.doesNotMatch(`${guide}\n${readme}`, /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/m)
assert.doesNotMatch(`${guide}\n${readme}`, /\.\.\/docs\//, 'Arbitrager documentation must not depend on the protocol documentation tree')
assert.match(guide, /Uniswap V2, V3, and\s+hookless V4/)
assert.match(guide, /Uniswap V3 remains the\s+reference and TWAP anchor/)
assert.match(readme, /Uniswap V2, V3, or hookless V4/)

for (const chartId of ['fig-open-oracle-arbitrager-lifecycle', 'fig-open-oracle-arbitrager-profit']) {
	assert.ok(diagramSpecs[chartId] !== undefined, `Missing local diagram specification ${chartId}`)
	assert.match(guide, new RegExp(`data-plot-chart="${chartId}"`))
}

for (const relativePath of ['docs/operator-guide.css', 'docs/shared.css', 'docs/chart-runtime.js', 'docs/assets/dashboard-overview.png', 'docs/assets/dashboard-markets.png']) {
	await access(path.join(projectRoot, relativePath))
}
