import { parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { requireAddressValue, requireBigintValue, requireBooleanValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import type { PortfolioAccountSnapshot } from './securityPoolPortfolio.js'

const abi = parseAbi([
	'function getPool(uint256 questionId,uint248 universeId) view returns(address)',
	'function registeredPools(address pool) view returns(bool)',
	'function settlement() view returns(address)',
	'function services() view returns(address)',
	'function pullCreditsAttoEth(address owner) view returns(uint256)',
	'function securityPoolForker() view returns(address)',
	'function getQuestionOutcome(address pool) view returns(uint8)',
	'function ledger() view returns(address)',
	'function bookIds(uint248 universeId) view returns(uint64)',
	'function question(uint64 bookId,uint256 questionId) view returns((uint256 units,uint256 outcomeSupplyAttoShares,uint48 finalAfter,uint96 feeRateAttoEthPerSecond,uint48 feeStart,uint48 feeEnd,uint256 feePrincipalAttoEth,uint256 rewardShares) state,uint64 frozenBookId)',
	'function frozenBooks(uint64 id) view returns(uint256 cash,uint256 units,uint64 sourceBookId,uint256 recoveryRep)',
	'function quoteReportingReward(address pool) view returns(address recipient,uint256 cashAttoEth)',
	'function quoteQuestionRecoveryRep(address pool,uint256 shares) view returns(uint256)',
])

export async function loadPortfolioReportingReward(client: ReadClient, snapshot: Pick<PortfolioAccountSnapshot, 'portfolio' | 'universeId' | 'blockNumber' | 'blockHash' | 'chainId'>, questionId: bigint) {
	const { portfolio, universeId, blockNumber } = snapshot
	const pool = requireAddressValue(await client.readContract({ address: portfolio, abi, functionName: 'getPool', args: [questionId, universeId], blockNumber }), 'reward pool')
	if (pool === zeroAddress || !requireBooleanValue(await client.readContract({ address: portfolio, abi, functionName: 'registeredPools', args: [pool], blockNumber }), 'reward registration')) throw new Error('Register or prepare this question in the selected universe first.')
	const [settlementValue, servicesValue, forkerValue] = await Promise.all([
		client.readContract({ address: portfolio, abi, functionName: 'settlement', blockNumber }),
		client.readContract({ address: portfolio, abi, functionName: 'services', blockNumber }),
		client.readContract({ address: pool, abi, functionName: 'securityPoolForker', blockNumber }),
	])
	const settlement = requireAddressValue(settlementValue, 'reward settlement')
	const services = requireAddressValue(servicesValue, 'reward services')
	const forker = requireAddressValue(forkerValue, 'reward forker')
	const [ledgerValue, bookIdValue, outcomeValue] = await Promise.all([
		client.readContract({ address: settlement, abi, functionName: 'ledger', blockNumber }),
		client.readContract({ address: settlement, abi, functionName: 'bookIds', args: [universeId], blockNumber }),
		client.readContract({ address: forker, abi, functionName: 'getQuestionOutcome', args: [pool], blockNumber }),
	])
	const ledger = requireAddressValue(ledgerValue, 'reward book')
	const bookId = requireBigintValue(bookIdValue, 'reward book ID')
	const outcome = BigInt(requireIntegerLikeValue(outcomeValue, 'reward outcome'))
	const questionValue = requireTupleValue(await client.readContract({ address: ledger, abi, functionName: 'question', args: [bookId, questionId], blockNumber }), 2, 'reward question')
	const question = requireObjectValue(questionValue[0], 'reward question state')
	const rewardShares = requireBigintValue(Reflect.get(question, 'rewardShares'), 'reporting reward shares')
	const frozenBookId = requireBigintValue(questionValue[1], 'frozen reward book')
	const frozen = frozenBookId === 0n ? undefined : requireTupleValue(await client.readContract({ address: ledger, abi, functionName: 'frozenBooks', args: [frozenBookId], blockNumber }), 4, 'frozen reward state')
	const sourceOnly = frozen !== undefined && requireBigintValue(frozen[2], 'reward source book') !== bookId
	const [payoutValue, recoveryValue, block, chainId] = await Promise.all([
		outcome === 3n ? Promise.resolve([zeroAddress, 0n]) : client.readContract({ address: services, abi, functionName: 'quoteReportingReward', args: [pool], blockNumber }),
		client.readContract({ address: portfolio, abi, functionName: 'quoteQuestionRecoveryRep', args: [pool, rewardShares], blockNumber }),
		client.getBlock({ blockNumber }),
		client.getChainId(),
	])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the reward. Refresh and try again.')
	const payout = requireTupleValue(payoutValue, 2, 'reporting payout')
	const recipient = requireAddressValue(payout[0], 'reporting recipient')
	const beneficiary = recipient === zeroAddress ? undefined : recipient
	const maintenance = beneficiary === services
	return { pool, outcome, final: outcome !== 3n, beneficiary, maintenance, rewardShares, cashAttoEth: requireBigintValue(payout[1], 'reward ETH'), recoveryAttoRep: requireBigintValue(recoveryValue, 'recovered service REP'), sourceOnly }
}

export async function loadPortfolioServiceCredit(client: ReadClient, snapshot: Pick<PortfolioAccountSnapshot, 'portfolio' | 'blockNumber' | 'blockHash' | 'chainId'>, owner: Address) {
	const services = requireAddressValue(await client.readContract({ address: snapshot.portfolio, abi, functionName: 'services', blockNumber: snapshot.blockNumber }), 'portfolio services')
	const [credit, block, chainId] = await Promise.all([client.readContract({ address: services, abi, functionName: 'pullCreditsAttoEth', args: [owner], blockNumber: snapshot.blockNumber }), client.getBlock({ blockNumber: snapshot.blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading service credits. Refresh and try again.')
	return { services, amount: requireBigintValue(credit, 'service credit') }
}
