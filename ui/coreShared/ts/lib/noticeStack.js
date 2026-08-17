const TONE_ORDER = {
    blocking: 0,
    warning: 1,
    pending: 2,
    success: 3,
};
export function orderNoticeItems(items) {
    return [...items].sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone]);
}
//# sourceMappingURL=noticeStack.js.map