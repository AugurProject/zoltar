import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Security pool question ETH custody boundaries', () => {
	const fixture = useSecurityPoolFixture()
	test('#1355 rejects native ETH throughout the ERC20 security pool stack', async () => {
		await fixture.prepare()
		await fixture.mint(unit)
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		const target = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const services = await owner.readContract({ ...target, functionName: 'services' })
		const coordinator = await owner.readContract({ ...target, functionName: 'forkController' })
		const supply = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'shareTokenSupplyAttoShares' })
		const quote = () => owner.readContract({ ...target, functionName: 'quoteQuestionSettlement', args: [pool, supply] })
		const before = await quote()
		for (const to of [pool, coordinator, services, fixture.securityPool]) {
			await expect(owner.sendTransaction({ to, value: unit })).rejects.toThrow()
			expect(await owner.getBalance({ address: to })).toBe(0n)
		}
		expect(await quote()).toBeLessThanOrEqual(before)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'shareTokenSupplyAttoShares' })).toBe(supply)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [supply, 0n] }))
	})

	test('the native forker no longer accepts auction ETH', async () => {
		const owner = fixture.owner()
		const forker = getInfraContractAddresses().questionForker
		await expect(owner.sendTransaction({ to: forker, value: 1n })).rejects.toThrow()
		expect(await owner.getBalance({ address: forker })).toBe(0n)
	})
})
