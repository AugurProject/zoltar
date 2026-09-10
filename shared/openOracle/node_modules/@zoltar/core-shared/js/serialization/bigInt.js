function compareBigIntAscending(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
export function sortBigIntsAscending(values) {
    return [...values].sort(compareBigIntAscending);
}
