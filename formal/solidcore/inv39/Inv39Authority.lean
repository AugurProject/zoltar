import Inv39Terms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
def authorityCheck : Source.Expr := .binary .eq .caller (.immutable "zoltar")
def authorityGuard : Source.Stmt := .requireStmt authorityCheck (some "ReputationToken caller must be the Zoltar contract")
private def authField : Option ImmutableField → Bool
  | some ⟨"zoltar",.address⟩ => true
  | _ => false
private theorem decode (f : Option ImmutableField) (h : authField f) : f=some ⟨"zoltar",.address⟩ := by
  unfold authField at h; split at h <;> first | rfl | contradiction
theorem immutableLayout : model.core.context.immutableField? "zoltar" = some ⟨"zoltar",.address⟩ := decode _ (by native_decide)
theorem authorized (c : Context) (t : FunctionTable) (r : Runtime) (n : Nat)
    (layout : c.immutableFields=model.core.context.immutableFields) (word : c.sender<R)
    (holds : r.state.immutable? "zoltar"=some (.word c.sender)) :
    Stmt.eval (n+1) t c r authorityGuard = pure (.normal r) := by
  have fields : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩ := by
    change c.immutableFields.find? _ = _
    rw [layout]; exact immutableLayout
  have read : Expr.evalFuel 3 c r (.immutable "zoltar") = pure (.word c.sender,r) := by
    rw [Expr.evalFuel]
    simp [Runtime.loadImmutableField,fields,holds,Ty.coerceValue?]
    rfl
  have equal := Inv32WideGuards.eqWord c.checked c.sender c.sender word word
  simp only [if_true] at equal
  have cond : authorityCheck.eval c r = pure (.word (boolWord true),r) :=
    Inv32Eval.binary 3 c r .eq (by intro h; cases h) (by intro h; cases h) .caller (.immutable "zoltar") (.word c.sender) (.word c.sender) (.word (boolWord true))
      (by rw [Expr.evalFuel]) read equal
  exact Inv32QuoteGuard.requireEval _ _ _ _ _ true _ cond
end Inv39
