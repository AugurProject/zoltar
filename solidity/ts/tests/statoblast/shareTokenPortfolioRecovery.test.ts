import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, setupTestAccounts, sortStringArrayByKeccak } from '../../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed, forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { statoblast_tokens_ShareToken_ShareToken as tokenArtifact, test_statoblast_ShareTokenRecoveryTestPool_ShareTokenRecoveryTestPool as poolArtifact } from '../../types/contractArtifact'

describe('Statoblast: independent portfolio share recovery rights', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	test('reassembles split recovery rights after both outcome holders migrate without moving child rights', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		const data = { ...makeQuestion('split recovery rights'), startTime: 0n, endTime: 0n }
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(owner, data, outcomes)
		const question = getQuestionId(data, outcomes)
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [owner.account.address, getZoltarAddress(), question] }))
		const source = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [token, 0n, zeroAddress, owner.account.address] }))
		const send = async (client: typeof owner, call: Parameters<typeof owner.writeContract>[0]) => await writeContractAndWait(client, () => client.writeContract(call))
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'authorize', args: [source] })
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 10n] })
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'safeBatchTransferFrom', args: [owner.account.address, bob.account.address, [0n, 2n], [10n, 10n], '0x'] })
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await forkUniverse(owner, 0n, question)
		const childIds: bigint[] = []
		for (const outcome of [1n, 2n]) {
			const universe = BigInt.asUintN(248, BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, outcome]))))
			childIds.push(universe)
			const child = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [token, universe, source, owner.account.address] }))
			await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'authorize', args: [child] })
		}
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [1n, [1n]] })
		for (const id of [0n, 2n]) await send(bob, { abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [id, [1n]] })
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('Recovery requires unclaimed complete sets')
		await expect(bob.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'safeTransferFrom', args: [bob.account.address, owner.account.address, 0n, 10n, '0x'] })).rejects.toThrow('ShareToken migrated source balance is locked')
		const recoveryAbi = parseAbi(['function transferPortfolioRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)', 'function balanceOfPortfolioRecoveryRights(uint248 sourceUniverse,address holder) view returns (uint256[3])'])
		await send(bob, { abi: recoveryAbi, address: token, functionName: 'transferPortfolioRecoveryRights', args: [0n, owner.account.address, [10n, 0n, 10n]] })
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 10n] })
		for (const client of [owner, bob]) expect(await client.readContract({ abi: recoveryAbi, address: token, functionName: 'balanceOfPortfolioRecoveryRights', args: [0n, client.account.address] })).toEqual([0n, 0n, 0n])
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('Recovery requires unclaimed complete sets')
		await expect(bob.writeContract({ abi: recoveryAbi, address: token, functionName: 'transferPortfolioRecoveryRights', args: [0n, owner.account.address, [1n, 0n, 1n]] })).rejects.toThrow('Insufficient recovery rights')
		await send(owner, { abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [1n, [2n]] })
		for (const id of [0n, 2n]) await send(bob, { abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [id, [2n]] })
		for (const universe of [0n, ...childIds]) {
			expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOfShares', args: [universe, owner.account.address] })).toEqual([0n, 10n, 0n])
			expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOfShares', args: [universe, bob.account.address] })).toEqual([10n, 0n, 10n])
		}
	})

	test('credits cannot lock recipients and partial forwarding, consumption and new source balances conserve rights', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		const carol = createWriteClient(ethereum, TEST_ADDRESSES[2])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		const data = { ...makeQuestion('recovery credit accounting'), startTime: 0n, endTime: 0n }
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(owner, data, outcomes)
		const question = getQuestionId(data, outcomes)
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [owner.account.address, getZoltarAddress(), question] }))
		const source = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [token, 0n, zeroAddress, owner.account.address] }))
		const send = async (client: typeof owner, call: Parameters<typeof owner.writeContract>[0]) => await writeContractAndWait(client, () => client.writeContract(call))
		const target = { abi: tokenArtifact.abi, address: token }
		const transfer = (client: typeof owner, recipient: typeof owner.account.address, amounts: readonly [bigint, bigint, bigint]) => send(client, { ...target, functionName: 'transferPortfolioRecoveryRights', args: [0n, recipient, amounts] })
		const rights = (client: typeof owner) => owner.readContract({ ...target, functionName: 'balanceOfPortfolioRecoveryRights', args: [0n, client.account.address] })
		await send(owner, { ...target, functionName: 'authorize', args: [source] })
		await send(owner, { ...target, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 10n] })
		await send(owner, { ...target, functionName: 'mintCompleteSets', args: [0n, bob.account.address, 5n] })
		await expect(transfer(owner, bob.account.address, [1n, 1n, 1n])).rejects.toThrow('Recovery source has not forked')
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await forkUniverse(owner, 0n, question)
		await expect(transfer(owner, zeroAddress, [1n, 1n, 1n])).rejects.toThrow('nonzero')
		await expect(transfer(owner, owner.account.address, [1n, 1n, 1n])).rejects.toThrow('another')
		await expect(transfer(owner, bob.account.address, [0n, 0n, 0n])).rejects.toThrow('zero')
		await expect(transfer(carol, bob.account.address, [1n, 0n, 0n])).rejects.toThrow('Insufficient recovery rights')
		await expect(transfer(owner, bob.account.address, [1n, 11n, 0n])).rejects.toThrow('Insufficient recovery rights')
		expect(await rights(owner)).toEqual([10n, 10n, 10n])
		expect(await rights(bob)).toEqual([5n, 5n, 5n])
		await transfer(owner, bob.account.address, [4n, 4n, 4n])
		await transfer(bob, carol.account.address, [2n, 2n, 2n])
		await transfer(carol, owner.account.address, [1n, 1n, 1n])
		await send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, bob.account.address, 1n] })
		// Receiving, forwarding and consuming only credits must not lock Bob's original shares.
		await send(bob, { ...target, functionName: 'safeBatchTransferFrom', args: [bob.account.address, owner.account.address, [0n, 1n, 2n], [5n, 5n, 5n], '0x'] })
		expect(await rights(owner)).toEqual([12n, 12n, 12n])
		expect(await rights(bob)).toEqual([1n, 1n, 1n])
		expect(await rights(carol)).toEqual([1n, 1n, 1n])
		await send(owner, { ...target, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 2n] })
		await expect(send(owner, { ...target, functionName: 'safeBatchTransferFrom', args: [owner.account.address, carol.account.address, [0n, 1n, 2n], [1n, 1n, 1n], '0x'] })).rejects.toThrow('source balance is locked')
		await send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 7n] })
		await send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 7n] })
		await expect(send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('unclaimed complete sets')
		await expect(send(owner, { ...target, functionName: 'burnCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('recovery rights already separated')
		await expect(send(owner, { ...target, functionName: 'burnTokenIdAndGetRemainingSupply', args: [1n, owner.account.address] })).rejects.toThrow('recovery rights already separated')
		for (const client of [bob, carol]) await transfer(client, owner.account.address, [1n, 1n, 1n])
		await send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 2n] })
		expect(await owner.readContract({ ...target, functionName: 'recoveredCompleteSetShares', args: [0n, owner.account.address] })).toBe(16n)
		for (const client of [owner, bob, carol]) expect(await rights(client)).toEqual([0n, 0n, 0n])
		// All 17 minted rights were consumed exactly once (16 by owner and 1 by Bob).
		expect(await owner.readContract({ ...target, functionName: 'balanceOfShares', args: [0n, owner.account.address] })).toEqual([17n, 17n, 17n])
		// Unspent source rights can still be burned, including exactly down to the separated balance.
		await send(owner, { ...target, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 6n] })
		await transfer(owner, bob.account.address, [4n, 4n, 4n])
		await send(owner, { ...target, functionName: 'burnCompleteSets', args: [0n, owner.account.address, 2n] })
		expect(await rights(owner)).toEqual([0n, 0n, 0n])
		await expect(send(owner, { ...target, functionName: 'burnCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('recovery rights already separated')
		await send(owner, { ...target, functionName: 'mintCompleteSets', args: [0n, carol.account.address, 5n] })
		await transfer(bob, carol.account.address, [4n, 4n, 4n])
		await send(owner, { ...target, functionName: 'burnCompleteSets', args: [0n, carol.account.address, 5n] })
		expect(await rights(carol)).toEqual([4n, 4n, 4n])
		await send(owner, { ...target, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, carol.account.address, 4n] })
		expect(await rights(carol)).toEqual([0n, 0n, 0n])
	})

	test('consumes complete-set recovery once while retaining full rights in every branch', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const stranger = createWriteClient(ethereum, TEST_ADDRESSES[1])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		const data = { ...makeQuestion('recovery rights'), startTime: 0n, endTime: 0n }
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(owner, data, outcomes)
		const question = getQuestionId(data, outcomes)
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [owner.account.address, getZoltarAddress(), question] }))
		const source = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [token, 0n, zeroAddress, owner.account.address] }))
		const send = async (call: Parameters<typeof owner.writeContract>[0]) => await writeContractAndWait(owner, () => owner.writeContract(call))
		await send({ abi: tokenArtifact.abi, address: token, functionName: 'authorize', args: [source] })
		await send({ abi: tokenArtifact.abi, address: token, functionName: 'mintCompleteSets', args: [0n, owner.account.address, 10n] })
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('Recovery source has not forked')
		await approveToken(owner, getRepTokenAddress(0n), getZoltarAddress())
		await forkUniverse(owner, 0n, question)
		await expect(stranger.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('Only portfolio recovery authority')
		await send({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 4n] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOfShares', args: [0n, owner.account.address] })).toEqual([10n, 10n, 10n])
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'safeTransferFrom', args: [owner.account.address, stranger.account.address, 1n, 1n, '0x'] })).rejects.toThrow('ShareToken migrated source balance is locked')
		for (const outcome of [1n, 2n]) {
			const universe = BigInt.asUintN(248, BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, outcome]))))
			const child = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [token, universe, outcome === 2n ? zeroAddress : source, owner.account.address] }))
			await send({ abi: tokenArtifact.abi, address: token, functionName: 'authorize', args: [child] })
			await send({ abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [1n, [outcome]] })
			expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner.account.address, (universe << 8n) | 1n] })).toBe(10n)
		}
		await send({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 6n] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'recoveredCompleteSetShares', args: [0n, owner.account.address] })).toBe(10n)
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'consumePortfolioRecoveryCompleteSets', args: [0n, owner.account.address, 1n] })).rejects.toThrow('Recovery requires unclaimed complete sets')
		await expect(owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'migrate', args: [1n, [1n]] })).rejects.toThrow('ShareToken has no new shares to migrate')
	})
})
