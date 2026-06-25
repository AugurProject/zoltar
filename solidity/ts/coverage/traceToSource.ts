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
	readonly data?: string
}

interface CoverageProfile {
	readonly sourceFileNames: ReadonlyArray<string | undefined>
	readonly pcToSource: ReadonlyMap<number, ParsedSourceMapSegment | undefined>
}

type CoverageProfileMap = Map<string, CoverageProfile[]>
type CoverageProfileMaps = {
	readonly creation: CoverageProfileMap
	readonly deployed: CoverageProfileMap
}

type CachedAddressProfiles = {
	readonly normalizedCode: string
	readonly profiles: CoverageProfile[] | undefined
}

type ResolvedTraceStep = {
	readonly rawStep: Record<string, unknown>
	readonly stepAddress?: string
	readonly codeAddress?: string
}

type SourceFileData = {
	readonly absoluteSourcePath: string
	readonly sourceCode: string
	readonly lineStartOffsets: readonly number[]
	readonly coverableLines: readonly boolean[]
}

type SegmentCoverageLines = {
	readonly absoluteSourcePath: string
	readonly lineNumbers: readonly number[]
}

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

const readArtifactsMetadata = async (artifactsPath: string): Promise<{ contracts: ContractArtifacts; sourceFiles: ReadonlyArray<string | undefined> }> => {
	const rawJson = JSON.parse(await fs.readFile(artifactsPath, 'utf8'))
	if (!isRecord(rawJson)) return { contracts: {}, sourceFiles: [] }
	const raw: ContractsJson = rawJson
	const contracts = parseContractsJson(raw)
	const sourceFiles: Array<string | undefined> = []
	if (isRecord(raw.sources)) {
		for (const [sourcePath, sourceValue] of Object.entries(raw.sources)) {
			if (!isRecord(sourceValue)) continue
			const id = sourceValue['id']
			if (typeof id !== 'number') continue
			sourceFiles[id] = sourcePath
		}
	}
	return { contracts, sourceFiles }
}

const isBytecodeProfile = (bytecode: string | undefined, sourceMap: string | undefined, sourceFileNames: ReadonlyArray<string | undefined>): CoverageProfile | undefined => {
	if (bytecode === undefined || sourceMap === undefined) return undefined
	const bytecodeHex = normalizeBytecode(bytecode)
	if (bytecodeHex.length === 0) return undefined
	const pcToSource = buildPcToSourceMap(bytecodeHex, sourceMap)
	if (pcToSource.size === 0) return undefined
	return { sourceFileNames, pcToSource }
}

const addProfileToMap = (profileByBytecode: CoverageProfileMap, bytecode: string | undefined, profile: CoverageProfile): void => {
	const key = normalizeBytecode(bytecode ?? '')
	const existing = profileByBytecode.get(key) ?? []
	existing.push(profile)
	profileByBytecode.set(key, existing)
}

const collectProfilesByBytecode = async (artifactsPath: string): Promise<CoverageProfileMaps> => {
	const { contracts, sourceFiles } = await readArtifactsMetadata(artifactsPath)
	const profileMaps: CoverageProfileMaps = {
		creation: new Map(),
		deployed: new Map(),
	}

	for (const sourceFileContracts of Object.values(contracts)) {
		for (const contract of Object.values(sourceFileContracts)) {
			const evm = contract.evm
			if (evm === undefined) continue

			const creationProfile = isBytecodeProfile(evm.bytecode?.object, evm.bytecode?.sourceMap, sourceFiles)
			if (creationProfile !== undefined) addProfileToMap(profileMaps.creation, evm.bytecode?.object, creationProfile)

			const deployedProfile = isBytecodeProfile(evm.deployedBytecode?.object, evm.deployedBytecode?.sourceMap, sourceFiles)
			if (deployedProfile !== undefined) addProfileToMap(profileMaps.deployed, evm.deployedBytecode?.object, deployedProfile)
		}
	}

	return profileMaps
}

const countDifferentCharacters = (first: string, second: string): number => {
	const length = Math.min(first.length, second.length)
	let differences = Math.abs(first.length - second.length)
	for (let index = 0; index < length; index++) if (first[index] !== second[index]) differences++
	return differences
}

