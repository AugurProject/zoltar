export const securityPoolAddress = 'Security pool address'
export const shareTokenAddress = 'Share token address'
export const currentUniverseId = 'Current universe ID'
export const marketLineageOriginUniverseId = 'Market lineage origin universe ID'
export const questionId = 'Question ID'
export const outcomeTokenIds = 'Outcome token IDs'
export const unavailableOriginUniverse = 'Unavailable'
export const invalid = 'INVALID'
export const yes = 'YES'
export const no = 'NO'

export function outcomeTokenIdSummary(invalidTokenId: string, yesTokenId: string, noTokenId: string) {
	return `${invalid} ${invalidTokenId} · ${yes} ${yesTokenId} · ${no} ${noTokenId}`
}
