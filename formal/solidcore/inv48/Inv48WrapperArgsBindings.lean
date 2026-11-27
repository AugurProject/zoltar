import Inv48WrapperArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperArgs

/-- Public ABI dispatch normalizes sender once. The sponsor initializer reads
that sender; it is not tx.origin, self, or an arbitrary sponsor input. -/
theorem sponsorInitializer (contract : Contract) (base : Context) (r : Runtime)
    (self sender value : Nat) (data : List Byte) :
    Expr.eval (ABI.Contract.callContextAtWithBase contract base self sender value data) r .caller =
      pure (.word (SolidCore.Solidity.Shared.norm sender),r) := by rfl

/-- Solidity's explicit uint32 conversion cannot truncate a callback value
which passed the actual 10,000,000 limit. Arithmetic only: the execution-to-gas
correspondence is a separate obligation. -/
theorem callbackFits (settlementGas batchGas : Nat)
    (limit : settlementGas + batchGas ≤ 10000000) :
    (settlementGas + batchGas) % 2^32 = settlementGas + batchGas := by
  exact Nat.mod_eq_of_lt (lt_of_le_of_lt limit (by decide))
end Inv48.WrapperArgs
