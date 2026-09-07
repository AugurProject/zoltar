import { getAddress, type Address, type Hash, type PublicClient } from '@zoltar/bot-shared/ethereum'
import { erc1155Abi, erc20Abi, wethAbi } from '../contracts/abi.ts'
import { retirementErc20TransferAbi, retirementUniswapV3PositionAbi } from '../contracts/retirement-abi.ts'
import { encodeStep, planBase } from '../operations/planning.ts'
import { buildRetirementLiquidityRemovalPlan } from '../operations/retirement-liquidity.ts'
import type { EcosystemSnapshot, EvaluatedOperation, OperationPlan, PlanningOptions } from '../operations/types.ts'
import { uniswapV3PositionKey, type DurableRetirementState, type DurableV3Position, type RetirementBlocker, type RetirementResidual } from '../state/retirement.ts'
import type { DurableState } from '../state/operator-state.ts'

export type V3PositionObservation = {
	liquidity: bigint
	position: DurableV3Position
	tokensOwed0: bigint
	tokensOwed1: bigint
}

export type V3PositionReader = (position: DurableV3Position, blockNumber: bigint) => Promise<V3PositionObservation>

export type RetirementProofCounts = {
	actionableObligations: number
	claimableAssets: number
	collectableV3Positions: number
	knownApprovals: number
	ownedLiquidityPositions: number
	partialWorkflows: number
	pendingTransactions: number
}

export type RetirementAssessment = {
	action: { kind: 'existing-plan'; plan: OperationPlan } | { kind: 'v3-position'; observation: V3PositionObservation } | undefined
	blockers: RetirementBlocker[]
	proof: RetirementProofCounts
	residuals: RetirementResidual[]
	status: 'blocked' | 'drained' | 'drained-with-residuals' | 'draining' | 'waiting'
}

const RETIREMENT_OPERATION_ORDER = [
	'statoblast.escalation.withdraw',
	'statoblast.escalation.withdraw-forked',
	'statoblast.escalation.claim-forked',
	'statoblast.auction.withdraw-refund',
	'statoblast.auction.refund',
	'statoblast.auction.settle-bids',
	'statoblast.vault.redeem-fees',
	'statoblast.vault.redeem-rep',
	'statoblast.complete-set.redeem',
	'statoblast.shares.redeem-winning',
	'trading.liquidity.remove',
	'trading.complete-set.redeem',
	'trading.position.exit',
] as const

const EXPOSURE_CREATING_OPERATIONS = new Set([
	'open-oracle.deposit',
	'open-oracle.report',
	'statoblast.auction.bid',
	'statoblast.complete-set.create',
	'statoblast.escalation.deposit',
	'statoblast.escalation.deposit-wallet-rep',
	'statoblast.liquidation.queue',
	'statoblast.pool.deploy',
	'statoblast.vault.deposit-rep',
	'trading.genesis-uniswap.seed-pool',
	'trading.liquidity.add',
	'trading.position.enter',
	'trading.swap.exact-input',
	'trading.swap.exact-output',
	'trading.universe-uniswap.seed-pool',
	'zoltar.child.deploy',
	'zoltar.universe.fork',
])

export function operationAllowedDuringRetirement(operationId: string, policies: Pick<DurableRetirementState['policies'], 'exitUnmatchedShares' | 'maximumExitLossBps' | 'migrateExistingClaims'>) {
	if (EXPOSURE_CREATING_OPERATIONS.has(operationId)) return false
	if (operationId === 'trading.position.exit') return policies.exitUnmatchedShares && policies.maximumExitLossBps >= 100
	if (operationId.includes('migrate')) return policies.migrateExistingClaims
	return (
		RETIREMENT_OPERATION_ORDER.includes(operationId as (typeof RETIREMENT_OPERATION_ORDER)[number]) ||
		operationId.includes('recover') ||
		operationId.includes('settle') ||
		operationId.includes('claim') ||
		operationId.includes('withdraw') ||
		operationId.includes('redeem') ||
		operationId.includes('refund') ||
		operationId.includes('revoke')
	)
}

