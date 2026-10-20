import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
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
