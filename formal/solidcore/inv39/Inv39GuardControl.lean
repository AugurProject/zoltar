import Inv39AuthLocals
open SolidCore.Solidity.Source
namespace Inv39.Auth
def post (allowReturn : Bool) (w : Watch) (c : Context) (base : Runtime) : Result → Prop
  | .normal q => Relative w c base q
  | .returned q _ => allowReturn=true ∧ Relative w c base q
  | .reverted _ _ => True
  | _ => False
def guards (allowReturn : Bool) (w : Watch) (t : FunctionTable) (c : Context) (s : Stmt) :=
  ∀ n r, safeEnv r.locals → r.locals≠[] → Fold.Ensures (Stmt.eval n t c r s) (post allowReturn w c r)
theorem retag {allow w c base mid res} (before : Relative w c base mid) (afterStep : post allow w c mid res) : post allow w c base res := by
  cases res <;> first | exact before.trans afterStep | exact ⟨afterStep.1,before.trans afterStep.2⟩ | contradiction | trivial
theorem active {c w r q} (rel : Relative w c r q) (existsFrame : r.locals≠[]) : q.locals≠[] := by
  intro nil; have x := congrArg List.length rel.scope
  simp [visible,nil] at x; exact existsFrame (List.length_eq_zero_iff.mp x.symm)
theorem stepList {allow w t c ss} (each : ∀ s∈ss,guards allow w t c s)
    (n : Nat) (r : Runtime) (safe : safeEnv r.locals) (activeFrame : r.locals≠[]) :
    Fold.Ensures (Stmt.evalList n t c r ss) (post allow w c r) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; exact Fold.pureValue (Result.normal r) _ (Relative.refl _ _ _ safe)
  | cons h rest ih =>
    rw [Stmt.evalList]
    apply Fold.bind (Q:=post allow w c r) (each h List.mem_cons_self n r safe activeFrame)
    intro res good; cases res with
    | normal mid =>
      apply Fold.weaken (ih (fun q h=>each q (List.mem_cons_of_mem _ h)) mid good.safe (active good activeFrame))
      intro res out; exact retag good out
    | _ => exact Fold.pureValue _ _ good
theorem scopeDropped {w c r q} (h : Relative w c r.pushScope q) : Relative w c r q.popScope := by
  refine ⟨h.world,?_,fun f mem => h.safe f (List.mem_of_mem_drop mem)⟩
  have gone := congrArg (List.drop 1) h.scope
  simpa only [visible,List.map_drop,Runtime.popScope,Runtime.pushScope,List.map_cons,List.drop_succ_cons,List.drop_zero] using gone
theorem block {allow w t c ss} (each : ∀ s∈ss,guards allow w t c s) : guards allow w t c (.block ss) := by
  intro n r safe _
  cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]
    apply Fold.bind (Q:=post allow w c r) (stepList each n r.pushScope (safeCons _ _ safe (by simp)) (by simp [Runtime.pushScope]))
    intro res good; apply Fold.pureValue
    cases res <;> first | exact scopeDropped good | exact ⟨good.1,scopeDropped good.2⟩ | contradiction | trivial
theorem skip {allow w t c} : guards allow w t c .skip := by
  intro n r safe _; cases n <;> rw [Stmt.eval] <;> first | exact Fold.reject _ _ | exact Fold.pureValue (Result.normal r) _ (Relative.refl _ _ _ safe)
theorem requires {allow w t c e reason} (pureCond : Frame.ReadOnly e) : guards allow w t c (.requireStmt e reason) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; apply Fold.bind (Q:=post allow w c r) (Fold.fromFrame (Frame.caught (pureCond _ c r))); rintro (err|⟨v,mid⟩) eq
    · exact Fold.pureValue (Result.reverted r _) _ trivial
    · change mid=r at eq; subst mid; dsimp only
      split <;> first | exact Fold.pureValue (Result.reverted r _) _ trivial | skip
      split <;> first | exact Fold.pureValue (Result.normal r) _ (Relative.refl _ _ _ safe) | skip
      cases reason <;> exact Fold.pureValue (Result.reverted r _) _ trivial
end Inv39.Auth
