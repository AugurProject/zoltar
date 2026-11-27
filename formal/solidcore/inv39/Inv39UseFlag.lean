import Inv39CancelTerms
open SolidCore.Solidity.Source
namespace Inv39.Auth
structure Flagged (w : Watch) (r q : Runtime) (base : State) (o nonce : Nat) : Prop where
  word : ∀ k,q.state.loadSlot k=(base.storeSlot (flagSlot o nonce) 1).loadSlot k
  vars : visible w q.locals=visible w r.locals
theorem usedFlag {P : Runtime→Prop} (n o nonce : Nat) (c : Context) (r : Runtime) (base : State)
    (w : Watch) (owner label : String) (checks tail : List Stmt) (look : w owner=true) (seeNonce : w "nonce"=true) (seePtr : w target=true)
    (checked : ∀ stmt∈checks,guards false w model.core.table c stmt) (safe : safeEnv r.locals) (live : r.locals≠[])
    (pointer : r.lookupLocal? target=some ptr) (O : r.lookupLocal? owner=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce))
    (previous : Fold.echo c base r.state) (fresh : base.envWorld?=none ∨ base.worldMutatedSinceAdoption=true)
    (wf : StorageMap.WF base.storage) (tf : StorageMap.WF base.transient)
    (next : ∀ q,Flagged w r q base o nonce → Fold.Ensures (Stmt.evalList (n+1) model.core.table c q tail) (normal P)) :
    Fold.Ensures (Stmt.evalList (n+1) model.core.table c r
      (unusedFlag owner :: (checks ++ [declFlag owner,logFlag owner label] ++ tail))) (normal P) := by
  apply pass (unused n o nonce c _ r owner pointer O N)
  intro first eq; subst first
  rw [List.append_assoc]; apply prefixSeq (n+1) r safe live checked
  intro mid prefixOk
  let loc := mid.state.storeSlot (flagSlot o nonce) 1
  let written := {mid with state:=loc}
  have set := flagSet n o nonce c model.core.table mid owner ((keepLocal prefixOk _ seePtr).trans pointer)
    ((keepLocal prefixOk _ look).trans O) ((keepLocal prefixOk _ seeNonce).trans N)
  rw [show [declFlag owner,logFlag owner label]++tail=declFlag owner::logFlag owner label::tail from rfl]
  unfold declFlag; rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ set]
  apply pass (emitEffect (n+1) model.core.table c written label [.var owner,.var "nonce"]
    (fun e he=>by rcases List.mem_cons.mp he with rfl|h; exact Frame.localRead _; obtain rfl := List.mem_singleton.mp h; exact Frame.localRead _))
  intro q postLog
  apply next q
  refine ⟨?_,(congrArg (visible w) postLog.2).trans prefixOk.scope⟩
  intro k; change q.state.loadSlot k=_
  have same : q.state.loadSlot k=loc.loadSlot k := by simp only [State.loadSlot,postLog.1,written]
  rw [same]; unfold loc; rw [loadAfterWrite,loadAfterWrite]
  split
  · rfl
  · exact echoSlots (Fold.trans previous prefixOk.world) fresh wf tf k
end Inv39.Auth