export function retirementPlanFromEvaluations(evaluations: readonly EvaluatedOperation[], policies: DurableRetirementState['policies']) {
	const eligible = evaluations.flatMap(evaluation => (evaluation.eligibility.eligible && evaluation.plan !== undefined && operationAllowedDuringRetirement(evaluation.plan.definitionId, policies) ? [evaluation.plan] : []))
	return eligible.sort((left, right) => {
		const leftRank = RETIREMENT_OPERATION_ORDER.indexOf(left.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rightRank = RETIREMENT_OPERATION_ORDER.indexOf(right.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rank = (value: number) => (value === -1 ? RETIREMENT_OPERATION_ORDER.length : value)
		return rank(leftRank) - rank(rightRank) || left.id.localeCompare(right.id)
	})[0]
}

export async function readV3Position(client: Pick<PublicClient, 'readContract'>, position: DurableV3Position, blockNumber: bigint): Promise<V3PositionObservation> {
	const result = await client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, args: [position.positionKey], blockNumber, functionName: 'positions' })
	return { liquidity: result[0], position, tokensOwed0: result[3], tokensOwed1: result[4] }
}

export async function readV3PositionsWithQuorum(readers: readonly V3PositionReader[], requiredQuorum: number, positions: readonly DurableV3Position[], blockNumber: bigint) {
	if (readers.length < requiredQuorum) throw new Error('Retirement V3 scan does not have enough RPC clients for quorum')
	const observations: V3PositionObservation[] = []
	for (const position of positions.filter(candidate => candidate.status === 'active' || candidate.status === 'collect-only')) {
		const settled = await Promise.allSettled(readers.map(reader => reader(position, blockNumber)))
		const successful = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
		const grouped = new Map<string, V3PositionObservation[]>()
		for (const observation of successful) {
			const key = `${observation.liquidity.toString()}:${observation.tokensOwed0.toString()}:${observation.tokensOwed1.toString()}`
			grouped.set(key, [...(grouped.get(key) ?? []), observation])
		}
		const agreed = [...grouped.values()].find(values => values.length >= requiredQuorum)?.[0]
		if (agreed === undefined) throw new Error(`No RPC quorum agreed on retirement position ${position.id}`)
		observations.push(agreed)
	}
	return observations
}

export function buildV3RetirementPlan(snapshot: EcosystemSnapshot, observation: V3PositionObservation, seed: number): OperationPlan {
	const { position } = observation
	if (observation.liquidity === 0n && observation.tokensOwed0 === 0n && observation.tokensOwed1 === 0n) throw new Error('Closed V3 positions do not produce retirement plans')
	const steps = []
	if (observation.liquidity > 0n) {
		steps.push(
			encodeStep({
				abi: retirementUniswapV3PositionAbi,
				args: [position.tickLower, position.tickUpper, observation.liquidity],
				functionName: 'burn',
				id: 'burn-full-v3-position',
				label: 'Burn full current Uniswap V3 position liquidity',
				to: position.pool,
				walletAssetDebits: [],
			}),
		)
	}
	steps.push(
		encodeStep({
			abi: retirementUniswapV3PositionAbi,
			args: [position.owner, position.tickLower, position.tickUpper, (1n << 128n) - 1n, (1n << 128n) - 1n],
			functionName: 'collect',
			id: 'collect-full-v3-position',
			label: 'Collect all Uniswap V3 principal and fees',
			to: position.pool,
			walletAssetDebits: [],
		}),
	)
	return {
		...planBase({
			definitionId: 'retirement.uniswap-v3.drain-position',
			ecosystem: 'trading',
			label: 'Drain owned Uniswap V3 position',
			metadata: { pool: position.pool, positionId: position.id, positionKey: position.positionKey },
			postconditions: ['The wallet position has zero liquidity and zero collectable token amounts'],
			risk: 'low',
			snapshot,
			steps,
		}),
		planningSeed: seed,
	}
}

