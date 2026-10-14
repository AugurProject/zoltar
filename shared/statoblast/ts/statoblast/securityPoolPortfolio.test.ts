import { describe, expect, test } from 'bun:test'
import { type Address, decodeFunctionData, encodeAbiParameters, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioAllocationPolicyRequest,
	buildPortfolioAllocationRequest,
	buildPortfolioBatchRequest,
	buildPortfolioDeploymentRequest,
	buildPortfolioExecuteRequest,
	buildPortfolioQuestionBatchRequest,
	buildPortfolioRevokePolicyRequest,
	buildPortfolioVaultOperationsRequest,
	exportPortfolioTransaction,
} from './securityPoolPortfolio.js'
import type { VaultOperationsInput } from './vaultOperations.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const vault: Address = '0x0000000000000000000000000000000000000002'
const pool: Address = '0x0000000000000000000000000000000000000003'
const factory: Address = '0x0000000000000000000000000000000000000004'
const vaultAbi = parseAbi([
	'function setAllocationPolicy(uint256 expectedVersion,uint256 expectedNonce,(uint248 universeId,address executor,uint256 expiresAt,uint256 depositBudgetAttoRep,uint256 commitmentIncreaseBudgetAttoEth,uint256 minimumIdleAttoRep,uint256 minimumHealthFactorBps) config,(uint256 questionId,uint256 depositBudgetAttoRep,uint256 maximumCommitmentAttoEth)[] rules)',
	'function revokeAllocationPolicy()',
	'function executeAllocation(uint256 expectedVersion,uint256 expectedNonce,uint256 questionId,uint256 depositAttoRep,uint256 commitmentAttoEth)',
	'function submitQuestionOperationsBatch((uint256 questionId,uint248 universeId,(uint256 depositAttoRep,bool changeCommitment,uint256 commitmentAttoEth,(address targetVault,uint256 requestedDebtAttoEth)[] liquidations,uint256 withdrawAttoRep,uint256 minimumReceiverHealthFactorBps,uint256 validForSeconds) input,uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth,uint256 value,uint256 minimumIdleAttoRep)[] operations,bool requireImmediate) payable returns (uint256[])',
	'function execute(address target, uint256 value, bytes data) payable returns (bytes)',
	'function executeBatch((address target, uint256 value, bytes data)[] calls) payable returns (bytes[])',
	'function submitVaultOperations(uint256 questionId, uint248 universeId, (uint256 depositAttoRep, bool changeCommitment, uint256 commitmentAttoEth, (address targetVault, uint256 requestedDebtAttoEth)[] liquidations, uint256 withdrawAttoRep, uint256 minimumReceiverHealthFactorBps, uint256 validForSeconds) input, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) payable returns (uint256)',
])
const base = { owner, vault, vaultAbi }
const input: VaultOperationsInput = { depositAttoRep: 10n, changeCommitment: false, commitmentAttoEth: 0n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 10_000n, validForSeconds: 60n }
const operations = { ...base, questionId: 51n, universeId: 7n, input, proposedRepPerEthPrice: 2n, requestedInitialAttoWeth: 3n, bountyAttoEth: 4n }

