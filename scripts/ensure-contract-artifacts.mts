import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRoot = path.join(scriptDirectory, '..')

const solidityRoot = path.join(repositoryRoot, 'solidity')
const contractsRoot = path.join(solidityRoot, 'contracts')
const sharedRoot = path.join(repositoryRoot, 'shared')
const sharedSourceRoot = path.join(sharedRoot, 'ts')
const contractFreshnessCachePath = path.join(solidityRoot, 'artifacts', '.freshness-hash')
const sharedFreshnessCachePath = path.join(sharedRoot, 'js', '.freshness-hash')

const requiredOutputs = [path.join(solidityRoot, 'artifacts', 'Contracts.json'), path.join(solidityRoot, 'ts', 'types', 'contractArtifact.ts'), path.join(solidityRoot, 'types', 'contractArtifact.ts'), path.join(repositoryRoot, 'ui', 'ts', 'contractArtifact.ts'), path.join(repositoryRoot, 'ui', 'ts', 'abis.ts')]
const requiredSharedOutputs = [path.join(sharedRoot, 'js', 'addressDerivation.js'), path.join(sharedRoot, 'js', 'bigInt.js'), path.join(sharedRoot, 'js', 'constants.js'), path.join(sharedRoot, 'js', 'deploymentAddresses.js')]

const freshnessInputs = [path.join(solidityRoot, 'bun.lock'), path.join(solidityRoot, 'package.json'), path.join(solidityRoot, 'tsconfig-compile.json'), path.join(solidityRoot, 'ts', 'abi', 'abis.ts'), path.join(solidityRoot, 'ts', 'compile.ts'), path.join(repositoryRoot, 'ui', 'build', 'projectArtifacts.mts')]
const sharedFreshnessInputs = [path.join(sharedRoot, 'tsconfig.json')]

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath)
		return true
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		return false
	}
}

async function getFilesRecursively(directoryPath: string): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const entryPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await getFilesRecursively(entryPath)))
			continue
		}
		if (entry.isFile()) files.push(entryPath)
	}
	return files
}

async function contractsJsonIsReadable(contractsJsonPath: string): Promise<boolean> {
	try {
		JSON.parse(await fs.readFile(contractsJsonPath, 'utf8'))
		return true
	} catch (error) {
		if (error instanceof SyntaxError || isMissingPathError(error)) return false
		throw error
	}
}

async function computeFreshnessHash(filePaths: readonly string[]): Promise<string> {
	const hash = createHash('sha256')
	const sortedFilePaths = [...filePaths].sort()
	for (const filePath of sortedFilePaths) {
		const relativePath = path.relative(repositoryRoot, filePath)
		hash.update(relativePath)
		hash.update('\0')
		hash.update(await fs.readFile(filePath))
		hash.update('\0')
	}
	return hash.digest('hex')
}

async function readFreshnessHash(cachePath: string): Promise<string | undefined> {
	try {
		return await fs.readFile(cachePath, 'utf8')
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		return undefined
	}
}

async function writeFreshnessHash(cachePath: string, hash: string): Promise<void> {
	await fs.mkdir(path.dirname(cachePath), { recursive: true })
	await fs.writeFile(cachePath, hash)
}

async function getArtifactRegenerationReason(): Promise<string | undefined> {
	for (const outputPath of requiredOutputs) {
		if (!(await exists(outputPath))) return `missing generated file: ${path.relative(repositoryRoot, outputPath)}`
	}

	const contractsJsonPath = path.join(solidityRoot, 'artifacts', 'Contracts.json')
	if (!(await contractsJsonIsReadable(contractsJsonPath))) return 'solidity/artifacts/Contracts.json is unreadable'

	const contractSourceFiles = await getFilesRecursively(contractsRoot)
	const currentFreshnessHash = await computeFreshnessHash([...freshnessInputs, ...contractSourceFiles])
	const cachedFreshnessHash = await readFreshnessHash(contractFreshnessCachePath)
	if (cachedFreshnessHash !== currentFreshnessHash) return 'Solidity sources or artifact generation inputs changed since the last generated outputs'

	return undefined
}

