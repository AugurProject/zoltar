import { getChildUniverseId } from '@zoltar/bot-shared/protocol/universe-id'

export function assertDeterministicChildUniverseId(universeId: bigint, outcomeIndex: bigint, childUniverseId: bigint) {
	if (getChildUniverseId(universeId, outcomeIndex) !== childUniverseId) throw new Error('DeployChild event has a mismatched deterministic child universe ID')
}
