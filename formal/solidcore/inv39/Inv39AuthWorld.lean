import Inv39AuthFlag
import Inv39InitBounds
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
theorem readVisible (w : Watch) (ls : LocalEnv) (k : String) (wk : w k=true) : LocalEnv.lookup? (visible w ls) k=ls.lookup? k := by
  have row (f : Frame) : Frame.lookup? (f.filter fun p=>w p.1) k=f.lookup? k := by
    induction f with
    | nil=>rfl
    | cons p ps ih=>
      rcases p with ⟨x,v⟩
      by_cases eq:x=k
      · subst x; simp [wk,Frame.lookup?]
      · cases tagged:w x with
        | true=>simp [tagged,Frame.lookup?,eq,ih,Ne.symm eq]
        | false=>simp [tagged,Frame.lookup?,eq,ih,Ne.symm eq]
  induction ls with
  | nil=>rfl
  | cons f ls ih=>
    simp only [visible,List.map_cons,LocalEnv.lookup?,row]
    cases f.lookup? k <;> first | exact ih | rfl

theorem keepLocal {w c r q} (same : Relative w c r q) (k : String) (wk : w k=true) :
    q.lookupLocal? k=r.lookupLocal? k :=
  (readVisible _ _ _ wk).symm.trans ((congrArg (fun ls : LocalEnv=>ls.lookup? k) same.scope).trans (readVisible _ _ _ wk))

theorem wfStore (s : State) (i v : Nat) (wf : StorageMap.WF s.storage) : StorageMap.WF (s.storeSlot i v).storage := by
  rintro ⟨k,x⟩ mem
  change (k,x)∈(s.storage.insert (Shared.norm i) (Shared.norm v)).toList at mem
  rw [Std.HashMap.mem_toList_iff_getElem?_eq_some,Std.HashMap.getElem?_insert] at mem
  split at mem
  · rename_i eq; obtain rfl := beq_iff_eq.mp eq
    cases mem; exact ⟨Nat.mod_mod _ _,Nat.mod_mod _ _⟩
  · exact wf (k,x) (Std.HashMap.mem_toList_iff_getElem?_eq_some.mpr mem)

theorem normRead (s : State) (wf : StorageMap.WF s.storage) (k : Nat) : Shared.norm (s.loadSlot k)=s.loadSlot k := by
  unfold State.loadSlot StorageMap.lookup?
  cases val:s.storage.get? (Shared.norm k) with
  | none=>rfl
  | some v=>exact (wf (_,v) (Std.HashMap.mem_toList_iff_getElem?_eq_some.mpr val)).2

theorem echoSlots {c s q} (world : Fold.echo c s q) (fresh : s.envWorld?=none ∨ s.worldMutatedSinceAdoption=true)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (k : Nat) : q.loadSlot k=s.loadSlot k := by
  rcases world with rfl|rfl
  · rfl
  · exact ((adoptWorld_echo_noop c s fresh wf tf).1 k).trans (normRead _ wf _)
end Inv39.Auth
