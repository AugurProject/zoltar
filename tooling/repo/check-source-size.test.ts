import { expect, test } from 'bun:test'
import { inspectSourceSizes, isProductionSource } from './check-source-size.mts'

const source = (lines: number) => `${'line\n'.repeat(lines)}`

test('recognizes production sources and excludes generated, vendored, fixture, and test files', () => {
	expect(isProductionSource('ui/zoltar/ts/app/App.tsx')).toBe(true)
	expect(isProductionSource('augurScan/public/runtime.js')).toBe(true)
	expect(isProductionSource('solidity/contracts/Zoltar.sol')).toBe(true)
	for (const file of [
		'augurScan/browser/app.ts',
		'augurScan/scripts/build-browser.ts',
		'bots/chaos/scripts/capture-dashboard-qa.mts',
		'bots/open-oracle-arbitrager/contracts/OpenOracleArbitrageExecutor.sol',
		'solidity/ts/coverage/traceToSource.ts',
		'ui/trading/build/core-deployments.mts',
		'ui/trading/scripts/browser-qa.mts',
		'tooling/ui/dev-server.ts',
		'docs/charts/chartRuntime.ts',
		'docs/runtime/docsShell.ts',
	])
		expect(isProductionSource(file)).toBe(true)
	for (const file of ['ui/zoltar/js/App.js', 'ui/zoltar/ts/tests/App.test.tsx', 'bots/chaos/src/contracts/abi.generated.ts', 'solidity/contracts/statoblast/openOracle/OpenOracle.sol']) expect(isProductionSource(file)).toBe(false)
})

test('rejects new oversized files with useful limits', () => {
	expect(inspectSourceSizes(new Map([['ui/zoltar/ts/new-module.ts', source(601)]]), new Map())).toEqual([{ file: 'ui/zoltar/ts/new-module.ts', kind: 'oversized', limit: 600, lines: 601 }])
})

test('guards allowlisted files against growth and requires stale entries to be removed', () => {
	const allowances = new Map([['shared/core/ts/legacy.ts', { maxLines: 700, reason: 'Existing cohesive implementation.' }]])
	expect(inspectSourceSizes(new Map([['shared/core/ts/legacy.ts', source(701)]]), allowances)).toEqual([{ file: 'shared/core/ts/legacy.ts', kind: 'allowance-exceeded', limit: 700, lines: 701 }])
	expect(inspectSourceSizes(new Map([['shared/core/ts/legacy.ts', source(500)]]), allowances)).toEqual([{ file: 'shared/core/ts/legacy.ts', kind: 'stale-allowance', limit: 600, lines: 500 }])
})

test('requires valid production paths, ceilings, and nonblank reasons for allowances', () => {
	const files = new Map([
		['shared/core/ts/legacy.ts', source(650)],
		['shared/core/ts/tests/helper.ts', source(650)],
	])
	const findings = inspectSourceSizes(
		files,
		new Map([
			['shared/core/ts/legacy.ts', { maxLines: 600, reason: '   ' }],
			['shared/core/ts/tests/helper.ts', { maxLines: 700, reason: 'Tests are not production modules.' }],
		]),
	)
	expect(findings.map(finding => [finding.file, finding.kind])).toEqual([
		['shared/core/ts/legacy.ts', 'invalid-allowance-limit'],
		['shared/core/ts/legacy.ts', 'invalid-allowance-reason'],
		['shared/core/ts/legacy.ts', 'oversized'],
		['shared/core/ts/tests/helper.ts', 'invalid-allowance-path'],
	])
	expect(findings.every(finding => finding.detail === undefined || finding.detail.trim() !== '')).toBe(true)
})
