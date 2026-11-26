import Inv39FrameReads
open SolidCore.Solidity.Source
namespace Inv39.Frame
private theorem condition (P : Runtime → Prop) (c : Context) (r : Runtime) (guard : Expr) (reads : ReadOnly guard)
    (enter : P r) : Ensures (guard.eval c r).caught (fun | .ok (_,s) => P s | .error _ => True) := by
  apply weaken (caught (reads _ c r))
  rintro (err|⟨v,s⟩) same
  · trivial
  · change s=r at same; subst s; exact enter
theorem whileAux (P : Runtime → Prop) (t : FunctionTable) (c : Context) (guard : Expr) (s : Stmt)
    (reads : ReadOnly guard) (body : StmtPreserves P t c s) (n : Nat) (r : Runtime) (enter : P r) :
    Ensures (Stmt.evalWhile n t c r guard s) (fun out => P out.runtime) := by
  induction n generalizing r with
  | zero => rw [Stmt.evalWhile]; exact failure _
  | succ n ih =>
    rw [Stmt.evalWhile]
    apply bind (condition P c r guard reads enter)
    rintro (err|⟨v,mid⟩) ready
    · exact pureValue (P:=fun out : Result => P out.runtime) _ enter
    · dsimp only
      split
      · split
        · apply bind (body n mid ready)
          intro res preserved
          cases res <;> first | exact ih _ preserved | exact pureValue (P:=fun out : Result => P out.runtime) _ preserved
        · exact pureValue (P:=fun out : Result => P out.runtime) _ ready
      · exact pureValue (P:=fun out : Result => P out.runtime) _ ready
theorem loop (P : Runtime → Prop) (t : FunctionTable) (c : Context) (guard : Expr) (s : Stmt)
    (reads : ReadOnly guard) (body : StmtPreserves P t c s) : StmtPreserves P t c (.whileLoop guard s) := by
  intro n r hr
  cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n => rw [Stmt.eval]; exact whileAux _ _ _ _ _ reads body n r hr
theorem branch (P : Runtime → Prop) (t : FunctionTable) (c : Context) (guard : Expr) (yes no : Stmt)
    (reads : ReadOnly guard) (left : StmtPreserves P t c yes) (right : StmtPreserves P t c no) : StmtPreserves P t c (.ifElse guard yes no) := by
  intro n r hr
  cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]
    apply bind (condition P c r guard reads hr)
    rintro (err|⟨v,mid⟩) ready
    · exact pureValue (P:=fun out : Result => P out.runtime) _ hr
    · dsimp only; split
      · split <;> first | exact left n _ ready | exact right n _ ready
      · exact pureValue (P:=fun out : Result => P out.runtime) _ ready
end Inv39.Frame
