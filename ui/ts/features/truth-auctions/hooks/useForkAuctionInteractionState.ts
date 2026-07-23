import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { sameAddress } from '../../../lib/address.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import type { ReportingOutcomeKey } from '../../../types/contracts.js'

type PendingParentEscalationClaimSelection = {
	depositIndexes: bigint[]
	outcome: ReportingOutcomeKey
}

type UseForkAuctionInteractionStateParameters = {
	accountAddress: Address | undefined
	connectedWalletEscrowedRep: bigint | undefined
	forkAuctionActiveAction: ForkAuctionSectionProps['forkAuctionActiveAction']
	forkAuctionError: string | undefined
	forkAuctionResult: ForkAuctionSectionProps['forkAuctionResult']
	hasStartedTruthAuction: boolean
	reportingDetails: ForkAuctionSectionProps['reportingDetails']
	securityPoolAddress: Address | undefined
	startTruthAuctionSecurityPoolAddress: Address | undefined
}

export function useForkAuctionInteractionState({ accountAddress, connectedWalletEscrowedRep, forkAuctionActiveAction, forkAuctionError, forkAuctionResult, hasStartedTruthAuction, reportingDetails, securityPoolAddress, startTruthAuctionSecurityPoolAddress }: UseForkAuctionInteractionStateParameters) {
	const [pendingStartTruthAuctionSecurityPoolAddress, setPendingStartTruthAuctionSecurityPoolAddress] = useState<Address | undefined>(undefined)
	const isStartTruthAuctionInProgressState = startTruthAuctionSecurityPoolAddress !== undefined && sameAddress(pendingStartTruthAuctionSecurityPoolAddress, startTruthAuctionSecurityPoolAddress)
	const [isVaultMigrationPending, setIsVaultMigrationPending] = useState(false)
	const [hasCompletedVaultMigration, setHasCompletedVaultMigration] = useState(false)
	const [pendingParentEscalationClaimSelection, setPendingParentEscalationClaimSelection] = useState<PendingParentEscalationClaimSelection | undefined>(undefined)
	const [optimisticClaimedParentEscalationRep, setOptimisticClaimedParentEscalationRep] = useState(0n)
	const previousVaultMigrationContextKeyRef = useRef<string | undefined>(undefined)

	useEffect(() => {
		const nextContextKey = securityPoolAddress === undefined || accountAddress === undefined ? undefined : `${accountAddress.toLowerCase()}:${securityPoolAddress.toLowerCase()}`
		if (previousVaultMigrationContextKeyRef.current === nextContextKey) return
		previousVaultMigrationContextKeyRef.current = nextContextKey
		setIsVaultMigrationPending(false)
		setHasCompletedVaultMigration(false)
		setPendingParentEscalationClaimSelection(undefined)
		setOptimisticClaimedParentEscalationRep(0n)
	}, [accountAddress, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateVault' || forkAuctionResult.securityPoolAddress !== securityPoolAddress) {
			return
		}
		setHasCompletedVaultMigration(true)
		setIsVaultMigrationPending(false)
	}, [forkAuctionResult?.action, forkAuctionResult?.hash, forkAuctionResult?.securityPoolAddress, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateUnresolvedEscalation' || forkAuctionResult.securityPoolAddress !== securityPoolAddress) {
			return
		}
		setHasCompletedVaultMigration(true)
		setIsVaultMigrationPending(false)
		setPendingParentEscalationClaimSelection(undefined)
		if (connectedWalletEscrowedRep !== undefined) {
			setOptimisticClaimedParentEscalationRep(currentReduction => currentReduction + connectedWalletEscrowedRep)
		}
	}, [connectedWalletEscrowedRep, forkAuctionResult, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'claimParentEscalationDeposits' || forkAuctionResult.securityPoolAddress !== securityPoolAddress || pendingParentEscalationClaimSelection === undefined) {
			return
		}
		const claimSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === pendingParentEscalationClaimSelection.outcome)
		const claimedRep = claimSide?.userDeposits.filter(deposit => pendingParentEscalationClaimSelection.depositIndexes.includes(deposit.depositIndex)).reduce((total, deposit) => total + deposit.amount, 0n)
		if (claimedRep !== undefined && claimedRep > 0n) {
			setOptimisticClaimedParentEscalationRep(currentReduction => currentReduction + claimedRep)
		}
		setPendingParentEscalationClaimSelection(undefined)
	}, [forkAuctionResult, pendingParentEscalationClaimSelection, reportingDetails, securityPoolAddress])

	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (hasStartedTruthAuction) {
			setPendingStartTruthAuctionSecurityPoolAddress(undefined)
			return
		}
		if (forkAuctionError !== undefined && forkAuctionActiveAction === undefined) {
			setPendingStartTruthAuctionSecurityPoolAddress(undefined)
		}
	}, [forkAuctionActiveAction, forkAuctionError, hasStartedTruthAuction, isStartTruthAuctionInProgressState])

	useEffect(() => {
		if (forkAuctionResult?.action !== 'startTruthAuction') return
		if (!sameAddress(forkAuctionResult.securityPoolAddress, pendingStartTruthAuctionSecurityPoolAddress)) return
		setPendingStartTruthAuctionSecurityPoolAddress(undefined)
	}, [forkAuctionResult, pendingStartTruthAuctionSecurityPoolAddress])

	useEffect(() => {
		if (!isVaultMigrationPending) return
		if (forkAuctionActiveAction === 'migrateVault') return
		if (forkAuctionError === undefined || securityPoolAddress === undefined) return
		setIsVaultMigrationPending(false)
	}, [forkAuctionActiveAction, forkAuctionError, isVaultMigrationPending, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionActiveAction === 'claimParentEscalationDeposits' || forkAuctionActiveAction === 'migrateUnresolvedEscalation' || forkAuctionError === undefined) {
			return
		}
		setPendingParentEscalationClaimSelection(undefined)
	}, [forkAuctionActiveAction, forkAuctionError])

	useEffect(() => {
		setOptimisticClaimedParentEscalationRep(0n)
	}, [connectedWalletEscrowedRep])

	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (accountAddress === undefined || startTruthAuctionSecurityPoolAddress === undefined) {
			setPendingStartTruthAuctionSecurityPoolAddress(undefined)
		}
	}, [accountAddress, isStartTruthAuctionInProgressState, startTruthAuctionSecurityPoolAddress])

	return {
		beginStartTruthAuctionProgress: () => {
			setPendingStartTruthAuctionSecurityPoolAddress(startTruthAuctionSecurityPoolAddress)
		},
		beginVaultMigrationProgress: () => {
			setIsVaultMigrationPending(true)
		},
		hasCompletedVaultMigration,
		isStartTruthAuctionInProgressState,
		isVaultMigrationPending,
		optimisticClaimedParentEscalationRep,
		setPendingParentEscalationClaimSelection,
	}
}