export function buildAllowanceRevocationPlan(snapshot: EcosystemSnapshot, seed: number): OperationPlan | undefined {
	const tokenApproval = [...snapshot.wallet.tokens]
		.sort((left, right) => left.address.localeCompare(right.address))
		.flatMap(token =>
			Object.entries(token.allowances)
				.filter(([, amount]) => BigInt(amount) > 0n)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([spender]) => ({ spender: getAddress(spender), token: token.address })),
		)[0]
	if (tokenApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-erc20',
				ecosystem: 'trading',
				label: 'Revoke known ERC-20 allowance',
				metadata: { spender: tokenApproval.spender, token: tokenApproval.token },
				postconditions: ['The exact known ERC-20 allowance is zero'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: erc20Abi, args: [tokenApproval.spender, 0n], functionName: 'approve', id: 'revoke-erc20', label: 'Revoke ERC-20 allowance', to: tokenApproval.token })],
			}),
			planningSeed: seed,
		}
	}
	const shareApproval = [...snapshot.wallet.shares]
		.sort((left, right) => left.shareToken.localeCompare(right.shareToken))
		.flatMap(shares =>
			Object.entries(shares.isApprovedForAll)
				.filter(([, approved]) => approved)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([operator]) => ({ operator: getAddress(operator), token: shares.shareToken })),
		)[0]
	if (shareApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-erc1155',
				ecosystem: 'trading',
				label: 'Revoke known ERC-1155 operator',
				metadata: { operator: shareApproval.operator, token: shareApproval.token },
				postconditions: ['The exact known ERC-1155 operator approval is false'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: erc1155Abi, args: [shareApproval.operator, false], functionName: 'setApprovalForAll', id: 'revoke-erc1155', label: 'Revoke ERC-1155 operator', to: shareApproval.token })],
			}),
			planningSeed: seed,
		}
	}
	const lpApproval = [...snapshot.wallet.lpTokens].sort((left, right) => left.pair.localeCompare(right.pair)).find(lp => BigInt(lp.allowanceToRouter) > 0n)
	if (lpApproval === undefined) return undefined
	return {
		...planBase({
			definitionId: 'retirement.allowance.revoke-lp',
			ecosystem: 'trading',
			label: 'Revoke known LP-token router allowance',
			metadata: { pair: lpApproval.pair, router: snapshot.deployments.tradingRouter },
			postconditions: ['The LP-token router allowance is zero'],
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: erc20Abi, args: [snapshot.deployments.tradingRouter, 0n], functionName: 'approve', id: 'revoke-lp', label: 'Revoke LP-token allowance', to: lpApproval.pair })],
		}),
		planningSeed: seed,
	}
}

