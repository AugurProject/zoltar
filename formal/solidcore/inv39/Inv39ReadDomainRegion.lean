import Inv39ReadStorage
import Inv39SigDomain
open SolidCore.Solidity.Source
namespace Inv39.ReadDomainEvidence
open Init (safeTemplate safeFrame safeEnv coerceTemplate)
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
def region (base : State) (r : Runtime) := r.state.storage=base.storage ∧ safeEnv r.locals
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
mutual
theorem memoryEnv (r : Runtime) (v : Value) : (r.memoryStoredValue v).1.locals=r.locals := by
  cases v <;> first | rfl | exact memoryEnvs _ _
termination_by sizeOf v
theorem memoryEnvs (r : Runtime) (vs : List Value) : (r.memoryStoredValues vs).1.locals=r.locals := by
  cases vs with
  | nil => rfl
  | cons v vs =>
    rw [Runtime.memoryStoredValues]; dsimp only; split
    · exact (memoryEnvs _ vs).trans (memoryEnv _ _)
    · exact memoryEnvs _ vs
termination_by sizeOf vs
end
theorem memoryValue (b : State) (r : Runtime) (v : Value) (h : region b r) : region b (r.memoryStoredValue v).1 :=
  ⟨(Frame.memoryStorage r v).trans h.1,by simpa only [memoryEnv] using h.2⟩
theorem memoryDecl (base : State) (r next : Runtime) (name : String) (v : Value) (ty : Ty) (prior : region base r)
    (ok : r.declareMemoryLocal ty name v=some next) : region base next := by
  unfold Runtime.declareMemoryLocal at ok
  cases got : ty.coerceValue? v with
  | none => simp [got] at ok
  | some value =>
    simp only [got] at ok; cases ok
    exact declared base _ _ _ (by trivial) (memoryValue base _ _ prior)
theorem localAssigned (base : State) (r next : Runtime) (name : String) (v : Value)
    (before : region base r) (ok : r.assignLocal? name v=some next) : region base next := by
  unfold Runtime.assignLocal? at ok
  split at ok
  · split at ok
    · apply rawAssigned _ _ _ _ _ _ _ ok <;> first | trivial | exact before
    · split at ok
      · apply rawAssigned _ _ _ _ _ _ _ ok
        · trivial
        · exact memoryValue _ _ _ before
      · contradiction
  · rename_i old _ lookup
    have valid := envLookup _ _ _ before.2 lookup
    split at ok
    · rename_i coerced got
      split at ok
      · rename_i locals write; cases ok
        exact ⟨before.1,envAssign _ _ _ _ before.2 (coerceTemplate old v coerced valid got) write⟩
      · contradiction
    · contradiction
  · contradiction
theorem assignPointerFails (r : Runtime) (name : String) (v : Value) (before : safeEnv r.locals) : r.assignStorageRefValue? name v=none := by
  unfold Runtime.assignStorageRefValue?
  cases eq:r.lookupLocal? name with
  | none => rfl
  | some old =>
    have h := envLookup _ _ _ before eq
    cases old <;> first | rfl | contradiction
theorem assignRef (base : State) (r next : Runtime) (name : String) (v : Value) (prior : region base r)
    (ok : r.assignLocalRefAware? name v=some next) : region base next := by
  unfold Runtime.assignLocalRefAware? at ok
  split at ok <;> first | exact localAssigned _ _ _ _ _ prior ok | rw [assignPointerFails _ _ _ prior.2] at ok; contradiction
theorem namedRef (base : State) (r next : Runtime) (ks : List String) (vs : List Value) (prior : region base r)
    (ok : r.assignNamedValuesRef? ks vs=some next) : region base next := by
  induction ks generalizing vs r with
  | nil => cases vs <;> first | cases ok; exact prior | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      simp only [Runtime.assignNamedValuesRef?] at ok; split at ok
      · rename_i mid step; exact ih _ _ (assignRef _ _ _ _ _ prior step) ok
      · contradiction
theorem namedPlain (base : State) (r next : Runtime) (ks : List String) (vs : List Value) (prior : region base r)
    (ok : r.assignNamedValues? ks vs=some next) : region base next := by
  induction ks generalizing vs r with
  | nil => cases vs <;> first | cases ok; exact prior | contradiction
  | cons k ks ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      simp only [Runtime.assignNamedValues?] at ok; split at ok
      · rename_i mid step; exact ih _ _ (localAssigned _ _ _ _ _ prior step) ok
      · contradiction
