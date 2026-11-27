import Inv48FundingFallthroughCertificate
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.FundingFallthrough
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem sharedBlocks (fn : InternalFunction) (registered : request = some fn) (n : Nat) :
    Nonempty (Blocks Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value (n+3) fn.body) := by
  have h := checkedSharedPlan
  unfold sharedPlanDepth at h
  rw [registered] at h
  cases planEq : certifiedPlan sharedPath Inv48.Source.model.core.table fn.body with
  | none => simp [planEq] at h
  | some p =>
    have depth : p.depth = 3 := by simpa [planEq] using h
    exact ⟨by simpa only [depth] using p.build n⟩

/-- The successful shared body actually traverses the quote capture, with the
original transcript, context, runtime and unevaluated continuation retained. -/
theorem sharedQuote (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body) trace (.ok out))
    (nonreverted : ∀ mid err, out ≠ .reverted mid err) :
    ∃ s : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body)
        Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      s.context = {c with checked := s.context.checked} := by
  obtain ⟨b⟩ := sharedBlocks fn registered n
  have unit : (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body >>= pure) =
      Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body := Interaction.bind_pure _
  have reached := follows b c r pure trace out (by
    intro mid err rest bad
    cases bad
    exact nonreverted _ _ rfl) (by rwa [unit])
  have result := selected b.route reached
  change (∃ s : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body >>= pure)
    Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
    s.context = {c with checked := s.context.checked}) at result
  rw [unit] at result
  exact result

/-- Apply the shared successful-body theorem at either registered public
wrapper's shared invocation. No operation-loop execution is duplicated, and
no assertion is made that an arbitrary public run has entered the shared call. -/
theorem wrapperSharedQuote (name : String) (wrapper : FunctionDef)
    (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body) trace (.ok out))
    (nonreverted : ∀ mid err, out ≠ .reverted mid err) :
    callsRequest 100 wrapper.body = true ∧
    ∃ s : Site (Stmt.eval (n+3) Inv48.Source.model.core.table c r fn.body)
        Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      s.context = {c with checked := s.context.checked} := by
  have linked := List.all_eq_true.mp bothWrappersLinked name member
  rw [wrapperRegistered,Option.any_some] at linked
  exact ⟨linked,sharedQuote fn registered n c r trace out run nonreverted⟩
end Inv48.FundingFallthrough
namespace Inv48.FundingFallthrough
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- Any successful invocation of the shared request, including an invocation
reached in either public wrapper, traverses the quote. Its argument execution,
entry frame and finish continuation are all inverted from the same run. -/
theorem invocationQuote (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (c : Context) (r final : Runtime) (targets : List String) (args : List Expr)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey args)) trace (.ok (.normal final))) :
    ∃ s : Site (Stmt.eval (n+4) Inv48.Source.model.core.table c r
        (.internalCall targets Inv48.RequestQuote.requestKey args))
        Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
      s.context = {c with checked := s.context.checked} := by
  obtain ⟨b⟩ := sharedBlocks fn registered n
  have found : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn := registered
  let route := Route.call (n+3) targets Inv48.RequestQuote.requestKey args fn found b.route
  have unit : (Stmt.eval (n+4) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey args) >>= pure) =
      Stmt.eval (n+4) Inv48.Source.model.core.table c r
        (.internalCall targets Inv48.RequestQuote.requestKey args) := Interaction.bind_pure _
  have reached : Follows route c r pure trace (.normal final) true := by
    rw [show n+4=(n+3)+1 by omega,Stmt.eval] at run
    change Interaction.Executes ((Expr.evalRefArgList c r args).caught >>=
      callNext (n+3) Inv48.Source.model.core.table c r targets Inv48.RequestQuote.requestKey)
      trace (.ok (.normal final)) at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    cases v with
    | error err => simp only [callNext] at last; cases last
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      cases entered : internalCallEnter? fn values mid with
      | none => simp only [callNext,found,entered] at last; cases last
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        refine ⟨.ok (values,mid),before,after,split,first,?_⟩
        simp only [entered]
        apply follows b {c with checked := true} inner
          (fun v => internalCallFinish fn targets saved v >>= pure) after (.normal final)
        · intro q err rest bad
          simp only [internalCallFinish] at bad
          cases bad
        · have eta : (fun v => internalCallFinish fn targets saved v >>= pure) =
              internalCallFinish fn targets saved := by
            funext v
            exact Interaction.bind_pure _
          rw [eta]
          simpa only [callNext,found,entered] using last
  have result := selected route reached
  change (∃ s : Site (Stmt.eval (n+4) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey args) >>= pure)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
    s.context = {c with checked := s.context.checked}) at result
  rw [unit] at result
  exact result
