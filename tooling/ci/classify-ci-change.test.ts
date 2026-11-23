import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ciScopes, classifyCiChange, type CiScope, getCiChangedFiles } from './classify-ci-change.mts'

const scopes = (paths: readonly string[]) => classifyCiChange(paths).expandedScopes

const routingCases: readonly (readonly [readonly string[], readonly CiScope[]])[] = [
	[['shared/README.md'], ['docs']],
	[['docs/how-to/trading-deploy-contracts.html', 'docs/assets/css/docs.css', 'docs/data/notes.md'], ['docs']],
	[['ui/AGENTS.md', 'ui/trading/AGENTS.md'], ['docs']],
	[['solidity/contracts/README.md', 'docs/how-to/trading-deploy-contracts.html'], ['docs']],
	[['bots/chaos/README.md', 'bots/liquidator/README.md', 'bots/open-oracle-arbitrager/docs/notes.md'], ['docs']],
	// Documentation data read only by the documentation checks stays in the documentation scope.
	[['docs/manifest.json'], ['docs']],
	[['docs/assets/screenshots/fingerprints.json'], ['docs']],
	[['docs/data/open-oracle-coordinator.json'], ['docs']],
	[['augurScan/src/ARCHITECTURE.md'], ['docs']],
	// Documentation that code or tests execute or read selects its consumers as well as the documentation checks.
	[
		['docs/runtime/interactiveTools.ts', 'docs/assets/js/interactiveTools.js'],
		['core', 'docs'],
	],
	[['docs/runtime/docsShell.ts'], ['core', 'docs']],
	[['docs/assets/js/responsiveDocs.js'], ['core', 'docs']],
	[['docs/tsconfig.json'], ['core', 'docs']],
	[['docs/charts/diagramControl.ts'], ['core', 'docs']],
	[['docs/reference/invariants.html'], ['core', 'docs']],
	[['docs/explanation/escalation-game.html'], ['core', 'docs']],
	[['docs/documentation.html'], ['core', 'docs']],
	[['docs/how-to/trading-set-up-development.html'], ['core', 'docs']],
	[['README.md'], ['core', 'docs']],
	[['testnetwork/README.md'], ['core', 'docs']],
	[['augurScan/README.md'], ['augur-scan', 'docs']],
	[['bots/open-oracle-arbitrager/README.md'], ['arbitrager', 'docs']],
	[['bots/README.md'], ['arbitrager', 'docs']],
	[
		['bots/open-oracle-arbitrager/RECOVERY.md', 'bots/open-oracle-arbitrager/MARKETS.md'],
		['arbitrager', 'docs'],
	],
	[['.vscode/settings.json', '.vscode/tasks.json'], ['docs']],
	[
		['solidity/contracts/README.md', 'bots/chaos/src/run.ts'],
		['chaos', 'docs'],
	],
	[['.agents/skills/babysit/SKILL.md', '.claude/skills/babysit'], ['docs']],
	[['.claude/skills/babysit/SKILL.md'], ['docs']],
	[
		['.agents/skills/babysit/SKILL.md', 'ui/trading/ts/index.ts'],
		['core', 'docs'],
	],
	[['shared/trading/ts/trading/math.ts'], ['core', 'infrastructure', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan', 'docs']],
	[['ui/trading/ts/index.ts'], ['core']],
	[['bots/open-oracle-arbitrager/src/run.ts'], ['arbitrager']],
	[['bots/liquidator/src/run.ts'], ['liquidator']],
	[['bots/chaos/src/run.ts'], ['chaos']],
	[['bots/shared/src/ethereum.ts'], ['bot-shared', 'chaos', 'arbitrager', 'liquidator']],
	[['augurScan/src/server.ts'], ['augur-scan']],
	[['shared/core/ts/evm/ethereum.ts'], ['core', 'infrastructure', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan', 'docs']],
	[['ui/zoltar/ts/index.ts'], ['core']],
	[['solidity/contracts/Zoltar.sol'], ['core', 'infrastructure', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan', 'docs']],
	[['reth/compose.yaml'], ['infrastructure']],
	[
		['solidity/contracts/trading/TwoWayConstantProductPair.sol', 'bots/liquidator/src/run.ts'],
		['core', 'infrastructure', 'bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan', 'docs'],
	],
]
for (const [paths, expected] of routingCases) test(`routes ${paths.join(', ')}`, () => expect(scopes(paths)).toEqual(expected))

test.each([
	'docs/mainnet-deployment-addresses.json',
	'docs/sepolia-no-deployment-addresses.json',
	'.github/workflows/ci.yml',
	'package.json',
	'knip.ts',
	'tooling/ci/classify-ci-change.mts',
	'future-component/file.ts',
	'.agents/skills/example/scripts/run.ts',
	'.claude/skills/example/scripts/run.sh',
	'.claude/settings.json',
])('uses full CI for %s', path => {
	expect(scopes([path])).toEqual(ciScopes)
	expect(classifyCiChange([path]).forcedFull).toBe(true)
})

test('empty input and explicit full mode use the full matrix', () => {
	expect(classifyCiChange([]).expandedScopes).toEqual(ciScopes)
	expect(classifyCiChange(['README.md'], { full: true }).expandedScopes).toEqual(ciScopes)
})

test('requires PostgreSQL integration for augurScan behavior and safe full runs', () => {
	expect(classifyCiChange(['augurScan/README.md']).augurScanIntegration).toBe(false)
	expect(classifyCiChange(['augurScan/src/ARCHITECTURE.md']).augurScanIntegration).toBe(false)
	expect(classifyCiChange(['shared/README.md']).augurScanIntegration).toBe(false)
	expect(classifyCiChange(['augurScan/src/database.ts']).augurScanIntegration).toBe(true)
	expect(classifyCiChange(['augurScan/migrations/002.sql']).augurScanIntegration).toBe(true)
	expect(classifyCiChange(['augurScan/config/abis.json']).augurScanIntegration).toBe(true)
	expect(classifyCiChange(['augurScan/config/manifests/mainnet.json']).augurScanIntegration).toBe(true)
	expect(classifyCiChange(['shared/core/ts/evm/ethereum.ts']).augurScanIntegration).toBe(true)
	expect(classifyCiChange(['unknown/file']).augurScanIntegration).toBe(true)
	expect(classifyCiChange([], { full: true }).augurScanIntegration).toBe(true)
})

test('runtime documentation selects its package jobs', () => {
	expect(classifyCiChange(['augurScan/README.md']).packageMatrix.map(entry => entry.package)).toEqual(['augur-scan'])
	expect(classifyCiChange(['bots/open-oracle-arbitrager/EXECUTION.md']).packageMatrix.map(entry => entry.package)).toEqual(['arbitrager'])
	expect(classifyCiChange(['docs/runtime/interactiveTools.ts']).packageMatrix).toEqual([])
	expect(classifyCiChange(['docs/runtime/interactiveTools.ts']).forcedFull).toBe(false)
})

test('matrices are valid, deterministic JSON for empty and non-empty selections', () => {
	const docs = classifyCiChange(['docs/how-to/trading-deploy-contracts.html'])
	expect(JSON.parse(docs.packageMatrixJson)).toEqual({ include: [] })
	expect(docs.hasPackages).toBe(false)
	const mixed = classifyCiChange(['bots/liquidator/src/run.ts', 'shared/trading/ts/trading/math.ts', 'bots/shared/src/ethereum.ts'])
	expect(JSON.parse(mixed.packageMatrixJson)).toEqual({ include: [...mixed.packageMatrix] })
	expect(mixed.packageMatrix.map(entry => entry.package)).toEqual(['bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'])
	expect(classifyCiChange(['shared/trading/ts/trading/math.ts', 'bots/shared/src/ethereum.ts', 'bots/liquidator/src/run.ts']).packageMatrixJson).toBe(mixed.packageMatrixJson)
})

test('shared changes select every verified package consumer', () => {
	const shared = classifyCiChange(['shared/core/ts/evm/ethereum.ts'])
	expect(shared.packageMatrix.map(entry => entry.package)).toEqual(['bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'])
	expect(JSON.parse(shared.packageMatrixJson)).toEqual({ include: [...shared.packageMatrix] })
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

test('full-run coverage follows every scope in the registry', () => {
	const full = classifyCiChange(['README.md'], { full: true })
	expect(full.expandedScopes).toEqual(ciScopes)
	expect(full.allScopesSelected).toBe(true)
	expect(classifyCiChange(['README.md']).allScopesSelected).toBe(false)
})

test('publishes the UI-only Solidity route as a shadow decision', () => {
	const ui = classifyCiChange(['ui/openoracle/ts/index.ts'])
	expect(ui.shadowSolidityRoute).toBe('application-only')
	expect(ui.expandedScopes).toContain('core')
	for (const paths of [['ui/trading/ts/index.ts'], ['ui/openoracle/ts/index.ts', 'ui/zoltar/ts/index.ts'], ['ui/openoracle/ts/index.ts', 'solidity/contracts/Zoltar.sol'], ['ui/openoracle/ts/tests/app.test.ts']]) {
		expect(classifyCiChange(paths).shadowSolidityRoute).toBe('full')
	}
})
