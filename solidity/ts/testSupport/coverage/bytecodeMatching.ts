import { normalizeBytecode, type ParsedSourceMapSegment } from './sourceMapParser'

export interface CoverageProfile {
	readonly sourceFileNames: ReadonlyArray<string | undefined>
	readonly pcToSource: ReadonlyMap<number, ParsedSourceMapSegment | undefined>
	readonly mutableRanges: readonly BytecodeRange[]
}

export type BytecodeRange = { readonly start: number; readonly length: number }

export type CoverageProfileMap = Map<string, CoverageProfile[]>

export const maskBytecodeRanges = (bytecode: string, ranges: readonly BytecodeRange[]): string => {
	const characters = bytecode.split('')
	for (const range of ranges) {
		const start = range.start * 2
		const end = Math.min(characters.length, start + range.length * 2)
		for (let index = start; index < end; index++) characters[index] = '0'
	}
	return characters.join('')
}

export const isCoverageBytecodeCompatible = (artifactBytecode: string, runtimeBytecode: string, mutableRanges: readonly BytecodeRange[]): boolean => {
	const normalizedArtifact = normalizeBytecode(artifactBytecode)
	const normalizedRuntime = normalizeBytecode(runtimeBytecode)
	if (normalizedArtifact.length !== normalizedRuntime.length) return false
	return maskBytecodeRanges(normalizedArtifact, mutableRanges) === maskBytecodeRanges(normalizedRuntime, mutableRanges)
}

const sameSegment = (first: ParsedSourceMapSegment | undefined, second: ParsedSourceMapSegment | undefined): boolean =>
	first === second || (first !== undefined && second !== undefined && first.sourceIndex === second.sourceIndex && first.sourceOffset === second.sourceOffset && first.sourceLength === second.sourceLength && first.jumpType === second.jumpType && first.modifierDepth === second.modifierDepth)

const equivalentProfileSets = (first: readonly CoverageProfile[], second: readonly CoverageProfile[]): boolean => {
	if (first.length !== second.length) return false
	return first.every((profile, index) => {
		const comparison = second[index]
		if (comparison === undefined || profile.sourceFileNames.length !== comparison.sourceFileNames.length || profile.pcToSource.size !== comparison.pcToSource.size) return false
		if (profile.sourceFileNames.some((sourceName, sourceIndex) => sourceName !== comparison.sourceFileNames[sourceIndex])) return false
		for (const [pc, segment] of profile.pcToSource) if (!sameSegment(segment, comparison.pcToSource.get(pc))) return false
		return true
	})
}

const selectUnambiguousProfiles = (matches: readonly CoverageProfile[][]): CoverageProfile[] | undefined => {
	const first = matches[0]
	if (first === undefined) return undefined
	return matches.every(profiles => equivalentProfileSets(first, profiles)) ? first : undefined
}

export const findCompatibleProfilesForBytecode = (profileByBytecode: CoverageProfileMap, normalizedCode: string): CoverageProfile[] | undefined => {
	const exactProfiles = profileByBytecode.get(normalizedCode)
	if (exactProfiles !== undefined) return exactProfiles

	const matches: CoverageProfile[][] = []
	for (const [artifactBytecode, profiles] of profileByBytecode.entries()) {
		if (artifactBytecode.length !== normalizedCode.length) continue
		if (
			isCoverageBytecodeCompatible(
				artifactBytecode,
				normalizedCode,
				profiles.flatMap(profile => profile.mutableRanges),
			)
		)
			matches.push(profiles)
	}
	return selectUnambiguousProfiles(matches)
}

export const findProfilesForCreationBytecode = (profileByBytecode: CoverageProfileMap, normalizedCreationCode: string): CoverageProfile[] | undefined => {
	const exactProfiles = profileByBytecode.get(normalizedCreationCode)
	if (exactProfiles !== undefined) return exactProfiles

	let bestBytecodeLength = 0
	const matches: CoverageProfile[][] = []
	for (const [artifactBytecode, profiles] of profileByBytecode.entries()) {
		if (artifactBytecode.length < bestBytecodeLength || artifactBytecode.length > normalizedCreationCode.length) continue
		const creationPrefix = normalizedCreationCode.slice(0, artifactBytecode.length)
		if (
			!isCoverageBytecodeCompatible(
				artifactBytecode,
				creationPrefix,
				profiles.flatMap(profile => profile.mutableRanges),
			)
		)
			continue
		if (artifactBytecode.length > bestBytecodeLength) {
			bestBytecodeLength = artifactBytecode.length
			matches.length = 0
		}
		matches.push(profiles)
	}
	return selectUnambiguousProfiles(matches)
}

const testProfile = (profileId: string, mutableRanges: readonly BytecodeRange[]): CoverageProfile => ({ sourceFileNames: [profileId], pcToSource: new Map(), mutableRanges })

export const resolveCoverageBytecodeCandidateForTest = (candidates: readonly { readonly artifactBytecode: string; readonly mutableRanges: readonly BytecodeRange[]; readonly profileId: string }[], runtimeBytecode: string): string | undefined => {
	const profilesByBytecode: CoverageProfileMap = new Map()
	for (const candidate of candidates) profilesByBytecode.set(normalizeBytecode(candidate.artifactBytecode), [testProfile(candidate.profileId, candidate.mutableRanges)])
	return findCompatibleProfilesForBytecode(profilesByBytecode, normalizeBytecode(runtimeBytecode))?.[0]?.sourceFileNames[0]
}

export const resolveCoverageCreationCandidateForTest = (candidates: readonly { readonly artifactBytecode: string; readonly mutableRanges: readonly BytecodeRange[]; readonly profileId: string }[], creationBytecodeWithArguments: string): string | undefined => {
	const profilesByBytecode: CoverageProfileMap = new Map()
	for (const candidate of candidates) profilesByBytecode.set(normalizeBytecode(candidate.artifactBytecode), [testProfile(candidate.profileId, candidate.mutableRanges)])
	return findProfilesForCreationBytecode(profilesByBytecode, normalizeBytecode(creationBytecodeWithArguments))?.[0]?.sourceFileNames[0]
}
