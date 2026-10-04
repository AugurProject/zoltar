import type { CanonicalUintString } from '../core/units.ts'
import type { Address } from '@zoltar/bot-shared/ethereum'

export interface UniswapPositionSnapshot {
	tickLower: number
	tickUpper: number
	liquidity: string
	collectable0: string
	collectable1: string
}

export interface UniverseUniswapPoolSnapshot {
	sqrtPriceX96?: string
	tick?: number
	repBalanceAttoRep?: CanonicalUintString
	wethBalanceAttoEth?: CanonicalUintString
	positions?: UniswapPositionSnapshot[]
	universeId: string
	repToken: Address
	initialized: boolean
	liquidity: string
	pool?: Address | undefined
}

export interface UniverseUniswapSnapshot {
	router?: Address
	routerAuthenticated?: boolean
	factory: boolean
	proxy: boolean
	seeder: boolean
	pools: UniverseUniswapPoolSnapshot[]
}
