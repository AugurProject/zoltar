import { peripherals_IsonzoFront_EscalationGame, peripherals_IsonzoFront_IsonzoFront } from "../../../types/contractArtifact.js"
import { QuestionOutcome } from "../types/types.js"
import { getInfraContractAddresses } from "./deployPeripherals.js"
import { ReadClient, WriteClient } from "./viem.js"

export const createNewGame = async (client: WriteClient, market: `0x${ string }`, designatedReporter: `0x${ string }`, outcome: QuestionOutcome, startingStake: bigint) => {
	return await client.writeContract({
		abi: peripherals_IsonzoFront_IsonzoFront.abi,
		functionName: 'createNewGame',
		address: getInfraContractAddresses().isonzoFront,
		args: [market, designatedReporter, outcome, startingStake]
	})
}

export const getEscalationGame = async (client: ReadClient, market: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_IsonzoFront_IsonzoFront.abi,
		functionName: 'escalationGames',
		address: getInfraContractAddresses().isonzoFront,
		args: [market]
	})
}

export const getStartingTime = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_IsonzoFront_EscalationGame.abi,
		functionName: 'startingTime',
		address: escalationGame,
		args: []
	})
}

export const getBalances = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	const [invalid, yes, no] = await client.readContract({
		abi: peripherals_IsonzoFront_EscalationGame.abi,
		functionName: 'getBalances',
		address: escalationGame,
		args: []
	})
	return { invalid, yes, no}
}

export const getDeposit = async (client: ReadClient, escalationGame: `0x${ string }`, winner: QuestionOutcome, depositIndex: bigint) => {
	const [depositor, amount, cumulativeAmount] = await client.readContract({
		abi: peripherals_IsonzoFront_EscalationGame.abi,
		functionName: 'deposits',
		address: escalationGame,
		args: [BigInt(winner), depositIndex]
	})
	return { depositor, amount, cumulativeAmount }
}

export const lastSyncedPauseDuration = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_IsonzoFront_EscalationGame.abi,
		functionName: 'lastSyncedPauseDuration',
		address: escalationGame,
		args: []
	})
}

export const depositToGame = async (client: WriteClient, market: `0x${ string }`, outcome: QuestionOutcome, amount: bigint) => {
	return await client.writeContract({
		abi: peripherals_IsonzoFront_IsonzoFront.abi,
		functionName: 'depositToGame',
		address: getInfraContractAddresses().isonzoFront,
		args: [market, outcome, amount]
	})
}
