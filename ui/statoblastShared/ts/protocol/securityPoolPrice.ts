import { decodeEventLog, encodeFunctionData, getAddress, parseAbi, parseAbiItem, toEventSelector, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { loadSecurityPoolPriceSnapshot, type SecurityPoolPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { requireAddressValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getOpenOracleSettleGasLimit } from './openOracle.js'
import { loadOpenOracleStoredState } from './openOracleState.js'
import { securityPoolReadClient, type SecurityPoolAccountSnapshot, type SecurityPoolTransaction } from './securityPool.js'
import { statoblastDisplayCache } from './statoblastPageCache.js'
import * as priceCopy from '../copy/securityPoolPrice.js'

const abi = parseAbi([
	'function reportCandidates(uint256 id) view returns (address escrow,address sponsor,uint256 maxSettlementBaseFee)',
	'function reportOutcome(uint256 id) view returns (uint8)',
	'function pendingReportId() view returns (uint256)',
	'function feed() view returns (address)',
	'function reportId() view returns (uint256)',
	'function sponsor() view returns (address)',
	'function openOracle() view returns (address)',
	'function tokenHolder(address owner,address token) view returns (uint256)',
	'function recoverReport(uint256 id)',
	'function withdrawFunding()',
	'function withdrawTokenFunding(address token,address recipient)',
	'event PriceRequested(uint256 indexed reportId,uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas)',
])
const priceReportedEvent = {
	type: 'event',
	name: 'PriceReported',
	inputs: [
		{ type: 'uint256', name: 'reportId', indexed: true },
		{ type: 'uint256', name: 'price' },
		{ type: 'uint256', name: 'lastSettlementTimestamp' },
	],
} as const
const capitalPriceAcceptedEvent = {
	type: 'event',
	name: 'CapitalPriceAccepted',
	inputs: [
		{ type: 'uint256', name: 'price' },
		{ type: 'uint48', name: 'validUntil' },
	],
} as const
const priceReportedTopic = toEventSelector(priceReportedEvent)
const capitalPriceAcceptedTopic = toEventSelector(capitalPriceAcceptedEvent)
export async function loadSecurityPoolBranchPrice(client: ReadClient, securityPool: Address, owner: Address, universeId: bigint) {
	const snapshot = await loadSecurityPoolPriceSnapshot({ client: { ...securityPoolReadClient(client), getBalance: parameters => client.getBalance(parameters) }, securityPool, owner, universeId })
	const infrastructure = getInfraContractAddresses()
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Security pool uses unrecognized price infrastructure.')
	return snapshot
}

/** Authenticate one explicitly selected candidate and its stored oracle preimage. */
export async function loadSecurityPoolPriceReport(client: ReadClient, snapshot: SecurityPoolPriceSnapshot, reportId: bigint) {
	const observation = snapshot.observation
	if (observation === undefined || reportId <= 0n || reportId >= 1n << 256n) throw new Error('Enter a valid report ID for this price feed.')
	const blockNumber = snapshot.blockNumber
	const [candidate, outcome] = await Promise.all([client.readContract({ abi, address: snapshot.feed, functionName: 'reportCandidates', args: [reportId], blockNumber }), client.readContract({ abi, address: snapshot.feed, functionName: 'reportOutcome', args: [reportId], blockNumber })])
	const tuple = requireTupleValue(candidate, 3, 'report candidate')
	const escrow = requireAddressValue(tuple[0], 'report escrow')
	const sponsor = requireAddressValue(tuple[1], 'report funder')
	const maxSettlementBaseFee = requireBigintValue(tuple[2], 'report settlement base-fee ceiling')
	if (escrow === zeroAddress) throw new Error('This report does not belong to this price feed.')
	const pinned: Pick<ReadClient, 'readContract'> = { readContract: parameters => client.readContract({ ...parameters, blockNumber }) }
	const [escrowFeed, escrowId, escrowSponsor, escrowOracle, state, wethCredit, repCredit] = await Promise.all([
		client.readContract({ abi, address: escrow, functionName: 'feed', blockNumber }),
		client.readContract({ abi, address: escrow, functionName: 'reportId', blockNumber }),
		client.readContract({ abi, address: escrow, functionName: 'sponsor', blockNumber }),
		client.readContract({ abi, address: escrow, functionName: 'openOracle', blockNumber }),
		loadOpenOracleStoredState(pinned, observation.openOracle, reportId),
		client.readContract({ abi, address: observation.openOracle, functionName: 'tokenHolder', args: [escrow, observation.weth], blockNumber }),
		client.readContract({ abi, address: observation.openOracle, functionName: 'tokenHolder', args: [escrow, snapshot.repToken], blockNumber }),
	])
	const game = state.latest.game
	if (
		requireAddressValue(escrowFeed, 'escrow feed') !== snapshot.feed ||
		requireBigintValue(escrowId, 'escrow report ID') !== reportId ||
		requireAddressValue(escrowSponsor, 'escrow funder') !== getAddress(sponsor) ||
		requireAddressValue(escrowOracle, 'escrow oracle') !== observation.openOracle ||
		getAddress(game.callbackContract) !== getAddress(escrow) ||
		getAddress(game.token1) !== observation.weth ||
		getAddress(game.token2) !== snapshot.repToken ||
		!hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE)
	)
		throw new Error('Report escrow or oracle identities do not match this price feed.')
	const [block, chain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chain !== snapshot.chainId) throw new Error('Report state changed. Refresh and retry.')
	const reportOutcome = BigInt(requireIntegerLikeValue(outcome, 'report outcome'))
	let recoveryBaseFeeBlocked = false
	if (state.settled && reportOutcome === 0n && block.baseFeePerGas !== undefined && block.baseFeePerGas > maxSettlementBaseFee) {
		// Only the feed can determine whether rejection retires this candidate or
		// executes canonical-price operations, which still enforce its fee ceiling.
		try {
			await client.simulateContract({ account: snapshot.owner, address: snapshot.feed, abi, functionName: 'recoverReport', args: [reportId], blockNumber })
		} catch (error) {
			if (getErrorDetail(error)?.includes('Base fee too high')) recoveryBaseFeeBlocked = true
			else throw error
		}
		const [finalBlock, finalChain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
		if (finalBlock.hash !== snapshot.blockHash || finalChain !== snapshot.chainId) throw new Error('Report state changed. Refresh and retry.')
	}
	return {
		reportId,
		escrow,
		sponsor,
		outcome: reportOutcome,
		state,
		reportedAt: state.latest.helper.blockTimestamp,
		eligibleAt: game.reportTimestamp + game.settlementTime,
		bounty: game.settlerRewardAttoEth,
		baseFeePerGas: block.baseFeePerGas,
		maxSettlementBaseFee,
		recoveryBaseFeeBlocked,
		wethCredit: releasedCredit(wethCredit),
		repCredit: releasedCredit(repCredit),
	}
}
function releasedCredit(value: unknown) {
	const amount = requireBigintValue(value, 'report token credit')
	return amount > 1n ? amount - 1n : 0n
}
export type SecurityPoolPriceReport = Awaited<ReturnType<typeof loadSecurityPoolPriceReport>>

const reportPagePrefix = (pool: Address) => `price-report:${pool.toLowerCase()}:`

function knownReportId(value: string) {
	const decimal = value.replace(/:receipt$/u, '')
	if (!/^[1-9][0-9]{0,77}$/u.test(decimal)) return undefined
	const id = BigInt(decimal)
	return id < 1n << 256n ? id : undefined
}

export function rememberSecurityPoolPriceReport(profile: NetworkProfile, pool: Address, universeId: bigint, owner: Address, reportId: bigint, block: { number: bigint; timestamp: bigint }) {
	const page = `${reportPagePrefix(pool)}${reportId}:receipt`
	statoblastDisplayCache(profile, { universeId, owner, page }, value => (value === true ? value : undefined)).write(true, block)
}

function knownFundedReport(value: unknown) {
	return decodeStoredValue(value, read => {
		const reportId = read.bigint('reportId')
		const funder = read.address('funder')
		return reportId > 0n && reportId < 1n << 256n ? { reportId, funder } : undefined
	})
}

export function securityPoolPriceFundsCache(profile: NetworkProfile, pool: Address, universeId: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner: undefined, page: `price-funds:${pool.toLowerCase()}` }, value => (Array.isArray(value) ? value.flatMap(item => knownFundedReport(item) ?? []) : undefined))
}

