import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import solc from 'solc'
import * as funtypes from 'funtypes'
import * as url from 'url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const CONTRACT_PATH_APP = path.join(directoryOfThisFile, '..', 'ts', 'types', 'contractArtifact.ts')
const CONTRACT_PATH_RUNTIME = path.join(directoryOfThisFile, '..', 'types', 'contractArtifact.ts')
const HASH_CACHE_PATH = path.join(process.cwd(), '.contract-hash.json')
const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts')
const ARTIFACTS_JSON = path.join(ARTIFACTS_DIR, 'Contracts.json')
const OPEN_ORACLE_LOCAL_PATH = 'contracts/peripherals/openOracle/OpenOracle.sol'
const OPEN_ORACLE_LOCAL_VENDOR_PREFIX = 'contracts/peripherals/openOracle/openzeppelin/contracts/'
const OPEN_ORACLE_UPSTREAM_PATH = 'src/OpenOracleL1.sol'
const OPEN_ORACLE_IMPORT_PREFIX = '@openzeppelin/contracts/'
const OPEN_ORACLE_EXACT_PRAGMA = 'pragma solidity 0.8.28;'
const OPEN_ORACLE_MAIN_PASS_PRAGMA = 'pragma solidity >=0.8.28 <0.9.0;'
const OPEN_ORACLE_SOLC_VERSION = 'v0.8.28+commit.7893614a'
const allowedImmutableContractWarnings = [
	{
		sourcePath: 'contracts/peripherals/Multicall3.sol',
		message: 'Since the VM version paris, "difficulty" was replaced by "prevrandao"',
	},
	{
		sourcePath: 'contracts/peripherals/WETH9.sol',
		message: "'transfer' is deprecated and scheduled for removal",
	},
	{
		sourcePath: 'contracts/peripherals/openOracle/OpenOracle.sol',
		message: 'Unnamed return variable can remain unassigned',
	},
	{
		sourcePath: OPEN_ORACLE_UPSTREAM_PATH,
		message: 'Unnamed return variable can remain unassigned',
	},
]

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

const ContractData = funtypes.ReadonlyPartial({
	abi: funtypes.ReadonlyArray(AbiEntry),
	evm: funtypes.ReadonlyPartial({
		bytecode: funtypes.ReadonlyPartial({
			object: funtypes.String,
			opcodes: funtypes.String,
			sourceMap: funtypes.String,
		}),
		deployedBytecode: funtypes.ReadonlyPartial({
			object: funtypes.String,
			opcodes: funtypes.String,
			sourceMap: funtypes.String,
		}),
	}),
	storageLayout: funtypes.Unknown,
})

const CompileResult = funtypes.ReadonlyObject({
	contracts: funtypes.Union(funtypes.Record(funtypes.String, funtypes.Record(funtypes.String, ContractData)), funtypes.Undefined),
	sources: funtypes.Union(funtypes.Unknown, funtypes.Undefined),
	errors: funtypes.Union(funtypes.ReadonlyArray(CompileError), funtypes.Undefined),
})

const HashCache = funtypes.ReadonlyPartial({
	hash: funtypes.String,
})

const mainCompilerSettings = {
	viaIR: true,
	optimizer: {
		enabled: true,
		runs: 200,
	},
	outputSelection: {
		'*': {
			'*': ['abi', 'evm.bytecode.object', 'evm.bytecode.opcodes', 'evm.bytecode.sourceMap', 'evm.deployedBytecode.object', 'evm.deployedBytecode.opcodes', 'evm.deployedBytecode.sourceMap', 'storageLayout'],
		},
	},
}

const openOracleCompilerSettings = {
	viaIR: true,
	optimizer: {
		enabled: true,
		runs: 50000,
	},
	outputSelection: mainCompilerSettings.outputSelection,
	evmVersion: 'cancun',
}

type SolcCompiler = {
	compile(input: string): string
	version(): string
}

let openOracleCompilerPromise: Promise<SolcCompiler> | undefined

class CompilationError extends Error {
	errors: string[]

	constructor(errors: string[]) {
		super('compilation error')
		this.name = 'CompilationError'
		this.errors = errors
	}

	override toString() {
		const unescape = (str: string) => str.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
		return `${this.name}: ${this.message}\n errors:\n${this.errors.map((error, index) => `  [${index}] ${unescape(error)}`).join('\n')}`
	}
}

