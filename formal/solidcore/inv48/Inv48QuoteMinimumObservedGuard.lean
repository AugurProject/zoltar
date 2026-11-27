import Inv48QuoteMinimumObservedSyntax
import Inv32Eval
import Inv32Guards
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMinimumJoin
open Inv48.WholeQuote Inv48.QuoteMemory
theorem geFailure (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (lt : a<b) :
    BinaryOp.apply checked .ge (.word a) (.word b) = .ok (.word 0) := by
  have val (v : Nat) (h : v<R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have cmp : SolidCore.Solidity.Shared.toEvmWord a < SolidCore.Solidity.Shared.toEvmWord b := by
    change (SolidCore.Solidity.Shared.toEvmWord a).val.val < (SolidCore.Solidity.Shared.toEvmWord b).val.val
    rw [val a ha,val b hb]
    exact lt
  simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.ltWord,SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.lt,cmp,Bind.bind,Except.bind]
  rfl

theorem guardFailure (fuel : Nat) (c : Context) (r : Runtime) (a m : Nat)
    (ha : a<R) (hm : m<R) (lt : a<m)
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (M : r.lookupLocal? "#view48027" = some (.word m)) :
    Stmt.eval (fuel+1) Inv48.Source.model.core.table c r (minimumGuard "#view48027") =
      pure (.reverted r (.error "Report funding below minimum")) := by
  have condition : Expr.evalFuel 6 c r (minimumCondition "#view48027") = pure (.word 0,r) := by
    apply Inv32Eval.binary 5 c r .ge (by intro h; cases h) (by intro h; cases h)
      _ _ (.word a) (.word m)
    · exact Inv32Guards.clean 4 c r _ a ha (Inv32Guards.readWord 3 c r _ a A)
    · exact Inv32Guards.clean 4 c r _ m hm (Inv32Guards.readWord 3 c r _ m M)
    · exact geFailure c.checked a m ha hm lt
  rw [minimumGuard,Stmt.eval]
  change (Expr.evalFuel 6 c r (minimumCondition "#view48027")).caught >>= _ = _
  rw [condition]
  rfl

end Inv48.QuoteMinimumJoin