/** The verified pool snapshot names its factory-registered feed at this block. Only report identities come from disk. */
export async function loadSecurityPoolPriceFunds(client: Pick<ReadClient, 'multicall' | 'getBlock'>, profile: NetworkProfile, snapshot: Pick<SecurityPoolAccountSnapshot, 'securityPool' | 'universeId' | 'priceFeed' | 'repToken' | 'collateralToken' | 'blockNumber' | 'blockHash'>) {
	const { securityPool, universeId, priceFeed, repToken, collateralToken, blockNumber, blockHash } = snapshot
	if (priceFeed === zeroAddress) return []
	const calls = [
		{ abi, address: priceFeed, functionName: 'pendingReportId' },
		{ abi, address: priceFeed, functionName: 'openOracle' },
	] as const
	const [pending, oracleValue] = await readRequiredMulticall(client, calls, blockNumber)
	const pendingId = requireBigintValue(pending, 'pending price report ID')
	const oracle = requireAddressValue(oracleValue, 'price feed oracle')
	const requirePinnedBlock = async () => {
		const block = await client.getBlock({ blockNumber })
		if (block.hash !== blockHash) throw new Error('Report state changed. Refresh and retry.')
	}
	const ids = new Set<bigint>()
	if (pendingId > 0n) ids.add(pendingId)
	const cache = securityPoolPriceFundsCache(profile, securityPool, universeId)
	for (const funded of cache.read()?.value ?? []) ids.add(funded.reportId)
	for (const suffix of cache.universePageSuffixes(reportPagePrefix(securityPool))) {
		const id = knownReportId(suffix)
		if (id !== undefined) ids.add(id)
	}
	if (ids.size === 0) {
		await requirePinnedBlock()
		return []
	}
	const reports = [...ids]
	const candidates = await readRequiredMulticall(
		client,
		reports.map(id => ({ abi, address: priceFeed, functionName: 'reportCandidates', args: [id] }) as const),
		blockNumber,
	)
	const registered = candidates.flatMap((value, index) => {
		const [escrowValue, sponsorValue] = requireTupleValue(value, 3, 'report candidate')
		const escrow = requireAddressValue(escrowValue, 'report escrow')
		const funder = requireAddressValue(sponsorValue, 'report funder')
		const id = reports[index]
		return id !== undefined && escrow !== zeroAddress && funder !== zeroAddress ? [{ id, escrow, funder }] : []
	})
	if (registered.length === 0) {
		await requirePinnedBlock()
		return []
	}
	const funding = await readRequiredMulticall(
		client,
		registered.flatMap(
			({ id, escrow }) =>
				[
					{ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, address: oracle, functionName: 'storedGame', args: [id] },
					{ abi, address: oracle, functionName: 'tokenHolder', args: [escrow, collateralToken] },
					{ abi, address: oracle, functionName: 'tokenHolder', args: [escrow, repToken] },
				] as const,
		),
		blockNumber,
	)
	await requirePinnedBlock()
	return registered.flatMap(({ id, escrow, funder }, index) => {
		const game = requireTupleValue(funding[index * 3], 20, 'stored report')
		const collateral = releasedCredit(funding[index * 3 + 1])
		const rep = releasedCredit(funding[index * 3 + 2])
		const [amount1, amount2, reporter, , settled, token1, , , , , , token2, , , , , callback] = game
		if (requireAddressValue(callback, 'report receiver') !== escrow || requireAddressValue(token1, 'report collateral') !== collateralToken || requireAddressValue(token2, 'report REP') !== repToken) throw new Error('Report escrow identities do not match this price feed.')
		const locked = BigInt(requireIntegerLikeValue(settled, 'report settlement time')) === 0n && requireAddressValue(reporter, 'current reporter') === escrow && (requireBigintValue(amount1, 'locked collateral') > 0n || requireBigintValue(amount2, 'locked REP') > 0n)
		return locked || collateral > 0n || rep > 0n ? [{ reportId: id, funder }] : []
	})
}

