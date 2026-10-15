import { describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { deployContract } from '../../testSupport/deployContract'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createCompleteSet, depositToEscalationGame, getSecurityVault, updateVaultFees } from '../../testSupport/simulator/utils/contracts/securityPool'
import { createChildUniverse, initiateSecurityPoolFork, migrateVault } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken, getChildUniverseId, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, test_statoblast_SecurityPoolPositionReceiver_SecurityPoolPositionReceiver as receiverArtifact } from '../../types/contractArtifact'
import { useStatoblastForkMigrationFixture } from './fixture'

describe('Statoblast: native proportional vault position ownership', () => {
	const fixture = useStatoblastForkMigrationFixture()
	const unit = 10n ** 18n
	const pool = () => fixture.securityPoolAddresses.securityPool
	const owner = () => fixture.client.account.address
	const position = (vault: Address) => getSecurityVault(fixture.client, pool(), vault)
	const accounting = () => fixture.client.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
	const remainder = (vault: Address) => fixture.client.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'getVaultFeeRemainder', args: [vault] })
	const totalUnits = () => fixture.client.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'totalRepBackingUnits' })
	const heldRep = () => fixture.client.readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'getTotalPoolHeldAttoRep' })
	const split = (recipient: Address, numerator: bigint, denominator: bigint) => writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'splitVaultPosition', args: [recipient, numerator, denominator] }))
	const receiver = async (acceptedSource = owner()) => await deployContract(fixture.client, encodeDeployData({ abi: receiverArtifact.abi, bytecode: `0x${receiverArtifact.evm.bytecode.object}`, args: [owner(), pool(), acceptedSource] }))
	const initializeFees = async () => {
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'setUnderwritingLimit', args: [101n * unit + 17n] }))
		await createCompleteSet(fixture.client, pool(), 10n * unit + 7n)
	}

	test('partial and final splits preserve backing, commitment, accrued fees, fractional fees and pool totals', async () => {
		await initializeFees()
		const first = await receiver()
		const second = await receiver()
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await updateVaultFees(fixture.client, pool(), owner())
		const before = await position(owner())
		const beforeRemainder = await remainder(owner())
		const beforeAccounting = await accounting()
		const beforeUnits = await totalUnits()
		const beforeRep = await heldRep()
		const beforeEth = await getETHBalance(fixture.client, pool())
		expect(before.claimableFeesAttoEth).toBeGreaterThan(0n)
		await split(first, 2n, 7n)
		const firstSlice = await position(first)
		expect(firstSlice.repBackingUnits).toBe((before.repBackingUnits * 2n) / 7n)
		expect(firstSlice.underwritingLimitAttoEth).toBe((before.underwritingLimitAttoEth * 2n) / 7n)
		expect(firstSlice.claimableFeesAttoEth).toBe((before.claimableFeesAttoEth * 2n) / 7n)
		await split(second, 1n, 3n)
		await split(first, 1n, 1n)
		const a = await position(first)
		const b = await position(second)
		expect((await position(owner())).repBackingUnits).toBe(0n)
		expect((await position(owner())).underwritingLimitAttoEth).toBe(0n)
		expect((await position(owner())).claimableFeesAttoEth).toBe(0n)
		expect(await remainder(owner())).toBe(0n)
		expect(a.repBackingUnits + b.repBackingUnits).toBe(before.repBackingUnits)
		expect(a.underwritingLimitAttoEth + b.underwritingLimitAttoEth).toBe(before.underwritingLimitAttoEth)
		expect(a.claimableFeesAttoEth + b.claimableFeesAttoEth).toBe(before.claimableFeesAttoEth)
		expect((await remainder(first)) + (await remainder(second))).toBe(beforeRemainder)
		expect(await accounting()).toEqual(beforeAccounting)
		expect(await totalUnits()).toBe(beforeUnits)
		expect(await heldRep()).toBe(beforeRep)
		expect(await getETHBalance(fixture.client, pool())).toBe(beforeEth)
	})

	test('rejects unconsented transfers, invalid fractions, self transfers and source dispute escrow', async () => {
		const other = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		const target = await receiver(other.account.address)
		const before = await position(owner())
		await expect(split(other.account.address, 1n, 2n)).rejects.toThrow()
		await expect(split(target, 1n, 2n)).rejects.toThrow('Position source not accepted')
		await expect(split(owner(), 1n, 2n)).rejects.toThrow('Invalid position recipient')
		await expect(split(target, 0n, 1n)).rejects.toThrow('Invalid position fraction')
		await expect(split(target, 2n, 1n)).rejects.toThrow('Invalid position fraction')
		expect(await position(owner())).toEqual(before)
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator)
		await depositToEscalationGame(fixture.client, pool(), QuestionOutcome.Yes, fixture.reportBond)
		await expect(split(await receiver(), 1n, 2n)).rejects.toThrow('Source has dispute escrow')
	})

	test('rejects a source that adds dispute escrow during recipient consent', async () => {
		const source = await receiver()
		const target = await receiver(source)
		await split(source, 1n, 2n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: receiverArtifact.abi, address: source, functionName: 'configureConsentStake', args: [target, 0n] }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: receiverArtifact.abi, address: target, functionName: 'configureConsentStake', args: ['0x0000000000000000000000000000000000000000', fixture.reportBond] }))
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator)
		const sourceBefore = await position(source)
		const targetBefore = await position(target)
		await expect(writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: receiverArtifact.abi, address: source, functionName: 'split', args: [target, 1n, 2n] }))).rejects.toThrow('Source has dispute escrow')
		expect(await position(source)).toEqual(sourceBefore)
		expect(await position(target)).toEqual(targetBefore)
	})

	test('owners independently select fork branches and can migrate newly received parent backing again', async () => {
		await initializeFees()
		const yesOwner = await receiver()
		const noOwner = await receiver()
		await fixture.triggerExternalForkForSecurityPool(undefined, 'native split ownership')
		await updateVaultFees(fixture.client, pool(), owner())
		const original = await position(owner())
		const originalUnits = await totalUnits()
		const originalCapacity = (await accounting()).totalUnderwritingLimitAttoEth
		await createChildUniverse(fixture.client, pool(), QuestionOutcome.Yes)
		await createChildUniverse(fixture.client, pool(), QuestionOutcome.No)
		const migrate = (vault: Address, outcome: QuestionOutcome) => writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: receiverArtifact.abi, address: vault, functionName: 'migrate', args: [BigInt(outcome)] }))
		await split(yesOwner, 1n, 2n)
		await migrate(yesOwner, QuestionOutcome.Yes)
		await split(noOwner, 1n, 2n)
		await migrate(noOwner, QuestionOutcome.No)
		await split(yesOwner, 1n, 1n)
		await migrate(yesOwner, QuestionOutcome.Yes)
		const child = (outcome: QuestionOutcome) => getSecurityPoolAddresses(pool(), getChildUniverseId(fixture.genesisUniverse, outcome), fixture.questionId, fixture.statoblastSecurityMultiplierBps).securityPool
		const yes = await getSecurityVault(fixture.client, child(QuestionOutcome.Yes), yesOwner)
		const no = await getSecurityVault(fixture.client, child(QuestionOutcome.No), noOwner)
		expect(yes.underwritingLimitAttoEth + no.underwritingLimitAttoEth).toBe(original.underwritingLimitAttoEth)
		expect(yes.repBackingUnits + no.repBackingUnits).toBe(fixture.repDeposit)
		expect((await position(yesOwner)).repBackingUnits).toBe(0n)
		expect((await position(noOwner)).repBackingUnits).toBe(0n)
		expect((await position(owner())).repBackingUnits).toBe(0n)
		expect(await totalUnits()).toBe(originalUnits)
		expect((await accounting()).totalUnderwritingLimitAttoEth).toBe(originalCapacity)
		expect((await position(yesOwner)).claimableFeesAttoEth + (await position(noOwner)).claimableFeesAttoEth).toBe(original.claimableFeesAttoEth)
	})

	test.each(['operational', 'forked', 'fully-migrated'])('merging fractional fee entitlements preserves economic value, including released fork reserves (%s)', async state => {
		const forked = state !== 'operational'
		await initializeFees()
		const target = await receiver()
		const forkingOwner = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[5])
		const forkQuestion = makeQuestion('Native split terminal fee reserve', (await fixture.mockWindow.getTime()) + DAY)
		const forkQuestionId = getQuestionId(forkQuestion, fixture.outcomes)
		if (forked) {
			await createQuestion(forkingOwner, forkQuestion, fixture.outcomes)
			await approveToken(forkingOwner, getRepTokenAddress(fixture.genesisUniverse), getZoltarAddress())
		}
		let combined = 0n
		let snapshotCollateral = 0n
		for (let attempt = 0; attempt < 32 && combined < unit; attempt++) {
			const retrySnapshot = await fixture.mockWindow.anvilSnapshot()
			await split(target, 1n, BigInt(attempt) + 2n)
			if (forked) {
				await fixture.mockWindow.advanceTime(DAY + BigInt(attempt) + 1n)
				await forkUniverse(forkingOwner, fixture.genesisUniverse, forkQuestionId)
				await initiateSecurityPoolFork(fixture.client, pool())
				snapshotCollateral = (await accounting()).settlementCollateralAttoEth
			} else await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
			await updateVaultFees(fixture.client, pool(), owner())
			await updateVaultFees(fixture.client, pool(), target)
			if (forked) await updateVaultFees(fixture.client, pool(), owner())
			combined = (await remainder(owner())) + (await remainder(target))
			if (combined < unit) await fixture.mockWindow.anvilRevert(retrySnapshot)
		}
		expect(combined).toBeGreaterThanOrEqual(unit)
		const snapshotUnits = await totalUnits()
		if (forked) {
			expect((await accounting()).unallocatedAccruedFeesAttoEth).toBe(0n)
		}
		if (state === 'fully-migrated') {
			const collateralWithTerminalReserve = (await accounting()).settlementCollateralAttoEth
			await createChildUniverse(fixture.client, pool(), QuestionOutcome.Yes)
			await migrateVault(fixture.client, pool(), QuestionOutcome.Yes)
			await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: receiverArtifact.abi, address: target, functionName: 'migrate', args: [BigInt(QuestionOutcome.Yes)] }))
			expect((await accounting()).settlementCollateralAttoEth).toBe(collateralWithTerminalReserve - snapshotCollateral)
			expect((await accounting()).settlementCollateralAttoEth).toBeGreaterThanOrEqual(combined / unit)
			expect((await position(owner())).repBackingUnits + (await position(target)).repBackingUnits).toBe(0n)
		}
		const before = await accounting()
		const source = await position(owner())
		const recipient = await position(target)
		await split(target, 1n, 1n)
		const after = await accounting()
		expect((await position(target)).claimableFeesAttoEth).toBe(source.claimableFeesAttoEth + recipient.claimableFeesAttoEth + combined / unit)
		expect(await remainder(target)).toBe(combined % unit)
		expect(after.totalClaimableVaultFeesAttoEth).toBe(before.totalClaimableVaultFeesAttoEth + combined / unit)
		expect(after.unallocatedAccruedFeesAttoEth + after.settlementCollateralAttoEth + after.totalClaimableVaultFeesAttoEth).toBe(before.unallocatedAccruedFeesAttoEth + before.settlementCollateralAttoEth + before.totalClaimableVaultFeesAttoEth)
		expect(await totalUnits()).toBe(snapshotUnits)
		expect(after.totalUnderwritingLimitAttoEth).toBe(before.totalUnderwritingLimitAttoEth)
	})
})
