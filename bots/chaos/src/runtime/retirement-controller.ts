import { getAddress } from '@zoltar/bot-shared/ethereum'
import { recordActivity, type RuntimeState } from '../state/operator-state.ts'
import { acceptResidualProfileReplacement, cancelRetirement, registerV3Position, requestRetirement, parseRetirementPolicies } from '../state/retirement.ts'
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
				exactKeys(body, ['action', 'confirmation', 'policies', 'profileId'], 'Retirement update')
				if (body['profileId'] !== options.state.profileId) throw new Error('Retirement deployment profile does not match the active durable profile')
				const policies = parseRetirementPolicies(body['policies'])
				if (options.state.signerAddress === undefined) throw new Error('Retirement requires a bound signer')
				requestRetirement(candidateState.retirement, options.state.profileId, options.state.signerAddress, policies, String(body['confirmation']), options.state.signerAddress)
				recordActivity(candidateState, { message: `Drain & Retire requested for ${options.state.profileId}`, status: 'info', type: 'configuration' })
			} else if (action === 'cancel') {
				exactKeys(body, ['action', 'confirmation'], 'Retirement update')
				cancelRetirement(candidateState.retirement, String(body['confirmation']))
				recordActivity(candidateState, { message: 'Drain & Retire request cancelled before final sweeping', status: 'info', type: 'configuration' })
			} else if (action === 'accept-residuals') {
				exactKeys(body, ['action', 'confirmation', 'evidence', 'reason', 'targetProfileId'], 'Retirement update')
				const current = candidateState.retirement.completionEvidence
				const reviewed = record(body['evidence'], 'Reviewed completion evidence')
				if (
					current === undefined ||
					reviewed['blockHash'] !== current.blockHash ||
					reviewed['blockNumber'] !== current.blockNumber ||
					!Array.isArray(reviewed['residuals']) ||
					reviewed['residuals'].length !== current.residuals.length ||
					!reviewed['residuals'].every((item, index) => {
						const residual = record(item, 'Reviewed residual')
						const actual = current.residuals[index]
						return actual !== undefined && actual.amount === residual['amount'] && actual.asset === residual['asset'] && actual.category === residual['category'] && actual.reason === residual['reason']
					})
				)
					throw new Error('Completion evidence changed. Review the current residuals before accepting.')
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