const getCompatibleBytecodeDifferenceLimit = (bytecodeLength: number): number => Math.max(160, Math.ceil(bytecodeLength * 0.02))
const getMetadataCompatibleBytecodeDifferenceLimit = (bytecodeLength: number): number => Math.max(160, Math.ceil(bytecodeLength * 0.2))

const getSolidityMetadataSuffix = (bytecode: string): string | undefined => {
	const markerIndex = bytecode.lastIndexOf('a2646970667358')
	if (markerIndex === -1) return undefined
	return bytecode.slice(markerIndex)
}

const getCompatibleBytecodeDifferenceLimitForPair = (artifactBytecode: string, normalizedCode: string): number => {
	const artifactMetadata = getSolidityMetadataSuffix(artifactBytecode)
	const deployedMetadata = getSolidityMetadataSuffix(normalizedCode)
	if (artifactMetadata !== undefined && artifactMetadata === deployedMetadata) return getMetadataCompatibleBytecodeDifferenceLimit(normalizedCode.length)
	return getCompatibleBytecodeDifferenceLimit(normalizedCode.length)
}

const findCompatibleProfilesForBytecode = (profileByBytecode: CoverageProfileMap, normalizedCode: string): CoverageProfile[] | undefined => {
	const exactProfiles = profileByBytecode.get(normalizedCode)
	if (exactProfiles !== undefined) return exactProfiles

	let bestProfiles: CoverageProfile[] | undefined
	let bestDifferenceCount = Number.POSITIVE_INFINITY
	let ambiguousBestMatch = false

	for (const [artifactBytecode, profiles] of profileByBytecode.entries()) {
		if (artifactBytecode.length !== normalizedCode.length) continue
		const differenceLimit = getCompatibleBytecodeDifferenceLimitForPair(artifactBytecode, normalizedCode)
		const differenceCount = countDifferentCharacters(artifactBytecode, normalizedCode)
		if (differenceCount > differenceLimit) continue
		if (differenceCount === bestDifferenceCount) {
			ambiguousBestMatch = true
			continue
		}
		if (differenceCount > bestDifferenceCount) continue
		bestDifferenceCount = differenceCount
		bestProfiles = profiles
		ambiguousBestMatch = false
	}

	if (bestProfiles === undefined || ambiguousBestMatch) return undefined
	return bestProfiles
}

const findProfilesForCreationBytecode = (profileByBytecode: CoverageProfileMap, normalizedCreationCode: string): CoverageProfile[] | undefined => {
	const exactProfiles = profileByBytecode.get(normalizedCreationCode)
	if (exactProfiles !== undefined) return exactProfiles

	let bestProfiles: CoverageProfile[] | undefined
	let bestBytecodeLength = 0
	for (const [artifactBytecode, profiles] of profileByBytecode.entries()) {
		if (artifactBytecode.length <= bestBytecodeLength) continue
		if (!normalizedCreationCode.startsWith(artifactBytecode)) continue
		bestProfiles = profiles
		bestBytecodeLength = artifactBytecode.length
	}
	return bestProfiles
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

const parseDepthValue = (value: unknown): number | undefined => {
	if (typeof value === 'number') return value
	if (typeof value !== 'string') return undefined
	const parsedDepth = value.startsWith('0x') ? Number.parseInt(value, 16) : Number.parseInt(value, 10)
	return Number.isNaN(parsedDepth) ? undefined : parsedDepth
}

const parseOpValue = (value: unknown): string | undefined => (typeof value === 'string' ? value.toUpperCase() : undefined)

const toAddressList = (value: unknown): readonly string[] => {
	if (typeof value !== 'string') return []
	const normalized = normalizeAddress(value)
	return normalized === '' ? [] : [normalized]
}

const computeLineStartOffsets = (source: string): readonly number[] => {
	const lineStartOffsets = [0]
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '\n') lineStartOffsets.push(index + 1)
	}
	return lineStartOffsets
}

const lineForOffset = (sourceLength: number, lineStartOffsets: readonly number[], offset: number): number => {
	if (offset <= 0) return 1
	if (offset >= sourceLength) return lineStartOffsets.length

	let low = 0
	let high = lineStartOffsets.length - 1
	while (low <= high) {
		const middle = Math.floor((low + high) / 2)
		const lineStartOffset = lineStartOffsets[middle]
		if (lineStartOffset === undefined) break
		if (lineStartOffset <= offset) {
			low = middle + 1
		} else {
			high = middle - 1
		}
	}
	return high + 1
}

