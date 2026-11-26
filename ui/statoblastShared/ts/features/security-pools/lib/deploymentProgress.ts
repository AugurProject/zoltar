import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { CollateralSymbol } from '../../../protocol/collateral.js'
import type { CuratedAdmissionMode, SecurityPoolCreationDraft } from './creation.js'

export type DeploymentDraft = {
	collateralSymbol: CollateralSymbol
	reportFloor: string
	originInput: string
	multiplierInput: string
	priorityFeeInput: string
	horizonDays: string
	admissionMode: CuratedAdmissionMode
	fixedQuestions: string
	economicsDraft: SecurityPoolCreationDraft
}

type PendingDeployment = { id: string; step: 'rules' | 'pool'; hash?: Hash | undefined; nonce?: string | undefined; restartAllowed?: boolean | undefined }
type DeploymentProgress = { rules?: Address | undefined; pool?: Address | undefined; activated?: boolean | undefined; pending?: PendingDeployment | undefined; draft: DeploymentDraft }

function isTransactionHash(value: string | undefined): value is Hash {
	return value !== undefined && /^0x[\da-fA-F]{64}$/.test(value)
}

function decodeProgress(raw: string) {
	return decodeStoredValue<DeploymentProgress>(JSON.parse(raw), read => {
		const draft = read.record('draft')
		const economics = draft.record('economicsDraft')
		const pending = read.optional('pending', read.record)
		const hash = pending?.optional('hash', pending.string)
		const nonce = pending?.optional('nonce', pending.string)
		return {
			rules: read.optional('rules', read.address),
			pool: read.optional('pool', read.address),
			activated: read.optional('activated', read.boolean),
			pending:
				pending === undefined
					? undefined
					: {
							id: pending.string('id'),
							step: pending.oneOf('step', ['rules', 'pool']),
							hash: isTransactionHash(hash) ? hash : undefined,
							nonce: nonce !== undefined && /^\d+$/.test(nonce) ? nonce : undefined,
							restartAllowed: pending.optional('restartAllowed', pending.boolean),
						},
			draft: {
				collateralSymbol: draft.oneOf('collateralSymbol', ['WETH', 'USDC']),
				reportFloor: draft.string('reportFloor'),
				originInput: draft.string('originInput'),
				multiplierInput: draft.string('multiplierInput'),
				priorityFeeInput: draft.string('priorityFeeInput'),
				horizonDays: draft.string('horizonDays'),
				admissionMode: draft.oneOf('admissionMode', ['open', 'fixed']),
				fixedQuestions: draft.string('fixedQuestions'),
				economicsDraft: {
					annualFeePercent: economics.string('annualFeePercent'),
					purchaseFeePercent: economics.string('purchaseFeePercent'),
					minimumPurchaseFee: economics.string('minimumPurchaseFee'),
					minimumCommitment: economics.string('minimumCommitment'),
					minimumOutcomeRate: economics.string('minimumOutcomeRate'),
					rewardVestingHours: economics.string('rewardVestingHours'),
				},
			},
		}
	})
}

export function deploymentProgressStore(profile: NetworkProfile, owner: Address | undefined) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'pool')
	const storage = owner === undefined ? undefined : getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:deployment:v1:${network}:${owner?.toLowerCase()}`
	const discardedKey = `${key}:discarded`
	const readRaw = () => {
		const raw = storage?.getItem(key)
		return raw === null || raw === storage?.getItem(discardedKey) ? undefined : raw
	}
	return {
		available: storage !== undefined,
		read: () => {
			try {
				const raw = readRaw()
				if (raw === undefined) return undefined
				return decodeProgress(raw)
			} catch (error) {
				if (!(error instanceof DOMException || error instanceof SyntaxError)) throw error
				return undefined
			}
		},
		discard: (expected: DeploymentProgress) => {
			if (storage === undefined) return 'unavailable'
			try {
				const raw = readRaw()
				if (raw === undefined) return 'changed'
				const current = decodeProgress(raw)
				if (current === undefined || current.rules !== expected.rules || current.pool !== expected.pool || current.activated !== expected.activated) return 'changed'
				if (current.pending?.id !== expected.pending?.id || (current.pending !== undefined && !current.pending.restartAllowed)) return 'changed'
				// Retire only this exact revision. A concurrent write can still save its newer progress.
				storage.setItem(discardedKey, raw)
				return readRaw() === undefined ? 'discarded' : 'changed'
			} catch (error) {
				if (error instanceof SyntaxError) return 'changed'
				if (!(error instanceof DOMException)) throw error
				return 'unavailable'
			}
		},
		write: (progress: DeploymentProgress | undefined) => {
			if (storage === undefined) return false
			try {
				if (progress === undefined) storage.removeItem(key)
				else storage.setItem(key, JSON.stringify(progress))
				return true
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
				return false
			}
		},
	}
}