describe('security pool portfolio transaction builders', () => {
	test('keeps the signer separate from the native pool vault owner', () => {
		const request = buildPortfolioVaultOperationsRequest({ ...operations, value: 9n })
		expect(request.account).toBe(owner)
		expect(request.to).toBe(vault)
		expect(request.value).toBe(9n)
		expect(decodeFunctionData({ abi: vaultAbi, data: request.data })).toEqual({ functionName: 'submitVaultOperations', args: [51n, 7n, input, 2n, 3n, 4n] })
	})

	test('rejects liquidation of the contract account itself, while allowing the signer as a separate target', () => {
		const liquidationInput = { ...input, liquidations: [{ targetVault: vault, requestedDebtAttoEth: 1n }] }
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: liquidationInput })).toThrow('Choose another vault to liquidate.')
		const signerTarget = { ...input, liquidations: [{ targetVault: owner, requestedDebtAttoEth: 1n }] }
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: signerTarget })).not.toThrow()
	})

	test('retains native action-count and execution-window checks', () => {
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, validForSeconds: 301n } })).toThrow('Execution window')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, liquidations: Array.from({ length: 5 }, () => ({ targetVault: pool, requestedDebtAttoEth: 1n })) } })).toThrow('Choose at most four')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, depositAttoRep: 0n } })).toThrow('Choose a vault action.')
	})

	test('validates Solidity widths for question, universe, and operation values', () => {
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, questionId: 1n << 256n })).toThrow('Question id must fit uint256.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, universeId: 1n << 248n })).toThrow('Universe id must fit uint248.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, universeId: -1n })).toThrow('Universe id must fit uint248.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, requestedInitialAttoWeth: 1n << 256n })).toThrow('Initial WETH amount must fit uint256.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, depositAttoRep: 1n << 256n } })).toThrow('REP deposit must fit uint256.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, minimumReceiverHealthFactorBps: -1n } })).toThrow('Receiver health factor must fit uint256.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, input: { ...input, liquidations: [{ targetVault: pool, requestedDebtAttoEth: 1n << 256n }] } })).toThrow('Liquidation debt must fit uint256.')
		expect(() => buildPortfolioVaultOperationsRequest({ ...operations, questionId: (1n << 256n) - 1n, universeId: (1n << 248n) - 1n })).not.toThrow()
	})

	test('encodes direct recovery calls and keeps vault spending distinct from attached ETH', () => {
		const call = { target: owner, value: 12n, data: '0x' } as const
		const request = buildPortfolioExecuteRequest({ ...base, call })
		expect(request.account).toBe(owner)
		expect(request.to).toBe(vault)
		expect(request.value).toBe(0n)
		expect(decodeFunctionData({ abi: vaultAbi, data: request.data })).toEqual({ functionName: 'execute', args: [owner, 12n, '0x'] })
	})

	test('preserves batch order, with one explicit transaction funding amount', () => {
		const calls = [
			{ target: pool, value: 0n, data: '0x1234' },
			{ target: owner, value: 12n, data: '0x' },
		] as const
		const request = buildPortfolioBatchRequest({ ...base, calls, value: 5n })
		expect(request.value).toBe(5n)
		expect(decodeFunctionData({ abi: vaultAbi, data: request.data })).toEqual({ functionName: 'executeBatch', args: [calls] })
	})

	test('bounds batches and rejects malformed calls before signing', () => {
		const call = { target: pool, value: 0n, data: '0x' } as const
		expect(() => buildPortfolioBatchRequest({ ...base, calls: [] })).toThrow('Choose one to 16')
		expect(() => buildPortfolioBatchRequest({ ...base, calls: Array.from({ length: 17 }, () => call) })).toThrow('Choose one to 16')
		expect(() => buildPortfolioBatchRequest({ ...base, calls: Array.from({ length: 16 }, () => call) })).not.toThrow()
		expect(() => buildPortfolioExecuteRequest({ ...base, call: { ...call, value: -1n } })).toThrow('Call value must fit uint256.')
		expect(() => buildPortfolioExecuteRequest({ ...base, call: { ...call, data: '0x123' } })).toThrow('whole hexadecimal bytes')
		expect(() => buildPortfolioExecuteRequest({ ...base, call: { ...call, target: '0x0000000000000000000000000000000000000000' } })).toThrow('Call target must be a nonzero address.')
		expect(() => buildPortfolioExecuteRequest({ ...base, call, value: 1n << 256n })).toThrow('Transaction value must fit uint256.')
	})

	test('deploys the manager with the caller-supplied artifact and canonical origin parameters', () => {
		const artifact = {
			abi: [
				{
					type: 'constructor',
					inputs: [
						{ name: 'factory', type: 'address' },
						{ name: 'initialOriginPool', type: 'address' },
						{ name: 'maximumQuestionHorizonSeconds', type: 'uint256' },
					],
					stateMutability: 'nonpayable',
				},
			],
			bytecode: '0x6000',
		} as const
		const request = buildPortfolioDeploymentRequest({ owner, factory, initialOriginPool: pool, maximumQuestionHorizonSeconds: 30n * 86400n, artifact })
		expect(request.account).toBe(owner)
		expect(request.data).toBe(`0x6000${encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [factory, pool, 30n * 86400n]).slice(2)}`)
	})
})

