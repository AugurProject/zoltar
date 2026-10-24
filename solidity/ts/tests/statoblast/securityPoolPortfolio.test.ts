import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	ReputationToken_ReputationToken as repArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createCompleteSet, depositRepToVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { maximumQuestionHorizonSeconds, portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: central portfolio and native question integration', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const demand = () => fixture.owner().readContract({ ...capital(), functionName: 'demandAttoEth' })
	const ownerAccount = () => fixture.owner().readContract({ ...capital(), functionName: 'ownerAccount', args: [fixture.owner().account.address] })

	test('invalid setup economics and missing module code are rejected before creating an unfinished portfolio', async () => {
		const infrastructure = getInfraContractAddresses()
		const deployers = {
			capital: infrastructure.securityPoolCapitalLedgerDeployer,
			commitments: infrastructure.securityPoolCommitmentIndexDeployer,
			fees: infrastructure.securityPoolCapitalFeeStreamsDeployer,
			books: infrastructure.securityPoolSettlementBookDeployer,
			settlement: infrastructure.securityPoolPortfolioSettlementDeployer,
			reporters: infrastructure.securityPoolReporterLedgerDeployer,
			forks: infrastructure.securityPoolPortfolioForkCoordinatorDeployer,
		}
		const deploy = (configuration = portfolioEconomics, modules = deployers) =>
			deployContract(
				fixture.owner(),
				encodeDeployData({
					abi: portfolioArtifact.abi,
					bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object),
					args: [infrastructure.securityPoolFactory, fixture.base.securityPoolAddresses.securityPool, maximumQuestionHorizonSeconds, modules, fixture.questionAdmissionPolicy, configuration],
				}),
			)
		for (const minimumOutcomeRate of [0n, unit + 1n]) await expect(deploy({ ...portfolioEconomics, minimumOutcomeRate })).rejects.toThrow('Invalid minimum exchange rate')
		await expect(deploy({ ...portfolioEconomics, annualFeeBps: 10_001n })).rejects.toThrow('Invalid portfolio economics')
		for (const key of Object.keys(deployers)) await expect(deploy(portfolioEconomics, { ...deployers, [key]: fixture.owner().account.address })).rejects.toThrow('Portfolio deployer has no code')
	})

	test('permissionless registration binds distinct canonical shares without authorizing or moving owner capital', async () => {
		const { base, owner, poolFor, secondQuestionId } = fixture
		await fixture.deposit()
		const before = await ownerAccount()
		await fixture.register(secondQuestionId)
		expect(await owner().readContract({ ...portfolio(), functionName: 'questionCount' })).toBe(2n)
		expect(await owner().readContract({ ...portfolio(), functionName: 'getQuestions', args: [0n, 10n] })).toEqual([base.questionId, secondQuestionId])
		expect(poolFor(base.questionId).shareToken).not.toBe(poolFor(secondQuestionId).shareToken)
		for (const question of [base.questionId, secondQuestionId]) {
			const pool = poolFor(question).securityPool
			expect(await owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'portfolioCustody' })).toBe(fixture.capitalLedger)
			expect(await owner().readContract({ ...portfolio(), functionName: 'getPool', args: [question, base.genesisUniverse] })).toBe(pool)
		}
		expect(await ownerAccount()).toEqual(before)
		expect(await demand()).toBe(0n)
	})

	test('two questions consume one capacity budget while REP remains in one ledger', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(60n * unit)
		await expect(fixture.mint(41n * unit, fixture.secondQuestionId)).rejects.toThrow('Insufficient healthy shared commitment')
		await fixture.mint(39n * unit, fixture.secondQuestionId)
		expect(await demand()).toBeLessThanOrEqual(99n * unit)
		expect(await demand()).toBeGreaterThan(98n * unit)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		expect(await fixture.owner().readContract({ abi: repArtifact.abi, address: token, functionName: 'balanceOf', args: [fixture.capitalLedger] })).toBe(1_000n * unit)
		for (const question of [fixture.base.questionId, fixture.secondQuestionId]) expect(await fixture.owner().readContract({ abi: repArtifact.abi, address: token, functionName: 'balanceOf', args: [fixture.poolFor(question).securityPool] })).toBe(0n)
	})

	test('returning complete sets pays traders and retires requested backing without question claims', async () => {
		await fixture.prepare(1_000n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		const id = (await ownerAccount()).positionId
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'requestRetirement', args: [id] }))
		const pool = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.securityPool, shares[0])
		expect(await demand()).toBe(0n)
		const index = await fixture.owner().readContract({ ...capital(), functionName: 'commitmentIndex' })
		expect(await fixture.owner().readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).toMatchObject({ rep: 0n, commitment: 0n, releasedRep: 1_000n * unit })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [1_000n * unit, fixture.owner().account.address] }))
		expect((await ownerAccount()).freeAttoRep).toBe(0n)
	})

	test('bound native entry points cannot bypass purchase fees or create manual competing backing', async () => {
		await fixture.prepare()
		const pool = fixture.poolFor(fixture.base.questionId).securityPool
		await expect(createCompleteSet(fixture.other(), pool, unit)).rejects.toThrow('Use portfolio purchase')
		await expect(depositRepToVault(fixture.owner(), pool, 100n * unit)).rejects.toThrow()
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'totalFreeAttoRep' })).toBe(0n)
		await expect(fixture.other().writeContract({ ...portfolio(), functionName: 'mintQuestionSettlement', value: unit })).rejects.toThrow('Unknown question callback')
		await expect(fixture.other().writeContract({ ...portfolio(), functionName: 'onSharedPriceAccepted', args: [fixture.base.genesisUniverse, unit, 1] })).rejects.toThrow('Only canonical shared feed')
		await expect(fixture.other().writeContract({ ...capital(), functionName: 'setDemand', args: [0n] })).rejects.toThrow('Only fork authority')
	})

	test('stale prices block new purchases and live collateral withdrawal while idle owners can exit', async () => {
		await fixture.deposit(1_100n * unit)
		await fixture.refreshPrice()
		await fixture.authorize(100n * unit)
		await fixture.deposit(100n * unit, fixture.other())
		await fixture.base.mockWindow.setTime(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' }))
		await expect(fixture.mint()).rejects.toThrow()
		expect(await fixture.owner().readContract({ ...portfolio(), functionName: 'availableMintCapacity', args: [fixture.base.genesisUniverse] })).toBe(0n)
		await expect(fixture.owner().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [100n * unit, fixture.owner().account.address] })).rejects.toThrow('Capital price stale')
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...capital(), functionName: 'withdrawPrincipal', args: [100n * unit, fixture.other().account.address] }))
		expect((await ownerAccount()).freeAttoRep).toBe(0n)
	})

	test('late question registration cannot reprice, dilute or move existing positions', async () => {
		await fixture.prepare()
		const accountBefore = await ownerAccount()
		const acceptedPrice = await fixture.owner().readContract({ ...capital(), functionName: 'acceptedPrice' })
		const validUntil = await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' })
		for (let i = 0; i < 8; i++) {
			const question = makeQuestion(`Permissionless late question ${i}`, fixture.base.questionData.endTime + BigInt(i + 1))
			const id = getQuestionId(question, fixture.base.outcomes)
			await createQuestion(fixture.owner(), question, fixture.base.outcomes)
			await fixture.register(id)
		}
		expect(await ownerAccount()).toEqual(accountBefore)
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'acceptedPrice' })).toBe(acceptedPrice)
		expect(await fixture.owner().readContract({ ...capital(), functionName: 'priceValidUntil' })).toBe(validUntil)
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash: await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital(), functionName: 'claimEarnings' })) })
		expect(receipt.gasUsed).toBeLessThan(500_000n)
	})

	test('a second portfolio cannot spend the first portfolio capital or share balances', async () => {
		await fixture.prepare()
		const second = await fixture.deployPortfolio()
		await fixture.register(fixture.base.questionId, second)
		const secondPool = fixture.poolFor(fixture.base.questionId, fixture.base.genesisUniverse, zeroAddress, second)
		expect(secondPool.securityPool).not.toBe(fixture.poolFor(fixture.base.questionId).securityPool)
		await fixture.refreshPrice(fixture.base.questionId, unit, second)
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: second })).rejects.toThrow('Insufficient healthy shared commitment')
		await fixture.refreshPrice()
		await fixture.mint(unit)
		expect(await balanceOfShares(fixture.owner(), secondPool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([0n, 0n, 0n])
	})
})
