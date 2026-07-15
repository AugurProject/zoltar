import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import type { ForkAuctionSectionProps } from '../../types.js'
import type { ReportingOutcomeKey } from '../../../types/contracts.js'

type PendingEscalationMigrationSelection = {
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
}

export function useForkAuctionInteractionState({ accountAddress, connectedWalletEscrowedRep, forkAuctionActiveAction, forkAuctionError, forkAuctionResult, hasStartedTruthAuction, reportingDetails, securityPoolAddress }: UseForkAuctionInteractionStateParameters) {
	const [isStartTruthAuctionInProgressState, setIsStartTruthAuctionInProgressState] = useState(false)
	const [isVaultMigrationPending, setIsVaultMigrationPending] = useState(false)
	const [hasCompletedVaultMigration, setHasCompletedVaultMigration] = useState(false)
	const [pendingEscalationMigrationSelection, setPendingEscalationMigrationSelection] = useState<PendingEscalationMigrationSelection | undefined>(undefined)
	const [optimisticMigratedEscalationRep, setOptimisticMigratedEscalationRep] = useState(0n)
	const previousVaultMigrationContextKeyRef = useRef<string | undefined>(undefined)

	useEffect(() => {
		const nextContextKey = securityPoolAddress === undefined || accountAddress === undefined ? undefined : `${accountAddress.toLowerCase()}:${securityPoolAddress.toLowerCase()}`
		if (previousVaultMigrationContextKeyRef.current === nextContextKey) return
		previousVaultMigrationContextKeyRef.current = nextContextKey
		setIsVaultMigrationPending(false)
		setHasCompletedVaultMigration(false)
		setPendingEscalationMigrationSelection(undefined)
		setOptimisticMigratedEscalationRep(0n)
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
		setPendingEscalationMigrationSelection(undefined)
		if (connectedWalletEscrowedRep !== undefined) {
			setOptimisticMigratedEscalationRep(currentReduction => currentReduction + connectedWalletEscrowedRep)
		}
	}, [connectedWalletEscrowedRep, forkAuctionResult, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateEscalationDeposits' || forkAuctionResult.securityPoolAddress !== securityPoolAddress || pendingEscalationMigrationSelection === undefined) {
			return
		}
		const migrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === pendingEscalationMigrationSelection.outcome)
		const migratedRep = migrationSide?.userDeposits.filter(deposit => pendingEscalationMigrationSelection.depositIndexes.includes(deposit.depositIndex)).reduce((total, deposit) => total + deposit.amount, 0n)
		if (migratedRep !== undefined && migratedRep > 0n) {
			setOptimisticMigratedEscalationRep(currentReduction => currentReduction + migratedRep)
		}
		setPendingEscalationMigrationSelection(undefined)
	}, [forkAuctionResult, pendingEscalationMigrationSelection, reportingDetails, securityPoolAddress])

	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (hasStartedTruthAuction) {
			setIsStartTruthAuctionInProgressState(false)
			return
		}
		if (forkAuctionError !== undefined && forkAuctionActiveAction === undefined) {
			setIsStartTruthAuctionInProgressState(false)
		}
	}, [forkAuctionActiveAction, forkAuctionError, hasStartedTruthAuction, isStartTruthAuctionInProgressState, securityPoolAddress])

	useEffect(() => {
		if (!isVaultMigrationPending) return
		if (forkAuctionActiveAction === 'migrateVault') return
		if (forkAuctionError === undefined || securityPoolAddress === undefined) return
		setIsVaultMigrationPending(false)
	}, [forkAuctionActiveAction, forkAuctionError, isVaultMigrationPending, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionActiveAction === 'migrateEscalationDeposits' || forkAuctionActiveAction === 'migrateUnresolvedEscalation' || forkAuctionError === undefined) {
			return
		}
		setPendingEscalationMigrationSelection(undefined)
	}, [forkAuctionActiveAction, forkAuctionError])

	useEffect(() => {
		setOptimisticMigratedEscalationRep(0n)
	}, [connectedWalletEscrowedRep])

	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (accountAddress === undefined || securityPoolAddress === undefined) {
			setIsStartTruthAuctionInProgressState(false)
		}
	}, [accountAddress, isStartTruthAuctionInProgressState, securityPoolAddress])

	return {
		beginStartTruthAuctionProgress: () => {
			setIsStartTruthAuctionInProgressState(true)
		},
		beginVaultMigrationProgress: () => {
			setIsVaultMigrationPending(true)
		},
		hasCompletedVaultMigration,
		isStartTruthAuctionInProgressState,
		isVaultMigrationPending,
		optimisticMigratedEscalationRep,
		setPendingEscalationMigrationSelection,
	}
}
