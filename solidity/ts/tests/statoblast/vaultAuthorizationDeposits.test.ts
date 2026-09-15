import { describe, test } from 'bun:test'
import { encodeAbiParameters, getAddress, isHex, keccak256, parseAbiItem, toFunctionSelector, toHex } from '@zoltar/core-shared/evm/ethereum'
import assert from '../../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { ReputationToken_ReputationToken, statoblast_interfaces_ISecurityPool_ISecurityPool } from '../../types/contractArtifact'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { depositRepToVault, createCompleteSet, getSecurityVault, backingUnitsToAttoRep } from '../../testSupport/simulator/utils/contracts/securityPool'
import { deployOriginSecurityPool, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, getQuestionId } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { DAY, GENESIS_REPUTATION_TOKEN } from '../../testSupport/simulator/utils/constants'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'
import { addressString } from '../../testSupport/simulator/utils/bigint'

describe('Vault authorization deposit accounting', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const amount = fixture.repDeposit
	const target = 20_000n

	const prepare = async (existingBacking: boolean, committed: boolean, depositTarget = target, existingOwner = false) => {
		const { client, mockWindow, questionData, questionId, outcomes } = fixture
		await mockWindow.setTime(questionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, 0n, questionId)
		const universe = getChildUniverseId(0n, QuestionOutcome.Yes)
		await addRepToMigrationBalance(client, 0n, amount * 4n)
		await splitMigrationRep(client, 0n, amount * 4n, [QuestionOutcome.Yes])
		const childQuestion = { ...questionData, title: 'Authorization deposit accounting', endTime: (await mockWindow.getTime()) + DAY }
		const childQuestionId = getQuestionId(childQuestion, outcomes)
		await createQuestion(client, childQuestion, outcomes)
		await deployOriginSecurityPool(client, universe, childQuestionId, target)
		const addresses = getSecurityPoolAddresses(addressString(0n), universe, childQuestionId, target, universe)
		const pool = addresses.securityPool
		const token = getRepTokenAddress(universe)
		const accounts = await mockWindow.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		const owner = getAddress(accounts[0])
		await client.waitForTransactionReceipt({ hash: await client.writeContract({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'transfer', args: [owner, existingOwner ? amount * 2n : amount] }) })
		if (existingBacking) {
			await approveToken(client, token, pool)
			await depositRepToVault(client, pool, amount, target)
		}
		if (existingOwner) {
			const ownerClient = createWriteClient(mockWindow, BigInt(owner))
			await approveToken(ownerClient, token, pool)
			await depositRepToVault(ownerClient, pool, amount, target)
		}
		if (committed) {
			await manipulatePriceOracle(client, mockWindow, addresses.priceOracleManagerAndOperatorQueuer, 10n ** 18n)
			await createCompleteSet(client, pool, 10n ** 18n)
		}
		const nonce = toHex(1n, { size: 32 })
		const operationHash = keccak256(
			encodeAbiParameters(
				[{ type: 'bytes4' }, { type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
				[toFunctionSelector(parseAbiItem('function depositRepToVaultWithAuthorization(address,uint256,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)')), owner, universe, childQuestionId, amount, depositTarget],
			),
		)
		const boundNonce = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }], [nonce, operationHash, owner]))
		const validBefore = (await mockWindow.getTime()) + DAY
		const name = await client.readContract({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'name' })
		const signature = await mockWindow.request({
			method: 'eth_signTypedData_v4',
			params: [
				owner,
				JSON.stringify({
					domain: { chainId: 1, name, version: '1', verifyingContract: token },
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
					message: { from: owner, to: pool, value: amount.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce: boundNonce },
				}),
			],
		})
		if (typeof signature !== 'string' || signature.length !== 132) throw new Error('Expected a 65-byte signature')
		const r: `0x${string}` = `0x${signature.slice(2, 66)}`
		const s: `0x${string}` = `0x${signature.slice(66, 130)}`
		if (!isHex(r) || !isHex(s)) throw new Error('Invalid signature encoding')
		const deposit = async (signatureR = r) =>
			await client.waitForTransactionReceipt({
				hash: await client.writeContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'depositRepToVaultWithAuthorization', args: [owner, amount, depositTarget, 0n, validBefore, nonce, Number.parseInt(signature.slice(130, 132), 16), signatureR, s] }),
			})
		return { client, pool, token, owner, boundNonce, deposit }
	}

	test.each([false, true])('prices authorized REP against pre-transfer backing (committed: %s)', async committed => {
		const { client, pool, owner, deposit } = await prepare(true, committed)
		const quotedUnits = await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'attoRepToBackingUnits', args: [amount] })
		await deposit()
		const addedVault = await getSecurityVault(client, pool, owner)
		const existingVault = await getSecurityVault(client, pool, client.account.address)
		assert.strictEqual(addedVault.repBackingUnits, quotedUnits)
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, addedVault.repBackingUnits), amount)
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, existingVault.repBackingUnits), amount)
		assert.strictEqual(addedVault.capacityOwnershipAttoRep, amount)
	})

	test('credits an existing owner without redistributing its top-up to another vault', async () => {
		const { client, pool, owner, deposit } = await prepare(true, false, target, true)
		await deposit()
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, (await getSecurityVault(client, pool, owner)).repBackingUnits), amount * 2n)
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, (await getSecurityVault(client, pool, client.account.address)).repBackingUnits), amount)
		assert.strictEqual((await getSecurityVault(client, pool, owner)).capacityOwnershipAttoRep, amount * 2n)
	})

	test('invalid authorization rolls back prepared vault state', async () => {
		const { client, pool, token, owner, boundNonce, deposit } = await prepare(true, false)
		await assert.rejects(deposit(toHex(0n, { size: 32 })), /invalid|ECDSA/i)
		assert.strictEqual(await client.readContract({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'authorizationState', args: [owner, boundNonce] }), false)
		assert.strictEqual((await getSecurityVault(client, pool, owner)).repBackingUnits, 0n)
		assert.strictEqual(await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [owner] }), 0n)
	})

	test('initializes an empty pool through authorization and rejects replay', async () => {
		const { client, pool, owner, deposit } = await prepare(false, false)
		await deposit()
		assert.strictEqual(await backingUnitsToAttoRep(client, pool, (await getSecurityVault(client, pool, owner)).repBackingUnits), amount)
		await assert.rejects(deposit(), /already used/)
	})

	test('rejects zero-capacity authorization without consuming REP or its nonce', async () => {
		const { client, pool, token, owner, boundNonce, deposit } = await prepare(true, false, 2n ** 256n - 1n)
		await assert.rejects(deposit(), /Capacity must be positive/)
		assert.strictEqual(await client.readContract({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'balanceOf', args: [owner] }), amount)
		assert.strictEqual(await client.readContract({ address: token, abi: ReputationToken_ReputationToken.abi, functionName: 'authorizationState', args: [owner, boundNonce] }), false)
		assert.strictEqual((await getSecurityVault(client, pool, owner)).repBackingUnits, 0n)
		assert.strictEqual(await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [owner] }), 0n)
	})
})
