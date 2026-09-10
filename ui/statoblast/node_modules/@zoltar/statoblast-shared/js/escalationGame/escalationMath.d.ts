export type EscalationOutcomeKey = 'invalid' | 'yes' | 'no';
export type EscalationBalanceTuple = readonly [invalidBalanceAttoRep: bigint, yesBalanceAttoRep: bigint, noBalanceAttoRep: bigint];
export type ProjectedEscalationDeposit = {
    acceptedAmountAttoRep: bigint;
    projectedBalancesAttoRep: EscalationBalanceTuple;
    reachesNonDecision: boolean;
    tieAdjusted: boolean;
};
export declare const ESCALATION_TIME_LENGTH = 4233600n;
export declare function getEscalationBindingCapitalAttoRep(balancesAttoRep: EscalationBalanceTuple): bigint;
export declare function computeIterativeAttritionCostAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, lnRatioScaled: bigint, timeSinceStart: bigint): bigint;
export declare function computeEscalationBindingCapitalAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, timeSinceStart: bigint): bigint;
export declare function computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, attritionCostAttoRep: bigint): bigint;
export declare function hasReachedNonDecision(balancesAttoRep: EscalationBalanceTuple, nonDecisionThresholdAttoRep: bigint): boolean;
export declare function projectEscalationDeposit({ amountAttoRep, balancesAttoRep, nonDecisionThresholdAttoRep, outcome, startBondAttoRep, }: {
    amountAttoRep: bigint;
    balancesAttoRep: EscalationBalanceTuple;
    nonDecisionThresholdAttoRep: bigint;
    outcome: EscalationOutcomeKey;
    startBondAttoRep: bigint;
}): ProjectedEscalationDeposit | undefined;
export declare function getWinningEscalationDepositClaimAmount({ bindingCapitalAttoRep, depositAmountAttoRep, cumulativeAmountAttoRep, forkThresholdAttoRep, nonDecisionThresholdAttoRep, winningOutcomeBalanceAttoRep, }: {
    bindingCapitalAttoRep: bigint;
    depositAmountAttoRep: bigint;
    cumulativeAmountAttoRep: bigint;
    forkThresholdAttoRep: bigint;
    nonDecisionThresholdAttoRep: bigint;
    winningOutcomeBalanceAttoRep: bigint;
}): bigint;
export declare function getWinningImportedEscalationDepositClaimAmount({ bindingCapitalAttoRep, depositAmountAttoRep, postDepositCumulativeAmountAttoRep, forkThresholdAttoRep, nonDecisionThresholdAttoRep, winningOutcomeBalanceAttoRep, }: {
    bindingCapitalAttoRep: bigint;
    depositAmountAttoRep: bigint;
    postDepositCumulativeAmountAttoRep: bigint;
    forkThresholdAttoRep: bigint;
    nonDecisionThresholdAttoRep: bigint;
    winningOutcomeBalanceAttoRep: bigint;
}): bigint;
