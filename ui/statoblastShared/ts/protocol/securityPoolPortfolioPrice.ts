import { decodeEventLog, encodeFunctionData, getAddress, parseAbi, parseAbiItem, toEventSelector, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { loadPortfolioPriceSnapshot, type PortfolioPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { requireAddressValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getOpenOracleSettleGasLimit } from './openOracle.js'
import { loadOpenOracleStoredState } from './openOracleState.js'
import { portfolioReadClient, type PortfolioTransaction } from './securityPoolPortfolio.js'

const abi = parseAbi([
	'function reportCandidates(uint256 id) view returns (address escrow,address sponsor,address coordinator,uint256 maxSettlementBaseFee,uint256 requestedAt,uint256 requestGas)',
	'function reportOutcome(uint256 id) view returns (uint8)',
	'function feed() view returns (address)',
	'function reportId() view returns (uint256)',
	'function sponsor() view returns (address)',
	'function openOracle() view returns (address)',
	'function tokenHolder(address owner,address token) view returns (uint256)',
	'function recoverReport(uint256 id)',
	'function withdrawFunding()',
	'event PriceRequested(uint256 indexed reportId,uint256 maxSettlementBaseFeeAttoEthPerGas)',
])
export async function loadPortfolioBranchPrice(client: ReadClient, portfolio: Address, owner: Address, universeId: bigint) {
	const snapshot = await loadPortfolioPriceSnapshot({ client: { ...portfolioReadClient(client), getBalance: parameters => client.getBalance(parameters) }, portfolio, owner, universeId })
	const infrastructure = getInfraContractAddresses()
	if (getAddress(snapshot.factory) !== getAddress(infrastructure.securityPoolFactory) || getAddress(snapshot.zoltar) !== getAddress(infrastructure.zoltar)) throw new Error('Portfolio uses unrecognized price infrastructure.')
	return snapshot
}

/** Authenticate one explicitly selected candidate and its stored oracle preimage. */
export async function loadPortfolioPriceReport(client: ReadClient, snapshot: PortfolioPriceSnapshot, reportId: bigint) {
	const observation = snapshot.observation
	if (observation === undefined || reportId <= 0n || reportId >= 1n << 256n) throw new Error('Enter a valid report ID for this branch.')
	const blockNumber = snapshot.blockNumber
	const [candidate, outcome] = await Promise.all([client.readContract({ abi, address: snapshot.feed, functionName: 'reportCandidates', args: [reportId], blockNumber }), client.readContract({ abi, address: snapshot.feed, functionName: 'reportOutcome', args: [reportId], blockNumber })])
	const tuple = requireTupleValue(candidate, 6, 'report candidate')
	const escrow = requireAddressValue(tuple[0], 'report escrow')
	const sponsor = requireAddressValue(tuple[1], 'report sponsor')
	if (escrow === zeroAddress) throw new Error('This report does not belong to the selected branch.')
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
		requireAddressValue(escrowSponsor, 'escrow sponsor') !== getAddress(sponsor) ||
		requireAddressValue(escrowOracle, 'escrow oracle') !== observation.openOracle ||
		getAddress(game.callbackContract) !== getAddress(escrow) ||
		getAddress(game.token1) !== observation.weth ||
		getAddress(game.token2) !== snapshot.repToken ||
		!hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE)
	)
		throw new Error('Report escrow or oracle identities do not match this branch.')
	const [block, chain] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chain !== snapshot.chainId) throw new Error('Report state changed. Refresh and retry.')
	return { reportId, escrow, sponsor, outcome: BigInt(requireIntegerLikeValue(outcome, 'report outcome')), state, eligibleAt: game.reportTimestamp + game.settlementTime, wethCredit: releasedCredit(wethCredit), repCredit: releasedCredit(repCredit) }
}
function releasedCredit(value: unknown) {
	const amount = requireBigintValue(value, 'report token credit')
	return amount > 1n ? amount - 1n : 0n
}
export type PortfolioPriceReport = Awaited<ReturnType<typeof loadPortfolioPriceReport>>
export function buildPortfolioPriceSettlement(snapshot: PortfolioPriceSnapshot, report: PortfolioPriceReport): PortfolioTransaction {
	if (snapshot.observation === undefined) throw new Error('Branch price feed is unavailable.')
	return {
		account: snapshot.owner,
		to: snapshot.observation.openOracle,
		value: 0n,
		gas: getOpenOracleSettleGasLimit(report.state.latest.game),
		data: encodeFunctionData({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, functionName: 'settle', args: [report.reportId, getOpenOracleGameTuple(report.state.latest.game), getOpenOracleHelperTuple(report.state.latest.helper)] }),
	}
}
export function buildPortfolioPriceRecovery(snapshot: PortfolioPriceSnapshot, report: PortfolioPriceReport): PortfolioTransaction {
	return { account: snapshot.owner, to: snapshot.feed, value: 0n, data: encodeFunctionData({ abi, functionName: 'recoverReport', args: [report.reportId] }) }
}
export function buildPortfolioPriceFundingWithdrawal(snapshot: PortfolioPriceSnapshot, report: PortfolioPriceReport): PortfolioTransaction {
	return { account: snapshot.owner, to: report.escrow, value: 0n, data: encodeFunctionData({ abi, functionName: 'withdrawFunding' }) }
}
export function submittedPortfolioPriceReport(receipt: Pick<TransactionReceipt, 'logs'>, feed: Address) {
	for (const log of receipt.logs) {
		if (getAddress(log.address) !== getAddress(feed) || log.topics[0] !== toEventSelector(parseAbiItem('event PriceRequested(uint256 indexed reportId,uint256 maxSettlementBaseFeeAttoEthPerGas)'))) continue
		const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
		if (decoded.eventName === 'PriceRequested') return requireBigintValue(Array.isArray(decoded.args) ? decoded.args[0] : Reflect.get(requireObjectValue(decoded.args, 'price report event'), 'reportId'), 'created report ID')
	}
	return undefined
}
