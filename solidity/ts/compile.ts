import { promises as fs } from 'fs'
import * as path from 'path'
import solc from 'solc'
import * as funtypes from 'funtypes'
import * as url from 'url'
import { createHash } from 'crypto'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const CONTRACT_PATH_APP = path.join(directoryOfThisFile, '..', 'ts', 'types', 'contractArtifact.ts')
const CONTRACT_PATH_RUNTIME = path.join(directoryOfThisFile, '..', 'types', 'contractArtifact.ts')
const HASH_CACHE_PATH = path.join(process.cwd(), '.contract-hash.json')
const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts')
const ARTIFACTS_JSON = path.join(ARTIFACTS_DIR, 'Contracts.json')

const CompileError = funtypes.ReadonlyObject({
	severity: funtypes.String,
	formattedMessage: funtypes.String,
})

const AbiParameter: funtypes.Runtype<{
	readonly name?: string
	readonly type?: string
	readonly internalType?: string
	readonly indexed?: boolean
	readonly components?: readonly unknown[]
}> = funtypes.Lazy(() =>
	funtypes.ReadonlyPartial({
		name: funtypes.String,
		type: funtypes.String,
		internalType: funtypes.String,
		indexed: funtypes.Boolean,
		components: funtypes.ReadonlyArray(AbiParameter),
	}),
)

const AbiEntry = funtypes.ReadonlyPartial({
	type: funtypes.String,
	name: funtypes.String,
	stateMutability: funtypes.String,
	anonymous: funtypes.Boolean,
	inputs: funtypes.ReadonlyArray(AbiParameter),
	outputs: funtypes.ReadonlyArray(AbiParameter),
})

// Contract data may have abi and evm optional (if compilation failed for that contract)
const ContractData = funtypes.ReadonlyPartial({
	abi: funtypes.ReadonlyArray(AbiEntry),
	evm: funtypes.ReadonlyPartial({
		bytecode: funtypes.ReadonlyPartial({
			object: funtypes.String,
		}),
		deployedBytecode: funtypes.ReadonlyPartial({
			object: funtypes.String,
		}),
	}),
})

const CompileResult = funtypes.ReadonlyObject({
	contracts: funtypes.Union(funtypes.Record(funtypes.String, funtypes.Record(funtypes.String, ContractData)), funtypes.Undefined),
	sources: funtypes.Union(funtypes.Unknown, funtypes.Undefined),
	errors: funtypes.Union(funtypes.ReadonlyArray(CompileError), funtypes.Undefined),
})

const HashCache = funtypes.ReadonlyPartial({
	hash: funtypes.String,
})

class CompilationError extends Error {
	errors: string[]
	constructor(errors: string[]) {
		super('compilation error')
		this.name = 'CompilationError'
		this.errors = errors
	}
	override toString() {
		const unescape = (str: string) => str.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
		return `${this.name}: ${this.message}\n errors:\n${this.errors.map((e, i) => `  [${i}] ${unescape(e)}`).join('\n')}`
	}
}

