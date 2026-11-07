import { describe, expect, test } from 'bun:test'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Portfolio question ETH custody boundaries', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('unsolicited question ETH emits a receipt but cannot become outcome collateral or a depositor claim', async () => {
		await fixture.prepare()
		await fixture.mint(unit)
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		const supply = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'shareTokenSupplyAttoShares' })
		const quote = () => owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'quoteQuestionSettlement', args: [pool, supply] })
		const before = await quote()
		const hash = await writeContractAndWait(owner, () => owner.sendTransaction({ to: pool, value: unit }))
		const receipt = await owner.waitForTransactionReceipt({ hash })
		const log = receipt.logs.find(log => log.address.toLowerCase() === pool.toLowerCase())
		if (log === undefined) throw new Error('Question ETH receipt event missing')
		const event = decodeEventLog({ abi: poolArtifact.abi, data: log.data, topics: log.topics })
		expect(event.eventName).toBe('EthReceived')
		if (event.eventName !== 'EthReceived') throw new Error('Unexpected question event')
		expect(event.args.sender.toLowerCase()).toBe(owner.account.address.toLowerCase())
		expect(event.args.amountAttoEth).toBe(unit)
		expect(await quote()).toBeLessThanOrEqual(before)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'shareTokenSupplyAttoShares' })).toBe(supply)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [supply] }))
		expect(await owner.getBalance({ address: pool })).toBe(unit)
	})

	test('the native forker no longer accepts auction ETH', async () => {
		const owner = fixture.owner()
		const forker = getInfraContractAddresses().securityPoolForker
		await expect(owner.sendTransaction({ to: forker, value: 1n })).rejects.toThrow()
		expect(await owner.getBalance({ address: forker })).toBe(0n)
	})
})
