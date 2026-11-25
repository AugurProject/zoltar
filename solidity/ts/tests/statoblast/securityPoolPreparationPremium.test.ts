import { describe, expect, test } from 'bun:test'
import { type Address, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, forkUniverse, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { collateralBalance, burnedCollateralBalance, receiptBurns } from './burnEvidence'

const preparationAbi = parseAbi(['function checkpointPreparationPremium(uint248 universeId)'])

describe('Statoblast: preparation premium ownership', () => {
	const fixture = useSecurityPoolFixture({})
	const prepare = async (delay: bigint) => {
		const owner = fixture.owner()
		const mock = fixture.base.mockWindow
		await fixture.prepare()
		await fixture.mint()
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'prepareSecurityPoolPriceFeed', args: [fixture.poolFor(fixture.base.questionId).questionLedger, child] }))
		const capital = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
		const services = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		const premium = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'premiumLedger' })
		const deadline = forkTime + 63n * DAY
		const activation = deadline + delay
		// Only price-cache setup impersonates the authority. The reproduction
		// exercises actual fork activation, Services, premium and capital ledgers.
		await mock.impersonateAccount(fixture.securityPool)
		await mock.setBalance(fixture.securityPool, unit)
		await mock.setTime(deadline - 1n)
		const root = createWriteClient(mock, BigInt(fixture.securityPool))
		await writeContractAndWait(root, () => root.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'acceptPrice', args: [unit, Number(deadline + 780n)] }))
		const servicesCashBefore = await collateralBalance(owner, fixture.securityPool, services)
		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const settlementFeesBefore = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'pendingServiceFees' })
		const premiumBefore = (await owner.readContract({ abi: premiumArtifact.abi, address: premium, functionName: 'totals', args: [child] }))[0]
		expect(premiumBefore).toBeGreaterThan(0n)
		await mock.setTime(activation)
		const finalize = async () => {
			const burnedBefore = await burnedCollateralBalance(owner, fixture.securityPool)
			const queuedBefore = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingBurnCash', args: [child] })
			const hash = await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
			expect((await receiptBurns(owner, hash)).totalEth).toBe(0n)
			expect(await burnedCollateralBalance(owner, fixture.securityPool)).toBe(burnedBefore)
			const finalizedSecurityPoolTime = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'securityPoolTime', args: [child] })
			const queued = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingBurnCash', args: [child] })
			const preparation = queued - queuedBefore
			const flush = await writeContractAndWait(owner, () => owner.writeContract({ abi: servicesArtifact.abi, address: services, functionName: 'flushBurn', args: [child] }))
			const burns = await receiptBurns(owner, flush)
			expect(burns.serviceEth).toBe(queued)
			expect(await burnedCollateralBalance(owner, fixture.securityPool)).toBe(burnedBefore + queued)
			return { burns, preparation, finalizedSecurityPoolTime }
		}

		const checkpoint = () => writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'checkpoint' }))
		const fees = async () => {
			const position = (await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [owner.account.address] })).positionId
			return (await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [position] })).ethFees
		}
		const servicesCash = () => collateralBalance(owner, fixture.securityPool, services)
		return { owner, mock, child, forks, capital, services, premium, servicesCashBefore, settlementFeesBefore, servicesCash, premiumBefore, finalize, checkpoint, fees }
	}

	test('late activation cannot backdate reporting premiums into the preparation interval', async () => {
		const context = await prepare(300n)
		const { preparation, finalizedSecurityPoolTime } = await context.finalize()
		const [activationCash, , activationTime] = await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] })
		expect(activationTime).toBe(finalizedSecurityPoolTime)
		expect(await context.fees()).toBe(0n)
		await context.checkpoint()
		const remaining = (await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] }))[0]
		expect(activationCash).toBe(context.premiumBefore)
		expect(await context.fees()).toBe(activationCash - remaining)
		// Paused reporting earns no preparation premium. Only time after activation earns.
		expect(preparation).toBe(0n)
		await context.mock.advanceTime(300n)
		await context.checkpoint()
		expect(await context.fees()).toBeGreaterThan(0n)
	})

	test('late activation preserves premium until the reporting clock resumes', async () => {
		const context = await prepare(4n * DAY)
		const { preparation } = await context.finalize()
		expect(preparation).toBe(0n)
		// With no burn to flush, settlement fees remain in settlement custody.
		expect(await context.servicesCash()).toBe(context.servicesCashBefore)
		const settlement = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		expect(await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'pendingServiceFees' })).toBe(context.settlementFeesBefore)
		expect((await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] }))[0]).toBe(context.premiumBefore)
		expect(await context.fees()).toBe(0n)
		await context.checkpoint()
		const [remaining] = await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] })
		const queuedBurn = await context.owner.readContract({ abi: servicesArtifact.abi, address: context.services, functionName: 'pendingBurnCash', args: [context.child] })
		expect(remaining).toBeGreaterThan(0n)
		expect((await context.fees()) + queuedBurn).toBe(context.premiumBefore - remaining)
	})

	test('#1332 earned reporting premium remains assigned to old capital during a stale-price retirement request', async () => {
		const context = await prepare(300n)
		await context.finalize()
		const capital = { abi: capitalArtifact.abi, address: context.capital }
		const services = { abi: servicesArtifact.abi, address: context.services }
		const premium = { abi: premiumArtifact.abi, address: context.premium }
		const expiry = await context.owner.readContract({ ...capital, functionName: 'priceValidUntil' })
		await context.mock.setTime(expiry)
		await context.checkpoint()
		const [cashBefore] = await context.owner.readContract({ ...premium, functionName: 'totals', args: [context.child] })
		const ownerBefore = await context.owner.readContract({ ...capital, functionName: 'ownerAccount', args: [context.owner.account.address] })
		const feesBefore = ownerBefore.feesAttoEth + (await context.fees())
		const pendingBefore = await context.owner.readContract({ ...services, functionName: 'pendingCapitalCash', args: [context.capital] })
		const burnBefore = await context.owner.readContract({ ...services, functionName: 'pendingBurnCash', args: [context.child] })
		const custodyBefore = await context.servicesCash()
		await context.mock.advanceTime(300n)
		expect(await context.owner.readContract({ ...capital, functionName: 'isPriceValid' })).toBe(false)
		// Retirement requests checkpoint all earned income before changing the old position's state.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ ...capital, functionName: 'setCommitment', args: [0n] }))
		const [cashAfter] = await context.owner.readContract({ ...premium, functionName: 'totals', args: [context.child] })
		const earned = cashBefore - cashAfter
		expect(earned).toBeGreaterThan(0n)
		const ownerAfter = await context.owner.readContract({ ...capital, functionName: 'ownerAccount', args: [context.owner.account.address] })
		expect(ownerAfter.feesAttoEth + (await context.fees())).toBe(feesBefore + earned)
		expect(await context.owner.readContract({ ...services, functionName: 'pendingCapitalCash', args: [context.capital] })).toBe(pendingBefore + earned)
		expect(await context.owner.readContract({ ...services, functionName: 'pendingBurnCash', args: [context.child] })).toBe(burnBefore)
		expect(await context.servicesCash()).toBe(custodyBefore)
		await context.checkpoint()
		const [cashAfterNextCheckpoint] = await context.owner.readContract({ ...premium, functionName: 'totals', args: [context.child] })
		const totalEarned = cashBefore - cashAfterNextCheckpoint
		expect((await context.owner.readContract({ ...capital, functionName: 'ownerAccount', args: [context.owner.account.address] })).feesAttoEth + (await context.fees())).toBe(feesBefore + totalEarned)
		await expect(context.owner.writeContract({ ...services, functionName: 'withdrawCapitalCash' })).rejects.toThrow('No assigned capital cash')
		expect(await context.owner.readContract({ ...services, functionName: 'pendingCapitalCash', args: [context.capital] })).toBe(pendingBefore + totalEarned)
		expect(await context.owner.readContract({ ...services, functionName: 'pendingBurnCash', args: [context.child] })).toBe(burnBefore)
	})

	test('two credited capital ledgers withdraw their own exact allocations from shared service custody', async () => {
		const { owner, mock, capital, services, finalize, checkpoint } = await prepare(300n)
		await finalize()
		await mock.advanceTime(500n)
		await checkpoint()
		const parent = fixture.capitalLedger
		const target = { abi: servicesArtifact.abi, address: services }
		const pending = (ledger: Address) => owner.readContract({ ...target, functionName: 'pendingCapitalCash', args: [ledger] })
		const parentAmount = await pending(parent)
		const childAmount = await pending(capital)
		expect(parentAmount).toBeGreaterThan(0n)
		expect(childAmount).toBeGreaterThan(0n)
		expect(childAmount).not.toBe(parentAmount)
		for (const [ledger, amount] of [
			[parent, parentAmount],
			[capital, childAmount],
		] as const) {
			const before = await collateralBalance(owner, fixture.securityPool, ledger)
			await mock.impersonateAccount(ledger)
			await mock.setBalance(ledger, unit)
			const caller = createWriteClient(mock, BigInt(ledger))
			await writeContractAndWait(caller, () => caller.writeContract({ ...target, functionName: 'withdrawCapitalCash' }))
			expect((await collateralBalance(owner, fixture.securityPool, ledger)) - before).toBe(amount)
			expect(await pending(ledger)).toBe(0n)
			if (ledger === parent) expect(await pending(capital)).toBe(childAmount)
		}
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
		const frozenTime = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'securityPoolTime', args: [context.child] })
		await context.mock.advanceTime(3600n)
		const { preparation } = await context.finalize()
		const [remaining, , timestamp] = await context.owner.readContract({ abi: premiumArtifact.abi, address: context.premium, functionName: 'totals', args: [context.child] })
		expect(timestamp).toBe(frozenTime)
		expect(remaining).toBe(context.premiumBefore)
		expect(await context.fees()).toBe(0n)
		expect(preparation).toBe(0n)
	})
})