export function buildAssetSweepPlan(snapshot: EcosystemSnapshot, retirement: DurableRetirementState, seed: number, limits?: { maximumEthAttoEth: bigint; maximumRepAttoRep: bigint; minimumEthReserveAttoEth: bigint }): OperationPlan | undefined {
	if (!retirement.policies.sweepAssets || retirement.recipient === undefined || limits === undefined) return undefined
	const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
	if (retirement.policies.unwrapWeth && weth !== undefined && BigInt(weth.balance) > 0n) {
		const amount = BigInt(weth.balance) < limits.maximumEthAttoEth ? BigInt(weth.balance) : limits.maximumEthAttoEth
		return {
			...planBase({
				definitionId: 'retirement.sweep.unwrap-weth',
				ecosystem: 'trading',
				label: 'Unwrap WETH for retirement',
				metadata: { amount: amount.toString() },
				postconditions: ['The selected WETH balance is converted to native ETH'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: wethAbi, args: [amount], functionName: 'withdraw', id: 'unwrap-weth', label: 'Unwrap WETH', to: snapshot.deployments.weth, walletAssetDebits: [{ amount: amount.toString(), asset: snapshot.deployments.weth, category: 'weth', kind: 'erc20' }] })],
			}),
			planningSeed: seed,
		}
	}
	const repTokens = new Set(snapshot.universes.map(universe => universe.repToken.toLowerCase()))
	const token = [...snapshot.wallet.tokens].filter(candidate => candidate.address.toLowerCase() !== snapshot.deployments.weth.toLowerCase() && BigInt(candidate.balance) > 0n).sort((left, right) => left.address.localeCompare(right.address))[0]
	if (token !== undefined) {
		const balance = BigInt(token.balance)
		const isRep = repTokens.has(token.address.toLowerCase())
		const amount = isRep && balance > limits.maximumRepAttoRep ? limits.maximumRepAttoRep : balance
		return {
			...planBase({
				definitionId: 'retirement.sweep.erc20',
				ecosystem: 'trading',
				label: 'Sweep reusable ERC-20 asset',
				metadata: { amount: amount.toString(), recipient: retirement.recipient, token: token.address },
				postconditions: ['The selected reusable token amount is transferred to the retirement recipient'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: retirementErc20TransferAbi, args: [retirement.recipient, amount], functionName: 'transfer', id: 'sweep-erc20', label: 'Sweep ERC-20 asset', to: token.address, walletAssetDebits: [{ amount: amount.toString(), asset: token.address, category: isRep ? 'rep' : 'other', kind: 'erc20' }] })],
			}),
			planningSeed: seed,
		}
	}
	const spendableEth = BigInt(snapshot.wallet.ethBalanceAttoEth) - limits.minimumEthReserveAttoEth
	if (spendableEth <= 0n) return undefined
	const amount = spendableEth < limits.maximumEthAttoEth ? spendableEth : limits.maximumEthAttoEth
	return {
		...planBase({
			definitionId: 'retirement.sweep.native-last',
			ecosystem: 'trading',
			label: 'Sweep native ETH last',
			metadata: { amount: amount.toString(), recipient: retirement.recipient },
			postconditions: ['Native ETH is transferred last while the configured gas reserve remains'],
			risk: 'low',
			snapshot,
			steps: [
				{
					data: '0x',
					evidence: [{ account: retirement.recipient, asset: 'ETH', direction: 'increase', kind: 'balance-change' }],
					gasLimit: '21000',
					id: 'sweep-native-eth',
					label: 'Sweep native ETH',
					preflightCalls: [],
					to: retirement.recipient,
					value: amount.toString(),
					walletAssetDebits: [{ amount: amount.toString(), asset: 'ETH', kind: 'native' }],
				},
			],
		}),
		planningSeed: seed,
	}
}

function knownApprovalCount(snapshot: EcosystemSnapshot) {
	let count = 0
	for (const token of snapshot.wallet.tokens) count += Object.values(token.allowances).filter(value => BigInt(value) > 0n).length
	count += snapshot.wallet.shares.flatMap(shares => Object.values(shares.isApprovedForAll)).filter(Boolean).length
	count += snapshot.wallet.lpTokens.filter(lp => BigInt(lp.allowanceToRouter) > 0n).length
	return count
}

function shareResiduals(snapshot: EcosystemSnapshot): RetirementResidual[] {
	return [
		...snapshot.wallet.shares.flatMap(shares =>
			[shares.invalid, shares.yes, shares.no].flatMap((amount, outcome) => (BigInt(amount) === 0n ? [] : [{ amount, asset: `${shares.shareToken}:${outcome.toString()}`, category: 'losing-share' as const, reason: 'Outcome shares are not currently redeemable or accepted for bounded-loss exit' }])),
		),
		...snapshot.wallet.tokens.flatMap(token => (BigInt(token.openOracleCredit) === 1n ? [{ amount: '1', asset: token.address, category: 'mandatory-sentinel' as const, reason: 'OpenOracle retains a mandatory one-unit credit sentinel' }] : [])),
		...(BigInt(snapshot.wallet.openOracleEthCredit) > 0n ? [{ amount: snapshot.wallet.openOracleEthCredit, asset: 'ETH:OpenOracle', category: 'mandatory-sentinel' as const, reason: 'Native OpenOracle credit cannot be swept with an exact transfer postcondition' }] : []),
	]
}

export function recordCanonicalRecoveredBalances(retirement: DurableRetirementState, snapshot: EcosystemSnapshot) {
	retirement.recoveredBalances = Object.fromEntries([
		['ETH', snapshot.wallet.ethBalanceAttoEth],
		...snapshot.wallet.tokens.map(token => [token.address, token.balance] as const),
		...snapshot.wallet.lpTokens.map(token => [`LP:${token.pair}`, token.balance] as const),
		...snapshot.wallet.shares.flatMap(shares => [[`${shares.shareToken}:INVALID`, shares.invalid] as const, [`${shares.shareToken}:YES`, shares.yes] as const, [`${shares.shareToken}:NO`, shares.no] as const]),
	])
}

