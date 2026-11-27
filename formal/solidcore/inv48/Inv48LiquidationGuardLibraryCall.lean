import Inv48LiquidationGuardPassage
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def executionLibraryKey := "__internal___library_OraclePriceMath_liquidationPrice(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def libraryRet := "_ret___library_OraclePriceMath_liquidationPrice_0"
def libraryArgs : List Expr := [.var "_ic_arg_0",.var "_ic_arg_1"]
def libraryCall : Stmt := .internalCall [libraryRet] executionLibraryKey libraryArgs
def hoistArgs : List Stmt := match guardPrefix with
  | [_,.block ss] => ss.take 3
  | _ => []
def hoistCopy : List Stmt := [.assign (.var "_sol_hoist_0") (.var libraryRet)]
def hoistCode : Stmt := .block (hoistArgs ++ [.captureReturn [libraryRet] libraryCall] ++ hoistCopy)
theorem prefixForm : guardPrefix = [.varDecl .uint256 "_sol_hoist_0" none,hoistCode] := by rfl

structure LibraryEntered (fuel : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) where
  n : Nat
  fn : InternalFunction
  values : List Value
  mid : Runtime
  inner : Runtime
  saved : LocalEnv
  result : Result
  argsTrace : Interaction.Transcript
  bodyTrace : Interaction.Transcript
  finishTrace : Interaction.Transcript
  fuelEq : fuel = n+1
  found : Inv48.Source.model.core.table.lookup? executionLibraryKey = some fn
  entered : internalCallEnter? fn values mid = some (inner,saved)
  split : tr = argsTrace ++ (bodyTrace ++ finishTrace)
  argsRun : Interaction.Executes (Expr.evalRefArgList c r libraryArgs).caught
    argsTrace (.ok (.ok (values,mid)))
  bodyRun : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true} inner fn.body)
    bodyTrace (.ok result)
  finishRun : Interaction.Executes (internalCallFinish fn [libraryRet] saved result)
    finishTrace (.ok (.normal final))

theorem enterLibrary (fuel : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r libraryCall)
      tr (.ok (.normal final))) : Nonempty (LibraryEntered fuel c r final tr) := by
  cases fuel with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    obtain ⟨args,argt,rest,sp,first,last⟩ := bindSuccess _ _ _ _ run
    cases args with
    | error err => cases last
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      dsimp only at last
      cases found : Inv48.Source.model.core.table.lookup? executionLibraryKey with
      | none => simp only [found] at last; cases last
      | some fn =>
        cases entered : internalCallEnter? fn values mid with
        | none => simp only [found,entered] at last; cases last
        | some pair =>
          obtain ⟨inner,saved⟩ := pair
          simp only [found,entered] at last
          change Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true} inner fn.body >>=
            internalCallFinish fn [libraryRet] saved) rest (.ok (.normal final)) at last
          obtain ⟨value,bt,ft,sp2,body,finish⟩ := bindSuccess _ _ _ _ last
          exact ⟨⟨n,fn,values,mid,inner,saved,value,argt,bt,ft,rfl,found,entered,by rw [sp,sp2],first,body,finish⟩⟩

private theorem capture (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.captureReturn [libraryRet] libraryCall)) tr (.ok (.normal final))) :
    Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r libraryCall)
      tr (.ok (.normal final)) := by
  rw [Stmt.eval] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  have never := neverSound 1 libraryCall rfl n Inv48.Source.model.core.table c r
  cases v with
  | normal mid =>
    cases last
    simp only [List.append_nil] at split
    subst tr
    exact first
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last

structure HoistPath (n : Nat) (c : Context) (r final : Runtime) (tr : Interaction.Transcript) where
  declared : Runtime
  caller : Runtime
  callFinal : Runtime
  copied : Runtime
  declareTrace : Interaction.Transcript
  argsTrace : Interaction.Transcript
  callTrace : Interaction.Transcript
  copyTrace : Interaction.Transcript
  split : tr = declareTrace ++ (argsTrace ++ (callTrace ++ copyTrace))
  declareRun : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
    (.varDecl .uint256 "_sol_hoist_0" none)) declareTrace (.ok (.normal declared))
  argsRun : Interaction.Executes (Stmt.evalList (n+1) Inv48.Source.model.core.table c declared.pushScope hoistArgs)
    argsTrace (.ok (.normal caller))
  callRun : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c caller libraryCall)
    callTrace (.ok (.normal callFinal))
  copyRun : Interaction.Executes (Stmt.evalList (n+1) Inv48.Source.model.core.table c callFinal hoistCopy)
    copyTrace (.ok (.normal copied))
  frame : final = copied.popScope

