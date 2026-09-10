export type ScalarParityQuestion = {
    name: string;
    answerUnit: string;
    displayValueMax: bigint;
    displayValueMin: bigint;
    numTicks: bigint;
};
export type ScalarParityLabelFixture = {
    name: string;
    expectedLabel: string;
    questionName: string;
    tickIndex: bigint;
};
export type ScalarParityOutcomeIndexDescriptor = {
    kind: 'invalid';
} | {
    kind: 'malformed';
} | {
    kind: 'tick';
    tickIndex: bigint;
};
export type ScalarParityEncodingFixture = {
    name: string;
    expectedDescriptor: ScalarParityOutcomeIndexDescriptor;
    expectedLabel: string;
    firstPart: bigint;
    invalid: boolean;
    questionName: string;
    secondPart: bigint;
};
export declare const SCALAR_PARITY_DECIMALS: bigint;
export declare const SCALAR_PARITY_DECIMAL_BASE: bigint;
export declare const SCALAR_PARITY_PART_BIT_LENGTH = 120n;
export declare const SCALAR_PARITY_TOTAL_BITS = 256n;
export declare const SCALAR_PARITY_PART_MASK: bigint;
export declare const SCALAR_PARITY_RESERVED_BITS_MASK: bigint;
export declare const SCALAR_PARITY_UINT120_MAX: bigint;
export declare const SCALAR_PARITY_INT256_MIN: bigint;
export declare const SCALAR_PARITY_INT256_MAX: bigint;
export declare const SCALAR_PARITY_QUESTIONS: ScalarParityQuestion[];
export declare const SCALAR_PARITY_LABEL_FIXTURES: ScalarParityLabelFixture[];
export declare const SCALAR_PARITY_ENCODING_FIXTURES: ScalarParityEncodingFixture[];
export declare function getScalarParityQuestion(questionName: string): ScalarParityQuestion;
export declare function combineScalarParityOutcomeIndex(invalid: boolean, firstPart: bigint, secondPart: bigint): bigint;
export declare function getScalarParityOutcomeIndex(question: ScalarParityQuestion, tickIndex: bigint): bigint;
export declare function formatScalarParityLabel(question: ScalarParityQuestion, tickIndex: bigint): string;
export declare function describeScalarParityOutcomeIndex(question: ScalarParityQuestion, outcomeIndex: bigint): ScalarParityOutcomeIndexDescriptor;
export declare function isScalarParityMalformedOutcomeIndex(question: ScalarParityQuestion, outcomeIndex: bigint): boolean;
export declare function formatScalarParityOutcomeName(question: ScalarParityQuestion, outcomeIndex: bigint): string;
