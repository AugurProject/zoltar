import Inv39Grant
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Auth
def permittedSlots (base : State) (owner spender value : Nat) (after : State) :=
  ∃ n,∀ k, after.loadSlot k=((base.storeSlot (nonceSlot owner) n).storeSlot (Allowance.slot owner spender) value).loadSlot k
theorem permitExecution (n o sp v deadline vv : Nat) (c : Context) (r : Runtime) (cond : Source.Expr) (hash sig : Source.Stmt)
    (ow : o<2^160) (sw : sp<2^160) (vf : v<R) (df : deadline<R) (byte : vv<256) (wf : StorageMap.WF r.state.storage) (tf : StorageMap.WF r.state.transient)
    (safe : safeEnv r.locals) (O : r.lookupLocal? "owner"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word sp))
    (V : r.lookupLocal? "value"=some (.word v)) (D : r.lookupLocal? "deadline"=some (.word deadline)) (B : r.lookupLocal? "v"=some (.word vv))
    (condOK : pureExpr cond) (hashOK : sigTerms permitWatch hash) (sigOK : sigTerms permitWatch sig)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+15) model.core.table c r (permitBody cond hash sig)) (normal (fun q=>permittedSlots r.state o sp v q.state)) := by
  let t := model.core.table
  let out := r.pushScope
  let inner := out.pushScope
  let rootR := boundRoot inner
  let P := fun q : Runtime=>permittedSlots r.state o sp v q.state
  have sk : Stmt.eval (n+14) t c out .skip=pure (.normal out) := by rw [Stmt.eval]
  have val := cleanAt (n+13) 256 v c out t "value" (.inr rfl) vf V
  have dl := cleanAt (n+13) 256 deadline c out t "deadline" (.inr rfl) df D
  have bv := cleanAt (n+13) 8 vv c out t "v" (.inl rfl) byte B
  unfold permitBody; apply inBlock (P:=P)
  · change Fold.Ensures (Stmt.evalList (n+14) t c out (.skip::.skip::clean 256 "value"::clean 256 "deadline"::clean 8 "v"::.skip::.skip::_)) (normal P)
    rw [seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ val,seqStep _ _ _ _ _ _ _ dl,
      seqStep _ _ _ _ _ _ _ bv,seqStep _ _ _ _ _ _ _ sk,seqStep _ _ _ _ _ _ _ sk]
    apply endWith; apply inBlock (P:=P)
    · apply pass (requireOnly (n+12) c t inner cond _ (readSound _ condOK))
      intro first eq; subst first
      rw [bindThen (n+8) c inner]
      have owner : rootR.lookupLocal? "owner"=some (.word o) := by simpa only [rootR,boundRoot,otherDeclared _ _ _ _ (by decide : target≠"owner"),otherDeclared _ _ _ _ (by decide : result≠"owner")] using O
      have startSafe := boundSafety inner (safeCons _ _ (safeCons _ _ safe (by simp)) (by simp)) (by simp [inner,out,Runtime.pushScope])
      apply pass (bumpDecl (n+12) o c rootR t (justDeclared _ _ _) owner)
      intro mid bumpOK; obtain ⟨nv,rfl⟩ := bumpOK
      let base := rootR.state.storeSlot (nonceSlot o) nv
      let afterInc := ({rootR with state:=base} : Runtime).declareLocal "nonce" (.word (rootR.state.loadSlot (nonceSlot o)))
      have sv : safeEnv afterInc.locals := (declare (fun _=>false) ({rootR with state:=base} : Runtime) "nonce" (.word (rootR.state.loadSlot (nonceSlot o))) rfl (.inr trivial) startSafe.1 startSafe.2).1
      have live : afterInc.locals≠[] := by
        unfold afterInc Runtime.declareLocal; dsimp only; cases rootR.locals <;> simp [LocalEnv.declare]
      have gs : ∀ x∈[hash,sig],guards false permitWatch t c x := by
        intro x xm; rcases List.mem_cons.mp xm with rfl|h
        · exact sigGuard _ _ _ _ hashOK
        · obtain rfl := List.mem_singleton.mp h; exact sigGuard _ _ _ _ sigOK
      apply prefixSeq (w:=permitWatch) (ss:=[hash,sig]) (n+13) afterInc sv live gs [grant.value]
      intro q rel
      have sameLocal (k : String) (wk : permitWatch k=true) (kn : "nonce"≠k) (tn : target≠k) (rn : result≠k) : q.lookupLocal? k=r.lookupLocal? k := by
        rw [keepLocal rel k wk]; unfold afterInc; rw [otherDeclared _ _ _ _ kn]
        change ((r.pushScope.pushScope.declareLocal result ptr).declareLocal target ptr).lookupLocal? k=_
        rw [otherDeclared _ _ _ _ tn,otherDeclared _ _ _ _ rn]; rfl
      obtain ⟨own,spnd,value⟩ : q.lookupLocal? "owner"=some (.word o) ∧ q.lookupLocal? "spender"=some (.word sp) ∧
          q.lookupLocal? "value"=some (.word v) := ⟨(sameLocal _ (by decide) (by decide) (by decide) (by decide)).trans O,
          (sameLocal _ (by decide) (by decide) (by decide) (by decide)).trans S,(sameLocal _ (by decide) (by decide) (by decide) (by decide)).trans V⟩
      apply endWith; apply Fold.weaken (grants n c q o sp v ow sw vf own spnd value fields events)
      intro res done; cases res with
      | normal fin=>
        refine ⟨nv,?_⟩; intro k
        have a : fin.state.loadSlot k=(q.state.storeSlot (Allowance.slot o sp) v).loadSlot k := by simp only [State.loadSlot,show fin.state.storage=_ from done]
        rw [a,loadAfterWrite,loadAfterWrite]; split
        · rfl
        · exact echoSlots rel.world (.inr rfl) (wfStore r.state _ _ wf) tf k
      | _=>first | exact done | contradiction
    · exact fun _ h=>h
  · exact fun _ h=>h
end Inv39.Auth
