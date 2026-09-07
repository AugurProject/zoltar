import { getAddress, zeroAddress, type Address, type Hash, type PublicClient } from '@zoltar/bot-shared/ethereum'
import { erc1155Abi, erc20Abi, openOracleAbi, wethAbi } from '../contracts/abi.ts'
import { retirementErc20TransferAbi, retirementUniswapV3PositionAbi } from '../contracts/retirement-abi.ts'
import { encodeStep, planBase } from '../operations/planning.ts'
import { buildRetirementLiquidityRemovalPlan } from '../operations/retirement-liquidity.ts'
import type { EcosystemSnapshot, EvaluatedOperation, OperationPlan, PlanningOptions } from '../operations/types.ts'
import { uniswapV3PositionKey, type DurableRetirementState, type DurableV3Position, type RetirementBlocker, type RetirementResidual } from '../state/retirement.ts'
import type { DurableState } from '../state/operator-state.ts'
import type { RetirementAssessment, RetirementProofCounts, V3PositionObservation, V3PositionReader } from './retirement-types.ts'
import { CLAIM_LINKED_MIGRATIONS, operationAllowedDuringRetirement } from './retirement-operation-policy.ts'

export type { RetirementAssessment, RetirementProofCounts, V3PositionObservation, V3PositionReader } from './retirement-types.ts'

const RETIREMENT_OPERATION_ORDER = [
	'open-oracle.withdraw',
	'open-oracle.withdraw-to',
	'open-oracle.push-or-credit',
	'open-oracle.settle',
	'statoblast.oracle.recover-report',
	'statoblast.escalation.resume',
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
	'trading.liquidity.remove-shares',
	'trading.complete-set.redeem',
	'trading.position.exit',
	'statoblast.staged.execute',
	'statoblast.staged.expire',
	'statoblast.auction.start',
	'statoblast.auction.finalize-route',
	'statoblast.escalation.sweep-residual',
] as const

export { operationAllowedDuringRetirement } from './retirement-operation-policy.ts'

export function migrationPlanRecoversWalletClaim(plan: OperationPlan, snapshot: EcosystemSnapshot) {
	if (!CLAIM_LINKED_MIGRATIONS.has(plan.definitionId)) return true
	if (plan.definitionId === 'trading.shares.migrate') {
		const shareToken = plan.metadata['shareToken']
		return typeof shareToken === 'string' && snapshot.wallet.shares.some(shares => shares.shareToken.toLowerCase() === shareToken.toLowerCase() && [shares.invalid, shares.yes, shares.no].some(balance => BigInt(balance) > 0n))
	}
	const poolAddress = plan.metadata['pool']
	if (typeof poolAddress !== 'string') return false
	const pool = snapshot.pools.find(candidate => candidate.address.toLowerCase() === poolAddress.toLowerCase())
	if (pool === undefined) return false
	const vault = pool.vaults.find(candidate => candidate.address.toLowerCase() === snapshot.wallet.address.toLowerCase())
	const hasVaultClaim = vault !== undefined && [vault.repBackingUnits, vault.repBackingAttoRep, vault.capacityOwnershipAttoRep, vault.claimableFeesAttoEth, vault.disputeStakedAttoRep].some(value => BigInt(value) > 0n)
	const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
	return hasVaultClaim || (shares !== undefined && [shares.invalid, shares.yes, shares.no].some(value => BigInt(value) > 0n)) || pool.unresolvedEscalationMigrationReadyOutcomes.length > 0
}

export function retirementPlanAllowed(plan: OperationPlan, snapshot: EcosystemSnapshot, policies: DurableRetirementState['policies']) {
	return operationAllowedDuringRetirement(plan.definitionId, policies) && migrationPlanRecoversWalletClaim(plan, snapshot)
}

