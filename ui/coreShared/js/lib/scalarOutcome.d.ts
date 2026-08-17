export { clampScalarTickIndex, formatScalarDisplayValue, formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor, isValidScalarOutcomeIndex, MAX_PRECISE_SCALAR_TICK_COUNT } from '@zoltar/shared/scalarOutcome';
type ScalarFormInputs = {
    scalarIncrement: string;
    scalarMax: string;
    scalarMin: string;
};
export declare function getScalarSliderProgress(tickIndex: bigint, numTicks: bigint): number;
export declare function getScalarSliderFillWidth(tickIndex: bigint, numTicks: bigint): string;
export declare function parseScalarFormInputs({ scalarIncrement, scalarMax, scalarMin }: ScalarFormInputs): {
    displayValueMax: bigint;
    displayValueMin: bigint;
    numTicks: bigint;
};
//# sourceMappingURL=scalarOutcome.d.ts.map