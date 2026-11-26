import { useEffect, useState } from 'preact/hooks'
import { createActiveEnvironmentGuard, getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capital, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as index } from '../../../contractArtifact.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import * as copy from '../../../copy/securityPoolTakeover.js'
import type { useSecurityPool } from './useSecurityPool.js'

export type TakeoverSnapshot = Pick<
	NonNullable<ReturnType<typeof useSecurityPool>['snapshot']>,
	| 'universeId'
	| 'timestamp'
	| 'chainId'
	| 'blockNumber'
	| 'blockHash'
	| 'capitalLedger'
	| 'commitmentIndex'
	| 'owner'
	| 'economics'
	| 'forkTime'
	| 'frozen'
	| 'importing'
	| 'liquidationPrice'
	| 'conservativePrice'
	| 'ownerConservativePrice'
	| 'securityMultiplierBps'
	| 'totalCommitmentAttoEth'
	| 'demandAttoEth'
	| 'ownerAccount'
	| 'positions'
> & { collateral: { symbol: string; decimals: number }; liquidationDuration?: bigint | undefined }

async function loadTarget(snapshot: TakeoverSnapshot, id: bigint) {
	const client = createConnectedReadClient()
	const [position, started, epoch, penaltyPaid, elapsed] = await Promise.all([
		client.readContract({ address: snapshot.commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'liquidationStarted', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch', blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'liquidationPenaltyPaid', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'liquidationElapsed', args: [id], blockNumber: snapshot.blockNumber }),
	])
	return { position, started, epoch, penaltyPaid, elapsed }
}

export type LiquidationTarget = Awaited<ReturnType<typeof loadTarget>>
export type LiquidationHealth = { bps: bigint; threshold: bigint; belowLiquidation: boolean }

export function liquidationHealth(pool: TakeoverSnapshot, position: Pick<LiquidationTarget['position'], 'commitment' | 'maxHealthyPrice'>): LiquidationHealth | undefined {
	if (position.commitment === 0n || pool.conservativePrice <= 0n || pool.liquidationPrice <= 0n) return undefined
	return {
		bps: (position.maxHealthyPrice * 10_000n) / pool.conservativePrice,
		threshold: (pool.liquidationPrice * 10_000n) / pool.conservativePrice,
		belowLiquidation: position.maxHealthyPrice < pool.liquidationPrice,
	}
}

function liquidationTargetPage(pool: TakeoverSnapshot, id: string) {
	return `liquidation:${pool.capitalLedger.toLowerCase()}:${id}`
}

function decodeTarget(value: unknown) {
	return decodeStoredValue(value, read => {
		const target = read.record('target')
		const position = target.record('position')
		return {
			blockHash: read.string('blockHash'),
			health: read.optional('health', key => {
				const health = read.record(key)
				return { bps: health.bigint('bps'), threshold: health.bigint('threshold'), belowLiquidation: health.boolean('belowLiquidation') }
			}),
			target: {
				position: {
					owner: position.address('owner'),
					batch: position.bigint('batch'),
					rep: position.bigint('rep'),
					commitment: position.bigint('commitment'),
					maxHealthyPrice: position.bigint('maxHealthyPrice'),
					releasedRep: position.bigint('releasedRep'),
					ethFees: position.bigint('ethFees'),
					repFees: position.bigint('repFees'),
					remainingCommitment: position.bigint('remainingCommitment'),
				},
				started: target.bigint('started'),
				epoch: target.bigint('epoch'),
				penaltyPaid: target.bigint('penaltyPaid'),
				elapsed: target.bigint('elapsed'),
			},
		}
	})
}

export function readKnownLiquidationTargets(pool: TakeoverSnapshot, ids: readonly string[]) {
	const pages = ids.map(id => liquidationTargetPage(pool, id))
	const cache = statoblastDisplayCache(getActiveBackend().profile, { universeId: pool.universeId, owner: pool.owner, page: '' }, decodeTarget)
	const saved = cache.readMany(pages)
	return new Map(ids.map(id => [id, saved.get(liquidationTargetPage(pool, id))]))
}

export function useLiquidationTarget(snapshot: TakeoverSnapshot | undefined, presentationSnapshot: TakeoverSnapshot | undefined, id: bigint | undefined) {
	const backend = getActiveBackend()
	const pool = snapshot ?? presentationSnapshot
	const page = pool === undefined || id === undefined || id === 0n ? undefined : liquidationTargetPage(pool, id.toString())
	const identity = page === undefined || pool === undefined ? undefined : `${backend.id}:${backend.profile.genesisRepTokenAddress}:${pool.chainId}:${pool.universeId}:${pool.owner.toLowerCase()}:${page}`
	const [attempt, setAttempt] = useState(0)
	const requestKey = snapshot === undefined || identity === undefined ? undefined : `${identity}:${snapshot.blockHash}:${attempt}`
	const cache = pool === undefined || page === undefined ? undefined : statoblastDisplayCache(backend.profile, { universeId: pool.universeId, owner: pool.owner, page }, decodeTarget)
	const [saved, setSaved] = useState<{ identity: string; target: LiquidationTarget; blockHash: string; savedAt: number; health: LiquidationHealth | undefined }>()
	const [observed, setObserved] = useState<{ identity: string; snapshot: TakeoverSnapshot; target: LiquidationTarget; savedAt: number }>()
	const [result, setResult] = useState<{ key: string; value?: LiquidationTarget; error?: string }>()
	useEffect(() => {
		if (identity === undefined || cache === undefined) return
		const cached = cache.read()
		if (cached !== undefined) setSaved({ identity, ...cached.value, savedAt: cached.savedAt })
	}, [identity])
	useEffect(() => {
		if (snapshot === undefined || id === undefined || identity === undefined || requestKey === undefined) return
		let current = true
		const environment = createActiveEnvironmentGuard()
		void withTimeout(loadTarget(snapshot, id), 15_000, copy.readTimeout)
			.then(value => {
				if (!current || !environment.isCurrent()) return
				setResult({ key: requestKey, value })
				setObserved({ identity, target: value, snapshot, savedAt: Date.now() })
				cache?.write({ target: value, blockHash: snapshot.blockHash, health: liquidationHealth(snapshot, value.position) }, { number: snapshot.blockNumber, timestamp: snapshot.timestamp })
			})
			.catch(error => {
				if (current && environment.isCurrent()) setResult({ key: requestKey, error: getErrorDetail(error, copy.unavailable) ?? copy.unavailable })
			})
		return () => {
			current = false
		}
	}, [requestKey])
	const loaded = result?.key === requestKey ? result : undefined
	const lastObserved = observed?.identity === identity ? observed : undefined
	const lastSaved = saved?.identity === identity ? saved : undefined
	const fallback = lastObserved ?? lastSaved
	const target = loaded?.value ?? fallback?.target
	const displaySnapshot = loaded?.value !== undefined ? snapshot : (lastObserved?.snapshot ?? (pool?.blockHash === lastSaved?.blockHash ? pool : undefined))
	return {
		fresh: loaded?.value,
		target,
		health: target !== undefined && displaySnapshot !== undefined ? liquidationHealth(displaySnapshot, target.position) : lastSaved?.health,
		displayedAt: lastObserved?.savedAt ?? lastSaved?.savedAt,
		displaySnapshot,
		loading: identity !== undefined && loaded === undefined,
		error: loaded?.error,
		retry: () => setAttempt(previous => previous + 1),
	}
}