export function securityPoolPriceReportCache(profile: NetworkProfile, pool: Address, universeId: bigint, owner: Address, reportId: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner, page: `${reportPagePrefix(pool)}${reportId}` }, value =>
		decodeStoredValue(value, read => ({
			reportId,
			sponsor: read.address('sponsor'),
			outcome: read.bigint('outcome'),
			state: { settled: read.record('state').boolean('settled') },
			reportedAt: read.optional('reportedAt', read.bigint),
			eligibleAt: read.bigint('eligibleAt'),
			bounty: read.optional('bounty', read.bigint),
			baseFeePerGas: read.optional('baseFeePerGas', read.bigint),
			maxSettlementBaseFee: read.bigint('maxSettlementBaseFee'),
			wethCredit: read.bigint('wethCredit'),
			repCredit: read.bigint('repCredit'),
			collateralToken: read.address('collateralToken'),
		})),
	)
}
export function buildSecurityPoolPriceSettlement(snapshot: SecurityPoolPriceSnapshot, report: SecurityPoolPriceReport): SecurityPoolTransaction {
	if (snapshot.observation === undefined) throw new Error('Branch price feed is unavailable.')
	return {
		account: snapshot.owner,
		to: snapshot.observation.openOracle,
		value: 0n,
		// loadSecurityPoolPriceReport proved the callback is this registered feed's escrow for the report.
		gas: getOpenOracleSettleGasLimit(report.state.latest.game, true),
		data: encodeFunctionData({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, functionName: 'settle', args: [report.reportId, getOpenOracleGameTuple(report.state.latest.game), getOpenOracleHelperTuple(report.state.latest.helper)] }),
	}
}
export function buildSecurityPoolPriceRecovery(snapshot: SecurityPoolPriceSnapshot, report: SecurityPoolPriceReport): SecurityPoolTransaction {
	return { account: snapshot.owner, to: snapshot.feed, value: 0n, data: encodeFunctionData({ abi, functionName: 'recoverReport', args: [report.reportId] }) }
}
export function buildSecurityPoolPriceFundingWithdrawal(snapshot: SecurityPoolPriceSnapshot, report: SecurityPoolPriceReport): SecurityPoolTransaction {
	return { account: snapshot.owner, to: report.escrow, value: 0n, data: encodeFunctionData({ abi, functionName: 'withdrawFunding' }) }
}
export function buildSecurityPoolPriceTokenWithdrawal(snapshot: SecurityPoolPriceSnapshot, report: SecurityPoolPriceReport, token: 'collateral' | 'rep', recipient: Address): SecurityPoolTransaction {
	const tokenAddress = token === 'rep' ? snapshot.repToken : snapshot.observation?.weth
	if (tokenAddress === undefined) throw new Error('Branch price feed is unavailable.')
	if (recipient === zeroAddress || recipient === report.escrow) throw new Error(priceCopy.invalidWithdrawalRecipient)
	if (recipient !== getAddress(report.sponsor) && getAddress(snapshot.owner) !== getAddress(report.sponsor)) throw new Error(priceCopy.withdrawalRecipientRequiresFunder)
	return { account: snapshot.owner, to: report.escrow, value: 0n, data: encodeFunctionData({ abi, functionName: 'withdrawTokenFunding', args: [tokenAddress, recipient] }) }
}
export function submittedSecurityPoolPriceReport(receipt: Pick<TransactionReceipt, 'logs'>, feed: Address) {
	for (const log of receipt.logs) {
		if (getAddress(log.address) !== getAddress(feed) || log.topics[0] !== toEventSelector(parseAbiItem('event PriceRequested(uint256 indexed reportId,uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas)'))) continue
		const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
		if (decoded.eventName === 'PriceRequested') return requireBigintValue(Array.isArray(decoded.args) ? decoded.args[0] : Reflect.get(requireObjectValue(decoded.args, 'price report event'), 'reportId'), 'created report ID')
	}
	return undefined
}

