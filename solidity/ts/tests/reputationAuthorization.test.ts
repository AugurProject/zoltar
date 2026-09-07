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

function splitSignature(signature: Hex) {
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
	let token: Address

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		relayer = createWriteClient(ethereum, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(ethereum)
		const accounts = await ethereum.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		owner = getAddress(accounts[0])
		const deployment = encodeDeployData({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
			args: [[owner], [1_000n]],
		})
		const receipt = await relayer.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ data: deployment }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Genesis REP deployment failed')
		token = receipt.contractAddress
	})

	const signTypedData = async (typedData: object) => {
		const signature = await ethereum.request({ method: 'eth_signTypedData_v4', params: [owner, JSON.stringify(typedData)] })
		if (typeof signature !== 'string' || !isHex(signature)) throw new Error('Typed-data signature missing')
		return splitSignature(signature)
	}

	test('ERC-2612 permits exact allowance, rejects expiry and replay, and keeps pre-submitted allowance usable', async () => {
		const deadline = 9_000_000_000n
		const message = { owner, spender: relayer.account.address, value: '25', nonce: '0', deadline: deadline.toString() }
		const signature = await signTypedData({
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'Permit',
			types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
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
			types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
			message: { from: owner, to: recipient.account.address, value: '40', validAfter: '0', validBefore: validBefore.toString(), nonce },
		})
		const args = [owner, recipient.account.address, 40n, 0n, validBefore, nonce, signature.v, signature.r, signature.s] as const
		await assert.rejects(relayer.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }), /caller must be the recipient|reverted/i)
		await writeContractAndWait(recipient, () => recipient.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }))
		assert.strictEqual(await recipient.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'balanceOf', args: [recipient.account.address] }), 40n)
		assert.strictEqual(await recipient.readContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'authorizationState', args: [owner, nonce] }), true)
		await assert.rejects(recipient.writeContract({ abi: GenesisReputationToken_GenesisReputationToken.abi, address: token, functionName: 'receiveWithAuthorization', args }), /already used|reverted/i)
	})
})
