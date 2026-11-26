import Inv39InitMemory
import Inv39RawAuth
open SolidCore.Solidity.Source
namespace Inv39.Auth
abbrev Watch := String → Bool
def visible (w : Watch) (ls : LocalEnv) := ls.map fun f => f.filter fun p=>w p.1
def aliases (name : String) := name=target ∨ name=result
def permitted (p : String × Value) := aliases p.1 ∨ Init.safeTemplate p.2
def safeEnv (ls : LocalEnv) := ∀ f∈ls, ∀ p∈f, permitted p
theorem safeLookup {ls : LocalEnv} {name : String} {v : Value} (safe : safeEnv ls) (h : ls.lookup? name=some v) : permitted (name,v) := by
  have row {f : Frame} (h : f.lookup? name=some v) : (name,v)∈f := by
    induction f with
    | nil => contradiction
    | cons p rest ih =>
      rcases p with ⟨k,val⟩
      rw [Frame.lookup?] at h; split at h
      · rename_i same; subst k; cases h; exact List.mem_cons_self
      · exact List.mem_cons_of_mem _ (ih h)
  induction ls with
  | nil => contradiction
  | cons f tail ih =>
    rw [LocalEnv.lookup?] at h; split at h
    · rename_i val found; cases h; exact safe f List.mem_cons_self _ (row found)
    · exact ih (fun fr mem=> safe fr (List.mem_cons_of_mem _ mem)) h
theorem noAlias (r : Runtime) (name : String) (safe : safeEnv r.locals) (ordinary : ¬aliases name) :
    r.lookupStorageBase? name=none := by
  unfold Runtime.lookupStorageBase?
  cases eq:r.lookupLocal? name with
  | none => rfl
  | some v =>
    have h := (safeLookup safe eq).resolve_left ordinary
    cases v <;> first | rfl | contradiction
theorem safeCons (ls : LocalEnv) (f : Frame) (safe : safeEnv ls) (good : ∀ p∈f, permitted p) : safeEnv (f::ls) := by
  intro fr mem; rcases List.mem_cons.mp mem with same|rest
  · subst fr; exact good
  · exact safe fr rest
theorem declare (w : Watch) (r : Runtime) (name : String) (v : Value) (hidden : w name=false) (good : permitted (name,v))
    (safe : safeEnv r.locals) (active : r.locals≠[]) :
    safeEnv (r.declareLocal name v).locals ∧ visible w (r.declareLocal name v).locals=visible w r.locals := by
  cases h:r.locals with
  | nil => contradiction
  | cons f tail =>
    change safeEnv (LocalEnv.declare r.locals name v) ∧ visible w (LocalEnv.declare r.locals name v)=_
    rw [h]; refine ⟨safeCons _ _ (fun fr mem => safe fr (h ▸ List.mem_cons_of_mem _ mem)) ?_,?_⟩
    · intro p mem; rcases List.mem_cons.mp mem with eq|rest
      · subst p; exact good
      · exact safe f (h ▸ List.mem_cons_self) p rest
    · simp [visible,LocalEnv.declare,hidden]
theorem assignedFrame (w : Watch) (f q : Frame) (k : String) (v : Value) (hidden : w k=false) (good : permitted (k,v))
    (safe : ∀ p∈f,permitted p) (write : f.assign? k v=some q) : (∀ p∈q,permitted p) ∧ q.filter (fun p=>w p.1)=f.filter (fun p=>w p.1) := by
  induction f generalizing q with
  | nil => contradiction
  | cons pair rest ih =>
    rcases pair with ⟨name,old⟩
    rw [Frame.assign?] at write; split at write
    · rename_i eq; subst name; cases write
      refine ⟨?_,by simp [hidden]⟩
      intro p mem; rcases List.mem_cons.mp mem with same|more
      · subst p; exact good
      · exact safe p (List.mem_cons_of_mem _ more)
    · split at write
      · rename_i tail eq; cases write
        obtain ⟨valid,filtered⟩ := ih tail (fun p hp=>safe p (List.mem_cons_of_mem _ hp)) eq
        refine ⟨?_,by simp [List.filter_cons,filtered]⟩
        intro p mem; rcases List.mem_cons.mp mem with same|next
        · subst p; exact safe _ List.mem_cons_self
        · exact valid _ next
      · contradiction
theorem assigned (w : Watch) (ls next : LocalEnv) (name : String) (v : Value) (hidden : w name=false) (good : permitted (name,v))
    (safe : safeEnv ls) (write : ls.assign? name v=some next) : safeEnv next ∧ visible w next=visible w ls := by
  induction ls generalizing next with
  | nil => contradiction
  | cons f tail ih =>
    rw [LocalEnv.assign?] at write; split at write
    · rename_i fr eq; cases write
      obtain ⟨s,vis⟩ := assignedFrame w f fr name v hidden good (safe f List.mem_cons_self) eq
      exact ⟨safeCons _ _ (fun f h=>safe f (List.mem_cons_of_mem _ h)) s,by simp [visible,vis]⟩
    · split at write
      · rename_i ts eq; cases write
        obtain ⟨s,vis⟩ := ih ts (fun f h=>safe f (List.mem_cons_of_mem _ h)) eq
        exact ⟨safeCons _ _ s (safe f List.mem_cons_self),by simp only [visible,List.map_cons,List.cons.injEq,true_and] at vis ⊢; exact vis⟩
      · contradiction
end Inv39.Auth
