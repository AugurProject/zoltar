import { useEffect, useRef, useState } from 'preact/hooks';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
export function useForkAuctionInteractionState({ accountAddress, connectedWalletDisputeStakedAttoRep, forkAuctionActiveAction, forkAuctionError, forkAuctionResult, hasStartedTruthAuction, reportingDetails, securityPoolAddress, startTruthAuctionSecurityPoolAddress }) {
    const [pendingStartTruthAuctionSecurityPoolAddress, setPendingStartTruthAuctionSecurityPoolAddress] = useState(undefined);
    const isStartTruthAuctionInProgressState = startTruthAuctionSecurityPoolAddress !== undefined && sameAddress(pendingStartTruthAuctionSecurityPoolAddress, startTruthAuctionSecurityPoolAddress);
    const [isVaultMigrationPending, setIsVaultMigrationPending] = useState(false);
    const [hasCompletedVaultMigration, setHasCompletedVaultMigration] = useState(false);
    const [pendingParentEscalationClaimSelection, setPendingParentEscalationClaimSelection] = useState(undefined);
    const [optimisticClaimedParentDisputeStakedRep, setOptimisticClaimedParentDisputeStakedRep] = useState(0n);
    const previousVaultMigrationContextKeyRef = useRef(undefined);
    const vaultMigrationActionStartedRef = useRef(false);
    useEffect(() => {
        const nextContextKey = securityPoolAddress === undefined || accountAddress === undefined ? undefined : `${accountAddress.toLowerCase()}:${securityPoolAddress.toLowerCase()}`;
        if (previousVaultMigrationContextKeyRef.current === nextContextKey)
            return;
        previousVaultMigrationContextKeyRef.current = nextContextKey;
        setIsVaultMigrationPending(false);
        vaultMigrationActionStartedRef.current = false;
        setHasCompletedVaultMigration(false);
        setPendingParentEscalationClaimSelection(undefined);
        setOptimisticClaimedParentDisputeStakedRep(0n);
    }, [accountAddress, securityPoolAddress]);
    useEffect(() => {
        if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateVault' || !sameAddress(forkAuctionResult.securityPoolAddress, securityPoolAddress)) {
            return;
        }
        setHasCompletedVaultMigration(true);
        setIsVaultMigrationPending(false);
    }, [forkAuctionResult?.action, forkAuctionResult?.hash, forkAuctionResult?.securityPoolAddress, securityPoolAddress]);
    useEffect(() => {
        if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateUnresolvedEscalation' || !sameAddress(forkAuctionResult.securityPoolAddress, securityPoolAddress)) {
            return;
        }
        setHasCompletedVaultMigration(true);
        setIsVaultMigrationPending(false);
        setPendingParentEscalationClaimSelection(undefined);
        if (connectedWalletDisputeStakedAttoRep !== undefined) {
            setOptimisticClaimedParentDisputeStakedRep(currentReduction => currentReduction + connectedWalletDisputeStakedAttoRep);
        }
    }, [connectedWalletDisputeStakedAttoRep, forkAuctionResult, securityPoolAddress]);
    useEffect(() => {
        if (forkAuctionResult === undefined || forkAuctionResult.action !== 'claimParentEscalationDeposits' || !sameAddress(forkAuctionResult.securityPoolAddress, securityPoolAddress) || pendingParentEscalationClaimSelection === undefined) {
            return;
        }
        const claimSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === pendingParentEscalationClaimSelection.outcome);
        const claimedAttoRep = claimSide?.userDeposits.filter(deposit => pendingParentEscalationClaimSelection.depositIndexes.includes(deposit.depositIndex)).reduce((total, deposit) => total + deposit.amountAttoRep, 0n);
        if (claimedAttoRep !== undefined && claimedAttoRep > 0n) {
            setOptimisticClaimedParentDisputeStakedRep(currentReduction => currentReduction + claimedAttoRep);
        }
        setPendingParentEscalationClaimSelection(undefined);
    }, [forkAuctionResult, pendingParentEscalationClaimSelection, reportingDetails, securityPoolAddress]);
    useEffect(() => {
        if (!isStartTruthAuctionInProgressState)
            return;
        if (hasStartedTruthAuction) {
            setPendingStartTruthAuctionSecurityPoolAddress(undefined);
            return;
        }
        if (forkAuctionError !== undefined && forkAuctionActiveAction === undefined) {
            setPendingStartTruthAuctionSecurityPoolAddress(undefined);
        }
    }, [forkAuctionActiveAction, forkAuctionError, hasStartedTruthAuction, isStartTruthAuctionInProgressState]);
    useEffect(() => {
        if (forkAuctionResult?.action !== 'startTruthAuction')
            return;
        if (!sameAddress(forkAuctionResult.securityPoolAddress, pendingStartTruthAuctionSecurityPoolAddress))
            return;
        setPendingStartTruthAuctionSecurityPoolAddress(undefined);
    }, [forkAuctionResult, pendingStartTruthAuctionSecurityPoolAddress]);
    useEffect(() => {
        if (!isVaultMigrationPending)
            return;
        if (forkAuctionActiveAction === 'migrateVault' || forkAuctionActiveAction === 'migrateUnresolvedEscalation') {
            vaultMigrationActionStartedRef.current = true;
            return;
        }
        if (!vaultMigrationActionStartedRef.current)
            return;
        vaultMigrationActionStartedRef.current = false;
        setIsVaultMigrationPending(false);
    }, [forkAuctionActiveAction, isVaultMigrationPending]);
    useEffect(() => {
        if (forkAuctionActiveAction === 'claimParentEscalationDeposits' || forkAuctionActiveAction === 'migrateUnresolvedEscalation' || forkAuctionError === undefined) {
            return;
        }
        setPendingParentEscalationClaimSelection(undefined);
    }, [forkAuctionActiveAction, forkAuctionError]);
    useEffect(() => {
        setOptimisticClaimedParentDisputeStakedRep(0n);
    }, [connectedWalletDisputeStakedAttoRep]);
    useEffect(() => {
        if (!isStartTruthAuctionInProgressState)
            return;
        if (accountAddress === undefined || startTruthAuctionSecurityPoolAddress === undefined) {
            setPendingStartTruthAuctionSecurityPoolAddress(undefined);
        }
    }, [accountAddress, isStartTruthAuctionInProgressState, startTruthAuctionSecurityPoolAddress]);
    return {
        beginStartTruthAuctionProgress: () => {
            setPendingStartTruthAuctionSecurityPoolAddress(startTruthAuctionSecurityPoolAddress);
        },
        beginVaultMigrationProgress: () => {
            vaultMigrationActionStartedRef.current = false;
            setIsVaultMigrationPending(true);
        },
        hasCompletedVaultMigration,
        isStartTruthAuctionInProgressState,
        isVaultMigrationPending,
        optimisticClaimedParentDisputeStakedRep,
        setPendingParentEscalationClaimSelection,
    };
}
//# sourceMappingURL=useForkAuctionInteractionState.js.map