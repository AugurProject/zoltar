import Inv48MinimumFullTraceEvents
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.WholeQuote Inv48.WrapperTraversal Inv48.QuoteMinimumEvents
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- The quote-to-getter chain, retaining the actual body and finish without
recovering any independent helper sites. -/
structure QuoteRecovery (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (trace : Interaction.Transcript) (out : Result) where
  minimumFinal : Runtime
  minimumTrace : Interaction.Transcript
  quoteAfter : Interaction.Transcript
  quoteSplit : trace = minimumTrace ++ quoteAfter
  minimumRun : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c
    (prepared physical p a bounty) minP.value) minimumTrace (.ok (.normal minimumFinal))
  site : Inv48.RequestClassify.Site
    (Stmt.eval (n+3) Inv48.Source.model.core.table c (prepared physical p a bounty) minP.value)
    Inv48.Source.model.core.table minimumCall minimumTrace (.normal minimumFinal)
  callFinal : Runtime
  callTrace : Interaction.Transcript
  minimumAfter : Interaction.Transcript
  minimumSplit : site.after = callTrace ++ minimumAfter
  callRun : Interaction.Executes (Stmt.eval site.fuel Inv48.Source.model.core.table
    site.context site.runtime minimumCall) callTrace (.ok (.normal callFinal))
  bodyFuel : Nat
  fn : InternalFunction
  values : List Value
  argFinal : Runtime
  inner : Runtime
  saved : LocalEnv
  value : Result
  argsTrace : Interaction.Transcript
  bodyTrace : Interaction.Transcript
  finishTrace : Interaction.Transcript
  fuelEq : site.fuel = bodyFuel+1
  found : Inv48.Source.model.core.table.lookup? Inv48.QuoteMinimumJoin.key = some fn
  bodyEq : fn.body = Inv48.Public.body
  entry : internalCallEnter? fn values argFinal = some (inner,saved)
  callSplit : callTrace = argsTrace ++ (bodyTrace ++ finishTrace)
  argsRun : Interaction.Executes (Expr.evalRefArgList site.context site.runtime
    [.var Inv32OneArg.argName]).caught argsTrace (.ok (.ok (values,argFinal)))
  bodyRun : Interaction.Executes (Stmt.eval bodyFuel Inv48.Source.model.core.table
    {site.context with checked := true} inner Inv48.Public.body) bodyTrace (.ok value)
  finishRun : Interaction.Executes (internalCallFinish fn [Inv48.QuoteMinimumJoin.ret] saved value)
    finishTrace (.ok (.normal callFinal))
  ordinary : ¬ Escapes value

theorem quoteRecovery (n : Nat) (c : Context) (physical : Runtime) (p a bounty : Nat)
    (hp : p < Inv32Division.R) (ha : a < Inv32Division.R) (hb : bounty < Inv32Division.R)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c
      (entry physical p a bounty) bodyP.value) trace (.ok out)) :
    Nonempty (QuoteRecovery n c physical p a bounty trace out) := by
  obtain ⟨mid,mt,after,sp,minimum,q,final,ct,rest,qsp,call,_⟩ :=
    quoteMinimumStage n c physical p a bounty hp ha hb trace out ordinary run
  obtain ⟨k,fn,values,argFinal,inner,saved,value,at_,bt,ft,eq,found,body,entered,sp2,args,exec,finish,ord⟩ :=
    minimumEntered q.fuel q.context q.runtime final ct call
  exact ⟨⟨mid,mt,after,sp,minimum,q,final,ct,rest,qsp,call,k,fn,values,argFinal,inner,saved,
    value,at_,bt,ft,eq,found,body,entered,sp2,args,exec,finish,ord⟩⟩
end Inv48.MinimumFullTrace
