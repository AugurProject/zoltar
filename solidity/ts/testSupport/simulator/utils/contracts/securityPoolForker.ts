import { peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker } from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployPeripherals'
import { contractExists, requireAddress, requireArray, requireBigInt, requireBoolean } from '../utilities'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import type { Abi, Address } from '@zoltar/shared/ethereum'

const getQuestionOutcomeAbi = [
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
		name: 'getQuestionOutcome',
		outputs: [
			{
				internalType: 'enum BinaryOutcomes.BinaryOutcome',
				name: 'outcome',
				type: 'uint8',
			},
		],
	},
] satisfies Abi

type SecurityPoolForkerForkData = {
	auctionableRepAtFork: bigint
	truthAuction: Address
	truthAuctionStarted: bigint
	migratedRep: bigint
	auctionedSecurityBondAllowance: bigint
	escalationElapsedAtFork: bigint
	escalationStartBondAtFork: bigint
	escalationNonDecisionThresholdAtFork: bigint
	ownFork: boolean
	unresolvedEscalationAtFork: boolean
	outcomeIndex: bigint
}

type OwnForkRepBuckets = {
	vaultRepAtFork: bigint
	escalationChildRepPerSelectedOutcome: bigint
	escrowSourceRepAtFork: bigint
}

function requireQuestionOutcome(value: unknown, context: string): QuestionOutcome {
	const outcome = requireBigInt(value, context)
	switch (outcome) {
		case 0n:
			return QuestionOutcome.Invalid
		case 1n:
			return QuestionOutcome.Yes
		case 2n:
			return QuestionOutcome.No
		case 3n:
			return QuestionOutcome.None
		default:
			throw new Error(`Unexpected question outcome: ${outcome.toString()}`)
	}
}

export const initiateSecurityPoolFork = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'initiateSecurityPoolFork',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
	)

export const migrateRepToZoltar = async (client: WriteClient, securityPoolAddress: Address, outcomeIndices: (number | bigint)[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'migrateRepToZoltar',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, outcomeIndices.map(x => BigInt(x))],
		}),
	)

export const migrateVault = async (client: WriteClient, securityPoolAddress: Address, outcome: bigint | QuestionOutcome) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'migrateVault',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, BigInt(outcome)],
		}),
	)

export const migrateVaultWithUnresolvedEscalation = async (client: WriteClient, securityPoolAddress: Address, vault: Address, childOutcome: bigint | QuestionOutcome) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, vault, BigInt(childOutcome)],
		}),
	)

export const startTruthAuction = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'startTruthAuction',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
	)

export const finalizeTruthAuction = async (client: WriteClient, securityPoolAddress: Address, finalizationValue = 0n) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'finalizeTruthAuction',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
			value: finalizationValue,
		}),
	)

export const claimAuctionProceeds = async (client: WriteClient, securityPoolAddress: Address, vault: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'claimAuctionProceeds',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, vault, tickIndex],
		}),
	)

export const getMigrationProxyAddress = async (client: ReadClient, securityPoolAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getMigrationProxyAddress',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Migration proxy address',
	)

export const settleAuctionBids = async (client: WriteClient, securityPoolAddress: Address, vault: Address, claimTickIndices: readonly { tick: bigint; bidIndex: bigint }[], refundTickIndices: readonly { tick: bigint; bidIndex: bigint }[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'settleAuctionBids',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, vault, claimTickIndices, refundTickIndices],
		}),
	)

export const forkZoltarWithOwnEscalationGame = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkZoltarWithOwnEscalationGame',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
	)

export const getMigratedRep = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getMigratedRep',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Migrated REP',
	)

export const getForkActivationTime = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getForkActivationTime',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Fork activation time',
	)

export const getQuestionOutcome = async (client: ReadClient, securityPoolAddress: Address): Promise<QuestionOutcome> => {
	if (!(await contractExists(client, securityPoolAddress))) return QuestionOutcome.None
	return requireQuestionOutcome(
		await client.readContract({
			abi: getQuestionOutcomeAbi,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Question outcome',
	)
}

export const createChildUniverse = async (client: WriteClient, securityPoolAddress: Address, outcome: bigint | QuestionOutcome) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'createChildUniverse',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, BigInt(outcome)],
		}),
	)

