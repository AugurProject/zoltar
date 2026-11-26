import Inv39GuardWrite
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem copyLocal (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (dst src : String)
    (hidden : w dst=false) (dn : ¬aliases dst) (sn : ¬aliases src) :
    guards allow w t c (.assign (.var dst) (.var src)) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    split
    · split
      · rename_i out ok
        exact Fold.pureValue (Result.normal out) _ (raw (v:=.memoryRef _) safe hidden (.inr trivial) ok)
      · exact Fold.pureValue (Result.reverted r _) _ trivial
    · simp only [noAlias r src safe sn,Option.isSome_none,Bool.false_eq_true,if_false]
      apply rhsAssigned (allow:=allow) (c:=c) dst (.var src) hidden dn safe
      unfold evaluated; split
      · apply Fold.weaken (Fold.fromFrame (Init.valueRef _ _ _))
        rintro ⟨v,q⟩ eq; change q=r at eq; subst q; exact ⟨rfl,.inl rfl⟩
      · apply Fold.weaken (Fold.fromFrame (Frame.localRead src _ c r))
        rintro ⟨v,q⟩ eq; change q=r at eq; subst q; exact ⟨rfl,.inl rfl⟩

theorem castLocal (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (dst : String) (kind : CastKind) (bits : Nat)
    (e : Expr) (hidden : w dst=false) (dn : ¬aliases dst) {P : Value → Prop} (typed : Frame.TypedRead (.castOp kind bits e) P) :
    guards allow w t c (.assign (.var dst) (.castOp kind bits e)) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    apply rhsAssigned (allow:=allow) (c:=c) dst (.castOp kind bits e) hidden dn safe
    unfold evaluated; split
    · apply Fold.weaken (Fold.fromFrame (Frame.castRef typed c r))
      rintro ⟨v,q⟩ ⟨eq,_⟩; change q=r at eq; subst q; exact ⟨rfl,.inl rfl⟩
    · apply Fold.weaken (Fold.fromFrame (typed _ c r))
      rintro ⟨v,q⟩ ⟨eq,_⟩; change q=r at eq; subst q; exact ⟨rfl,.inl rfl⟩

theorem recoveredRef (a b l s : String) (c : Context) (r : Runtime) :
    Fold.Ensures ((digest a b l s).evalMemoryRefPreserving c r) (rhsPost c r) := by
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue digest
  rw [Expr.memoryRefOrValueFuel]
  rw [show ∀ {α β γ : Type} (t : SolI α) (f : α → SolI β) (g : β → SolI γ), (t >>= f >>= g)=(t >>= fun a => f a >>= g) from fun t f g => EvmCompiler.Simulation.Interaction.bind_assoc t f g]
  apply Fold.bind (Q:=rhsPost c r) (recoverRead a b l s _ c r)
  rintro ⟨v,q⟩ ⟨loc,echo,_⟩
  exact Fold.pureValue (v,q) _ ⟨loc,echo⟩
  all_goals simp

theorem recoverLocal (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (dst a b l s : String)
    (hidden : w dst=false) (dn : ¬aliases dst) :
    guards allow w t c (.assign (.var dst) (digest a b l s)) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    unfold digest; rw [Stmt.eval]; dsimp only
    apply rhsAssigned (allow:=allow) (c:=c) dst (digest a b l s) hidden dn safe
    unfold evaluated; split
    · exact recoveredRef _ _ _ _ _ _
    · apply Fold.weaken (recoverRead a b l s _ c r)
      intro pair eq; exact ⟨eq.1,eq.2.1⟩
end Inv39.Auth
