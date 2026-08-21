# Seed alternative conditional odds

Choose `p` in basis points with `0 < p < 10,000`.

- If `p ≥ 5,000`, deposit all `q` NO and `floor(q × (10,000 − p) / p)` YES.
- If `p < 5,000`, deposit all `q` YES and `floor(q × p / (10,000 − p))` NO.

Both amounts must be nonzero. At 70% Conditional YES, `q = 1,000` produces about 428.571 YES and 1,000 NO, or approximately NO:YES = 70:30. Return all INVALID and unused directional shares to the initializer.
