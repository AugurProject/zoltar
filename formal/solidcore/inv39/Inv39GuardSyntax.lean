import Inv39GuardLocalize
open SolidCore.Solidity.Source
namespace Inv39.Auth
def ordinary (k : String) := !(k==target || k==result)
theorem ordinarySafe {k} (h : ordinary k) : ¬aliases k := by simpa [ordinary,aliases] using h
def writable (w : Watch) (k : String) := !w k && ordinary k
theorem mayWrite {w k} (h : writable w k) : w k=false ∧ ¬aliases k := by
  simp only [writable,Bool.and_eq_true,Bool.not_eq_true'] at h
  exact ⟨h.1,ordinarySafe h.2⟩
def simple (allow : Bool) (w : Watch) : Stmt → Bool
  | .skip => true
  | .requireStmt e _ => pureExpr e
  | .returnValues es => allow && pureList es
  | .assign (.var dst) (.var src) => writable w dst && ordinary src
  | .assign (.var dst) (.castOp .uintCleanup _ e) => writable w dst && pureExpr e
  | .assign (.var dst) (.ecrecover (.var _) (.var _) (.var _) (.var _)) => writable w dst
  | .varDecl ty k none => scalar ty && !w k
  | .varDecl ty k (some e) => scalar ty && !w k && pureExpr e
  | .memoryVarDecl _ k none | .memoryLocalize _ k => !w k
  | _=>false
theorem simpleSound (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (s : Stmt)
    (h : simple allow w s) : guards allow w t c s := by
  unfold simple at h; split at h
  · exact skip
  · exact requires (readSound _ h)
  · simp only [Bool.and_eq_true] at h; rw [h.1]; exact ret _ _ _ _ (listSound _ h.2)
  · simp only [Bool.and_eq_true] at h; exact copyLocal _ _ _ _ _ _ (mayWrite h.1).1 (mayWrite h.1).2 (ordinarySafe h.2)
  · simp only [Bool.and_eq_true] at h; exact castLocal _ _ _ _ _ _ _ _ (mayWrite h.1).1 (mayWrite h.1).2 (Frame.cleaned (readSound _ h.2) _)
  · exact recoverLocal _ _ _ _ _ _ _ _ _ (mayWrite h).1 (mayWrite h).2
  · simp only [Bool.and_eq_true,Bool.not_eq_true'] at h
    exact varDecl _ _ _ _ _ _ _ h.1 h.2 (by intro e eq; contradiction)
  · simp only [Bool.and_eq_true,Bool.not_eq_true'] at h
    apply varDecl _ _ _ _ _ _ _ h.1.1 h.1.2
    intro x eq; cases eq; exact readSound _ h.2
  · exact memDecl _ _ _ _ _ _ (by simpa using h)
  · exact memLocal _ _ _ _ _ _ (by simpa using h)
  · contradiction
abbrev Extra := Stmt → Bool
mutual
def accepted (extra : Extra) (allow : Bool) (w : Watch) : Stmt → Bool
  | .block ss=>acceptedAll extra allow w ss
  | s=>simple allow w s || extra s
def acceptedAll (extra : Extra) (allow : Bool) (w : Watch) : List Stmt → Bool
  | []=>true | s::ss=>accepted extra allow w s && acceptedAll extra allow w ss
end
mutual
theorem acceptedSound (extra : Extra) (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context)
    (extras : ∀ s,extra s=true → guards allow w t c s) (s : Stmt) (ok : accepted extra allow w s) : guards allow w t c s := by
  unfold accepted at ok; split at ok
  · apply block; exact acceptedListSound _ _ _ _ _ extras _ ok
  · simp only [Bool.or_eq_true] at ok; rcases ok with h|h
    · exact simpleSound _ _ _ _ _ h
    · exact extras _ h
termination_by sizeOf s
theorem acceptedListSound (extra : Extra) (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context)
    (extras : ∀ s,extra s=true → guards allow w t c s) (ss : List Stmt) (ok : acceptedAll extra allow w ss) :
    ∀ s∈ss,guards allow w t c s := by
  cases ss with
  | nil=>simp
  | cons s ss=>
    simp only [acceptedAll,Bool.and_eq_true] at ok
    intro q mem; rcases List.mem_cons.mp mem with rfl|h
    · exact acceptedSound _ _ _ _ _ extras _ ok.1
    · exact acceptedListSound _ _ _ _ _ extras _ ok.2 _ h
termination_by sizeOf ss
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
end Inv39.Auth
