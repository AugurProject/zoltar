import Inv48WholeQuoteJoin
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
open QuoteMemory

def minimumCondition (name : String) : Expr := .binary .ge
  (clean (.var "requestedInitialAttoWeth")) (clean (.var name))
def minimumGuard (name : String) : Stmt := .requireStmt (minimumCondition name)
  (some "Report funding below minimum")

theorem geSuccess (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (le : b≤a) :
    BinaryOp.apply checked .ge (.word a) (.word b) = .ok (.word 1) := by
  have val (v : Nat) (h : v<R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have cmp : ¬ SolidCore.Solidity.Shared.toEvmWord a < SolidCore.Solidity.Shared.toEvmWord b := by
    change ¬ (SolidCore.Solidity.Shared.toEvmWord a).val.val < (SolidCore.Solidity.Shared.toEvmWord b).val.val
    rw [val a ha,val b hb]
    omega
  simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.ltWord,SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.lt,cmp,Bind.bind,Except.bind]
  rfl

theorem minimumCheck (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (a minimum : Nat) (ha : a<R) (hm : minimum<R) (le : minimum≤a)
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (M : r.lookupLocal? name = some (.word minimum)) :
    Stmt.eval (n+1) t c r (minimumGuard name) = pure (.normal r) := by
  apply requirePreserves n t c r _ _
  change Expr.evalFuel 6 c r (minimumCondition name) = _
  apply Inv32Eval.binary 5 c r .ge (by intro h; cases h) (by intro h; cases h)
    _ _ (.word a) (.word minimum)
  · exact Inv32Guards.clean 4 c r _ a ha (Inv32Guards.readWord 3 c r _ a A)
  · exact Inv32Guards.clean 4 c r _ minimum hm (Inv32Guards.readWord 3 c r _ minimum M)
  · exact geSuccess c.checked a minimum ha hm le

/-- Only the reached minimum helper helperCode is observed; the minimum guard and
its preservation are derived from the numeric inequality. -/
theorem minimumBlock (n : Nat) (t : FunctionTable) (c : Context) (r mid : Runtime)
    (helperCode : List Stmt) (name : String) (a minimum : Nat)
    (helper : Stmt.evalList (n+1) t c r.pushScope helperCode = pure (.normal mid))
    (scope : mid.popScope = r)
    (A : mid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (M : mid.lookupLocal? name = some (.word minimum))
    (ha : a<R) (hm : minimum<R) (le : minimum≤a) :
    Stmt.eval (n+2) t c r (.block (helperCode++[minimumGuard name])) = pure (.normal r) := by
  have guard := minimumCheck n t c mid name a minimum ha hm le A M
  have execution : Stmt.evalList (n+1) t c r.pushScope (helperCode++[minimumGuard name]) = pure (.normal mid) := by
    rw [appendNormal _ _ _ _ mid _ _ helper]
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] guard).trans (by rw [Stmt.evalList])
  simpa [scope] using Inv32Hoist.block (n+1) t c r mid _ execution

#print axioms minimumCheck
#print axioms minimumBlock
end Inv48.WholeQuote
