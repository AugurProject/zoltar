import Inv39FrameIndex
open SolidCore.Solidity.Source
namespace Inv39.Frame
def TypedRead (e : Expr) (ty : Value → Prop) := ∀ n c r, Ensures (e.evalFuel n c r) (fun q => q.2=r ∧ ty q.1)
def isWord (v : Value) := ∃ n, v=.word n
def fixed (s : Nat) (v : Value) := ∃ n, v=.fixedBytes s n
theorem cleaned {e : Expr} (read : ReadOnly e) (bits : Nat) : TypedRead (.castOp .uintCleanup bits e) isWord := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply bind (read n c r)
    rintro ⟨v,mid⟩ eq
    apply lifted; intro w ok
    exact pureValue (P:=fun q : Value × Runtime => q.2=r ∧ isWord q.1) _ ⟨eq,cleanupWord _ _ _ _ ok⟩
theorem asFixed {e : Expr} (read : ReadOnly e) (srcWidth size : Nat) : TypedRead (.castOp (.fixedBytes srcWidth) size e) (fixed size) := by
  intro n c r; cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]; apply bind (read n c r)
    rintro ⟨v,mid⟩ eq
    apply liftExcept; intro a
    apply lifted; intro w ok
    apply pureValue (P:=fun q : Value × Runtime => q.2=r ∧ fixed size q.1)
    refine ⟨eq,?_⟩; unfold fixedBytesCast? at ok
    split at ok <;> first | cases ok; exact ⟨_,rfl⟩ | contradiction
theorem castRef {k : CastKind} {bits : Nat} {e : Expr} {T : Value → Prop} (typed : TypedRead (.castOp k bits e) T) (c : Context) (r : Runtime) :
    Ensures ((Expr.castOp k bits e).evalMemoryRefPreserving c r) (fun q => q.2=r ∧ T q.1) := by
  let expr := Expr.castOp k bits e
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
  rw [Expr.memoryRefOrValueFuel]
  rw [show ∀ {α β γ : Type} (t : SolI α) (f : α → SolI β) (g : β → SolI γ), (t >>= f >>= g)=(t >>= fun a => f a >>= g) from fun t f g => EvmCompiler.Simulation.Interaction.bind_assoc t f g]
  apply bind (typed _ c r)
  rintro ⟨v,post⟩ hv
  exact pureValue (P:=fun q : Value × Runtime => q.2=r ∧ T q.1) _ hv
  all_goals simp
end Inv39.Frame
