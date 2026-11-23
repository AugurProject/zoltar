import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createBalancedTestShards } from '../../tooling/testing/test-discovery.mts'
import { getChromiumPath } from '../../tooling/ui/chromiumPath'
import { getXmlAttribute, scanXmlTags, validateJunitDocument } from '../../tooling/testing/test-timings.mts'

const chromium = getChromiumPath()
if (chromium === undefined) throw new Error('Chromium is required for augurScan browser tests')
const started = performance.now()
const artifacts = resolve('coverage/chromium')
await mkdir(artifacts, { recursive: true })
const log = Bun.file(resolve(artifacts, 'fixture.log'))
for (const command of ['metadata:build', 'build:demo']) {
	const build = Bun.spawn(['bun', 'run', command], { stdout: 'inherit', stderr: 'inherit' })
	if ((await build.exited) !== 0) throw new Error(`Could not prepare the browser fixture: ${command}`)
}
const config = resolve(artifacts, 'prebuilt.toml')
await Bun.write(config, '[install]\nauto = "disable"\n')
// Whole-file workers avoid cross-test browser state and leave each artifact writer with its own directory.
const measuredSeconds = new Map([
	['navigation.test.ts', 27],
	['presentation.test.ts', 24],
	['integrity-live.test.ts', 19],
	['capital-positions.test.ts', 8],
	['auction-collateral.test.ts', 8],
	['ui-behaviour.test.ts', 6],
	['explorer-live.test.ts', 5],
])
const files = [...new Bun.Glob('tests/browser/*.test.ts').scanSync()].sort()
const weights = files.map(filePath => ({ filePath, weight: measuredSeconds.get(filePath.split('/').at(-1) ?? '') ?? 1 })).sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
const shards = createBalancedTestShards(weights, 2)

async function readTestCases(report: string) {
	const junit = await Bun.file(report).text()
	validateJunitDocument(junit)
	const tags = scanXmlTags(junit)
	return {
		cases: tags
			.filter(tag => /^<testcase\b/.test(tag))
			.map(tag => ({
				file: getXmlAttribute(tag, 'file'),
				id: JSON.stringify(['file', 'classname', 'name'].map(attribute => getXmlAttribute(tag, attribute))),
			})),
		skipped: tags.filter(tag => /^<skipped\b/.test(tag)).length,
	}
}

// The fast run registers browser cases as skipped and establishes their exact identities.
const registeredReport = resolve(artifacts, 'registered.xml')
const registration = Bun.spawn(['bun', `--config=${config}`, 'test', '--reporter=junit', `--reporter-outfile=${registeredReport}`, ...files.map(file => `./${file}`)], { env: { ...process.env, AUGURSCAN_BROWSER_URL: undefined }, stdout: 'inherit', stderr: 'inherit' })
if ((await registration.exited) !== 0) throw new Error('Could not establish the augurScan browser case manifest')
const registered = await readTestCases(registeredReport)
if (registered.skipped === 0 || new Set(registered.cases.map(testCase => testCase.file)).size !== files.length) throw new Error('Incomplete augurScan browser case manifest')

const server = Bun.spawn(['bun', 'scripts/serve-demo.ts'], { env: { ...process.env, PORT: '0' }, stdout: 'pipe', stderr: log })
try {
	const reader = server.stdout.getReader()
	const first = await Promise.race([
		reader.read(),
		Bun.sleep(10_000).then(() => {
			throw new Error('Demo fixture readiness timed out')
		}),
	])
	const line = new TextDecoder().decode(first.value)
	const port = /http:\/\/localhost:(\d+)/.exec(line)?.[1]
	if (port === undefined) throw new Error(`Demo fixture did not publish a listening port: ${line}`)
	const url = `http://127.0.0.1:${port}`
	const health = await fetch(`${url}/health/live`, { signal: AbortSignal.timeout(5000) })
	if (!health.ok) throw new Error(`Demo fixture health check failed with HTTP ${health.status}`)
	console.log(`Prepared augurScan fixture and ${registered.cases.length} registered cases in ${((performance.now() - started) / 1000).toFixed(2)}s`)
	const results = await Promise.allSettled(
		shards.map(async shard => {
			const output = resolve(artifacts, String(shard.index + 1))
			await mkdir(output, { recursive: true })
			const report = resolve(output, 'junit.xml')
			const cases = Bun.spawn(['bun', `--config=${config}`, 'test', '--timeout=60000', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${output}`, '--reporter=junit', `--reporter-outfile=${report}`, ...shard.files.map(file => `./${file}`)], {
				env: { ...process.env, CHROMIUM_PATH: chromium, AUGURSCAN_BROWSER_URL: url },
				stdout: 'inherit',
				stderr: 'inherit',
			})
			if ((await cases.exited) !== 0) throw new Error(`augurScan browser shard ${shard.index + 1} failed`)
			const actual = await readTestCases(report)
			const expected = registered.cases
				.filter(testCase => testCase.file !== undefined && shard.files.includes(testCase.file))
				.map(testCase => testCase.id)
				.sort()
			if (actual.skipped !== 0 || JSON.stringify(actual.cases.map(testCase => testCase.id).sort()) !== JSON.stringify(expected)) {
				throw new Error(`augurScan Chromium shard ${shard.index + 1} did not execute its ${expected.length} registered cases`)
			}
		}),
	)
	for (const result of results) if (result.status === 'rejected') throw result.reason
} finally {
	server.kill()
	await server.exited
}
