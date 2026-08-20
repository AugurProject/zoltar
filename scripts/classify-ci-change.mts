import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import * as process from 'node:process'

export const ciScopes = ['docs', 'core', 'trading', 'bot-shared', 'arbitrager', 'liquidator', 'augur-scan', 'infrastructure'] as const
export type CiScope = (typeof ciScopes)[number]
type PackageMatrixEntry = { readonly package: string; readonly directory: string; readonly artifacts: boolean }
export type CiChangeClassification = {
	readonly changedFiles: readonly string[]
	readonly directScopes: readonly CiScope[]
	readonly expandedScopes: readonly CiScope[]
	readonly packageMatrix: readonly PackageMatrixEntry[]
	readonly packageMatrixJson: string
	readonly hasPackages: boolean
	readonly forcedFull: boolean
	readonly augurScanIntegration: boolean
	readonly artifactInputs: boolean
	readonly reason: string
}

const packageEntries: Readonly<Record<CiScope, PackageMatrixEntry | undefined>> = {
	docs: undefined,
	core: undefined,
	trading: { package: 'trading', directory: 'trading', artifacts: true },
	'bot-shared': { package: 'bot-shared', directory: 'bots/shared', artifacts: false },
	arbitrager: { package: 'arbitrager', directory: 'bots/open-oracle-arbitrager', artifacts: true },
	liquidator: { package: 'liquidator', directory: 'bots/liquidator', artifacts: true },
	'augur-scan': { package: 'augur-scan', directory: 'augurScan', artifacts: false },
	infrastructure: undefined,
}
const dependencies: Readonly<Record<CiScope, readonly CiScope[]>> = { docs: [], core: [], trading: [], 'bot-shared': ['arbitrager', 'liquidator'], arbitrager: [], liquidator: [], 'augur-scan': [], infrastructure: [] }
const rootDocumentation = new Set(['AGENTS.md', 'LICENSE', 'README.md'])
const rootInfrastructure = new Set(['reth', 'testnetwork'])
const rootGlobalFiles = new Set(['.coverage-policy.json', '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.npmrc', '.prettierignore', '.prettierrc.json', 'biome.json', 'bun.lock', 'bunfig.toml', 'knip.json', 'package.json', 'tsconfig.json', 'tsconfig.scripts.json'])
const ordered = (scopes: ReadonlySet<CiScope>): CiScope[] => ciScopes.filter(scope => scopes.has(scope))

function directScopeForPath(filePath: string): CiScope | 'full' {
	if (rootDocumentation.has(filePath) || filePath.startsWith('docs/') || filePath.startsWith('.codex/') || filePath.startsWith('.ci-agents/')) return 'docs'
	if (filePath.startsWith('trading/')) return 'trading'
	if (filePath.startsWith('bots/shared/')) return 'bot-shared'
	if (filePath.startsWith('bots/open-oracle-arbitrager/')) return 'arbitrager'
	if (filePath.startsWith('bots/liquidator/')) return 'liquidator'
	if (filePath.startsWith('augurScan/')) return 'augur-scan'
	if (filePath.startsWith('shared/') || filePath.startsWith('ui/')) return 'core'
	if (filePath.startsWith('solidity/')) return 'infrastructure'
	if (filePath.startsWith('.github/') || filePath.startsWith('scripts/') || rootGlobalFiles.has(filePath)) return 'full'
	if ([...rootInfrastructure].some(path => filePath === path || filePath.startsWith(`${path}/`))) return 'infrastructure'
	return 'full'
}

function expandScopes(direct: ReadonlySet<CiScope>, filePaths: readonly string[], full: boolean): Set<CiScope> {
	if (full) return new Set(ciScopes)
	const result = new Set(direct)
	if (filePaths.some(filePath => filePath.startsWith('shared/'))) for (const scope of ['trading', 'bot-shared', 'arbitrager', 'liquidator', 'augur-scan'] as const) result.add(scope)
	if (filePaths.some(filePath => filePath.startsWith('solidity/'))) for (const scope of ['core', 'trading', 'arbitrager', 'liquidator'] as const) result.add(scope)
	const queue = [...result]
	for (const scope of queue)
		for (const dependent of dependencies[scope])
			if (!result.has(dependent)) {
				result.add(dependent)
				queue.push(dependent)
			}
	return result
}
export function getCiChangedFiles(baseRef: string, cwd: string = process.cwd()): string[] {
	const fields = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', '--diff-filter=ACMRTUXBD', `${baseRef}...HEAD`], { cwd, encoding: 'utf8' }).split('\0')
	const paths: string[] = []
	for (let index = 0; index < fields.length; ) {
		const status = fields[index++]
		if (status === undefined || status === '') break
		const firstPath = fields[index++]
		if (firstPath === undefined || firstPath === '') throw new Error(`Git returned an incomplete ${status} change record`)
		paths.push(firstPath)
		if (status.startsWith('R') || status.startsWith('C')) {
			const secondPath = fields[index++]
			if (secondPath === undefined || secondPath === '') throw new Error(`Git returned an incomplete ${status} change record`)
			paths.push(secondPath)
		}
	}
	return [...new Set(paths)].sort()
}

