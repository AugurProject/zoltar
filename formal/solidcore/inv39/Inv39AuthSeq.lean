import Inv39AuthBind
open SolidCore.Solidity.Source
namespace Inv39.Auth
def normal (P : Runtime→Prop) : Result→Prop | .normal r=>P r | .reverted _ _=>True | _=>False
theorem pass {P Q : Runtime→Prop} {k : Stmt} {ks : List Stmt} {n t c r}
    (h : Fold.Ensures (Stmt.eval n t c r k) (normal P)) (next : ∀ mid,P mid→Fold.Ensures (Stmt.evalList n t c mid ks) (normal Q)) :
    Fold.Ensures (Stmt.evalList n t c r (k::ks)) (normal Q) := by
  rw [Stmt.evalList]; apply Fold.bind (Q:=normal Q) h
  intro res out; cases res with
  | normal mid=>exact next mid out
  | reverted mid e=>exact Fold.pureValue (Result.reverted mid e) _ trivial
  | _=>contradiction
theorem emptyList {P : Runtime→Prop} (n t c r) (p : P r) : Fold.Ensures (Stmt.evalList n t c r []) (normal P) := by
  rw [Stmt.evalList]; exact Fold.pureValue (Result.normal r) _ p
theorem endWith {P : Runtime→Prop} (n t c r) (s : Stmt) (h : Fold.Ensures (Stmt.eval n t c r s) (normal P)) :
    Fold.Ensures (Stmt.evalList n t c r [s]) (normal P) := pass h (emptyList n t c)
theorem guarding {w t c s} (n r) (safe : safeEnv r.locals) (live : r.locals≠[]) (g : guards false w t c s) :
    Fold.Ensures (Stmt.eval n t c r s) (normal (Relative w c r)) := by
  apply Fold.weaken (g n r safe live); intro res h; cases res <;> first | exact h | have bad := h.1; contradiction
theorem prefixSeq {w t c ss} (n r) (safe : safeEnv r.locals) (live : r.locals≠[]) (gs : ∀ s∈ss,guards false w t c s)
    (tail : List Stmt) (P : Runtime→Prop) (next : ∀ mid,Relative w c r mid→Fold.Ensures (Stmt.evalList n t c mid tail) (normal P)) :
    Fold.Ensures (Stmt.evalList n t c r (ss++tail)) (normal P) := by
  induction ss generalizing r with
  | nil=>exact next r (.refl _ _ _ safe)
  | cons s ss ih=>
    apply pass (guarding n r safe live (gs _ List.mem_cons_self))
    intro mid h; exact ih mid h.safe (active h live) (fun x hx=>gs x (List.mem_cons_of_mem _ hx)) (fun q hq=>next q (h.trans hq))
theorem inBlock {P Q : Runtime→Prop} (n t c r ss)
    (h : Fold.Ensures (Stmt.evalList n t c r.pushScope ss) (normal P)) (pop : ∀ q,P q→Q q.popScope) :
    Fold.Ensures (Stmt.eval (n+1) t c r (.block ss)) (normal Q) := by
  rw [Stmt.eval]; apply Fold.bind (Q:=normal Q) h
  intro res hr; cases res with
  | normal q=>exact Fold.pureValue (Result.normal q.popScope) _ (pop q hr)
  | reverted q e=>exact Fold.pureValue (Result.reverted q.popScope e) _ trivial
  | _=>contradiction
theorem emitEffect (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (es : List Expr)
    (valid : ∀ e∈es,Frame.ReadOnly e) : Fold.Ensures (Stmt.eval n t c r (.emitEvent name es))
      (normal (fun q=>q.state.storage=r.state.storage ∧ q.locals=r.locals)) := by
  cases n with
  | zero=>rw [Stmt.eval]; exact Fold.reject _ _
  | succ n=>
    rw [Stmt.eval]; dsimp only
    have sched (ids : List Nat) : ∀ x∈ids.filterMap (fun i=>es[i]?), Frame.ReadOnly x := by
      intro x hx; obtain ⟨i,_,get⟩ := List.mem_filterMap.mp hx; exact valid x (List.mem_of_getElem? get)
    let P := normal (fun q=>q.state.storage=r.state.storage ∧ q.locals=r.locals)
    apply Fold.bind (Q:=P) (Fold.fromFrame (Frame.caught (Frame.inputs _ (sched _) _ c r)))
    rintro (err|⟨vs,mid⟩) eq
    · exact Fold.pureValue (Result.reverted r _) P trivial
    · change mid=r at eq; subst mid; dsimp only
      split <;> first | exact Fold.pureValue (Result.reverted r _) P trivial | skip
      split
      · rename_i out written; exact Fold.pureValue (Result.normal out) P (logPreservesStorage _ _ _ _ _ written)
      · exact Fold.pureValue (Result.reverted r _) P trivial
end Inv39.Auth
