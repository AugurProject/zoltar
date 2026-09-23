import { createPublicClient, type Address, toHex } from '@zoltar/bot-shared/ethereum'
import { requestTransport } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, quorumValue, settledQuorumValue, sharedQuorumBlockNumber } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { OperatorSettings } from '../config/settings.ts'
import { erc1155Abi, erc20Abi, openOracleAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { assertCanonicalAnchorFreshness } from '../core/canonical-freshness.ts'
import { type CanonicalExecutionAnchor, type ExecutionEnvironment, type CanonicalCallAnchor, type ExactRpcTransaction } from './execution-context.ts'

function sameCanonicalAttesters(left: ReadonlySet<string>, right: ReadonlySet<string>) {
	return left.size === right.size && [...left].every(rpcUrl => right.has(rpcUrl))
}

export function sameCanonicalExecutionAnchor(left: CanonicalExecutionAnchor, right: CanonicalExecutionAnchor) {
	return left.number === right.number && left.hash.toLowerCase() === right.hash.toLowerCase() && left.baseFeePerGas === right.baseFeePerGas && left.timestamp === right.timestamp && sameCanonicalAttesters(left.attestingRpcUrls, right.attestingRpcUrls)
}

export function requiredConnectivity(settings: OperatorSettings) {
	if (settings.connectivity === undefined) throw new Error('Execution requires configured RPC connectivity')
	return settings.connectivity
}

export function executionReadClients(environment: ExecutionEnvironment) {
	const connectivity = requiredConnectivity(environment.settings)
	return [connectivity.readRpcUrl, ...connectivity.quorumRpcUrls].map(rpcUrl => {
		const transport = environment.pool.transportFor(rpcUrl)
		return {
			client: createPublicClient({
				chain: environment.chain,
				transport,
			}),
			endpoint: endpointLabel(rpcUrl),
			rpcUrl,
			transport,
		}
	})
}

export async function agreedLatestBlock(environment: ExecutionEnvironment, label: string): Promise<CanonicalExecutionAnchor> {
	const connectivity = requiredConnectivity(environment.settings)
	const readers = executionReadClients(environment)
	const settledHeads = await Promise.allSettled(
		readers.map(async reader => {
			const [chainId, value] = await Promise.all([reader.client.getChainId(), reader.client.getBlockNumber()])
			if (chainId !== environment.settings.network.chainId) {
				throw new Error(`RPC ${reader.endpoint} returned chain ID ${chainId.toString()}, expected ${environment.settings.network.chainId.toString()}`)
			}
			return { reader, value }
		}),
	)
	const heads = availableSettledValues(settledHeads)
	if (heads.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints`)
	}
	const blockNumber = sharedQuorumBlockNumber(
		heads.map(head => head.value),
		connectivity.rpcQuorum,
	)
	const settledBlocks = await Promise.allSettled(
		heads
			.filter(head => head.value >= blockNumber)
			.map(async ({ reader: { client, endpoint, rpcUrl } }) => {
				const candidate = await client.getBlock({ blockNumber })
				return {
					endpoint,
					rpcUrl,
					value: {
						baseFeePerGas: candidate.baseFeePerGas,
						hash: candidate.hash,
						number: candidate.number,
						timestamp: candidate.timestamp,
					},
				}
			}),
	)
	const blockObservations = availableSettledValues(settledBlocks)
	if (blockObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with block identity evidence`)
	}
	const block = quorumValue(
		label,
		blockObservations.map(({ endpoint, value }) => ({ endpoint, value })),
		connectivity.rpcQuorum,
	)
	if (block.number === undefined || block.hash == null || block.baseFeePerGas == null) {
		throw new Error(`${label} is missing EIP-1559 identity`)
	}
	if (block.number !== blockNumber) {
		throw new Error(`${label} returned block ${block.number.toString()}, expected ${blockNumber.toString()}`)
	}
	assertCanonicalAnchorFreshness(
		heads.map(head => head.value),
		block.number,
		block.timestamp,
		environment.clock?.() ?? Date.now(),
	)
	const blockHash = block.hash
	const attestingRpcUrls = new Set(blockObservations.filter(observation => observation.value.number === block.number && observation.value.hash?.toLowerCase() === blockHash.toLowerCase()).map(observation => observation.rpcUrl))
	if (attestingRpcUrls.size < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} does not have enough RPC endpoints attesting its canonical identity`)
	}
	return {
		attestingRpcUrls,
		baseFeePerGas: block.baseFeePerGas,
		hash: blockHash,
		number: block.number,
		timestamp: block.timestamp,
	}
}

export async function agreedPendingNonce(environment: ExecutionEnvironment, address: Address, capableRpcUrls?: ReadonlySet<string> | undefined) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		'pending signer nonce',
		executionReadClients(environment)
			.filter(({ rpcUrl }) => capableRpcUrls?.has(rpcUrl) ?? true)
			.map(async ({ client, endpoint }) => ({
				endpoint,
				value: await client.getTransactionCount({
					address,
					blockTag: 'pending',
				}),
			})),
		connectivity.rpcQuorum,
	)
}

export async function agreedConfirmedNonce(environment: ExecutionEnvironment, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		'confirmed signer nonce',
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.getTransactionCount({ address, blockNumber }),
		})),
		connectivity.rpcQuorum,
	)
}

export function assertNoUnmanagedPendingNonce(confirmedNonce: bigint, pendingNonce: bigint) {
	if (confirmedNonce < 0n || pendingNonce < 0n) {
		throw new Error('Signer nonces cannot be negative')
	}
	if (pendingNonce !== confirmedNonce) {
		throw new Error(`Signer has an unmanaged pending nonce: confirmed ${confirmedNonce.toString()}, pending ${pendingNonce.toString()}`)
	}
	return pendingNonce
}

export async function agreedEthBalance(environment: ExecutionEnvironment, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		`ETH balance for ${address}`,
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.getBalance({ address, blockNumber }),
		})),
		connectivity.rpcQuorum,
	)
}

export async function agreedTokenBalance(environment: ExecutionEnvironment, token: Address, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		`token ${token} balance for ${address}`,
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.readContract({
				abi: erc20Abi,
				address: token,
				args: [address],
				blockNumber,
				functionName: 'balanceOf',
			}),
		})),
		connectivity.rpcQuorum,
	)
}

type ExecutionReadClient = ReturnType<typeof executionReadClients>[number]

export function canonicalAttestingReaders(environment: ExecutionEnvironment, label: string, attestingRpcUrls: ReadonlySet<string>) {
	const connectivity = requiredConnectivity(environment.settings)
	const readers = executionReadClients(environment).filter(({ rpcUrl }) => attestingRpcUrls.has(rpcUrl))
	if (attestingRpcUrls.size < connectivity.rpcQuorum || readers.length !== attestingRpcUrls.size) {
		throw new ConnectivityDegradedError(`${label} requires every canonical attesting RPC endpoint to remain configured`)
	}
	return readers
}

async function everyCanonicalAttester<T>(environment: ExecutionEnvironment, label: string, attestingRpcUrls: ReadonlySet<string>, read: (reader: ExecutionReadClient) => Promise<T>) {
	const readers = canonicalAttestingReaders(environment, label, attestingRpcUrls)
	const settled = await Promise.allSettled(readers.map(read))
	const available = availableSettledValues(settled)
	if (available.length !== readers.length) {
		const unavailable = settled.flatMap((result, index) => {
			if (result.status === 'fulfilled') return []
			const reader = readers[index]
			return reader === undefined ? [] : [reader.endpoint]
		})
		throw new ConnectivityDegradedError(`${label} requires every canonical attesting RPC endpoint${unavailable.length === 0 ? '' : `; unavailable: ${unavailable.join(', ')}`}`)
	}
	return available
}

export async function exactAttestedEthBalance(environment: ExecutionEnvironment, address: Address, anchor: CanonicalCallAnchor) {
	const label = `ETH balance for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.getBalance({ address, blockNumber: anchor.number }),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function exactAttestedTokenBalance(environment: ExecutionEnvironment, token: Address, address: Address, anchor: CanonicalCallAnchor) {
	const label = `token ${token} balance for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: erc20Abi,
			address: token,
			args: [address],
			blockNumber: anchor.number,
			functionName: 'balanceOf',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function exactAttestedOpenOracleCredit(environment: ExecutionEnvironment, openOracle: Address, asset: Address, address: Address, anchor: CanonicalCallAnchor) {
	const label = `OpenOracle ${openOracle} credit for ${address} and ${asset}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: openOracleAbi,
			address: openOracle,
			args: [address, asset],
			blockNumber: anchor.number,
			functionName: 'tokenHolder',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function exactAttestedSecurityPoolVaultRep(environment: ExecutionEnvironment, pool: Address, vault: Address, anchor: CanonicalCallAnchor) {
	const label = `SecurityPool ${pool} vault REP backing for ${vault}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => {
		const [repBackingUnits] = await client.readContract({
			abi: securityPoolAbi,
			address: pool,
			args: [vault],
			blockNumber: anchor.number,
			functionName: 'securityVaults',
		})
		return {
			endpoint,
			value: await client.readContract({
				abi: securityPoolAbi,
				address: pool,
				args: [repBackingUnits],
				blockNumber: anchor.number,
				functionName: 'backingUnitsToAttoRep',
			}),
		}
	})
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function exactAttestedErc1155Balance(environment: ExecutionEnvironment, token: Address, address: Address, tokenId: bigint, anchor: CanonicalCallAnchor) {
	const label = `ERC-1155 ${token} balance ${tokenId.toString()} for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: erc1155Abi,
			address: token,
			args: [address, tokenId],
			blockNumber: anchor.number,
			functionName: 'balanceOf',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function agreedExactCall(environment: ExecutionEnvironment, label: string, transaction: ExactRpcTransaction, anchor: CanonicalCallAnchor) {
	const blockTag = toHex(anchor.number)
	const read = async ({ endpoint, rpcUrl }: ExecutionReadClient) => {
		const result = await requestTransport<unknown>(environment.pool.transportFor(rpcUrl), {
			method: 'eth_call',
			params: [transaction, blockTag],
		})
		if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) {
			throw new Error(`${label} RPC returned invalid simulation data`)
		}
		return { endpoint, value: result.toLowerCase() }
	}
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, read)
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function agreedMaximumGasEstimate(environment: ExecutionEnvironment, label: string, transaction: ExactRpcTransaction, anchor: CanonicalCallAnchor) {
	const blockTag = toHex(anchor.number)
	const estimates = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ endpoint, rpcUrl }) => {
		const result = await requestTransport<unknown>(environment.pool.transportFor(rpcUrl), {
			method: 'eth_estimateGas',
			params: [transaction, blockTag],
		})
		if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
			throw new Error(`${label} RPC returned an invalid gas estimate`)
		}
		const value = BigInt(result)
		if (value === 0n) throw new Error(`${label} RPC returned a zero gas estimate`)
		return { endpoint, value }
	})
	return estimates.reduce((maximum, estimate) => (estimate.value > maximum ? estimate.value : maximum), 0n)
}
