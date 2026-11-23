import * as process from 'node:process'
import { type Hex, parseUnits } from '@zoltar/core-shared/evm/ethereum'
import { SEPOLIA_CHAIN_ID } from '@zoltar/core-shared/deployment/uniswapDeployments'

const DEFAULT_MAX_FEE_PER_GAS_NANO_ETH = '100'
const DEFAULT_MAX_TOTAL_COST_ETH = '20'

const deploymentOptions = {
	'chain-id': 'CHAIN_ID',
	'max-fee-per-gas-nanoeth': 'MAX_FEE_PER_GAS_NANO_ETH',
	'max-total-cost-eth': 'MAX_TOTAL_COST_ETH',
	'private-key': 'PRIVATE_KEY',
	'rpc-url': 'RPC_URL',
	'etherscan-api-key': 'ETHERSCAN_API_KEY',
} as const

export function parseDeploymentOptions(argv: readonly string[], environment: Readonly<Record<string, string | undefined>> = process.env) {
	const options = Object.entries(deploymentOptions)
	const flags = new Map<string, string>()
	const assignments = new Map<string, string>()
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]
		if (argument === undefined) throw new Error('Missing deployment argument')
		const equals = argument.indexOf('=')
		const name = equals < 0 ? argument : argument.slice(0, equals)
		const flag = options.find(([option]) => name === `--${option}`)
		if (flag !== undefined) {
			const value = equals < 0 ? argv[++index] : argument.slice(equals + 1)
			if (value === undefined || (equals < 0 && (value.startsWith('--') || /^[A-Z_]+=/.test(value)))) throw new Error(`Missing value for ${name}`)
			if (flags.has(flag[1])) throw new Error(`Duplicate deployment flag ${name}`)
			flags.set(flag[1], value)
			continue
		}
		const assignment = options.find(([, key]) => equals >= 0 && key !== 'PRIVATE_KEY' && (name === key || name === `--${key}`))
		if (assignment === undefined) throw new Error('Unknown deployment argument. See --help for accepted options.')
		if (!assignments.has(assignment[1])) assignments.set(assignment[1], argument.slice(equals + 1))
	}
	return (name: (typeof deploymentOptions)[keyof typeof deploymentOptions]) => flags.get(name) ?? assignments.get(name) ?? environment[name]
}

export function parseChainId(value: string | undefined) {
	if (value === undefined) return SEPOLIA_CHAIN_ID
	if (!/^[1-9]\d*$/.test(value)) throw new Error('CHAIN_ID must be a canonical positive decimal integer without leading zeros')
	const chainId = Number(value)
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('CHAIN_ID must be a positive safe integer')
	if (chainId === 1) throw new Error('The testnet deployer refuses Ethereum mainnet chain ID 1')
	return chainId
}

export function parseRpcUrl(value: string | undefined) {
	if (value === undefined || value.trim() === '') throw new Error('RPC_URL or --rpc-url is required')
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch (error) {
		if (error instanceof TypeError) throw new Error('RPC_URL must be a valid URL')
		throw error
	}
	const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('RPC_URL must use HTTPS or loopback HTTP')
	if (parsed.username !== '' || parsed.password !== '') throw new Error('RPC_URL must not contain embedded credentials')
	return parsed.toString()
}

export function parsePrivateKey(value: string | undefined) {
	if (!isPrivateKey(value)) throw new Error('PRIVATE_KEY or --private-key must be a 32-byte 0x-prefixed private key')
	return value
}

function parsePositiveUnits(value: string | undefined, fallback: string, decimals: number, label: string) {
	const normalized = value ?? fallback
	let amount: bigint
	try {
		amount = parseUnits(normalized, decimals)
	} catch (error) {
		throw new Error(`${label} must be a positive decimal amount`, { cause: error })
	}
	if (amount <= 0n) throw new Error(`${label} must be greater than zero`)
	return amount
}

export function parseMaxFeePerGas(value: string | undefined) {
	return parsePositiveUnits(value, DEFAULT_MAX_FEE_PER_GAS_NANO_ETH, 9, 'MAX_FEE_PER_GAS_NANO_ETH')
}

export function parseMaxTotalCost(value: string | undefined) {
	return parsePositiveUnits(value, DEFAULT_MAX_TOTAL_COST_ETH, 18, 'MAX_TOTAL_COST_ETH')
}

export function parseDeploymentCommandLine(argv = process.argv.slice(2), environment: Readonly<Record<string, string | undefined>> = process.env) {
	const value = parseDeploymentOptions(argv, environment)
	return {
		chainId: parseChainId(value('CHAIN_ID')),
		maxFeePerGas: parseMaxFeePerGas(value('MAX_FEE_PER_GAS_NANO_ETH')),
		maxTotalCost: parseMaxTotalCost(value('MAX_TOTAL_COST_ETH')),
		privateKey: parsePrivateKey(value('PRIVATE_KEY')),
		rpcUrl: parseRpcUrl(value('RPC_URL')),
	}
}

function isPrivateKey(value: string | undefined): value is Hex {
	return value !== undefined && /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function getDeploymentHelp() {
	return `Deploy the complete deterministic Zoltar infrastructure to an EVM testnet

Load PRIVATE_KEY from a secret manager or hidden prompt; --private-key=0x... risks shell history exposure.
Flags accept --name=value or --name value. RPC and cost limits also accept uppercase assignments such as RPC_URL=...:
  bun run deploy:testnet -- --rpc-url=https://... --max-fee-per-gas-nanoeth=100 --max-total-cost-eth=20

  --private-key=0x...    Required unless PRIVATE_KEY is set
  --rpc-url=https://...   Required unless RPC_URL is set
  --chain-id=11155111     Defaults to Sepolia chain ID 11155111
  --etherscan-api-key=...  Optional key for post-deploy verification; defaults to ETHERSCAN_API_KEY
  --max-fee-per-gas-nanoeth=100  Rejects higher RPC fee suggestions
  --max-total-cost-eth=20     Caps the preflight estimate and transaction costs

Sepolia uses Uniswap's published WETH, V3 factory, QuoterV2, and V4 contracts plus
a deterministic SwapRouter and genesis REP; an Anvil node with the Sepolia chain ID
receives Uniswap's contracts by replaying their creation transactions. Both Yes
and No genesis REP tokens and their Zoltar, Statoblast, and Trading roots deploy.
Any other chain receives deterministic WETH and a complete Uniswap deployment.
The RPC must support Cancun, the Osaka CLZ opcode, EIP-1559, and the canonical
legacy deployer transactions. Ethereum mainnet chain ID 1 is intentionally rejected.`
}
