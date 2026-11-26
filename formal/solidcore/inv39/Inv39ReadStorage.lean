import Inv39ReadPaths
import Inv39RawAuth
open SolidCore.Solidity.Source
namespace Inv39.ReadEvidence
open Frame
mutual
def readExpr : Expr → Bool
  | .var _ | .word _ | .immutable _ | .storageRead _ _ [] => true
  | .castOp _ _ e => readExpr e
  | .storageRead .element _ [e] => readExpr e
  | .index b i => readExpr b && readPath b && readExpr i
  | _ => false
def readPath : Expr → Bool
  | .var _ => true
  | .storageRead .element _ [e] => readExpr e
  | .index b i => readPath b && readExpr i
  | _ => false
end
mutual
theorem exprSound (e : Expr) (h : readExpr e) : ReadOnly e := by
  unfold readExpr at h; split at h
  · exact localRead _
  · exact word _
  · exact immutableRead _
  · exact fieldRead _ _
  · exact cast _ _ _ (exprSound _ h)
  · exact element _ _ (exprSound _ h)
  · simp only [Bool.and_eq_true] at h
    exact indexed _ _ (exprSound _ h.1.1) (pathSound _ h.1.2) (exprSound _ h.2)
  · contradiction
termination_by sizeOf e
theorem pathSound (e : Expr) (h : readPath e) : Resolves e := by
  unfold readPath at h; split at h
  · exact resolveVar _
  · exact resolveElement _ _ (exprSound _ h)
  · simp only [Bool.and_eq_true] at h
    exact resolveIndex _ _ (pathSound _ h.1) (exprSound _ h.2)
  · contradiction
termination_by sizeOf e
end
abbrev Storage (s : State) (r : Runtime) := r.state.storage=s.storage
 theorem named (r q : Runtime) (ks : List String) (vs : List Value)
    (h : r.assignNamedValues? ks vs=some q) : q.state.storage=r.state.storage := by
  induction ks generalizing r vs with
  | nil => cases vs <;> first | cases h; rfl | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      rw [Runtime.assignNamedValues?] at h; split at h
      · rename_i mid step; exact (ih _ _ h).trans (localStorage _ _ _ _ step)
      · contradiction
 theorem captureStorage (b : State) (t : FunctionTable) (c : Context) (ns : List String) (body : Stmt)
    (safe : StmtPreserves (Storage b) t c body) : StmtPreserves (Storage b) t c (.captureReturn ns body) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; dsimp only; exact failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only; apply Frame.bind (safe n r hr)
    intro res good; cases res <;> first | exact pureValue (P:=fun res : Result => Storage b res.runtime) _ good | skip
    dsimp only; split_ifs <;> first | exact pureValue (P:=fun res : Result => Storage b res.runtime) _ good | skip
    split
    · rename_i mid vals update wrote
      exact pureValue (P:=fun res : Result => Storage b res.runtime) _ ((named _ _ _ _ wrote).trans good)
    · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ good
 theorem returnsStorage (b : State) (t : FunctionTable) (c : Context) (e : Expr) (h : ReadOnly e) :
    StmtPreserves (Storage b) t c (.returnValues [e]) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; dsimp only; exact failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only; apply Frame.bind (caught (Auth.returnReads _ c r [e] (by simpa using h)))
    rintro (err|⟨vs,q⟩) same
    · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
    · change q=r at same; subst q; exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
 theorem localizeStorage (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) :
    StmtPreserves (Storage b) t c (.memoryLocalize ty k) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; dsimp only; exact failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only; cases eq:r.localizeMemoryLocal ty k with
    | none => exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
    | some q =>
      unfold Runtime.localizeMemoryLocal at eq
      split at eq
      · cases eq; exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
      · rename_i v hv _
        cases co:ty.coerceValue? v with
        | none => simp [co] at eq
        | some value =>
          simp only [co,Option.bind_some] at eq
          exact pureValue (P:=fun res : Result => Storage b res.runtime) (.normal q)
            (((rawStorage _ _ _ _ eq).trans (memoryStorage r value)).trans hr)
      · contradiction
 theorem aliasWrite (r q : Runtime) (k : String) (v : Value) (h : r.assignStorageRefValue? k v=some q) :
    q.state.storage=r.state.storage := by
  unfold Runtime.assignStorageRefValue? at h
  repeat' first | (split at h <;> try contradiction)
  all_goals cases h <;> rfl
