import { peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker } from '../../../../types/contractArtifact.js'
import { QuestionOutcome } from '../../types/types.js'
import { getInfraContractAddresses } from './deployPeripherals.js'
import { contractExists } from '../utilities.js'
import { ReadClient, WriteClient } from '../viem.js'

export const forkSecurityPool = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkSecurityPool',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const migrateVault = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: bigint | QuestionOutcome) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateVault',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress, Number(outcome)],
	})
}

export const startTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'startTruthAuction',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const finalizeTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'finalizeTruthAuction',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const claimAuctionProceeds = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'claimAuctionProceeds',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress, vault],
	})
}

export const forkZoltarWithOwnEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkZoltarWithOwnEscalationGame',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const getMigratedRep = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'getMigratedRep',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const getMarketOutcome = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	if(!(await contractExists(client, securityPoolAddress))) return QuestionOutcome.None
	return await client.readContract({
		abi: [{
			"inputs": [
				{
					"internalType": "contract ISecurityPool",
					"name": "securityPool",
					"type": "address"
				}
			],
			"stateMutability": "nonpayable",
			"type": "function",
			"name": "getMarketOutcome",
			"outputs": [
				{
					"internalType": "enum YesNoMarkets.Outcome",
					"name": "outcome",
					"type": "uint8"
				}
			]
		}] as const, // Typescript limitation on types...
		functionName: 'getMarketOutcome',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const createChildUniverse = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: QuestionOutcome) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'createChildUniverse',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress, Number(outcome)],
	})
}

export const getSecurityPoolForkerForkData = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	const data = await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkData',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
	const [ repAtFork, truthAuction, truthAuctionStarted, migratedRep, auctionedSecurityBondAllowance, ownFork, outcomeIndex] = data
	return { repAtFork, truthAuction, truthAuctionStarted, migratedRep, auctionedSecurityBondAllowance, ownFork, outcomeIndex }
}

export const migrateFromEscalationGame = async (client: WriteClient, parentSecurityPool: `0x${ string }`, vault: `0x${ string }`, outcomeIndex: QuestionOutcome, depositIndexes: bigint[]) => {
	return await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateFromEscalationGame',
		address: getInfraContractAddresses().securityPoolForker,
		args: [parentSecurityPool, vault, outcomeIndex, depositIndexes.map((x) => Number(x))],
	})
}

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'completeSetCollateralAmount',
		address: securityPoolAddress,
		args: [],
	})
}
