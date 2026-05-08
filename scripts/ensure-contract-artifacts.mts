import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { spawn } from 'node:child_process'

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRoot = path.join(scriptDirectory, '..')

const solidityRoot = path.join(repositoryRoot, 'solidity')
const contractsRoot = path.join(solidityRoot, 'contracts')
const sharedRoot = path.join(repositoryRoot, 'shared')
const sharedSourceRoot = path.join(sharedRoot, 'ts')

const requiredOutputs = [path.join(solidityRoot, 'artifacts', 'Contracts.json'), path.join(solidityRoot, 'ts', 'types', 'contractArtifact.ts'), path.join(solidityRoot, 'types', 'contractArtifact.ts'), path.join(repositoryRoot, 'ui', 'ts', 'contractArtifact.ts'), path.join(repositoryRoot, 'ui', 'ts', 'abis.ts')]
const requiredSharedOutputs = [path.join(sharedRoot, 'js', 'addressDerivation.js'), path.join(sharedRoot, 'js', 'bigInt.js'), path.join(sharedRoot, 'js', 'deploymentAddresses.js')]
const requiredUiSharedOutputs = [
	path.join(repositoryRoot, 'ui', 'js', 'shared', 'addressDerivation.js'),
	path.join(repositoryRoot, 'ui', 'js', 'shared', 'bigInt.js'),
	path.join(repositoryRoot, 'ui', 'js', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'addressDerivation.js'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'bigInt.js'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'deploymentAddresses.js'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'addressDerivation.d.ts'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'bigInt.d.ts'),
	path.join(repositoryRoot, 'ui', 'ts', 'shared', 'deploymentAddresses.d.ts'),
]

const freshnessInputs = [path.join(solidityRoot, 'bun.lock'), path.join(solidityRoot, 'package.json'), path.join(solidityRoot, 'tsconfig-compile.json'), path.join(solidityRoot, 'ts', 'abi', 'abis.ts'), path.join(solidityRoot, 'ts', 'compile.ts'), path.join(repositoryRoot, 'ui', 'build', 'projectArtifacts.mts')]
const sharedFreshnessInputs = [path.join(sharedRoot, 'tsconfig.json')]
const uiSharedFreshnessInputs = [path.join(repositoryRoot, 'ui', 'build', 'shared.mts')]

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath)
		return true
	} catch {
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

async function getNewestMtime(filePaths: readonly string[]): Promise<number> {
	let newestMtime = Number.NEGATIVE_INFINITY
	for (const filePath of filePaths) {
		const stats = await fs.stat(filePath)
		newestMtime = Math.max(newestMtime, stats.mtimeMs)
	}
	return newestMtime
}

async function getOldestMtime(filePaths: readonly string[]): Promise<number> {
	let oldestMtime = Number.POSITIVE_INFINITY
	for (const filePath of filePaths) {
		const stats = await fs.stat(filePath)
		oldestMtime = Math.min(oldestMtime, stats.mtimeMs)
	}
	return oldestMtime
}

async function contractsJsonIsReadable(contractsJsonPath: string): Promise<boolean> {
	try {
		JSON.parse(await fs.readFile(contractsJsonPath, 'utf8'))
		return true
	} catch {
		return false
	}
}

async function getArtifactRegenerationReason(): Promise<string | undefined> {
	for (const outputPath of requiredOutputs) {
		if (!(await exists(outputPath))) return `missing generated file: ${path.relative(repositoryRoot, outputPath)}`
	}

	const contractsJsonPath = path.join(solidityRoot, 'artifacts', 'Contracts.json')
	if (!(await contractsJsonIsReadable(contractsJsonPath))) return 'solidity/artifacts/Contracts.json is unreadable'

	const contractSourceFiles = await getFilesRecursively(contractsRoot)
	const newestInputMtime = await getNewestMtime([...freshnessInputs, ...contractSourceFiles])
	const oldestOutputMtime = await getOldestMtime(requiredOutputs)

	if (newestInputMtime > oldestOutputMtime) return 'Solidity sources or artifact generation inputs are newer than the generated outputs'

	return undefined
}

async function runCompileContracts(): Promise<void> {
	await runBunScript(['run', 'compile-contracts'], `bun run compile-contracts`)
}

async function runSharedBuild(): Promise<void> {
	await runBunScript(['run', 'shared:build'], `bun run shared:build`)
}

async function runUiSharedMirror(): Promise<void> {
	await runBunScript(['run', 'ui:shared'], `bun run ui:shared`)
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
	const newestInputMtime = await getNewestMtime([...sharedFreshnessInputs, ...sharedSourceFiles])
	const oldestOutputMtime = await getOldestMtime(requiredSharedOutputs)

	if (newestInputMtime > oldestOutputMtime) return 'Shared TypeScript sources are newer than shared/js outputs'

	return undefined
}

async function getUiSharedMirrorRegenerationReason(): Promise<string | undefined> {
	for (const outputPath of requiredUiSharedOutputs) {
		if (!(await exists(outputPath))) return `missing ui shared mirror output: ${path.relative(repositoryRoot, outputPath)}`
	}

	const newestInputMtime = await getNewestMtime([...uiSharedFreshnessInputs, ...requiredSharedOutputs])
	const oldestOutputMtime = await getOldestMtime(requiredUiSharedOutputs)

	if (newestInputMtime > oldestOutputMtime) return 'UI shared mirror outputs are older than the shared build outputs or mirror script'

	return undefined
}

export async function ensureContractArtifactsAreCurrent(): Promise<void> {
	const sharedRegenerationReason = await getSharedBuildRegenerationReason()
	if (sharedRegenerationReason !== undefined) {
		console.log(`Regenerating shared build outputs before tests: ${sharedRegenerationReason}`)
		await runSharedBuild()
	}

	const uiSharedMirrorReason = await getUiSharedMirrorRegenerationReason()
	if (uiSharedMirrorReason !== undefined) {
		console.log(`Regenerating ui shared mirror outputs before tests: ${uiSharedMirrorReason}`)
		await runUiSharedMirror()
	}

	const regenerationReason = await getArtifactRegenerationReason()
	if (regenerationReason === undefined) return

	console.log(`Regenerating contract artifacts before tests: ${regenerationReason}`)
	await runCompileContracts()
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	await ensureContractArtifactsAreCurrent()
}
