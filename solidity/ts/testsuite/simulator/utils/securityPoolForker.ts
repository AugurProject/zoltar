import { peripherals_SecurityPoolForker_SecurityPoolForker } from '../../../types/contractArtifact.js'
import { QuestionOutcome } from '../types/types.js'
import { getInfraContractAddresses } from './deployPeripherals.js'
import { ReadClient, WriteClient } from './viem.js'

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

