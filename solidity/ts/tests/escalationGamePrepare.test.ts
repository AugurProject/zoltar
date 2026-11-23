import { describe, expect, test } from 'bun:test'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_factories_EscalationGameFactory_EscalationGameFactory as gameFactoryArtifact } from '../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// #1453: the first report deployed its Escalation Game in the same transaction, close to the
// per-transaction gas cap at full depth. Anyone can now deploy the game first without starting it.
describe('escalation game preparation', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const YES = 1
	const pool = () => fixture.poolFor(fixture.base.questionId).questionLedger
	const factory = async () => ({ abi: gameFactoryArtifact.abi, address: await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGameFactory' }) })
	const code = async (address: Address) => (await fixture.base.mockWindow.request({ method: 'eth_getCode', params: [address, 'latest'] })) ?? '0x'
	const prepareGame = async () => {
		const outsider = fixture.other()
		const target = await factory()
		await writeContractAndWait(outsider, () => outsider.writeContract({ ...target, functionName: 'prepareEscalationGame', args: [pool()] }))
	}
	const report = async () => {
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), pool())
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [YES, 100n * unit] }))
	}

	test('anyone can deploy the game early; it stays unstarted until the first report, which reuses it', async () => {
		const target = await factory()
		const predicted = await fixture.owner().readContract({ ...target, functionName: 'escalationGameAddress', args: [pool()] })
		expect(await code(predicted)).toBe('0x')
		await prepareGame()
		expect(await code(predicted)).not.toBe('0x')
		// Preparation does not start the activation clock or attach the game to the pool.
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: predicted, functionName: 'activationTime' })).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGame' })).toBe(zeroAddress)
		// Only the factory can start a prepared game.
		const outsider = fixture.other()
		await expect(outsider.simulateContract({ abi: gameArtifact.abi, address: predicted, functionName: 'start', args: [1n, 2n] })).rejects.toThrow('Only owner')
		// Preparing again is a no-op.
		await prepareGame()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await report()
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGame' })).toBe(predicted)
		const activation = await fixture.owner().readContract({ abi: gameArtifact.abi, address: predicted, functionName: 'activationTime' })
		expect(activation).toBeGreaterThan(fixture.base.questionData.endTime)
		// The started game cannot be restarted through preparation either.
		await prepareGame()
		expect(await fixture.owner().readContract({ abi: gameArtifact.abi, address: predicted, functionName: 'activationTime' })).toBe(activation)
	})

	test('a reused game address can never be started twice, on either start path', async () => {
		const owner = fixture.owner()
		const target = await factory()
		// Exercise the real security-pool-bound pool caller, rather than an unbound standalone harness.
		await fixture.base.mockWindow.impersonateAccount(pool())
		await fixture.base.mockWindow.setBalance(pool(), unit)
		const poolClient = createWriteClient(fixture.base.mockWindow, BigInt(pool()))
		await writeContractAndWait(poolClient, () => poolClient.writeContract({ ...target, functionName: 'deployEscalationGameFromFork', args: [unit, 2n * unit, 0n, 3] }))
		const game = await owner.readContract({ ...target, functionName: 'escalationGameAddress', args: [pool()] })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'startBondAttoRep' })).toBe(unit)
		// The factory reuses the game at its CREATE2 address; the game itself refuses a second start.
		await expect(poolClient.simulateContract({ ...target, functionName: 'deployEscalationGameFromFork', args: [3n * unit, 4n * unit, 1n, 3] })).rejects.toThrow('Invalid game start')
		await expect(poolClient.simulateContract({ ...target, functionName: 'deployEscalationGame', args: [3n * unit, 4n * unit] })).rejects.toThrow('Invalid game start')
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'startBondAttoRep' })).toBe(unit)
	})

	test('a first report without preparation still deploys the game at the predicted address', async () => {
		const target = await factory()
		const predicted = await fixture.owner().readContract({ ...target, functionName: 'escalationGameAddress', args: [pool()] })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await report()
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'escalationGame' })).toBe(predicted)
	})
})
