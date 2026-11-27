import Inv48RequestPrologueTransport
import Inv48RequestClassifyPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowPrefix Inv48.QuoteTransport Inv48.RequestDispatch
namespace Inv48.FundingContinuation
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Invert the actual evaluated list, retaining every transcript segment.
No successful pending store, preparation or request call is a premise. -/
theorem downstream (n : Nat) (table : FunctionTable) (c : Context)
    (start final : Runtime) (tail : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+2) table c start
      (((Inv48.RequestQuote.actual.drop 7).take 5) ++
        [.block (actualPrep ++ tail)])) trace (.normal final)) :
    ∃ pending site last suffixTrace prepTrace restTrace,
      trace = suffixTrace ++ prepTrace ++ restTrace ∧
      ExecutesOK (Stmt.evalList (n+2) table c start
        ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal pending) ∧
      ExecutesOK (Stmt.evalList (n+1) table c pending.pushScope actualPrep)
        prepTrace (.normal site) ∧
      ExecutesOK (Stmt.evalList (n+1) table c site tail) restTrace (.normal last) ∧
      last.popScope = final := by
  obtain ⟨pending,st,bt,split,suffix,blockRun⟩ :=
    normalAppend (n+2) table c start final _ _ trace run
  rw [Inv48.WholeQuote.singleList,Stmt.eval] at blockRun
  change Interaction.Executes
    (Stmt.evalList (n+1) table c pending.pushScope (actualPrep ++ tail) >>=
      fun v => pure (v.mapRuntime Runtime.popScope)) bt (.ok (.normal final)) at blockRun
  obtain ⟨result,body,popRun⟩ := terminal _
    (fun v : Result => .ok (v.mapRuntime Runtime.popScope)) bt (Result.normal final) blockRun
  cases result with
  | normal last =>
    have eq : last.popScope = final := by cases popRun; rfl
    obtain ⟨site,pt,rt,split2,prep,rest⟩ := normalAppend (n+1) table c _ last _ _ bt body
    exact ⟨pending,site,last,st,pt,rt,by simp [split,split2,List.append_assoc],suffix,prep,rest,eq⟩
  | returned r vs => cases popRun
  | constructorReturned r code => cases popRun
  | selfdestructed r => cases popRun
  | reverted r err => cases popRun
  | broke r => cases popRun
  | continued r => cases popRun

/-- Quote-site classification is reused, without redoing prefix fallthrough. -/
theorem classifiedCapture (table : FunctionTable) (fuel : Nat) (stmt : Stmt)
    (route : Inv48.RequestClassify.Route table Inv48.RequestQuote.quoteCaptureP.value fuel stmt)
    (c : Context) (r : Runtime) (k : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (reached : Inv48.RequestClassify.Follows route c r k trace out true) :
    ∃ site : Inv48.RequestClassify.Site (Stmt.eval fuel table c r stmt >>= k)
      table Inv48.RequestQuote.quoteCaptureP.value trace out,
      site.context = {c with checked := site.context.checked} :=
  Inv48.RequestClassify.selected route reached

#print axioms downstream
#print axioms classifiedCapture
end Inv48.FundingContinuation
