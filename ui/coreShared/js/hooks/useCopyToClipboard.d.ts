export declare function useCopyToClipboard(valueKey?: string): {
    copied: import("@preact/signals-core").Signal<boolean>;
    copyError: import("@preact/signals-core").Signal<string | undefined>;
    copyErrorId: string;
    copyText: (text: string) => Promise<void>;
};
//# sourceMappingURL=useCopyToClipboard.d.ts.map