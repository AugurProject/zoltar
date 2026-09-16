import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { parseDeploymentManifest, type DeploymentManifest } from '#config/deployment-auth'
import { validateReadRpcUrls, type NetworkName } from '#monitoring/connectivity'
import { canonicalCoreDeployment, canonicalNetworkDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { record as validateRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'

export type DeploymentSettings = {
	coordinatorAddresses: readonly Address[]
	deploymentManifest: DeploymentManifest | undefined
	executor: Address | undefined
	openOracle: Address
	quorumRpcUrls: readonly string[]
	rep: Address
	uniswapV2Enabled: boolean
	uniswapV3Enabled: boolean
	uniswapV4Enabled: boolean
	uniswapFactory: Address
	uniswapQuoter: Address
	uniswapRouter: Address | undefined
	uniswapV2Router: Address | undefined
	uniswapV4PoolManager: Address | undefined
	uniswapV4Quoter: Address | undefined
	weth: Address
}

export type StoredDeploymentSettings = Pick<DeploymentSettings, 'deploymentManifest' | 'quorumRpcUrls' | 'uniswapV2Enabled' | 'uniswapV3Enabled' | 'uniswapV4Enabled'>

function record(value: unknown) {
	return validateRecord(value, 'Deployment settings', 'Deployment settings must be a JSON object')
}

function optionalAddress(value: unknown, name: string) {
	if (value === undefined || value === null || value === '') return undefined
	if (typeof value !== 'string') throw new Error(`${name} must be an address or empty`)
	return getAddress(value)
}

function venueEnabled(value: unknown, name: string, fallback: () => boolean) {
	if (value === undefined) return fallback()
	if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
	return value
}

function urlArray(value: unknown) {
	if (!Array.isArray(value) || value.length > 8 || value.some(item => typeof item !== 'string')) throw new Error('Quorum RPC URLs must contain no more than 8 URLs')
	return validateReadRpcUrls(value.map(item => String(item)))
}

export function validateDeploymentSettings(value: unknown, network: NetworkName = 'mainnet'): DeploymentSettings {
	const settings = record(value)
	const keys = ['coordinatorAddresses', 'deploymentManifest', 'executor', 'openOracle', 'quorumRpcUrls', 'rep', 'uniswapV2Enabled', 'uniswapV3Enabled', 'uniswapV4Enabled', 'uniswapFactory', 'uniswapQuoter', 'uniswapRouter', 'uniswapV2Router', 'uniswapV4PoolManager', 'uniswapV4Quoter', 'weth']
	const requiredKeys = ['quorumRpcUrls']
	if (Object.keys(settings).some(key => !keys.includes(key)) || requiredKeys.some(key => !(key in settings))) throw new Error('Deployment settings require the supported core deployment fields')
	const manifest = network === 'mainnet' ? mainnet : sepolia
	const identity = canonicalNetworkDeployment(manifest)
	const uniswap = canonicalUniswapDeployment(identity.chainId)
	// Fresh profiles specify switches in the template; missing switches retain legacy venue intent.
	const uniswapV2Enabled = venueEnabled(settings['uniswapV2Enabled'], 'Uniswap V2 enabled', () => optionalAddress(settings['uniswapV2Router'], 'Uniswap V2 router') !== undefined)
	const uniswapV3Enabled = venueEnabled(settings['uniswapV3Enabled'], 'Uniswap V3 enabled', () => optionalAddress(settings['uniswapRouter'], 'Uniswap V3 router') !== undefined)
	const uniswapV4Enabled = venueEnabled(settings['uniswapV4Enabled'], 'Uniswap V4 enabled', () => {
		const poolManager = optionalAddress(settings['uniswapV4PoolManager'], 'Uniswap V4 PoolManager')
		const quoter = optionalAddress(settings['uniswapV4Quoter'], 'Uniswap V4 Quoter')
		if ((poolManager === undefined) !== (quoter === undefined)) throw new Error('Uniswap V4 requires both PoolManager and Quoter')
		return poolManager !== undefined
	})
	return {
		coordinatorAddresses: [],
		deploymentManifest: settings['deploymentManifest'] === undefined || settings['deploymentManifest'] === null ? undefined : parseDeploymentManifest(settings['deploymentManifest']),
		executor: canonicalExecutorIdentity().address,
		openOracle: canonicalCoreDeployment(manifest).openOracle,
		quorumRpcUrls: urlArray(settings['quorumRpcUrls']),
		rep: identity.rep,
		uniswapV2Enabled,
		uniswapV3Enabled,
		uniswapV4Enabled,
		uniswapFactory: uniswap.factory,
		uniswapQuoter: uniswap.quoter,
		uniswapRouter: uniswapV3Enabled ? uniswap.router : undefined,
		uniswapV2Router: uniswapV2Enabled ? uniswap.v2Router : undefined,
		uniswapV4PoolManager: uniswapV4Enabled ? uniswap.v4PoolManager : undefined,
		uniswapV4Quoter: uniswapV4Enabled ? uniswap.v4Quoter : undefined,
		weth: identity.weth,
	}
}

function replacePrimaryRepToken(tokenAddresses: readonly Address[], previousRep: Address, nextRep: Address) {
	return [nextRep, ...tokenAddresses.filter(address => address.toLowerCase() !== previousRep.toLowerCase() && address.toLowerCase() !== nextRep.toLowerCase())]
}

export function assertFocusedDeploymentCompatible(rep: Address, centralizedMarkets: { assetAddress: Address }) {
	if (rep.toLowerCase() !== centralizedMarkets.assetAddress.toLowerCase()) {
		throw new Error('Focused deployment updates cannot change REP without updating the centralized market configuration in the complete configuration editor')
	}
}

export function prepareDeploymentTokenTransition(activeTokenAddresses: readonly Address[], persistedTokenAddresses: readonly Address[] | undefined, previousRep: Address, nextRep: Address) {
	return {
		active: replacePrimaryRepToken(activeTokenAddresses, previousRep, nextRep),
		persisted: replacePrimaryRepToken(persistedTokenAddresses ?? activeTokenAddresses, previousRep, nextRep),
	}
}

export function monitoringTokensForDeployment(value: readonly string[], previousRep: Address, deployment: DeploymentSettings) {
	const parsedAddresses: Address[] = [deployment.rep]
	for (const address of value) {
		const token = getAddress(address)
		if (token.toLowerCase() === previousRep.toLowerCase() && token.toLowerCase() !== deployment.rep.toLowerCase()) continue
		parsedAddresses.push(token)
	}
	return [...new Map(parsedAddresses.map(address => [address.toLowerCase(), address])).values()]
}
