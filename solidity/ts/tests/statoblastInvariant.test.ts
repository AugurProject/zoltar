import { describe, expect, test } from 'bun:test'
import { balanceOfShares } from '../testSupport/simulator/utils/contracts/statoblast'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
} from '../types/contractArtifact'
import { collateralBalance } from './statoblast/burnEvidence'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

// Fee-stream, liquidation, retirement-tree, fork, and auction invariants have their
// own model/consumer suites. This flat cash/share model exercises their common
// question boundary without reproducing the implementation's settlement book.
describe('Portfolio cross-question conservation model', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })
	const seeds = [0x51a2e5n, 0x1164n, 0xc0ffeen]
	for (const initialSeed of seeds) {
		test(`mint, partial return, and final exit preserve cash and isolate donations (seed ${initialSeed})`, async () => {
			await fixture.prepare(1_000n * unit, 200n * unit)
			const owner = fixture.owner()
			const trader = fixture.other()
			const settlement = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
			const questions = [fixture.base.questionId, fixture.secondQuestionId].map(id => ({ id, ...fixture.poolFor(id), cash: 0n }))
			const forcedSurplus = 17n * unit + 3n
			await fixture.base.mockWindow.setBalance(settlement, (await owner.getBalance({ address: settlement })) + forcedSurplus)
			for (const question of questions) await fixture.base.mockWindow.setBalance(question.securityPool, forcedSurplus)
			let seed = initialSeed
			const random = (max: bigint) => {
				seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
				return seed % max
			}
			const verify = async () => {
				let cash = 0n
				for (const question of questions) {
					const snapshot = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'snapshotQuestion', args: [question.securityPool] })
					expect(snapshot.questionCashAttoEth).toBe(question.cash)
					expect(snapshot.outcomeSupplyAttoShares).toBe(question.cash)
					expect(snapshot.demandAttoEth).toBe(questions.reduce((sum, item) => sum + item.cash, 0n))
					expect(snapshot.questionRecoveryAttoRep).toBe(0n)
					expect(await balanceOfShares(owner, question.shareToken, fixture.base.genesisUniverse, trader.account.address)).toEqual([question.cash, question.cash, question.cash])
					expect(await owner.getBalance({ address: question.securityPool })).toBe(forcedSurplus)
					expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), question.securityPool)).toBe(0n)
					cash += question.cash
				}
				expect(await owner.getBalance({ address: settlement })).toBe(forcedSurplus)
				expect(await collateralBalance(owner, fixture.portfolio, settlement)).toBe(cash)
				expect(await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'demandAttoEth' })).toBe(cash)
				expect(await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(200n * unit - cash)
				expect(await getERC20Balance(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.capitalLedger)).toBe(1_000n * unit)
			}
			for (let step = 0; step < 16; step++) {
				const question = questions[Number(random(2n))]
				if (question === undefined) throw new Error('Model question missing')
				if (question.cash !== 0n && random(3n) === 0n) {
					const amount = random(question.cash) + 1n
					const before = await collateralBalance(trader, fixture.portfolio, trader.account.address)
					const hash = await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: question.securityPool, functionName: 'redeemCompleteSet', args: [amount] }))
					const receipt = await trader.waitForTransactionReceipt({ hash })
					expect(receipt.status).toBe('success')
					expect(await collateralBalance(trader, fixture.portfolio, trader.account.address)).toBe(before + amount)
					question.cash -= amount
				} else {
					const amount = step === 0 ? 1n : random(3n * unit) + 1n
					await fixture.mint(amount, question.id, { sender: trader })
					question.cash += amount
				}
				await verify()
			}
			for (const question of questions) {
				if (question.cash !== 0n) await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: question.securityPool, functionName: 'redeemCompleteSet', args: [question.cash] }))
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