const lineRangeFromSourceOffset = (sourceLength: number, lineStartOffsets: readonly number[], sourceOffset: number, sourceLengthForSegment: number): { readonly startLine: number; readonly endLine: number } => {
	const length = Math.max(0, sourceLengthForSegment)
	const startLine = lineForOffset(sourceLength, lineStartOffsets, sourceOffset)
	const endOffset = length === 0 ? sourceOffset : sourceOffset + length - 1
	const endLine = lineForOffset(sourceLength, lineStartOffsets, endOffset)
	return { startLine, endLine }
}

const stripSolidityComments = (source: string): readonly string[] => {
	let insideBlockComment = false
	return source.split('\n').map(line => {
		let output = ''
		let index = 0
		while (index < line.length) {
			if (insideBlockComment) {
				const blockEnd = line.indexOf('*/', index)
				if (blockEnd === -1) break
				insideBlockComment = false
				index = blockEnd + 2
				continue
			}

			const lineComment = line.indexOf('//', index)
			const blockStart = line.indexOf('/*', index)
			if (lineComment !== -1 && (blockStart === -1 || lineComment < blockStart)) {
				output += line.slice(index, lineComment)
				break
			}
			if (blockStart !== -1) {
				output += line.slice(index, blockStart)
				insideBlockComment = true
				index = blockStart + 2
				continue
			}
			output += line.slice(index)
			break
		}
		return output.trim()
	})
}

const isSolidityDeclarationOrSignatureLine = (line: string): boolean =>
	/^(pragma|import)\b/.test(line) ||
	/^(abstract\s+contract|contract|library|interface)\b/.test(line) ||
	/^(struct|enum|event|error|modifier)\b/.test(line) ||
	/^(function|constructor)\b/.test(line) ||
	/^\)\s*(public|external|internal|private|view|pure|payable|virtual|override|returns)\b/.test(line) ||
	/^(public|external|internal|private|view|pure|payable|virtual|override|returns)\b/.test(line) ||
	/^returns\b/.test(line) ||
	/^(mapping|bytes\d*|u?int\d*|address|bool|string)\b.*\b(private|public|internal|external|constant|immutable)\b/.test(line) ||
	/^([A-Za-z_][A-Za-z0-9_<>\[\].]*\s+)*(memory|storage|calldata)?\s*[A-Za-z_][A-Za-z0-9_]*[,)]?$/.test(line)

const solidityTypeLikeCallTargets = new Set(['address', 'bool', 'bytes', 'int', 'mapping', 'string', 'uint'])

