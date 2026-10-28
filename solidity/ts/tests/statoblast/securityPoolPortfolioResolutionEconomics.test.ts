import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	test_statoblast_PortfolioPurchaseReceiver_PortfolioPurchaseReceiver as receiverArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { approveToken, requireAddress, requireArray, requireBigInt } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { encodeDeployData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { loadPortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

describe('Statoblast: funded reporting and unresolved capital compensation', () => {
	const fixture = useSecurityPoolPortfolioFixture({ reportingFeeAttoEth: unit / 100n })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const service = async () => ({ abi: servicesArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'services' }) })
	const reward = async () => {
		const result = requireArray(await fixture.owner().readContract({ address: (await service()).address, abi: parseAbi(['function quoteReportingReward(address pool) view returns(address recipient,uint256 cashAttoEth)']), functionName: 'quoteReportingReward', args: [pool().address] }), 'Reporting reward quote')
		return { recipient: requireAddress(result[0], 'Reporting reward recipient'), cash: requireBigInt(result[1], 'Reporting reward cash') }
	}
	const rewardCap = async (game: `0x${string}`) => {
		const result = requireArray(
			await fixture.owner().readContract({ address: (await service()).address, abi: parseAbi(['function reportingBeneficiaries(address game) view returns(address beneficiary,uint8 leader,bool registered,uint256 rewardCapAttoEth)']), functionName: 'reportingBeneficiaries', args: [game] }),
			'Reporting reward cap',
		)
		return requireBigInt(result[3], 'Reporting reward cap')
	}
	const questionState = async () => {
		const client = fixture.owner()
		const engine = await client.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		return (await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] }))[0]
	}
	const report = async (sender: WriteClient, outcome: number, amount = 100n * unit) => {
		await approveToken(sender, getRepTokenAddress(fixture.base.genesisUniverse), pool().address)
		await writeContractAndWait(sender, () => sender.writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		return sender.readContract({ ...pool(), functionName: 'escalationGame' })
	}
	const mature = async (game: `0x${string}`) => {
		const deadline = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		// The inverse attrition curve rounds independently of its forward value.
		await fixture.base.mockWindow.setTime(deadline + 60n)
	}
	test('an unreported question keeps paying for occupied underwriting after its calendar end', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const question = await questionState()
		expect(BigInt(question.feeEnd)).toBeGreaterThan(fixture.base.questionData.endTime)
	})
	test('capacity includes the reporter bounty and rejects an unfunded total purchase atomically', async () => {
		await fixture.prepare()
		const capacity = await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		await expect(fixture.mint(capacity)).rejects.toThrow('Purchase exceeds healthy capacity')
		expect((await questionState()).outcomeSupplyAttoShares).toBe(0n)
		expect((await fixture.owner().readContract({ ...(await service()), functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
	})
	test('recipient callbacks observe the completed purchase premium accounting', async () => {
		await fixture.prepare()
		const services = await service()
		const receiver = await deployContract(fixture.owner(), encodeDeployData({ abi: receiverArtifact.abi, bytecode: applyLibraries(receiverArtifact.evm.bytecode.object), args: [services.address, fixture.base.genesisUniverse, fixture.base.questionId] }))
		await fixture.mint(10n * unit, fixture.base.questionId, { recipient: receiver })
		const observed = await fixture.owner().readContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'observedPremium' })
		expect(observed).toBeGreaterThan(0n)
		expect(observed).toBe((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1])
	})
	test('returning all trader complete sets releases the premium without any question sweep', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const services = await service()
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBeGreaterThan(0n)
		const native = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.other(), native.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), native.securityPool, shares[0])
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
		const question = await questionState()
		expect(question.outcomeSupplyAttoShares).toBe(question.rewardShares)
	})

	test('reporting earns its premium only until actual finality and the unearned remainder funds maintenance', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const services = await service()
		const premium = await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] })
		expect(premium[1]).toBeGreaterThan(0n)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const game = await report(fixture.owner(), 1)
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(premium[1])
		expect((await questionState()).feeRateAttoEthPerSecond).toBe(0n)
		const before = await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [fixture.base.genesisUniverse] })
		await mature(game)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		expect((await fixture.owner().readContract({ ...services, functionName: 'questionPremium', args: [fixture.base.genesisUniverse, fixture.base.questionId] }))[1]).toBe(0n)
		expect(await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [fixture.base.genesisUniverse] })).toBeGreaterThan(before)
	})

	test('a minimum-size newcomer cannot collect a large finalized question premium tail', async () => {
		await fixture.prepare()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const game = await report(fixture.owner(), 1)
		await mature(game)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		const owner = await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'ownerAccount', args: [fixture.owner().account.address] })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'requestRetirement', args: [owner.positionId, 0n] }))
		await fixture.refreshPrice()
		await fixture.deposit(10n * unit, fixture.other())
		await fixture.authorize(unit, fixture.other())
		await fixture.base.mockWindow.advanceTime(60n)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'checkpoint' }))
		const newcomer = await loadPortfolioCapitalSnapshot({ client: fixture.other(), owner: fixture.other().account.address, portfolio: fixture.portfolio })
		expect(newcomer.accruedFeesAttoEth).toBe(0n)
	})

	test('an uncontested useful reporter is paid from its question once, without a caller-selected recipient', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		const game = await report(fixture.other(), 1)
		await mature(game)
		const question = await questionState()
		const reward = await fixture.owner().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, question.rewardShares] })
		expect(reward).toBeGreaterThan(0n)
		const balance = await fixture.other().getBalance({ address: fixture.other().account.address })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		expect(await fixture.other().getBalance({ address: fixture.other().account.address })).toBe(balance + reward)
		expect((await questionState()).rewardShares).toBe(0n)
		await expect(fixture.owner().simulateContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] })).rejects.toThrow('Question reward already claimed')
	})

	test('pre-positioning on every outcome cannot capture the correction reward', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		const bond = await fixture.owner().readContract({ ...pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		await report(fixture.owner(), 0, bond)
		await report(fixture.owner(), 1, bond + 1n)
		await report(fixture.owner(), 2, bond + 2n)
		const game = await report(fixture.other(), 1)
		const beneficiary = await fixture.owner().readContract({ ...(await service()), functionName: 'reportingBeneficiaries', args: [game] })
		expect(beneficiary[0].toLowerCase()).toBe(fixture.other().account.address.toLowerCase())
		expect(beneficiary[1]).toBe(1n)
		await mature(game)
		expect((await reward()).recipient.toLowerCase()).toBe((await service()).address.toLowerCase())
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		expect((await questionState()).rewardShares).toBe(0n)
	})

	test('a later top-up to the existing leader cannot steal its reporting reward', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const bond = await fixture.owner().readContract({ ...pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		const game = await report(fixture.other(), 1, bond)
		await report(fixture.owner(), 1)
		const beneficiary = await fixture.owner().readContract({ ...(await service()), functionName: 'reportingBeneficiaries', args: [game] })
		expect(beneficiary[0].toLowerCase()).toBe(fixture.other().account.address.toLowerCase())
	})

	test('a reversible leader cycle cannot claim more ETH than its irreversible reporting risk', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId, 100n * unit)
		const bond = await fixture.owner().readContract({ ...pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		const game = await report(fixture.other(), 1, bond)
		await report(fixture.owner(), 2, bond + 1n)
		await report(fixture.owner(), 1, bond)
		await mature(game)
		const before = await fixture.owner().getBalance({ address: fixture.owner().account.address })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		const received = (await fixture.owner().getBalance({ address: fixture.owner().account.address })) - before
		// Even crediting the attacker the native 60% winner bonus, the losing
		// report costs at least 40% of one bond. A 1-attoREP lead cannot fund a bounty.
		expect(received).toBeLessThan((bond * 2n) / 5n / 100n)
		expect(received).toBe(0n)
	})

	test('a backing owner cannot recycle third-outcome surplus into a near-tie bounty', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		const bond = await fixture.owner().readContract({ ...pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		const game = await report(fixture.other(), 1, bond)
		await report(fixture.owner(), 1, bond * 99n)
		await report(fixture.owner(), 0, bond * 100n - 1n)
		await report(fixture.owner(), 2, bond * 100n + 1n)
		await report(fixture.owner(), 1, bond)
		// This owner receives all released minimum-stake surplus and most winning
		// REP. Only the median increase is necessarily burned, so a bond-only cap fails.
		expect(await rewardCap(game)).toBe(0n)
		await mature(game)
		expect((await reward()).recipient.toLowerCase()).toBe((await service()).address.toLowerCase())
	})

	test('the reporting cap cannot grow after a later accepted REP appreciation', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId, 100n * unit)
		const bond = await fixture.owner().readContract({ ...pool(), functionName: 'initialEscalationGameDepositAttoRep' })
		const game = await report(fixture.other(), 1, bond)
		await report(fixture.owner(), 2, bond + bond / 2n)
		const cap = await rewardCap(game)
		expect(cap).toBeGreaterThan(0n)
		await fixture.refreshPrice()
		await report(fixture.owner(), 1, bond)
		expect(await rewardCap(game)).toBe(cap)
		await mature(game)
		expect((await reward()).cash).toBe(cap)
		const balance = await fixture.owner().getBalance({ address: fixture.owner().account.address })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		expect(await fixture.owner().getBalance({ address: fixture.owner().account.address })).toBe(balance + cap)
	})

	test('a stale report remains possible and settles its unused bounty to maintenance', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const game = await report(fixture.other(), 1)
		expect(await rewardCap(game)).toBe(0n)
		await mature(game)
		const services = await service()
		expect((await reward()).recipient.toLowerCase()).toBe(services.address.toLowerCase())
		const maintenance = await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [fixture.base.genesisUniverse] })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		expect((await questionState()).rewardShares).toBe(0n)
		expect(await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [fixture.base.genesisUniverse] })).toBeGreaterThan(maintenance)
	})

	test('a sub-bond threshold fill cannot restore an ordinary winner after a leader change', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		const game = await report(fixture.other(), 1)
		const threshold = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'nonDecisionThresholdAttoRep' })
		const bond = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'startBondAttoRep' })
		await report(fixture.owner(), 1, threshold - 100n * unit - 1n)
		await report(fixture.owner(), 2, threshold - bond / 2n)
		await report(fixture.owner(), 2, bond)
		await report(fixture.other(), 1, bond)
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'hasReachedNonDecision' })).toBe(true)
		await expect(fixture.owner().simulateContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] })).rejects.toThrow('Question not final')
	})
})
