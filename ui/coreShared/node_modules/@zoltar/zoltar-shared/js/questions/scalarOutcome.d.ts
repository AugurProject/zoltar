export type ScalarQuestionDetails = Readonly<{
    answerUnit: string;
    displayValueMax: bigint;
    displayValueMin: bigint;
    numTicks: bigint;
}>;
export type ScalarOutcomeIndexDescriptor = {
    kind: 'invalid';
} | {
    kind: 'malformed';
} | {
    kind: 'tick';
    tickIndex: bigint;
};
export declare const MAX_PRECISE_SCALAR_TICK_COUNT: bigint;
export declare function clampScalarTickIndex(tickIndex: bigint, numTicks: bigint): bigint;
export declare function formatScalarDisplayValue(value: bigint): string;
export declare function getScalarOutcomeIndex(question: ScalarQuestionDetails, tickIndex: bigint): bigint;
export declare function getScalarDisplayValue(question: ScalarQuestionDetails, tickIndex: bigint): bigint;
export declare function getScalarTickIndexForDisplayValue(question: ScalarQuestionDetails, displayValue: bigint): bigint | undefined;
export declare function formatScalarOutcomeLabel(question: ScalarQuestionDetails, tickIndex: bigint): string;
export declare function getScalarOutcomeIndexDescriptor(question: ScalarQuestionDetails, outcomeIndex: bigint): ScalarOutcomeIndexDescriptor;
export declare function isValidScalarOutcomeIndex(question: ScalarQuestionDetails, outcomeIndex: bigint): boolean;
export declare function formatScalarOutcomeIndexLabel(question: ScalarQuestionDetails, outcomeIndex: bigint): string;
