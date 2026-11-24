import { describe, expect, test } from 'bun:test'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { useSecurityPoolFixture, unit } from './securityPoolFixture'

describe('#1507 question settlement checkpoint semantics', () => {
	const fixture = useSecurityPoolFixture()
	test('keeps checkpoint evidence stable between writes while quotes use current central accounting', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const client = fixture.owner()
		const pool = { abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).questionLedger }
		const settlement = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const evidence = async () => Promise.all([client.readContract({ ...pool, functionName: 'shareTokenSupplyAttoShares' }), client.readContract({ ...pool, functionName: 'settlementCollateralAttoEth' }), client.readContract({ ...pool, functionName: 'lastSettlementSecurityPoolTime' })])
		const before = await evidence()
		await fixture.base.mockWindow.advanceTime(60n)
		await writeContractAndWait(client, () => client.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		const current = await client.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool.address] })
		expect(current.timestamp).toBeGreaterThan(before[2] ?? 0n)
		expect(await evidence()).toEqual(before)
		await writeContractAndWait(client, () => client.writeContract({ ...pool, functionName: 'updateSettlementCollateral' }))
		const after = await evidence()
		const synchronized = await client.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [pool.address] })
		expect(after).toEqual([synchronized.outcomeSupplyAttoShares, synchronized.questionCashAttoEth, synchronized.timestamp])
	})
})
