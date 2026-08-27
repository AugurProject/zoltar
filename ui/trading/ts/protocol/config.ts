import type { Address } from '@zoltar/shared/ethereum'

export type DeploymentConfiguration = Readonly<{
	chainId: number
	chainName: string
	rpcUrl: string
	securityPoolFactory: Address
	zoltar: Address
	factory: Address
	router: Address
	feeBps: number
}>

function requiredString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`)
	return value
}

function requiredRpcUrl(value: unknown) {
	const rpcUrl = requiredString(value, 'RPC URL')
	let parsed: URL
	try {
		parsed = new URL(rpcUrl)
	} catch (error) {
		if (error instanceof TypeError) throw new Error('RPC URL must be a valid URL')
		throw error
	}
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('RPC URL must use HTTPS or loopback HTTP')
	if (parsed.username !== '' || parsed.password !== '') throw new Error('RPC URL must not contain embedded credentials')
	return parsed.toString()
}

export function parseDeploymentSetupInput(input: Readonly<{ chainId: string; feeBps: string; rpcUrl: string }>) {
	if (!/^[1-9][0-9]*$/.test(input.chainId)) throw new Error('Chain ID must be a positive whole number')
	const chainId = Number(input.chainId)
	if (!Number.isSafeInteger(chainId)) throw new Error('Chain ID must be a positive safe integer')
	if (!/^[0-9]+$/.test(input.feeBps)) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	const feeBps = Number(input.feeBps)
	if (!Number.isSafeInteger(feeBps) || feeBps >= 10_000) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	return { chainId, feeBps, rpcUrl: requiredRpcUrl(input.rpcUrl) }
}
