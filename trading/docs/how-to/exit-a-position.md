# Exit an insured position

Use the SDK’s `maximumInsuredExit` with current wallet balances and reserves. It binary-searches for the largest `q` satisfying wallet INVALID, wallet long shares, and opposite-reserve bounds. Simulate the final router call before submission.

For YES, `q` complete sets require `q` INVALID, `q` YES for redemption, and additional YES to buy exactly `q` NO. Set `maxLongSharesIn`, `minEthOut`, recipient, and deadline explicitly. If the UI reports “Your INVALID balance covers only X complete sets,” the remainder has not been lost; it remains as directional shares unless more INVALID is acquired.
