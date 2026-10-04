import { UNISWAP_POSITION_RANGES } from '../../src/core/uniswap-ranges.ts'
import { address, snapshotFixture } from './fixture.ts'

export function uniswapActionsFixture() {
	const snapshot = snapshotFixture()
	const universe = snapshot.universes[0]
	if (universe === undefined) throw new Error('Universe missing')
	snapshot.universeUniswap = {
		factory: true,
		proxy: true,
		seeder: true,
		router: address(44),
		routerAuthenticated: true,
		pools: [
			{
				initialized: true,
				liquidity: '1000',
				pool: address(41),
				repToken: universe.repToken,
				universeId: '0',
				sqrtPriceX96: (1n << 96n).toString(),
				tick: 0,
				repBalanceAttoRep: 1000000n.toString(),
				wethBalanceAttoEth: 1000000n.toString(),
				positions: UNISWAP_POSITION_RANGES.map(range => ({ ...range, liquidity: '100', collectable0: '10', collectable1: '20' })),
			},
		],
	}
	return snapshot
}
