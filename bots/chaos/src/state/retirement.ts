import { getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'

export type RetirementStatus = 'inactive' | 'requested' | 'draining' | 'waiting' | 'blocked' | 'drained' | 'drained-with-residuals'

export type RetirementPolicies = {
	exitAfterCompletion: boolean
	exitUnmatchedShares: boolean
	maximumExitLossBps: number
	migrateExistingClaims: boolean
	sweepAssets: boolean
	unwrapWeth: boolean
}

export type RetirementBlocker = {
	category: 'ambiguous-position' | 'incomplete-discovery' | 'operator-action' | 'temporarily-locked' | 'transaction'
	details: string
	id: string
	nextEligibleAt?: string | undefined
}

export type RetirementResidual = {
	amount: string
	asset: string
	category: 'accepted-dust' | 'deployment-token' | 'irreversible-burn' | 'losing-share' | 'mandatory-sentinel' | 'operator-accepted'
	reason: string
}

export type RetirementCompletionEvidence = {
	blockHash: Hash
	blockNumber: string
	completedAt: string
	proof: {
		actionableObligations: 0
		claimableAssets: 0
		collectableV3Positions: 0
		knownApprovals: 0
		ownedLiquidityPositions: 0
		partialWorkflows: 0
		pendingTransactions: 0
	}
	residuals: RetirementResidual[]
}

export type DurableV3Position = {
	createdAt: string
	creationTransactionHash?: Hex | undefined
	creationWorkflowId: string
	fee: number
	id: string
	lastCheckedAtBlock?: string | undefined
	owner: Address
	pool: Address
	positionKey: Hash
	profileId: string
	registeredBy: 'backfill' | 'operator' | 'workflow'
	status: 'pending-confirmation' | 'active' | 'collect-only' | 'closed' | 'blocked'
	tickLower: number
	tickUpper: number
	token0: Address
	token1: Address
}

export type DurableRetirementState = {
	blockers: RetirementBlocker[]
	cancelledAt?: string | undefined
	completionEvidence?: RetirementCompletionEvidence | undefined
	finalSweepStartedAt?: string | undefined
	lastObservedBalances: Record<string, string>
	positions: DurableV3Position[]
	profileReplacementOverride?: { acceptedAt: string; reason: string; targetProfileId: string } | undefined
	recipient?: Address | undefined
	/** Cumulative balance increases observed between canonical retirement scans. */
	recoveredBalances: Record<string, string>
	requestedAt?: string | undefined
	status: RetirementStatus
	updatedAt?: string | undefined
	policies: RetirementPolicies
}

export const DEFAULT_RETIREMENT_POLICIES: RetirementPolicies = {
	exitAfterCompletion: false,
	exitUnmatchedShares: false,
	maximumExitLossBps: 0,
	migrateExistingClaims: false,
	sweepAssets: true,
	unwrapWeth: true,
}

export function initialRetirementState(): DurableRetirementState {
	return {
		blockers: [],
		lastObservedBalances: {},
		positions: [],
		recoveredBalances: {},
		status: 'inactive',
		policies: { ...DEFAULT_RETIREMENT_POLICIES },
	}
}

export function uniswapV3PositionKey(owner: Address, tickLower: number, tickUpper: number) {
	const packedTick = (tick: number) => (tick < 0 ? 0x1_000_000 + tick : tick).toString(16).padStart(6, '0')
	return keccak256(`0x${owner.slice(2)}${packedTick(tickLower)}${packedTick(tickUpper)}`)
}

function timestamp(value: unknown, label: string) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`)
	return new Date(value).toISOString()
}

function unsigned(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned integer string`)
	return value
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string) {
	const allowed = new Set([...required, ...optional])
	const missing = required.find(key => !(key in value))
	const unexpected = Object.keys(value).find(key => !allowed.has(key))
	if (missing !== undefined) throw new Error(`${label} is missing ${missing}`)
	if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`)
}

function parsePolicies(value: unknown): RetirementPolicies {
	const policies = record(value, 'retirement.policies')
	exactKeys(policies, ['exitAfterCompletion', 'exitUnmatchedShares', 'maximumExitLossBps', 'migrateExistingClaims', 'sweepAssets', 'unwrapWeth'], [], 'retirement.policies')
	for (const key of ['exitAfterCompletion', 'exitUnmatchedShares', 'migrateExistingClaims', 'sweepAssets', 'unwrapWeth'] as const) {
		if (typeof policies[key] !== 'boolean') throw new Error(`retirement.policies.${key} must be a boolean`)
	}
	const maximumExitLossBps = policies['maximumExitLossBps']
	if (typeof maximumExitLossBps !== 'number' || !Number.isSafeInteger(maximumExitLossBps) || maximumExitLossBps < 0 || maximumExitLossBps > 10_000) {
		throw new Error('retirement.policies.maximumExitLossBps must be an integer from 0 through 10000')
	}
	return {
		exitAfterCompletion: policies['exitAfterCompletion'] as boolean,
		exitUnmatchedShares: policies['exitUnmatchedShares'] as boolean,
		maximumExitLossBps,
		migrateExistingClaims: policies['migrateExistingClaims'] as boolean,
		sweepAssets: policies['sweepAssets'] as boolean,
		unwrapWeth: policies['unwrapWeth'] as boolean,
	}
}

function parsePosition(value: unknown, index: number): DurableV3Position {
	const label = `retirement.positions[${index.toString()}]`
	const position = record(value, label)
	exactKeys(position, ['createdAt', 'creationWorkflowId', 'fee', 'id', 'owner', 'pool', 'positionKey', 'profileId', 'registeredBy', 'status', 'tickLower', 'tickUpper', 'token0', 'token1'], ['creationTransactionHash', 'lastCheckedAtBlock'], label)
	const fee = position['fee']
	const tickLower = position['tickLower']
	const tickUpper = position['tickUpper']
	if (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 || fee > 1_000_000) throw new Error(`${label}.fee is invalid`)
	if (typeof tickLower !== 'number' || !Number.isSafeInteger(tickLower) || tickLower < -887_272 || tickLower > 887_272) throw new Error(`${label}.tickLower is invalid`)
	if (typeof tickUpper !== 'number' || !Number.isSafeInteger(tickUpper) || tickUpper < -887_272 || tickUpper > 887_272 || tickUpper <= tickLower) throw new Error(`${label}.tickUpper is invalid`)
	const owner = getAddress(String(position['owner']))
	const positionKey = position['positionKey']
	if (typeof positionKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(positionKey) || uniswapV3PositionKey(owner, tickLower, tickUpper).toLowerCase() !== positionKey.toLowerCase()) {
		throw new Error(`${label}.positionKey does not match its owner and ticks`)
	}
	const registeredBy = position['registeredBy']
	if (registeredBy !== 'backfill' && registeredBy !== 'operator' && registeredBy !== 'workflow') throw new Error(`${label}.registeredBy is invalid`)
	const status = position['status']
	if (status !== 'pending-confirmation' && status !== 'active' && status !== 'collect-only' && status !== 'closed' && status !== 'blocked') throw new Error(`${label}.status is invalid`)
	const text = (key: string) => {
		const candidate = position[key]
		if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 256) throw new Error(`${label}.${key} is invalid`)
		return candidate
	}
	const creationTransactionHash = position['creationTransactionHash']
	if (creationTransactionHash !== undefined && (typeof creationTransactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(creationTransactionHash))) throw new Error(`${label}.creationTransactionHash is invalid`)
	return {
		createdAt: timestamp(position['createdAt'], `${label}.createdAt`),
		...(creationTransactionHash === undefined ? {} : { creationTransactionHash: creationTransactionHash as Hex }),
		creationWorkflowId: text('creationWorkflowId'),
		fee,
		id: text('id'),
		...(position['lastCheckedAtBlock'] === undefined ? {} : { lastCheckedAtBlock: unsigned(position['lastCheckedAtBlock'], `${label}.lastCheckedAtBlock`) }),
		owner,
		pool: getAddress(String(position['pool'])),
		positionKey: positionKey as Hash,
		profileId: text('profileId'),
		registeredBy,
		status,
		tickLower,
		tickUpper,
		token0: getAddress(String(position['token0'])),
		token1: getAddress(String(position['token1'])),
	}
}

function parseCompletionEvidence(value: unknown): RetirementCompletionEvidence {
	const evidence = record(value, 'retirement.completionEvidence')
	exactKeys(evidence, ['blockHash', 'blockNumber', 'completedAt', 'proof', 'residuals'], [], 'retirement.completionEvidence')
	const blockHash = evidence['blockHash']
	if (typeof blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(blockHash)) throw new Error('retirement.completionEvidence.blockHash is invalid')
	const proof = record(evidence['proof'], 'retirement.completionEvidence.proof')
	const proofFields = ['actionableObligations', 'claimableAssets', 'collectableV3Positions', 'knownApprovals', 'ownedLiquidityPositions', 'partialWorkflows', 'pendingTransactions'] as const
	exactKeys(proof, proofFields, [], 'retirement.completionEvidence.proof')
	for (const field of proofFields) {
		if (proof[field] !== 0) throw new Error(`retirement.completionEvidence.proof.${field} must be zero`)
	}
	if (!Array.isArray(evidence['residuals'])) throw new Error('retirement.completionEvidence.residuals must be an array')
	const residuals = evidence['residuals'].map((candidate, index): RetirementResidual => {
		const label = `retirement.completionEvidence.residuals[${index.toString()}]`
		const residual = record(candidate, label)
		exactKeys(residual, ['amount', 'asset', 'category', 'reason'], [], label)
		const category = residual['category']
		if (!['accepted-dust', 'deployment-token', 'irreversible-burn', 'losing-share', 'mandatory-sentinel', 'operator-accepted'].includes(String(category))) throw new Error(`${label}.category is invalid`)
		for (const field of ['asset', 'reason'] as const) {
			if (typeof residual[field] !== 'string' || residual[field].length === 0 || residual[field].length > 2_048) throw new Error(`${label}.${field} is invalid`)
		}
		return { amount: unsigned(residual['amount'], `${label}.amount`), asset: residual['asset'] as string, category: category as RetirementResidual['category'], reason: residual['reason'] as string }
	})
	return {
		blockHash: blockHash as Hash,
		blockNumber: unsigned(evidence['blockNumber'], 'retirement.completionEvidence.blockNumber'),
		completedAt: timestamp(evidence['completedAt'], 'retirement.completionEvidence.completedAt'),
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals,
	}
}

export function parseRetirementState(value: unknown): DurableRetirementState {
	const retirement = record(value, 'retirement')
	exactKeys(retirement, ['blockers', 'policies', 'positions', 'recoveredBalances', 'status'], ['cancelledAt', 'completionEvidence', 'finalSweepStartedAt', 'lastObservedBalances', 'profileReplacementOverride', 'recipient', 'requestedAt', 'updatedAt'], 'retirement')
	const status = retirement['status']
	if (!['inactive', 'requested', 'draining', 'waiting', 'blocked', 'drained', 'drained-with-residuals'].includes(String(status))) throw new Error('retirement.status is invalid')
	if (!Array.isArray(retirement['blockers']) || !Array.isArray(retirement['positions'])) throw new Error('retirement blockers and positions must be arrays')
	const positions = retirement['positions'].map(parsePosition)
	if (new Set(positions.map(position => position.id)).size !== positions.length) throw new Error('retirement.positions contains duplicate IDs')
	const balances = record(retirement['recoveredBalances'], 'retirement.recoveredBalances')
	const recoveredBalances = Object.fromEntries(Object.entries(balances).map(([asset, amount]) => [asset, unsigned(amount, `retirement.recoveredBalances.${asset}`)]))
	const observed = retirement['lastObservedBalances'] === undefined ? {} : record(retirement['lastObservedBalances'], 'retirement.lastObservedBalances')
	const lastObservedBalances = Object.fromEntries(Object.entries(observed).map(([asset, amount]) => [asset, unsigned(amount, `retirement.lastObservedBalances.${asset}`)]))
	const blockers = retirement['blockers'].map((candidate, index): RetirementBlocker => {
		const blocker = record(candidate, `retirement.blockers[${index.toString()}]`)
		exactKeys(blocker, ['category', 'details', 'id'], ['nextEligibleAt'], `retirement.blockers[${index.toString()}]`)
		if (!['ambiguous-position', 'incomplete-discovery', 'operator-action', 'temporarily-locked', 'transaction'].includes(String(blocker['category']))) throw new Error(`retirement.blockers[${index.toString()}].category is invalid`)
		return {
			category: blocker['category'] as RetirementBlocker['category'],
			details: String(blocker['details']),
			id: String(blocker['id']),
			...(blocker['nextEligibleAt'] === undefined ? {} : { nextEligibleAt: timestamp(blocker['nextEligibleAt'], `retirement.blockers[${index.toString()}].nextEligibleAt`) }),
		}
	})
	const rawOverride = retirement['profileReplacementOverride'] === undefined ? undefined : record(retirement['profileReplacementOverride'], 'retirement.profileReplacementOverride')
	if (rawOverride !== undefined) exactKeys(rawOverride, ['acceptedAt', 'reason', 'targetProfileId'], [], 'retirement.profileReplacementOverride')
	return {
		blockers,
		...(retirement['cancelledAt'] === undefined ? {} : { cancelledAt: timestamp(retirement['cancelledAt'], 'retirement.cancelledAt') }),
		...(retirement['completionEvidence'] === undefined ? {} : { completionEvidence: parseCompletionEvidence(retirement['completionEvidence']) }),
		...(retirement['finalSweepStartedAt'] === undefined ? {} : { finalSweepStartedAt: timestamp(retirement['finalSweepStartedAt'], 'retirement.finalSweepStartedAt') }),
		lastObservedBalances,
		positions,
		...(rawOverride === undefined ? {} : { profileReplacementOverride: { acceptedAt: timestamp(rawOverride['acceptedAt'], 'retirement.profileReplacementOverride.acceptedAt'), reason: String(rawOverride['reason']), targetProfileId: String(rawOverride['targetProfileId']) } }),
		...(retirement['recipient'] === undefined ? {} : { recipient: getAddress(String(retirement['recipient'])) }),
		recoveredBalances,
		...(retirement['requestedAt'] === undefined ? {} : { requestedAt: timestamp(retirement['requestedAt'], 'retirement.requestedAt') }),
		status: status as RetirementStatus,
		...(retirement['updatedAt'] === undefined ? {} : { updatedAt: timestamp(retirement['updatedAt'], 'retirement.updatedAt') }),
		policies: parsePolicies(retirement['policies']),
	}
}

export function acceptResidualProfileReplacement(state: DurableRetirementState, targetProfileId: string, reason: string, confirmation: string, now = new Date().toISOString()) {
	if (state.status !== 'drained-with-residuals') throw new Error('A residual override is only valid after drained-with-residuals completion')
	if (reason.trim().length < 12 || reason.trim().length > 2_048) throw new Error('Residual override reason must contain 12 to 2048 characters')
	if (confirmation !== `ACCEPT RESIDUALS FOR ${targetProfileId}`) throw new Error(`Confirmation must exactly match ACCEPT RESIDUALS FOR ${targetProfileId}`)
	state.profileReplacementOverride = { acceptedAt: now, reason: reason.trim(), targetProfileId }
	state.updatedAt = now
}

export function requestRetirement(state: DurableRetirementState, profileId: string, recipient: Address, policies: RetirementPolicies, confirmation: string, now = new Date().toISOString()) {
	if (state.status !== 'inactive') throw new Error(`Retirement cannot be requested while ${state.status}`)
	if (confirmation !== `DRAIN ${profileId} TO ${recipient}`) throw new Error(`Confirmation must exactly match DRAIN ${profileId} TO ${recipient}`)
	state.status = 'requested'
	state.recipient = recipient
	state.policies = { ...policies }
	state.requestedAt = now
	state.updatedAt = now
	state.blockers = []
	state.completionEvidence = undefined
}

export function cancelRetirement(state: DurableRetirementState, confirmation: string, now = new Date().toISOString()) {
	if (state.finalSweepStartedAt !== undefined || (state.status !== 'requested' && state.status !== 'draining' && state.status !== 'waiting' && state.status !== 'blocked')) throw new Error('Retirement can no longer be cancelled safely')
	if (confirmation !== 'CANCEL DRAIN') throw new Error('Confirmation must exactly match CANCEL DRAIN')
	state.status = 'inactive'
	state.cancelledAt = now
	state.updatedAt = now
	state.blockers = []
}

export function registerV3Position(state: DurableRetirementState, input: Omit<DurableV3Position, 'createdAt' | 'id' | 'positionKey' | 'registeredBy' | 'status'>, now = new Date().toISOString()) {
	const positionKey = uniswapV3PositionKey(input.owner, input.tickLower, input.tickUpper)
	const id = `${input.pool.toLowerCase()}:${positionKey.toLowerCase()}`
	if (state.positions.some(position => position.id === id)) throw new Error('This Uniswap V3 position is already registered')
	const position: DurableV3Position = { ...input, createdAt: now, id, positionKey, registeredBy: 'operator', status: 'pending-confirmation' }
	state.positions.push(position)
	state.updatedAt = now
	return position
}
