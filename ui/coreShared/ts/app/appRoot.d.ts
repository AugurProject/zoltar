import { type ComponentChildren } from 'preact';
export declare function createAppRoot(children: ComponentChildren): import("preact").VNode<{
    children?: ComponentChildren;
}>;
type MountAppOptions = {
    initialize?: () => Promise<unknown>;
    root?: () => ComponentChildren;
    target?: Element;
};
export declare function mountApp(options: MountAppOptions): Promise<void>;
export {};
//# sourceMappingURL=appRoot.d.ts.map