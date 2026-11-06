import { beforeAll, beforeEach } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { type AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { DAY, GENESIS_UNIVERSE, STATOBLAST_SECURITY_MULTIPLIER_BPS, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed } from '../../testSupport/simulator/utils/contracts/zoltar'
import { ensureInfraDeployed } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'

/** Protocol and question setup without a seed pool or any pre-existing vault. */
export function usePortfolioProtocolFixture() {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let questionData: ReturnType<typeof makeQuestion>
	let questionId: bigint
	const outcomes = ['Yes', 'No']
	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		questionData = makeQuestion('Portfolio question', (await mockWindow.getTime()) + 365n * DAY)
		questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await setBaselineSnapshot()
	})
	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
	})
	return {
		get mockWindow() {
			return mockWindow
		},
		get client() {
			return client
		},
		get questionData() {
			return questionData
		},
		get questionId() {
			return questionId
		},
		genesisUniverse: GENESIS_UNIVERSE,
		statoblastSecurityMultiplierBps: STATOBLAST_SECURITY_MULTIPLIER_BPS,
		outcomes,
		setBaselineSnapshot,
	}
}
