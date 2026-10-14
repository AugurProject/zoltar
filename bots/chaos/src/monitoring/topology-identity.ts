import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { assertExactKeys, requiredRecord } from '../state/validators.ts'

export interface ImmutableTopologyIdentity {
	chainId: number
	openOracle: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	tradingFactory: Address
	tradingRouter: Address
	uniswapV3Factory?: Address | undefined
	weth: Address
	zoltar: Address
}

export function topologyAddress(value: unknown, label: string) {
	if (typeof value !== 'string') throw new Error(`${label} must be an address`)
	try {
		return getAddress(value)
	} catch (error) {
		throw new Error(`${label} must be an address`, { cause: error })
	}
}

export function parseTopologyIdentity(value: unknown, label: string): ImmutableTopologyIdentity {
	const identity = requiredRecord(value, label)
	const addressFields = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'weth', 'zoltar'] as const
	assertExactKeys(identity, ['chainId', ...addressFields, ...('uniswapV3Factory' in identity ? ['uniswapV3Factory'] : [])], ['multicall3'], label)
	// The stateless transaction utility belongs to execution configuration, not persisted protocol topology.
	if ('multicall3' in identity) topologyAddress(identity['multicall3'], `${label}.multicall3`)
	if (typeof identity['chainId'] !== 'number' || !Number.isSafeInteger(identity['chainId']) || identity['chainId'] <= 0) throw new Error(`${label}.chainId must be a positive safe integer`)
	return {
		chainId: identity['chainId'],
		openOracle: topologyAddress(identity['openOracle'], `${label}.openOracle`),
		questionData: topologyAddress(identity['questionData'], `${label}.questionData`),
		securityPoolFactory: topologyAddress(identity['securityPoolFactory'], `${label}.securityPoolFactory`),
		securityPoolForker: topologyAddress(identity['securityPoolForker'], `${label}.securityPoolForker`),
		tradingFactory: topologyAddress(identity['tradingFactory'], `${label}.tradingFactory`),
		tradingRouter: topologyAddress(identity['tradingRouter'], `${label}.tradingRouter`),
		...('uniswapV3Factory' in identity ? { uniswapV3Factory: topologyAddress(identity['uniswapV3Factory'], `${label}.uniswapV3Factory`) } : {}),
		weth: topologyAddress(identity['weth'], `${label}.weth`),
		zoltar: topologyAddress(identity['zoltar'], `${label}.zoltar`),
	}
}

export function sameTopologyIdentity(left: ImmutableTopologyIdentity, right: ImmutableTopologyIdentity) {
	const addressFields = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'uniswapV3Factory', 'weth', 'zoltar'] as const
	return left.chainId === right.chainId && addressFields.every(field => left[field]?.toLowerCase() === right[field]?.toLowerCase())
}
