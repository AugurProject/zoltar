import Inv48FundingMathTailReturn
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.FundingMathTail
open Inv48.QuoteMemory Inv48.CloneGetters Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 7000000
set_option linter.unusedSimpArgs false

/-- The two enclosing quote scopes are discharged structurally. The pointer
must belong to the surviving funding-entry frame, as it does after localization. -/
theorem poppedKeeps (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a b multiplier e s minimum fee : Nat)
    (oracle : OracleInputs c (halted r id a b multiplier e s) rows)
    (first second : SolidCore.Solidity.Source.Frame) (rest : LocalEnv)
    (shape : r.locals = first::second::rest)
    (ref : rest.lookup? "quote" = some (.memoryRef id))
    (fields : Inv48.QuoteFundingFields.Fields
      (finalState (oracleOut oracle) id a b (a*multiplier/10000) e s
        (Inv03.ceilQuot oracle.exposure 100) minimum fee) id a b) :
    let final := finalState (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum fee
    Inv48.QuoteTailPreserve.Keeps final.popScope.popScope id a b := by
  dsimp only
  refine ⟨?_,Inv48.QuoteFundingFields.sameHeap _ _ id a b fields rfl⟩
  simp only [finalState,exposed,maximum]
  split <;>
    simpa [oracleOut,aggregateOut,Inv48.ExposureHeap.continued,Inv48.ExposureHeap.caller,
      halted,put,Inv32OneArg.store,Runtime.declareLocal,Runtime.popScope,LocalEnv.declare,
      Runtime.lookupLocal?,shape] using ref

/-- Exact named-return capture after both actual enclosing scope exits. -/
theorem poppedNamed (fn : InternalFunction) (final : Runtime)
    (callerFrame : SolidCore.Solidity.Source.Frame) (rest : LocalEnv)
    (p a bounty old hoisted id b : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩])
    (keeps : Inv48.QuoteTailPreserve.Keeps final.popScope.popScope id a b) :
    let caller := Inv48.QuoteTransport.captured final.popScope.popScope callerFrame rest p a bounty id hoisted
    internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.QuoteTransport.saved callerFrame rest p a bounty old hoisted) (.normal final.popScope.popScope) =
        pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Inv48.QuoteFundingFields.Fields caller id a b :=
  Inv48.QuoteFundingFields.namedCaller fn _ callerFrame rest p a bounty old hoisted id b
    returns keeps.1 keeps.2
theorem suffixClosed (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (id a b h e s multiplier minimum bounty base feeMul : Nat)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hmul : multiplier<R) (hbase : base<R) (hfee : feeMul<R)
    (haltFits : a*multiplier/10000<R)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : base*feeMul/10000<R)
    (haltArgs : Inputs c r h0 haltX haltY denom a multiplier 10000)
    (oracle : OracleInputs c (halted r id a b multiplier e s) rows)
    (earlier : id<(halted r id a b multiplier e s).nextMemory)
    (hh : max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)≤2^128-1)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100)).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum) h0 feeX feeY denom base feeMul 10000)
    (first second : SolidCore.Solidity.Source.Frame) (surviving : LocalEnv)
    (shape : r.locals = first::second::surviving)
    (survivingRef : surviving.lookup? "quote" = some (.memoryRef id))
    (fn : InternalFunction) (callerFrame : SolidCore.Solidity.Source.Frame) (rest : LocalEnv)
    (p old hoisted : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩]) :
    let final := finalState (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum (base*feeMul/10000)
    let caller := Inv48.QuoteTransport.captured final.popScope.popScope callerFrame rest p a bounty id hoisted
    (Stmt.evalList (n+52) table c r (Inv48.QuoteMemory.actualStatements.drop 5)).runWith rows =
      .ok (.normal final) ∧
    Inv48.QuoteTailPreserve.Keeps final id a b ∧
    Inv48.QuoteTailPreserve.Keeps final.popScope.popScope id a b ∧
    internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.QuoteTransport.saved callerFrame rest p a bounty old hoisted) (.normal final.popScope.popScope) =
        pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Inv48.QuoteFundingFields.Fields caller id a b := by
  dsimp only
  have run := suffix n c r rows id a b h e s multiplier minimum bounty base feeMul
    before mem ha hmul hbase hfee haltFits hc hr hb hmin minle exposureFits settlementFits
    haltArgs oracle earlier hh bountyRead minimumRead feeArgs
  have popped := poppedKeeps c r rows id a b multiplier e s minimum (base*feeMul/10000)
    oracle first second surviving shape survivingRef run.2.2
  have named := poppedNamed fn _ callerFrame rest p a bounty old hoisted id b returns popped
  exact ⟨run.1,run.2,popped,named⟩

end Inv48.FundingMathTail
