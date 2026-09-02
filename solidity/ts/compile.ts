import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import solc from 'solc'
import openOracleSolc from 'solc-0-8-28'
import * as url from 'url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const CONTRACT_PATH_APP = path.join(directoryOfThisFile, '..', 'ts', 'types', 'contractArtifact.ts')
const HASH_CACHE_PATH = path.join(process.cwd(), '.contract-hash.json')
const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts')
const ARTIFACTS_JSON = path.join(ARTIFACTS_DIR, 'Contracts.json')
const OPEN_ORACLE_LOCAL_PATH = 'contracts/statoblast/openOracle/OpenOracle.sol'
const OPEN_ORACLE_LOCAL_PREFIX = 'contracts/statoblast/openOracle/'
const OPEN_ORACLE_LOCAL_VENDOR_PREFIX = 'contracts/statoblast/openOracle/openzeppelin/contracts/'
const OPEN_ORACLE_UPSTREAM_PATH = 'src/OpenOracleSlim.sol'
const OPEN_ORACLE_UPSTREAM_PREFIX = 'src/'
const OPEN_ORACLE_IMPORT_PREFIX = '@openzeppelin/contracts/'
const MAIN_COMPILER_PROFILE_PREFIX = 'compiler-profiles/main/'
const OPEN_ORACLE_COMPILER_PROFILE_PREFIX = 'compiler-profiles/open-oracle/'
const OPEN_ORACLE_EXACT_PRAGMA = 'pragma solidity 0.8.28;'
const OPEN_ORACLE_MAIN_PASS_PRAGMA = 'pragma solidity 0.8.35;'
const allowedImmutableContractWarnings = [
	{
		sourcePath: 'contracts/statoblast/Multicall3.sol',
		message: 'Since the VM version paris, "difficulty" was replaced by "prevrandao"',
	},
	{
		sourcePath: 'contracts/statoblast/WETH9.sol',
		message: "'transfer' is deprecated and scheduled for removal",
	},
	{
		sourcePath: 'contracts/statoblast/openOracle/OpenOracle.sol',
		message: 'Unnamed return variable can remain unassigned',
	},
	{
		sourcePath: 'contracts/trading/test/TradingProtocolMocks.sol',
		message: '"selfdestruct" has been deprecated',
	},
	{
		sourcePath: OPEN_ORACLE_UPSTREAM_PATH,
		message: 'Unnamed return variable can remain unassigned',
	},
]

type AbiParameter = {
	readonly name?: string
	readonly type?: string
	readonly internalType?: string
	readonly indexed?: boolean
	readonly components?: readonly AbiParameter[]
}

type AbiEntry = {
	readonly type?: string
	readonly name?: string
	readonly stateMutability?: string
	readonly anonymous?: boolean
	readonly inputs?: readonly AbiParameter[]
	readonly outputs?: readonly AbiParameter[]
}

type ContractData = {
	readonly abi?: readonly AbiEntry[]
	readonly evm?: {
		readonly bytecode?: BytecodeData
		readonly deployedBytecode?: BytecodeData
	}
	readonly storageLayout?: unknown
}

type BytecodeData = {
	readonly object?: string
	readonly opcodes?: string
	readonly sourceMap?: string
}

type CompileResult = {
	readonly contracts?: Readonly<Record<string, Readonly<Record<string, ContractData>>>>
	readonly sources?: unknown
	readonly errors?: readonly { readonly severity: string; readonly formattedMessage: string }[]
	readonly compilerProfiles?: unknown
}

const mainCompilerSettings = {
	viaIR: true,
	evmVersion: 'osaka',
	optimizer: {
		enabled: true,
		// The protocol favors deployability of the immutable coordination contracts.
		// Their lifecycle paths are infrequent compared with deployment, so the
		// size-oriented profile is the safer tradeoff as bounded claim accounting grows.
		runs: 0,
	},
	metadata: {
		// Deployment manifests already bind the compiler settings and complete
		// bytecode, so an appended metadata trailer adds size without adding trust.
		appendCBOR: false,
		bytecodeHash: 'none',
	},
	outputSelection: {
		'*': {
			'*': ['abi', 'evm.bytecode.object', 'evm.bytecode.opcodes', 'evm.bytecode.sourceMap', 'evm.deployedBytecode.object', 'evm.deployedBytecode.opcodes', 'evm.deployedBytecode.sourceMap', 'storageLayout'],
		},
	},
}

