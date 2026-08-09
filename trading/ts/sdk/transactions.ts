export type Address = `0x${string}`

export type ContractRequest = Readonly<{
	address: Address
	functionName: string
	args: readonly unknown[]
	value?: bigint
}>

export type SimulationResult<T> = Readonly<{
	blockNumber: bigint
	request: ContractRequest
	result: T
}>

export type SimulationClient<T> = Readonly<{
	getBlockNumber(): Promise<bigint>
	simulate(request: ContractRequest): Promise<T>
}>

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

export async function simulateAuthoritatively<T>(client: SimulationClient<T>, request: ContractRequest): Promise<SimulationResult<T>> {
	const blockNumber = await client.getBlockNumber()
	const result = await client.simulate(request)
	return { blockNumber, request, result }
}

export async function requireFreshSimulation<T>(client: Pick<SimulationClient<T>, 'getBlockNumber'>, simulation: SimulationResult<T>) {
	const currentBlock = await client.getBlockNumber()
	if (currentBlock !== simulation.blockNumber) throw new Error('Quote is stale; simulate the router call again')
	return simulation.request
}

export function extractEventResult<T>(logs: readonly unknown[], decode: (log: unknown) => { eventName: string; args: T } | undefined, eventName: string): T {
	for (const log of logs) {
		const decoded = decode(log)
		if (decoded?.eventName === eventName) return decoded.args
	}
	throw new Error(`Transaction receipt is missing ${eventName}`)
}