function exitPlanWithinLossLimit(plan: OperationPlan, maximumExitLossBps: number) {
	if (plan.definitionId !== 'trading.position.exit') return true
	const maximumLong = plan.metadata['maximumLong']
	const minimumEth = plan.metadata['minimumEthAttoEth']
	if (typeof maximumLong !== 'string' || typeof minimumEth !== 'string') return false
	const input = BigInt(maximumLong)
	const output = BigInt(minimumEth)
	return input > 0n && output * 10_000n >= input * BigInt(10_000 - maximumExitLossBps)
}

export function retirementPlanFromEvaluations(evaluations: readonly EvaluatedOperation[], policies: DurableRetirementState['policies'], snapshot?: EcosystemSnapshot) {
	const eligible = evaluations.flatMap(evaluation => {
		if (!evaluation.eligibility.eligible || evaluation.plan === undefined) return []
		if (!operationAllowedDuringRetirement(evaluation.plan.definitionId, policies) || !exitPlanWithinLossLimit(evaluation.plan, policies.maximumExitLossBps)) return []
		if (snapshot !== undefined && !migrationPlanRecoversWalletClaim(evaluation.plan, snapshot)) return []
		return [evaluation.plan]
	})
	return eligible.sort((left, right) => {
		const leftRank = RETIREMENT_OPERATION_ORDER.indexOf(left.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rightRank = RETIREMENT_OPERATION_ORDER.indexOf(right.definitionId as (typeof RETIREMENT_OPERATION_ORDER)[number])
		const rank = (value: number) => (value === -1 ? RETIREMENT_OPERATION_ORDER.length : value)
		return rank(leftRank) - rank(rightRank) || left.id.localeCompare(right.id)
	})[0]
}

export async function readV3Position(client: Pick<PublicClient, 'getBlock' | 'getTransactionReceipt' | 'readContract'>, position: DurableV3Position, blockNumber: bigint): Promise<V3PositionObservation> {
	if (position.registeredBy === 'workflow') {
		if (position.creationTransactionHash === undefined) throw new Error(`Retirement position ${position.id} is missing its canonical creation transaction`)
		const receipt = await client.getTransactionReceipt({ hash: position.creationTransactionHash })
		if (receipt.status !== 'success' || receipt.blockNumber > blockNumber) throw new Error(`Retirement position ${position.id} does not have a successful canonical creation receipt at the scan anchor`)
		const creationBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
		if (creationBlock.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`Retirement position ${position.id} creation receipt is not canonical`)
	}
	const [token0, token1, fee, result] = await Promise.all([
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber, functionName: 'token0' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber, functionName: 'token1' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber, functionName: 'fee' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, args: [position.positionKey], blockNumber, functionName: 'positions' }),
	])
	if (getAddress(token0).toLowerCase() !== position.token0.toLowerCase() || getAddress(token1).toLowerCase() !== position.token1.toLowerCase() || Number(fee) !== position.fee) throw new Error(`Retirement position ${position.id} does not match its canonical pool identity`)
	return { liquidity: result[0], position, tokensOwed0: result[3], tokensOwed1: result[4] }
}

export async function readV3PositionsWithQuorum(readers: readonly V3PositionReader[], requiredQuorum: number, positions: readonly DurableV3Position[], blockNumber: bigint) {
	if (readers.length < requiredQuorum) throw new Error('Retirement V3 scan does not have enough RPC clients for quorum')
	const observations: V3PositionObservation[] = []
	for (const position of positions.filter(candidate => candidate.status === 'active' || candidate.status === 'collect-only' || candidate.status === 'pending-confirmation')) {
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
	const internalApproval = [...snapshot.wallet.tokens].sort((left, right) => left.address.localeCompare(right.address)).find(token => BigInt(token.openOracleInternalAllowanceToSelf ?? '0') > 0n)
	if (internalApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-open-oracle-internal',
				ecosystem: 'open-oracle',
				label: 'Revoke OpenOracle internal allowance',
				metadata: { owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: internalApproval.address },
				postconditions: ['The wallet-to-self OpenOracle internal allowance is zero'],
				risk: 'low',
				snapshot,
				steps: [
					encodeStep({
						abi: openOracleAbi,
						args: [snapshot.wallet.address, internalApproval.address, 0n],
						evidence: [
							{
								abi: 'function internalAllowance(address owner,address spender,address token) view returns (uint256)',
								args: [snapshot.wallet.address, snapshot.wallet.address, internalApproval.address],
								contract: snapshot.deployments.openOracle,
								expected: '0',
								functionName: 'internalAllowance',
								kind: 'storage-postcondition',
								relation: 'equals',
							},
						],
						functionName: 'approveInternal',
						id: 'revoke-open-oracle-internal',
						label: 'Revoke OpenOracle internal allowance',
						to: snapshot.deployments.openOracle,
					}),
				],
			}),
			planningSeed: seed,
		}
	}
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

