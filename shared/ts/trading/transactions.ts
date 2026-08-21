export type Address = `0x${string}`
export type Hash = `0x${string}`

export type ContractRequest = Readonly<{
	address: Address
	functionName: string
	args: readonly unknown[]
	value?: bigint
}>

export type SimulationResult<T> = Readonly<{
	blockNumber: bigint
	blockHash: Hash
	request: ContractRequest
	result: T
}>

export type SimulationClient<T> = Readonly<{
	getBlock(): Promise<Readonly<{ number: bigint | null; hash: Hash | null }>>
	simulate(request: ContractRequest, blockHash: Hash): Promise<T>
}>

async function blockIdentity(client: Pick<SimulationClient<unknown>, 'getBlock'>) {
	const block = await client.getBlock()
	if (block.number === null || block.hash === null) throw new Error('Latest block identity is unavailable')
	return { number: block.number, hash: block.hash }
}

export function enterPositionRequest(router: Address, pair: Address, longOutcome: 'YES' | 'NO', amountAttoEth: bigint, minimumLongAttoShares: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'enterPosition', args: [pair, longOutcome === 'YES' ? 1 : 2, minimumLongAttoShares, recipient, deadline], value: amountAttoEth }
}

export function exitPositionRequest(router: Address, pair: Address, longOutcome: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumAttoEth: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'exitPosition', args: [pair, longOutcome === 'YES' ? 1 : 2, completeSetShares, maximumLongShares, minimumAttoEth, recipient, deadline] }
}

export function initializeLiquidityRequest(router: Address, pool: Address, amountAttoEth: bigint, conditionalYesBps: bigint, minimumLiquidity: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'createPairAndInitializeWithEth', args: [pool, conditionalYesBps, minimumLiquidity, recipient, deadline], value: amountAttoEth }
}

export function addLiquidityRequest(router: Address, pair: Address, amountAttoEth: bigint, minimumLiquidity: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'addLiquidityWithEth', args: [pair, minimumLiquidity, recipient, deadline], value: amountAttoEth }
}

export function removeLiquidityRequest(router: Address, pair: Address, liquidity: bigint, minimumYes: bigint, minimumNo: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'removeLiquidity', args: [pair, liquidity, minimumYes, minimumNo, recipient, deadline] }
}

export function redeemCompleteSetRequest(router: Address, securityPool: Address, amountAttoShares: bigint, minimumAttoEth: bigint, recipient: Address, deadline: bigint): ContractRequest {
	return { address: router, functionName: 'redeemCompleteSet', args: [securityPool, amountAttoShares, minimumAttoEth, recipient, deadline] }
}

export function redeemWinningSharesRequest(securityPool: Address): ContractRequest {
	return { address: securityPool, functionName: 'redeemShares', args: [] }
}

export function migrateSharesRequest(shareToken: Address, universeId: bigint, sourceOutcome: 'INVALID' | 'YES' | 'NO', targetOutcomeIndexes: readonly bigint[]): ContractRequest {
	let outcome = 2n
	if (sourceOutcome === 'INVALID') outcome = 0n
	else if (sourceOutcome === 'YES') outcome = 1n
	return { address: shareToken, functionName: 'migrate', args: [(universeId << 8n) | outcome, targetOutcomeIndexes] }
}

export async function simulateAuthoritatively<T>(client: SimulationClient<T>, request: ContractRequest): Promise<SimulationResult<T>> {
	const before = await blockIdentity(client)
	const result = await client.simulate(request, before.hash)
	const after = await blockIdentity(client)
	if (after.number !== before.number || after.hash !== before.hash) throw new Error('Block changed during simulation; simulate the router call again')
	return { blockNumber: before.number, blockHash: before.hash, request, result }
}

export async function requireFreshSimulation<T>(client: Pick<SimulationClient<T>, 'getBlock'>, simulation: SimulationResult<T>) {
	const current = await blockIdentity(client)
	if (current.number !== simulation.blockNumber || current.hash !== simulation.blockHash) throw new Error('Quote is stale; simulate the router call again')
	return simulation.request
}

export function extractEventResult<T>(logs: readonly unknown[], decode: (log: unknown) => { eventName: string; args: T } | undefined, eventName: string): T {
	for (const log of logs) {
		const decoded = decode(log)
		if (decoded?.eventName === eventName) return decoded.args
	}
	throw new Error(`Transaction receipt is missing ${eventName}`)
}
