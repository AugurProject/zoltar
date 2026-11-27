import Inv48ObservedTailBoundsSuffix
import Inv48ObservedFundingSuffixCalldata
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.ObservedTailBounds
open Inv48.QuoteMemory Inv48.WholeQuote Inv48.FundingMathTail Inv48.QuoteOperandReads
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem suffixFields (n : Nat) (c : Context) (physical r last : Runtime)
    (rows : ScriptedResponder) (id a b bounty multiplier minimum priority feeMul : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b 0 0 0))
    (ha : a<R) (hb : bounty<R) (repFits : b<R)
    (haltWord : PhysicalWord c physical "escalationHaltMultiplierBps" multiplier)
    (minimumWord : PhysicalWord c physical "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord c physical "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord c physical "maxSettlementBaseFeeMultiplierBps" feeMul)
    (same : ∀ name, r.state.immutable? name = physical.state.immutable? name)
    (oracle : OracleInputs c (halted r id a b multiplier 0 0) rows)
    (earlier : id<(halted r id a b multiplier 0 0).nextMemory)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (checked : c.checked=true) (trace : Interaction.Transcript)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes (Stmt.evalList (n+65) table c r
      (actualStatements.drop 5)) trace (.ok (.normal last))) :
    ∃ base, base=EnvWord.blockBasefee.eval c+priority ∧ base<R ∧ base*feeMul/10000<R ∧
      last.lookupLocal? "quote" = some (.memoryRef id) ∧
      last.loadMemory? id = some (tuple a b
        (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100))
        ((a-minimum)*100) (base*feeMul/10000)) := by
  obtain ⟨haltFit,hc,hr,hh,hb',minle,base,addSuccess,baseEq,baseFit,feeFit,_⟩ :=
    suffixBounds n c physical r last rows id a b bounty multiplier minimum priority feeMul ref mem ha hb repFits
      haltWord minimumWord priorityWord feeWord same oracle earlier bountyRead checked trace aligned run
  have args := haltInputs c r id a b 0 0 0 multiplier ref mem ha (physicalRead haltWord (same _)) haltWord.fits
  let feeRuntime := exposed (oracleOut oracle) id a b (a*multiplier/10000) 0 0 (Inv03.ceilQuot oracle.exposure 100) minimum
  have fsame (name : String) : feeRuntime.state.immutable? name = physical.state.immutable? name := by
    dsimp [feeRuntime,Inv48.FundingMathTail.exposed,maximum]
    split <;> exact same name
  have minimumRead : (maximum (oracleOut oracle) id a b (a*multiplier/10000) 0 0
      (Inv03.ceilQuot oracle.exposure 100)).loadImmutableField c "minimumReportCollateral" = .ok (.word minimum) := by
    apply physicalRead minimumWord
    unfold maximum
    split <;> exact same _
  have feeArgs := feeInputs c feeRuntime priority feeMul base priorityWord.fits feeWord.fits (basefeeWord c)
    addSuccess (physicalRead priorityWord (fsame _)) (physicalRead feeWord (fsame _))
  have expfit : (a-minimum)*100<R :=
    lt_of_le_of_lt (le_trans (Nat.mul_le_mul_right 100 (Nat.sub_le a minimum))
      (Nat.mul_le_mul_right 100 hc)) (by decide)
  have result := suffix (n+13) c r rows id a b 0 0 0 multiplier minimum bounty base feeMul
    ⟨ref,0,0,0,mem⟩ mem ha haltWord.fits baseFit feeWord.fits haltFit hc hr hb' minimumWord.fits minle expfit feeFit
    args oracle earlier hh bountyRead minimumRead feeArgs
  have observed := Inv48.ChildExtraction.foldTrace rows _ _ _ aligned run
  have eq : last=finalState (oracleOut oracle) id a b (a*multiplier/10000) 0 0
      (Inv03.ceilQuot oracle.exposure 100) minimum (base*feeMul/10000) := by
    have computed := result.1
    simp only [Nat.add_assoc] at computed
    rw [computed] at observed
    exact (Result.normal.inj (Except.ok.inj observed)).symm
  subst last
  exact ⟨base,baseEq,baseFit,feeFit,result.2.1,put_load _ _ _ _ _ _ _⟩
#print axioms suffixFields

theorem suffixCalldata (n : Nat) (c : Context) (physical r last : Runtime)
    (rows : ScriptedResponder) (id a b bounty multiplier minimum priority feeMul : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b 0 0 0))
    (ha : a<R) (hb : bounty<R) (repFits : b<R)
    (haltWord : PhysicalWord c physical "escalationHaltMultiplierBps" multiplier)
    (minimumWord : PhysicalWord c physical "minimumReportCollateral" minimum)
    (priorityWord : PhysicalWord c physical "initialReportPriorityFeeAttoEthPerGas" priority)
    (feeWord : PhysicalWord c physical "maxSettlementBaseFeeMultiplierBps" feeMul)
    (same : ∀ name, r.state.immutable? name = physical.state.immutable? name)
    (oracle : OracleInputs c (halted r id a b multiplier 0 0) rows)
    (earlier : id<(halted r id a b multiplier 0 0).nextMemory)
    (bountyRead : (oracleOut oracle).lookupLocal? "bountyAttoEth" = some (.word bounty))
    (checked : c.checked=true) (trace : Interaction.Transcript)
    (aligned : Inv48.ChildExtraction.Matches rows trace)
    (run : Interaction.Executes (Stmt.evalList (n+65) table c r
      (actualStatements.drop 5)) trace (.ok (.normal last)))
    (selector sponsor gas : Nat)
    (S : last.lookupLocal? "sponsor" = some (.word sponsor))
    (B : last.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : last.lookupLocal? "callbackGasLimit" = some (.word gas))
    (hg : gas<R) (payer : c.sender<2^160) (hs : sponsor<2^160) (selectorFits : selector<R) :
    Expr.eval c last (Inv48.RequestQuote.calldataExpr selector) =
      pure (.bytes (Inv48.RequestQuote.calldata selector c.sender sponsor a b
        (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) bounty gas),last) := by
  obtain ⟨base,_,_,_,lastRef,lastMem⟩ := suffixFields n c physical r last rows id a b bounty multiplier minimum priority feeMul
    ref mem ha hb repFits haltWord minimumWord priorityWord feeWord same oracle earlier bountyRead checked trace aligned run
  obtain ⟨_,_,_,hh,_⟩ := suffixBounds n c physical r last rows id a b bounty multiplier minimum priority feeMul
    ref mem ha hb repFits haltWord minimumWord priorityWord feeWord same oracle earlier bountyRead checked trace aligned run
  exact Inv48.RequestQuote.encoding c last selector id a b
    (max (a*multiplier/10000) (Inv03.ceilQuot oracle.exposure 100)) ((a-minimum)*100) (base*feeMul/10000)
    sponsor bounty gas lastRef lastMem S B G ha repFits (lt_of_le_of_lt hh (by decide)) hb hg payer hs selectorFits
#print axioms suffixCalldata
end Inv48.ObservedTailBounds
