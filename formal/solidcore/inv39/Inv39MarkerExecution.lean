import Inv39MarkerPublicEntry
import Inv39DecimalBound
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker

/-- Invert an actual successful interaction bind, retaining both executions. -/
theorem bindExecution {α β : Type} (step : SolI α) (next : α → SolI β) (out : β)
    (run : (step >>= next).runWith [] = .ok out) :
    ∃ mid, step.runWith [] = .ok mid ∧ (next mid).runWith [] = .ok out := by
  rw [Fold.bindRun] at run
  cases h : step.runWith [] with
  | error err => simp [h,Bind.bind,Except.bind] at run
  | ok mid => exact ⟨mid,rfl,by simpa [h,Bind.bind,Except.bind] using run⟩

/-- Scope exit is inverted rather than treated as a storage-preservation premise. -/
theorem blockExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ss : List Source.Stmt) (out : Result)
    (run : (Stmt.eval (n+1) t c r (.block ss)).runWith [] = .ok out) :
    ∃ inner, (Stmt.evalList n t c r.pushScope ss).runWith [] = .ok inner ∧
      out = inner.mapRuntime Runtime.popScope := by
  rw [Stmt.eval] at run
  obtain ⟨inner,inside,finish⟩ := bindExecution _ _ _ run
  exact ⟨inner,inside,(Except.ok.inj finish).symm⟩

/-- The next statement really executes after a normal predecessor. -/
theorem listExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : Source.Stmt) (ss : List Source.Stmt) (out : Result)
    (run : (Stmt.evalList n t c r (s::ss)).runWith [] = .ok out) :
    ∃ head, (Stmt.eval n t c r s).runWith [] = .ok head ∧
      (match head with
      | .normal mid => (Stmt.evalList n t c mid ss).runWith [] = .ok out
      | other => out = other) := by
  rw [Stmt.evalList] at run
  obtain ⟨head,first,rest⟩ := bindExecution _ _ _ run
  refine ⟨head,first,?_⟩
  cases head <;> first | exact rest | exact (Except.ok.inj rest).symm

/-- Inverting the generated empty capture retains the original body result. -/
theorem captureExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : Source.Stmt) (out : Result)
    (run : (Stmt.eval (n+1) t c r (.captureReturn [] s)).runWith [] = .ok out) :
    ∃ inner, (Stmt.eval n t c r s).runWith [] = .ok inner ∧
      out = (match inner with | .returned mid _ => .normal mid | other => other) := by
  rw [Stmt.eval] at run
  obtain ⟨inner,inside,finish⟩ := bindExecution _ _ _ run
  refine ⟨inner,inside,?_⟩
  cases inner <;> simp only [List.isEmpty_nil, Bool.or_true, ↓reduceIte] at finish <;> exact (Except.ok.inj finish).symm

/-- Successful public dispatch enters the actual outer block's statement list.
The final ABI result remains linked to the result after scope restoration. -/
theorem initializerListEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    let r := (CheckedWordCall.initial c s).withFrame [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]
    ∃ f a b d e suffix inner,
      model.core.findFunctionByName? "initialize"=some f ∧
      (Stmt.evalList 49999 model.core.table c r.pushScope
        [Repeat.cleanup 248 "universeId_",Repeat.cleanup 256 "totalTheoreticalSupplyAttoRep_",
         Repeat.cleanup 256 "repNumber_",.block [.block [authorityGuard,
           .captureReturn [] (.block (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix))]]]).runWith []=.ok inner ∧
      f.callBodyResult s (inner.mapRuntime Runtime.popScope)=.returned post out := by
  intro c r
  obtain ⟨f,a,b,d,e,suffix,res,found,body,abi⟩ := initializerEntry s post sender self uid cap rep out run
  obtain ⟨inner,inside,eq⟩ := blockExecution 49999 model.core.table c r _ res body
  exact ⟨f,a,b,d,e,suffix,inner,found,inside,eq ▸ abi⟩