end Inv48.FundingFallthrough
namespace Inv48.FundingFallthrough
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestClassify
/-- Uniform application for BOTH registered public wrappers. The premise is a
successful shared invocation; entering that invocation from a full public ABI
run is intentionally separate from this local funding-fallthrough result. -/
theorem bothPublicInvocationQuote (name : String) (wrapper : FunctionDef)
    (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (fn : InternalFunction) (registered : request = some fn) (n : Nat)
    (c : Context) (r final : Runtime) (targets : List String) (args : List Expr)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table c r
      (.internalCall targets Inv48.RequestQuote.requestKey args)) trace (.ok (.normal final))) :
    callsRequest 100 wrapper.body = true ∧
    ∃ s : Site (Stmt.eval (n+4) Inv48.Source.model.core.table c r
        (.internalCall targets Inv48.RequestQuote.requestKey args))
        Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
      s.context = {c with checked := s.context.checked} := by
  have linked := List.all_eq_true.mp bothWrappersLinked name member
  rw [wrapperRegistered,Option.any_some] at linked
  exact ⟨linked,invocationQuote fn registered n c r final targets args trace run⟩
end Inv48.FundingFallthrough
namespace Inv48.FundingFallthrough
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestClassify
/-- A literal source occurrence, without executing surrounding wrapper loops. -/
inductive Occurs (target : Stmt) : Stmt → Prop where
  | here : Occurs target target
  | block (ss : List Stmt) (child : Stmt) (mem : child ∈ ss)
      (inside : Occurs target child) : Occurs target (.block ss)
  | capture (names : List String) (body : Stmt) (inside : Occurs target body) :
      Occurs target (.captureReturn names body)
  | checked (body : Stmt) (inside : Occurs target body) : Occurs target (.checked body)
  | unchecked (body : Stmt) (inside : Occurs target body) : Occurs target (.unchecked body)
  | left (cond : Expr) (yes no : Stmt) (inside : Occurs target yes) : Occurs target (.ifElse cond yes no)
  | right (cond : Expr) (yes no : Stmt) (inside : Occurs target no) : Occurs target (.ifElse cond yes no)

theorem callExists (k : Nat) (stmt : Stmt) (hit : callsRequest k stmt = true) :
    ∃ targets args, Occurs (.internalCall targets Inv48.RequestQuote.requestKey args) stmt := by
  induction k generalizing stmt with
  | zero => cases hit
  | succ k ih =>
    cases stmt <;> simp only [callsRequest] at hit
    all_goals first | contradiction | skip
    case block ss =>
      obtain ⟨child,mem,found⟩ := List.any_eq_true.mp hit
      obtain ⟨targets,args,inside⟩ := ih child found
      exact ⟨targets,args,.block ss child mem inside⟩
    case captureReturn names body =>
      obtain ⟨targets,args,inside⟩ := ih body hit
      exact ⟨targets,args,.capture names body inside⟩
    case checked body =>
      obtain ⟨targets,args,inside⟩ := ih body hit
      exact ⟨targets,args,.checked body inside⟩
    case unchecked body =>
      obtain ⟨targets,args,inside⟩ := ih body hit
      exact ⟨targets,args,.unchecked body inside⟩
    case internalCall targets key args =>
      simp only [beq_iff_eq] at hit
      subst key
      exact ⟨targets,args,.here⟩
    case ifElse cond yes no =>
      simp only [Bool.or_eq_true] at hit
      rcases hit with h | h
      · obtain ⟨targets,args,inside⟩ := ih yes h
        exact ⟨targets,args,.left cond yes no inside⟩
      · obtain ⟨targets,args,inside⟩ := ih no h
        exact ⟨targets,args,.right cond yes no inside⟩

/-- Each wrapper has an actual shared-call occurrence whose successful
invocation necessarily traverses the quote, with its real targets and arguments.
This packages the shared result once for both public entry points. -/
theorem bothWrapperSites (name : String) (wrapper : FunctionDef)
    (member : name ∈ wrappers)
    (wrapperRegistered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (fn : InternalFunction) (registered : request = some fn) :
    ∃ targets args,
      Occurs (.internalCall targets Inv48.RequestQuote.requestKey args) wrapper.body ∧
      ∀ (n : Nat) (c : Context) (r final : Runtime) (trace : Interaction.Transcript),
        Interaction.Executes (Stmt.eval (n+4) Inv48.Source.model.core.table c r
          (.internalCall targets Inv48.RequestQuote.requestKey args)) trace (.ok (.normal final)) →
        ∃ s : Site (Stmt.eval (n+4) Inv48.Source.model.core.table c r
            (.internalCall targets Inv48.RequestQuote.requestKey args))
            Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace (.normal final),
          s.context = {c with checked := s.context.checked} := by
  have linked := List.all_eq_true.mp bothWrappersLinked name member
  rw [wrapperRegistered,Option.any_some] at linked
  obtain ⟨targets,args,inside⟩ := callExists 100 wrapper.body linked
  exact ⟨targets,args,inside,fun n c r final trace run =>
    invocationQuote fn registered n c r final targets args trace run⟩
end Inv48.FundingFallthrough
