import { describe, expect, test } from 'bun:test'
import { parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, splitMigrationRep, getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { collateralBalance } from './burnEvidence'

const repairAbi = parseAbi(['function topUp(uint248 universeId,uint256 maximumCashAttoEth) returns (uint256)'])
describe('Statoblast: permissionless settlement repair', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('#1330 a donor cannot impose funded demand above the child providers commitment', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		await fixture.prepare(1_000n * unit, 200n * unit)
		await fixture.deposit(1_000n * unit, other)
		await fixture.authorize(200n * unit, other)
		await fixture.mint(300n * unit, fixture.secondQuestionId)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const root = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const settlement = await owner.readContract({ ...root, functionName: 'settlement' })
		const capital = await owner.readContract({ ...root, functionName: 'capitalLedger', args: [child] })
		const exposure = await owner.readContract({ ...root, functionName: 'oracleExposure', args: [child] })
		const demand = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })
		const collateral = await owner.readContract({ ...root, functionName: 'collateralToken' })
		await approveToken(owner, collateral, settlement)
		const before = await collateralBalance(owner, fixture.securityPool, owner.account.address)
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, 300n * unit] }))).rejects.toThrow('Repair exceeds underwriting commitment')
		expect(await collateralBalance(owner, fixture.securityPool, owner.account.address)).toBe(before)
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })).toBe(demand)
		expect(await owner.readContract({ ...root, functionName: 'oracleExposure', args: [child] })).toBe(exposure)
	})

	test('#1247 a minimum non-chooser cannot leave a supported child permanently in runoff', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const freshQuestion = makeQuestion('A fresh question in the repaired branch', fixture.secondEndTime)
		const freshQuestionId = getQuestionId(freshQuestion, fixture.base.outcomes)
		await createQuestion(owner, freshQuestion, fixture.base.outcomes)
		await fixture.register(freshQuestionId)
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [other.account.address, 5n * unit] }))
		await fixture.deposit(5n * unit, other)
		const minimum = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'minimumCommitmentAttoEth' })
		await fixture.authorize(minimum, other)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		expect(await owner.readContract({ abi: forkArtifact.abi, address: forks, functionName: 'auctions', args: [child] })).toBe(zeroAddress)
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const ledger = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [child] })
		const book = { abi: bookArtifact.abi, address: ledger }
		const [cash, units] = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const deficit = units - cash
		expect(deficit).toBeGreaterThan(0n)
		expect(deficit).toBeLessThan(minimum)
		const recovery = await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })
		expect(recovery).toBeGreaterThan(0n)
		const rep = { abi: tokenArtifact.abi, address: getRepTokenAddress(child) }
		const supply = await owner.readContract({ ...rep, functionName: 'totalSupply' })
		const custody = await collateralBalance(owner, fixture.securityPool, settlement)
		const donor = await collateralBalance(owner, fixture.securityPool, other.account.address)
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(other, collateral, settlement)
		await expect(other.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, deficit - 1n] })).rejects.toThrow('Settlement deficit exceeds maximum')
		// A larger maximum still pulls exactly the live deficit.
		const { result: pulled } = await other.simulateContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, deficit + unit] })
		expect(pulled).toBe(deficit)
		await writeContractAndWait(other, () => other.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, deficit + unit] }))
		await expect(other.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, unit] })).rejects.toThrow('No settlement deficit')
		expect(await collateralBalance(owner, fixture.securityPool, settlement)).toBe(custody + deficit)
		expect(await collateralBalance(owner, fixture.securityPool, other.account.address)).toBe(donor - deficit)
		expect(await owner.readContract({ ...rep, functionName: 'totalSupply' })).toBe(supply)
		expect(await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })).toBe(recovery)
		const capital = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'capitalLedger', args: [child] })
		await expect(owner.writeContract({ abi: parseAbi(['function recordSettlementRepair(uint256)']), address: capital, functionName: 'recordSettlementRepair', args: [units + 1n] })).rejects.toThrow('Only canonical settlement')
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })).toBe(units)
		expect(await owner.readContract({ ...book, functionName: 'quoteMint', args: [bookId, fixture.secondQuestionId, unit] })).toBe(unit)
		const infrastructure = getInfraContractAddresses()
		const forker = { abi: forkerArtifact.abi, address: infrastructure.questionForker }
		for (const questionId of [fixture.secondQuestionId, freshQuestionId]) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [fixture.poolFor(questionId).questionLedger, child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'prepareSecurityPoolPriceFeed', args: [fixture.poolFor(fixture.secondQuestionId).questionLedger, child] }))
		const feed = { abi: feedArtifact.abi, address: await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [child] }) }
		await addRepToMigrationBalance(owner, fixture.base.genesisUniverse, 100n * unit)
		await splitMigrationRep(owner, fixture.base.genesisUniverse, 100n * unit, [1])
		await wrapWeth(owner, 100n * unit)
		await approveToken(owner, collateral, feed.address)
		await approveToken(owner, rep.address, feed.address)
		const bounty = await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ ...feed, functionName: 'requestSecurityPoolPrice', args: [unit, 10n * unit, bounty], value: bounty }))
		const reportId = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, reportId)
		const services = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		await approveToken(owner, collateral, services)
		const requiredRep = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [child, fixture.secondQuestionId, unit] })
		expect(requiredRep).toBeGreaterThan(0n)
		const oldClaim = await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })
		const ownerRep = () => owner.readContract({ ...rep, functionName: 'balanceOf', args: [owner.account.address] })
		const beforeRep = await ownerRep()
		expect(await owner.readContract({ ...rep, functionName: 'allowance', args: [owner.account.address, settlement] })).toBe(0n)
		const beforeCash = await collateralBalance(owner, fixture.securityPool, owner.account.address)
		const beforeBook = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const buy = async (questionId: bigint, maximumRep?: bigint) => {
			const [fee] = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'purchaseQuote', args: [child, questionId, unit] })
			if (maximumRep === undefined) return writeContractAndWait(owner, () => owner.writeContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'createCompleteSet', args: [child, questionId, unit, owner.account.address, unit, fee] }))
			return writeContractAndWait(owner, () => owner.writeContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'createCompleteSetWithRecoveryRep', args: [child, questionId, unit, owner.account.address, unit, fee, maximumRep] }))
		}
		for (const [index, attempt] of [() => buy(fixture.secondQuestionId), () => buy(fixture.secondQuestionId, requiredRep - 1n), () => buy(fixture.secondQuestionId, requiredRep)].entries()) {
			if (index < 2) await expect(attempt()).rejects.toThrow('Recovery REP exceeds budget')
			else await expect(attempt()).rejects.toThrow()
			expect(await ownerRep()).toBe(beforeRep)
			expect(await collateralBalance(owner, fixture.securityPool, owner.account.address)).toBe(beforeCash)
			expect(await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })).toEqual(beforeBook)
		}
		await approveToken(owner, rep.address, settlement)
		await buy(fixture.secondQuestionId, requiredRep)
		expect(await ownerRep()).toBe(beforeRep - requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })).toBe(recovery + requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })).toBe(oldClaim)
		expect(await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [child, freshQuestionId, unit] })).toBe(0n)
		await buy(freshQuestionId)
		expect(await ownerRep()).toBe(beforeRep - requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, freshQuestionId, unit] })).toBe(0n)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })).toBe(oldClaim)
	})

	test.each([0, 4])('a repair reserves matured claims before donating to the live basket with %i additional deadlines', async additionalCount => {
		const owner = fixture.owner()
		const donor = fixture.other()
		const genesis = fixture.base.genesisUniverse
		const additional: bigint[] = []
		for (let index = 1; index <= additionalCount; index++) {
			const data = makeQuestion(`Repair deadline ${index}`, fixture.base.questionData.endTime + BigInt(index) * DAY)
			const id = getQuestionId(data, fixture.base.outcomes)
			await createQuestion(owner, data, fixture.base.outcomes)
			await fixture.register(id)
			additional.push(id)
		}
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(genesis), functionName: 'transfer', args: [donor.account.address, 5n * unit] }))
		await fixture.deposit(5n * unit, donor)
		const minimum = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'minimumCommitmentAttoEth' })
		await fixture.authorize(minimum, donor)
		await fixture.mint(10n * unit, fixture.base.questionId)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		for (const id of additional) await fixture.mint(unit, id)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		let cutoff = forkTime + 67n * DAY
		if (additional.length !== 0) {
			await addRepToMigrationBalance(owner, genesis, 1000n * unit)
			await splitMigrationRep(owner, genesis, 1000n * unit, [1])
			const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
			for (const [index, questionId] of additional.entries()) {
				await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [fixture.poolFor(questionId).questionLedger, child] }))
				const address = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'getPool', args: [questionId, child] })
				const pool = { abi: poolArtifact.abi, address }
				await approveToken(owner, getRepTokenAddress(child), address)
				// Report the last claim just before the cutoff, leaving its
				// deadline on the live side of the repair.
				const last = index === additional.length - 1
				if (last) await fixture.base.mockWindow.setTime(cutoff - 60n)
				const reportHash = await writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
				if (index === 0) {
					const childReportGas = (await owner.getTransactionReceipt({ hash: reportHash })).gasUsed
					if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ childReportGas })
					expect(childReportGas).toBeLessThan(10_000_000n)
				}
				const game = await owner.readContract({ ...pool, functionName: 'escalationGame' })
				const deadline = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
				if (last) expect(deadline).toBeGreaterThan(cutoff)
				else if (cutoff <= deadline) cutoff = deadline + 1n
			}
		}
		await fixture.base.mockWindow.setTime(cutoff)

		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const ledger = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [child] })
		const book = { abi: bookArtifact.abi, address: ledger }
		const finalState = () => owner.readContract({ ...book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		const quote = (question: bigint) => owner.readContract({ ...book, functionName: 'quoteRedemption', args: [bookId, question, 10n * unit] })
		const [priorCash] = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const priorDeficit = (await owner.readContract({ ...book, functionName: 'requiredCash', args: [bookId] })) - priorCash
		const [finalPayout] = await quote(fixture.base.questionId)
		expect((await finalState())[1]).toBe(0n)
		expect(priorDeficit).toBeGreaterThan(0n)

		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(donor, collateral, settlement)
		const payerBefore = await collateralBalance(donor, fixture.securityPool, donor.account.address)
		const hash = await writeContractAndWait(donor, () => donor.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, priorDeficit] }))
		const repairGas = (await donor.getTransactionReceipt({ hash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ additionalCount, repairGas })
		expect(repairGas).toBeLessThan(1_000_000n)
		for (const [index, id] of additional.entries()) {
			const [, frozenId] = await owner.readContract({ ...book, functionName: 'question', args: [bookId, id] })
			expect(frozenId === 0n).toBe(index === additional.length - 1)
		}
		const donated = payerBefore - (await collateralBalance(donor, fixture.securityPool, donor.account.address))
		expect(donated).toBeGreaterThan(0n)
		expect(donated).toBeLessThan(priorDeficit)
		expect((await finalState())[1]).not.toBe(0n)
		expect((await quote(fixture.base.questionId))[0]).toBe(finalPayout)
		expect((await quote(fixture.secondQuestionId))[0]).toBe(10n * unit)
	})

	test('#1321 a redemption that moves the deficit before inclusion does not revert a bounded repair', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const genesis = fixture.base.genesisUniverse
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(genesis), functionName: 'transfer', args: [other.account.address, 5n * unit] }))
		await fixture.deposit(5n * unit, other)
		const minimum = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'minimumCommitmentAttoEth' })
		await fixture.authorize(minimum, other)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const ledger = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [child] })
		const book = { abi: bookArtifact.abi, address: ledger }
		const deficit = async () => {
			const [cash] = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
			return (await owner.readContract({ ...book, functionName: 'requiredCash', args: [bookId] })) - cash
		}
		const quoted = await deficit()
		expect(quoted).toBeGreaterThan(0n)
		// A share holder materializes the question in the child, migrates and redeems dust before the donor's transaction.
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
		const source = fixture.poolFor(fixture.secondQuestionId)
		await writeContractAndWait(other, () => other.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [source.questionLedger, child] }))
		const childPool = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'getPool', args: [fixture.secondQuestionId, child] })
		for (const outcome of [0n, 1n, 2n]) await writeContractAndWait(other, () => other.writeContract({ abi: shareArtifact.abi, address: source.shareToken, functionName: 'migrate', args: [genesis * 256n + outcome, [1n]] }))
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(owner, collateral, settlement)
		await writeContractAndWait(other, () => other.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemCompleteSet', args: [1_000n] }))
		const live = await deficit()
		expect(live).toBeLessThan(quoted)
		// The donor signed the stale quote as its maximum; the settlement pulls the live deficit.
		const donor = await collateralBalance(owner, fixture.securityPool, owner.account.address)
		const custody = await collateralBalance(owner, fixture.securityPool, settlement)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, quoted] }))
		expect(await collateralBalance(owner, fixture.securityPool, owner.account.address)).toBe(donor - live)
		expect(await collateralBalance(owner, fixture.securityPool, settlement)).toBe(custody + live)
		expect(await owner.readContract({ ...book, functionName: 'isCashFunded', args: [bookId] })).toBe(true)
		expect(await deficit()).toBe(0n)
	})
})
