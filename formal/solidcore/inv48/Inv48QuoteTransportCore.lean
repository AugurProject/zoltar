import Inv48RequestQuoteReturn
import Inv48WholeQuoteGenerated
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.QuoteTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def ret := "_ret__quoteReportFunding_0"
def hoist := "_sol_hoist_0"
def argsFrame (p a bounty : Nat) : Frame :=
  [("_ic_arg_2",.word bounty),("_ic_arg_1",.word a),("_ic_arg_0",.word p)]
def saved (frame : Frame) (rest : LocalEnv) (p a bounty old hoisted : Nat) : LocalEnv :=
  ((ret,.memoryRef old) :: argsFrame p a bounty) :: ((hoist,.memoryRef hoisted)::frame) :: rest

def captured (out : Runtime) (frame : Frame) (rest : LocalEnv) (p a bounty id hoisted : Nat) :=
  {out with locals := saved frame rest p a bounty id hoisted}
def aliased (out : Runtime) (frame : Frame) (rest : LocalEnv) (id : Nat) :=
  {out with locals := ((hoist,.memoryRef id)::frame)::rest}
def declared (out : Runtime) (frame : Frame) (rest : LocalEnv) (id : Nat) :=
  (aliased out frame rest id).declareLocal "quote" (.memoryRef id)

theorem assignCaptured (out : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted id : Nat) :
    internalCallAssign {out with locals := saved frame rest p a bounty old hoisted}
      [ret] [.memoryRef id] = pure (.normal (captured out frame rest p a bounty id hoisted)) := by
  simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,LocalEnv.lookup?,
    Frame.lookup?,LocalEnv.assign?,Frame.assign?,saved,captured,ret]

theorem normalCapture (n : Nat) (table : FunctionTable) (c : Context)
    (caller callee out : Runtime) (fn : InternalFunction) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted id : Nat) (trace : Interaction.Transcript)
    (arguments : Expr.evalRefArgList c caller [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],caller))
    (lookup : table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (enter : internalCallEnter? fn [.word p,.word a,.word bounty] caller =
      some (callee,saved frame rest p a bounty old hoisted))
    (run : ExecutesOK (Stmt.eval n table {c with checked := true} callee fn.body) trace (.normal out))
    (epilogue : internalCallFinish fn [ret] (saved frame rest p a bounty old hoisted) (.normal out) =
      internalCallAssign {out with locals := saved frame rest p a bounty old hoisted} [ret] [.memoryRef id]) :
    ExecutesOK (Stmt.eval (n+2) table c caller
      (.captureReturn [ret] (.internalCall [ret] Inv48.QuoteMemory.quoteKey
        [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"]))) trace
      (.normal (captured out frame rest p a bounty id hoisted)) := by
  apply Inv48.RequestQuote.captureNormal
  have eq : Stmt.eval (n+1) table c caller
      (.internalCall [ret] Inv48.QuoteMemory.quoteKey [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"]) =
      (Stmt.eval n table {c with checked := true} callee fn.body >>=
        internalCallFinish fn [ret] (saved frame rest p a bounty old hoisted)) := by
    rw [Stmt.eval]
    dsimp only
    rw [arguments]
    change (match table.lookup? Inv48.QuoteMemory.quoteKey with
      | none => pure (Result.reverted caller RevertData.typeMismatch)
      | some f => match internalCallEnter? f [.word p,.word a,.word bounty] caller with
        | none => pure (Result.reverted caller RevertData.typeMismatch)
        | some (i,s) => Stmt.eval n table {c with checked := true} i f.body >>= internalCallFinish f [ret] s) = _
    simp only [lookup,enter]
  rw [eq]
  have finish : ExecutesOK (internalCallFinish fn [ret] (saved frame rest p a bounty old hoisted) (.normal out)) []
      (.normal (captured out frame rest p a bounty id hoisted)) := by
    rw [epilogue,assignCaptured]
    exact .done _
  simpa only [List.append_nil] using Interaction.Executes.bind_ok run finish

theorem aliasStep (n : Nat) (table : FunctionTable) (c : Context) (out : Runtime)
    (frame : Frame) (rest : LocalEnv) (p a bounty id hoisted : Nat) :
    Stmt.eval (n+1) table c (captured out frame rest p a bounty id hoisted)
      (.assign (.var hoist) (.var ret)) =
      pure (.normal {out with locals := saved frame rest p a bounty id id}) := by
  apply Inv48.RequestQuote.hoistAlias (old := hoisted) (id := id)
  · simp [captured,saved,ret,hoist,argsFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  · rfl
  · simp [captured,saved,ret,hoist,argsFrame,Runtime.assignLocalRaw?,LocalEnv.assign?,Frame.assign?]

theorem declareStep (n : Nat) (table : FunctionTable) (c : Context) (out : Runtime)
    (frame : Frame) (rest : LocalEnv) (id : Nat) :
    Stmt.eval (n+1) table c (aliased out frame rest id)
      (.memoryVarDecl Inv48.WholeQuote.quoteTy "quote" (some (.var hoist))) =
      pure (.normal (declared out frame rest id)) := by
  apply Inv48.RequestQuote.quoteAlias
  rfl

theorem declaredFunding (base oracle : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a h v minimum fee : Nat) :
    let out := (Inv48.WholeQuote.finalState oracle base.nextMemory a p h v minimum fee).popScope.popScope
    Inv48.WholeQuote.HasFunding (declared out frame rest base.nextMemory) base.nextMemory a p := by
  refine ⟨?_,max h v,(a-minimum)*100,fee,?_⟩
  · rfl
  · exact Inv48.WholeQuote.returnMemory oracle base.nextMemory a p h v minimum fee

/-- Successful storage writes preserve the complete caller frame and heap.
The state is recovered from the actual store, without a desired-write premise. -/
theorem storeFrame (c : Context) (r next : Runtime) (name : String) (value : Value)
    (success : r.storeStorageField c name value = .ok next) :
    ∃ state, next = {r with state := state} := by
  unfold Runtime.storeStorageField at success
  cases hf : c.storageField? name with
  | none => simp [hf,Bind.bind,Except.bind] at success
  | some field =>
    simp only [hf,Bind.bind,Except.bind] at success
    cases hv : r.storageMaterializedValue value with
    | error err => simp [hv] at success
    | ok material =>
      simp only [hv] at success
      cases hl : field.layout? with
      | none =>
        simp only [hl] at success
        split at success <;> simp_all
        exact ⟨_,success.symm⟩
      | some layout =>
        cases layout <;> simp only [hl] at success
        all_goals repeat' (split at success <;> simp_all)
        all_goals try simp_all [Bind.bind,Except.bind]
        all_goals exact ⟨_,success.symm⟩

end Inv48.QuoteTransport
