import { OperationDefinition, OperationWalletAssetDebit } from '../types.ts'

import { inputInteger, inputMatches } from '../input-values.ts'

import { BINARY_OUTCOME_NONE, operationalPools, safeOraclePriceDeadline, shareTokenId, sharesToEth, walletShares } from './planning.ts'

import { canCreateCompleteSet } from '../pool-economics.ts'

import { ethSpend } from '../input-funding.ts'

import { amount, choose, eligible, encodeStep, erc1155WalletDebit, eventEvidence, mixSeed, planBase } from '../planning.ts'

import { securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'

export function completeSetDefinition(kind: 'create' | 'redeem' | 'winning'): OperationDefinition {
	let id = 'statoblast.complete-set.create'
	let method = 'createCompleteSet'
	let actionLabel = 'Create complete set'
	let signature = 'CompleteSetCreated(address,uint256,uint256,uint256,uint256)'
	if (kind === 'redeem') {
		id = 'statoblast.complete-set.redeem'
		method = 'redeemCompleteSet'
		actionLabel = 'Redeem complete set'
		signature = 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)'
	} else if (kind === 'winning') {
		id = 'statoblast.shares.redeem-winning'
		method = 'redeemShares'
		actionLabel = 'Redeem winning shares'
		signature = 'SharesRedeemed(address,uint256,uint256,uint256,uint256)'
	}
	return {
		buildPlan(snapshot, options) {
			const candidates = snapshot.pools.filter(pool => {
				if (!inputMatches(options, 'pool', pool.address)) return false
				if (kind === 'create') return operationalPools(snapshot).includes(pool) && safeOraclePriceDeadline(snapshot, pool, options) !== undefined && canCreateCompleteSet(pool, ethSpend(snapshot, options, id))
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return complete > 0n && sharesToEth(pool, complete) > 0n && pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0'
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			const pool = choose(candidates, mixSeed(options.seed, id))
			if (pool === undefined) return undefined
			let spend = 0n
			if (kind === 'create') spend = ethSpend(snapshot, options, id)
			else if (kind === 'redeem') {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return undefined
				spend = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
				spend = inputInteger(options, 'amount', spend, 1n, spend)
				if (sharesToEth(pool, spend) === 0n) return undefined
			}
			const args = kind === 'redeem' ? [spend] : undefined
			const shares = walletShares(snapshot, pool)
			if (kind !== 'create' && shares === undefined) return undefined
			const oracleDeadline = kind === 'create' ? safeOraclePriceDeadline(snapshot, pool, options) : undefined
			if (kind === 'create' && oracleDeadline === undefined) return undefined
			let walletAssetDebits: OperationWalletAssetDebit[] = []
			if (kind === 'redeem') walletAssetDebits = [0, 1, 2].map(outcome => erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, outcome), spend))
			if (kind === 'winning' && shares !== undefined) {
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				if (winningBalance === undefined || amount(winningBalance) === 0n) return undefined
				walletAssetDebits = [erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, pool.questionOutcome), amount(winningBalance))]
			}
			return planBase({
				...(oracleDeadline === undefined ? {} : { deadlineTimestamp: oracleDeadline.toString() }),
				definitionId: id,
				ecosystem: 'statoblast',
				label: actionLabel,
				metadata: { amount: spend.toString(), pool: pool.address },
				postconditions: [kind === 'create' ? 'All three outcome share balances increase equally' : 'Pool collateral and wallet share balances decrease consistently'],
				risk: kind === 'create' ? 'medium' : 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, args, evidence: [eventEvidence(pool.address, signature)], functionName: method, id: method, label: method, to: pool.address, value: kind === 'create' ? spend : undefined, walletAssetDebits })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Exercises the ${kind} complete-set/share workflow with wallet-owned inventory.`,
		discoveryInputs: ['share balances', 'pool lifecycle', 'wallet ETH'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			if (kind === 'create') {
				const spend = ethSpend(snapshot, options, id)
				return eligible(
					operationalPools(snapshot).some(pool => safeOraclePriceDeadline(snapshot, pool, options) !== undefined && canCreateCompleteSet(pool, spend)) ? undefined : 'No operational pool has a safely fresh price and minting capacity for the spend',
					spend === 0n ? 'No spendable ETH above reserve' : undefined,
				)
			}
			const possible = snapshot.pools.some(pool => {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			return eligible(possible ? undefined : 'No redeemable wallet shares')
		},
		id,
		label: kind,
		method,
		risk: kind === 'create' ? 'medium' : 'low',
	}
}
