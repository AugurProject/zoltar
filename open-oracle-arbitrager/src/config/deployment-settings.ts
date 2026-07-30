import { getAddress, type Address } from '#ethereum'
import { parseDeploymentManifest, type DeploymentManifest } from '#config/deployment-auth'

export type DeploymentSettings = {
	coordinatorAddresses: readonly Address[]
	deploymentManifest: DeploymentManifest | undefined
	executor: Address | undefined
	openOracle: Address
	quorumRpcUrls: readonly string[]
	rep: Address
	uniswapFactory: Address
	uniswapQuoter: Address
	uniswapRouter: Address | undefined
	uniswapV2Router: Address | undefined
	uniswapV4PoolManager: Address | undefined
	uniswapV4Quoter: Address | undefined
	weth: Address
}

function record(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Deployment settings must be a JSON object')
	return value as Record<string, unknown>
}

function optionalAddress(value: unknown, name: string) {
	if (value === undefined || value === null || value === '') return undefined
	if (typeof value !== 'string') throw new Error(`${name} must be an address or empty`)
	return getAddress(value)
}

function addressArray(value: unknown, name: string) {
	if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be an array of addresses`)
	return [...new Map(value.map(item => getAddress(String(item))).map(address => [address.toLowerCase(), address])).values()]
}

function urlArray(value: unknown) {
	if (!Array.isArray(value) || value.length > 8 || value.some(item => typeof item !== 'string')) throw new Error('Quorum RPC URLs must contain no more than 8 URLs')
	return value.map(item => {
		const url = new URL(String(item))
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Quorum RPC URLs must use http or https')
		return url.toString()
	})
}

export function validateDeploymentSettings(value: unknown): DeploymentSettings {
	const settings = record(value)
	const keys = ['coordinatorAddresses', 'deploymentManifest', 'executor', 'openOracle', 'quorumRpcUrls', 'rep', 'uniswapFactory', 'uniswapQuoter', 'uniswapRouter', 'uniswapV2Router', 'uniswapV4PoolManager', 'uniswapV4Quoter', 'weth']
	const requiredKeys = ['coordinatorAddresses', 'openOracle', 'quorumRpcUrls', 'rep', 'uniswapFactory', 'uniswapQuoter', 'weth']
	if (Object.keys(settings).some(key => !keys.includes(key)) || requiredKeys.some(key => !(key in settings))) throw new Error('Deployment settings require the supported core deployment fields')
	const v4PoolManager = optionalAddress(settings['uniswapV4PoolManager'], 'Uniswap V4 PoolManager')
	const v4Quoter = optionalAddress(settings['uniswapV4Quoter'], 'Uniswap V4 Quoter')
	if ((v4PoolManager === undefined) !== (v4Quoter === undefined)) throw new Error('Uniswap V4 requires both PoolManager and Quoter')
	return {
		coordinatorAddresses: addressArray(settings['coordinatorAddresses'], 'Coordinator addresses'),
		deploymentManifest: settings['deploymentManifest'] === undefined || settings['deploymentManifest'] === null ? undefined : parseDeploymentManifest(settings['deploymentManifest']),
		executor: optionalAddress(settings['executor'], 'Executor'),
		openOracle: getAddress(String(settings['openOracle'])),
		quorumRpcUrls: urlArray(settings['quorumRpcUrls']),
		rep: getAddress(String(settings['rep'])),
		uniswapFactory: getAddress(String(settings['uniswapFactory'])),
		uniswapQuoter: getAddress(String(settings['uniswapQuoter'])),
		uniswapRouter: optionalAddress(settings['uniswapRouter'], 'Uniswap V3 router'),
		uniswapV2Router: optionalAddress(settings['uniswapV2Router'], 'Uniswap V2 router'),
		uniswapV4PoolManager: v4PoolManager,
		uniswapV4Quoter: v4Quoter,
		weth: getAddress(String(settings['weth'])),
	}
}

export function replacePrimaryRepToken(tokenAddresses: readonly Address[], previousRep: Address, nextRep: Address) {
	return [nextRep, ...tokenAddresses.filter(address => address.toLowerCase() !== previousRep.toLowerCase() && address.toLowerCase() !== nextRep.toLowerCase())]
}

export function prepareDeploymentTokenTransition(activeTokenAddresses: readonly Address[], restartTokenAddresses: readonly Address[] | undefined, previousRep: Address, nextRep: Address) {
	return {
		active: [...activeTokenAddresses],
		restart: replacePrimaryRepToken(restartTokenAddresses ?? activeTokenAddresses, previousRep, nextRep),
	}
}
