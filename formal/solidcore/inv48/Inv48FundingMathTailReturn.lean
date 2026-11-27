import Inv48FundingMathTailFrames
import Inv48QuoteFundingFieldsReturn
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags EvmCompiler.Simulation
namespace Inv48.FundingMathTail
open Inv48.QuoteMemory Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 7000000
theorem suffixNamed (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
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
    (fn : InternalFunction) (callerFrame : SolidCore.Solidity.Source.Frame) (rest : LocalEnv)
    (p old hoisted : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩]) :
    let final := finalState (oracleOut oracle) id a b (a*multiplier/10000) e s
      (Inv03.ceilQuot oracle.exposure 100) minimum (base*feeMul/10000)
    let caller := Inv48.QuoteTransport.captured final callerFrame rest p a bounty id hoisted
    (Stmt.evalList (n+52) table c r (Inv48.QuoteMemory.actualStatements.drop 5)).runWith rows =
      .ok (.normal final) ∧
    Inv48.QuoteTailPreserve.Keeps final id a b ∧
    internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.QuoteTransport.saved callerFrame rest p a bounty old hoisted) (.normal final) =
        pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Inv48.QuoteFundingFields.Fields caller id a b := by
  dsimp only
  have run := suffix n c r rows id a b h e s multiplier minimum bounty base feeMul
    before mem ha hmul hbase hfee haltFits hc hr hb hmin minle exposureFits settlementFits
    haltArgs oracle earlier hh bountyRead minimumRead feeArgs
  have named := Inv48.QuoteFundingFields.namedCaller fn _ callerFrame rest p a bounty old hoisted id b
    returns run.2.1 run.2.2
  exact ⟨run.1,run.2,named⟩

/-- A public-dispatch or funding-entry proof need only supply the separate
post-funding invariant. No dispatch or entry theorem is asserted here. -/
def FundingEntry (r : Runtime) (id a b : Nat) : Prop :=
  id<r.nextMemory ∧ Inv48.QuoteTailPreserve.Keeps r id a b

end Inv48.FundingMathTail
