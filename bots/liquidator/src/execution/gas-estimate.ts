import type { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { availableSettledValues } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { simulateWithRevalidation } from './simulation.ts'

type Reader = { endpoint: string; client: Pick<ReturnType<typeof createPublicClient>, 'estimateGas'> }

/** Quote and estimate only; real-funds simulation and signing never use this balance. */
export const PREFLIGHT_BALANCE = 1n << 128n // Leave ample uint256 headroom for incoming reward credits.

/** @internal Gas integration tests verify the complete signed ceiling.
 * Reserve for a fee checkpoint becoming nonempty between estimation and mining.
 * The native capital gas regression bounds a cold checkpoint below 3M gas.
 * This is included in signing and the spend ceiling, not an extra payment.
 */
export const PORTFOLIO_CHECKPOINT_GAS_RESERVE = 3_000_000n

/** Clients may use different estimation heuristics: require a successful quorum, then use its largest estimate. */
export async function estimateExecutionGas(readers: readonly Reader[], request: Parameters<Reader['client']['estimateGas']>[0], requirement: RpcQuorumRequirement, validateCanonicalBlock: () => Promise<void>, revalidateRevert?: () => Promise<unknown>) {
	const observations = readers.map(async ({ endpoint, client }) => {
		const value = await client.estimateGas(request)
		if (value <= 0n) throw new Error('RPC gas estimate must be positive')
		return { endpoint, value }
	})
	await simulateWithRevalidation(
		'transaction gas estimate',
		observations.map(async observation => ({ endpoint: (await observation).endpoint, value: true })),
		requirement,
		revalidateRevert,
	)
	await validateCanonicalBlock()
	const available = availableSettledValues(await Promise.allSettled(observations))
	return available.reduce((maximum, observation) => (observation.value > maximum ? observation.value : maximum), 0n) + PORTFOLIO_CHECKPOINT_GAS_RESERVE
}