export function buildNativeOpenOracleCreditPlan(snapshot: EcosystemSnapshot, retirement: DurableRetirementState, seed: number): OperationPlan | undefined {
	if (retirement.recipient === undefined) return undefined
	const credit = BigInt(snapshot.wallet.openOracleEthCredit)
	if (credit <= 1n) return undefined
	const amount = credit - 1n
	return {
		...planBase({
			definitionId: 'retirement.open-oracle.withdraw-native',
			ecosystem: 'open-oracle',
			label: 'Withdraw native OpenOracle credit',
			metadata: { amount: amount.toString(), recipient: retirement.recipient },
			postconditions: ['OpenOracle native credit retains exactly its mandatory one-unit sentinel and the recipient receives the recoverable balance'],
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args: [zeroAddress, amount, retirement.recipient],
					evidence: [
						{ abi: 'function tokenHolder(address owner,address token) view returns (uint256)', args: [snapshot.wallet.address, zeroAddress], contract: snapshot.deployments.openOracle, expected: '1', functionName: 'tokenHolder', kind: 'storage-postcondition', relation: 'equals' },
						{ account: retirement.recipient, asset: 'ETH', direction: 'increase', kind: 'balance-change' },
					],
					functionName: 'withdrawTo',
					id: 'withdraw-native-credit',
					label: 'Withdraw native OpenOracle credit to retirement recipient',
					to: snapshot.deployments.openOracle,
				}),
			],
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
	for (const token of snapshot.wallet.tokens) {
		count += Object.values(token.allowances).filter(value => BigInt(value) > 0n).length
		if (BigInt(token.openOracleInternalAllowanceToSelf ?? '0') > 0n) count += 1
	}
	count += snapshot.wallet.shares.flatMap(shares => Object.values(shares.isApprovedForAll)).filter(Boolean).length
	count += snapshot.wallet.lpTokens.filter(lp => BigInt(lp.allowanceToRouter) > 0n).length
	return count
}

function retainedAssetResiduals(snapshot: EcosystemSnapshot, retirement: DurableRetirementState): RetirementResidual[] {
	const residuals: RetirementResidual[] = []
	for (const token of snapshot.wallet.tokens) {
		if (BigInt(token.balance) > 0n && (!retirement.policies.sweepAssets || (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() && !retirement.policies.unwrapWeth))) {
			residuals.push({ amount: token.balance, asset: token.address, category: 'operator-accepted', reason: retirement.policies.sweepAssets ? 'WETH unwrap was disabled by retirement policy' : 'Reusable-asset sweeping was disabled by retirement policy' })
		}
		if (BigInt(token.openOracleCredit) === 1n) residuals.push({ amount: '1', asset: `${token.address}:OpenOracle`, category: 'mandatory-sentinel', reason: 'OpenOracle retains a mandatory one-unit credit sentinel' })
	}
	if (BigInt(snapshot.wallet.openOracleEthCredit) === 1n) residuals.push({ amount: '1', asset: 'ETH:OpenOracle', category: 'mandatory-sentinel', reason: 'OpenOracle retains a mandatory one-unit native-credit sentinel' })
	return residuals
}

