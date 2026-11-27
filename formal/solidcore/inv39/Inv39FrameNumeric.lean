import Inv39FrameMemory
open SolidCore.Solidity.Source
namespace Inv39.Frame
theorem castWord (bits : Nat) (v w : Value) (ok : uintCast? bits v=.ok w) : ∃ n, w=.word n := by
  unfold uintCast? at ok
  cases h:v.forceAbiLazy <;> simp [h,Bind.bind,Except.bind] at ok
  split at ok <;> try contradiction
  split at ok <;> first | cases ok; exact ⟨_,rfl⟩ | contradiction
theorem cleanupWord (checked : Bool) (bits : Nat) (v w : Value) (ok : uintCleanup? checked bits v=.ok w) : ∃ n, w=.word n := by
  unfold uintCleanup? at ok
  cases h:v.forceAbiLazy <;> simp [h,Bind.bind,Except.bind] at ok
  split at ok <;> try contradiction
  split at ok <;> try contradiction
  split at ok <;> first | exact castWord _ _ _ ok | contradiction
theorem lifted {P : β → Prop} (e : Except RevertData α) (k : α → SolI β)
    (next : ∀ x, e=.ok x → Ensures (k x) P) : Ensures ((liftM e : SolI α) >>= k) P := by
  cases e with
  | ok v => exact next _ rfl
  | error err => exact failure (.revert err)
theorem resolveLocal (n : Nat) (c : Context) (r : Runtime) (k : String) (good : plainEnv r.locals) :
    Ensures (Expr.resolveLValueFuel n c r (.var k)) (fun q => q=(ResolvedLValue.local k,r)) := by
  cases n with
  | zero => rw [Expr.resolveLValueFuel]; exact failure _
  | succ n =>
    simp only [Expr.resolveLValueFuel,noAlias r k good]
    split <;> first | exact pureValue _ rfl | exact failure _
theorem storeLocal (b : State) (r : Runtime) (k : String) (v : Value) (safe : incoming v) (h : region b r)
    (c : Context) (next : Runtime) (ok : (ResolvedLValue.local k).write c r v=.ok next) : region b next := by
  simp only [ResolvedLValue.write] at ok; split at ok
  · rename_i mid eq; cases ok; exact localAssigned _ _ _ _ _ safe h eq
  · contradiction
theorem inc (b : State) (c : Context) (r : Runtime) (k : String) (op : BinaryOp) (n : Nat) (h : region b r) :
    Ensures ((Expr.incDec op true (some (.uint 256)) (.var k)).evalFuel n c r) (fun q => region b q.2) := by
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    apply bind (resolveLocal n c r k h.2)
    intro pair eq; subst pair
    dsimp only
    change Ensures (liftM ((ResolvedLValue.local k).applyIncDecCleanup c r op true (.uint 256))) _
    generalize ok : (ResolvedLValue.local k).applyIncDecCleanup c r op true (.uint 256)=res
    cases res with
    | error err => exact failure (.revert err)
    | ok result =>
      apply pureValue
      unfold ResolvedLValue.applyIncDecCleanup at ok
      cases old:(ResolvedLValue.local k).read c r <;> simp [old,Bind.bind,Except.bind] at ok
      rename_i v
      cases one:v.oneLike? <;> simp [one] at ok
      rename_i u
      cases got:op.apply c.checked v u <;> simp [got] at ok
      rename_i sum
      cases cleaned:(ValueCleanup.uint 256).apply c.checked sum <;> simp [cleaned] at ok
      rename_i w
      cases write:(ResolvedLValue.local k).write c r w <;> simp [write] at ok
      obtain ⟨num,eq⟩ := cleanupWord _ _ _ _ cleaned
      subst w; subst result
      exact storeLocal _ _ _ _ (by trivial) h _ _ write
theorem compound (b : State) (r : Runtime) (c : Context) (k : String) (op : BinaryOp) (rhs : Expr) (n : Nat)
    (reads : ReadOnly rhs) (h : region b r) :
    Ensures ((Expr.assignment (some op) (some (.uint 256)) (.var k) rhs).evalFuel n c r) (fun q => region b q.2) := by
  cases n with
  | zero => rw [Expr.evalFuel]; exact failure _
  | succ n =>
    rw [Expr.evalFuel]
    apply bind (reads n c r)
    rintro ⟨v,mid⟩ eq; change mid=r at eq; subst mid
    apply bind (resolveLocal n c r k h.2)
    intro pair eq; subst pair
    dsimp only
    apply liftExcept; intro w
    apply liftExcept; intro sum
    apply lifted; intro result clean
    obtain ⟨num,eq⟩ := cleanupWord _ _ _ _ clean
    subst result
    apply lifted; intro post write
    exact pureValue (P:=fun q : Value × Runtime => region b q.2) _ (storeLocal _ _ _ _ (by trivial) h _ _ write)
end Inv39.Frame
