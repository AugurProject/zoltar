import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import { buildPcToSourceMap, normalizeBytecode, type ParsedSourceMapSegment } from './sourceMapParser'
import { getSolidityBytecodeCoverageConfig, isSolidityBytecodeCoverageEnabled } from './coverageConfig'
import { writeCoverageArtifacts } from './reporter'

type RpcRequest = (args: { method: string; params?: unknown[] | undefined }) => Promise<unknown>

type RpcTransactionReceiptData = {
	readonly to?: string
	readonly contractAddress?: string
}

type RpcTransactionRequest = {
	readonly to?: string
}

interface CoverageProfile {
	readonly sourceFileNames: readonly string[]
	readonly pcToSource: ReadonlyMap<number, ParsedSourceMapSegment | undefined>
}

type CoverageProfileMap = Map<string, CoverageProfile[]>

type ContractArtifactEvmBytecode = {
	readonly object: string
	readonly sourceMap: string
}

type ContractArtifact = {
	readonly evm?: {
		readonly bytecode?: ContractArtifactEvmBytecode
		readonly deployedBytecode?: ContractArtifactEvmBytecode
	}
}

type ContractArtifacts = Record<string, Record<string, ContractArtifact>>

type ContractsJson = {
	readonly contracts?: Record<string, unknown>
	readonly sources?: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseContractsJson = (raw: ContractsJson): ContractArtifacts => {
	const contractsValue = raw.contracts
	if (!isRecord(contractsValue)) return {}

	const contracts: ContractArtifacts = {}
	for (const [sourceFileName, sourceContractsValue] of Object.entries(contractsValue)) {
		if (!isRecord(sourceContractsValue)) continue

		for (const [contractName, contractValue] of Object.entries(sourceContractsValue)) {
			if (!isRecord(contractValue)) continue

			const evmValue = contractValue['evm']
			if (!isRecord(evmValue)) continue

			const getSection = (field: 'bytecode' | 'deployedBytecode'): ContractArtifactEvmBytecode | undefined => {
				const sectionValue = evmValue[field]
				if (!isRecord(sectionValue)) return undefined
				const object = typeof sectionValue['object'] === 'string' ? sectionValue['object'] : undefined
				const sourceMap = typeof sectionValue['sourceMap'] === 'string' ? sectionValue['sourceMap'] : undefined
				if (object === undefined && sourceMap === undefined) return undefined

				return {
					object: object === undefined ? '' : object,
					sourceMap: sourceMap === undefined ? '' : sourceMap,
				}
			}

			const bytecodeSection = getSection('bytecode')
			const deployedBytecodeSection = getSection('deployedBytecode')
			if (bytecodeSection === undefined && deployedBytecodeSection === undefined) continue

			const sourceFileContracts = contracts[sourceFileName] ?? {}
			const evm: { bytecode?: ContractArtifactEvmBytecode; deployedBytecode?: ContractArtifactEvmBytecode } = {}
			if (bytecodeSection !== undefined) evm.bytecode = bytecodeSection
			if (deployedBytecodeSection !== undefined) evm.deployedBytecode = deployedBytecodeSection
			sourceFileContracts[contractName] = { evm }
			contracts[sourceFileName] = sourceFileContracts
		}
	}

	return contracts
}

const readArtifactsMetadata = async (artifactsPath: string): Promise<{ contracts: ContractArtifacts; sourceFiles: readonly string[] }> => {
	const rawJson = JSON.parse(await fs.readFile(artifactsPath, 'utf8'))
	if (!isRecord(rawJson)) return { contracts: {}, sourceFiles: [] }
	const raw: ContractsJson = rawJson
	const contracts = parseContractsJson(raw)
	const sourceFiles = isRecord(raw.sources) ? Object.keys(raw.sources) : []
	return { contracts, sourceFiles }
}

const isBytecodeProfile = (bytecode: string | undefined, sourceMap: string | undefined, sourceFileNames: readonly string[]): CoverageProfile | undefined => {
	if (bytecode === undefined || sourceMap === undefined) return undefined
	const bytecodeHex = normalizeBytecode(bytecode)
	if (bytecodeHex.length === 0) return undefined
	const pcToSource = buildPcToSourceMap(bytecodeHex, sourceMap)
	if (pcToSource.size === 0) return undefined
	return { sourceFileNames, pcToSource }
}

const collectProfilesByBytecode = async (artifactsPath: string): Promise<CoverageProfileMap> => {
	const { contracts, sourceFiles } = await readArtifactsMetadata(artifactsPath)
	const profileByBytecode: CoverageProfileMap = new Map()

	for (const sourceFileContracts of Object.values(contracts)) {
		for (const contract of Object.values(sourceFileContracts)) {
			const evm = contract.evm
			if (evm === undefined) continue

			const creationProfile = isBytecodeProfile(evm.bytecode?.object, evm.bytecode?.sourceMap, sourceFiles)
			if (creationProfile !== undefined) {
				const key = normalizeBytecode(evm.bytecode?.object ?? '')
				const existing = profileByBytecode.get(key) ?? []
				existing.push(creationProfile)
				profileByBytecode.set(key, existing)
			}

			const deployedProfile = isBytecodeProfile(evm.deployedBytecode?.object, evm.deployedBytecode?.sourceMap, sourceFiles)
			if (deployedProfile !== undefined) {
				const key = normalizeBytecode(evm.deployedBytecode?.object ?? '')
				const existing = profileByBytecode.get(key) ?? []
				existing.push(deployedProfile)
				profileByBytecode.set(key, existing)
			}
		}
	}

	return profileByBytecode
}

const traceStepAddress = (step: Record<string, unknown>): string | undefined => {
	const explicitContractAddress = step['contractAddress']
	if (typeof explicitContractAddress === 'string') return normalizeAddress(explicitContractAddress)
	const explicitAddress = step['address']
	return typeof explicitAddress === 'string' ? normalizeAddress(explicitAddress) : undefined
}

const normalizeAddress = (address: string): string => (address.startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`)

const parsePcValue = (value: unknown): number | undefined => {
	if (typeof value === 'number') return value
	if (typeof value !== 'string') return undefined
	const parsedPc = value.startsWith('0x') ? Number.parseInt(value, 16) : Number.parseInt(value, 10)
	return Number.isNaN(parsedPc) ? undefined : parsedPc
}

const toAddressList = (value: unknown): readonly string[] => {
	if (typeof value !== 'string') return []
	const normalized = normalizeAddress(value)
	return normalized === '' ? [] : [normalized]
}

const lineForOffset = (source: string, offset: number): number => {
	if (offset <= 0) return 1
	if (offset >= source.length) return source.split('\n').length
	let line = 1
	for (let i = 0; i < offset; i++) if (source[i] === '\n') line++
	return line
}

const lineRangeFromSourceOffset = (source: string, sourceOffset: number, sourceLength: number): { readonly startLine: number; readonly endLine: number } => {
	const length = Math.max(0, sourceLength)
	const startLine = lineForOffset(source, sourceOffset)
	const endOffset = length === 0 ? sourceOffset : sourceOffset + length - 1
	const endLine = lineForOffset(source, endOffset)
	return { startLine, endLine }
}

const readSourceFileBySourcePath = async (rootPath: string, sourcePath: string): Promise<{ readonly absoluteSourcePath: string; readonly sourceCode: string } | undefined> => {
	const candidates = [path.join(rootPath, sourcePath), path.join(rootPath, 'solidity', sourcePath)]
	for (const candidate of candidates) {
		try {
			const sourceCode = await fs.readFile(candidate, 'utf8')
			return { absoluteSourcePath: candidate, sourceCode }
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
			// Try next candidate.
		}
	}
	return undefined
}

const parseTraceSteps = (traceResponse: unknown): unknown[] => {
	if (!isRecord(traceResponse)) return []
	const structLogs = traceResponse['structLogs']
	return Array.isArray(structLogs) ? structLogs : []
}

const collectProfilesForAddresses = async (addresses: readonly string[], request: RpcRequest, profileByBytecode: CoverageProfileMap, addressProfileCache: Map<string, CoverageProfile[] | undefined>): Promise<Map<string, CoverageProfile[]>> => {
	const result: Map<string, CoverageProfile[]> = new Map()
	for (const address of addresses) {
		const existingProfiles = addressProfileCache.get(address)
		if (existingProfiles !== undefined) {
			if (existingProfiles.length > 0) result.set(address, existingProfiles)
			continue
		}

		const onChainCode = await request({ method: 'eth_getCode', params: [address, 'latest'] })
		if (typeof onChainCode !== 'string') {
			addressProfileCache.set(address, undefined)
			continue
		}
		const normalizedCode = normalizeBytecode(onChainCode)
		const matchedProfiles = profileByBytecode.get(normalizedCode)
		addressProfileCache.set(address, matchedProfiles)
		if (matchedProfiles !== undefined && matchedProfiles.length > 0) result.set(address, matchedProfiles)
	}
	return result
}

const recordLineHitsForProfileSegment = async (profile: CoverageProfile, segment: ParsedSourceMapSegment, rootPath: string, fileContents: Map<string, string>, lineCoverage: Map<string, Map<number, number>>): Promise<void> => {
	const sourcePath = profile.sourceFileNames[segment.sourceIndex]
	if (sourcePath === undefined) return

	const sourceFile = await readSourceFileBySourcePath(rootPath, sourcePath)
	if (sourceFile === undefined) return

	let source = fileContents.get(sourceFile.absoluteSourcePath)
	if (source === undefined) {
		source = sourceFile.sourceCode
		fileContents.set(sourceFile.absoluteSourcePath, source)
	}

	const { startLine, endLine } = lineRangeFromSourceOffset(source, segment.sourceOffset, segment.sourceLength)
	if (startLine <= 0 || endLine <= 0) return

	let fileCoverage = lineCoverage.get(sourceFile.absoluteSourcePath)
	if (fileCoverage === undefined) {
		fileCoverage = new Map()
		lineCoverage.set(sourceFile.absoluteSourcePath, fileCoverage)
	}

	for (let line = startLine; line <= endLine; line++) {
		fileCoverage.set(line, (fileCoverage.get(line) ?? 0) + 1)
	}
}

let profileByBytecodePromise: Promise<CoverageProfileMap> | undefined
const lineCoverage: Map<string, Map<number, number>> = new Map()
const fileContents: Map<string, string> = new Map()
const addressProfileCache: Map<string, CoverageProfile[] | undefined> = new Map()
let isWritingCoverage = false
if (isSolidityBytecodeCoverageEnabled()) {
	process.once('beforeExit', () => {
		void writeCoverage()
	})
}

const writeCoverage = async (): Promise<void> => {
	if (isWritingCoverage) return
	isWritingCoverage = true
	try {
		const config = getSolidityBytecodeCoverageConfig()
		await writeCoverageArtifacts(lineCoverage, config)
	} finally {
		isWritingCoverage = false
	}
}

function isIgnorableTraceRequestError(error: unknown) {
	if (typeof error !== 'object' || error === null) return false

	const errorCode = 'code' in error ? error.code : undefined
	if (errorCode === -32601 || errorCode === -32000) return true

	const errorMessage = 'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : undefined
	if (errorMessage === undefined) return false
	return errorMessage.includes('debug_tracetransaction') || errorMessage.includes('method not found') || errorMessage.includes('resource not found') || errorMessage.includes('transaction not found')
}

const requestTrace = async (request: RpcRequest, transactionHash: string): Promise<unknown[]> => {
	try {
		const trace = await request({
			method: 'debug_traceTransaction',
			params: [transactionHash, { disableStack: true, disableMemory: true, disableStorage: true }],
		})
		return parseTraceSteps(trace)
	} catch (error) {
		if (!isIgnorableTraceRequestError(error)) throw error
		return []
	}
}

export const collectBytecodeCoverageForTransaction = async (options: { readonly request: RpcRequest; readonly transactionHash: string; readonly transaction: RpcTransactionRequest; readonly receipt?: RpcTransactionReceiptData }): Promise<void> => {
	if (!isSolidityBytecodeCoverageEnabled()) return

	const config = getSolidityBytecodeCoverageConfig()
	if (profileByBytecodePromise === undefined) profileByBytecodePromise = collectProfilesByBytecode(config.artifactsPath)
	const profileByBytecode = await profileByBytecodePromise
	if (profileByBytecode.size === 0) return

	const structLogs = await requestTrace(options.request, options.transactionHash)
	if (structLogs.length === 0) return

	const txToAddresses = toAddressList(options.transaction.to)
	const receiptToAddresses = toAddressList(options.receipt?.to)
	const receiptContractAddresses = toAddressList(options.receipt?.contractAddress)
	const addresses = Array.from(new Set([...txToAddresses, ...receiptToAddresses, ...receiptContractAddresses]))

	const profilesByAddress = await collectProfilesForAddresses(addresses, options.request, profileByBytecode, addressProfileCache)
	const fallbackProfiles = new Set<CoverageProfile>()
	for (const profileSet of profilesByAddress.values()) for (const profile of profileSet) fallbackProfiles.add(profile)

	for (const rawStep of structLogs) {
		if (!isRecord(rawStep)) continue

		const pc = parsePcValue(rawStep['pc'])
		if (pc === undefined) continue

		const address = traceStepAddress(rawStep)
		const profileSet = address === undefined ? undefined : profilesByAddress.get(address)
		const activeProfiles = profileSet ?? (fallbackProfiles.size > 0 ? [...fallbackProfiles] : undefined)
		if (activeProfiles === undefined) continue

		for (const profile of activeProfiles) {
			const segment = profile.pcToSource.get(pc)
			if (segment === undefined) continue
			await recordLineHitsForProfileSegment(profile, segment, config.rootPath, fileContents, lineCoverage)
		}
	}

	await writeCoverage()
}