export const getSecurityPoolForkerForkData = async (client: ReadClient, securityPoolAddress: Address): Promise<SecurityPoolForkerForkData> => {
	const data = requireArray(
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkData',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Security pool fork data',
	)
	return {
		auctionableRepAtFork: requireBigInt(data[0], 'Security pool fork data auctionable REP'),
		truthAuction: requireAddress(data[1], 'Security pool fork data truth auction'),
		truthAuctionStarted: requireBigInt(data[2], 'Security pool fork data truth auction started'),
		migratedRep: requireBigInt(data[3], 'Security pool fork data migrated REP'),
		auctionedSecurityBondAllowance: requireBigInt(data[4], 'Security pool fork data auctioned security bond allowance'),
		escalationElapsedAtFork: requireBigInt(data[5], 'Security pool fork data escalation elapsed'),
		escalationStartBondAtFork: requireBigInt(data[6], 'Security pool fork data escalation start bond'),
		escalationNonDecisionThresholdAtFork: requireBigInt(data[7], 'Security pool fork data non-decision threshold'),
		ownFork: requireBoolean(data[8], 'Security pool fork data own fork flag'),
		unresolvedEscalationAtFork: requireBoolean(data[9], 'Security pool fork data unresolved escalation flag'),
		outcomeIndex: requireBigInt(data[10], 'Security pool fork data outcome index'),
	}
}

export const getOwnForkRepBuckets = async (client: ReadClient, securityPoolAddress: Address): Promise<OwnForkRepBuckets> => {
	const repBuckets = requireArray(
		await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getOwnForkRepBuckets',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Own fork REP buckets',
	)
	return {
		vaultRepAtFork: requireBigInt(repBuckets[0], 'Own fork REP bucket vault REP'),
		escalationChildRepPerSelectedOutcome: requireBigInt(repBuckets[1], 'Own fork REP bucket per selected outcome'),
		escrowSourceRepAtFork: requireBigInt(repBuckets[2], 'Own fork REP bucket escrow source REP'),
	}
}

async function getEscalationGameForkedEscrowByVaultAndOutcome(client: ReadClient, securityPoolAddress: Address, outcome: QuestionOutcome, vault: Address): Promise<readonly [bigint, bigint, bigint, bigint]> {
	const escalationGame = requireAddress(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
		}),
		'Escalation game address',
	)
	const forkedEscrow = requireArray(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getForkedEscrowByVaultAndOutcome',
			address: escalationGame,
			args: [vault, Number(outcome)],
		}),
		'Forked escrow by vault and outcome',
	)
	return [requireBigInt(forkedEscrow[0], 'Forked escrow source principal'), requireBigInt(forkedEscrow[1], 'Forked escrow transferred principal'), requireBigInt(forkedEscrow[2], 'Forked escrow child REP'), requireBigInt(forkedEscrow[3], 'Forked escrow transferred child REP')]
}

export const getForkedEscrowPrincipalByOutcomeAndVault = async (client: ReadClient, securityPoolAddress: Address, outcome: QuestionOutcome, vault: Address): Promise<bigint> => {
	const [sourcePrincipal] = await getEscalationGameForkedEscrowByVaultAndOutcome(client, securityPoolAddress, outcome, vault)
	return sourcePrincipal
}

export const getForkedEscrowChildRepByOutcomeAndVault = async (client: ReadClient, securityPoolAddress: Address, outcome: QuestionOutcome, vault: Address): Promise<bigint> => {
	const [, , childRep] = await getEscalationGameForkedEscrowByVaultAndOutcome(client, securityPoolAddress, outcome, vault)
	return childRep
}

export const claimForkedEscalationDeposits = async (client: WriteClient, parentSecurityPool: Address, vault: Address, outcomeIndex: QuestionOutcome, depositIndexes: bigint[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'claimForkedEscalationDeposits',
			address: getInfraContractAddresses().securityPoolForker,
			args: [parentSecurityPool, vault, Number(outcomeIndex), depositIndexes],
		}),
	)
