import Inv48QuoteTransportPending
import Inv48QuoteTransportShape
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.QuoteTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem normalAppend (fuel : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (xs ys : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel table c r (xs++ys)) trace (.normal next)) :
    ∃ mid first tail, trace = first ++ tail ∧
      ExecutesOK (Stmt.evalList fuel table c r xs) first (.normal mid) ∧
      ExecutesOK (Stmt.evalList fuel table c mid ys) tail (.normal next) := by
  induction xs generalizing r trace with
  | nil =>
    refine ⟨r,[],trace,rfl,?_,run⟩
    rw [Stmt.evalList]
    exact .done _
  | cons stmt xs ih =>
    obtain ⟨mid,first,tail,eq,head,rest⟩ := normalCons fuel table c r next stmt (xs++ys) trace run
    obtain ⟨last,preTrace,suffix,eq2,body,finish⟩ := ih mid tail rest
    refine ⟨last,first++preTrace,suffix,?_,?_,finish⟩
    · simp [eq,eq2,List.append_assoc]
    · rw [Stmt.evalList]
      exact Interaction.Executes.bind_ok head body

def callPrep (r : Runtime) :=
  ((r.pushScope.declareLocal "#result0" (.word 0)).declareLocal "#result1" (.word 0))

theorem prepEval (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime) :
    Stmt.evalList (n+1) table c r.pushScope actualPrep = pure (.normal (callPrep r)) := by
  rw [checkedPrep]
  change Stmt.evalList (n+1) table c r.pushScope
    [.varDecl .uint256 "#result0" none,.varDecl .address "#result1" none] = _
  simp [Stmt.evalList,Stmt.eval,Ty.defaultValue,callPrep]
  rfl

/-- The observed runtime is the one at actual[12][2], after its two result
locals. Its full tuple comes from the callee heap, through the actual pending
writes; neither caller HasFunding nor a returned callee exit is a premise. -/
theorem recoverSite (n m : Nat) (table : FunctionTable) (c : Context)
    (out outer site : Runtime) (frame : Frame) (rest : LocalEnv)
    (id a p h e s sponsor : Nat) (suffixTrace prepTrace : Interaction.Transcript)
    (mem : out.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e s))
    (S : (declared out frame rest id).lookupLocal? "sponsor" = some (.word sponsor))
    (he : e<2^256) (hs : s<2^256)
    (suffixRun : ExecutesOK (Stmt.evalList (n+1) table c (aliased out frame rest id)
      ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal outer))
    (prepRun : ExecutesOK (Stmt.evalList (m+1) table c outer.pushScope actualPrep) prepTrace (.normal site)) :
    (∃ state, outer = ({declared out frame rest id with state := state}).declareLocal "escrow" (.word 0)) ∧
    site = callPrep outer ∧
    site.lookupLocal? "quote" = some (.memoryRef id) ∧
    site.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e s) ∧
    Inv48.WholeQuote.HasFunding site id a p := by
  rw [checkedSuffix] at suffixRun
  obtain ⟨decl,first,tail,_,declRun,restRun⟩ := normalCons (n+1) table c _ outer _ _ suffixTrace suffixRun
  change ExecutesOK (Stmt.eval (n+1) table c (aliased out frame rest id)
    (.memoryVarDecl Inv48.WholeQuote.quoteTy "quote" (some (.var hoist)))) first (.normal decl) at declRun
  rw [declareStep] at declRun
  cases declRun
  change ExecutesOK (Stmt.evalList (n+1) table c (declared out frame rest id)
    (pendingStatements ++ [.varDecl .address "escrow" none])) tail (.normal outer) at restRun
  obtain ⟨pending,pt,et,_,pendingRun,escrowRun⟩ :=
    normalAppend (n+1) table c _ outer pendingStatements [.varDecl .address "escrow" none] tail restRun
  have memory : (declared out frame rest id).loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e s) := mem
  obtain ⟨⟨state,rfl⟩,_⟩ := pendingRecovered n table c _ pending id a p h e s sponsor pt rfl memory S he hs pendingRun
  rw [Inv48.WholeQuote.singleList] at escrowRun
  simp only [Stmt.eval,Ty.defaultValue] at escrowRun
  change ExecutesOK (pure (Result.normal (({declared out frame rest id with state := state}).declareLocal "escrow" (.word 0))) : SolI Result) et (.normal outer) at escrowRun
  cases escrowRun
  rw [prepEval] at prepRun
  cases prepRun
  have pointer : (callPrep (({declared out frame rest id with state := state}).declareLocal "escrow" (.word 0))).lookupLocal? "quote" = some (.memoryRef id) := by
    simp [callPrep,declared,aliased,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  exact ⟨⟨state,rfl⟩,rfl,pointer,mem,pointer,h,e,s,mem⟩

end Inv48.QuoteTransport
