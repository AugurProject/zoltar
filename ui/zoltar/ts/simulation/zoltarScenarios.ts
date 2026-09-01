import { sortStringArrayByKeccak } from '@zoltar/shared/sortStringArrayByKeccak'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getSimulationChainTimestamp } from '@zoltar/ui-core-shared/simulation/clock.js'
import { deploySimulationAppContracts, reportBootstrapProgress, requireQaAccount, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import type { QuestionData } from '@zoltar/ui-core-shared/types/contracts.js'
import { getDeploymentSteps } from '../protocol/deployment.js'
import { approveErc20 } from '../protocol/tokenActions.js'
import { createMarket, loadZoltarUniverseSummary } from '../protocol/zoltar.js'
import { createZoltarChildUniverse, forkZoltarUniverse } from '../protocol/zoltarForks.js'
import { getZoltarAddress } from '../protocol/zoltarDeploymentHelpers.js'

const defaultScenarioProtocol = { approveErc20, createMarket, createZoltarChildUniverse, forkZoltarUniverse, getDeploymentSteps, getZoltarAddress, loadZoltarUniverseSummary }

type ZoltarScenarioProtocol = Pick<typeof defaultScenarioProtocol, 'approveErc20' | 'createMarket' | 'createZoltarChildUniverse' | 'forkZoltarUniverse' | 'getDeploymentSteps' | 'getZoltarAddress' | 'loadZoltarUniverseSummary'>

let scenarioProtocolOverride: ZoltarScenarioProtocol | undefined

const DAY_IN_SECONDS = 24n * 60n * 60n

export type ZoltarScenario = 'forked-categorical'

export function installZoltarScenarioProtocolForTesting(override: ZoltarScenarioProtocol | undefined) {
	scenarioProtocolOverride = override
}

function getScenarioProtocol(): ZoltarScenarioProtocol {
	return scenarioProtocolOverride ?? defaultScenarioProtocol
}

export function getZoltarScenarioLabel(scenario: ZoltarScenario) {
	switch (scenario) {
		case 'forked-categorical':
			return 'Forked categorical'
		default:
			return assertNever(scenario)
	}
}

export function getZoltarScenarioDescription(scenario: ZoltarScenario) {
	switch (scenario) {
		case 'forked-categorical':
			return 'App contracts are deployed, one five-way categorical fork has already happened, and two child universes are deployed. Use it to test fork warnings, REP migration, and universe switching.'
		default:
			return assertNever(scenario)
	}
}

function createForkedCategoricalQuestion(currentTimestamp: bigint): { marketType: 'categorical'; outcomeLabels: string[]; questionData: QuestionData } {
	const outcomeLabels = sortStringArrayByKeccak(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])

	return {
		marketType: 'categorical',
		outcomeLabels,
		questionData: {
			answerUnit: '',
			description: '',
			displayValueMax: 0n,
			displayValueMin: 0n,
			endTime: currentTimestamp - DAY_IN_SECONDS,
			numTicks: 0n,
			startTime: currentTimestamp - 30n * DAY_IN_SECONDS,
			title: 'Which outcome wins the first fork?',
		},
	}
}

async function seedForkedCategoricalScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress }: BootstrapScenarioApplyParameters) {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1')
	const writeClient = createWriteClient(primaryAccount)
	const readClient = createReadClient()
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	const seededQuestion = createForkedCategoricalQuestion(currentTimestamp)

	const marketResult = await getScenarioProtocol().createMarket(writeClient, seededQuestion)
	await reportBootstrapProgress(onProgress, 'Creating seeded categorical fork question', 0.88)

	const universeId = 0n
	const questionId = BigInt(marketResult.questionId)
	const rootUniverse = await getScenarioProtocol().loadZoltarUniverseSummary(readClient, universeId)
	if (rootUniverse === undefined) throw new Error('Expected the seeded genesis universe before forking')
	await getScenarioProtocol().approveErc20(writeClient, rootUniverse.reputationToken, getScenarioProtocol().getZoltarAddress(), rootUniverse.forkThresholdAttoRep, 'approveForkRep')
	await reportBootstrapProgress(onProgress, 'Approving seeded REP for the fork threshold', 0.9)
	await getScenarioProtocol().forkZoltarUniverse(writeClient, universeId, questionId)
	await reportBootstrapProgress(onProgress, 'Forking the seeded genesis universe', 0.92)

	for (const outcomeIndex of [0n, 1n] as const) {
		await getScenarioProtocol().createZoltarChildUniverse(writeClient, universeId, outcomeIndex)
	}
	await reportBootstrapProgress(onProgress, 'Deploying two seeded child universes', 0.96)

	const universeSummary = await getScenarioProtocol().loadZoltarUniverseSummary(readClient, universeId)
	if (universeSummary === undefined) throw new Error('Expected the seeded genesis universe after forking')
	if (!universeSummary.hasForked) throw new Error('Expected the seeded genesis universe to be forked')
	if (universeSummary.forkQuestionDetails?.marketType !== 'categorical') throw new Error('Expected the seeded fork question to be categorical')
	if (universeSummary.forkQuestionDetails.outcomeLabels.length !== 5) throw new Error('Expected five seeded categorical outcomes')
	if (universeSummary.childUniverses.filter(child => child.exists).length !== 2) throw new Error('Expected two deployed child universes in the seeded fork scenario')

	await reportBootstrapProgress(onProgress, 'Seeded forked categorical scenario is ready', 0.995)
}

export async function applyZoltarScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, scenario }: BootstrapScenarioApplyParameters): Promise<boolean> {
	const primaryAccount = requireQaAccount(accounts[0], 'Expected seeded simulation QA account A1')

	switch (scenario) {
		case 'forked-categorical':
			await deploySimulationAppContracts(createWriteClient(primaryAccount), memoryClient, onProgress, profile, { start: 0.32, end: 0.82 }, getScenarioProtocol().getDeploymentSteps)
			await seedForkedCategoricalScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile, scenario })
			return true
		default:
			return false
	}
}
