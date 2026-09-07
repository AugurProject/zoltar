const securityPoolAddress = 'Security pool address'
const shareTokenAddress = 'Share token address'
const currentUniverseId = 'Current universe ID'
const marketLineageOriginUniverseId = 'Market lineage origin universe ID'
const questionId = 'Question ID'
const outcomeTokenIds = 'Outcome token IDs'
const unavailableOriginUniverse = 'Unavailable'
const invalid = 'INVALID'
const yes = 'YES'
const no = 'NO'

function outcomeTokenIdSummary(invalidTokenId: string, yesTokenId: string, noTokenId: string) {
	return `${invalid} ${invalidTokenId} · ${yes} ${yesTokenId} · ${no} ${noTokenId}`
}

export const identityCopy = { securityPoolAddress, shareTokenAddress, currentUniverseId, marketLineageOriginUniverseId, questionId, outcomeTokenIds, unavailableOriginUniverse, outcomeTokenIdSummary } as const
