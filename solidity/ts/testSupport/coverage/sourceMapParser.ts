const PUSH_OPCODE_START = 0x60
const PUSH_OPCODE_END = 0x7f

export interface ParsedSourceMapSegment {
	readonly sourceOffset: number
	readonly sourceLength: number
	readonly sourceIndex: number
	readonly jumpType: string
	readonly modifierDepth: number
}

const parseSourceMapField = (value: string): number | undefined => {
	if (value === '-' || value === '') return undefined
	const parsed = Number.parseInt(value, 10)
	return Number.isNaN(parsed) ? undefined : parsed
}

const normalizeHexBytes = (value: string): string => {
	const normalized = value.trim().startsWith('0x') ? value.trim().slice(2) : value.trim()
	if (normalized.length % 2 === 1) throw new Error('Invalid hex string: odd length')
	return normalized
}

const getPushArgumentLength = (opcode: number): number => {
	if (opcode >= PUSH_OPCODE_START && opcode <= PUSH_OPCODE_END) return opcode - PUSH_OPCODE_START + 1
	return 0
}

const parseBytecodeInstructionOffsets = (bytecode: string): readonly number[] => {
	const normalized = normalizeHexBytes(bytecode)
	if (normalized === '') return []

	const bytes = Buffer.from(normalized, 'hex')
	const instructionOffsets: number[] = []
	for (let i = 0; i < bytes.length; i++) {
		const offset = i
		const opcode = bytes[i]
		if (opcode === undefined) break
		instructionOffsets.push(offset)
		i += getPushArgumentLength(opcode)
	}
	return instructionOffsets
}

const parseSourceMap = (sourceMap: string): readonly (ParsedSourceMapSegment | undefined)[] => {
	const segments: (ParsedSourceMapSegment | undefined)[] = []

	let currentSourceOffset: number | undefined
	let currentSourceLength: number | undefined
	let currentSourceIndex: number | undefined
	let currentJumpType = 'i'
	let currentModifierDepth = 0

	for (const rawSegment of sourceMap.split(';')) {
		const parts = rawSegment.split(':')
		const sourceOffset = parseSourceMapField(parts[0] ?? '')
		const sourceLength = parseSourceMapField(parts[1] ?? '')
		const sourceIndex = parseSourceMapField(parts[2] ?? '')
		const jumpType = parts[3] ?? undefined
		const modifierDepth = parseSourceMapField(parts[4] ?? '')

		if (sourceOffset !== undefined) currentSourceOffset = sourceOffset
		if (sourceLength !== undefined) currentSourceLength = sourceLength
		if (sourceIndex !== undefined) currentSourceIndex = sourceIndex
		if (jumpType !== undefined && jumpType !== '') currentJumpType = jumpType
		if (modifierDepth !== undefined) currentModifierDepth = modifierDepth

		if (currentSourceOffset === undefined || currentSourceLength === undefined || currentSourceIndex === undefined) {
			segments.push(undefined)
			continue
		}

		segments.push({
			sourceOffset: currentSourceOffset,
			sourceLength: currentSourceLength,
			sourceIndex: currentSourceIndex,
			jumpType: currentJumpType,
			modifierDepth: currentModifierDepth,
		})
	}

	return segments
}

export const buildPcToSourceMap = (bytecode: string, sourceMap: string): ReadonlyMap<number, ParsedSourceMapSegment | undefined> => {
	const instructionOffsets = parseBytecodeInstructionOffsets(bytecode)
	const segments = parseSourceMap(sourceMap)

	const pcToSource = new Map<number, ParsedSourceMapSegment | undefined>()
	for (let instructionIndex = 0; instructionIndex < instructionOffsets.length; instructionIndex++) {
		const pc = instructionOffsets[instructionIndex]
		if (pc === undefined) continue
		const segment = segments[instructionIndex]
		pcToSource.set(pc, segment)
	}

	// Keep source-map state in sync with all instructions when an explicit source-map entry is shorter than instruction count.
	const lastSegment = segments[segments.length - 1]
	for (let instructionIndex = segments.length; instructionIndex < instructionOffsets.length; instructionIndex++) {
		const pc = instructionOffsets[instructionIndex]
		if (pc === undefined) continue
		if (lastSegment !== undefined) pcToSource.set(pc, lastSegment)
	}

	return pcToSource
}

export const normalizeBytecode = (bytecode: string): string => normalizeHexBytes(bytecode)
