import { createWalletClient, privateKeyToAccount, type Address } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import type { ExecutionEnvironment } from '../execution/execution-context.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import { chaosChain } from './canonical-scan.ts'
import { assertSubmissionPreflightFresh, type SubmissionPreflightResources } from './submission-preflight.ts'

export function executionEnvironment(
	settings: OperatorSettings,
	state: RuntimeState,
	resources: Pick<SubmissionPreflightResources, 'submissionPreflightChecks'> & { pool: ExecutionEnvironment['pool'] },
	recoverySender?: Address | undefined,
	refreshSubmissionPreflight?: (() => Promise<void>) | undefined,
	executionCancelled?: (() => boolean) | undefined,
): ExecutionEnvironment {
	const account = settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey)
	const sender = recoverySender ?? account?.address
	if (sender === undefined) throw new Error('Transaction execution requires the configured signer')
	if (account !== undefined && account.address.toLowerCase() !== sender.toLowerCase()) {
		throw new Error('The configured signer does not match the pending transaction recovery signer')
	}
	return {
		assertSubmissionReady: () => assertSubmissionPreflightFresh(resources.submissionPreflightChecks, settings),
		...(refreshSubmissionPreflight === undefined ? {} : { beforeBroadcast: refreshSubmissionPreflight, beforeSign: refreshSubmissionPreflight }),
		chain: chaosChain(settings),
		...(executionCancelled === undefined ? {} : { executionCancelled }),
		pool: resources.pool,
		sender,
		settings,
		state,
		...(account === undefined
			? {}
			: {
					wallet: createWalletClient({
						account,
						chain: chaosChain(settings),
						transport: resources.pool.transport,
					}),
				}),
	}
}
