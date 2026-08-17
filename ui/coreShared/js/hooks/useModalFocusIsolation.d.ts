type ElementRef<T extends HTMLElement> = {
    current: T | null;
};
type ModalFocusIsolationOptions<TInitialFocusElement extends HTMLElement> = {
    dialogRef: ElementRef<HTMLElement>;
    initialFocusRef: ElementRef<TInitialFocusElement>;
    isOpen: boolean;
    onClose: () => void;
};
export declare function useModalFocusIsolation<TInitialFocusElement extends HTMLElement>({ dialogRef, initialFocusRef, isOpen, onClose }: ModalFocusIsolationOptions<TInitialFocusElement>): void;
export {};
//# sourceMappingURL=useModalFocusIsolation.d.ts.map