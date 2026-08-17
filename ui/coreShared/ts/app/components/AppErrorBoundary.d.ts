import { Component, type ComponentChildren } from 'preact';
type AppErrorBoundaryProps = {
    children?: ComponentChildren;
};
type AppErrorBoundaryState = {
    errorMessage: string | undefined;
};
export declare class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState;
    componentDidCatch(error: unknown): void;
    render(): ComponentChildren;
}
export {};
//# sourceMappingURL=AppErrorBoundary.d.ts.map