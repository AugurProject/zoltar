import { getAddress } from '@zoltar/bot-shared/ethereum'
import { recordActivity, type RuntimeState } from '../state/operator-state.ts'
import { acceptResidualProfileReplacement, cancelRetirement, registerV3Position, requestRetirement, type RetirementPolicies } from '../state/retirement.ts'
import { dashboardRecord as record, exactDashboardKeys as exactKeys } from './dashboard-input.ts'

type RetirementControllerOptions = {
	persist: (state: RuntimeState) => Promise<void>
	state: RuntimeState
	update: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createRetirementController(options: RetirementControllerOptions) {
	return async (value: unknown) => {
		await options.update(async () => {
			const body = record(value, 'Retirement update')
			const action = body['action']
			const candidateState: RuntimeState = { ...options.state, activities: [...options.state.activities], retirement: structuredClone(options.state.retirement) }
			if (action === 'request') {
				exactKeys(body, ['action', 'confirmation', 'policies', 'profileId', 'recipient'], 'Retirement update')
				if (body['profileId'] !== options.state.profileId) throw new Error('Retirement deployment profile does not match the active durable profile')
				const rawPolicies = record(body['policies'], 'Retirement policies')
				exactKeys(rawPolicies, ['exitAfterCompletion', 'exitUnmatchedShares', 'maximumExitLossBps', 'migrateExistingClaims', 'sweepAssets', 'unwrapWeth'], 'Retirement policies')
				const policies: RetirementPolicies = {
					exitAfterCompletion: rawPolicies['exitAfterCompletion'] === true,
					exitUnmatchedShares: rawPolicies['exitUnmatchedShares'] === true,
					maximumExitLossBps: typeof rawPolicies['maximumExitLossBps'] === 'number' ? rawPolicies['maximumExitLossBps'] : -1,
					migrateExistingClaims: rawPolicies['migrateExistingClaims'] === true,
					sweepAssets: rawPolicies['sweepAssets'] === true,
					unwrapWeth: rawPolicies['unwrapWeth'] === true,
				}
				if (!Number.isSafeInteger(policies.maximumExitLossBps) || policies.maximumExitLossBps < 0 || policies.maximumExitLossBps > 10_000) throw new Error('maximumExitLossBps must be an integer from 0 through 10000')
				requestRetirement(candidateState.retirement, options.state.profileId, getAddress(String(body['recipient'])), policies, String(body['confirmation']), options.state.signerAddress)
				recordActivity(candidateState, { message: `Drain & Retire requested for ${options.state.profileId}`, status: 'info', type: 'configuration' })
			} else if (action === 'cancel') {
				exactKeys(body, ['action', 'confirmation'], 'Retirement update')
				cancelRetirement(candidateState.retirement, String(body['confirmation']))
				recordActivity(candidateState, { message: 'Drain & Retire request cancelled before final sweeping', status: 'info', type: 'configuration' })
			} else if (action === 'accept-residuals') {
				exactKeys(body, ['action', 'confirmation', 'reason', 'targetProfileId'], 'Retirement update')
				acceptResidualProfileReplacement(candidateState.retirement, options.state.profileId, String(body['targetProfileId']), String(body['reason']), String(body['confirmation']))
				recordActivity(candidateState, { details: String(body['reason']), message: `Residual profile replacement accepted for ${String(body['targetProfileId'])}`, status: 'info', type: 'configuration' })
			} else if (action === 'register-v3-position') {
				exactKeys(body, ['action', 'confirmation', 'fee', 'owner', 'pool', 'profileId', 'tickLower', 'tickUpper', 'token0', 'token1', 'workflowId'], 'Retirement update')
				if (body['profileId'] !== options.state.profileId || body['confirmation'] !== `REGISTER V3 ${options.state.profileId}`) throw new Error(`Confirmation must exactly match REGISTER V3 ${options.state.profileId}`)
				const owner = getAddress(String(body['owner']))
				if (options.state.signerAddress === undefined || owner.toLowerCase() !== options.state.signerAddress.toLowerCase()) throw new Error('Registered V3 owner must be the durable signer')
				const integer = (field: 'fee' | 'tickLower' | 'tickUpper') => {
					const candidate = body[field]
					if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate)) throw new Error(`${field} must be an integer`)
					return candidate
				}
				registerV3Position(candidateState.retirement, {
					creationWorkflowId: String(body['workflowId']),
					fee: integer('fee'),
					owner,
					pool: getAddress(String(body['pool'])),
					profileId: options.state.profileId,
					tickLower: integer('tickLower'),
					tickUpper: integer('tickUpper'),
					token0: getAddress(String(body['token0'])),
					token1: getAddress(String(body['token1'])),
				})
				recordActivity(candidateState, { message: 'Verified legacy Uniswap V3 position registered for canonical confirmation', status: 'info', type: 'configuration' })
			} else {
				throw new Error('Retirement action must be request, cancel, accept-residuals, or register-v3-position')
			}
			await options.persist(candidateState)
			options.state.retirement = candidateState.retirement
			options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
		})
	}
}
