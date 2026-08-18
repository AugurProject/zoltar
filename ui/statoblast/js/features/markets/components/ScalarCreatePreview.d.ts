export type ScalarCreatePreviewDetails = {
    answerUnit: string;
    displayValueMax: bigint;
    displayValueMin: bigint;
    numTicks: bigint;
};
type ScalarCreatePreviewProps = {
    details: ScalarCreatePreviewDetails;
    selectedTick: string;
    onSelectedTickChange: (tick: string) => void;
};
export declare function ScalarCreatePreview({ details, selectedTick, onSelectedTickChange }: ScalarCreatePreviewProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ScalarCreatePreview.d.ts.map