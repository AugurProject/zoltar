import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { signal, type Signal } from '@preact/signals'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { DeploymentDraft } from './creation.js'

type PendingDeployment = { id: string; step: 'rules' | 'pool'; hash?: Hash | undefined; nonce?: string | undefined; initialFactoryCount?: string | undefined; restartAllowed?: boolean | undefined }
type DeploymentProgress = { rules?: Address | undefined; pool?: Address | undefined; activated?: boolean | undefined; pending?: PendingDeployment | undefined; draft: DeploymentDraft }
type ProgressSignal = Signal<DeploymentProgress | undefined>
const memoryJournals = new Map<string, ProgressSignal>()

function isTransactionHash(value: string | undefined): value is Hash {
	return value !== undefined && /^0x[\da-fA-F]{64}$/.test(value)
}

function storedUnsignedInteger(value: string | undefined) {
	return value !== undefined && /^\d+$/.test(value) ? value : undefined
}

function decodeProgress(raw: string) {
	return decodeStoredValue<DeploymentProgress>(JSON.parse(raw), read => {
		const draft = read.record('draft')
		const economics = draft.record('economicsDraft')
		const pending = read.optional('pending', read.record)
		const hash = pending?.optional('hash', pending.string)
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
							nonce: storedUnsignedInteger(pending.optional('nonce', pending.string)),
							initialFactoryCount: storedUnsignedInteger(pending.optional('initialFactoryCount', pending.string)),
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

export function deploymentProgressJournal(profile: NetworkProfile, owner: Address | undefined) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'pool')
	const storage = owner === undefined ? undefined : getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:deployment:v1:${network}:${owner?.toLowerCase()}`
	const discardedKey = `${key}:discarded`
	const current = memoryJournals.get(key) ?? signal<DeploymentProgress | undefined>(undefined)
	const persistenceUnavailable = signal(storage === undefined || memoryJournals.has(key))
	const rememberInTab = () => {
		if (owner !== undefined && !memoryJournals.has(key)) memoryJournals.set(key, current)
		persistenceUnavailable.value = true
	}
	if (storage === undefined) rememberInTab()
	const readRaw = () => {
		const raw = storage?.getItem(key)
		return raw === null || raw === storage?.getItem(discardedKey) ? undefined : raw
	}
	const read = () => {
		if (memoryJournals.has(key)) return memoryJournals.get(key)?.value
		try {
			const raw = readRaw()
			return raw === undefined ? undefined : decodeProgress(raw)
		} catch (error) {
			if (error instanceof SyntaxError) return undefined
			if (!(error instanceof DOMException)) throw error
			rememberInTab()
			return current.value
		}
	}
	const restored = read()
	current.value = restored
	return {
		current,
		restored,
		persistenceUnavailable,
		read,
		discard: (expected: DeploymentProgress) => {
			if (memoryJournals.has(key) || storage === undefined) {
				const memory = memoryJournals.get(key) ?? current
				if (memory.value !== expected) return false
				memory.value = undefined
				return true
			}
			try {
				const raw = readRaw()
				if (raw === undefined) return false
				const saved = decodeProgress(raw)
				if (saved === undefined || saved.rules !== expected.rules || saved.pool !== expected.pool || saved.activated !== expected.activated) return false
				if (saved.pending?.id !== expected.pending?.id || (saved.pending !== undefined && !saved.pending.restartAllowed)) return false
				// Retire only this exact revision. A concurrent write can still save its newer progress.
				storage.setItem(discardedKey, raw)
				return readRaw() === undefined
			} catch (error) {
				if (error instanceof SyntaxError) return false
				if (!(error instanceof DOMException)) throw error
				rememberInTab()
				return true
			}
		},
		write: (progress: DeploymentProgress | undefined) => {
			if (!memoryJournals.has(key) && storage !== undefined) {
				try {
					if (progress === undefined) storage.removeItem(key)
					else storage.setItem(key, JSON.stringify(progress))
				} catch (error) {
					if (!(error instanceof DOMException)) throw error
					rememberInTab()
				}
			}
			const memory = memoryJournals.get(key)
			if (memory !== undefined) memory.value = progress
			current.value = progress
		},
	}
}
