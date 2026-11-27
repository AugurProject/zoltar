import Inv32QuoteExpr
open SolidCore.Solidity.Source Inv32Scalar Inv32QuoteExpr Inv32Division Inv32Actions
namespace Inv32QuoteGuard
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem both (n : Nat) (c : Context) (r : Runtime) (x y : Expr) (a b : Bool)
    (X : Expr.evalFuel n c r x = pure (.word (boolWord a),r))
    (Y : Expr.evalFuel n c r y = pure (.word (boolWord b),r)) :
    Expr.evalFuel (n+1) c r (.binary .boolAnd x y) = pure (.word (boolWord (a && b)),r) := by
  rw [Expr.evalFuel,X]; simp only [pb]
  cases a
  · rfl
  · change (do let (v,s) ← Expr.evalFuel n c r y; let w ← liftM v.expectWord
               pure (Value.word (boolWord (wordTruthy w)),s)) = _
    rw [Y]; cases b <;> rfl
theorem modeled (r : Runtime) : Models r (locals r) := by
  intro k v h; cases H : r.lookupLocal? k with
  | none => simp [locals,H] at h
  | some val => cases val <;> simp_all [locals]
theorem requireEval (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (cond : Expr)
    (b : Bool) (msg : String) (read : Expr.eval c r cond = pure (.word (boolWord b),r)) :
    Stmt.eval (n+1) t c r (.requireStmt cond (some msg)) = pure (if b then .normal r else .reverted r (.error msg)) := by
  rw [Stmt.eval]; dsimp only; rw [read]; cases b <;> rfl
def output : Stmt := .requireStmt (.binary .boolAnd (positive "amountOut").core (smaller "amountOut" "reserveOut").core) (some "Invalid output")
def fee : Stmt := .requireStmt validFee.core (some "Invalid fee")
theorem outputExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (y a : Nat)
    (hy : y<R) (ha : a<R) (Y : locals r "reserveOut" = some y) (A : locals r "amountOut" = some a) :
    Stmt.eval (n+1) t c r output = pure (if 0<a ∧ a<y then .normal r else .reverted r (.error "Invalid output")) := by
  let left := positive "amountOut"
  let right := smaller "amountOut" "reserveOut"
  let fuel := (Expr.binary .boolAnd left.core right.core).orderFuel
  have L := left.sound fuel c r (locals r) _ (by decide) (modeled _) (positiveValue c.checked _ _ _ ha A)
  have R' := right.sound fuel c r (locals r) _ (by decide) (modeled _) (less c.checked _ _ _ a y ha hy A Y)
  have guard := requireEval n t c r _ _ "Invalid output" (both _ _ _ _ _ _ _ L R')
  simpa [output,left,right] using guard
theorem feeExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (f : Nat)
    (hf : f<R) (F : locals r "feeBps" = some f) :
    Stmt.eval (n+1) t c r fee = pure (if f<10000 then .normal r else .reverted r (.error "Invalid fee")) := by
  have ev := evalFormula validFee c r _ (by decide) (feeValue _ _ _ hf F)
  simpa [fee] using requireEval n t c r _ _ "Invalid fee" ev
end Inv32QuoteGuard