export function classifyCiChange(filePaths: readonly string[], options: { readonly full?: boolean; readonly fallbackReason?: string } = {}): CiChangeClassification {
	const changedFiles = [...new Set(filePaths)].sort()
	const direct = new Set<CiScope>()
	let forcedFull = options.full === true || changedFiles.length === 0 || options.fallbackReason !== undefined
	for (const filePath of changedFiles) {
		const scope = directScopeForPath(filePath)
		if (scope === 'full') forcedFull = true
		else direct.add(scope)
	}
	const expanded = expandScopes(direct, changedFiles, forcedFull)
	const directScopes = ordered(direct)
	const expandedScopes = ordered(expanded)
	const packageMatrix = expandedScopes.flatMap(scope => packageEntries[scope] ?? [])
	const packageMatrixJson = JSON.stringify({ include: packageMatrix })
	const augurScanIntegration = false
	let reason = 'Selected direct scopes and expanded their verified local consumers.'
	if (forcedFull) reason = 'A global or unknown path requires the full ordinary CI matrix.'
	if (changedFiles.length === 0) reason = 'No changed paths were detected; using the safe full-run fallback.'
	if (options.full === true) reason = 'A full run was explicitly requested.'
	if (options.fallbackReason !== undefined) reason = options.fallbackReason
	return { changedFiles, directScopes, expandedScopes, packageMatrix, packageMatrixJson, hasPackages: packageMatrix.length > 0, forcedFull, augurScanIntegration, artifactInputs: packageMatrix.some(entry => entry.artifacts), reason }
}

function writeGitHubOutput(classification: CiChangeClassification): void {
	const outputPath = process.env['GITHUB_OUTPUT']
	if (outputPath === undefined) throw new Error('GITHUB_OUTPUT is required with --github-output')
	for (const scope of ciScopes) appendFileSync(outputPath, `${scope.replaceAll('-', '_')}=${classification.expandedScopes.includes(scope)}\n`)
	appendFileSync(outputPath, `package_matrix=${classification.packageMatrixJson}\nhas_packages=${classification.hasPackages}\nforced_full=${classification.forcedFull}\naugur_scan_integration=${classification.augurScanIntegration}\nartifact_inputs=${classification.artifactInputs}\n`)
	const summaryPath = process.env['GITHUB_STEP_SUMMARY']
	if (summaryPath === undefined) return
	appendFileSync(
		summaryPath,
		`### CI change classification\n\n${classification.reason}\n\n**Changed files:** ${classification.changedFiles.length === 0 ? '_unavailable_' : classification.changedFiles.map(path => `\`${path}\``).join(', ')}\n\n**Direct scopes:** ${classification.directScopes.join(', ') || '_none_'}\n\n**Dependency-expanded scopes:** ${classification.expandedScopes.join(', ')}\n\n**Selected package jobs:** ${classification.packageMatrix.map(entry => entry.package).join(', ') || '_none_'}\n\n**augurScan PostgreSQL integration:** ${classification.augurScanIntegration ? 'selected' : 'not selected'}\n`,
	)
}

if (import.meta.main) {
	const args = process.argv.slice(2),
		githubOutput = args.includes('--github-output'),
		full = args.includes('--full'),
		baseIndex = args.indexOf('--base-ref')
	const explicitFiles: string[] = []
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (argument === '--github-output' || argument === '--full') continue
		if (argument === '--base-ref') {
			index++
			continue
		}
		if (argument !== undefined) explicitFiles.push(argument)
	}
	let files = explicitFiles,
		fallbackReason: string | undefined
	if (baseIndex >= 0) {
		const baseRef = args[baseIndex + 1]
		if (baseRef === undefined) fallbackReason = '--base-ref was provided without a Git ref; using the safe full-run fallback.'
		else
			try {
				files = getCiChangedFiles(baseRef)
			} catch (error) {
				fallbackReason = `Git change detection failed; using the safe full-run fallback: ${error instanceof Error ? error.message : String(error)}`
				files = []
			}
	}
	const classification = classifyCiChange(files, { full, ...(fallbackReason === undefined ? {} : { fallbackReason }) })
	if (githubOutput) writeGitHubOutput(classification)
	console.log(JSON.stringify(classification))
}
