import Inv39GuardAssign
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem returnRead (e : Expr) (pureE : Frame.ReadOnly e) (c : Context) (r : Runtime) :
    Frame.Ensures (e.evalReturnValue c r) (fun q=>q.2=r) := by
  unfold Expr.evalReturnValue; split
  · split
    · exact Frame.pureValue _ rfl
    · exact pureE _ _ _
  · exact pureE _ _ _
theorem returnReads (n : Nat) (c : Context) (r : Runtime) (es : List Expr) (reads : ∀ e∈es,Frame.ReadOnly e) :
    Frame.Ensures (Expr.evalReturnListFuel n c r es) (fun q=>q.2=r) := by
  induction n generalizing es r with
  | zero => rw [Expr.evalReturnListFuel]; exact Frame.failure _
  | succ n ih =>
    cases es with
    | nil => rw [Expr.evalReturnListFuel]; exact Frame.pureValue _ rfl
    | cons e es =>
      rw [Expr.evalReturnListFuel]; apply Frame.bind (returnRead e (reads _ List.mem_cons_self) c r)
      rintro ⟨v,mid⟩ same; change mid=r at same; subst mid
      apply Frame.bind (ih r es (fun x hx=>reads _ (List.mem_cons_of_mem _ hx)))
      rintro ⟨vs,q⟩ equal
      exact Frame.pureValue (P:=fun q : List Value × Runtime=>q.2=r) _ equal
theorem ret (w : Watch) (t : FunctionTable) (c : Context) (es : List Expr) (hs : ∀ e∈es,Frame.ReadOnly e) :
    guards true w t c (.returnValues es) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; apply Fold.bind (Q:=post true w c r) (Fold.fromFrame (Frame.caught (returnReads _ c r es hs)))
    rintro (err | ⟨vs,q⟩) eq
    · exact Fold.pureValue (Result.reverted r _) _ trivial
    · change q=r at eq; subst q
      exact Fold.pureValue (Result.returned r vs) (post true w c r) ⟨rfl,.refl _ _ _ safe⟩
end Inv39.Auth
