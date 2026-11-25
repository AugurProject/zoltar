import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { statoblastDisplayCache } from './statoblastPageCache.js'
import type { loadSecurityPoolSourceRecovery } from './securityPoolSharedFork.js'

type BranchProgress = Pick<NonNullable<SecurityPoolForkSnapshot['branch']>, 'universeId' | 'outcomeIndex' | 'prepared' | 'started' | 'ready' | 'parentCash' | 'recoveryAttoRep'>
export type ForkPageDisplay = Pick<SecurityPoolForkSnapshot, 'chainId' | 'securityPool' | 'owner' | 'universeId' | 'timestamp' | 'forkTime' | 'choiceDeadline' | 'activationDeadline' | 'choice'> & { branch: BranchProgress | undefined }

export function forkDisplayCache(profile: NetworkProfile, securityPool: Address, owner: Address, universeId: bigint, outcomeIndex?: bigint) {
	return statoblastDisplayCache<ForkPageDisplay>(profile, { universeId, owner, page: `fork:${securityPool.toLowerCase()}:${outcomeIndex ?? 'chosen'}` }, value =>
		decodeStoredValue(value, read => {
			const choice = read.record('choice')
			return {
				chainId: profile.chain.id,
				securityPool,
				owner,
				universeId,
				timestamp: read.bigint('timestamp'),
				forkTime: read.bigint('forkTime'),
				choiceDeadline: read.bigint('choiceDeadline'),
				activationDeadline: read.bigint('activationDeadline'),
				choice: { recorded: choice.boolean('recorded'), outcomeIndex: choice.bigint('outcomeIndex') },
				branch: read.optional('branch', key => {
					const branch = read.record(key)
					return { universeId: branch.bigint('universeId'), outcomeIndex: branch.bigint('outcomeIndex'), prepared: branch.boolean('prepared'), started: branch.boolean('started'), ready: branch.boolean('ready'), parentCash: branch.bigint('parentCash'), recoveryAttoRep: branch.bigint('recoveryAttoRep') }
				}),
			}
		}),
	)
}

type RecoverySnapshot = Awaited<ReturnType<typeof loadSecurityPoolSourceRecovery>>

export function recoveryDisplayCache(profile: NetworkProfile, pool: Address, owner: Address, universeId: bigint, questionId: bigint) {
	return statoblastDisplayCache(profile, { universeId, owner, page: `recovery:${pool.toLowerCase()}:${questionId}` }, value =>
		decodeStoredValue(value, read => ({
			pool: read.address('pool'),
			source: read.address('source'),
			shareToken: read.address('shareToken'),
			eligible: read.boolean('eligible'),
			availableShares: read.bigint('availableShares'),
			rights: [read.bigint('invalid'), read.bigint('yes'), read.bigint('no')],
			invalid: read.bigint('invalid'),
			yes: read.bigint('yes'),
			no: read.bigint('no'),
		})),
	)
}

export function storedRecoverySnapshot(source: RecoverySnapshot) {
	const [invalid = 0n, yes = 0n, no = 0n] = source.rights
	return { ...source, invalid, yes, no }
}
