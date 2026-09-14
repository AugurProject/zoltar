import { type PoolObservation, type UniverseObservation } from '#state/operator-state'
import { sameAddress } from '@zoltar/core-shared/evm/address'

export function validatePoolUniverseRep(pool: Pick<PoolObservation, 'address' | 'repToken' | 'universeId'>, universes: readonly UniverseObservation[]) {
	const universe = universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined) throw new Error(`Pool ${pool.address} belongs to unknown universe ${pool.universeId.toString()}`)
	if (!sameAddress(pool.repToken, universe.repToken)) {
		throw new Error(`Pool ${pool.address} REP token ${pool.repToken} does not match universe ${pool.universeId.toString()} REP ${universe.repToken}`)
	}
}
