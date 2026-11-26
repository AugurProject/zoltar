import Inv39MarkerPrefixTools
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

def watch : Auth.Watch := fun k => k == "repNumber_"

theorem filteredLookup (f : Source.Frame) :
    Source.Frame.lookup? (f.filter (fun p => watch p.1)) "repNumber_"=f.lookup? "repNumber_" := by
  induction f with
  | nil => rfl
  | cons p tail ih =>
    rcases p with ⟨k,v⟩
    by_cases eq : k="repNumber_"
    · subst k; simp [watch,Source.Frame.lookup?]
    · simpa [watch,Source.Frame.lookup?,eq] using ih

theorem visibleLookup (ls : LocalEnv) :
    LocalEnv.lookup? (Auth.visible watch ls) "repNumber_"=ls.lookup? "repNumber_" := by
  induction ls with
  | nil => rfl
  | cons f tail ih => simpa only [Auth.visible,List.map_cons,LocalEnv.lookup?,filteredLookup] using congrArg (fun x => match f.lookup? "repNumber_" with | some value => some value | none => x) ih

theorem relativeLookup {c : Context} {r q : Runtime} (rel : Auth.Relative watch c r q) :
    q.lookupLocal? "repNumber_"=r.lookupLocal? "repNumber_" := by
  change q.locals.lookup? _=r.locals.lookup? _
  rw [←visibleLookup q.locals,rel.scope,visibleLookup]

theorem frameReplace (f : Source.Frame) (k : String) (old v : Source.Value)
    (look : f.lookup? k=some old) :
    ∃ next, f.assign? k v=some next ∧ next.lookup? k=some v := by
  induction f with
  | nil => contradiction
  | cons p tail ih =>
    rcases p with ⟨name,value⟩
    by_cases eq : name=k
    · subst name; exact ⟨(k,v)::tail,by simp [Source.Frame.assign?],by simp [Source.Frame.lookup?]⟩
    · have h : Source.Frame.lookup? tail k=some old := by simpa [Source.Frame.lookup?,eq] using look
      obtain ⟨next,assign,read⟩ := ih h
      exact ⟨(name,value)::next,by simp [Source.Frame.assign?,eq,assign],by simp [Source.Frame.lookup?,eq,read]⟩

theorem envReplace (ls : LocalEnv) (k : String) (old v : Source.Value)
    (look : ls.lookup? k=some old) :
    ∃ next, ls.assign? k v=some next ∧ next.lookup? k=some v := by
  induction ls with
  | nil => contradiction
  | cons f tail ih =>
    cases h : f.lookup? k with
    | some value =>
      obtain ⟨next,assign,read⟩ := frameReplace f k value v h
      exact ⟨next::tail,by simp [LocalEnv.assign?,assign],by simp [LocalEnv.lookup?,read]⟩
    | none =>
      have absent : f.assign? k v=none := by
        clear look ih
        induction f with
        | nil => rfl
        | cons p rest ih =>
          rcases p with ⟨name,value⟩
          by_cases eq : name=k
          · simp [Source.Frame.lookup?,eq] at h
          · simp [Source.Frame.lookup?,eq] at h
            simp [Source.Frame.assign?,eq,ih h]
      have rest : LocalEnv.lookup? tail k=some old := by simpa [LocalEnv.lookup?,h] using look
      obtain ⟨next,assign,read⟩ := ih rest
      exact ⟨f::next,by simp [LocalEnv.assign?,absent,assign],by simp [LocalEnv.lookup?,h,read]⟩

theorem cleanupResult (c : Context) (r next : Runtime) (rep n : Nat)
    (look : r.lookupLocal? "repNumber_"=some (.word rep))
    (run : (Source.Stmt.eval (n+1) model.core.table c r (Repeat.cleanup 256 "repNumber_")).runWith []=.ok (.normal next)) :
    next.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) := by
  obtain ⟨ls,assign,read⟩ := envReplace r.locals "repNumber_" (.word rep) (.word (Shared.norm rep)) look
  let updated : Runtime := {r with locals:=ls}
  have write : r.assignLocal? "repNumber_" (.word (Shared.norm rep))=some updated := by
    simp [Runtime.assignLocal?,look,Value.coerceLike?,assign,updated]
  rw [cleanupExec c r updated rep n look write] at run
  have eq : next=updated := Result.normal.inj (Except.ok.inj run).symm
  rw [eq]
  exact read
end Inv39.Init.Marker.Prefix
