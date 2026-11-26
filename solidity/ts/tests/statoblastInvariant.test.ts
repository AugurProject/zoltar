import { describe, expect, test } from 'bun:test'
import { balanceOfShares } from '../testSupport/simulator/utils/contracts/statoblast'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
} from '../types/contractArtifact'
import { collateralBalance } from './statoblast/burnEvidence'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Fee-stream, liquidation, retirement-tree, fork, and auction invariants have their
// own model/consumer suites. This flat cash/share model exercises their common
// question boundary without reproducing the implementation's settlement book.
describe('Security pool cross-question conservation model', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })
	test('two questions share the last unit of underwriting capacity', async () => {
		await fixture.prepare(1_000n * unit, unit)
		const buyer = fixture.other()
		const capacity = () => buyer.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })
		await fixture.mint(unit - 1n, fixture.base.questionId)
		expect(await capacity()).toBe(1n)
		await fixture.mint(1n, fixture.secondQuestionId)
		expect(await capacity()).toBe(0n)
		for (const id of [fixture.base.questionId, fixture.secondQuestionId]) {
			await expect(fixture.mint(1n, id)).rejects.toThrow('Purchase exceeds healthy capacity')
			const outstanding = id === fixture.base.questionId ? unit - 1n : 1n
			expect(await balanceOfShares(buyer, fixture.poolFor(id).shareToken, fixture.base.genesisUniverse, buyer.account.address)).toEqual([outstanding, outstanding, outstanding])
		}
		const second = fixture.poolFor(fixture.secondQuestionId)
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: poolArtifact.abi, address: second.questionLedger, functionName: 'redeemCompleteSet', args: [1n, 0n, 0n] }))
		expect(await capacity()).toBe(1n)
		await fixture.mint(1n, fixture.base.questionId)
		expect(await capacity()).toBe(0n)
	})
	const seeds = [0x51a2e5n, 0x1164n, 0xc0ffeen]
	for (const initialSeed of seeds) {
		test(`mint, partial return, and final exit preserve cash and isolate donations (seed ${initialSeed})`, async () => {
			await fixture.prepare(1_000n * unit, 200n * unit)
			const owner = fixture.owner()
			const trader = fixture.other()
			const settlement = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
			const questions = [fixture.base.questionId, fixture.secondQuestionId].map(id => ({ id, ...fixture.poolFor(id), cash: 0n }))
			const forcedSurplus = 17n * unit + 3n
			await fixture.base.mockWindow.setBalance(settlement, (await owner.getBalance({ address: settlement })) + forcedSurplus)
			for (const question of questions) await fixture.base.mockWindow.setBalance(question.questionLedger, forcedSurplus)
			let seed = initialSeed
			const random = (max: bigint) => {
				seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
				return seed % max
			}
			const verify = async () => {
				let cash = 0n
				for (const question of questions) {
					const snapshot = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [question.questionLedger] })
					expect(snapshot.questionCashAttoEth).toBe(question.cash)
					expect(snapshot.outcomeSupplyAttoShares).toBe(question.cash)
					const supplies = await Promise.all([0, 1, 2].map(outcome => owner.readContract({ abi: shareArtifact.abi, address: question.shareToken, functionName: 'totalSupplyForOutcome', args: [fixture.base.genesisUniverse, outcome] })))
					expect(supplies).toEqual([question.cash, question.cash, question.cash])
					expect(snapshot.demandAttoEth).toBe(questions.reduce((sum, item) => sum + item.cash, 0n))
					expect(snapshot.questionRecoveryAttoRep).toBe(0n)
					expect(await balanceOfShares(owner, question.shareToken, fixture.base.genesisUniverse, trader.account.address)).toEqual([question.cash, question.cash, question.cash])
					expect(await owner.getBalance({ address: question.questionLedger })).toBe(forcedSurplus)
					expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), question.questionLedger)).toBe(0n)
					cash += question.cash
				}
				expect(await owner.getBalance({ address: settlement })).toBe(forcedSurplus)
				expect(await collateralBalance(owner, fixture.securityPool, settlement)).toBe(cash)
				expect(await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'demandAttoEth' })).toBe(cash)
				expect(await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(200n * unit - cash)
				expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.capitalLedger)).toBe(1_000n * unit)
			}
			for (let step = 0; step < 16; step++) {
				const question = questions[Number(random(2n))]
				if (question === undefined) throw new Error('Model question missing')
				if (question.cash !== 0n && random(3n) === 0n) {
					const amount = random(question.cash) + 1n
					const before = await collateralBalance(trader, fixture.securityPool, trader.account.address)
					const hash = await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: question.questionLedger, functionName: 'redeemCompleteSet', args: [amount, 0n, 0n] }))
					const receipt = await trader.waitForTransactionReceipt({ hash })
					expect(receipt.status).toBe('success')
					expect(await collateralBalance(trader, fixture.securityPool, trader.account.address)).toBe(before + amount)
					question.cash -= amount
				} else {
					const amount = step === 0 ? 1n : random(3n * unit) + 1n
					await fixture.mint(amount, question.id, { sender: trader })
					question.cash += amount
				}
				await verify()
			}
			for (const question of questions) {
				if (question.cash !== 0n) await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: question.questionLedger, functionName: 'redeemCompleteSet', args: [question.cash, 0n, 0n] }))
				question.cash = 0n
				await verify()
			}
			await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'setCommitment', args: [0n] }))
			const repBefore = await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), owner.account.address)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'withdrawPrincipal', args: [1_000n * unit, owner.account.address] }))
			expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), owner.account.address)).toBe(repBefore + 1_000n * unit)
			expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.capitalLedger)).toBe(0n)
			expect(await owner.getBalance({ address: settlement })).toBe(forcedSurplus)
		})
	}
})