export function assessRetirement(parameters: {
	blockHash: Hash
	blockNumber: bigint
	evaluations: readonly EvaluatedOperation[]
	retirement: DurableRetirementState
	snapshot: EcosystemSnapshot
	state: Pick<DurableState, 'obligations' | 'pendingTransactions' | 'workflows'>
	v3: readonly V3PositionObservation[]
	sweepLimits?: { maximumEthAttoEth: bigint; maximumRepAttoRep: bigint; minimumEthReserveAttoEth: bigint } | undefined
	planning?: PlanningOptions | undefined
	canonicalScanComplete?: boolean | undefined
}): RetirementAssessment {
	const partialWorkflows = parameters.state.workflows.filter(workflow => !['abandoned', 'completed', 'failed'].includes(workflow.status)).length
	const actionableObligations = parameters.state.obligations.filter(obligation => !['abandoned', 'completed', 'deferred'].includes(obligation.status)).length
	const fullLiquidityPlan = parameters.planning === undefined ? undefined : buildRetirementLiquidityRemovalPlan(parameters.snapshot, parameters.planning)
	const claimPlan = retirementPlanFromEvaluations(fullLiquidityPlan === undefined ? parameters.evaluations : parameters.evaluations.filter(evaluation => evaluation.plan?.definitionId !== 'trading.liquidity.remove'), parameters.retirement.policies)
	const revocationPlan = buildAllowanceRevocationPlan(parameters.snapshot, Number(parameters.blockNumber & 0xffff_ffffn))
	const sweepPlan = buildAssetSweepPlan(parameters.snapshot, parameters.retirement, Number(parameters.blockNumber & 0xffff_ffffn), parameters.sweepLimits)
	const v3Action = parameters.v3.find(observation => observation.liquidity > 0n || observation.tokensOwed0 > 0n || observation.tokensOwed1 > 0n)
	const approvals = knownApprovalCount(parameters.snapshot)
	const blockers: RetirementBlocker[] = []
	if (parameters.canonicalScanComplete === false) blockers.push({ category: 'incomplete-discovery', details: 'The canonical lifecycle, carry-proof, or topology scan is incomplete', id: 'canonical-scan-incomplete' })
	if (parameters.snapshot.warnings.length !== 0) blockers.push({ category: 'incomplete-discovery', details: parameters.snapshot.warnings.join('; '), id: 'canonical-scan-warnings' })
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'deferred')) {
		blockers.push({ category: 'temporarily-locked', details: `${obligation.label} is not yet eligible`, id: obligation.id, ...(obligation.notBefore === undefined ? {} : { nextEligibleAt: obligation.notBefore }) })
	}
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'blocked' || candidate.status === 'failed')) {
		blockers.push({ category: 'operator-action', details: obligation.blockers[0] ?? `${obligation.label} requires reconciliation`, id: obligation.id })
	}
	for (const position of parameters.retirement.positions.filter(candidate => candidate.status === 'blocked')) blockers.push({ category: 'ambiguous-position', details: `Ownership could not be proven for ${position.pool}`, id: position.id })
	const residuals = shareResiduals(parameters.snapshot)
	const proof: RetirementProofCounts = {
		actionableObligations,
		claimableAssets: claimPlan === undefined ? 0 : 1,
		collectableV3Positions: parameters.v3.filter(value => value.tokensOwed0 > 0n || value.tokensOwed1 > 0n).length,
		knownApprovals: approvals,
		ownedLiquidityPositions: parameters.v3.filter(value => value.liquidity > 0n).length,
		partialWorkflows,
		pendingTransactions: parameters.state.pendingTransactions.length,
	}
	const directPlan = claimPlan ?? fullLiquidityPlan ?? revocationPlan ?? sweepPlan
	let action: RetirementAssessment['action']
	if (v3Action !== undefined) action = { kind: 'v3-position', observation: v3Action }
	else if (directPlan !== undefined) action = { kind: 'existing-plan', plan: directPlan }
	const outstanding = proof.actionableObligations + proof.claimableAssets + proof.collectableV3Positions + proof.knownApprovals + proof.ownedLiquidityPositions + proof.partialWorkflows + proof.pendingTransactions
	if (action !== undefined) return { action, blockers, proof, residuals, status: 'draining' }
	if (blockers.some(blocker => blocker.category !== 'temporarily-locked')) return { action, blockers, proof, residuals, status: 'blocked' }
	if (blockers.length !== 0) return { action, blockers, proof, residuals, status: 'waiting' }
	if (outstanding > 0) return { action, blockers, proof, residuals, status: 'draining' }
	if (parameters.sweepLimits !== undefined && BigInt(parameters.snapshot.wallet.ethBalanceAttoEth) > 0n) residuals.push({ amount: parameters.snapshot.wallet.ethBalanceAttoEth, asset: 'ETH', category: 'mandatory-sentinel', reason: 'Configured gas reserve retained after native sweeping' })
	return { action, blockers, proof, residuals, status: residuals.length === 0 ? 'drained' : 'drained-with-residuals' }
}