describe('portfolio allocation and smart-account builders', () => {
	const policyBase = { ...base, expectedVersion: 3n, expectedNonce: 9n }
	const config = { universeId: 7n, executor: owner, expiresAt: 1000n, depositBudgetAttoRep: 100n, commitmentIncreaseBudgetAttoEth: 10n, minimumIdleAttoRep: 20n, minimumHealthFactorBps: 12_000n }
	const rules = [{ questionId: 51n, depositBudgetAttoRep: 40n, maximumCommitmentAttoEth: 5n }]
	const operation = { questionId: 51n, universeId: 7n, input, proposedRepPerEthPrice: 0n, requestedInitialAttoWeth: 0n, bountyAttoEth: 0n, value: 3n, minimumIdleAttoRep: 20n }

	test('binds per-question operation value to the exact total attached ETH', () => {
		const operations = [operation, { ...operation, questionId: 52n, value: 5n }]
		const request = buildPortfolioQuestionBatchRequest({ ...base, operations, requireImmediate: true })
		expect(request.value).toBe(8n)
		expect(decodeFunctionData({ abi: vaultAbi, data: request.data })).toEqual({ functionName: 'submitQuestionOperationsBatch', args: [operations, true] })
		expect(() => buildPortfolioQuestionBatchRequest({ ...base, operations: [], requireImmediate: false })).toThrow('one to 16')
		expect(() => buildPortfolioQuestionBatchRequest({ ...base, operations: [{ ...operation, value: 1n << 256n }], requireImmediate: false })).toThrow('Operation value')
		expect(() => buildPortfolioQuestionBatchRequest({ ...base, operations: [{ ...operation, value: (1n << 256n) - 1n }, operation], requireImmediate: false })).toThrow('Transaction value')
	})

	test('encodes owner-installed rules, revoke, and executor version/nonce guards', () => {
		const request = buildPortfolioAllocationPolicyRequest({ ...policyBase, config, rules })
		expect(decodeFunctionData({ abi: vaultAbi, data: request.data })).toEqual({ functionName: 'setAllocationPolicy', args: [3n, 9n, config, rules] })
		expect(request.value).toBe(0n)
		expect(decodeFunctionData({ abi: vaultAbi, data: buildPortfolioRevokePolicyRequest(base).data }).functionName).toBe('revokeAllocationPolicy')
		const allocation = buildPortfolioAllocationRequest({ ...base, executor: owner, expectedVersion: 3n, expectedNonce: 9n, questionId: 51n, depositAttoRep: 20n, commitmentAttoEth: 2n })
		expect(decodeFunctionData({ abi: vaultAbi, data: allocation.data })).toEqual({ functionName: 'executeAllocation', args: [3n, 9n, 51n, 20n, 2n] })
	})

	test('validates per-question authority and buffer before requesting signatures', () => {
		expect(() => buildPortfolioAllocationPolicyRequest({ ...policyBase, expectedVersion: -1n, config, rules })).toThrow('Expected policy version')
		expect(() => buildPortfolioAllocationPolicyRequest({ ...policyBase, expectedNonce: 1n << 256n, config, rules })).toThrow('Expected allocation nonce')
		expect(() => buildPortfolioAllocationPolicyRequest({ ...policyBase, config, rules: [...rules, ...rules] })).toThrow('unique')
		expect(() => buildPortfolioAllocationPolicyRequest({ ...policyBase, config: { ...config, minimumHealthFactorBps: 9999n }, rules })).toThrow('10000')
		expect(() => buildPortfolioAllocationPolicyRequest({ ...policyBase, config: { ...config, universeId: 1n << 248n }, rules })).toThrow('uint248')
		expect(() => buildPortfolioAllocationRequest({ ...base, executor: owner, expectedVersion: -1n, expectedNonce: 9n, questionId: 51n, depositAttoRep: 20n, commitmentAttoEth: 2n })).toThrow('uint256')
	})

	test('exports lossless owner-account calls without confusing the portfolio vault with its signer', () => {
		const request = buildPortfolioQuestionBatchRequest({ ...base, operations: [{ ...operation, value: 10n ** 24n }], requireImmediate: false })
		const exported = exportPortfolioTransaction({ chainId: 1, request })
		expect(exported.from).toBe(owner)
		expect(exported.to).toBe(vault)
		expect(exported.value).toBe('1000000000000000000000000')
		expect(() => JSON.stringify(exported)).not.toThrow()
		expect(() => exportPortfolioTransaction({ chainId: 0, request })).toThrow('valid chain id')
	})
})