async function exists(path: string) {
	try {
		await fs.stat(path)
		return true
	} catch {
		return false
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isCompileError(value: unknown): value is { severity: string; formattedMessage: string } {
	return isObjectRecord(value) && typeof value['severity'] === 'string' && typeof value['formattedMessage'] === 'string'
}

// Compiler settings that affect output - must be included in hash
const compilerSettings = {
	viaIR: true,
	optimizer: {
		enabled: true,
		runs: 1,
		details: {
			inliner: true,
		},
	},
	outputSelection: {
		'*': {
			'*': ['evm.bytecode.object', 'evm.deployedBytecode.object', 'abi'],
		},
	},
}

async function computeContractHash(sourceFiles: Map<string, string>): Promise<string> {
	const hasher = createHash('sha256')

	// Include compiler version to detect solc upgrades
	if (!('version' in solc) || typeof solc.version !== 'function') {
		throw new Error('solc.version is unavailable')
	}
	hasher.update(solc.version())
	hasher.update('\n')

	// Include compiler settings in the hash
	hasher.update(JSON.stringify(compilerSettings))
	hasher.update('\n')

	// Hash all source files
	const sortedPaths = Array.from(sourceFiles.keys()).sort()
	for (const relativePath of sortedPaths) {
		hasher.update(relativePath)
		hasher.update('\n')
		hasher.update(sourceFiles.get(relativePath) ?? '')
		hasher.update('\n')
	}
	return hasher.digest('hex')
}

async function loadHashCache(): Promise<{ hash: string | undefined }> {
	try {
		if (await exists(HASH_CACHE_PATH)) {
			const data = await fs.readFile(HASH_CACHE_PATH, 'utf8')
			const parsed = HashCache.parse(JSON.parse(data))
			return { hash: parsed.hash }
		}
	} catch {
		// ignore
	}
	return { hash: undefined }
}

async function saveHashCache(contractHash: string): Promise<void> {
	await fs.mkdir(path.dirname(HASH_CACHE_PATH), { recursive: true })
	await fs.writeFile(HASH_CACHE_PATH, JSON.stringify({ hash: contractHash, updated: Date.now() }))
}

const getAllFiles = async (dirPath: string, baseDir?: string, fileList: string[] = [], visited?: Set<string>): Promise<string[]> => {
	// Set base directory on first call and resolve to absolute canonical path (resolve symlinks)
	if (!baseDir) {
		baseDir = await fs.realpath(dirPath)
	}
	// Initialize visited set on first call
	const visitedSet = visited ?? new Set<string>()

	// Get canonical path of current directory to detect cycles
	const canonicalDir = await fs.realpath(dirPath)
	// Skip if already visited (symlink loop detection)
	if (visitedSet.has(canonicalDir)) {
		return fileList
	}
	visitedSet.add(canonicalDir)

	const files = await fs.readdir(dirPath, { withFileTypes: true })
	for (const file of files) {
		const filePath = path.join(dirPath, file.name)

		// Resolve symbolic links to their target for security check and recursion
		let targetPath = filePath
		if (file.isSymbolicLink()) {
			targetPath = await fs.realpath(filePath)
		} else {
			// For regular files/directories, just use absolute path (no need to resolve symlinks in parent chain again)
			// Since dirPath is already resolved (canonical), filePath is already absolute.
			// We'll use filePath for security check and recursion for non-symlinks.
			targetPath = filePath
		}

		// Security check: ensure targetPath is within baseDir
		const relative = path.relative(baseDir, targetPath)
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			throw new Error(`Path traversal detected: ${filePath} resolves outside allowed directory`)
		}

		// Recurse into directories (including symlinked directories that passed the check)
		if (file.isDirectory() || (file.isSymbolicLink() && (await fs.stat(targetPath)).isDirectory())) {
			await getAllFiles(targetPath, baseDir, fileList, visitedSet)
		} else {
			fileList.push(filePath)
		}
	}
	return fileList
}

const copySolidityContractArtifact = async (contractLocation: string) => {
	const solidityContract = CompileResult.parse(JSON.parse(await fs.readFile(contractLocation, 'utf8')))
	if (!solidityContract.contracts) {
		throw new Error('No contracts compiled')
	}
	const contracts = Object.entries(solidityContract.contracts).flatMap(([filename, contract]) => {
		if (!isObjectRecord(contract)) throw new Error('missing contract')
		return Object.entries(contract).map(([contractName, contractData]) => ({
			contractName: `${filename
				.replace('contracts/', '')
				.replace(/-/g, '')
				.replace(/\//g, '_')
				.replace(/\\/g, '_')
				.replace(/\.sol$/, '')}_${contractName}`,
			contractData,
		}))
	})
	if (new Set(contracts.map(x => x.contractName)).size !== contracts.length) throw new Error('duplicated contract name!')
	const typescriptString = contracts.map(contract => `export const ${contract.contractName} = ${JSON.stringify(contract.contractData, null, 4)} as const`).join('\r\n\r\n')
	await fs.mkdir(path.dirname(CONTRACT_PATH_RUNTIME), { recursive: true })
	await fs.writeFile(CONTRACT_PATH_APP, typescriptString)
	await fs.writeFile(CONTRACT_PATH_RUNTIME, `${typescriptString}\n`)
}

const compileContracts = async () => {
	console.log('Computing contract hash...')

	// Load all source files once
	const files = await getAllFiles('contracts')
	const sources = new Map<string, string>()
	for (const file of files) {
		const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/')
		sources.set(relativePath, await fs.readFile(file, 'utf8'))
	}

	// Compute hash from loaded sources (no additional I/O)
	const currentContractHash = await computeContractHash(sources)
	const cache = await loadHashCache()

	// Determine if recompilation is needed
	let needsRecompilation = !(cache.hash === currentContractHash && (await exists(ARTIFACTS_JSON)))

	if (!needsRecompilation) {
		console.log('No changes detected in Solidity contracts. Skipping recompilation.')
		// Validate artifact file exists, is accessible, and contains valid data
		try {
			const artifactContent = await fs.readFile(ARTIFACTS_JSON, 'utf8')
			CompileResult.parse(JSON.parse(artifactContent))
		} catch {
			console.log('Artifact file is missing, inaccessible, or corrupted, recompiling...')
			needsRecompilation = true
		}
	}

	if (needsRecompilation) {
		console.log('Changes detected or first run. Compiling Solidity contracts...')

		// Convert Map to object for solc input
		const sourcesObj: { [key: string]: { content: string } } = {}
		for (const [key, value] of sources) {
			sourcesObj[key] = { content: value }
		}

		const input = {
			language: 'Solidity',
			sources: sourcesObj,
			settings: compilerSettings,
		}

		console.time('solc compilation')
		const output = solc.compile(JSON.stringify(input))
		console.timeEnd('solc compilation')

		const result = CompileResult.parse(JSON.parse(output))
		const diagnostics = Array.isArray(result.errors) ? result.errors : []
		const errors: string[] = []
		const warnings: string[] = []
		for (const diagnostic of diagnostics) {
			if (!isCompileError(diagnostic)) continue
			if (diagnostic.severity === 'error') errors.push(diagnostic.formattedMessage)
			if (diagnostic.severity === 'warning') warnings.push(diagnostic.formattedMessage)
		}
		if (errors.length) throw new CompilationError(errors)

		if (warnings.length > 0) warnings.forEach(warning => console.warn(warning))

		if (!(await exists(ARTIFACTS_DIR))) await fs.mkdir(ARTIFACTS_DIR, { recursive: false })
		await fs.writeFile(ARTIFACTS_JSON, output)

		// Save updated hash after successful compilation
		await saveHashCache(currentContractHash)
		console.log('Compilation complete. Hash cache updated.')
	}

	// Always regenerate TypeScript artifact to reflect any changes in the generation logic
	await copySolidityContractArtifact(ARTIFACTS_JSON)
	console.log('TypeScript artifact generated.')
}

compileContracts().catch((error: unknown) => {
	if (error instanceof CompilationError) {
		console.error(error.toString())
	} else {
		console.error(error)
	}
	debugger
	process.exit(1)
})
