import Inv39SafeTemplates
import Inv39InitWrites
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem frameLookup (f : Frame) (name : String) (v : Value) (good : safeFrame f) (read : f.lookup? name=some v) : safeTemplate v := by
  induction f with
  | nil => contradiction
  | cons p tail ih =>
    rcases p with ⟨s,w⟩
    rw [Frame.lookup?] at read
    split at read
    · cases read; exact good _ List.mem_cons_self
    · exact ih (fun x h => good x (List.mem_cons_of_mem _ h)) read
theorem envLookup (l : LocalEnv) (name : String) (v : Value) (good : safeEnv l) (read : l.lookup? name=some v) : safeTemplate v := by
  induction l with
  | nil => contradiction
  | cons f tail ih =>
    rw [LocalEnv.lookup?] at read
    split at read
    · rename_i hit eqn; cases read; exact frameLookup _ _ _ (good _ List.mem_cons_self) eqn
    · exact ih (fun x h => good x (List.mem_cons_of_mem _ h)) read
theorem noAlias (r : Runtime) (name : String) (good : safeEnv r.locals) : r.lookupStorageBase? name=none := by
  unfold Runtime.lookupStorageBase?
  cases h:r.lookupLocal? name with
  | none => rfl
  | some v =>
    have ok := envLookup _ _ _ good h
    cases v <;> first | rfl | contradiction
theorem frameAssign (f next : Frame) (name : String) (v : Value) (good : safeFrame f) (ok : safeTemplate v) (write : f.assign? name v=some next) : safeFrame next := by
  induction f generalizing next with
  | nil => contradiction
  | cons p tail ih =>
    rcases p with ⟨s,w⟩
    rw [Frame.assign?] at write; split at write
    · cases write; intro x h; rcases List.mem_cons.mp h with eq|mem
      · subst x; exact ok
      · exact good _ (List.mem_cons_of_mem _ mem)
    · split at write
      · rename_i rest eq; cases write
        intro x h; rcases List.mem_cons.mp h with same|mem
        · subst x; exact good _ List.mem_cons_self
        · exact ih _ (fun y h => good y (List.mem_cons_of_mem _ h)) eq x mem
      · contradiction
theorem envAssign (l next : LocalEnv) (name : String) (v : Value) (good : safeEnv l) (ok : safeTemplate v) (write : l.assign? name v=some next) : safeEnv next := by
  induction l generalizing next with
  | nil => contradiction
  | cons f tail ih =>
    rw [LocalEnv.assign?] at write; split at write
    · rename_i updated eq; cases write; intro g hg; rcases List.mem_cons.mp hg with same|mem
      · subst g; exact frameAssign _ _ _ _ (good _ List.mem_cons_self) ok eq
      · exact good g (List.mem_cons_of_mem _ mem)
    · split at write
      · rename_i updated eq; cases write; intro g hg; rcases List.mem_cons.mp hg with same|mem
        · subst g; exact good _ List.mem_cons_self
        · exact ih _ (fun y h => good y (List.mem_cons_of_mem _ h)) eq g mem
      · contradiction
def region (base : State) (r : Runtime) := Records base r.state ∧ safeEnv r.locals
theorem entered (b : State) (r : Runtime) (h : region b r) : region b r.pushScope := by
  refine ⟨h.1,?_⟩; intro f mem; rcases List.mem_cons.mp mem with eq|mem
  · subst f; unfold safeFrame; simp
  · exact h.2 _ mem
theorem exited (b : State) (r : Runtime) (h : region b r) : region b r.popScope :=
  ⟨h.1,fun f mem => h.2 f (List.mem_of_mem_drop mem)⟩
theorem declared (b : State) (r : Runtime) (k : String) (v : Value) (ok : safeTemplate v) (h : region b r) :
    region b (r.declareLocal k v) := by
  refine ⟨h.1,?_⟩
  change safeEnv (LocalEnv.declare r.locals k v)
  cases eq:r.locals with
  | nil => simpa [LocalEnv.declare,safeEnv,safeFrame] using ok
  | cons f tail =>
    intro g mem; rcases List.mem_cons.mp mem with same|other
    · subst g; intro x hx; rcases List.mem_cons.mp hx with here|rest
      · subst x; exact ok
      · exact h.2 f (eq ▸ List.mem_cons_self) x rest
    · exact h.2 g (eq ▸ List.mem_cons_of_mem _ other)
theorem rawAssigned (b : State) (r next : Runtime) (k : String) (v : Value) (ok : safeTemplate v) (h : region b r)
    (write : r.assignLocalRaw? k v=some next) : region b next := by
  unfold Runtime.assignLocalRaw? at write; split at write
  · rename_i l eq; cases write; exact ⟨h.1,envAssign _ _ _ _ h.2 ok eq⟩
  · contradiction
end Inv39.Init