async function exists(filePath: string) {
	try {
		await fs.stat(filePath)
		return true
	} catch (error) {
		if (hasNodeErrorCode(error, 'ENOENT')) return false
		throw error
	}
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
	return isObjectRecord(error) && error['code'] === code
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isCompileError(value: unknown): value is { severity: string; formattedMessage: string } {
	return isObjectRecord(value) && typeof value['severity'] === 'string' && typeof value['formattedMessage'] === 'string'
}

function isAllowedImmutableContractWarning(formattedMessage: string): boolean {
	return allowedImmutableContractWarnings.some(({ sourcePath, message }) => formattedMessage.includes(sourcePath) && formattedMessage.includes(message))
}

function isFuntypesValidationError(error: unknown): error is Error {
	return error instanceof Error && error.name === 'ValidationError'
}

function getCompilerVersion(compiler: SolcCompiler): string {
	return compiler.version()
}

async function loadOpenOracleCompiler(): Promise<SolcCompiler> {
	if (openOracleCompilerPromise) return openOracleCompilerPromise

	// Use the locally installed compiler to avoid remote compiler loading behavior that is
	// incompatible with Bun in this environment.
	openOracleCompilerPromise = Promise.resolve(solc)

	return openOracleCompilerPromise
}

async function computeContractHash(sourceFiles: Map<string, string>): Promise<string> {
	const hasher = createHash('sha256')

	hasher.update(getCompilerVersion(solc))
	hasher.update('\n')
	hasher.update(OPEN_ORACLE_SOLC_VERSION)
	hasher.update('\n')
	hasher.update(
		JSON.stringify({
			mainCompilerSettings,
			openOracleCompilerSettings,
			openOracleLocalPath: OPEN_ORACLE_LOCAL_PATH,
			openOracleLocalVendorPrefix: OPEN_ORACLE_LOCAL_VENDOR_PREFIX,
			openOracleUpstreamPath: OPEN_ORACLE_UPSTREAM_PATH,
			openOracleImportPrefix: OPEN_ORACLE_IMPORT_PREFIX,
			openOracleMainPassPragma: OPEN_ORACLE_MAIN_PASS_PRAGMA,
		}),
	)
	hasher.update('\n')

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
	} catch (error) {
		if (error instanceof SyntaxError || hasNodeErrorCode(error, 'ENOENT') || isFuntypesValidationError(error)) return { hash: undefined }
		throw error
	}

	return { hash: undefined }
}

async function saveHashCache(contractHash: string): Promise<void> {
	await fs.mkdir(path.dirname(HASH_CACHE_PATH), { recursive: true })
	await fs.writeFile(HASH_CACHE_PATH, JSON.stringify({ hash: contractHash, updated: Date.now() }))
}

