import { sortBigIntsAscending } from '@zoltar/core-shared/serialization/bigInt'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { beforeEach, describe, expect, test } from 'bun:test'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import assert from '../../testSupport/simulator/utils/assert'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getScalarOutcomeIndex } from '../../testSupport/simulator/utils/contracts/scalarOutcome'
import { getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares, migrateShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { ensureDefined, strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { approveToken, getChildUniverseId, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import {
	statoblast_tokens_ShareToken_ShareToken,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: shared portfolio multi-branch migration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	let client: ReturnType<typeof fixture.owner>
	let mockWindow: typeof fixture.base.mockWindow
	let securityPoolAddresses: ReturnType<typeof fixture.poolFor>
	let questionId: bigint
	let genesisUniverse: bigint
	beforeEach(() => {
		client = fixture.owner()
		mockWindow = fixture.base.mockWindow
		questionId = fixture.base.questionId
		genesisUniverse = fixture.base.genesisUniverse
		securityPoolAddresses = fixture.poolFor(questionId)
	})
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const controller = async () => ({ abi: forkArtifact.abi, address: await client.readContract({ ...portfolio(), functionName: 'forkController' }) })
	const finishChoiceWindow = async () => {
		await mockWindow.setTime((await getUniverseData(client, genesisUniverse)).forkTime + 63n * DAY)
	}
	const activateBranch = async (outcome: bigint, materialize = true, source = securityPoolAddresses.securityPool) => {
		const target = await controller()
		const child = getChildUniverseId(genesisUniverse, outcome)
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'startBranch', args: [genesisUniverse, outcome] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'finalizeBranch', args: [child] }))
		if (materialize) await writeContractAndWait(client, () => client.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [source, child] }))
		return child
	}
	test('migrates INVALID, YES, and NO entitlements into many outcomes of an unrelated scalar fork', async () => {
		const openInterestAmount = 5n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		const scalarForkQuestion = {
			title: 'unrelated scalar fork',
			description: '',
			startTime: 0n,
			endTime: await mockWindow.getTime(),
			numTicks: 10n,
			displayValueMin: 0n,
			displayValueMax: 10n,
			answerUnit: 'km',
		}
		const scalarQuestionId = getQuestionId(scalarForkQuestion, [])
		assert.notEqual(scalarQuestionId, questionId, 'the universe fork question must be unrelated to the SecurityPool binary question')

		await createQuestion(client, scalarForkQuestion, [])
		await fixture.prepare()
		await fixture.mint(openInterestAmount, questionId, { sender: openInterestHolder })
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, scalarQuestionId)

		const middleScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
		const bulkScalarOutcomes = sortBigIntsAscending([0n, ...[0n, 1n, 2n, 3n, 4n, 6n, 7n, 8n, 9n, 10n].map(tick => getScalarOutcomeIndex(scalarForkQuestion, tick))])
		await finishChoiceWindow()
		for (const outcome of [...bulkScalarOutcomes, middleScalarOutcome]) {
			await activateBranch(outcome)
		}
		const holderAddress = addressString(TEST_ADDRESSES[2])
		const parentBalancesBeforeMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		const sourceOutcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No] as const
		const parentTokenIds = await Promise.all(
			sourceOutcomes.map(
				async outcome =>
					await client.readContract({
						address: securityPoolAddresses.shareToken,
						abi: statoblast_tokens_ShareToken_ShareToken.abi,
						functionName: 'getTokenId',
						args: [genesisUniverse, outcome],
					}),
			),
		)
		for (const sourceOutcome of sourceOutcomes) {
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, bulkScalarOutcomes)
		}

		const parentBalancesAfterBulkMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		assert.deepStrictEqual(parentBalancesAfterBulkMigration, parentBalancesBeforeMigration, 'all parent shares should remain as persistent child-claim entitlements')

		for (const scalarOutcome of bulkScalarOutcomes) {
			const childUniverse = getChildUniverseId(genesisUniverse, scalarOutcome)
			const childBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, childUniverse, holderAddress)
			assert.deepStrictEqual(childBalances, parentBalancesBeforeMigration, 'each scalar child should receive the holder’s complete INVALID/YES/NO position')
			for (let sourceIndex = 0; sourceIndex < sourceOutcomes.length; sourceIndex++) {
				const parentTokenId = ensureDefined(parentTokenIds[sourceIndex], 'parent source token id is undefined')
				const parentBalance = ensureDefined(parentBalancesBeforeMigration[sourceIndex], 'parent source balance is undefined')
				strictEqualTypeSafe(
					await client.readContract({
						address: securityPoolAddresses.shareToken,
						abi: statoblast_tokens_ShareToken_ShareToken.abi,
						functionName: 'getMigratedShareAmountAttoShares',
						args: [parentTokenId, childUniverse, holderAddress],
					}),
					parentBalance,
					'each child migration record should preserve the corresponding source share entitlement',
				)
			}
		}

		for (const sourceOutcome of sourceOutcomes) {
			await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, sourceOutcome, [middleScalarOutcome])
		}
		const middleScalarUniverse = getChildUniverseId(genesisUniverse, middleScalarOutcome)
		const middleScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, middleScalarUniverse, holderAddress)
		assert.deepStrictEqual(middleScalarBalances, parentBalancesBeforeMigration, 'a later scalar child selection should independently receive all three source entitlements')
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [middleScalarOutcome]), /ShareToken has no new shares to migrate/)

		const parentYesTokenId = ensureDefined(parentTokenIds[1], 'parent yes token id is undefined')
		const parentYesBalance = ensureDefined(parentBalancesBeforeMigration[1], 'parent yes balance is undefined')
		await assert.rejects(
			openInterestHolder.writeContract({
				address: securityPoolAddresses.shareToken,
				abi: statoblast_tokens_ShareToken_ShareToken.abi,
				functionName: 'safeTransferFrom',
				args: [holderAddress, addressString(TEST_ADDRESSES[3]), parentYesTokenId, parentYesBalance],
			}),
			/ShareToken migrated source balance is locked/,
		)
	})

	test('rejects malformed and missing-child bulk targets while lazily creating one migration child', async () => {
		const openInterestAmount = 5n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		const scalarForkQuestion = {
			title: 'scalar fork',
			description: '',
			startTime: 0n,
			endTime: await mockWindow.getTime(),
			numTicks: 10n,
			displayValueMin: 0n,
			displayValueMax: 10n,
			answerUnit: 'km',
		}
		const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

		await createQuestion(client, scalarForkQuestion, [])
		await fixture.prepare()
		await fixture.mint(openInterestAmount, questionId, { sender: openInterestHolder })
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, scalarQuestionId)

		const holderAddress = addressString(TEST_ADDRESSES[2])
		const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
		const validScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
		const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
		const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
		const parentBalancesBeforeFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		const parentYesBalance = ensureDefined(parentBalancesBeforeFailedMigrations[1], 'parent yes balance is undefined')

		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [5n]), /ShareToken target outcome is malformed for the fork question/)
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome, validScalarOutcome]), /ShareToken target outcomes must be provided in strictly increasing order/)
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [...sortedScalarOutcomes].reverse()), /ShareToken target outcomes must be provided in strictly increasing order/)
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes), /ShareToken bulk migration requires canonical child pools/)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.Operational, 'rejected bulk migration should roll back automatic source-pool fork initiation')

		const parentBalancesAfterFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		strictEqualTypeSafe(parentBalancesAfterFailedMigrations[1], parentYesBalance, 'failed migrations should preserve the parent yes share balance')

		await finishChoiceWindow()
		await activateBranch(validScalarOutcome, false)
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome])
		const lazilyCreatedUniverse = getChildUniverseId(genesisUniverse, validScalarOutcome)
		const lazilyCreatedBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lazilyCreatedUniverse, holderAddress)
		strictEqualTypeSafe(lazilyCreatedBalances[1], parentYesBalance, 'a single missing target should create its canonical child and materialize the source balance')
	})

	test('two questions preserve their cash and recovery shares when owners choose different branches', async () => {
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, fixture.other())
		await fixture.authorize(200n * unit, fixture.other())
		const amounts = [10n * unit + 2n, 7n * unit + 1n]
		const questions = [questionId, fixture.secondQuestionId]
		for (let i = 0; i < questions.length; i++) await fixture.mint(ensureDefined(amounts[i], 'Missing amount'), ensureDefined(questions[i], 'Missing question'))
		const unrelated = { ...fixture.base.questionData, title: 'Shared cash disagreement', startTime: 0n, endTime: (await mockWindow.getTime()) - 1n }
		await createQuestion(client, unrelated, fixture.base.outcomes)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, getQuestionId(unrelated, fixture.base.outcomes))
		const target = await controller()
		for (const [sender, outcome] of [
			[client, 1n],
			[fixture.other(), 2n],
		] as const) {
			await writeContractAndWait(sender, () => sender.writeContract({ ...target, functionName: 'choose', args: [genesisUniverse, outcome] }))
		}
		await finishChoiceWindow()
		const settlement = await client.readContract({ ...portfolio(), functionName: 'settlement' })
		const cashBefore = await client.getBalance({ address: settlement })
		let paid = 0n
		for (const outcome of [1n, 2n]) {
			for (let i = 0; i < questions.length; i++) {
				const question = ensureDefined(questions[i], 'Missing question')
				const amount = ensureDefined(amounts[i], 'Missing amount')
				const parent = fixture.poolFor(question)
				const child = await activateBranch(outcome, true, parent.securityPool)
				const childPool = await client.readContract({ ...portfolio(), functionName: 'getPool', args: [question, child] })
				for (const source of [0, 1, 2]) await migrateShares(fixture.other(), parent.shareToken, genesisUniverse, source, [outcome])
				expect(await balanceOfShares(client, parent.shareToken, child, fixture.other().account.address)).toEqual([amount, amount, amount])
				const cash = await client.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [childPool, amount] })
				expect(cash).toBeGreaterThanOrEqual(amount / 2n - 1n)
				expect(cash).toBeLessThanOrEqual((amount + 1n) / 2n)
				const recovery = await client.readContract({ ...portfolio(), functionName: 'quoteQuestionRecoveryRep', args: [childPool, amount] })
				expect(recovery).toBeGreaterThan(0n)
				const balanceBefore = await getERC20Balance(client, getRepTokenAddress(child), fixture.other().account.address)
				await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemCompleteSet', args: [amount] }))
				expect(await getERC20Balance(client, getRepTokenAddress(child), fixture.other().account.address)).toBe(balanceBefore + recovery)
				paid += cash
				expect(await client.getBalance({ address: settlement })).toBe(cashBefore - paid)
				expect(await client.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
			}
		}
		expect(cashBefore - paid).toBeLessThanOrEqual(4n)
	})

	test('an empty portfolio activates a zero-collateral child without an auction', async () => {
		await mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, questionId)
		await finishChoiceWindow()
		const child = await activateBranch(1n)
		const target = await controller()
		expect((await client.readContract({ ...target, functionName: 'branches', args: [child] })).ready).toBe(true)
		expect(BigInt(await client.readContract({ ...target, functionName: 'auctions', args: [child] }))).toBe(0n)
		const childPool = await client.readContract({ ...portfolio(), functionName: 'getPool', args: [questionId, child] })
		expect(await getSystemState(client, childPool)).toBe(SystemState.Operational)
		expect(await client.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [childPool, 0n] })).toBe(0n)
		expect(await client.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
	})
})
