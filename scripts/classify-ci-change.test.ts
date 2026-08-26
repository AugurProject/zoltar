import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ciScopes, classifyCiChange, type CiScope, getCiChangedFiles } from './classify-ci-change.mts'

const scopes = (paths: readonly string[]) => classifyCiChange(paths).expandedScopes

const routingCases: readonly (readonly [readonly string[], readonly CiScope[]])[] = [
	[['README.md'], ['docs']],
	[['shared/ts/trading/math.ts'], ['core', 'trading', 'bot-shared', 'arbitrager', 'liquidator', 'chaos', 'augur-scan']],
	[['ui/trading/ts/index.ts'], ['core']],
	[['bots/open-oracle-arbitrager/src/run.ts'], ['arbitrager']],
	[['bots/liquidator/src/run.ts'], ['liquidator']],
	[['bots/chaos/src/cli/run.ts'], ['chaos']],
	[['bots/shared/src/ethereum.ts'], ['bot-shared', 'arbitrager', 'liquidator', 'chaos']],
	[['augurScan/src/server.ts'], ['augur-scan']],
	[['shared/ts/ethereum.ts'], ['core', 'trading', 'bot-shared', 'arbitrager', 'liquidator', 'chaos', 'augur-scan']],
	[['ui/zoltar/ts/index.ts'], ['core']],
	[['solidity/contracts/Zoltar.sol'], ['core', 'trading', 'arbitrager', 'liquidator', 'chaos', 'infrastructure']],
	[['reth/compose.yaml'], ['infrastructure']],
	[
		['solidity/contracts/trading/TwoWayConstantProductPair.sol', 'bots/liquidator/src/run.ts'],
		['core', 'trading', 'arbitrager', 'liquidator', 'chaos', 'infrastructure'],
	],
]
for (const [paths, expected] of routingCases) test(`routes ${paths.join(', ')}`, () => expect(scopes(paths)).toEqual(expected))

test.each(['.github/workflows/ci.yml', 'package.json', 'scripts/classify-ci-change.mts', 'future-component/file.ts'])('uses full CI for %s', path => {
	expect(scopes([path])).toEqual(ciScopes)
	expect(classifyCiChange([path]).forcedFull).toBe(true)
})

test('empty input and explicit full mode use the full matrix', () => {
	expect(classifyCiChange([]).expandedScopes).toEqual(ciScopes)
	expect(classifyCiChange(['README.md'], { full: true }).expandedScopes).toEqual(ciScopes)
})

test('keeps the unreliable augurScan integration route disabled', () => {
	expect(classifyCiChange(['augurScan/README.md']).augurScanIntegration).toBe(false)
	expect(classifyCiChange(['augurScan/src/database.ts']).augurScanIntegration).toBe(false)
	expect(classifyCiChange(['unknown/file']).augurScanIntegration).toBe(false)
	expect(classifyCiChange([], { full: true }).augurScanIntegration).toBe(false)
})

test('matrices are valid, deterministic JSON for empty and non-empty selections', () => {
	const docs = classifyCiChange(['README.md'])
	expect(JSON.parse(docs.packageMatrixJson)).toEqual({ include: [] })
	expect(docs.hasPackages).toBe(false)
	const mixed = classifyCiChange(['bots/liquidator/src/run.ts', 'shared/ts/trading/math.ts', 'bots/shared/src/ethereum.ts'])
	expect(JSON.parse(mixed.packageMatrixJson)).toEqual({ include: [...mixed.packageMatrix] })
	expect(mixed.packageMatrix.map(entry => entry.package)).toEqual(['bot-shared', 'arbitrager', 'liquidator', 'chaos', 'augur-scan'])
	expect(classifyCiChange(['shared/ts/trading/math.ts', 'bots/shared/src/ethereum.ts', 'bots/liquidator/src/run.ts']).packageMatrixJson).toBe(mixed.packageMatrixJson)
})

test('shared changes select every verified package consumer', () => {
	const shared = classifyCiChange(['shared/ts/ethereum.ts'])
	expect(shared.packageMatrix.map(entry => entry.package)).toEqual(['bot-shared', 'arbitrager', 'liquidator', 'chaos', 'augur-scan'])
	expect(JSON.parse(shared.packageMatrixJson)).toEqual({ include: [...shared.packageMatrix] })
})

test('chaos changes select the artifact-backed package job', () => {
	const chaos = classifyCiChange(['bots/chaos/src/runtime/operator.ts'])
	expect(chaos.forcedFull).toBe(false)
	expect(chaos.packageMatrix).toEqual([{ artifacts: true, directory: 'bots/chaos', package: 'chaos' }])
	expect(chaos.artifactInputs).toBe(true)
})

test('Git path collection keeps deleted executables and both sides of renames', () => {
	const repository = mkdtempSync(join(tmpdir(), 'zoltar-ci-change-'))
	const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
	try {
		git(['init'])
		git(['config', 'user.email', 'ci@example.com'])
		git(['config', 'user.name', 'CI Test'])
		mkdirSync(join(repository, 'docs'))
		mkdirSync(join(repository, 'scripts'))
		writeFileSync(join(repository, 'docs', 'guide.md'), 'before\n')
		writeFileSync(join(repository, 'scripts', 'deleted.mts'), 'export const deleted = true\n')
		writeFileSync(join(repository, 'scripts', 'renamed.mts'), 'export const renamed = true\n')
		git(['add', '.'])
		git(['commit', '-m', 'baseline'])
		const baseRef = git(['rev-parse', 'HEAD'])
		rmSync(join(repository, 'scripts', 'deleted.mts'))
		renameSync(join(repository, 'scripts', 'renamed.mts'), join(repository, 'docs', 'renamed.md'))
		git(['add', '-A'])
		git(['commit', '-m', 'delete and rename'])
		expect(getCiChangedFiles(baseRef, repository)).toEqual(['docs/renamed.md', 'scripts/deleted.mts', 'scripts/renamed.mts'])
		expect(classifyCiChange(getCiChangedFiles(baseRef, repository)).forcedFull).toBe(true)
	} finally {
		rmSync(repository, { force: true, recursive: true })
	}
})
