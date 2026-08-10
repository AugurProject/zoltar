import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, getAddress, isHex, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry, test_peripherals_LiquidationApprovalTestMocks_Erc1271LiquidationReceiverMock, test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock } from '../types/contractArtifact'

const TYPEHASH = keccak256(new TextEncoder().encode('LiquidationApproval(address securityPool,address receiverVault,address operator,address targetVault,uint256 maxCumulativeDebtAttoEth,uint256 maxDebtPerLiquidationAttoEth,uint256 minPostLiquidationHealthFactorBps,uint256 validAfter,uint256 validUntil,uint256 nonce)'))

type ApprovalParams = {
	securityPool: Address
	receiverVault: Address
	operator: Address
	targetVault: Address
	maxCumulativeDebtAttoEth: bigint
	maxDebtPerLiquidationAttoEth: bigint
	minPostLiquidationHealthFactorBps: bigint
	validAfter: bigint
	validUntil: bigint
	nonce: bigint
}

function approvalId(params: ApprovalParams) {
	return keccak256(
		encodeAbiParameters(
			[{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
			[TYPEHASH, params.securityPool, params.receiverVault, params.operator, params.targetVault, params.maxCumulativeDebtAttoEth, params.maxDebtPerLiquidationAttoEth, params.minPostLiquidationHealthFactorBps, params.validAfter, params.validUntil, params.nonce],
		),
	)
}

describe('LiquidationApprovalRegistry', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let receiver: WriteClient
	let operator: WriteClient
	let coordinator: Address
	let registry: Address
	let ethereum: ReturnType<typeof getAnvilWindowEthereum>
	const securityPool = `0x${'11'.repeat(20)}` satisfies Address
	const targetVault = `0x${'22'.repeat(20)}` satisfies Address

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		receiver = createWriteClient(ethereum, TEST_ADDRESSES[0], 0)
		operator = createWriteClient(ethereum, TEST_ADDRESSES[1], 0)
		const coordinatorReceipt = await receiver.waitForTransactionReceipt({
			hash: await receiver.sendTransaction({ data: `0x${test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.evm.bytecode.object}` }),
		})
		if (coordinatorReceipt.contractAddress === null || coordinatorReceipt.contractAddress === undefined) throw new Error('Coordinator mock deployment failed')
		coordinator = coordinatorReceipt.contractAddress
		const registryReceipt = await receiver.waitForTransactionReceipt({
			hash: await receiver.sendTransaction({
				data: encodeDeployData({
					abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
					bytecode: `0x${peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.evm.bytecode.object}`,
					args: [],
				}),
			}),
		})
		if (registryReceipt.contractAddress === null || registryReceipt.contractAddress === undefined) throw new Error('Registry deployment failed')
		registry = registryReceipt.contractAddress
		await writeContractAndWait(receiver, () =>
			receiver.writeContract({
				address: registry,
				abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
				functionName: 'initialize',
				args: [coordinator],
			}),
		)
		await writeContractAndWait(receiver, () =>
			receiver.writeContract({
				address: coordinator,
				abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi,
				functionName: 'configure',
				args: [securityPool, registry],
			}),
		)
	})

	function params(overrides: Partial<ApprovalParams> = {}): ApprovalParams {
		return {
			securityPool,
			receiverVault: receiver.account.address,
			operator: operator.account.address,
			targetVault,
			maxCumulativeDebtAttoEth: 10n * 10n ** 18n,
			maxDebtPerLiquidationAttoEth: 4n * 10n ** 18n,
			minPostLiquidationHealthFactorBps: 12_500n,
			validAfter: 0n,
			validUntil: 9_999_999_999n,
			nonce: 0n,
			...overrides,
		}
	}

	test('direct approval reserves at queue time, consumes actual debt, and releases the remainder', async () => {
		const approval = params()
		const id = approvalId(approval)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [approval] }))
		await writeContractAndWait(operator, () =>
			operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [1n, id, approval.receiverVault, targetVault, approval.operator, 8n * 10n ** 18n, 6n * 10n ** 18n, 9_000_000_000n] }),
		)
		let state = await operator.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [id] })
		expect(state.availableDebtAttoEth).toBe(6n * 10n ** 18n)
		expect(state.reservedDebtAttoEth).toBe(4n * 10n ** 18n)
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'consume', args: [1n, 3n * 10n ** 18n] }))
		state = await operator.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [id] })
		expect(state.availableDebtAttoEth).toBe(7n * 10n ** 18n)
		expect(state.reservedDebtAttoEth).toBe(0n)
		expect(state.consumedDebtAttoEth).toBe(3n * 10n ** 18n)
	})

	test('revocation blocks new reservations but does not disturb an existing reservation', async () => {
		const approval = params()
		const id = approvalId(approval)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [approval] }))
		await writeContractAndWait(operator, () =>
			operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [1n, id, approval.receiverVault, targetVault, approval.operator, 2n * 10n ** 18n, 2n * 10n ** 18n, 9_000_000_000n] }),
		)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'revokeLiquidationApproval', args: [id] }))
		await expect(operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [2n, id, approval.receiverVault, targetVault, approval.operator, 1n, 1n, 9_000_000_000n] })).rejects.toThrow(/Approval revoked/)
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'consume', args: [1n, 1n * 10n ** 18n] }))
		const state = await operator.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [id] })
		expect(state.consumedDebtAttoEth).toBe(1n * 10n ** 18n)
		expect(state.reservedDebtAttoEth).toBe(0n)
	})

	test('nonce invalidation blocks new reservations but preserves an existing reservation', async () => {
		const approval = params()
		const id = approvalId(approval)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [approval] }))
		await writeContractAndWait(operator, () =>
			operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [1n, id, approval.receiverVault, targetVault, approval.operator, 2n * 10n ** 18n, 2n * 10n ** 18n, 9_000_000_000n] }),
		)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'invalidateLiquidationApprovalNonce', args: [1n] }))
		await expect(operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [2n, id, approval.receiverVault, targetVault, approval.operator, 1n, 1n, 9_000_000_000n] })).rejects.toThrow(/Nonce invalidated/)
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'consume', args: [1n, 1n * 10n ** 18n] }))
		const state = await operator.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [id] })
		expect(state.consumedDebtAttoEth).toBe(1n * 10n ** 18n)
		expect(state.reservedDebtAttoEth).toBe(0n)
	})

	test('installs an EIP-712 EOA permit and rejects replayed nonces', async () => {
		const accounts = await ethereum.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		const signer = getAddress(accounts[0])
		const approval = params({ receiverVault: signer })
		const typedData = {
			domain: { chainId: 1, name: 'Statoblast Liquidation Approvals', version: '1', verifyingContract: registry },
			primaryType: 'LiquidationApproval',
			types: {
				LiquidationApproval: [
					{ name: 'securityPool', type: 'address' },
					{ name: 'receiverVault', type: 'address' },
					{ name: 'operator', type: 'address' },
					{ name: 'targetVault', type: 'address' },
					{ name: 'maxCumulativeDebtAttoEth', type: 'uint256' },
					{ name: 'maxDebtPerLiquidationAttoEth', type: 'uint256' },
					{ name: 'minPostLiquidationHealthFactorBps', type: 'uint256' },
					{ name: 'validAfter', type: 'uint256' },
					{ name: 'validUntil', type: 'uint256' },
					{ name: 'nonce', type: 'uint256' },
				],
			},
			message: Object.fromEntries(Object.entries(approval).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])),
		}
		const signatureValue = await ethereum.request({ method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typedData)] })
		if (typeof signatureValue !== 'string' || !isHex(signatureValue)) throw new Error('Typed-data signature missing')
		const signature: Hex = `0x${signatureValue.slice(2)}`
		const otherTarget = `0x${'33'.repeat(20)}` satisfies Address
		await writeContractAndWait(operator, () => operator.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'permitLiquidationApproval', args: [approval, signature] }))
		await expect(operator.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'permitLiquidationApproval', args: [{ ...approval, targetVault: otherTarget }, signature] })).rejects.toThrow()
	})

	test('validates ERC-1271 at installation and stores explicit approval state', async () => {
		const walletReceipt = await receiver.waitForTransactionReceipt({ hash: await receiver.sendTransaction({ data: `0x${test_peripherals_LiquidationApprovalTestMocks_Erc1271LiquidationReceiverMock.evm.bytecode.object}` }) })
		const walletAddress = walletReceipt.contractAddress
		if (walletAddress === null || walletAddress === undefined) throw new Error('ERC-1271 mock deployment failed')
		const approval = params({ receiverVault: walletAddress, nonce: 4n })
		const signature = '0x1234' satisfies Hex
		const digest = await receiver.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'liquidationApprovalDigest', args: [approval] })
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: walletAddress, abi: test_peripherals_LiquidationApprovalTestMocks_Erc1271LiquidationReceiverMock.abi, functionName: 'configure', args: [digest, signature, false] }))
		await expect(operator.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'permitLiquidationApproval', args: [approval, signature] })).rejects.toThrow(/Invalid signature/)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: walletAddress, abi: test_peripherals_LiquidationApprovalTestMocks_Erc1271LiquidationReceiverMock.abi, functionName: 'configure', args: [digest, signature, true] }))
		await writeContractAndWait(operator, () => operator.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'permitLiquidationApproval', args: [approval, signature] }))
		const state = await receiver.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [approvalId(approval)] })
		expect(state.availableDebtAttoEth).toBe(approval.maxCumulativeDebtAttoEth)
	})

	test('rejects invalid approval bounds, signer, pool, expiry, and invalidated nonces', async () => {
		const install = async (approval: ApprovalParams, client = receiver) => await client.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [approval] })
		await expect(install(params(), operator)).rejects.toThrow(/Only receiver vault/)
		await expect(install(params({ securityPool: targetVault }))).rejects.toThrow(/Wrong pool/)
		await expect(install(params({ maxCumulativeDebtAttoEth: 0n }))).rejects.toThrow(/Limit zero/)
		await expect(install(params({ maxDebtPerLiquidationAttoEth: 0n }))).rejects.toThrow(/Limit zero/)
		await expect(install(params({ maxCumulativeDebtAttoEth: 1n, maxDebtPerLiquidationAttoEth: 2n }))).rejects.toThrow(/Per operation high/)
		await expect(install(params({ minPostLiquidationHealthFactorBps: 9_999n }))).rejects.toThrow(/Health factor low/)
		await expect(install(params({ validAfter: 2n, validUntil: 1n }))).rejects.toThrow(/Window invalid/)
		await expect(install(params({ validUntil: 1n }))).rejects.toThrow(/Approval expired/)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'invalidateLiquidationApprovalNonce', args: [5n] }))
		await expect(install(params({ nonce: 4n }))).rejects.toThrow(/Nonce invalidated/)
	})

	test('enforces operator, target, activation, validity horizon, quota, and one-time settlement', async () => {
		const futureApproval = params({ validAfter: 9_000_000_000n, validUntil: 10_000_000_000n, nonce: 1n })
		const futureId = approvalId(futureApproval)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [futureApproval] }))
		await expect(operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [99n, futureId, futureApproval.receiverVault, targetVault, futureApproval.operator, 1n, 1n, 9_500_000_000n] })).rejects.toThrow(
			/Approval not active/,
		)
		const approval = params({ targetVault: `0x${'00'.repeat(20)}`, maxCumulativeDebtAttoEth: 5n * 10n ** 18n, maxDebtPerLiquidationAttoEth: 3n * 10n ** 18n })
		const id = approvalId(approval)
		await writeContractAndWait(receiver, () => receiver.writeContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [approval] }))
		const reserve = (operationId: bigint, operatorAddress: Address, latestExecutionTimestamp = 9_000_000_000n) =>
			operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'reserve', args: [operationId, id, approval.receiverVault, `0x${'44'.repeat(20)}`, operatorAddress, 4n * 10n ** 18n, 4n * 10n ** 18n, latestExecutionTimestamp] })
		await expect(reserve(1n, receiver.account.address)).rejects.toThrow(/Wrong operator/)
		await expect(reserve(1n, approval.operator, 10_000_000_000n)).rejects.toThrow(/Approval expires early/)
		await writeContractAndWait(operator, () => reserve(1n, approval.operator))
		await writeContractAndWait(operator, () => reserve(2n, approval.operator))
		const state = await operator.readContract({ address: registry, abi: peripherals_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'getLiquidationApproval', args: [id] })
		expect(state.availableDebtAttoEth).toBe(0n)
		expect(state.reservedDebtAttoEth).toBe(5n * 10n ** 18n)
		await expect(reserve(3n, approval.operator)).rejects.toThrow(/Quota unavailable/)
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'release', args: [1n] }))
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'release', args: [1n] }))
		await writeContractAndWait(operator, () => operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'consume', args: [2n, 2n * 10n ** 18n] }))
		await expect(operator.writeContract({ address: coordinator, abi: test_peripherals_LiquidationApprovalTestMocks_LiquidationApprovalCoordinatorMock.abi, functionName: 'consume', args: [2n, 1n] })).rejects.toThrow(/Reservation invalid/)
	})
})