export function applyRetirementAssessment(retirement: DurableRetirementState, assessment: RetirementAssessment, blockHash: Hash, blockNumber: bigint, now = new Date().toISOString()) {
	retirement.blockers = assessment.blockers
	retirement.status = assessment.status
	retirement.updatedAt = now
	if (assessment.status !== 'drained' && assessment.status !== 'drained-with-residuals') {
		retirement.completionEvidence = undefined
		return
	}
	const outstanding = assessment.proof.actionableObligations + assessment.proof.claimableAssets + assessment.proof.collectableV3Positions + assessment.proof.knownApprovals + assessment.proof.ownedLiquidityPositions + assessment.proof.partialWorkflows + assessment.proof.pendingTransactions
	if (outstanding !== 0) throw new Error('Retirement completion requires every canonical proof count to be zero')
	retirement.completionEvidence = {
		blockHash,
		blockNumber: blockNumber.toString(),
		completedAt: now,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: assessment.residuals,
	}
}

export function reconcileV3PositionJournal(retirement: DurableRetirementState, workflows: DurableState['workflows'], profileId: string, owner: Address, now = new Date().toISOString()) {
	for (const workflow of workflows.filter(candidate => candidate.operationId === 'trading.genesis-uniswap.seed-pool' || candidate.operationId === 'trading.universe-uniswap.seed-pool')) {
		const metadata = workflow.metadata
		if (typeof metadata['pool'] !== 'string' || typeof metadata['token0'] !== 'string' || typeof metadata['token1'] !== 'string') continue
		const pool = getAddress(metadata['pool'])
		const seedStep = workflow.steps.find(step => step.id.includes('seed'))
		const confirmed = seedStep?.status === 'confirmed'
		const recoverable = seedStep?.status === 'planned' || seedStep?.status === 'signed' || seedStep?.status === 'submitted'
		let positionStatus: DurableV3Position['status'] = 'blocked'
		if (confirmed) positionStatus = 'active'
		else if (recoverable) positionStatus = 'pending-confirmation'
		const position: Omit<DurableV3Position, 'id' | 'positionKey'> = {
			createdAt: workflow.createdAt,
			...(seedStep?.transactionHash === undefined ? {} : { creationTransactionHash: seedStep.transactionHash }),
			creationWorkflowId: workflow.id,
			fee: 10_000,
			owner,
			pool,
			profileId,
			registeredBy: confirmed || recoverable ? 'workflow' : 'backfill',
			status: positionStatus,
			tickLower: -887_200,
			tickUpper: 887_200,
			token0: getAddress(metadata['token0']),
			token1: getAddress(metadata['token1']),
		}
		const positionKey = uniswapV3PositionKey(position.owner, position.tickLower, position.tickUpper)
		const key = `${position.pool.toLowerCase()}:${positionKey.toLowerCase()}`
		const existing = retirement.positions.find(candidate => candidate.id === key)
		if (existing !== undefined) {
			if (confirmed && existing.status === 'pending-confirmation') existing.status = 'active'
			if (seedStep?.transactionHash !== undefined) existing.creationTransactionHash = seedStep.transactionHash
			continue
		}
		retirement.positions.push({ ...position, id: key, positionKey })
		retirement.updatedAt = now
	}
}
