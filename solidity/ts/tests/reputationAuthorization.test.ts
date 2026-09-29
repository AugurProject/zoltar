import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { CANCEL_AUTHORIZATION_TYPES, PERMIT_TYPES, RECEIVE_WITH_AUTHORIZATION_TYPES, signTypedDataV4, tokenDomain, TRANSFER_WITH_AUTHORIZATION_TYPES } from '../testSupport/simulator/utils/typedDataSignatures'
import { ReputationToken_ReputationToken } from '../types/contractArtifact'

const abi = ReputationToken_ReputationToken.abi
const tokenName = 'Augur Reputation 1'
const repeatedNonce = (byte: string): Hex => `0x${byte.repeat(32)}`

describe('REP token authorizations', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let ethereum: AnvilWindowEthereum
	let relayer: WriteClient
	let owner: Address
	let other: Address
	let token: Address

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		relayer = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		const accounts = await ethereum.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		owner = getAddress(accounts[0])
		if (typeof accounts[1] !== 'string') throw new Error('Second Anvil signer missing')
		other = getAddress(accounts[1])
		const deployment = encodeDeployData({
			abi,
			bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
			args: [relayer.account.address],
		})
		const receipt = await relayer.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ data: deployment }) })
		if (receipt.contractAddress === undefined) throw new Error('Child REP deployment failed')
		token = receipt.contractAddress
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi, address: token, functionName: 'initialize', args: [1n, 1_000n, 1n] }))
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi, address: token, functionName: 'mint', args: [owner, 1_000n] }))
	})

	const signTypedData = async (typedData: object, signer = owner) => await signTypedDataV4(ethereum, signer, typedData)
	const domain = () => tokenDomain(token, tokenName)

	test('ERC-2612 permits exact allowance, rejects expiry and replay, and keeps pre-submitted allowance usable', async () => {
		const deadline = 9_000_000_000n
		const message = { owner, spender: relayer.account.address, value: '25', nonce: '0', deadline: deadline.toString() }
		const signPermit = async ({ domain: domainOverride, message: messageOverride, signer }: { domain?: Partial<{ chainId: number; verifyingContract: Address }>; message?: Partial<typeof message>; signer?: Address } = {}) =>
			await signTypedData({ domain: { ...domain(), ...domainOverride }, primaryType: 'Permit', types: PERMIT_TYPES, message: { ...message, ...messageOverride } }, signer)
		const submitPermit = (signature: Awaited<ReturnType<typeof signPermit>>, value = 25n, permitDeadline = deadline) => relayer.writeContract({ abi, address: token, functionName: 'permit', args: [owner, relayer.account.address, value, permitDeadline, signature.v, signature.r, signature.s] })
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
			await assert.rejects(submitPermit(await signPermit(invalidCase)), /invalid signer|reverted/i, `wrong ${invalidCase.label} must fail`)
			assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'nonces', args: [owner] }), 0n)
		}
		await assert.rejects(submitPermit(await signPermit({ signer: other })), /invalid signer|reverted/i)
		const signature = await signPermit()
		await writeContractAndWait(relayer, () => submitPermit(signature))
		assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'allowance', args: [owner, relayer.account.address] }), 25n)
		await assert.rejects(submitPermit(signature), /invalid signer|reverted/i)
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi, address: token, functionName: 'transferFrom', args: [owner, addressString(TEST_ADDRESSES[1]), 25n] }))
		assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'balanceOf', args: [addressString(TEST_ADDRESSES[1])] }), 25n)
		await assert.rejects(submitPermit(signature, 1n, 0n), /permit expired|reverted/i)
	})

	test('ERC-3009 receive authorization binds recipient, validity, and nonce', async () => {
		const recipient = createWriteClient(ethereum, TEST_ADDRESSES[1])
		const nonce = repeatedNonce('12')
		const validBefore = 9_000_000_000n
		const signature = await signTypedData({
			domain: domain(),
			primaryType: 'ReceiveWithAuthorization',
			types: RECEIVE_WITH_AUTHORIZATION_TYPES,
			message: { from: owner, to: recipient.account.address, value: '40', validAfter: '0', validBefore: validBefore.toString(), nonce },
		})
		const args = [owner, recipient.account.address, 40n, 0n, validBefore, nonce, signature.v, signature.r, signature.s] as const
		await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'receiveWithAuthorization', args }), /caller must be the recipient|reverted/i)
		await writeContractAndWait(recipient, () => recipient.writeContract({ abi, address: token, functionName: 'receiveWithAuthorization', args }))
		assert.strictEqual(await recipient.readContract({ abi, address: token, functionName: 'balanceOf', args: [recipient.account.address] }), 40n)
		assert.strictEqual(await recipient.readContract({ abi, address: token, functionName: 'authorizationState', args: [owner, nonce] }), true)
		await assert.rejects(recipient.writeContract({ abi, address: token, functionName: 'receiveWithAuthorization', args }), /already used|reverted/i)
	})

	const signTransfer = async ({
		chainId = 1,
		from = owner,
		nonce,
		signer = owner,
		to,
		value,
		validAfter = 0n,
		validBefore,
		verifyingContract = token,
	}: {
		chainId?: number
		from?: Address
		nonce: Hex
		signer?: Address
		to: Address
		value: bigint
		validAfter?: bigint
		validBefore: bigint
		verifyingContract?: Address
	}) =>
		await signTypedData(
			{
				domain: tokenDomain(verifyingContract, tokenName, chainId),
				primaryType: 'TransferWithAuthorization',
				types: TRANSFER_WITH_AUTHORIZATION_TYPES,
				message: { from, to, value: value.toString(), validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce },
			},
			signer,
		)

	test('ERC-3009 transfer authorization supports relayers and rejects altered signed fields', async () => {
		const recipient = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const validBefore = 9_000_000_000n
		const transfer = { to: recipient.account.address, value: 7n, validBefore }
		const invalidCases = [
			{ label: 'wrong chain', signed: { chainId: 2 } },
			{ label: 'wrong domain', signed: { verifyingContract: other } },
			{ label: 'wrong signer', signed: { signer: other } },
			{ label: 'wrong owner', signed: { from: other } },
			{ label: 'wrong recipient', signed: { to: other } },
			{ label: 'wrong value', signed: { value: 8n } },
		] as const
		for (const [index, invalidCase] of invalidCases.entries()) {
			const nonce = repeatedNonce((40 + index).toString(16).padStart(2, '0'))
			const signature = await signTransfer({ ...transfer, nonce, ...invalidCase.signed })
			await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient.account.address, 7n, 0n, validBefore, nonce, signature.v, signature.r, signature.s] }), /invalid signer|reverted/i, invalidCase.label)
			assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'authorizationState', args: [owner, nonce] }), false, `${invalidCase.label} must not consume the nonce`)
		}

		const validNonce = repeatedNonce('55')
		const validSignature = await signTransfer({ ...transfer, nonce: validNonce })
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient.account.address, 7n, 0n, validBefore, validNonce, validSignature.v, validSignature.r, validSignature.s] }))
		assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'balanceOf', args: [relayer.account.address] }), 0n, 'relayer must not receive transferred REP')
		assert.strictEqual(await recipient.readContract({ abi, address: token, functionName: 'balanceOf', args: [recipient.account.address] }), 7n)
	})

	test('ERC-3009 enforces validity windows and signed cancellation', async () => {
		const recipient = addressString(TEST_ADDRESSES[2])
		const signWindow = async (nonce: Hex, validAfter: bigint, validBefore: bigint) => await signTransfer({ nonce, to: recipient, value: 3n, validAfter, validBefore })
		const futureNonce = repeatedNonce('61')
		const future = await signWindow(futureNonce, 9_000_000_000n, 10_000_000_000n)
		await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 9_000_000_000n, 10_000_000_000n, futureNonce, future.v, future.r, future.s] }), /not yet valid|reverted/i)

		const expiredNonce = repeatedNonce('62')
		const expired = await signWindow(expiredNonce, 0n, 1n)
		await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 0n, 1n, expiredNonce, expired.v, expired.r, expired.s] }), /expired|reverted/i)

		const canceledNonce = repeatedNonce('63')
		const transfer = await signWindow(canceledNonce, 0n, 9_000_000_000n)
		const cancellation = await signTypedData({
			domain: domain(),
			primaryType: 'CancelAuthorization',
			types: CANCEL_AUTHORIZATION_TYPES,
			message: { authorizer: owner, nonce: canceledNonce },
		})
		await writeContractAndWait(relayer, () => relayer.writeContract({ abi, address: token, functionName: 'cancelAuthorization', args: [owner, canceledNonce, cancellation.v, cancellation.r, cancellation.s] }))
		assert.strictEqual(await relayer.readContract({ abi, address: token, functionName: 'authorizationState', args: [owner, canceledNonce] }), true)
		await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'transferWithAuthorization', args: [owner, recipient, 3n, 0n, 9_000_000_000n, canceledNonce, transfer.v, transfer.r, transfer.s] }), /already used|reverted/i)
		await assert.rejects(relayer.writeContract({ abi, address: token, functionName: 'cancelAuthorization', args: [owner, canceledNonce, cancellation.v, cancellation.r, cancellation.s] }), /already used|reverted/i)
	})
})