/** Equal-time accepted candidates also emit PriceReported. Only a matching preceding ledger checkpoint proves canonical acceptance. */
export function acceptedSecurityPoolPriceReport(receipt: Pick<TransactionReceipt, 'logs'>, feed: Address, capitalLedger: Address, validitySeconds: bigint) {
	let checkpoint: { price: bigint; validUntil: bigint } | undefined
	let accepted: { reportId: bigint; price: bigint; observedAt: bigint } | undefined
	for (const log of receipt.logs) {
		if (log.removed) continue
		const address = getAddress(log.address)
		if (address === getAddress(capitalLedger) && log.topics[0] === capitalPriceAcceptedTopic) {
			const decoded = decodeEventLog({ abi: [capitalPriceAcceptedEvent] as const, data: log.data, topics: log.topics })
			checkpoint = { price: decoded.args.price, validUntil: BigInt(decoded.args.validUntil) }
		}
		if (address === getAddress(feed) && log.topics[0] === priceReportedTopic) {
			const decoded = decodeEventLog({ abi: [priceReportedEvent] as const, data: log.data, topics: log.topics })
			const { reportId, price, lastSettlementTimestamp: observedAt } = decoded.args
			if (checkpoint !== undefined && checkpoint.price === price && checkpoint.validUntil === observedAt + validitySeconds) accepted = { reportId, price, observedAt }
			checkpoint = undefined
		}
	}
	return accepted
}

export function acceptedSecurityPoolPriceCache(profile: NetworkProfile, pool: Address, universeId: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner: undefined, page: `accepted-price-report:${pool.toLowerCase()}` }, value =>
		decodeStoredValue(value, read => ({
			feed: read.address('feed'),
			reportId: read.bigint('reportId'),
			price: read.bigint('price'),
			observedAt: read.bigint('observedAt'),
		})),
	)
}