const getAllFiles = async (dirPath: string, baseDir?: string, fileList: string[] = [], visited?: Set<string>): Promise<string[]> => {
	if (!baseDir) baseDir = await fs.realpath(dirPath)
	const visitedSet = visited ?? new Set<string>()
	const canonicalDir = await fs.realpath(dirPath)
	if (visitedSet.has(canonicalDir)) return fileList
	visitedSet.add(canonicalDir)

	const files = await fs.readdir(dirPath, { withFileTypes: true })
	for (const file of files) {
		const filePath = path.join(dirPath, file.name)

		let targetPath = filePath
		if (file.isSymbolicLink()) {
			targetPath = await fs.realpath(filePath)
		}

		const relative = path.relative(baseDir, targetPath)
		if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path traversal detected: ${filePath} resolves outside allowed directory`)

		if (file.isDirectory() || (file.isSymbolicLink() && (await fs.stat(targetPath)).isDirectory())) {
			await getAllFiles(targetPath, baseDir, fileList, visitedSet)
			continue
		}

		fileList.push(filePath)
	}

	return fileList
}

const copySolidityContractArtifact = async (contractLocation: string) => {
	const solidityContract = CompileResult.parse(JSON.parse(await fs.readFile(contractLocation, 'utf8')))
	if (!solidityContract.contracts) throw new Error('No contracts compiled')
	const contracts = Object.entries(solidityContract.contracts).flatMap(([filename, contract]) => {
		if (!isObjectRecord(contract)) throw new Error('missing contract')
		return Object.entries(contract).map(([contractName, contractData]) => ({
			contractName: `${filename
				.replace('contracts/', '')
				.replace(/-/g, '')
				.replace(/\//g, '_')
				.replace(/\\/g, '_')
				.replace(/\.sol$/, '')}_${contractName}`,
			contractData: {
				abi: isObjectRecord(contractData) ? contractData['abi'] : undefined,
				evm: isObjectRecord(contractData) ? contractData['evm'] : undefined,
			},
		}))
	})
	if (new Set(contracts.map(contract => contract.contractName)).size !== contracts.length) throw new Error('duplicated contract name!')
	const typescriptString = contracts.map(contract => `export const ${contract.contractName} = ${JSON.stringify(contract.contractData, null, 4)} as const`).join('\r\n\r\n')
	await fs.mkdir(path.dirname(CONTRACT_PATH_RUNTIME), { recursive: true })
	await fs.writeFile(CONTRACT_PATH_APP, typescriptString)
	await fs.writeFile(CONTRACT_PATH_RUNTIME, `${typescriptString}\n`)
}

function buildSourceObject(sources: Map<string, string>) {
	const sourceObject: { [key: string]: { content: string } } = {}
	for (const [sourcePath, content] of sources) {
		sourceObject[sourcePath] = { content }
	}
	return sourceObject
}

function addOpenOracleImportAliases(targetSources: Map<string, string>, sourceFiles: Map<string, string>) {
	for (const [sourcePath, content] of sourceFiles) {
		if (!sourcePath.startsWith(OPEN_ORACLE_LOCAL_VENDOR_PREFIX)) continue
		const aliasedPath = `${OPEN_ORACLE_IMPORT_PREFIX}${sourcePath.slice(OPEN_ORACLE_LOCAL_VENDOR_PREFIX.length)}`
		targetSources.set(aliasedPath, content)
	}
}

function createMainCompilerSources(sourceFiles: Map<string, string>) {
	const mainSources = new Map(sourceFiles)
	const openOracleSource = sourceFiles.get(OPEN_ORACLE_LOCAL_PATH)
	if (openOracleSource === undefined) throw new Error(`Missing ${OPEN_ORACLE_LOCAL_PATH}`)
	if (!openOracleSource.includes(OPEN_ORACLE_EXACT_PRAGMA)) throw new Error(`Expected ${OPEN_ORACLE_LOCAL_PATH} to include ${OPEN_ORACLE_EXACT_PRAGMA}`)
	mainSources.set(OPEN_ORACLE_LOCAL_PATH, openOracleSource.replace(OPEN_ORACLE_EXACT_PRAGMA, OPEN_ORACLE_MAIN_PASS_PRAGMA))
	addOpenOracleImportAliases(mainSources, sourceFiles)
	return mainSources
}

function createOpenOracleCompilerSources(sourceFiles: Map<string, string>) {
	const openOracleSource = sourceFiles.get(OPEN_ORACLE_LOCAL_PATH)
	if (openOracleSource === undefined) throw new Error(`Missing ${OPEN_ORACLE_LOCAL_PATH}`)
	let normalizedOpenOracleSource = openOracleSource
	if (openOracleSource.includes(OPEN_ORACLE_EXACT_PRAGMA)) {
		normalizedOpenOracleSource = openOracleSource.replace(OPEN_ORACLE_EXACT_PRAGMA, OPEN_ORACLE_MAIN_PASS_PRAGMA)
	}
	const openOracleSources = new Map<string, string>([[OPEN_ORACLE_UPSTREAM_PATH, normalizedOpenOracleSource]])
	for (const [sourcePath, content] of sourceFiles) {
		if (!sourcePath.startsWith(OPEN_ORACLE_LOCAL_VENDOR_PREFIX)) continue
		const remappedPath = `${OPEN_ORACLE_IMPORT_PREFIX}${sourcePath.slice(OPEN_ORACLE_LOCAL_VENDOR_PREFIX.length)}`
		openOracleSources.set(remappedPath, content)
	}
	return openOracleSources
}

function compileSourceMap(label: string, compiler: SolcCompiler, sources: Map<string, string>, settings: Record<string, unknown>) {
	const input = {
		language: 'Solidity',
		sources: buildSourceObject(sources),
		settings,
	}

	console.time(`${label} compilation`)
	const output = compiler.compile(JSON.stringify(input))
	console.timeEnd(`${label} compilation`)

	const result = CompileResult.parse(JSON.parse(output))
	const diagnostics = Array.isArray(result.errors) ? result.errors : []
	const errors: string[] = []

	for (const diagnostic of diagnostics) {
		if (!isCompileError(diagnostic)) continue
		if (diagnostic.severity === 'error') errors.push(diagnostic.formattedMessage)
		if (diagnostic.severity === 'warning' && !isAllowedImmutableContractWarning(diagnostic.formattedMessage)) errors.push(diagnostic.formattedMessage)
	}

	if (errors.length > 0) throw new CompilationError(errors.map(error => `${label}: ${error}`))

	return result
}

function isTemporaryCompilerSourcePath(sourcePath: string) {
	return sourcePath === OPEN_ORACLE_UPSTREAM_PATH || sourcePath.startsWith(OPEN_ORACLE_IMPORT_PREFIX)
}

function isReplacedLocalOracleSourcePath(sourcePath: string) {
	return sourcePath === OPEN_ORACLE_LOCAL_PATH || sourcePath.startsWith(OPEN_ORACLE_LOCAL_VENDOR_PREFIX)
}

function remapOpenOracleSourcePath(sourcePath: string): string | undefined {
	if (sourcePath === OPEN_ORACLE_UPSTREAM_PATH) return OPEN_ORACLE_LOCAL_PATH
	return undefined
}

function mergeCompileSources(mainSources: unknown, openOracleSources: unknown) {
	const mergedSources: Record<string, unknown> = {}

	if (isObjectRecord(mainSources)) {
		for (const [sourcePath, sourceData] of Object.entries(mainSources)) {
			if (isTemporaryCompilerSourcePath(sourcePath) || isReplacedLocalOracleSourcePath(sourcePath)) continue
			mergedSources[sourcePath] = sourceData
		}
	}

	if (isObjectRecord(openOracleSources)) {
		for (const [sourcePath, sourceData] of Object.entries(openOracleSources)) {
			const remappedPath = remapOpenOracleSourcePath(sourcePath)
			if (remappedPath === undefined) continue
			mergedSources[remappedPath] = sourceData
		}
	}

	return Object.keys(mergedSources).length > 0 ? mergedSources : undefined
}

function mergeCompileResults(mainResult: funtypes.Static<typeof CompileResult>, openOracleResult: funtypes.Static<typeof CompileResult>) {
	const mergedContracts: Record<string, Record<string, unknown>> = {}

	if (mainResult.contracts) {
		for (const [sourcePath, contractFile] of Object.entries(mainResult.contracts)) {
			if (isTemporaryCompilerSourcePath(sourcePath) || isReplacedLocalOracleSourcePath(sourcePath)) continue
			if (!isObjectRecord(contractFile)) throw new Error(`Invalid contract output for ${sourcePath}`)
			mergedContracts[sourcePath] = contractFile
		}
	}

	if (openOracleResult.contracts) {
		for (const [sourcePath, contractFile] of Object.entries(openOracleResult.contracts)) {
			const remappedPath = remapOpenOracleSourcePath(sourcePath)
			if (remappedPath === undefined) continue
			if (!isObjectRecord(contractFile)) throw new Error(`Invalid contract output for ${sourcePath}`)
			mergedContracts[remappedPath] = contractFile
		}
	}

	return {
		contracts: mergedContracts,
		sources: mergeCompileSources(mainResult.sources, openOracleResult.sources),
	}
}

const compileContracts = async () => {
	console.log('Computing contract hash...')

	const files = await getAllFiles('contracts')
	const sources = new Map<string, string>()
	for (const file of files) {
		const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/')
		sources.set(relativePath, await fs.readFile(file, 'utf8'))
	}

	const currentContractHash = await computeContractHash(sources)
	const cache = await loadHashCache()
	let needsRecompilation = !(cache.hash === currentContractHash && (await exists(ARTIFACTS_JSON)))

	if (!needsRecompilation) {
		console.log('No changes detected in Solidity contracts. Skipping recompilation.')
		try {
			const artifactContent = await fs.readFile(ARTIFACTS_JSON, 'utf8')
			CompileResult.parse(JSON.parse(artifactContent))
		} catch (error) {
			if (!(error instanceof SyntaxError) && !hasNodeErrorCode(error, 'ENOENT') && !isFuntypesValidationError(error)) throw error
			console.log('Artifact file is missing, inaccessible, or corrupted, recompiling...')
			needsRecompilation = true
		}
	}

	if (needsRecompilation) {
		console.log('Changes detected or first run. Compiling Solidity contracts...')
		const openOracleCompiler = await loadOpenOracleCompiler()
		const mainResult = compileSourceMap('main contracts', solc, createMainCompilerSources(sources), mainCompilerSettings)
		const openOracleResult = compileSourceMap('OpenOracle', openOracleCompiler, createOpenOracleCompilerSources(sources), openOracleCompilerSettings)
		const mergedResult = CompileResult.parse(mergeCompileResults(mainResult, openOracleResult))

		if (!(await exists(ARTIFACTS_DIR))) await fs.mkdir(ARTIFACTS_DIR, { recursive: false })
		await fs.writeFile(ARTIFACTS_JSON, JSON.stringify(mergedResult))
		await saveHashCache(currentContractHash)
		console.log('Compilation complete. Hash cache updated.')
	}

	await copySolidityContractArtifact(ARTIFACTS_JSON)
	console.log('TypeScript artifact generated.')
}

compileContracts().catch((error: unknown) => {
	if (error instanceof CompilationError) {
		console.error(error.toString())
	} else {
		console.error(error)
	}
	process.exit(1)
})
