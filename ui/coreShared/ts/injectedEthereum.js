export function getInjectedEthereum() {
    if (typeof window === 'undefined')
        return undefined;
    return window.ethereum;
}
//# sourceMappingURL=injectedEthereum.js.map