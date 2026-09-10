import { getAddress, type Address, type PublicClient } from '@zoltar/bot-shared/ethereum'
import { retirementUniswapV3PositionAbi } from '../contracts/retirement-abi.ts'
import { encodeStep, planBase } from '../operations/planning.ts'
import type { EcosystemSnapshot, OperationPlan } from '../operations/types.ts'
import { uniswapV3PositionKey, type DurableRetirementState, type DurableV3Position } from '../state/retirement.ts'
import type { DurableState } from '../state/operator-state.ts'
import type { V3PositionAnchor, V3PositionObservation, V3PositionReader } from './retirement-types.ts'

async function assertV3EndpointAnchor(client: Pick<PublicClient, 'getBlock'>, position: DurableV3Position, anchor: V3PositionAnchor) {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	if (block.hash === null || block.hash === undefined || block.hash.toLowerCase() !== anchor.blockHash.toLowerCase()) {
		throw new Error(`Retirement position ${position.id} RPC endpoint does not match canonical anchor ${anchor.blockHash} at block ${anchor.blockNumber.toString()}`)
	}
}

export async function readV3Position(client: Pick<PublicClient, 'getBlock' | 'getTransactionReceipt' | 'readContract'>, position: DurableV3Position, anchor: V3PositionAnchor): Promise<V3PositionObservation> {
	await assertV3EndpointAnchor(client, position, anchor)
	if (position.registeredBy === 'workflow') {
		if (position.creationTransactionHash === undefined) throw new Error(`Retirement position ${position.id} is missing its canonical creation transaction`)
		const receipt = await client.getTransactionReceipt({ hash: position.creationTransactionHash })
		if (receipt.status !== 'success' || receipt.blockNumber > anchor.blockNumber) throw new Error(`Retirement position ${position.id} does not have a successful canonical creation receipt at the scan anchor`)
		const creationBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
		if (creationBlock.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`Retirement position ${position.id} creation receipt is not canonical`)
	}
	const [token0, token1, fee, result] = await Promise.all([
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber: anchor.blockNumber, functionName: 'token0' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber: anchor.blockNumber, functionName: 'token1' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, blockNumber: anchor.blockNumber, functionName: 'fee' }),
		client.readContract({ abi: retirementUniswapV3PositionAbi, address: position.pool, args: [position.positionKey], blockNumber: anchor.blockNumber, functionName: 'positions' }),
	])
	await assertV3EndpointAnchor(client, position, anchor)
	if (getAddress(token0).toLowerCase() !== position.token0.toLowerCase() || getAddress(token1).toLowerCase() !== position.token1.toLowerCase() || Number(fee) !== position.fee) throw new Error(`Retirement position ${position.id} does not match its canonical pool identity`)
	return { liquidity: result[0], position, tokensOwed0: result[3], tokensOwed1: result[4] }
}

export async function readV3PositionsWithQuorum(readers: readonly V3PositionReader[], requiredQuorum: number, positions: readonly DurableV3Position[], anchor: V3PositionAnchor) {
	if (readers.length < requiredQuorum) throw new Error('Retirement V3 scan does not have enough RPC clients for quorum')
	const observations: V3PositionObservation[] = []
	for (const position of positions.filter(candidate => candidate.status === 'active' || candidate.status === 'blocked' || candidate.status === 'collect-only' || candidate.status === 'pending-confirmation')) {
		const settled = await Promise.allSettled(readers.map(reader => reader(position, anchor)))
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
