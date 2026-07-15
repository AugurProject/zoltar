import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.join(scriptDirectory, '..')

type GitResult = {
	status: number | null
	stdout: string
	stderr: string
	error?: Error
}

export type GitRunner = (args: readonly string[]) => GitResult

export type GeneratedArtifactCheckOptions = {
	repositoryRoot?: string
	runGit?: GitRunner
}

const explicitlyRequiredGeneratedOutputs = ['shared/js/.freshness-hash', 'solidity/artifacts/Contracts.json', 'solidity/artifacts/.freshness-hash', 'solidity/.contract-hash.json', 'solidity/ts/types/contractArtifact.ts', 'ui/ts/abis.ts', 'ui/ts/contractArtifact.ts']

const generatedReviewPaths = ['shared/js', 'solidity/artifacts', 'solidity/.contract-hash.json', 'solidity/ts/types/contractArtifact.ts', 'ui/js', 'ui/ts/abis.ts', 'ui/ts/contractArtifact.ts', 'ui/ts/deploymentArtifacts.ts', 'ui/ts/deploymentsArtifacts.ts', 'ui/vendor']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function assertExists(repositoryRoot: string, relativePath: string) {
	try {
		await fs.stat(path.join(repositoryRoot, relativePath))
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw new Error(`Generated artifact is missing after generation: ${relativePath}`)
		}
		throw error
	}
}

async function readJsonObject(repositoryRoot: string, relativePath: string) {
	const parsed = JSON.parse(await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8'))
	if (!isRecord(parsed)) throw new Error(`${relativePath} must contain a JSON object`)
	return parsed
}

async function assertContractsJsonReadable(repositoryRoot: string) {
	const contractsJsonPath = path.join(repositoryRoot, 'solidity/artifacts/Contracts.json')
	try {
		JSON.parse(await fs.readFile(contractsJsonPath, 'utf8'))
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error('Generated solidity/artifacts/Contracts.json is not valid JSON')
		throw error
	}
}

function normalizeRepositoryRelativePath(baseDirectory: string, relativePath: string) {
	if (!relativePath.startsWith('./') && !relativePath.startsWith('../')) {
		throw new Error(`Expected a local generated path, received: ${relativePath}`)
	}
	return path.posix.normalize(path.posix.join(baseDirectory, relativePath))
}

export async function getSharedPackageGeneratedOutputs(repositoryRoot: string) {
	const packageJson = await readJsonObject(repositoryRoot, 'shared/package.json')
	const exportsValue = packageJson['exports']
	if (!isRecord(exportsValue)) throw new Error('shared/package.json exports must be an object')

	const outputs: string[] = []
	for (const [exportName, exportValue] of Object.entries(exportsValue)) {
		if (!isRecord(exportValue)) throw new Error(`shared/package.json export ${exportName} must be an object`)
		const defaultPath = exportValue['default']
		if (typeof defaultPath !== 'string') throw new Error(`shared/package.json export ${exportName} must define a default path`)
		const generatedJavaScriptPath = normalizeRepositoryRelativePath('shared', defaultPath)
		outputs.push(generatedJavaScriptPath)
		if (generatedJavaScriptPath.endsWith('.js')) {
			outputs.push(generatedJavaScriptPath.replace(/\.js$/, '.d.ts'))
		}
	}
	return outputs
}

async function getUiImportMapGeneratedOutputs(repositoryRoot: string) {
	const indexHtml = await fs.readFile(path.join(repositoryRoot, 'ui/index.html'), 'utf8')
	const importMapMatch = indexHtml.match(/<script\b[^>]*\btype\s*=\s*['"]importmap['"][^>]*>([\s\S]*?)<\/script>/i)
	if (importMapMatch === null) throw new Error('ui/index.html is missing an import map')

	const importMapText = importMapMatch[1]
	if (importMapText === undefined) throw new Error('ui/index.html import map is empty')
	const importMap = JSON.parse(importMapText)
	if (!isRecord(importMap)) throw new Error('ui/index.html import map must be a JSON object')
	const imports = importMap['imports']
	if (!isRecord(imports)) throw new Error('ui/index.html import map imports must be an object')

	const outputs: string[] = []
	for (const [specifier, targetPath] of Object.entries(imports)) {
		if (typeof targetPath !== 'string') throw new Error(`ui/index.html import map target for ${specifier} must be a string`)
		if (!targetPath.startsWith('./') && !targetPath.startsWith('../')) continue
		outputs.push(normalizeRepositoryRelativePath('ui', targetPath))
	}
	return outputs
}

function createGitRunner(repositoryRoot: string): GitRunner {
	return args => {
		const result = spawnSync('git', args, {
			cwd: repositoryRoot,
			encoding: 'utf8',
		})
		if (result.error !== undefined) throw result.error
		return {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		}
	}
}

function getTrackedGeneratedPaths(runGit: GitRunner) {
	const result = runGit(['ls-files', '--', ...generatedReviewPaths])
	if (result.status !== 0) {
		throw new Error(`Unable to list tracked generated paths.\n${result.stdout}${result.stderr}`)
	}
	return result.stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line !== '')
}

function assertNoTrackedGeneratedPaths(trackedGeneratedPaths: readonly string[]) {
	if (trackedGeneratedPaths.length === 0) return

	throw new Error(`Generated artifacts must remain untracked. Remove these paths from Git and keep them covered by .gitignore and the generated artifact policy:\n${trackedGeneratedPaths.join('\n')}`)
}

export async function assertGeneratedArtifactsClean(options: GeneratedArtifactCheckOptions = {}) {
	const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot
	const runGit = options.runGit ?? createGitRunner(repositoryRoot)
	const requiredGeneratedOutputs = new Set([...explicitlyRequiredGeneratedOutputs, ...(await getSharedPackageGeneratedOutputs(repositoryRoot)), ...(await getUiImportMapGeneratedOutputs(repositoryRoot))])

	for (const relativePath of requiredGeneratedOutputs) {
		await assertExists(repositoryRoot, relativePath)
	}
	await assertContractsJsonReadable(repositoryRoot)

	const trackedGeneratedPaths = getTrackedGeneratedPaths(runGit)
	assertNoTrackedGeneratedPaths(trackedGeneratedPaths)
}

async function main() {
	await assertGeneratedArtifactsClean()
	console.log('Generated artifacts verified. Generated outputs are intentionally untracked, so freshness is validated by successful generation and required-output checks.')
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	main().catch(error => {
		console.error(error)
		process.exit(1)
	})
}
