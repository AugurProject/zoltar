import { peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool } from '../../../types/contractArtifact.js'
import { AccountAddress, QuestionOutcome } from '../types/types.js'
import { ReadClient, WriteClient } from './viem.js'

export const depositToEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: QuestionOutcome, amount: bigint) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		address: securityPoolAddress,
		args: [outcome, amount],
	})
}

export const withdrawFromEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`, depositIndexes: bigint[]) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		address: securityPoolAddress,
		args: [depositIndexes],
	})
}

export const getNonDecisionTreshold = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'nonDecisionTreshold',
		address: escalationGame,
		args: [],
	})
}

export const getMarketResolution = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return (await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'getMarketResolution',
		address: escalationGame,
		args: [],
	})) as QuestionOutcome
}

export const getStartBond = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'startBond',
		address: escalationGame,
		args: [],
	})
}

export const getEscalationGameDeposits = async (readClient: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => {
	let currentIndex = 0n
	const numberOfEntries = 30n
	let pages: { depositIndex: bigint, depositor: `0x${ string }`, amount: bigint, cumulativeAmount: bigint}[] = []
	do {
		const newDeposits = (await readClient.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getDepositsByOutcome',
			address: escalationGame,
			args: [outcome, currentIndex, numberOfEntries]
		})).map((deposit, index) => ({ ...deposit, depositIndex: currentIndex + BigInt(index) })).filter((deposit) => BigInt(deposit.depositor) !== 0x0n)
		pages.push(...newDeposits)
		if (BigInt(newDeposits.length) !== numberOfEntries) break
		currentIndex += numberOfEntries
	} while(true)
	return pages
}
