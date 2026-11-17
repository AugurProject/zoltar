import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { countSolidityCommentOnlyLines, countSourceLines, inspectSourceSizes, inspectTestSourceSizes, isProductionSource, isTestSource } from './check-source-size.mts'
import { runGit } from './git.mts'
import { repositoryRoot } from './root.mts'

const source = (lines: number) => `${'line\n'.repeat(lines)}`

function withSourceSizeRepository(verify: (root: string, check: () => ReturnType<typeof runSourceSizeCheck>) => void) {
	const root = mkdtempSync(path.join(tmpdir(), 'source-size-'))
	try {
		const tooling = path.join(root, 'tooling/repo')
		mkdirSync(tooling, { recursive: true })
		for (const file of ['check-source-size.mts', 'git.mts', 'root.mts']) copyFileSync(path.join(repositoryRoot, 'tooling/repo', file), path.join(tooling, file))
		writeFileSync(path.join(tooling, 'source-size-policy.ts'), 'export const productionSourceLineLimit = 600\nexport const sourceSizeAllowances = new Map()\nexport const testSourceLineLimit = 1500\nexport const testSourceSizeAllowances = new Map()\n')
		mkdirSync(path.join(root, 'solidity/contracts'), { recursive: true })
		writeFileSync(path.join(root, 'solidity/contracts/Deleted.sol'), source(700))
		writeFileSync(path.join(root, 'solidity/contracts/Current.sol'), source(10))
		runGit(['init'], { cwd: root })
		runGit(['add', 'solidity/contracts'], { cwd: root })
		rmSync(path.join(root, 'solidity/contracts/Deleted.sol'))
		verify(root, () => runSourceSizeCheck(root))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

function runSourceSizeCheck(root: string) {
	return spawnSync(process.execPath, [path.join(root, 'tooling/repo/check-source-size.mts')], { cwd: root, encoding: 'utf8' })
}

test('CLI checks the worktree when a tracked production source has been deleted', () => {
	withSourceSizeRepository((_root, check) => {
		const result = check()
		expect(result.stderr).toBe('')
		expect(result.status).toBe(0)
		expect(result.stdout).toContain('Production source-size guard passed')
	})
})

test('CLI preserves missing-file diagnostics for allowances on deleted sources', () => {
	withSourceSizeRepository((root, check) => {
		writeFileSync(
			path.join(root, 'tooling/repo/source-size-policy.ts'),
			"export const productionSourceLineLimit = 600\nexport const sourceSizeAllowances = new Map([['solidity/contracts/Deleted.sol', { maxLines: 700, reason: 'Temporary allowance.' }]])\nexport const testSourceLineLimit = 1500\nexport const testSourceSizeAllowances = new Map()\n",
		)
		const result = check()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('solidity/contracts/Deleted.sol: 0 lines; configured limit 700 (missing-file)')
		expect(result.stderr).not.toContain('ENOENT')
	})
})

test('CLI does not silently ignore source read failures other than missing files', () => {
	withSourceSizeRepository((root, check) => {
		mkdirSync(path.join(root, 'solidity/contracts/Deleted.sol'))
		const result = check()
		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain('EISDIR')
		expect(result.stdout).not.toContain('Production source-size guard passed')
	})
})

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

test('recognizes test files and their helpers and excludes production, generated, and fixture files', () => {
	for (const file of ['ui/zoltar/ts/tests/App.test.tsx', 'ui/coreShared/ts/tests/testUtils/queries.ts', 'shared/core/ts/evm/ethereum.test.ts', 'tooling/repo/check-changed.test.ts', 'bots/chaos/tests/runtime/operator.test.ts', 'solidity/ts/tests/eventReplay/eventReplayModel.ts', 'augurScan/tests/unit/live-ui.spec.ts'])
		expect(isTestSource(file)).toBe(true)
	for (const file of ['ui/zoltar/ts/app/App.tsx', 'solidity/ts/testSupport/coverage/traceToSource.ts', 'bots/open-oracle-arbitrager/tests/contracts/harness-artifacts.generated.ts', 'augurScan/tests/fixtures/blocks.ts', 'ui/zoltar/js/tests/App.test.js', 'solidity/contracts/test/Harness.sol', 'README.test.md'])
		expect(isTestSource(file)).toBe(false)
	for (const file of ['ui/zoltar/ts/tests/App.test.tsx', 'shared/core/ts/evm/ethereum.test.ts']) expect(isProductionSource(file)).toBe(false)
})

test('holds test sources to their own wider limit and allowance register', () => {
	const testFile = 'ui/zoltar/ts/tests/protocol/zoltar.test.ts'
	expect(inspectTestSourceSizes(new Map([[testFile, source(1500)]]), new Map())).toEqual([])
	expect(inspectTestSourceSizes(new Map([[testFile, source(1501)]]), new Map())).toEqual([{ file: testFile, kind: 'oversized', limit: 1500, lines: 1501 }])
	const allowances = new Map([[testFile, { maxLines: 1800, reason: 'Split by behavior area.' }]])
	expect(inspectTestSourceSizes(new Map([[testFile, source(1800)]]), allowances)).toEqual([])
	expect(inspectTestSourceSizes(new Map([[testFile, source(1801)]]), allowances)).toEqual([{ file: testFile, kind: 'allowance-exceeded', limit: 1800, lines: 1801 }])
	expect(inspectTestSourceSizes(new Map([[testFile, source(1700)]]), allowances)).toEqual([{ file: testFile, kind: 'stale-allowance', limit: 1800, lines: 1700 }])
})

test('keeps the production and test registers separate', () => {
	const files = new Map([
		['ui/zoltar/ts/new-module.ts', source(700)],
		['ui/zoltar/ts/tests/new-module.test.ts', source(700)],
	])
	expect(inspectSourceSizes(files, new Map()).map(finding => finding.file)).toEqual(['ui/zoltar/ts/new-module.ts'])
	expect(inspectTestSourceSizes(files, new Map())).toEqual([])
	expect(inspectTestSourceSizes(files, new Map([['ui/zoltar/ts/new-module.ts', { maxLines: 1600, reason: 'Production modules are not test sources.' }]]))).toEqual([{ detail: 'allowances may only name test source files', file: 'ui/zoltar/ts/new-module.ts', kind: 'invalid-allowance-path', limit: 1600, lines: 700 }])
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

test('excludes Solidity comment-only lines but keeps code, blank lines, and comment-like string contents', () => {
	const contract = [
		'// SPDX-License-Identifier: UNLICENSE',
		'pragma solidity 0.8.33;',
		'',
		'/// @notice Holds one value.',
		'/**',
		' * @dev Block NatSpec.',
		' */',
		'contract Example {',
		'\t/* inline block */ uint256 public value; // trailing comment',
		'\tstring constant URL = "https://example.com/*not-a-comment";',
		"\tstring constant SLASHES = 'a // b \\' // c';",
		'\t/* opens a block',
		'\t   still inside */',
		'\tfunction set(uint256 newValue) external { value = newValue; } /*',
		'\t   trailing block continues */',
		'}',
	].join('\n')
	expect(countSolidityCommentOnlyLines(contract)).toBe(8)
	expect(countSourceLines(contract, 'solidity/contracts/Example.sol')).toBe(8)
	expect(countSourceLines(`${contract}\n`, 'solidity/contracts/Example.sol')).toBe(8)
	expect(countSourceLines(contract.replaceAll('\n', '\r\n'), 'solidity/contracts/Example.sol')).toBe(8)
	expect(countSourceLines(contract, 'tooling/repo/example.ts')).toBe(16)
	expect(countSourceLines('', 'solidity/contracts/Empty.sol')).toBe(0)
})

test('applies the Solidity comment exclusion to size findings', () => {
	const documentedSource = `${'/// @notice Documentation.\n'.repeat(50)}${'line;\n'.repeat(600)}`
	expect(inspectSourceSizes(new Map([['solidity/contracts/Documented.sol', documentedSource]]), new Map())).toEqual([])
	expect(inspectSourceSizes(new Map([['ui/zoltar/ts/documented.ts', documentedSource]]), new Map())).toEqual([{ file: 'ui/zoltar/ts/documented.ts', kind: 'oversized', limit: 600, lines: 650 }])
})

test('requires ceilings to ratchet down when an oversized module shrinks', () => {
	const findings = inspectSourceSizes(new Map([['shared/core/ts/legacy.ts', source(650)]]), new Map([['shared/core/ts/legacy.ts', { maxLines: 700, reason: 'Extract remaining responsibilities.' }]]))
	expect(findings).toEqual([{ file: 'shared/core/ts/legacy.ts', kind: 'stale-allowance', limit: 700, lines: 650 }])
})
