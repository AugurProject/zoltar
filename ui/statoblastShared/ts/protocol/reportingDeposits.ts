import { decodeEventLog, getAddress, parseAbiItem, toEventSelector, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { localEntityScopeForNetwork, parseStoredValue, serializeStoredValue } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { statoblast_QuestionLedger_QuestionLedger as ledgerArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '../contractArtifact.js'

const depositEvent = parseAbiItem('event DepositOnOutcome(address indexed depositor, uint8 indexed outcome, uint256 amountAttoRep, uint256 depositIndex, uint256 cumulativeRepAmountAttoRep, uint256 resultingVaultDisputeStakedAttoRep, uint256 resultingTotalDisputeStakedAttoRep)')
const depositEventSelector = toEventSelector(depositEvent)
const reportingOutcomes = ['invalid', 'yes', 'no'] as const

export type LocatedDeposit = {
	pool: Address
	questionId: bigint
	universeId: bigint
	outcome: ReportingOutcomeKey
	depositor: Address
	index: bigint
	originalAttoRep?: bigint | undefined
}

export function readLocatedDeposit(value: unknown): LocatedDeposit | undefined {
	const deposit = decodeStoredValue(value, read => ({
		pool: read.address('pool'),
		questionId: read.bigint('questionId'),
		universeId: read.bigint('universeId'),
		outcome: read.oneOf('outcome', reportingOutcomes),
		depositor: read.address('depositor'),
		index: read.bigint('index'),
		originalAttoRep: read.optional('originalAttoRep', read.bigint),
	}))
	if (deposit === undefined || sameAddress(deposit.pool, zeroAddress) || sameAddress(deposit.depositor, zeroAddress)) return undefined
	if (deposit.questionId < 0n || deposit.questionId >= 1n << 256n || deposit.universeId < 0n || deposit.universeId >= 1n << 248n || deposit.index < 0n || deposit.index >= 1n << 256n) return undefined
	if (deposit.originalAttoRep !== undefined && (deposit.originalAttoRep <= 0n || deposit.originalAttoRep >= 1n << 256n)) return undefined
	return deposit
}

export function locatedDepositKey({ pool, questionId, universeId, outcome, depositor, index }: LocatedDeposit) {
	return `${pool.toLowerCase()}:${questionId}:${universeId}:${outcome}:${depositor.toLowerCase()}:${index}`
}

export function reportingDepositStore(profile: NetworkProfile) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'question')
	const storage = getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:located-deposits:v1:${network}`
	const read = () => {
		try {
			const text = storage?.getItem(key)
			if (text === undefined || text === null) return []
			const values = parseStoredValue(text)
			if (!Array.isArray(values)) return []
			return values.flatMap(value => {
				const deposit = readLocatedDeposit(value)
				return deposit === undefined ? [] : [deposit]
			})
		} catch (error) {
			if (error instanceof SyntaxError || error instanceof DOMException) return []
			throw error
		}
	}
	return {
		read,
		add: (deposits: readonly LocatedDeposit[]) => {
			if (deposits.length === 0) return
			const merged = new Map(read().map(deposit => [locatedDepositKey(deposit), deposit]))
			for (const deposit of deposits) {
				const depositKey = locatedDepositKey(deposit)
				if (!merged.has(depositKey) || (merged.get(depositKey)?.originalAttoRep === undefined && deposit.originalAttoRep !== undefined)) merged.set(depositKey, deposit)
			}
			storage?.setItem(key, serializeStoredValue([...merged.values()]))
		},
	}
}

function decodeReportingDepositReceipt(receipt: Pick<TransactionReceipt, 'logs'>, game: Address, wallet: Address) {
	return receipt.logs.flatMap(log => {
		if (!sameAddress(log.address, game) || log.topics[0] !== depositEventSelector) return []
		try {
			const { args } = decodeEventLog({ abi: [depositEvent], data: log.data, topics: log.topics })
			if (Array.isArray(args) || !('outcome' in args) || (typeof args['outcome'] !== 'number' && typeof args['outcome'] !== 'bigint')) return []
			const outcome = getReportingOutcomeKey(args['outcome'])
			if (outcome === 'none' || !('depositor' in args) || typeof args['depositor'] !== 'string' || !sameAddress(args['depositor'], wallet)) return []
			if (!('amountAttoRep' in args) || typeof args['amountAttoRep'] !== 'bigint' || args['amountAttoRep'] <= 0n || !('depositIndex' in args) || typeof args['depositIndex'] !== 'bigint') return []
			return [{ outcome, index: args['depositIndex'], originalAttoRep: args['amountAttoRep'] }]
		} catch (error) {
			if (error instanceof Error && (error.name === 'DecodeLogDataMismatch' || error.name === 'DecodeLogTopicsMismatch')) return []
			throw error
		}
	})
}

/** Derive the trusted game and deposit identity from chain state at the user's confirmed report. */
export async function captureReportingDeposits(client: Pick<WriteClient, 'account' | 'readContract'>, profile: NetworkProfile, ledger: Address, universeId: bigint, receipt: Pick<TransactionReceipt, 'blockNumber' | 'logs'>) {
	if (typeof window === 'undefined' || !receipt.logs?.some(log => log.topics[0] === depositEventSelector)) return
	const blockNumber = receipt.blockNumber
	const ledgerRead = { abi: ledgerArtifact.abi, address: ledger, blockNumber }
	const [game, questionId, pool] = await Promise.all([
		client.readContract({ ...ledgerRead, functionName: 'escalationGame' }),
		client.readContract({ ...ledgerRead, functionName: 'questionId' }),
		client.readContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses(profile).securityPoolFactory, functionName: 'securityPoolOf', args: [ledger], blockNumber }),
	])
	if (sameAddress(game, zeroAddress) || sameAddress(pool, zeroAddress)) return
	const depositor = getAddress(client.account.address)
	const deposits = decodeReportingDepositReceipt(receipt, game, depositor)
	reportingDepositStore(profile).add(deposits.map(deposit => ({ ...deposit, pool, questionId, universeId, depositor })))
}
