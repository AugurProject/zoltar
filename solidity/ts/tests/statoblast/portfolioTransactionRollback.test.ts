import { describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import {
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
	test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as receiverArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Portfolio question transaction rollback', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const addresses = () => fixture.poolFor(fixture.base.questionId)
	const pool = () => ({ abi: poolArtifact.abi, address: addresses().securityPool })
	const state = async (holder = fixture.owner().account.address) => {
		const client = fixture.owner()
		const ids = await Promise.all([0n, 1n, 2n].map(outcome => client.readContract({ abi: sharesArtifact.abi, address: addresses().shareToken, functionName: 'getTokenId', args: [fixture.base.genesisUniverse, outcome] })))
		return {
			snapshot: await client.readContract({ abi: settlementArtifact.abi, address: await client.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' }), functionName: 'snapshotQuestion', args: [pool().address] }),
			eth: await client.getBalance({ address: pool().address }),
			shares: await client.readContract({ abi: sharesArtifact.abi, address: addresses().shareToken, functionName: 'balanceOfBatch', args: [ids.map(() => holder), ids] }),
			capital: await client.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'totals' }),
		}
	}
	test('a rejecting complete-set recipient restores shares, cash, fees, and capital accounting', async () => {
		await fixture.prepare()
		const client = fixture.owner()
		const receiver = await deployContract(client, encodeDeployData({ abi: receiverArtifact.abi, bytecode: `0x${receiverArtifact.evm.bytecode.object}` }))
		await fixture.mint(unit, fixture.base.questionId, { recipient: receiver })
		const before = await state(receiver)
		const shares = before.shares[0]
		if (shares === undefined || shares === 0n) throw new Error('Receiver must own a complete set')
		expect(before.shares).toEqual([shares, shares, shares])
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'execute', args: [pool().address, encodeFunctionData({ abi: poolArtifact.abi, functionName: 'redeemCompleteSet', args: [shares] })] }))).rejects.toThrow(
			'Settlement ETH transfer failed',
		)
		expect(await state(receiver)).toEqual(before)
	})
	test('over-capacity purchases and missing-game claims leave all balances unchanged', async () => {
		await fixture.prepare(1_000n * unit, unit)
		const before = await state()
		const client = fixture.owner()
		await expect(client.writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [fixture.base.genesisUniverse, fixture.base.questionId, 2n * unit, client.account.address, 0n], value: 3n * unit })).rejects.toThrow()
		expect(await state()).toEqual(before)
		await expect(client.writeContract({ ...pool(), functionName: 'withdrawFromEscalationGame', args: [1, []] })).rejects.toThrow('Game missing')
		expect(await state()).toEqual(before)
	})
})
