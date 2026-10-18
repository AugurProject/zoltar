import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { finishChildInitialization, initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { approveToken, getChildUniverseId, requireAddress, requireArray, requireBigInt, requireBoolean } from '../../testSupport/simulator/utils/utilities'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../../types/contractArtifact'
import { useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

export const sharedChoiceDuration = 4n * 7n * DAY
export const nativeMigrationDuration = 8n * 7n * DAY

export const sharedForkControllerAbi = parseAbi([
	'function chooseSharedFork(uint256 contextId,uint256[] intervalIds,uint256 outcomeIndex)',
	'function revokeSharedFork(uint256 contextId,uint256[] intervalIds)',
	'function processForkPosition(uint256 contextId,uint256 positionId,uint256 outcomeIndex) returns (bool progressed)',
	'function claimForkRecovered(uint256 contextId,uint256[] intervalIds,uint256[] positionIds)',
	'function claimPosition(uint256 contextId,uint256 positionId,uint256 intervalId)',
	'function claimPositionAndMigrate(uint256 contextId,uint256 positionId,uint256 intervalId,uint256 outcomeIndex)',
	'function childContextIds(uint256 contextId,uint256 outcomeIndex) view returns (uint256)',
	'function choiceWindow(uint256 contextId) view returns (uint256 opensAt,uint256 closesAt)',
	'function choices(uint256 contextId,address owner,uint256 intervalId) view returns (bool selected,uint256 outcomeIndex,uint256 childIntervalId)',
	'function getBranchWeight(uint256 contextId,uint256 positionId,uint256 outcomeIndex) view returns (uint256)',
	'function readPosition(uint256 contextId,uint256 positionId) view returns (address custody,uint256 remainingShares,uint256 unmigratedShares,bool recoveryComplete)',
	'function getContext(uint256 contextId) view returns (uint256 universeId,uint256 parentContextId,uint256 outcomeIndex,uint256 incomingActivationFloor,address ledger,address repToken,uint256 pointCount)',
])

export function useSharedPortfolioForkFixture() {
	const aggregate = useAggregatePortfolioFixture()
	const { fixture, deposit, mint } = aggregate
	const third = () => createWriteClient(fixture.base.mockWindow, TEST_ADDRESSES[2])
	const controller = async () => requireAddress(await fixture.owner().readContract({ abi: parseAbi(['function forkController() view returns (address)']), address: fixture.portfolio, functionName: 'forkController' }), 'Portfolio fork controller')
	const choose = async (outcome = 1n, owner = fixture.owner(), contextId = 0n, intervalIds = [0n]) => {
		const address = await controller()
		return await writeContractAndWait(owner, () => owner.writeContract({ abi: sharedForkControllerAbi, address, functionName: 'chooseSharedFork', args: [contextId, intervalIds, outcome] }))
	}
	const process = async (positionId = 1n, outcome = 1n, contextId = 0n, sender = fixture.other()) => {
		const address = await controller()
		return await writeContractAndWait(sender, () => sender.writeContract({ abi: sharedForkControllerAbi, address, functionName: 'processForkPosition', args: [contextId, positionId, outcome] }))
	}
	const childContext = async (outcome = 1n, contextId = 0n) => requireBigInt(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'childContextIds', args: [contextId, outcome] }), 'Child context')
	const branchWeight = async (positionId = 1n, outcome = 1n, contextId = 0n) => requireBigInt(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'getBranchWeight', args: [contextId, positionId, outcome] }), 'Shared branch weight')
	const forkPosition = async (contextId: bigint, positionId = 1n): Promise<readonly [Address, bigint, bigint, boolean]> => {
		const result = requireArray(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'readPosition', args: [contextId, positionId] }), 'Shared position')
		return [requireAddress(result[0], 'Shared custody'), requireBigInt(result[1], 'Logical shares'), requireBigInt(result[2], 'Physical shares'), requireBoolean(result[3], 'Recovery complete')]
	}
	const revoke = async (owner = fixture.owner(), contextId = 0n, intervalIds = [0n]) => {
		const address = await controller()
		return await writeContractAndWait(owner, () => owner.writeContract({ abi: sharedForkControllerAbi, address, functionName: 'revokeSharedFork', args: [contextId, intervalIds] }))
	}
	const window = async (contextId = 0n): Promise<readonly [bigint, bigint]> => {
		const result = requireArray(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'choiceWindow', args: [contextId] }), 'Shared choice window')
		return [requireBigInt(result[0], 'Choice opening'), requireBigInt(result[1], 'Choice cutoff')]
	}
	const collect = async (contextId: bigint, owner = fixture.owner(), intervalIds = [0n], positionIds: bigint[] = []) => {
		const address = await controller()
		return await writeContractAndWait(owner, () => owner.writeContract({ abi: sharedForkControllerAbi, address, functionName: 'claimForkRecovered', args: [contextId, intervalIds, positionIds] }))
	}
	const allocate = async (ownerCount = 2, bothQuestions = true) => {
		const owners = [fixture.owner(), fixture.other(), third()].slice(0, ownerCount)
		for (const owner of owners) await deposit(5_000n * unit, owner)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint(20n * unit)
		if (bothQuestions) await mint(20n * unit, fixture.secondQuestionId)
		return owners
	}
	const fork = async (options: { ownQuestion?: boolean; scalar?: boolean; activatePools?: boolean } = {}) => {
		if ((await fixture.base.mockWindow.getTime()) <= fixture.base.questionData.endTime) await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		let forkQuestion = fixture.base.questionId
		if (!options.ownQuestion) {
			const question = options.scalar ? { ...makeQuestion('Shared portfolio scalar fork', fixture.base.questionData.endTime), numTicks: 100n, displayValueMax: 100n } : makeQuestion('Shared portfolio independent fork', fixture.base.questionData.endTime)
			const outcomes = options.scalar ? [] : fixture.base.outcomes
			forkQuestion = getQuestionId(question, outcomes)
			await createQuestion(fixture.owner(), question, outcomes)
		}
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, forkQuestion)
		if (options.activatePools !== false) {
			await initiateSecurityPoolFork(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)
			await initiateSecurityPoolFork(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool)
		}
		return await getUniverseData(fixture.owner(), fixture.base.genesisUniverse)
	}
	const prepareChild = async (parent: Address, outcome: bigint, questionId = fixture.base.questionId, universe = fixture.base.genesisUniverse) => {
		const client = fixture.other()
		for (const functionName of ['preparePortfolioChildPriceFeed', 'prepareChildPoolDependencies'] as const) await writeContractAndWait(client, () => client.writeContract({ address: getInfraContractAddresses().securityPoolFactory, abi: factoryArtifact.abi, functionName, args: [parent, outcome] }))
		await writeContractAndWait(client, () => client.writeContract({ address: getInfraContractAddresses().securityPoolForker, abi: forkerArtifact.abi, functionName: 'createChildUniverse', args: [parent, outcome] }))
		await finishChildInitialization(client, parent, outcome)
		return fixture.poolFor(questionId, getChildUniverseId(universe, outcome), parent).securityPool
	}
	return { ...aggregate, allocate, fork, prepareChild, third, controller, choose, process, childContext, branchWeight, forkPosition, revoke, window, collect }
}
