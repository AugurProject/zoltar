import Inv39ReadDomainRegion
open SolidCore.Solidity.Source
namespace Inv39.ReadDomainEvidence
open Init (safeTemplate safeFrame safeEnv)
open Frame (StmtPreserves Ensures)
theorem returned (b : State) (t : FunctionTable) (c : Context) (e : Expr) (h : Frame.ReadOnly e) :
    StmtPreserves (region b) t c (.returnValues [e]) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (Frame.caught (Auth.returnReads _ c r [e] (by simpa using h)))
    rintro (err|⟨vs,q⟩) eq
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · change q=r at eq; subst q; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
 theorem memNone (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) :
    StmtPreserves (region b) t c (.memoryVarDecl ty k none) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    cases eq:r.declareMemoryLocal ty k ty.defaultValue with
    | none => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    | some q => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal q) (memoryDecl _ _ _ _ _ _ hr eq)
 theorem localized (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) :
    StmtPreserves (region b) t c (.memoryLocalize ty k) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    cases eq:r.localizeMemoryLocal ty k with
    | none => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    | some q =>
      unfold Runtime.localizeMemoryLocal at eq; split at eq
      · cases eq; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
      · rename_i v hv _
        cases co:ty.coerceValue? v with
        | none => simp [co] at eq
        | some value =>
          simp only [co,Option.bind_some] at eq
          exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal q)
            (rawAssigned b ((r.memoryStoredValue value).1.allocMemory (r.memoryStoredValue value).2).1 q k _ (by trivial) (memoryValue b r value hr) eq)
      · contradiction
 theorem decl (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) (e : Option Expr)
    (scalar : Auth.scalar ty) (reads : ∀ x,e=some x → Frame.ReadOnly x) :
    StmtPreserves (region b) t c (.varDecl ty k e) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    cases e with
    | none => rw [Stmt.eval]; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ (declared _ _ _ _ (Auth.defaultSafe _ scalar) hr)
    | some e =>
      rw [Stmt.eval]; apply Frame.bind (Frame.caught (reads e rfl _ c r))
      rintro (err|⟨v,q⟩) eq
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
      · change q=r at eq; subst q; dsimp only
        cases co:ty.coerceValue? v with
        | none => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
        | some value => exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ (declared _ _ _ _ (Auth.coerced _ _ _ scalar co) hr)
def simple : Stmt → Bool
  | .skip => true
  | .memoryLocalize _ _ | .memoryVarDecl _ _ none => true
  | .varDecl ty _ none => Auth.scalar ty
  | .varDecl ty _ (some e) => Auth.scalar ty && Auth.pureExpr e
  | .returnValues [e] => Auth.pureExpr e
  | .assign (.var _) (.var _) => true
  | _ => false
 theorem simpleSound (b : State) (t : FunctionTable) (c : Context) (s : Stmt) (h : simple s) : StmtPreserves (region b) t c s := by
  unfold simple at h; split at h
  · intro n r hr; cases n <;> rw [Stmt.eval] <;> first | exact Frame.failure _ | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
  · exact localized _ _ _ _ _
  · exact memNone _ _ _ _ _
  · exact decl _ _ _ _ _ _ h (by intro e eq; contradiction)
  · simp only [Bool.and_eq_true] at h
    exact decl _ _ _ _ _ _ h.1 (by intro e eq; cases eq; exact Auth.readSound _ h.2)
  · exact returned _ _ _ _ (Auth.readSound _ h)
  · exact copy _ _ _ _ _
  · contradiction
mutual
def accepted (extra : Stmt → Bool) : Stmt → Bool
  | .block ss => acceptedList extra ss
  | .captureReturn _ body => accepted extra body
  | s => simple s || extra s
def acceptedList (extra : Stmt → Bool) : List Stmt → Bool
  | [] => true | s::ss => accepted extra s && acceptedList extra ss
end
mutual
theorem sound (extra : Stmt → Bool) (b : State) (t : FunctionTable) (c : Context)
    (more : ∀ s,extra s → StmtPreserves (region b) t c s) (s : Stmt) (h : accepted extra s) :
    StmtPreserves (region b) t c s := by
  unfold accepted at h; split at h
  · apply Frame.block (entered _) (exited _); exact listSound _ _ _ _ more _ h
  · exact capture _ _ _ _ _ (sound _ _ _ _ more _ h)
  · simp only [Bool.or_eq_true] at h; rcases h with h|h
    · exact simpleSound _ _ _ _ h
    · exact more _ h
termination_by sizeOf s
theorem listSound (extra : Stmt → Bool) (b : State) (t : FunctionTable) (c : Context)
    (more : ∀ s,extra s → StmtPreserves (region b) t c s) (ss : List Stmt) (h : acceptedList extra ss) :
    ∀ s∈ss,StmtPreserves (region b) t c s := by
  cases ss with
  | nil => simp
  | cons s ss =>
    simp only [acceptedList,Bool.and_eq_true] at h
    intro q mem; rcases List.mem_cons.mp mem with rfl|mem
    · exact sound _ _ _ _ more _ h.1
    · exact listSound _ _ _ _ more _ h.2 _ mem
termination_by sizeOf ss
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
end Inv39.ReadDomainEvidence