def basic : Stmt → Bool
  | .skip | .storageAlias _ _ | .storageAliasFrom _ _ => true
  | .memoryLocalize _ _ => true
  | .returnValues [e] | .varDecl _ _ (some e) | .bindRawSlot _ _ e => readExpr e
  | _ => false
 theorem basicStorage (b : State) (t : FunctionTable) (c : Context) (stmt : Stmt)
    (h : basic stmt) : StmtPreserves (Storage b) t c stmt := by
  unfold basic at h; split at h
  · intro n r hr; cases n <;> rw [Stmt.eval] <;> first | exact failure _ | exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
  · intro n r hr; cases n <;> rw [Stmt.eval] <;> first | exact failure _ | exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
  · intro n r hr; cases n with
    | zero => rw [Stmt.eval]; dsimp only; exact failure _
    | succ n => rw [Stmt.eval]; dsimp only; split <;> exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
  · exact localizeStorage _ _ _ _ _
  · exact returnsStorage _ _ _ _ (exprSound _ h)
  · intro n r hr; cases n with
    | zero => rw [Stmt.eval]; dsimp only; exact failure _
    | succ n =>
      rw [Stmt.eval]; dsimp only; apply Frame.bind (caught (exprSound _ h _ c r))
      rintro (err|⟨v,q⟩) same
      · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
      · change q=r at same; subst q; dsimp only
        split <;> exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
  · intro n r hr; cases n with
    | zero => rw [Stmt.eval]; dsimp only; exact failure _
    | succ n =>
      rw [Stmt.eval]; dsimp only; apply Frame.bind (caught (exprSound _ h _ c r))
      rintro (err|⟨v,q⟩) same
      · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
      · change q=r at same; subst q; dsimp only
        split
        · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
        · split
          · rename_i next ok; exact pureValue (P:=fun res : Result => Storage b res.runtime) (.normal next) ((aliasWrite _ _ _ _ ok).trans hr)
          · exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
  · contradiction
mutual
def statements (extra : Stmt → Bool) : Stmt → Bool
  | .block ss => statementList extra ss
  | .captureReturn _ body => statements extra body
  | s => basic s || extra s
def statementList (extra : Stmt → Bool) : List Stmt → Bool
  | [] => true | s::ss => statements extra s && statementList extra ss
end
mutual
theorem statementsSound (extra : Stmt → Bool) (b : State) (t : FunctionTable) (c : Context)
    (more : ∀ s,extra s → StmtPreserves (Storage b) t c s) (s : Stmt) (h : statements extra s) :
    StmtPreserves (Storage b) t c s := by
  unfold statements at h; split at h
  · apply Frame.block (fun _ h => h) (fun _ h => h)
    exact statementListSound _ _ _ _ more _ h
  · exact captureStorage _ _ _ _ _ (statementsSound _ _ _ _ more _ h)
  · simp only [Bool.or_eq_true] at h; rcases h with h|h
    · exact basicStorage _ _ _ _ h
    · exact more _ h
termination_by sizeOf s
theorem statementListSound (extra : Stmt → Bool) (b : State) (t : FunctionTable) (c : Context)
    (more : ∀ s,extra s → StmtPreserves (Storage b) t c s) (ss : List Stmt) (h : statementList extra ss) :
    ∀ s∈ss,StmtPreserves (Storage b) t c s := by
  cases ss with
  | nil => simp
  | cons s ss =>
    simp only [statementList,Bool.and_eq_true] at h
    intro q mem; rcases List.mem_cons.mp mem with rfl|mem
    · exact statementsSound _ _ _ _ more _ h.1
    · exact statementListSound _ _ _ _ more _ h.2 _ mem
termination_by sizeOf ss
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
end
 theorem helperStorage (b : State) (c : Context) (ns : List String) :
    StmtPreserves (Storage b) model.core.table c (.internalCall ns Auth.helper []) := by
  obtain ⟨f,found,ps,rs,bd⟩ := Auth.linked
  have safe : ∀ b c,StmtPreserves (Storage b) model.core.table c f.body := by
    intro b c; rw [bd]
    apply statementsSound (fun _ => false) b model.core.table c (by simp)
    decide
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    have args : Expr.evalRefArgList c r []=pure ([],r) := by rfl
    rw [args]; rw [found]
    change Ensures (match internalCallEnter? f [] r with
      | none => pure (.reverted r RevertData.typeMismatch)
      | some (start,saved) => Stmt.eval n model.core.table {c with checked:=true} start f.body >>= internalCallFinish f ns saved) _
    cases enter:internalCallEnter? f [] r with
    | none => exact pureValue (P:=fun res : Result => Storage b res.runtime) _ hr
    | some pair =>
      rcases pair with ⟨start,saved⟩
      have st : start.state.storage=r.state.storage := by
        unfold internalCallEnter? at enter
        split at enter <;> first | contradiction | cases enter; rfl
      apply Frame.bind (safe b _ n start (st.trans hr))
      intro res good
      exact weaken (finishStorage f ns saved res) (fun post eq => eq.trans good)
def helperCall : Stmt → Bool
  | .internalCall _ key [] => key==Auth.helper
  | _ => false
 theorem helperSound (b : State) (c : Context) (s : Stmt) (h : helperCall s) :
    StmtPreserves (Storage b) model.core.table c s := by
  unfold helperCall at h; split at h
  · have eq := beq_iff_eq.mp h; subst_vars; exact helperStorage _ _ _
  · contradiction
end Inv39.ReadEvidence
