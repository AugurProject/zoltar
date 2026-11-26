import Inv39RepeatMarker
open SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Repeat
def Ready (b : State) (r : Runtime) := Frame.region b r ∧ r.locals≠[]
def dead : Result → Prop | .reverted _ _ => True | _ => False
def Dead (n : Nat) (c : Context) (b : State) (s : Stmt) := ∀ r, Ready b r → Fold.Ensures (Stmt.eval n model.core.table c r s) dead
theorem safe {b r} (h : Ready b r) : Auth.safeEnv r.locals := by
  intro f hf p hp
  have plain := h.1.2 f hf p hp
  apply Or.inr
  cases eq : p.2 <;> simp_all [Frame.plain,safeTemplate]
theorem enter {b r} (h : Ready b r) : Ready b r.pushScope := ⟨Frame.entered _ _ h.1,by simp [Runtime.pushScope]⟩
theorem step (n : Nat) (c : Context) (b : State) (s : Stmt)
    (frame : Frame.StmtPreserves (Frame.region b) model.core.table c s)
    (guard : Auth.guards false (fun _=>false) model.core.table c s) (r : Runtime) (h : Ready b r) :
    Fold.Ensures (Stmt.eval n model.core.table c r s) (Auth.normal (Ready b)) := by
  unfold Fold.Ensures
  intro res run
  have guarded := guard n r (safe h) h.2
  unfold Fold.Ensures at guarded
  have g := guarded res run
  have f := Frame.selected (frame n r h.1) [] res run
  cases res with
  | normal q => exact ⟨f,Auth.active g h.2⟩
  | reverted _ _ => trivial
  | returned _ _ => exact False.elim (Bool.noConfusion g.1)
  | _ => contradiction
theorem cleanStep (n bits : Nat) (name : String) (c : Context) (b : State) (r : Runtime) (h : Ready b r)
    (ordinary : Auth.ordinary name=true) :
    Fold.Ensures (Stmt.eval n model.core.table c r (cleanup bits name)) (Auth.normal (Ready b)) := by
  apply step _ _ _ _ (Frame.cleanSet b _ c name (.var name) bits (Frame.localRead name)) _ r h
  exact Auth.simpleSound _ _ _ _ _ (by simp [Auth.simple,Auth.writable,ordinary,Auth.pureExpr])
theorem guardStep (n : Nat) (c : Context) (b : State) (r : Runtime) (h : Ready b r) :
    Fold.Ensures (Stmt.eval n model.core.table c r authorityGuard) (Auth.normal (Ready b)) := by
  have read : Frame.ReadOnly authorityCheck := Frame.numeric _ _ _ (by intro h; cases h) (by intro h; cases h) Frame.caller (Frame.immutableRead _)
  exact step _ _ _ _ (requireFrame _ _ _ _ _ read) (Auth.requires read) r h
theorem consDead {n c r s ss} (head : Fold.Ensures (Stmt.eval n model.core.table c r s) (Auth.normal (Ready b)))
    (tail : ∀ q, Ready b q → Fold.Ensures (Stmt.evalList n model.core.table c q ss) dead) :
    Fold.Ensures (Stmt.evalList n model.core.table c r (s::ss)) dead := by
  rw [Stmt.evalList]; apply Fold.bind head
  intro res h; cases res with
  | normal q=>exact tail q h
  | reverted _ _=>exact Fold.pureValue _ _ trivial
  | _=>contradiction
theorem blockDead {n c b ss} (inside : ∀ r, Ready b r → Fold.Ensures (Stmt.evalList n model.core.table c r ss) dead) : Dead (n+1) c b (.block ss) := by
  intro r h; rw [Stmt.eval]; apply Fold.bind (inside _ (enter h))
  intro res bad; cases res <;> first | contradiction | exact Fold.pureValue _ _ trivial
theorem singletonDead {n c b s} (h : Dead n c b s) :
    ∀ r, Ready b r → Fold.Ensures (Stmt.evalList n model.core.table c r [s]) dead := by
  intro r hr; rw [Stmt.evalList]; apply Fold.bind (h r hr)
  intro res bad; cases res <;> first | contradiction | exact Fold.pureValue _ _ trivial
theorem captureDead {n c b s} (h : Dead n c b s) : Dead (n+1) c b (.captureReturn [] s) := by
  intro r hr; rw [Stmt.eval]; apply Fold.bind (h r hr)
  intro res bad; cases res <;> first | contradiction | exact Fold.pureValue _ _ trivial
theorem markerDead (n : Nat) (c : Context) (b : State) (tail : List Stmt)
    (fields : c.storageFields=model.core.context.storageFields)
    (nonzero : SolidCore.Solidity.Shared.norm (b.loadSlot 7)≠0) : Dead (n+2) c b (.block (markerGuard::tail)) := by
  apply blockDead
  intro r hr
  have nz : SolidCore.Solidity.Shared.norm (r.state.loadSlot 7)≠0 := by
    have eq : r.state.loadSlot 7=b.loadSlot 7 := by unfold State.loadSlot; rw [hr.1.1]
    rwa [eq]
  rw [Stmt.evalList,markerReject n c r fields nz]
  exact Fold.pureValue _ _ trivial
end Inv39.Init.Repeat
