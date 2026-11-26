import Inv39GuardSyntax
open SolidCore.Solidity.Source
namespace Inv39.Auth
def ordinaryVar : Expr → Bool | .var k=>ordinary k | _=>false
theorem forcedSafe (tg : AbiCleanup) (v q : Value) (safe : Init.safeTemplate v)
    (ok : tg.forceValue v=.ok q) : Init.safeTemplate q := by
  unfold AbiCleanup.forceValue at ok; split at ok
  · cases ok; exact safe
  · split at ok <;> contradiction
theorem simpleDeref (r : Runtime) (v q : Value) (safe : Init.safeTemplate v)
    (nonMem : ∀ id,v≠.memoryRef id) (read : r.derefMemoryValue v=.ok q) : Init.safeTemplate q := by
  cases v with
  | memoryRef id => exact False.elim (nonMem id rfl)
  | abiLazy tag inner => exact forcedSafe tag inner q safe read
  | _ => all_goals cases read; exact safe
theorem derefRead (r : Runtime) (v : Value) (safe : Init.safeTemplate v) (nonMem : ∀ id,v≠.memoryRef id) :
    Frame.Ensures (do let q ← (liftM (r.derefMemoryValue v) : SolI Value); pure (q,r))
      (fun q : Value × Runtime=>q.2=r ∧ Init.safeTemplate q.1) := by
  cases h:r.derefMemoryValue v with
  | error err=> exact Frame.failure _
  | ok q=>exact Frame.pureValue (P:=fun q : Value × Runtime=>q.2=r ∧ Init.safeTemplate q.1) _ ⟨rfl,simpleDeref r v q safe nonMem h⟩
theorem varArgument (k : String) (c : Context) (r : Runtime) (safe : safeEnv r.locals) (non : ¬aliases k) :
    Frame.Ensures ((Expr.var k).evalRefArg c r) (fun q=>q.2=r ∧ Init.safeTemplate q.1) := by
  have root := noAlias r k safe non
  simp only [Expr.evalRefArg,root]
  cases mem:r.lookupMemoryRef? k with
  | some id => exact Frame.pureValue (P:=fun q : Value × Runtime=>q.2=r ∧ Init.safeTemplate q.1) _ ⟨rfl,trivial⟩
  | none =>
    unfold Expr.eval; rw [Expr.evalFuel]; dsimp only; rw [root]
    cases eq:r.lookupLocal? k with
    | none=>exact Frame.failure _
    | some v=>
      apply derefRead
      · exact (safeLookup safe eq).resolve_left non
      · intro id hv; subst v; simp [Runtime.lookupMemoryRef?,eq] at mem
theorem refArguments (n : Nat) (c : Context) (r : Runtime) (es : List Expr) (safe : safeEnv r.locals)
    (args : es.all ordinaryVar) :
    Frame.Ensures (Expr.evalRefArgListFuel n c r es) (fun q => q.2=r ∧ ∀ v∈q.1, Init.safeTemplate v) := by
  induction n generalizing es r with
  | zero=>rw [Expr.evalRefArgListFuel]; exact Frame.failure _
  | succ n ih=>
    cases es with
    | nil=>rw [Expr.evalRefArgListFuel]; exact Frame.pureValue (P:=fun q : List Value × Runtime=>q.2=r ∧ ∀ v∈q.1, Init.safeTemplate v) _ ⟨rfl,by simp⟩
    | cons e es=>
      simp only [List.all_cons,Bool.and_eq_true] at args
      obtain ⟨key,rfl,ord⟩ : ∃ key,e=.var key ∧ ¬aliases key := by
        obtain ⟨v,_⟩ := args; unfold ordinaryVar at v; split at v
        · exact ⟨_,rfl,ordinarySafe v⟩
        · contradiction
      rw [Expr.evalRefArgListFuel]; apply Frame.bind (varArgument key c r safe ord)
      rintro ⟨v,mid⟩ ⟨eq,vs⟩; change mid=r at eq; subst mid
      apply Frame.bind (ih r es safe args.2); rintro ⟨vals,q⟩ ⟨eq,rest⟩
      apply Frame.pureValue (P:=fun q : List Value × Runtime=>q.2=r ∧ ∀ v∈q.1, Init.safeTemplate v)
      exact ⟨eq,by intro a mem; rcases List.mem_cons.mp mem with rfl|h; exact vs; exact rest _ h⟩
end Inv39.Auth
