import { encodeDeployData, getCreate2Address, numberToBytes } from 'viem'
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_EscalationGameFactory_EscalationGameFactory } from '../../../../types/contractArtifact.js'
import { AccountAddress, QuestionOutcome } from '../../types/types.js'
import { ReadClient, WriteClient } from '../viem.js'
import { getInfraContractAddresses } from './deployPeripherals.js'
import { mainnet } from 'viem/chains'

export const getNonDecisionThreshold = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'nonDecisionThreshold',
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

export const deployEscalationGame = async (writeClient: WriteClient, startBond: bigint, nonDecisionThreshold: bigint) => {
	await writeClient.writeContract({
		chain: mainnet,
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		functionName: 'deployEscalationGame',
		address: getInfraContractAddresses().escalationGameFactory,
		args: [startBond, nonDecisionThreshold],
	})
	return getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${ peripherals_EscalationGame_EscalationGame.evm.bytecode.object }`,
			args: [ writeClient.account.address ]
		}),
		from: getInfraContractAddresses().escalationGameFactory,
		salt: numberToBytes(0)
	})
}

export const getBalances = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	const [invalid, yes, no] = await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'getBalances',
		address: escalationGame,
		args: [],
	})
	return { invalid, yes, no }
}

export const getStartingTime = async (client: ReadClient, escalationGame: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'startingTime',
		address: escalationGame,
		args: [],
	})
}

export const depositOnOutcome = async (writeClient: WriteClient, escalationGame: `0x${ string }`, depositor: `0x${ string }`, outcome: QuestionOutcome, amount: bigint) => {
	await writeClient.writeContract({
		chain: mainnet,
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'depositOnOutcome',
		address: escalationGame,
		args: [depositor, outcome, amount],
	})
}