function classifyShares(snapshot: EcosystemSnapshot) {
	const blockers: RetirementBlocker[] = []
	const residuals: RetirementResidual[] = []
	for (const shares of snapshot.wallet.shares) {
		const pool = snapshot.pools.find(candidate => candidate.shareToken.toLowerCase() === shares.shareToken.toLowerCase() && candidate.universeId === shares.universeId)
		const balances = [shares.invalid, shares.yes, shares.no]
		if (balances.every(value => BigInt(value) === 0n)) continue
		if (pool === undefined) {
			blockers.push({ category: 'incomplete-discovery', details: `No canonical pool identity was discovered for outcome shares ${shares.shareToken} in universe ${shares.universeId}`, id: `shares:${shares.shareToken}:${shares.universeId}` })
			continue
		}
		if (pool.questionOutcome === 3) {
			const question = snapshot.questions.find(candidate => candidate.id === pool.questionId)
			const end = question === undefined ? undefined : BigInt(question.endTime)
			blockers.push({ category: 'temporarily-locked', details: 'Outcome shares remain unresolved and cannot yet be classified as winning or losing', id: `shares:${shares.shareToken}:${shares.universeId}`, ...(end === undefined ? {} : { nextEligibleAt: new Date(Number(end) * 1_000).toISOString() }) })
			continue
		}
		for (let outcome = 0; outcome < balances.length; outcome += 1) {
			const balance = balances[outcome]
			if (balance === undefined || BigInt(balance) === 0n) continue
			if (outcome !== pool.questionOutcome) residuals.push({ amount: balance, asset: `${shares.shareToken}:${outcome.toString()}`, category: 'losing-share', reason: 'The canonical pool resolution makes this outcome share nonredeemable' })
			else if (BigInt(pool.shareTokenSupplyAttoShares) === 0n || (BigInt(balance) * BigInt(pool.settlementCollateralAttoEth)) / BigInt(pool.shareTokenSupplyAttoShares) === 0n)
				residuals.push({ amount: balance, asset: `${shares.shareToken}:${outcome.toString()}`, category: 'accepted-dust', reason: 'The canonical winning-share payout rounds to zero' })
		}
	}
	return { blockers, residuals }
}