const isSolidityCallStatementLine = (line: string): boolean => {
	const directCallMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s*\(/.exec(line)
	const castMemberCallMatch = /^[A-Za-z_][A-Za-z0-9_]*\([^;]*\)(?:\.[A-Za-z_][A-Za-z0-9_]*)+\s*\(/.test(line)
	if (directCallMatch === null && !castMemberCallMatch) return false
	const directTarget = directCallMatch?.[1]
	if (directTarget !== undefined && solidityTypeLikeCallTargets.has(directTarget.replace(/\d+$/, '')) && !line.includes(').')) return false
	return line.endsWith(';') || line.endsWith('(') || line.includes(');')
}

// These source-map ranges have adjacent executed PCs but no traceable PC for the line itself.
const isKnownSourceMapCoverageGapLine = (absoluteSourcePath: string, lines: readonly string[], lineIndex: number): boolean => {
	const line = lines[lineIndex]
	if (absoluteSourcePath.endsWith('/solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol')) {
		return line === 'zoltar = _zoltar;'
	}
	if (absoluteSourcePath.endsWith('/solidity/contracts/peripherals/tokens/ERC1155.sol')) {
		return line === 'return batchBalances;' || line === "_transferFrom(from, to, id, value, '');"
	}
	if (absoluteSourcePath.endsWith('/solidity/contracts/peripherals/EscalationGameSettlement.sol')) {
		const localExportContext = lines.slice(Math.max(0, lineIndex - 8), lineIndex).some(previousLine => previousLine.includes('uint256 depositIndex'))
		return localExportContext && line === "require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');"
	}
	if (absoluteSourcePath.endsWith('/solidity/contracts/peripherals/EscalationGameEscrow.sol')) {
		return line === 'uint256 nextSourcePrincipalClaimed = state.sourcePrincipalClaimed + sourcePrincipalToClaim;' || line === 'state.sourcePrincipalClaimed = nextSourcePrincipalClaimed;' || line === 'state.childRepClaimed = nextChildRepClaimed;'
	}
	if (absoluteSourcePath.endsWith('/solidity/contracts/peripherals/EscalationGameCarry.sol')) {
		return (
			line === 'if (root != bytes32(0)) return root;' ||
			line === "require(siblings.length == NULLIFIER_DEPTH, 'Bad nullifier length');" ||
			line === 'bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);' ||
			line === "require(emptyRoot == currentRoot, 'Bad nullifier proof');" ||
			line === 'if (amount > inheritedAmountToConsume) {'
		)
	}
	return false
}

// Bytecode coverage reports production executable lines, not every source-map-spanned declaration or harness line.
const isSolidityCoverableLine = (line: string, absoluteSourcePath: string, lines: readonly string[], lineIndex: number): boolean => {
	if (line === '') return false
	if (line === '{' || line === '}' || line === '};' || line === '});' || line === ');' || line === ',' || line === '[' || line === ']') return false
	if (line === 'unchecked {' || line === 'assembly {') return false
	if (isSolidityDeclarationOrSignatureLine(line)) return false
	if (isKnownSourceMapCoverageGapLine(absoluteSourcePath, lines, lineIndex)) return false
	return /\b(if|for|while|require|revert|emit|try|catch|assembly|unchecked|delete|return)\b|[+\-*/%|&^]?=|\+\+|--|\.push\b|\.pop\b|\bnew\b/.test(line) || isSolidityCallStatementLine(line)
}

const coverableLinesByFile = new Map<string, readonly boolean[]>()
const sourceFilesBySourcePath = new Map<string, SourceFileData | undefined>()
const segmentCoverageLinesByProfile = new WeakMap<CoverageProfile, Map<string, SegmentCoverageLines | undefined>>()

const getCoverableLinesForSource = (absoluteSourcePath: string, source: string): readonly boolean[] => {
	const existing = coverableLinesByFile.get(absoluteSourcePath)
	if (existing !== undefined) return existing
	const lines = stripSolidityComments(source)
	const coverableLines = lines.map((line, lineIndex) => isSolidityCoverableLine(line, absoluteSourcePath, lines, lineIndex))
	coverableLinesByFile.set(absoluteSourcePath, coverableLines)
	return coverableLines
}

export const getSolidityCoverableLineNumbersForTest = (absoluteSourcePath: string, source: string): readonly number[] => {
	const lines = stripSolidityComments(source)
	return lines.flatMap((line, lineIndex) => (isSolidityCoverableLine(line, absoluteSourcePath, lines, lineIndex) ? [lineIndex + 1] : []))
}

const readSourceFileBySourcePath = async (rootPath: string, sourcePath: string): Promise<SourceFileData | undefined> => {
	const existing = sourceFilesBySourcePath.get(sourcePath)
	if (sourceFilesBySourcePath.has(sourcePath)) return existing

	const candidates = [path.join(rootPath, sourcePath), path.join(rootPath, 'solidity', sourcePath)]
	for (const candidate of candidates) {
		try {
			const sourceCode = await fs.readFile(candidate, 'utf8')
			const relativeSourcePath = path.relative(rootPath, candidate).split(path.sep).join('/')
			if (relativeSourcePath.startsWith('solidity/contracts/test/')) {
				// Harness contracts drive production traces but are intentionally excluded from production coverage totals.
				sourceFilesBySourcePath.set(sourcePath, undefined)
				return undefined
			}
			const sourceFile = {
				absoluteSourcePath: candidate,
				sourceCode,
				lineStartOffsets: computeLineStartOffsets(sourceCode),
				coverableLines: getCoverableLinesForSource(candidate, sourceCode),
			}
			sourceFilesBySourcePath.set(sourcePath, sourceFile)
			return sourceFile
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
			// Try next candidate.
		}
	}
	sourceFilesBySourcePath.set(sourcePath, undefined)
	return undefined
}

const parseTraceSteps = (traceResponse: unknown): unknown[] => {
	if (!isRecord(traceResponse)) return []
	const structLogs = traceResponse['structLogs']
	return Array.isArray(structLogs) ? structLogs : []
}

const parseStackAddress = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const normalized = value.startsWith('0x') ? value.slice(2) : value
	const addressHex = normalized.padStart(40, '0').slice(-40)
	return normalizeAddress(addressHex)
}

const parseCallTargetAddress = (step: Record<string, unknown>): string | undefined => {
	const op = parseOpValue(step['op'])
	if (op !== 'CALL' && op !== 'CALLCODE' && op !== 'DELEGATECALL' && op !== 'STATICCALL') return undefined
	const stack = step['stack']
	if (!Array.isArray(stack) || stack.length < 2) return undefined
	return parseStackAddress(stack[stack.length - 2])
}

const resolveTraceSteps = (rawSteps: readonly unknown[]): ResolvedTraceStep[] => {
	const codeAddressByDepth = new Map<number, string>()
	const pendingCodeAddressByDepth = new Map<number, string>()
	const resolvedSteps: ResolvedTraceStep[] = []

	for (const rawStep of rawSteps) {
		if (!isRecord(rawStep)) continue

		const depth = parseDepthValue(rawStep['depth']) ?? 0
		for (const mappedDepth of [...codeAddressByDepth.keys()]) {
			if (mappedDepth > depth) codeAddressByDepth.delete(mappedDepth)
		}
		for (const mappedDepth of [...pendingCodeAddressByDepth.keys()]) {
			if (mappedDepth > depth) pendingCodeAddressByDepth.delete(mappedDepth)
		}

		const pendingCodeAddress = pendingCodeAddressByDepth.get(depth)
		if (pendingCodeAddress !== undefined) {
			codeAddressByDepth.set(depth, pendingCodeAddress)
			pendingCodeAddressByDepth.delete(depth)
		}

		const stepAddress = traceStepAddress(rawStep)
		if (stepAddress !== undefined && !codeAddressByDepth.has(depth)) codeAddressByDepth.set(depth, stepAddress)
		const codeAddress = codeAddressByDepth.get(depth) ?? stepAddress
		resolvedSteps.push({
			rawStep,
			...(stepAddress === undefined ? {} : { stepAddress }),
			...(codeAddress === undefined ? {} : { codeAddress }),
		})

		const callTargetAddress = parseCallTargetAddress(rawStep)
		if (callTargetAddress !== undefined) pendingCodeAddressByDepth.set(depth + 1, callTargetAddress)
	}

	return resolvedSteps
}

const collectProfilesForAddresses = async (addresses: readonly string[], request: RpcRequest, profileByBytecode: CoverageProfileMap, addressProfileCache: Map<string, CachedAddressProfiles>): Promise<Map<string, CoverageProfile[]>> => {
	const result: Map<string, CoverageProfile[]> = new Map()
	const addressesNeedingCode: string[] = []
	for (const address of addresses) {
		const cachedProfiles = addressProfileCache.get(address)
		if (cachedProfiles?.profiles !== undefined && cachedProfiles.profiles.length > 0) {
			result.set(address, cachedProfiles.profiles)
			continue
		}
		addressesNeedingCode.push(address)
	}

	const onChainCodeByAddress = await Promise.all(
		addressesNeedingCode.map(async address => ({
			address,
			onChainCode: await request({ method: 'eth_getCode', params: [address, 'latest'] }),
		})),
	)
	for (const { address, onChainCode } of onChainCodeByAddress) {
		if (typeof onChainCode !== 'string') {
			addressProfileCache.set(address, { normalizedCode: '', profiles: undefined })
			continue
		}
		const normalizedCode = normalizeBytecode(onChainCode)
		const existingProfiles = addressProfileCache.get(address)
		if (existingProfiles !== undefined && existingProfiles.normalizedCode === normalizedCode) {
			if (existingProfiles.profiles !== undefined && existingProfiles.profiles.length > 0) result.set(address, existingProfiles.profiles)
			continue
		}
		const matchedProfiles = findCompatibleProfilesForBytecode(profileByBytecode, normalizedCode)
		addressProfileCache.set(address, { normalizedCode, profiles: matchedProfiles })
		if (matchedProfiles !== undefined && matchedProfiles.length > 0) result.set(address, matchedProfiles)
	}
	return result
}

const segmentCoverageKey = (segment: ParsedSourceMapSegment): string => `${segment.sourceIndex}:${segment.sourceOffset}:${segment.sourceLength}`

const getSegmentCoverageLines = async (profile: CoverageProfile, segment: ParsedSourceMapSegment, rootPath: string): Promise<SegmentCoverageLines | undefined> => {
	let segmentCoverageLinesByKey = segmentCoverageLinesByProfile.get(profile)
	if (segmentCoverageLinesByKey === undefined) {
		segmentCoverageLinesByKey = new Map()
		segmentCoverageLinesByProfile.set(profile, segmentCoverageLinesByKey)
	}

	const cacheKey = segmentCoverageKey(segment)
	if (segmentCoverageLinesByKey.has(cacheKey)) return segmentCoverageLinesByKey.get(cacheKey)

	const sourcePath = profile.sourceFileNames[segment.sourceIndex]
	if (sourcePath === undefined) {
		segmentCoverageLinesByKey.set(cacheKey, undefined)
		return undefined
	}

	const sourceFile = await readSourceFileBySourcePath(rootPath, sourcePath)
	if (sourceFile === undefined) {
		segmentCoverageLinesByKey.set(cacheKey, undefined)
		return undefined
	}

	const { startLine, endLine } = lineRangeFromSourceOffset(sourceFile.sourceCode.length, sourceFile.lineStartOffsets, segment.sourceOffset, segment.sourceLength)
	if (startLine <= 0 || endLine <= 0) {
		segmentCoverageLinesByKey.set(cacheKey, undefined)
		return undefined
	}
	const lineNumbers: number[] = []
	for (let line = startLine; line <= endLine; line++) {
		if (sourceFile.coverableLines[line - 1] !== true) continue
		lineNumbers.push(line)
	}
	const segmentCoverageLines = { absoluteSourcePath: sourceFile.absoluteSourcePath, lineNumbers }
	segmentCoverageLinesByKey.set(cacheKey, segmentCoverageLines)
	return segmentCoverageLines
}

const recordLineHitsForProfileSegment = async (profile: CoverageProfile, segment: ParsedSourceMapSegment, hitCount: number, rootPath: string, lineCoverage: Map<string, Map<number, number>>): Promise<void> => {
	const segmentCoverageLines = await getSegmentCoverageLines(profile, segment, rootPath)
	if (segmentCoverageLines === undefined || segmentCoverageLines.lineNumbers.length === 0) return

	let fileCoverage = lineCoverage.get(segmentCoverageLines.absoluteSourcePath)
	if (fileCoverage === undefined) {
		fileCoverage = new Map()
		lineCoverage.set(segmentCoverageLines.absoluteSourcePath, fileCoverage)
	}

	for (const line of segmentCoverageLines.lineNumbers) {
		fileCoverage.set(line, (fileCoverage.get(line) ?? 0) + hitCount)
	}
}

const initializeCoverageLinesForProfileSegment = async (profile: CoverageProfile, segment: ParsedSourceMapSegment, rootPath: string, lineCoverage: Map<string, Map<number, number>>): Promise<void> => {
	const segmentCoverageLines = await getSegmentCoverageLines(profile, segment, rootPath)
	if (segmentCoverageLines === undefined || segmentCoverageLines.lineNumbers.length === 0) return

	let fileCoverage = lineCoverage.get(segmentCoverageLines.absoluteSourcePath)
	if (fileCoverage === undefined) {
		fileCoverage = new Map()
		lineCoverage.set(segmentCoverageLines.absoluteSourcePath, fileCoverage)
	}

	for (const line of segmentCoverageLines.lineNumbers) {
		if (!fileCoverage.has(line)) fileCoverage.set(line, 0)
	}
}

const initializeCoverageLines = async (profileMaps: CoverageProfileMaps, rootPath: string): Promise<void> => {
	const initializedProfiles = new Set<CoverageProfile>()
	for (const profileByBytecode of [profileMaps.creation, profileMaps.deployed]) {
		for (const profiles of profileByBytecode.values()) {
			for (const profile of profiles) {
				if (initializedProfiles.has(profile)) continue
				initializedProfiles.add(profile)
				const initializedSegments = new Set<string>()
				for (const segment of profile.pcToSource.values()) {
					if (segment === undefined) continue
					const key = segmentCoverageKey(segment)
					if (initializedSegments.has(key)) continue
					initializedSegments.add(key)
					await initializeCoverageLinesForProfileSegment(profile, segment, rootPath, lineCoverage)
				}
			}
		}
	}
}

let profileMapsPromise: Promise<CoverageProfileMaps> | undefined
const lineCoverage: Map<string, Map<number, number>> = new Map()
const addressProfileCache: Map<string, CachedAddressProfiles> = new Map()
let coverageLinesInitialized = false
let coverageRevision = 0
let writtenCoverageRevision = 0
let activeCoverageWritePromise: Promise<void> | undefined
let scheduledCoverageWrite: ReturnType<typeof setTimeout> | undefined
if (isSolidityBytecodeCoverageEnabled()) {
	process.once('beforeExit', () => {
		void flushSolidityBytecodeCoverageForTest()
	})
}

const writeCoverage = async (): Promise<void> => {
	if (activeCoverageWritePromise !== undefined) return activeCoverageWritePromise
	if (writtenCoverageRevision === coverageRevision) return
	const revisionToWrite = coverageRevision
	activeCoverageWritePromise = (async () => {
		try {
			const config = getSolidityBytecodeCoverageConfig()
			await writeCoverageArtifacts(lineCoverage, config)
			writtenCoverageRevision = Math.max(writtenCoverageRevision, revisionToWrite)
		} finally {
			activeCoverageWritePromise = undefined
		}
	})()
	return activeCoverageWritePromise
}

const scheduleCoverageWrite = (): void => {
	if (scheduledCoverageWrite !== undefined) clearTimeout(scheduledCoverageWrite)
	scheduledCoverageWrite = setTimeout(() => {
		scheduledCoverageWrite = undefined
		void flushSolidityBytecodeCoverageForTest()
	}, 250)
}

export const flushSolidityBytecodeCoverageForTest = async (): Promise<void> => {
	if (scheduledCoverageWrite !== undefined) {
		clearTimeout(scheduledCoverageWrite)
		scheduledCoverageWrite = undefined
	}
	while (activeCoverageWritePromise !== undefined || writtenCoverageRevision !== coverageRevision) {
		const activeWrite = activeCoverageWritePromise
		if (activeWrite !== undefined) {
			await activeWrite
			continue
		}
		await writeCoverage()
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
			params: [transactionHash, { disableStack: false, disableMemory: true, disableStorage: true }],
		})
		return parseTraceSteps(trace)
	} catch (error) {
		if (!isIgnorableTraceRequestError(error)) throw error
		return []
	}
}