theorem resolve (c : Context) (r : Runtime) (name : String) (valid : safeEnv r.locals) :
    Frame.Ensures ((LValue.var name).resolveWithRuntime c r) (fun q => q.2=r ∧ q.1=.local name) := by
  change Frame.Ensures (Expr.resolveLValueFuel ((Expr.var name).orderFuel+1) c r (.var name)) _
  simp only [Expr.resolveLValueFuel,noAlias _ _ valid]; split
  · exact Frame.pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r ∧ q.1=.local name) _ ⟨rfl,rfl⟩
  · exact Frame.failure _
theorem cleanLocal (base : State) (t : FunctionTable) (c : Context) (name : String) (bits : Nat) (e : Expr) (rhs : Frame.ReadOnly e) :
    Frame.StmtPreserves (region base) t c (.assign (.var name) (.castOp .uintCleanup bits e)) := by
  apply Frame.castSet _ _ _ _ _ _ _ Frame.isWord (fun _ loc => loc=.local name) (Frame.cleaned rhs bits)
  · exact fun r hr => resolve _ _ _ hr.2
  · rintro r loc v next hr hv rfl ok
    simp only [ResolvedLValue.write] at ok; split at ok
    · rename_i mid written; cases ok; exact localAssigned _ _ _ _ _ hr written
    · contradiction
theorem variableRef (c : Context) (r : Runtime) (x : String) :
    Frame.Ensures ((Expr.var x).memoryRefOrValue c r) (fun q => q.2.2=r) := by
  unfold Expr.memoryRefOrValue
  rw [Expr.memoryRefOrValueFuel]; split
  · exact Frame.pureValue _ rfl
  · apply Frame.bind (Frame.localRead x _ c r); rintro ⟨v,post⟩ same
    exact Frame.pureValue (P:=fun q : Option Nat × Option Value × Runtime => q.2.2=r) _ same
theorem valueRef (c : Context) (r : Runtime) (x : String) :
    Frame.Ensures ((Expr.var x).evalMemoryRefPreserving c r) (fun q => q.2=r) := by
  unfold Expr.evalMemoryRefPreserving; apply Frame.bind (variableRef c r x)
  rintro ⟨i,val,post⟩ eq; change post=r at eq; subst post
  cases i <;> cases val <;> first | exact Frame.pureValue _ rfl | exact Frame.localRead x _ c r
theorem copy (b : State) (t : FunctionTable) (c : Context) (dst src : String) :
    Frame.StmtPreserves (region b) t c (.assign (.var dst) (.var src)) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    have reads : Frame.Ensures (if (LValue.var dst).wantsMemoryRefRhs r then (Expr.var src).evalMemoryRefPreserving c r else
          (Expr.var src).eval c r) (fun q => q.2=r) := by split <;> first | exact valueRef _ _ _ | exact Frame.localRead _ _ _ _
    split
    · split
      · rename_i mid wrote; apply Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal mid); apply rawAssigned _ _ _ _ _ _ _ wrote <;> first | trivial | exact hr
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · apply Frame.bind (Frame.caught reads)
      rintro (err|⟨v,mid⟩) eq
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
      · change mid=r at eq; subst mid
        apply Frame.bind (Frame.caught (resolve c r dst hr.2)); rintro (err|⟨loc,post⟩) pred
        · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
        · change post=r ∧ loc=.local dst at pred; obtain ⟨rfl,rfl⟩ := pred
          simp only [noAlias post src hr.2,Option.isSome_none,Bool.false_eq_true,if_false,ResolvedLValue.write]
          split
          · rename_i mid wrote; split at wrote
            · rename_i out changeLoc; cases wrote; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (localAssigned _ _ _ _ _ hr changeLoc)
            · contradiction
          · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
theorem capture (b : State) (t : FunctionTable) (c : Context) (names : List String) (s : Stmt)
    (body : Frame.StmtPreserves (region b) t c s) : Frame.StmtPreserves (region b) t c (.captureReturn names s) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (body n r hr)
    intro result good; cases result <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
    dsimp only
    split_ifs <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
    split
    · rename_i mid vals update wrote
      exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (namedPlain _ _ _ _ _ good wrote)
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good
end Inv39.ReadDomainEvidence
