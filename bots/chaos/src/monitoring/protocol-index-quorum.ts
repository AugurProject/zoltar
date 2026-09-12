import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { updateProtocolIndex, type UpdateProtocolIndexContext } from './protocol-index.ts'

export async function updateProtocolIndexWithQuorum(context: Omit<UpdateProtocolIndexContext, 'client'>, readers: readonly { client: UpdateProtocolIndexContext['client']; endpoint: string }[], requirement: RpcQuorumRequirement) {
	const label = `protocol event index through ${context.anchorBlockNumber.toString()}`
	const attempts = readers.map(async reader => ({ ...reader, value: await updateProtocolIndex({ ...context, client: reader.client }) }))
	const available = availableSettledValues(await Promise.allSettled(attempts))
	if (available.length < requirement) return await settledQuorumValue(label, attempts, requirement)
	const floor = (candidate: (typeof available)[number]) => BigInt(candidate.value.index.availableStartBlock ?? candidate.value.index.startBlock)
	const ordered = [...available].sort((left, right) => {
		if (floor(left) === floor(right)) return 0
		return floor(left) < floor(right) ? -1 : 1
	})
	const oldestQuorum = ordered[requirement - 1]
	if (oldestQuorum === undefined) throw new Error('Protocol log coverage requires a positive RPC quorum')
	const availableStartBlock = floor(oldestQuorum)
	// Prefer full history whenever enough readers retain it. Otherwise compare
	// the oldest common suffix, without weakening the configured read quorum.
	const eligible = available.filter(candidate => floor(candidate) <= availableStartBlock)
	return await settledQuorumValue(
		label,
		eligible.map(async candidate => {
			if (floor(candidate) === availableStartBlock) return candidate
			const { previous, ...fresh } = context
			const resume = previous !== undefined && BigInt(previous.availableStartBlock ?? previous.startBlock) === availableStartBlock
			return { endpoint: candidate.endpoint, value: await updateProtocolIndex({ ...fresh, ...(resume ? { previous } : {}), availableStartBlock, client: candidate.client }) }
		}),
		requirement,
	)
}