/-- ABI packaging may change constructor output, but cannot change storage.
This connects the actual internal result to the actual returned public State. -/
theorem abiStorage (f : FunctionDef) (before post : State) (res : Result)
    (out : List Source.Value) (abi : f.callBodyResult before res = .returned post out) :
    post.storage = res.runtime.state.storage := by
  cases res <;> simp only [FunctionDef.callBodyResult] at abi
  all_goals (repeat' first | contradiction | split at abi | (cases abi; rfl))

/-- Public call success excludes every reverting body result, independently of
what the body does or which storage is present. -/
theorem abiNotReverted (f : FunctionDef) (before post : State) (res : Result)
    (out : List Source.Value) (abi : f.callBodyResult before res = .returned post out) :
    ∀ r err, res ≠ .reverted r err := by
  intro r err eq
  subst res
  cases abi

/-- Public success alone supplies the actual list execution, final storage
identity and exclusion of reverting executions; no Reachability is consumed. -/
theorem initializerStorageEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    let r := (CheckedWordCall.initial c s).withFrame [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]
    ∃ a b d e suffix inner,
      (Stmt.evalList 49999 model.core.table c r.pushScope
        [Repeat.cleanup 248 "universeId_",Repeat.cleanup 256 "totalTheoreticalSupplyAttoRep_",
         Repeat.cleanup 256 "repNumber_",.block [.block [authorityGuard,
           .captureReturn [] (.block (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix))]]]).runWith []=.ok inner ∧
      post.storage=inner.runtime.state.storage ∧
      (∀ q err, inner ≠ .reverted q err) := by
  intro c r
  obtain ⟨f,a,b,d,e,suffix,inner,found,inside,abi⟩ := initializerListEntry s post sender self uid cap rep out run
  refine ⟨a,b,d,e,suffix,inner,inside,?_,?_⟩
  · have storage := abiStorage f s post (inner.mapRuntime Runtime.popScope) out abi
    cases inner <;> exact storage
  · intro q err eq
    subst inner
    exact abiNotReverted f s post _ out abi q.popScope err rfl

/-- A guarded prefix of a non-reverting list must have completed normally. -/
theorem normalListHead (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (stmt : Source.Stmt) (tail : List Source.Stmt) (out : Result)
    (safe : Auth.safeEnv r.locals) (active : r.locals≠[])
    (guarded : Auth.guards false (fun _ => false) t c stmt)
    (run : (Stmt.evalList n t c r (stmt::tail)).runWith []=.ok out)
    (nonrev : ∀ q err, out ≠ .reverted q err) :
    ∃ mid, (Stmt.eval n t c r stmt).runWith []=.ok (.normal mid) ∧
      (Stmt.evalList n t c mid tail).runWith []=.ok out ∧
      Auth.safeEnv mid.locals ∧ mid.locals≠[] := by
  obtain ⟨head,first,rest⟩ := listExecution n t c r stmt tail out run
  have good := guarded n r safe active
  unfold Fold.Ensures at good
  have shape := good head first
  cases head with
  | normal mid => exact ⟨mid,first,rest,shape.safe,Auth.active shape active⟩
  | reverted q err => exact False.elim (nonrev q err rest)
  | returned q vals => exact False.elim (Bool.noConfusion shape.1)
  | _ => contradiction

/-- All three generated cleanup assignments are actually reached and complete
normally when the public call succeeds. No argument range is assumed. -/
theorem initializerCleanupEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    let r := ((CheckedWordCall.initial c s).withFrame [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]).pushScope
    ∃ a b d e suffix one two three inner,
      (Stmt.eval 49999 model.core.table c r (Repeat.cleanup 248 "universeId_")).runWith []=.ok (.normal one) ∧
      (Stmt.eval 49999 model.core.table c one (Repeat.cleanup 256 "totalTheoreticalSupplyAttoRep_")).runWith []=.ok (.normal two) ∧
      (Stmt.eval 49999 model.core.table c two (Repeat.cleanup 256 "repNumber_")).runWith []=.ok (.normal three) ∧
      (Stmt.evalList 49999 model.core.table c three
        [.block [.block [authorityGuard,.captureReturn []
          (.block (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix))]]]).runWith []=.ok inner ∧
      post.storage=inner.runtime.state.storage ∧
      (∀ q err, inner ≠ .reverted q err) ∧ Auth.safeEnv three.locals ∧ three.locals≠[] := by
  intro c r
  obtain ⟨a,b,d,e,suffix,inner,inside,storage,nonrev⟩ := initializerStorageEntry s post sender self uid cap rep out run
  have safe : Auth.safeEnv r.locals := by
    intro f hf p hp
    simp only [r,Runtime.pushScope,Runtime.withFrame,CheckedWordCall.initial,
      List.mem_cons,List.not_mem_nil,or_false] at hf
    rcases hf with rfl | rfl
    · simp at hp
    · simp only [List.mem_cons,List.not_mem_nil,or_false] at hp
      rcases hp with rfl|rfl|rfl <;> exact Or.inr trivial
  have active : r.locals≠[] := by simp [r,Runtime.pushScope]
  have guard (bits : Nat) (name : String) (ordinary : Auth.ordinary name=true) :
      Auth.guards false (fun _ => false) model.core.table c (Repeat.cleanup bits name) := by
    apply Auth.simpleSound
    simp [Repeat.cleanup,Auth.simple,Auth.writable,ordinary,Auth.pureExpr]
  obtain ⟨one,first,rest,safe1,active1⟩ := normalListHead _ _ _ r _ _ inner safe active (guard 248 _ (by decide)) inside nonrev
  obtain ⟨two,second,rest,safe2,active2⟩ := normalListHead _ _ _ one _ _ inner safe1 active1 (guard 256 _ (by decide)) rest nonrev
  obtain ⟨three,third,rest,safe3,active3⟩ := normalListHead _ _ _ two _ _ inner safe2 active2 (guard 256 _ (by decide)) rest nonrev
  exact ⟨a,b,d,e,suffix,one,two,three,inner,first,second,third,rest,storage,nonrev,safe3,active3⟩

theorem singletonExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : Source.Stmt) (out : Result)
    (run : (Stmt.evalList n t c r [s]).runWith []=.ok out) :
    (Stmt.eval n t c r s).runWith []=.ok out := by
  obtain ⟨head,first,rest⟩ := listExecution n t c r s [] out run
  cases head with
  | normal mid =>
    have eq : out=.normal mid := by
      have same := Fold.pureValue (Result.normal mid) (fun x => x=Result.normal mid) rfl
      unfold Fold.Ensures at same
      simp only [Stmt.evalList] at rest
      exact same out rest
    rw [eq]
    exact first
  | _ => exact rest ▸ first

theorem popStorage (res : Result) :
    (res.mapRuntime Runtime.popScope).runtime.state.storage=res.runtime.state.storage := by
  cases res <;> rfl

theorem popNotReverted (res : Result)
    (h : ∀ q err, res.mapRuntime Runtime.popScope ≠ .reverted q err) :
    ∀ q err, res ≠ .reverted q err := by
  intro q err eq
  subst res
  exact h q.popScope err rfl

/-- Successful public execution reaches the authority guard inside both grouping
blocks. Both original scopes, the guard's execution and the subsequent capture
are extracted from the execution, rather than supplied by Reachability. -/
theorem initializerModifierEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    ∃ a b d e suffix, ∃ (three authorized : Runtime) (captured : Result),
      (Stmt.eval 49997 model.core.table c three.pushScope.pushScope authorityGuard).runWith []=.ok (.normal authorized) ∧
      (Stmt.eval 49997 model.core.table c authorized
        (.captureReturn [] (.block (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix)))).runWith []=.ok captured ∧
      post.storage=captured.runtime.state.storage ∧
      (∀ q err, captured ≠ .reverted q err) := by
  intro c
  obtain ⟨a,b,d,e,suffix,one,two,three,outer,first,second,third,rest,storage,nonrev,safe,active⟩ :=
    initializerCleanupEntry s post sender self uid cap rep out run
  have groupRun := singletonExecution _ _ _ _ _ _ rest
  obtain ⟨group,groupRun,outerEq⟩ := blockExecution 49998 _ _ _ _ _ groupRun
  have groupNR : ∀ q err, group ≠ .reverted q err := popNotReverted group (outerEq ▸ nonrev)
  have groupStore : post.storage=group.runtime.state.storage := storage.trans (outerEq ▸ popStorage group)
  have modifierRun := singletonExecution _ _ _ _ _ _ groupRun
  obtain ⟨modifier,modifierRun,groupEq⟩ := blockExecution 49997 _ _ _ _ _ modifierRun
  have modifierNR : ∀ q err, modifier ≠ .reverted q err := popNotReverted modifier (groupEq ▸ groupNR)
  have modifierStore : post.storage=modifier.runtime.state.storage := groupStore.trans (groupEq ▸ popStorage modifier)
  have safe' : Auth.safeEnv three.pushScope.pushScope.locals :=
    Auth.safeCons _ _ (Auth.safeCons _ _ safe (by simp)) (by simp)
  have active' : three.pushScope.pushScope.locals≠[] := by simp [Runtime.pushScope]
  have guarded : Auth.guards false (fun _ => false) model.core.table c authorityGuard :=
    Auth.requires (Frame.numeric _ _ _ (by intro h; cases h) (by intro h; cases h) Frame.caller (Frame.immutableRead _))
  obtain ⟨authorized,guardRun,captureRun,_,_⟩ := normalListHead _ _ _ _ _ _ _ safe' active' guarded modifierRun modifierNR
  exact ⟨a,b,d,e,suffix,three,authorized,modifier,guardRun,
    singletonExecution _ _ _ _ _ _ captureRun,modifierStore,modifierNR⟩

/-- The generated empty modifier capture and inner scope are traversed. This is
an actual execution of the list beginning with the existing-marker guard. -/
theorem initializerInnerEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    ∃ a b d e suffix, ∃ (authorized : Runtime) (inner : Result),
      (Stmt.evalList 49995 model.core.table c authorized.pushScope
        (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix)).runWith []=.ok inner ∧
      post.storage=inner.runtime.state.storage ∧
      (∀ q err, inner ≠ .reverted q err) := by
  intro c
  obtain ⟨a,b,d,e,suffix,three,authorized,captured,guardRun,captureRun,storage,nonrev⟩ :=
    initializerModifierEntry s post sender self uid cap rep out run
  obtain ⟨body,bodyRun,captureEq⟩ := captureExecution 49996 _ _ _ _ _ captureRun
  have bodyStore : post.storage=body.runtime.state.storage := by
    cases body <;> simpa only [captureEq,Result.runtime] using storage
  have bodyNR : ∀ q err, body ≠ .reverted q err := by
    intro q err eq
    subst body
    exact nonrev q err captureEq
  obtain ⟨inner,innerRun,bodyEq⟩ := blockExecution 49995 _ _ _ _ _ bodyRun
  exact ⟨a,b,d,e,suffix,authorized,inner,innerRun,
    bodyStore.trans (bodyEq ▸ popStorage inner),popNotReverted inner (bodyEq ▸ bodyNR)⟩

end Inv39.Init.Marker
