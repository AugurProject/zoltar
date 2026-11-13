import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { type Address, getAddress, isAddress, parseAbi, zeroAddress } from './ethereum.ts'
import type { StateRead } from './snapshots.ts'

const abi = parseAbi([
	'function collateralToken() view returns (address)',
	'function portfolio() view returns (address)',
	'function securityPool() view returns (address)',
	'function securityPoolFactory() view returns (address)',
	'function getSecurityPoolPortfolio(address) view returns (address)',
	'function symbol() view returns (string)',
	'function decimals() view returns (uint8)',
])
export type CollateralDisplayUnit = { readonly symbol: string; readonly decimals: number }

// Network-owned successful immutable identities; callers publish only canonical discoveries.
export type CollateralIdentityCache = Pick<Map<string, Address>, 'get' | 'set'>

export const withCollateralIdentityCache =
	(read: StateRead, cache?: CollateralIdentityCache): StateRead =>
	async (address, abi, functionName, args) => {
		const immutableIdentity = ['securityPoolFactory', 'getSecurityPoolPortfolio', 'collateralToken', 'portfolio', 'securityPool'].includes(functionName)
		const key = `${address.toLowerCase()}:${functionName}:${args?.join(':').toLowerCase() ?? ''}`
		const cached = immutableIdentity ? cache?.get(key) : undefined
		if (cached !== undefined) return cached
		const value = await read(address, abi, functionName, args)
		if (immutableIdentity && typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress) cache?.set(key, getAddress(value))
		return value
	}

export async function readCollateralMetadata(token: Address, read: StateRead) {
	const [symbol, units] = await Promise.all([read(token, abi, 'symbol'), read(token, abi, 'decimals')])
	const decimals = Number(units)
	if (typeof symbol !== 'string' || symbol.trim() === '' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid collateral metadata')
	return { address: token.toLowerCase(), symbol, decimals }
}

export async function readContractCollateral(address: Address, kind: string, read: StateRead): Promise<{ unit?: CollateralDisplayUnit; readError?: string } | undefined> {
	const readAddress = async (at: Address, name: string, args?: readonly Address[]) => {
		const value = await read(at, abi, name, args)
		if (typeof value !== 'string' || !isAddress(value)) throw new Error('Invalid collateral dependency')
		return getAddress(value)
	}
	const poolKinds = ['securityPool', 'priceCoordinator', 'openOraclePriceCoordinator', 'twoWayConstantProductPair']
	const portfolioKinds = ['securityPoolReporterLedger', 'securityPoolSettlementBook', 'securityPoolPortfolioServices', 'securityPoolPortfolioPurchase', 'securityPoolCapitalLedger', 'securityPoolPortfolioForkCoordinator', 'securityPoolPortfolioAuction']
	const tokenKinds = ['securityPoolPortfolio', 'sharedPoolPriceFeed', 'securityPoolPortfolioSettlement', 'securityPoolUniformPriceAuction']
	if (![...poolKinds, ...portfolioKinds, ...tokenKinds].includes(kind)) return undefined
	try {
		let source = address
		if (kind === 'priceCoordinator' || kind === 'openOraclePriceCoordinator' || kind === 'twoWayConstantProductPair') source = await readAddress(source, 'securityPool')
		if (poolKinds.includes(kind)) {
			const factory = await readAddress(source, 'securityPoolFactory')
			source = await readAddress(factory, 'getSecurityPoolPortfolio', [source])
		} else if (portfolioKinds.includes(kind)) {
			source = await readAddress(source, 'portfolio')
		}
		return { unit: await readCollateralMetadata(await readAddress(source, 'collateralToken'), read) }
	} catch (error) {
		// Unavailable historical state or token metadata must leave raw units visible.
		return { readError: errorMessage(error) }
	}
}
