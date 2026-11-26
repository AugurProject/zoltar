import Inv39FrameGrammar
open SolidCore.Solidity.Source
namespace Inv39.Frame
theorem caller : ReadOnly .caller := by
  intro n c r; cases n <;> rw [Expr.evalFuel] <;> first | exact failure _ | exact pureValue _ rfl
theorem immutableRead (name : String) : ReadOnly (.immutable name) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n => rw [Expr.evalFuel]; apply liftExcept; intro _; exact pureValue _ rfl
theorem fieldRead (mode : StorageReadMode) (name : String) : ReadOnly (.storageRead mode name []) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    cases mode with
    | header | ref | contents => rw [Expr.evalFuel]; apply liftExcept; intro _; exact pureValue _ rfl
    | element =>
      simp only [Expr.evalFuel]
      exact failure _
    | load =>
      rw [Expr.evalFuel]
      cases n with
      | zero => rw [Expr.evalListFuel]; exact failure _
      | succ n =>
        rw [Expr.evalListFuel]; change Ensures (if _ then _ else _) _
        split_ifs <;> apply liftExcept <;> intro _ <;> exact pureValue _ rfl
theorem ternary (cond yes no : Expr) (guard : ReadOnly cond) (left : ReadOnly yes) (right : ReadOnly no) : ReadOnly (.ternary cond yes no) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply bind (guard n c r); rintro ⟨v,mid⟩ same
    change mid=r at same; subst mid; apply liftExcept; intro x; split <;> first | exact left _ _ _ | exact right _ _ _
theorem inputs (es : List Expr) (all : ∀ e∈es, ReadOnly e) (n : Nat) (c : Context) (r : Runtime) :
    Ensures (Expr.evalListFuel n c r es) (fun v => v.2=r) := by
  induction es generalizing n r with
  | nil => cases n <;> rw [Expr.evalListFuel] <;> first | exact failure _ | exact pureValue _ rfl
  | cons e es ih =>
    cases n with
    | zero => rw [Expr.evalListFuel]; exact failure _
    | succ n =>
      rw [Expr.evalListFuel]
      apply bind (all e List.mem_cons_self n c r)
      rintro ⟨v,mid⟩ same; change mid=r at same; subst mid
      apply bind (ih (fun x mem => all x (List.mem_cons_of_mem _ mem)) n r)
      rintro ⟨vs,post⟩ same
      exact pureValue (P:=fun q : List Value × Runtime => q.2=r) _ same
theorem packed (widths : List Nat) (tys : List Ty) (es : List Expr) (all : ∀ e∈es, ReadOnly e) : ReadOnly (.encode .packed none widths tys es) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply bind (inputs es all n c r)
    rintro ⟨vs,post⟩ same; dsimp only
    apply liftExcept; intro vals; split <;> first | exact pureValue (P:=fun q : Value × Runtime => q.2=r) _ same | exact failure _
end Inv39.Frame