async function syncContractFreshnessHash(): Promise<void> {
	const contractSourceFiles = await getFilesRecursively(contractsRoot)
	await writeFreshnessHash(contractFreshnessCachePath, await computeFreshnessHash([...freshnessInputs, ...contractSourceFiles]))
}

async function runCompileContracts(): Promise<void> {
	await runBunScript(['run', 'compile-contracts'], `bun run compile-contracts`)
}

async function runSharedBuild(): Promise<void> {
	await runBunScript(['run', 'shared:build'], `bun run shared:build`)
}

async function runRefreshSharedDependencies(): Promise<void> {
	await runBunScript(['run', 'refresh:shared-dependencies'], `bun run refresh:shared-dependencies`)
}

async function runBunScript(args: string[], label: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: repositoryRoot,
			stdio: 'inherit',
		})

		child.on('error', reject)
		child.on('exit', code => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`${label} exited with code ${code ?? 'unknown'}`))
		})
	})
}

async function getSharedBuildRegenerationReason(): Promise<string | undefined> {
	for (const outputPath of requiredSharedOutputs) {
		if (!(await exists(outputPath))) return `missing shared build output: ${path.relative(repositoryRoot, outputPath)}`
	}

	const sharedSourceFiles = await getFilesRecursively(sharedSourceRoot)
	const currentFreshnessHash = await computeFreshnessHash([...sharedFreshnessInputs, ...sharedSourceFiles])
	const cachedFreshnessHash = await readFreshnessHash(sharedFreshnessCachePath)
	if (cachedFreshnessHash !== currentFreshnessHash) return 'Shared TypeScript sources or build inputs changed since the last shared/js outputs'

	return undefined
}

async function syncSharedFreshnessHash(): Promise<void> {
	const sharedSourceFiles = await getFilesRecursively(sharedSourceRoot)
	await writeFreshnessHash(sharedFreshnessCachePath, await computeFreshnessHash([...sharedFreshnessInputs, ...sharedSourceFiles]))
}

export async function ensureSharedBuildIsCurrent(): Promise<void> {
	const sharedRegenerationReason = await getSharedBuildRegenerationReason()
	if (sharedRegenerationReason === undefined) return

	console.log(`Regenerating shared build outputs before tests: ${sharedRegenerationReason}`)
	await runSharedBuild()
	await runRefreshSharedDependencies()
	await syncSharedFreshnessHash()
	const sharedRegenerationReasonAfterBuild = await getSharedBuildRegenerationReason()
	if (sharedRegenerationReasonAfterBuild !== undefined) {
		throw new Error(`Shared build outputs are still stale after regeneration: ${sharedRegenerationReasonAfterBuild}`)
	}
}

export async function ensureContractArtifactsAreCurrent(): Promise<void> {
	await ensureSharedBuildIsCurrent()
	const regenerationReason = await getArtifactRegenerationReason()
	if (regenerationReason === undefined) return

	console.log(`Regenerating contract artifacts before tests: ${regenerationReason}`)
	await runCompileContracts()
	await syncContractFreshnessHash()
	const regenerationReasonAfterBuild = await getArtifactRegenerationReason()
	if (regenerationReasonAfterBuild !== undefined) {
		throw new Error(`Contract artifacts are still stale after regeneration: ${regenerationReasonAfterBuild}`)
	}
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]
const mode = process.argv[2]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	if (mode === '--ensure-shared-only') {
		await ensureSharedBuildIsCurrent()
	} else if (mode === '--sync-shared-freshness') {
		await syncSharedFreshnessHash()
	} else if (mode === '--sync-contract-freshness') {
		await syncContractFreshnessHash()
	} else {
		await ensureContractArtifactsAreCurrent()
	}
}
