import { peripherals_SecurityPoolForker_SecurityPoolForker } from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployPeripherals'
import { contractExists } from '../utilities'
import { ReadClient, WriteClient } from '../viem'

export const initiateSecurityPoolFork = async (client: WriteClient, securityPoolAddress: `0x${ string }`) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'initiateSecurityPoolFork',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})

export const migrateRepToZoltar = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcomeIndices: (number | bigint)[]) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateRepToZoltar',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress, outcomeIndices.map(x => BigInt(x))],
	})

export const migrateVault = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: bigint | QuestionOutcome) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateVault',
		address: getInfraContractAddresses().securityPoolForker,
		// `outcome` is a small enum (0-3) or equivalent bigint; safe to convert to number
		// deno-lint-ignore no-explicit-any
		args: [securityPoolAddress, Number(outcome)],
	})

export const startTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'startTruthAuction',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})

export const finalizeTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'finalizeTruthAuction',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})

export const claimAuctionProceeds = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`, tickIndex: readonly { tick: bigint; bidIndex: bigint }[]) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'claimAuctionProceeds',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress, vault, tickIndex],
	})

export const forkZoltarWithOwnEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkZoltarWithOwnEscalationGame',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})

export const getMigratedRep = async (client: ReadClient, securityPoolAddress: `0x${ string }`) =>
	await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'getMigratedRep',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})

export const getMarketOutcome = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	if (!(await contractExists(client, securityPoolAddress))) return QuestionOutcome.None
	return await client.readContract({
		abi: [
			{
				inputs: [
					{
						internalType: 'contract ISecurityPool',
						name: 'securityPool',
						type: 'address',
					},
				],
				stateMutability: 'nonpayable',
				type: 'function',
				name: 'getMarketOutcome',
				outputs: [
					{
						internalType: 'enum BinaryOutcomes.BinaryOutcome',
						name: 'outcome',
						type: 'uint8',
					},
				],
			},
		] as const, // Typescript limitation on types...
		functionName: 'getMarketOutcome',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
}

export const createChildUniverse = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: QuestionOutcome) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'createChildUniverse',
		address: getInfraContractAddresses().securityPoolForker,
		// `outcome` is a small enum; safe to convert to number
		// deno-lint-ignore no-explicit-any
		args: [securityPoolAddress, Number(outcome)],
	})

export const getSecurityPoolForkerForkData = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	const data = await client.readContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkData',
		address: getInfraContractAddresses().securityPoolForker,
		args: [securityPoolAddress],
	})
	const [repAtFork, truthAuction, truthAuctionStarted, migratedRep, auctionedSecurityBondAllowance, ownFork, outcomeIndex] = data
	return { repAtFork, truthAuction, truthAuctionStarted, migratedRep, auctionedSecurityBondAllowance, ownFork, outcomeIndex }
}

export const migrateFromEscalationGame = async (client: WriteClient, parentSecurityPool: `0x${ string }`, vault: `0x${ string }`, outcomeIndex: QuestionOutcome, depositIndexes: bigint[]) =>
	await client.writeContract({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'migrateFromEscalationGame',
		address: getInfraContractAddresses().securityPoolForker,
		// `outcomeIndex` is a small enum; safe to convert to number.
		// `depositIndexes` are small indices; safe to convert to numbers.
		// deno-lint-ignore no-explicit-any
		args: [parentSecurityPool, vault, Number(outcomeIndex), depositIndexes.map(x => Number(x))],
	})
