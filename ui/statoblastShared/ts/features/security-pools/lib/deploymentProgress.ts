import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { signal, type Signal } from '@preact/signals'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { deployment as copy } from '../../../copy/securityPoolTransactions.js'
import type { DeploymentDraft } from './creation.js'

export type PendingDeployment = { id: string; step: 'rules' | 'pool'; hash?: Hash | undefined; nonce?: string | undefined; nonceVerified?: boolean | undefined; initialFactoryCount?: string | undefined; replacedWithoutDeployment?: boolean | undefined }
export type DeploymentProgress = { rules?: Address | undefined; pool?: Address | undefined; activated?: boolean | undefined; pending?: PendingDeployment | undefined; draft: DeploymentDraft }
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
							nonceVerified: pending.optional('nonceVerified', pending.boolean),
							initialFactoryCount: storedUnsignedInteger(pending.optional('initialFactoryCount', pending.string)),
							replacedWithoutDeployment: pending.optional('replacedWithoutDeployment', pending.boolean),
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

export function samePendingDeployment(left: PendingDeployment | undefined, right: PendingDeployment | undefined) {
	return left?.id === right?.id && left?.step === right?.step && left?.hash === right?.hash && left?.nonce === right?.nonce && left?.nonceVerified === right?.nonceVerified && left?.initialFactoryCount === right?.initialFactoryCount && left?.replacedWithoutDeployment === right?.replacedWithoutDeployment
}

export function deploymentProgressJournal(profile: NetworkProfile, owner: Address | undefined) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'pool')
	const storage = owner === undefined ? undefined : getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:deployment:v1:${network}:${owner?.toLowerCase()}`
	const discardedKey = `${key}:discarded`
	const current = memoryJournals.get(key) ?? signal<DeploymentProgress | undefined>(undefined)
	const persistenceUnavailable = signal(storage === undefined || memoryJournals.has(key))
	const persistenceWarning = signal(false)
	let storedRaw: string | undefined
	let storageWasReadable = false
	const rememberInTab = () => {
		if (owner !== undefined && !memoryJournals.has(key)) memoryJournals.set(key, current)
		persistenceUnavailable.value = true
	}
	if (storage === undefined) rememberInTab()
	const readRaw = () => {
		const raw = storage?.getItem(key)
		return raw === null || raw === storage?.getItem(discardedKey) ? undefined : raw
	}
	const readStored = () => {
		try {
			const raw = readRaw()
			storageWasReadable = true
			if (persistenceWarning.value && raw === storedRaw) return current.value
			storedRaw = raw
			persistenceWarning.value = false
			return raw === undefined ? undefined : decodeProgress(raw)
		} catch (error) {
			if (error instanceof SyntaxError) return undefined
			throw error
		}
	}
	const read = () => {
		if (memoryJournals.has(key)) return memoryJournals.get(key)?.value
		try {
			return readStored()
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
			if (!storageWasReadable) rememberInTab()
			return current.value
		}
	}
	const restored = read()
	current.value = restored
	const write = (progress: DeploymentProgress | undefined) => {
		if (!memoryJournals.has(key) && storage !== undefined) {
			try {
				if (readRaw() !== storedRaw) {
					current.value = readStored()
					return
				}
				const raw = progress === undefined ? undefined : JSON.stringify(progress)
				if (raw === undefined) storage.removeItem(key)
				else storage.setItem(key, raw)
				persistenceWarning.value = readRaw() !== raw
				if (!persistenceWarning.value) storedRaw = raw
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
				// Retain the last durable claim so every other tab still sees it.
				persistenceWarning.value = true
			}
		}
		const memory = memoryJournals.get(key)
		if (memory !== undefined) memory.value = progress
		current.value = progress
	}
	const canSkipCoordination = () => persistence === 'session' || storage === undefined || memoryJournals.has(key)
	const coordinationReason = () => (!canSkipCoordination() && navigator.locks === undefined ? copy.coordinationUnavailable : undefined)
	const coordinate = async <Result>(operation: () => Result): Promise<Result> => {
		// Simulations run independently in separate tabs and use session storage.
		if (canSkipCoordination()) return operation()
		if (navigator.locks === undefined) throw new Error(copy.coordinationUnavailable)
		return await navigator.locks.request(key, operation)
	}
	const requireStorage = <Result>(operation: () => Result): Result => {
		try {
			return operation()
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
			throw new Error(copy.progressWriteFailed, { cause: error })
		}
	}
	return {
		current,
		restored,
		persistenceUnavailable,
		persistenceWarning,
		read,
		coordinationReason,
		claim: (create: (latest: DeploymentProgress | undefined) => DeploymentProgress) => {
			const durableStorage = memoryJournals.has(key) ? undefined : storage
			return coordinate(() => {
				const latest = durableStorage === undefined ? read() : requireStorage(readStored)
				current.value = latest
				const progress = create(latest)
				if (durableStorage === undefined) {
					write(progress)
					return
				}
				const raw = JSON.stringify(progress)
				requireStorage(() => {
					durableStorage.setItem(key, raw)
					if (readRaw() !== raw) throw new Error(copy.progressWriteFailed)
				})
				storedRaw = raw
				persistenceWarning.value = false
				current.value = progress
			})
		},
		restart: (expected: DeploymentProgress) =>
			coordinate(() => {
				const replacement = expected.pending?.step === 'pool' && expected.rules !== undefined && expected.pool === undefined ? { ...expected, pending: undefined } : undefined
				if (memoryJournals.has(key) || storage === undefined) {
					const memory = memoryJournals.get(key) ?? current
					if (memory.value !== expected) return false
					memory.value = replacement
					return true
				}
				try {
					const raw = readRaw()
					if (raw === undefined) return false
					const saved = persistenceWarning.value && raw === storedRaw ? current.value : decodeProgress(raw)
					if (saved === undefined || saved.rules !== expected.rules || saved.pool !== expected.pool || saved.activated !== expected.activated) return false
					if (!samePendingDeployment(saved.pending, expected.pending)) return false
					if (replacement !== undefined) {
						const updated = JSON.stringify(replacement)
						storage.setItem(key, updated)
						return readRaw() === updated
					}
					// Retire only this exact revision. A concurrent write can still save its newer progress.
					storage.setItem(discardedKey, raw)
					return readRaw() === undefined
				} catch (error) {
					if (error instanceof SyntaxError) return false
					if (!(error instanceof DOMException)) throw error
					throw new Error(copy.progressWriteFailed, { cause: error })
				}
			}),
		write,
	}
}