const requestTraceCall = async (request: RpcRequest, transaction: RpcTransactionRequest): Promise<unknown[]> => {
	try {
		const trace = await request({
			method: 'debug_traceCall',
			params: [transaction, 'latest', { disableStack: false, disableMemory: true, disableStorage: true }],
		})
		return parseTraceSteps(trace)
	} catch (error) {
		if (!isIgnorableTraceRequestError(error)) throw error
		return []
	}
}

export const resetSolidityBytecodeCoverageAddressCache = (): void => {
	addressProfileCache.clear()
}

export const invalidateSolidityBytecodeCoverageAddressCache = (address: string): void => {
	addressProfileCache.delete(normalizeAddress(address))
}

const collectBytecodeCoverageForTrace = async (options: { readonly request: RpcRequest; readonly transaction: RpcTransactionRequest; readonly structLogs: readonly unknown[]; readonly receipt?: RpcTransactionReceiptData }): Promise<void> => {
	if (!isSolidityBytecodeCoverageEnabled()) return
	if (options.structLogs.length === 0) return

	const config = getSolidityBytecodeCoverageConfig()
	if (profileMapsPromise === undefined) profileMapsPromise = collectProfilesByBytecode(config.artifactsPath)
	const profileMaps = await profileMapsPromise
	if (profileMaps.creation.size === 0 && profileMaps.deployed.size === 0) return
	if (!coverageLinesInitialized) {
		coverageLinesInitialized = true
		await initializeCoverageLines(profileMaps, config.rootPath)
	}

	const txToAddresses = toAddressList(options.transaction.to)
	const receiptToAddresses = toAddressList(options.receipt?.to)
	const receiptContractAddresses = toAddressList(options.receipt?.contractAddress)
	for (const contractAddress of receiptContractAddresses) invalidateSolidityBytecodeCoverageAddressCache(contractAddress)
	const resolvedSteps = resolveTraceSteps(options.structLogs)
	const addresses = new Set([...txToAddresses, ...receiptToAddresses, ...receiptContractAddresses])
	for (const step of resolvedSteps) {
		if (step.stepAddress !== undefined) addresses.add(step.stepAddress)
		if (step.codeAddress !== undefined) addresses.add(step.codeAddress)
	}

	const profilesByAddress = await collectProfilesForAddresses([...addresses], options.request, profileMaps.deployed, addressProfileCache)
	const creationCode = options.transaction.data === undefined ? undefined : normalizeBytecode(options.transaction.data)
	const creationProfiles = creationCode === undefined ? undefined : findProfilesForCreationBytecode(profileMaps.creation, creationCode)
	for (const contractAddress of receiptContractAddresses) {
		if (creationProfiles !== undefined && creationProfiles.length > 0) profilesByAddress.set(contractAddress, creationProfiles)
	}
	const fallbackProfiles = new Set<CoverageProfile>()
	for (const profileSet of profilesByAddress.values()) for (const profile of profileSet) fallbackProfiles.add(profile)
	const fallbackProfileList = fallbackProfiles.size > 0 ? [...fallbackProfiles] : undefined
	const segmentHitCountsByProfile = new Map<CoverageProfile, Map<string, { segment: ParsedSourceMapSegment; hitCount: number }>>()

	for (const { rawStep, stepAddress, codeAddress } of resolvedSteps) {
		const pc = parsePcValue(rawStep['pc'])
		if (pc === undefined) continue

		const codeAddressProfileSet = codeAddress === undefined ? undefined : profilesByAddress.get(codeAddress)
		const stepAddressProfileSet = stepAddress === undefined ? undefined : profilesByAddress.get(stepAddress)
		const activeProfiles = codeAddressProfileSet ?? stepAddressProfileSet ?? fallbackProfileList
		if (activeProfiles === undefined) continue

		for (const profile of activeProfiles) {
			const segment = profile.pcToSource.get(pc)
			if (segment === undefined) continue
			const segmentHits = segmentHitCountsByProfile.get(profile) ?? new Map<string, { segment: ParsedSourceMapSegment; hitCount: number }>()
			const key = segmentCoverageKey(segment)
			const existing = segmentHits.get(key)
			segmentHits.set(key, { segment, hitCount: (existing?.hitCount ?? 0) + 1 })
			if (existing === undefined) segmentHitCountsByProfile.set(profile, segmentHits)
		}
	}

	for (const [profile, segmentHitCounts] of segmentHitCountsByProfile.entries()) {
		for (const { segment, hitCount } of segmentHitCounts.values()) {
			await recordLineHitsForProfileSegment(profile, segment, hitCount, config.rootPath, lineCoverage)
		}
	}
	if (segmentHitCountsByProfile.size > 0) coverageRevision++
	if (segmentHitCountsByProfile.size > 0) scheduleCoverageWrite()
}

export const collectBytecodeCoverageForTransaction = async (options: { readonly request: RpcRequest; readonly transactionHash: string; readonly transaction: RpcTransactionRequest; readonly receipt?: RpcTransactionReceiptData }): Promise<void> => {
	const structLogs = await requestTrace(options.request, options.transactionHash)
	await collectBytecodeCoverageForTrace({ ...options, structLogs })
}

export const collectBytecodeCoverageForCall = async (options: { readonly request: RpcRequest; readonly transaction: RpcTransactionRequest }): Promise<void> => {
	const structLogs = await requestTraceCall(options.request, options.transaction)
	await collectBytecodeCoverageForTrace({ ...options, structLogs })
}
