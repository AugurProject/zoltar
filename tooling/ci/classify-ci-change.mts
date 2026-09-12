import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import * as process from 'node:process'
import { affectedProjects, ciScopes as registeredCiScopes, componentProjects, projectForPath, projects, taskInputMatches } from '../repo/projects.ts'

export const ciScopes = registeredCiScopes()
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

const packageEntries = new Map<CiScope, PackageMatrixEntry>(
	componentProjects().map(project => {
		const ci = project.ci
		if (ci?.componentName === undefined) throw new Error(`Component ${project.id} has no CI name`)
		return [ci.scope as CiScope, { package: ci.componentName, directory: project.path, artifacts: ci.requiresContractArtifacts === true }]
	}),
)
const instructionFiles = new Set(['LICENSE', '.vscode/settings.json', '.vscode/tasks.json'])
const rootGlobalFiles = new Set(['.coverage-policy.json', '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.npmrc', '.prettierignore', '.prettierrc.json', 'biome.json', 'bun.lock', 'bunfig.toml', 'knip.json', 'package.json', 'tsconfig.json', 'tsconfig.scripts.json'])
const ordered = (scopes: ReadonlySet<CiScope>): CiScope[] => ciScopes.filter(scope => scopes.has(scope))

function directScopeForPath(filePath: string): CiScope | 'full' {
	if (/^\.(?:agents|claude)\/skills\/[a-z0-9-]+$/.test(filePath)) return 'docs'
	if (filePath.endsWith('.md') || instructionFiles.has(filePath) || filePath.startsWith('docs/') || filePath.startsWith('.codex/') || filePath.startsWith('.ci-agents/')) return 'docs'
	if (filePath.startsWith('.github/') || filePath.startsWith('scripts/') || filePath.startsWith('tooling/') || rootGlobalFiles.has(filePath)) return 'full'
	return projectForPath(filePath)?.ci?.scope ?? 'full'
}

function expandScopes(direct: ReadonlySet<CiScope>, filePaths: readonly string[], full: boolean): Set<CiScope> {
	if (full) return new Set(ciScopes)
	const result = new Set(direct)
	for (const project of affectedProjects(filePaths, projects)) {
		const scope = project.ci?.scope
		if (scope !== undefined && ciScopes.includes(scope as CiScope)) result.add(scope as CiScope)
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
	// Prose inside a project must not select that project's runtime consumers.
	const runtimeFiles = changedFiles.filter(filePath => directScopeForPath(filePath) !== 'docs')
	const expanded = expandScopes(direct, runtimeFiles, forcedFull)
	const directScopes = ordered(direct)
	const expandedScopes = ordered(expanded)
	const packageMatrix = expandedScopes.flatMap(scope => packageEntries.get(scope) ?? [])
	const packageMatrixJson = JSON.stringify({ include: packageMatrix })
	const augurScan = projects.find(project => project.id === 'augur-scan')
	if (augurScan === undefined) throw new Error('The project registry must contain augur-scan')
	const augurScanIntegration = forcedFull || runtimeFiles.some(filePath => taskInputMatches('integration', filePath, augurScan))
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

export function runClassifyCiChangeCommand(args: readonly string[] = process.argv.slice(2)): void {
	const githubOutput = args.includes('--github-output'),
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

if (import.meta.main) runClassifyCiChangeCommand()
