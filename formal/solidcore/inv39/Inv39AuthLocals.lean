import Inv39AuthScopes
import Inv39Fold
open SolidCore.Solidity.Source
namespace Inv39.Auth
mutual
theorem memoryState (r : Runtime) (v : Value) : (r.memoryStoredValue v).1.state=r.state := by
  cases v <;> first | rfl | exact memoryStates _ _
termination_by sizeOf v
theorem memoryStates (r : Runtime) (vs : List Value) : (r.memoryStoredValues vs).1.state=r.state := by
  cases vs with
  | nil => rfl
  | cons v vs =>
    rw [Runtime.memoryStoredValues]; dsimp only; split
    · exact (memoryStates _ vs).trans (memoryState _ _)
    · exact memoryStates _ vs
termination_by sizeOf vs
end
structure Relative (w : Watch) (c : Context) (r q : Runtime) : Prop where
  world : Fold.echo c r.state q.state
  scope : visible w q.locals=visible w r.locals
  safe : safeEnv q.locals
theorem Relative.refl (w : Watch) (c : Context) (r : Runtime) (good : safeEnv r.locals) : Relative w c r r := ⟨.inl rfl,rfl,good⟩
theorem Relative.trans {w c r x q} (first : Relative w c r x) (next : Relative w c x q) : Relative w c r q :=
  ⟨Fold.trans first.world next.world,next.scope.trans first.scope,next.safe⟩
theorem sameLocals {w : Watch} {c : Context} {r q : Runtime} (world : Fold.echo c r.state q.state)
    (ls : q.locals=r.locals) (good : safeEnv r.locals) : Relative w c r q := ⟨world,by rw [ls],ls ▸ good⟩
theorem raw {c : Context} {w : Watch} {r q : Runtime} {k : String} {v : Value} (before : safeEnv r.locals)
    (hidden : w k=false) (ok : permitted (k,v)) (assign : r.assignLocalRaw? k v=some q) : Relative w c r q := by
  unfold Runtime.assignLocalRaw? at assign; split at assign
  · rename_i ls eq; cases assign; obtain ⟨s,vis⟩ := assigned _ _ _ _ _ hidden ok before eq
    exact ⟨.inl rfl,vis,s⟩
  · contradiction
theorem localWrite {c : Context} {w : Watch} {r q : Runtime} {k : String} {v : Value} (before : safeEnv r.locals)
    (hidden : w k=false) (assign : r.assignLocal? k v=some q) : Relative w c r q := by
  unfold Runtime.assignLocal? at assign
  split at assign
  · split at assign
    · exact raw (v:=.memoryRef _) before hidden (.inr trivial) assign
    · split at assign
      · have mem := sameLocals (w:=w) (c:=c) (r:=r) (q:=((r.memoryStoredValue v).1.allocMemory (r.memoryStoredValue v).2).1)
          (.inl (memoryState _ _)) (Init.memoryEnv _ _) before
        exact mem.trans (raw (v:=.memoryRef _) mem.safe hidden (.inr trivial) assign)
      · contradiction
  · rename_i old _ lookup
    split at assign
    · rename_i val coerced
      split at assign
      · rename_i ls eq; cases assign
        have permittedOld := safeLookup before lookup
        have permittedNew : permitted (k,val) := permittedOld.imp_right (fun safe => Init.coerceTemplate _ _ _ safe coerced)
        have ⟨s,vis⟩ := assigned _ _ _ _ _ hidden permittedNew before eq
        exact ⟨.inl rfl,vis,s⟩
      · contradiction
    · contradiction
  · contradiction
theorem named {c : Context} {w : Watch} {r q : Runtime} (ks : List String) (vs : List Value) (before : safeEnv r.locals)
    (hidden : ∀ k∈ks,w k=false) (write : r.assignNamedValues? ks vs=some q) : Relative w c r q := by
  induction ks generalizing r vs with
  | nil => cases vs <;> first | cases write; exact .refl _ _ _ before | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      rw [Runtime.assignNamedValues?] at write; split at write
      · rename_i mid ref; have prior := localWrite (c:=c) before (hidden _ List.mem_cons_self) ref
        exact prior.trans (ih _ prior.safe (fun k h=>hidden k (List.mem_cons_of_mem _ h)) write)
      · contradiction
end Inv39.Auth
