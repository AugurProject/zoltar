import Inv39UseFlag
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem pushed (r : Runtime) (k : String) : r.pushScope.lookupLocal? k=r.lookupLocal? k := rfl
theorem cancelExecution (n o nonce : Nat) (c : Context) (r : Runtime) (hash sig : Stmt)
    (wf : StorageMap.WF r.state.storage) (tf : StorageMap.WF r.state.transient) (fresh : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true)
    (safe : safeEnv r.locals) (O : r.lookupLocal? "authorizer"=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce))
    (hashOK : sigTerms (watchFlag "authorizer") hash) (sigOK : sigTerms (watchFlag "authorizer") sig) :
    Fold.Ensures (Stmt.eval (n+7) model.core.table c r (cancelBody hash sig))
      (normal (fun q=>∀ k,q.state.loadSlot k=(r.state.storeSlot (flagSlot o nonce) 1).loadSlot k)) := by
  let w := watchFlag "authorizer"
  let P := fun q : Runtime=>∀ k,q.state.loadSlot k=(r.state.storeSlot (flagSlot o nonce) 1).loadSlot k
  have pro : ∀ s∈cancelPrologue,guards false w model.core.table c s := by
    intro s mem; apply sigGuard; apply List.all_eq_true.mp (show cancelPrologue.all (sigTerms w) by decide) s mem
  have inner : ∀ md, Relative w c r.pushScope md → Fold.Ensures
      (Stmt.eval (n+6) model.core.table c md (.block (binds++[unusedFlag "authorizer",hash,sig,declFlag "authorizer",logFlag "authorizer" "AuthorizationCanceled"]))) (normal P) := by
    intro mid prior
    apply inBlock (P:=P)
    · rw [bindThen n c mid.pushScope]
      let initial := boundRoot mid.pushScope
      have safety := boundSafety mid.pushScope (safeCons _ _ prior.safe (by simp)) (by simp [Runtime.pushScope])
      have orig (k : String) (wk : w k=true) (dn : target≠k) (sn : result≠k) : initial.lookupLocal? k=r.lookupLocal? k := by
        simp only [initial,boundRoot,otherDeclared _ _ _ _ dn,otherDeclared _ _ _ _ sn,pushed]
        exact keepLocal prior k wk
      have authRef : initial.lookupLocal? target=some ptr := justDeclared _ _ _
      have terms : ∀ s∈[hash,sig],guards false w model.core.table c s := by
        intro s mem; rcases List.mem_cons.mp mem with rfl|h
        · exact sigGuard _ _ _ _ hashOK
        · obtain rfl := List.mem_singleton.mp h; exact sigGuard _ _ _ _ sigOK
      apply usedFlag (P:=P) (n+4) o nonce c initial r.state w "authorizer" "AuthorizationCanceled" [hash,sig] []
        (by decide) (by decide) (by decide) terms safety.1 safety.2 authRef
        ((orig "authorizer" (by decide) (by decide) (by decide)).trans O) ((orig "nonce" (by decide) (by decide) (by decide)).trans N)
        prior.world fresh wf tf
      exact fun q flag=>emptyList _ _ _ _ flag.word
    · exact fun q ok=>ok
  unfold cancelBody; apply inBlock (P:=P)
  · apply prefixSeq (w:=w) (n+6) r.pushScope (safeCons _ _ safe (by simp)) (by simp [Runtime.pushScope]) pro
    intro mid prior; exact endWith _ _ _ _ _ (inner mid prior)
  · exact fun q ok=>ok
end Inv39.Auth
