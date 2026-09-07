import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { encodeDeployData, getAddress, isHex, type Address, type Hex } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { GenesisReputationToken_GenesisReputationToken } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

function splitSignature(signature: string) {
	if (signature.length !== 132) throw new Error('Expected a 65-byte signature')
	return {
		r: `0x${signature.slice(2, 66)}` as Hex,
		s: `0x${signature.slice(66, 130)}` as Hex,
		v: Number.parseInt(signature.slice(130, 132), 16),
	}
}

describe('REP token authorizations', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let ethereum: AnvilWindowEthereum
	let relayer: WriteClient
	let owner: Address
	let other: Address
	let token: Address

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		relayer = createWriteClient(ethereum, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(ethereum)
		const accounts = await ethereum.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		owner = getAddress(accounts[0])
		if (typeof accounts[1] !== 'string') throw new Error('Second Anvil signer missing')
		other = getAddress(accounts[1])
		const deployment = encodeDeployData({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
			args: [[owner], [1_000n]],
		})
		const receipt = await relayer.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ data: deployment }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Genesis REP deployment failed')
		token = receipt.contractAddress
	})

	const signTypedData = async (typedData: object, signer = owner) => {
		const signature = await ethereum.request({ method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typedData)] })
		if (typeof signature !== 'string' || !isHex(signature)) throw new Error('Typed-data signature missing')
		return splitSignature(signature)
	}

	test('ERC-2612 permits exact allowance, rejects expiry and replay, and keeps pre-submitted allowance usable', async () => {
		const deadline = 9_000_000_000n
		const message = { owner, spender: relayer.account.address, value: '25', nonce: '0', deadline: deadline.toString() }
		const invalidCases: ReadonlyArray<{
			domain?: Partial<{ chainId: number; verifyingContract: Address }>
			label: string
			message?: Partial<typeof message>
		}> = [
			{ label: 'chain', domain: { chainId: 2 } },
			{ label: 'domain', domain: { verifyingContract: other } },
			{ label: 'owner', message: { owner: other } },
			{ label: 'spender', message: { spender: other } },
			{ label: 'value', message: { value: '26' } },
			{ label: 'nonce', message: { nonce: '1' } },
		]
		for (const invalidCase of invalidCases) {
			const invalidSignature = await signTypedData({
				domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token, ...invalidCase.domain },
				primaryType: 'Permit',
				types: {
					Permit: [
						{ name: 'owner', type: 'address' },
						{ name: 'spender', type: 'address' },
						{ name: 'value', type: 'uint256' },
						{ name: 'nonce', type: 'uint256' },
						{ name: 'deadline', type: 'uint256' },
					],
				},
				message: { ...message, ...invalidCase.message },
			})
			await assert.rejects(
				relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, 25n, deadline, invalidSignature.v, invalidSignature.r, invalidSignature.s] }),
				/invalid signer|reverted/i,
				`wrong ${invalidCase.label} must fail`,
			)
			assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'nonces', args: [owner] }), 0n)
		}
		const wrongSigner = await signTypedData(
			{
				domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
				primaryType: 'Permit',
				types: {
					Permit: [
						{ name: 'owner', type: 'address' },
						{ name: 'spender', type: 'address' },
						{ name: 'value', type: 'uint256' },
						{ name: 'nonce', type: 'uint256' },
						{ name: 'deadline', type: 'uint256' },
					],
				},
				message,
			},
			other,
		)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, 25n, deadline, wrongSigner.v, wrongSigner.r, wrongSigner.s] }), /invalid signer|reverted/i)
		const signature = await signTypedData({
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'Permit',
			types: {
				Permit: [
					{ name: 'owner', type: 'address' },
					{ name: 'spender', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'nonce', type: 'uint256' },
					{ name: 'deadline', type: 'uint256' },
				],
			},
			message,
		})
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, 25n, deadline, signature.v, signature.r, signature.s] }))
		assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'allowance', args: [owner, relayer.account.address] }), 25n)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, 25n, deadline, signature.v, signature.r, signature.s] }), /invalid signer|reverted/i)
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferFrom', args: [owner, addressString(TEST_ADDRESSES[1]), 25n] }))
		assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'balanceOf', args: [addressString(TEST_ADDRESSES[1])] }), 25n)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, 1n, 0n, signature.v, signature.r, signature.s] }), /permit expired|reverted/i)
	})

	test('ERC-3009 receive authorization binds recipient, validity, and nonce', async () => {
		const recipient = createWriteClient(ethereum, TEST_ADDRESSES[1], 0)
		const nonce = `0x${'12'.repeat(32)}` as Hex
		const validBefore = 9_000_000_000n
		const signature = await signTypedData({
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'ReceiveWithAuthorization',
			types: {
				ReceiveWithAuthorization: [
					{ name: 'from', type: 'address' },
					{ name: 'to', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'validAfter', type: 'uint256' },
					{ name: 'validBefore', type: 'uint256' },
					{ name: 'nonce', type: 'bytes32' },
				],
			},
			message: { from: owner, to: recipient.account.address, value: '40', validAfter: '0', validBefore: validBefore.toString(), nonce },
		})
		const args = [owner, recipient.account.address, 40n, 0n, validBefore, nonce, signature.v, signature.r, signature.s] as const
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }), /caller must be the recipient|reverted/i)
		await writeContractAndWait(recipient, () => recipient.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }))
		assert.strictEqual(await recipient.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'balanceOf', args: [recipient.account.address] }), 40n)
		assert.strictEqual(await recipient.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'authorizationState', args: [owner, nonce] }), true)
		await assert.rejects(recipient.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }), /already used|reverted/i)
	})

	test('ERC-3009 transfer authorization supports relayers and rejects altered signed fields', async () => {
		const recipient = createWriteClient(ethereum, TEST_ADDRESSES[2], 0)
		const validBefore = 9_000_000_000n
		const signTransfer = async ({ chainId = 1, from = owner, nonce, signer = owner, to = recipient.account.address, value = 7n, verifyingContract = token }: { chainId?: number; from?: Address; nonce: Hex; signer?: Address; to?: Address; value?: bigint; verifyingContract?: Address }) =>
			await signTypedData(
				{
					domain: { chainId, name: 'Reputation', version: '1', verifyingContract },
					primaryType: 'TransferWithAuthorization',
					types: {
						TransferWithAuthorization: [
							{ name: 'from', type: 'address' },
							{ name: 'to', type: 'address' },
							{ name: 'value', type: 'uint256' },
							{ name: 'validAfter', type: 'uint256' },
							{ name: 'validBefore', type: 'uint256' },
							{ name: 'nonce', type: 'bytes32' },
						],
					},
					message: { from, to, value: value.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce },
				},
				signer,
			)

		const invalidCases = [
			{ label: 'wrong chain', signed: { chainId: 2 } },
			{ label: 'wrong domain', signed: { verifyingContract: other } },
			{ label: 'wrong signer', signed: { signer: other } },
			{ label: 'wrong owner', signed: { from: other } },
			{ label: 'wrong recipient', signed: { to: other } },
			{ label: 'wrong value', signed: { value: 8n } },
		] as const
		for (const [index, invalidCase] of invalidCases.entries()) {
			const nonce = `0x${(40 + index).toString(16).padStart(2, '0').repeat(32)}` as Hex
			const signature = await signTransfer({ nonce, ...invalidCase.signed })
			await assert.rejects(
				relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient.account.address, 7n, 0n, validBefore, nonce, signature.v, signature.r, signature.s] }),
				/invalid signer|reverted/i,
				invalidCase.label,
			)
			assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'authorizationState', args: [owner, nonce] }), false, `${invalidCase.label} must not consume the nonce`)
		}

		const validNonce = `0x${'55'.repeat(32)}` as Hex
		const validSignature = await signTransfer({ nonce: validNonce })
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient.account.address, 7n, 0n, validBefore, validNonce, validSignature.v, validSignature.r, validSignature.s] }))
		assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'balanceOf', args: [relayer.account.address] }), 0n, 'relayer must not receive transferred REP')
		assert.strictEqual(await recipient.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'balanceOf', args: [recipient.account.address] }), 7n)
	})

	test('ERC-3009 enforces validity windows and signed cancellation', async () => {
		const recipient = addressString(TEST_ADDRESSES[2])
		const signTransfer = async (nonce: Hex, validAfter: bigint, validBefore: bigint) =>
			await signTypedData({
				domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
				primaryType: 'TransferWithAuthorization',
				types: {
					TransferWithAuthorization: [
						{ name: 'from', type: 'address' },
						{ name: 'to', type: 'address' },
						{ name: 'value', type: 'uint256' },
						{ name: 'validAfter', type: 'uint256' },
						{ name: 'validBefore', type: 'uint256' },
						{ name: 'nonce', type: 'bytes32' },
					],
				},
				message: { from: owner, to: recipient, value: '3', validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce },
			})
		const futureNonce = `0x${'61'.repeat(32)}` as Hex
		const future = await signTransfer(futureNonce, 9_000_000_000n, 10_000_000_000n)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 9_000_000_000n, 10_000_000_000n, futureNonce, future.v, future.r, future.s] }), /not yet valid|reverted/i)

		const expiredNonce = `0x${'62'.repeat(32)}` as Hex
		const expired = await signTransfer(expiredNonce, 0n, 1n)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 0n, 1n, expiredNonce, expired.v, expired.r, expired.s] }), /expired|reverted/i)

		const canceledNonce = `0x${'63'.repeat(32)}` as Hex
		const transfer = await signTransfer(canceledNonce, 0n, 9_000_000_000n)
		const cancellation = await signTypedData({
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'CancelAuthorization',
			types: {
				CancelAuthorization: [
					{ name: 'authorizer', type: 'address' },
					{ name: 'nonce', type: 'bytes32' },
				],
			},
			message: { authorizer: owner, nonce: canceledNonce },
		})
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'cancelAuthorization', args: [owner, canceledNonce, cancellation.v, cancellation.r, cancellation.s] }))
		assert.strictEqual(await relayer.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'authorizationState', args: [owner, canceledNonce] }), true)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 0n, 9_000_000_000n, canceledNonce, transfer.v, transfer.r, transfer.s] }), /already used|reverted/i)
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'cancelAuthorization', args: [owner, canceledNonce, cancellation.v, cancellation.r, cancellation.s] }), /already used|reverted/i)
	})
})