function canonicalClaimableAssetCount(snapshot: EcosystemSnapshot) {
	let count = snapshot.wallet.tokens.filter(token => BigInt(token.openOracleCredit) > 1n).length
	if (BigInt(snapshot.wallet.openOracleEthCredit) > 1n) count += 1
	for (const pool of snapshot.pools) {
		const vault = pool.vaults.find(candidate => candidate.address.toLowerCase() === snapshot.wallet.address.toLowerCase())
		if (vault !== undefined && BigInt(vault.claimableFeesAttoEth) > 0n) count += 1
		if (vault !== undefined && BigInt(vault.repBackingAttoRep) > 0n && BigInt(vault.disputeStakedAttoRep) === 0n && pool.questionOutcome !== 3 && pool.systemState === 0) count += 1
		const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
		if (shares === undefined) continue
		const balances = [BigInt(shares.invalid), BigInt(shares.yes), BigInt(shares.no)]
		if (pool.systemState === 0 && balances.every(value => value > 0n)) count += 1
		const winning = balances[pool.questionOutcome]
		if (pool.systemState === 0 && pool.questionOutcome !== 3 && winning !== undefined && winning > 0n && BigInt(pool.shareTokenSupplyAttoShares) > 0n && (winning * BigInt(pool.settlementCollateralAttoEth)) / BigInt(pool.shareTokenSupplyAttoShares) > 0n) count += 1
	}
	return count
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
	const claimPlan = retirementPlanFromEvaluations(fullLiquidityPlan === undefined ? parameters.evaluations : parameters.evaluations.filter(evaluation => evaluation.plan?.definitionId !== 'trading.liquidity.remove'), parameters.retirement.policies, parameters.snapshot)
	const revocationPlan = buildAllowanceRevocationPlan(parameters.snapshot, Number(parameters.blockNumber & 0xffff_ffffn))
	const nativeCreditPlan = buildNativeOpenOracleCreditPlan(parameters.snapshot, parameters.retirement, Number(parameters.blockNumber & 0xffff_ffffn))
	const sweepPlan = buildAssetSweepPlan(parameters.snapshot, parameters.retirement, Number(parameters.blockNumber & 0xffff_ffffn), parameters.sweepLimits)
	const v3Action = parameters.v3.find(observation => observation.liquidity > 0n || observation.tokensOwed0 > 0n || observation.tokensOwed1 > 0n)
	const approvals = knownApprovalCount(parameters.snapshot)
	const shareClassification = classifyShares(parameters.snapshot)
	const blockers: RetirementBlocker[] = [...parameters.retirement.blockers.filter(blocker => blocker.category === 'ambiguous-position' && blocker.id.startsWith('v3-workflow:')), ...shareClassification.blockers]
	if (parameters.canonicalScanComplete === false) blockers.push({ category: 'incomplete-discovery', details: 'The canonical lifecycle, carry-proof, or topology scan is incomplete', id: 'canonical-scan-incomplete' })
	if (parameters.snapshot.warnings.length !== 0) blockers.push({ category: 'incomplete-discovery', details: parameters.snapshot.warnings.join('; '), id: 'canonical-scan-warnings' })
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'deferred')) {
		blockers.push({ category: 'temporarily-locked', details: `${obligation.label} is not yet eligible`, id: obligation.id, ...(obligation.notBefore === undefined ? {} : { nextEligibleAt: obligation.notBefore }) })
	}
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'pending')) {
		blockers.push({ category: 'temporarily-locked', details: `${obligation.label} is awaiting its next safe canonical execution`, id: obligation.id, ...(obligation.notBefore === undefined ? {} : { nextEligibleAt: obligation.notBefore }) })
	}
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'blocked' || candidate.status === 'failed')) {
		blockers.push({ category: 'operator-action', details: obligation.blockers[0] ?? `${obligation.label} requires reconciliation`, id: obligation.id })
	}
	for (const position of parameters.retirement.positions.filter(candidate => candidate.status === 'blocked')) blockers.push({ category: 'ambiguous-position', details: `Ownership could not be proven for ${position.pool}`, id: position.id })
	for (const position of parameters.retirement.positions.filter(candidate => candidate.status === 'pending-confirmation')) blockers.push({ category: 'ambiguous-position', details: `Position ${position.id} is awaiting canonical pool and ownership verification`, id: position.id })
	const residuals = [...shareClassification.residuals, ...retainedAssetResiduals(parameters.snapshot, parameters.retirement)]
	const canonicalClaims = canonicalClaimableAssetCount(parameters.snapshot)
	if (canonicalClaims > 0 && claimPlan === undefined && nativeCreditPlan === undefined) blockers.push({ category: 'operator-action', details: 'Canonical claimable assets exist but no safe retirement plan is currently executable', id: 'claimable-assets-without-plan' })
	const proof: RetirementProofCounts = {
		actionableObligations,
		claimableAssets: canonicalClaims,
		collectableV3Positions: parameters.v3.filter(value => value.tokensOwed0 > 0n || value.tokensOwed1 > 0n).length,
		knownApprovals: approvals,
		ownedLiquidityPositions: parameters.v3.filter(value => value.liquidity > 0n).length,
		partialWorkflows,
		pendingTransactions: parameters.state.pendingTransactions.length,
	}
	const recoveryPlan = claimPlan ?? fullLiquidityPlan ?? revocationPlan ?? nativeCreditPlan
	const directPlan = recoveryPlan ?? (canonicalClaims === 0 && blockers.length === 0 ? sweepPlan : undefined)
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
		const blockerId = `v3-workflow:${workflow.id}`
		if (typeof metadata['pool'] !== 'string' || typeof metadata['token0'] !== 'string' || typeof metadata['token1'] !== 'string') {
			if (!retirement.blockers.some(blocker => blocker.id === blockerId)) retirement.blockers.push({ category: 'ambiguous-position', details: `Seed workflow ${workflow.id} does not retain enough canonical identity metadata to prove its V3 position`, id: blockerId })
			continue
		}
		retirement.blockers = retirement.blockers.filter(blocker => blocker.id !== blockerId)
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
