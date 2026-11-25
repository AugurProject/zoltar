import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Security pool purchase and checkpoint ownership', () => {
	const fixture = useSecurityPoolFixture()
	const services = async () => ({
		abi: servicesArtifact.abi,
		address: await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' }),
	})

	test('Services authenticates the universe capital ledger directly for fee checkpoints', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const target = await services()
		const universe = fixture.base.genesisUniverse
		const through = await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'effectiveTime' })
		await expect(fixture.other().writeContract({ ...target, functionName: 'checkpointCapitalFees', args: [universe, through] })).rejects.toThrow('Only universe capital ledger')
		await fixture.base.mockWindow.impersonateAccount(fixture.securityPool)
		await fixture.base.mockWindow.setBalance(fixture.securityPool, unit)
		const root = createWriteClient(fixture.base.mockWindow, BigInt(fixture.securityPool))
		await expect(root.writeContract({ ...target, functionName: 'checkpointCapitalFees', args: [universe, through] })).rejects.toThrow('Only universe capital ledger')
		await fixture.base.mockWindow.impersonateAccount(fixture.capitalLedger)
		await fixture.base.mockWindow.setBalance(fixture.capitalLedger, unit)
		const caller = createWriteClient(fixture.base.mockWindow, BigInt(fixture.capitalLedger))
		await writeContractAndWait(caller, () => caller.writeContract({ ...target, functionName: 'checkpointCapitalFees', args: [universe, through] }))
		await expect(caller.writeContract({ ...target, functionName: 'checkpointCapitalFees', args: [universe + 1n, through] })).rejects.toThrow('Only universe capital ledger')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
	})

	test('completed and reverted purchases leave no reusable mint or funding authorization', async () => {
		await fixture.prepare()
		await expect(fixture.mint(unit, fixture.base.questionId, { minimumShares: 2n * unit })).rejects.toThrow('Minimum shares not met')
		await fixture.mint(unit)
		const target = await services()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.base.mockWindow.impersonateAccount(pool)
		await fixture.base.mockWindow.setBalance(pool, unit)
		const caller = createWriteClient(fixture.base.mockWindow, BigInt(pool))
		await expect(caller.writeContract({ ...target, functionName: 'completePurchaseFunding', args: [0n, 0n] })).rejects.toThrow('No prepared purchase')
		await expect(caller.writeContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'mintQuestionSettlement', args: [unit] })).rejects.toThrow('No authorized security pool purchase')
		await fixture.mint(2n * unit, fixture.secondQuestionId)
		await fixture.mint(unit)
	})
})