export const openOracleCompilerSettings = {
	viaIR: true,
	optimizer: {
		enabled: true,
		runs: 190,
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

function validationError(message: string): Error {
	const error = new Error(message)
	error.name = 'ValidationError'
	return error
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isObjectRecord(value) || Array.isArray(value)) throw validationError(`${path} must be an object`)
	return value
}

function validateOptionalString(record: Record<string, unknown>, key: string, path: string) {
	const value = record[key]
	if (value !== undefined && typeof value !== 'string') throw validationError(`${path}.${key} must be a string`)
}

function validateAbiParameter(value: unknown, path: string): AbiParameter {
	const parameter = requireRecord(value, path)
	validateOptionalString(parameter, 'name', path)
	validateOptionalString(parameter, 'type', path)
	validateOptionalString(parameter, 'internalType', path)
	if (parameter['indexed'] !== undefined && typeof parameter['indexed'] !== 'boolean') throw validationError(`${path}.indexed must be a boolean`)
	if (parameter['components'] !== undefined) {
		if (!Array.isArray(parameter['components'])) throw validationError(`${path}.components must be an array`)
		parameter['components'].forEach((component, index) => validateAbiParameter(component, `${path}.components[${index}]`))
	}
	return parameter
}

function validateAbiEntry(value: unknown, path: string): AbiEntry {
	const entry = requireRecord(value, path)
	validateOptionalString(entry, 'type', path)
	validateOptionalString(entry, 'name', path)
	validateOptionalString(entry, 'stateMutability', path)
	if (entry['anonymous'] !== undefined && typeof entry['anonymous'] !== 'boolean') throw validationError(`${path}.anonymous must be a boolean`)
	for (const key of ['inputs', 'outputs'] as const) {
		const parameters = entry[key]
		if (parameters === undefined) continue
		if (!Array.isArray(parameters)) throw validationError(`${path}.${key} must be an array`)
		parameters.forEach((parameter, index) => validateAbiParameter(parameter, `${path}.${key}[${index}]`))
	}
	return entry
}

function validateBytecodeData(value: unknown, path: string): BytecodeData {
	const bytecode = requireRecord(value, path)
	validateOptionalString(bytecode, 'object', path)
	validateOptionalString(bytecode, 'opcodes', path)
	validateOptionalString(bytecode, 'sourceMap', path)
	return bytecode
}

function validateContractData(value: unknown, path: string): ContractData {
	const contract = requireRecord(value, path)
	if (contract['abi'] !== undefined) {
		if (!Array.isArray(contract['abi'])) throw validationError(`${path}.abi must be an array`)
		contract['abi'].forEach((entry, index) => validateAbiEntry(entry, `${path}.abi[${index}]`))
	}
	if (contract['evm'] !== undefined) {
		const evm = requireRecord(contract['evm'], `${path}.evm`)
		for (const key of ['bytecode', 'deployedBytecode'] as const) {
			if (evm[key] !== undefined) validateBytecodeData(evm[key], `${path}.evm.${key}`)
		}
	}
	return contract
}

function parseCompileResult(value: unknown): CompileResult {
	const result = requireRecord(value, 'compile result')
	if (result['contracts'] !== undefined) {
		const contracts = requireRecord(result['contracts'], 'compile result.contracts')
		for (const [sourcePath, sourceContracts] of Object.entries(contracts)) {
			const contractRecords = requireRecord(sourceContracts, `compile result.contracts.${sourcePath}`)
			for (const [contractName, contract] of Object.entries(contractRecords)) validateContractData(contract, `compile result.contracts.${sourcePath}.${contractName}`)
		}
	}
	if (result['errors'] !== undefined) {
		if (!Array.isArray(result['errors'])) throw validationError('compile result.errors must be an array')
		for (const [index, diagnostic] of result['errors'].entries()) {
			const error = requireRecord(diagnostic, `compile result.errors[${index}]`)
			if (typeof error['severity'] !== 'string' || typeof error['formattedMessage'] !== 'string') throw validationError(`compile result.errors[${index}] must contain string severity and formattedMessage fields`)
		}
	}
	return result
}

function parseHashCache(value: unknown): { readonly hash?: string } {
	const cache = requireRecord(value, 'hash cache')
	validateOptionalString(cache, 'hash', 'hash cache')
	return cache
}

function normalizeSoliditySourceLineEndings(source: string): string {
	return source.replace(/\r\n?/g, '\n')
}

function isCompileError(value: unknown): value is { severity: string; formattedMessage: string } {
	return isObjectRecord(value) && typeof value['severity'] === 'string' && typeof value['formattedMessage'] === 'string'
}

function isAllowedImmutableContractWarning(formattedMessage: string): boolean {
	return allowedImmutableContractWarnings.some(({ sourcePath, message }) => formattedMessage.includes(message) && formattedMessage.includes(sourcePath))
}

function isValidationError(error: unknown): error is Error {
	return error instanceof Error && error.name === 'ValidationError'
}

function getCompilerVersion(compiler: SolcCompiler): string {
	return compiler.version()
}

export async function loadOpenOracleCompiler(): Promise<SolcCompiler> {
	if (openOracleCompilerPromise) return openOracleCompilerPromise

	openOracleCompilerPromise = Promise.resolve(openOracleSolc)

	return openOracleCompilerPromise
}

async function computeContractHash(sourceFiles: Map<string, string>, openOracleCompiler: SolcCompiler): Promise<string> {
	const hasher = createHash('sha256')

	hasher.update(getCompilerVersion(solc))
	hasher.update('\n')
	hasher.update(getCompilerVersion(openOracleCompiler))
	hasher.update('\n')
	hasher.update(
		JSON.stringify({
			artifactMergeVersion: 3,
			mainCompilerSettings,
			openOracleCompilerSettings,
			openOracleLocalPath: OPEN_ORACLE_LOCAL_PATH,
			openOracleLocalPrefix: OPEN_ORACLE_LOCAL_PREFIX,
			openOracleLocalVendorPrefix: OPEN_ORACLE_LOCAL_VENDOR_PREFIX,
			openOracleUpstreamPath: OPEN_ORACLE_UPSTREAM_PATH,
			openOracleUpstreamPrefix: OPEN_ORACLE_UPSTREAM_PREFIX,
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
			const parsed = parseHashCache(JSON.parse(data))
			return { hash: parsed.hash }
		}
	} catch (error) {
		if (error instanceof SyntaxError || hasNodeErrorCode(error, 'ENOENT') || isValidationError(error)) return { hash: undefined }
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
	const solidityContract = parseCompileResult(JSON.parse(await fs.readFile(contractLocation, 'utf8')))
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
	await fs.writeFile(CONTRACT_PATH_APP, typescriptString)
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
	for (const [sourcePath, content] of sourceFiles) {
		if (!sourcePath.startsWith(OPEN_ORACLE_LOCAL_PREFIX) || !content.includes(OPEN_ORACLE_EXACT_PRAGMA)) continue
		mainSources.set(sourcePath, content.replace(OPEN_ORACLE_EXACT_PRAGMA, OPEN_ORACLE_MAIN_PASS_PRAGMA))
	}
	addOpenOracleImportAliases(mainSources, sourceFiles)
	return mainSources
}

export function createOpenOracleCompilerSources(sourceFiles: Map<string, string>) {
	const openOracleSource = sourceFiles.get(OPEN_ORACLE_LOCAL_PATH)
	if (openOracleSource === undefined) throw new Error(`Missing ${OPEN_ORACLE_LOCAL_PATH}`)
	if (!openOracleSource.includes(OPEN_ORACLE_EXACT_PRAGMA)) throw new Error(`Expected ${OPEN_ORACLE_LOCAL_PATH} to include ${OPEN_ORACLE_EXACT_PRAGMA}`)
	const openOracleSources = new Map<string, string>([[OPEN_ORACLE_UPSTREAM_PATH, normalizeSoliditySourceLineEndings(openOracleSource)]])
	for (const [sourcePath, content] of sourceFiles) {
		if (sourcePath.startsWith(OPEN_ORACLE_LOCAL_VENDOR_PREFIX)) {
			const remappedPath = `${OPEN_ORACLE_IMPORT_PREFIX}${sourcePath.slice(OPEN_ORACLE_LOCAL_VENDOR_PREFIX.length)}`
			openOracleSources.set(remappedPath, normalizeSoliditySourceLineEndings(content))
			continue
		}
		if (sourcePath === OPEN_ORACLE_LOCAL_PATH || !sourcePath.startsWith(OPEN_ORACLE_LOCAL_PREFIX)) continue
		const remappedPath = `${OPEN_ORACLE_UPSTREAM_PREFIX}${sourcePath.slice(OPEN_ORACLE_LOCAL_PREFIX.length)}`
		openOracleSources.set(remappedPath, normalizeSoliditySourceLineEndings(content))
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

	const result = parseCompileResult(JSON.parse(output))
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
	return sourcePath.startsWith(OPEN_ORACLE_LOCAL_PREFIX)
}

function remapOpenOracleSourcePath(sourcePath: string): string | undefined {
	if (sourcePath === OPEN_ORACLE_UPSTREAM_PATH) return OPEN_ORACLE_LOCAL_PATH
	if (sourcePath.startsWith(OPEN_ORACLE_UPSTREAM_PREFIX)) return `${OPEN_ORACLE_LOCAL_PREFIX}${sourcePath.slice(OPEN_ORACLE_UPSTREAM_PREFIX.length)}`
	if (sourcePath.startsWith(OPEN_ORACLE_IMPORT_PREFIX)) return `${OPEN_ORACLE_LOCAL_VENDOR_PREFIX}${sourcePath.slice(OPEN_ORACLE_IMPORT_PREFIX.length)}`
	return undefined
}

function getOpenOracleSourceIdOffset(mainSources: unknown) {
	let maximumSourceId = -1
	if (!isObjectRecord(mainSources)) return 0
	for (const [sourcePath, sourceData] of Object.entries(mainSources)) {
		if (!isObjectRecord(sourceData) || typeof sourceData['id'] !== 'number') throw new Error(`Invalid source metadata for ${sourcePath}`)
		maximumSourceId = Math.max(maximumSourceId, sourceData['id'])
	}
	return maximumSourceId + 1
}

function remapCompilerSourceMap(sourceMap: string, sourceIdOffset: number) {
	return sourceMap
		.split(';')
		.map(segment => {
			const fields = segment.split(':')
			const sourceIdField = fields[2]
			if (sourceIdField === undefined || sourceIdField === '' || sourceIdField === '-1') return segment
			if (!/^[0-9]+$/.test(sourceIdField)) throw new Error(`Invalid Solidity source-map id ${sourceIdField}`)
			fields[2] = (Number.parseInt(sourceIdField, 10) + sourceIdOffset).toString()
			return fields.join(':')
		})
		.join(';')
}

function remapContractSourceMaps(contractData: unknown, sourceIdOffset: number) {
	if (!isObjectRecord(contractData)) throw new Error('Invalid OpenOracle contract output')
	if (!isObjectRecord(contractData['evm'])) return contractData
	const evm = { ...contractData['evm'] }
	for (const sectionName of ['bytecode', 'deployedBytecode']) {
		const section = evm[sectionName]
		if (!isObjectRecord(section) || typeof section['sourceMap'] !== 'string') continue
		evm[sectionName] = { ...section, sourceMap: remapCompilerSourceMap(section['sourceMap'], sourceIdOffset) }
	}
	return { ...contractData, evm }
}

function mergeCompileSources(mainSources: unknown, openOracleSources: unknown, sourceIdOffset: number) {
	const mergedSources: Record<string, unknown> = {}

	if (isObjectRecord(mainSources)) {
		for (const [sourcePath, sourceData] of Object.entries(mainSources)) {
			if (!isObjectRecord(sourceData) || typeof sourceData['id'] !== 'number') throw new Error(`Invalid source metadata for ${sourcePath}`)
			if (sourcePath.startsWith(OPEN_ORACLE_IMPORT_PREFIX)) {
				const localSourcePath = remapOpenOracleSourcePath(sourcePath)
				if (localSourcePath === undefined) throw new Error(`Cannot remap main compiler source ${sourcePath}`)
				mergedSources[`${MAIN_COMPILER_PROFILE_PREFIX}${sourcePath}`] = { ...sourceData, sourcePath: localSourcePath }
				continue
			}
			mergedSources[sourcePath] = sourceData
		}
	}

	if (isObjectRecord(openOracleSources)) {
		for (const [sourcePath, sourceData] of Object.entries(openOracleSources)) {
			const remappedPath = remapOpenOracleSourcePath(sourcePath)
			if (remappedPath === undefined) throw new Error(`Cannot remap OpenOracle compiler source ${sourcePath}`)
			if (!isObjectRecord(sourceData) || typeof sourceData['id'] !== 'number') throw new Error(`Invalid OpenOracle source metadata for ${sourcePath}`)
			mergedSources[`${OPEN_ORACLE_COMPILER_PROFILE_PREFIX}${sourcePath}`] = { ...sourceData, id: sourceData['id'] + sourceIdOffset, sourcePath: remappedPath }
		}
	}

	return Object.keys(mergedSources).length > 0 ? mergedSources : undefined
}

function mergeCompileResults(mainResult: CompileResult, openOracleResult: CompileResult, openOracleCompiler: SolcCompiler) {
	const mergedContracts: Record<string, Record<string, unknown>> = {}
	const openOracleSourceIdOffset = getOpenOracleSourceIdOffset(mainResult.sources)

	if (mainResult.contracts) {
		for (const [sourcePath, contractFile] of Object.entries(mainResult.contracts)) {
			if (isTemporaryCompilerSourcePath(sourcePath) || isReplacedLocalOracleSourcePath(sourcePath)) continue
			if (!isObjectRecord(contractFile)) throw new Error(`Invalid contract output for ${sourcePath}`)
			mergedContracts[sourcePath] = contractFile
		}
	}

	if (openOracleResult.contracts) {
		for (const [sourcePath, contractFile] of Object.entries(openOracleResult.contracts)) {
			if (sourcePath.startsWith(OPEN_ORACLE_IMPORT_PREFIX)) continue
			const remappedPath = remapOpenOracleSourcePath(sourcePath)
			if (remappedPath === undefined) continue
			if (!isObjectRecord(contractFile)) throw new Error(`Invalid contract output for ${sourcePath}`)
			mergedContracts[remappedPath] = Object.fromEntries(Object.entries(contractFile).map(([contractName, contractData]) => [contractName, remapContractSourceMaps(contractData, openOracleSourceIdOffset)]))
		}
	}

	return {
		compilerProfiles: {
			main: { settings: mainCompilerSettings, version: getCompilerVersion(solc) },
			openOracle: { settings: openOracleCompilerSettings, version: getCompilerVersion(openOracleCompiler) },
		},
		contracts: mergedContracts,
		sources: mergeCompileSources(mainResult.sources, openOracleResult.sources, openOracleSourceIdOffset),
	}
}

const compileContracts = async () => {
	console.log('Computing contract hash...')

	const files = (await getAllFiles('contracts')).filter(file => path.extname(file) === '.sol')
	const sources = new Map<string, string>()
	for (const file of files) {
		const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/')
		sources.set(relativePath, normalizeSoliditySourceLineEndings(await fs.readFile(file, 'utf8')))
	}

	const openOracleCompiler = await loadOpenOracleCompiler()
	const currentContractHash = await computeContractHash(sources, openOracleCompiler)
	const cache = await loadHashCache()
	let needsRecompilation = !(cache.hash === currentContractHash && (await exists(ARTIFACTS_JSON)))

	if (!needsRecompilation) {
		console.log('No changes detected in Solidity contracts. Skipping recompilation.')
		try {
			const artifactContent = await fs.readFile(ARTIFACTS_JSON, 'utf8')
			parseCompileResult(JSON.parse(artifactContent))
		} catch (error) {
			if (!(error instanceof SyntaxError) && !hasNodeErrorCode(error, 'ENOENT') && !isValidationError(error)) throw error
			console.log('Artifact file is missing, inaccessible, or corrupted, recompiling...')
			needsRecompilation = true
		}
	}

	if (needsRecompilation) {
		console.log('Changes detected or first run. Compiling Solidity contracts...')
		const mainResult = compileSourceMap('main contracts', solc, createMainCompilerSources(sources), mainCompilerSettings)
		const openOracleResult = compileSourceMap('OpenOracle', openOracleCompiler, createOpenOracleCompilerSources(sources), openOracleCompilerSettings)
		const mergedResult = parseCompileResult(mergeCompileResults(mainResult, openOracleResult, openOracleCompiler))

		if (!(await exists(ARTIFACTS_DIR))) await fs.mkdir(ARTIFACTS_DIR, { recursive: false })
		await fs.writeFile(ARTIFACTS_JSON, JSON.stringify(mergedResult))
		await saveHashCache(currentContractHash)
		console.log('Compilation complete. Hash cache updated.')
	}

	await copySolidityContractArtifact(ARTIFACTS_JSON)
	console.log('TypeScript artifact generated.')
}

if (import.meta.main) {
	compileContracts().catch((error: unknown) => {
		if (error instanceof CompilationError) {
			console.error(error.toString())
		} else {
			console.error(error)
		}
		process.exit(1)
	})
}
