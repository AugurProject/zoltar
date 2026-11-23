import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { collateralBalance } from './burnEvidence'

describe('settlement repair underwriting capacity', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	test('#1330 donations cannot create demand exceeding the child commitments', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [other.account.address, 1_000n * unit] }))
		await fixture.deposit(1_000n * unit, other)
		await fixture.authorize(200n * unit, other)
		await fixture.mint(300n * unit)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(other, collateral, settlement)
		const before = await collateralBalance(other, fixture.securityPool, other.account.address)
		await expect(writeContractAndWait(other, () => other.writeContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'topUp', args: [child, 150n * unit] }))).rejects.toThrow('Repair exceeds underwriting commitment')
		expect(await collateralBalance(other, fixture.securityPool, other.account.address)).toBe(before)
	})
})
