import type { Address } from '@zoltar/core-shared/evm/ethereum'
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

type DeploymentProgress = { rules: Address; pool?: Address | undefined; activated?: boolean | undefined; draft: DeploymentDraft }

export function deploymentProgressStore(profile: NetworkProfile, owner: Address | undefined) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'pool')
	const storage = owner === undefined ? undefined : getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:deployment:v1:${network}:${owner?.toLowerCase()}`
	return {
		read: () => {
			try {
				const raw = storage?.getItem(key)
				if (raw === undefined || raw === null) return undefined
				return decodeStoredValue<DeploymentProgress>(JSON.parse(raw), read => {
					const draft = read.record('draft')
					const economics = draft.record('economicsDraft')
					return {
						rules: read.address('rules'),
						pool: read.optional('pool', read.address),
						activated: read.optional('activated', read.boolean),
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
			} catch (error) {
				if (!(error instanceof DOMException || error instanceof SyntaxError)) throw error
				return undefined
			}
		},
		write: (progress: DeploymentProgress | undefined) => {
			try {
				if (progress === undefined) storage?.removeItem(key)
				else storage?.setItem(key, JSON.stringify(progress))
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
		},
	}
}