theorem hoistPath (s : GuardPassage n c r final tr) :
    Nonempty (HoistPath n c r.pushScope s.computed s.prefixTrace) := by
  have run := s.prefixRun
  rw [prefixForm] at run
  obtain ⟨declared,dt,ht,sp,decl,hoisted⟩ := listPrefix _ _ _ _
    [.varDecl .uint256 "_sol_hoist_0" none] [hoistCode] _ _ (by decide) (by simp [Escapes]) run
  have decl := singleton _ _ _ _ _ _ _ decl
  have hoisted := singleton _ _ _ _ _ _ _ hoisted
  obtain ⟨k,v,eq,computedEq,list⟩ := block _ _ _ _ _ _ _ hoisted
  have kEq : k = n+1 := by omega
  subst k
  cases v <;> simp only [Result.mapRuntime] at computedEq
  all_goals try contradiction
  case normal copied =>
    have frame := Result.normal.inj computedEq
    obtain ⟨caller,at_,rest,sp2,args,run⟩ := listPrefix _ _ _ _ hoistArgs
      ([.captureReturn [libraryRet] libraryCall] ++ hoistCopy) _ _ (by decide) (by simp [Escapes]) list
    obtain ⟨callFinal,ct,xt,sp3,call,copy⟩ := listPrefix _ _ _ _
      [.captureReturn [libraryRet] libraryCall] hoistCopy _ _ (by decide) (by simp [Escapes]) run
    have call := singleton _ _ _ _ _ _ _ call
    have call := capture n c caller callFinal ct call
    exact ⟨⟨declared,caller,callFinal,copied,dt,at_,ct,xt,by rw [sp,sp2,sp3],decl,args,call,copy,frame⟩⟩

/-- The entered library body and its argument evaluation belong to the same
successful getter run as the guard and funding tail. -/
theorem sameLibraryExecution (path : GetterPath n c r tr out) :
    ∃ guard : GuardPassage n c path.positive path.guarded path.guardTrace,
      ∃ hoist : HoistPath n c path.positive.pushScope guard.computed guard.prefixTrace,
        Nonempty (LibraryEntered n c hoist.caller hoist.callFinal hoist.callTrace) := by
  obtain ⟨guard⟩ := sameExecution path
  obtain ⟨hoist⟩ := hoistPath guard
  exact ⟨guard,hoist,enterLibrary n c hoist.caller hoist.callFinal hoist.callTrace hoist.callRun⟩
theorem enteredFrame (s : LibraryEntered fuel c r final tr) :
    ∃ frame, s.fn.initialFrame? s.values = some frame ∧
      s.inner = {s.mid with locals := [frame]} ∧ s.saved = s.mid.locals := by
  have entered := s.entered
  unfold internalCallEnter? at entered
  cases framed : s.fn.initialFrame? s.values with
  | none => rw [framed] at entered; cases entered
  | some frame =>
    rw [framed] at entered
    have eq := Option.some.inj entered
    exact ⟨frame,rfl,(congrArg Prod.fst eq).symm,(congrArg Prod.snd eq).symm⟩

theorem finishOrdinary (fn : InternalFunction) (targets : List String) (saved : LocalEnv)
    (result : Result) (trace : Interaction.Transcript) (final : Runtime)
    (run : Interaction.Executes (internalCallFinish fn targets saved result) trace (.ok (.normal final))) :
    ¬ Escapes result := by
  cases result <;> simp [Escapes]
  all_goals simp only [internalCallFinish] at run; cases run

theorem libraryOrdinary (s : LibraryEntered fuel c r final tr) : ¬ Escapes s.result :=
  finishOrdinary s.fn [libraryRet] s.saved s.result s.finishTrace final s.finishRun
#print axioms enteredFrame
#print axioms libraryOrdinary
#print axioms enterLibrary
#print axioms hoistPath
#print axioms sameLibraryExecution
end GuardRecovery
