import { questionId, securityPoolAddress, unavailable } from '@zoltar/ui-core-shared/copy/common.js'
import { invalid, no, yes } from './outcomes.js'

const shareTokenAddress = 'Share token address'
const currentUniverseId = 'Current universe ID'
const originUniverseId = 'Origin universe ID'
const outcomeTokenIds = 'Outcome token IDs'

function outcomeTokenIdSummary(yesTokenId: string, noTokenId: string, invalidTokenId: string) {
	return `${yes} ${yesTokenId} · ${no} ${noTokenId} · ${invalid} ${invalidTokenId}`
}

export const identityCopy = { securityPoolAddress, shareTokenAddress, currentUniverseId, originUniverseId, questionId, outcomeTokenIds, unavailable, outcomeTokenIdSummary } as const
