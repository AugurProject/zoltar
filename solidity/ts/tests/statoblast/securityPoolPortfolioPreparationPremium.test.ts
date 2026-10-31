import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const preparationAbi = parseAbi(['function checkpointPreparationPremium(uint248 universeId)'])

describe('Statoblast: preparation premium ownership', () => {
	const fixture = useSecurityPoolPortfolioFixture({ reportingFeeAttoEth: unit / 100n })
	const prepare = async (delay: bigint) => {
		const owner = fixture.owner()
		const mock = fixture.base.mockWindow
		const source = fixture.base.genesisUniverse
		await fixture.prepare()
		await fixture.mint()
		const forks = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'forkController' })
		await mock.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(source), getZoltarAddress())
		await forkUniverse(owner, source, fixture.base.questionId)
		const forkTime = (await getUniverseData(owner, source)).forkTime
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'choose', args: [source, 1n] }))
		const child = getChildUniverseId(source, 1)
		await mock.setTime(forkTime + 56n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'startBranch', args: [source, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'preparePortfolioPriceFeed', args: [fixture.poolFor(fixture.base.questionId).securityPool, child] }))
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
		const services = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		const premium = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'premiumLedger' })
		const deadline = forkTime + 63n * DAY
		const activation = deadline + delay
		// Only price-cache setup impersonates the authority. The reproduction
		// exercises actual fork activation, Services, premium and capital ledgers.
		await mock.impersonateAccount(fixture.portfolio)
		await mock.setBalance(fixture.portfolio, unit)
		await mock.setTime(deadline - 1n)
		const root = createWriteClient(mock, BigInt(fixture.portfolio))
		await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptPrice', args: [unit, Number(deadline + 780n)] }))
		const maintenanceBefore = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'maintenanceReserveAttoEth', args: [child] })
		const premiumBefore = (await owner.readContract({ abi: premiumArtifact.abi, address: premium, functionName: 'totals', args: [child] }))[0]
		expect(premiumBefore).toBeGreaterThan(0n)
		await mock.setTime(activation)
		const finalize = () => writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const checkpoint = () => writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'checkpoint' }))
		const fees = async () => {
			const position = (await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [owner.account.address] })).positionId
			return (await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [position] })).ethFees
		}
		return { owner, mock, child, forks, capital, services, premium, maintenanceBefore, premiumBefore, finalize, checkpoint, fees }
	}

	test('late activation cannot backdate reporting premiums into the preparation interval', async () => {
		const context = await prepare(300n)
		await context.finalize()
		const [activationCash, , activationTime] = await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] })
		expect(activationTime).toBe(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'logicalTime', args: [context.child] }))
		expect(await context.fees()).toBe(0n)
		await context.checkpoint()
		const remaining = (await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] }))[0]
		expect(activationCash).toBeLessThan(context.premiumBefore)
		expect(await context.fees()).toBe(activationCash - remaining)
		expect(await context.owner.readContract({ abi: servicesArtifact.abi, address: context.services, functionName: 'maintenanceReserveAttoEth', args: [context.child] })).toBe(context.maintenanceBefore + context.premiumBefore - activationCash)
		await context.mock.advanceTime(300n)
		await context.checkpoint()
		expect(await context.fees()).toBeGreaterThan(0n)
	})

	test('expired preparation premiums entirely fund maintenance without delaying activation', async () => {
		const context = await prepare(4n * DAY)
		await context.finalize()
		await context.checkpoint()
		expect(await context.fees()).toBe(0n)
		expect((await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] }))[0]).toBe(0n)
		expect(await context.owner.readContract({ abi: servicesArtifact.abi, address: context.services, functionName: 'maintenanceReserveAttoEth', args: [context.child] })).toBe(context.maintenanceBefore + context.premiumBefore)
	})

	test('preparation checkpoints require the fork controller and cannot divert active earnings', async () => {
		const context = await prepare(300n)
		await expect(context.owner.writeContract({ abi: preparationAbi, address: context.services, functionName: 'checkpointPreparationPremium', args: [context.child] })).rejects.toThrow('Only service fork controller')
		await context.finalize()
		await context.mock.impersonateAccount(context.forks)
		await context.mock.setBalance(context.forks, unit)
		const controller = createWriteClient(context.mock, BigInt(context.forks))
		await expect(controller.writeContract({ abi: preparationAbi, address: context.services, functionName: 'checkpointPreparationPremium', args: [context.child] })).rejects.toThrow('Premium preparation unavailable')
	})

	test('a child that already forked can activate using its frozen logical premium clock', async () => {
		const context = await prepare(8n * DAY)
		const threshold = await context.owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getForkThresholdAttoRep', args: [context.child] })
		await addRepToMigrationBalance(context.owner, fixture.base.genesisUniverse, threshold)
		await splitMigrationRep(context.owner, fixture.base.genesisUniverse, threshold, [1n])
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		const frozenTime = await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'logicalTime', args: [context.child] })
		await context.mock.advanceTime(3600n)
		await context.finalize()
		const [remaining, , timestamp] = await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] })
		expect(timestamp).toBe(frozenTime)
		expect(remaining).toBe(0n)
		expect(await context.fees()).toBe(0n)
		expect(await context.owner.readContract({ abi: servicesArtifact.abi, address: context.services, functionName: 'maintenanceReserveAttoEth', args: [context.child] })).toBe(context.maintenanceBefore + context.premiumBefore)
	})
})
