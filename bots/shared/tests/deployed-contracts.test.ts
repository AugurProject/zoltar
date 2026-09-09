import { expect, test } from 'bun:test'
import { zeroAddress } from '../src/ethereum.ts'
import { missingContractDeployment, requireDeployedContracts } from '../src/monitoring/deployed-contracts.ts'

const missingClient = { getCode: async () => '0x' as const, getChainId: async () => 11155111 }

test('preserves structured missing deployment details and its diagnostic', async () => {
	const failure: unknown = await requireDeployedContracts(missingClient, [{ name: 'Uniswap V3 factory', address: zeroAddress }], 42n).then(
		() => undefined,
		error => error,
	)
	if (!(failure instanceof Error)) throw new Error('Expected a missing deployment error')
	expect(failure.message).toContain('RPC chain 11155111 at block 42')
	expect(missingContractDeployment(failure)).toEqual({ chainId: 11155111, contracts: [{ name: 'Uniswap V3 factory', address: zeroAddress }] })
})

test('recognizes multiple absent deployments but never classifies RPC errors by their message', async () => {
	const failure: unknown = await requireDeployedContracts(missingClient, [
		{ name: 'Uniswap V3 factory', address: zeroAddress },
		{ name: 'OpenOracle', address: zeroAddress },
	]).then(
		() => undefined,
		error => error,
	)
	expect(missingContractDeployment(failure)?.contracts.map(contract => contract.name)).toEqual(['Uniswap V3 factory', 'OpenOracle'])
	const rpcFailure = new Error('Uniswap V3 factory RPC failed')
	await expect(
		requireDeployedContracts(
			{
				...missingClient,
				getCode: async () => {
					throw rpcFailure
				},
			},
			[{ name: 'Uniswap V3 factory', address: zeroAddress }],
		),
	).rejects.toBe(rpcFailure)
	expect(missingContractDeployment(rpcFailure)).toBeUndefined()
})
