import Inv48CollateralMinimumOracle
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

def minimumList : List Stmt := [
  .varDecl .uint256 Inv48.Minima.operand (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))),
  .varDecl .uint256 tmp none,
  hoist aggregateRet aggregateKey] ++ Inv48.Minima.collateralTail

theorem minimumBodyShape : Inv48.Minima.collateralBody = .block [.skip,.block [.block minimumList]] := rfl

def baseStage (r : Runtime) (base : Nat) := r.declareLocal Inv48.Minima.operand (.word base)
def minimumAggregateEntry (r : Runtime) (base : Nat) :=
  hoistInside ((baseStage r base).declareLocal tmp (.word 0)) aggregateRet 0
def minimumCaptured (r next : Runtime) (base exposure : Nat) :=
  (({aggregateFinal next with locals := r.locals} : Runtime).declareLocal Inv48.Minima.operand (.word base)).declareLocal tmp (.word exposure)

theorem minimumListRun (n : Nat) (c : Context) (r next : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure base : Nat)
    (out : EvmCompiler.Simulation.CallResponse) (field : ImmutableField)
    (found : c.immutableField? "minimumReportCollateral"=some field)
    (type : field.ty=.uint256)
    (stored : r.state.immutable? "minimumReportCollateral"=some (.word base))
    (baseFits : base<Inv32Division.R) (fits : base+Inv03.ceilQuot exposure 100<Inv32Division.R)
    (checked : c.checked=true)
    (h : OracleAssumptions {c with checked := true}
      (scalarFrame (minimumAggregateEntry r base)).pushScope.pushScope.pushScope next rows implementation universeBytes token root exposure out) :
    (Stmt.evalList (n+52) table c r minimumList).runWith rows =
      .ok (.returned (Inv48.Minima.tailState (minimumCaptured r next base exposure) exposure base)
        [.word (base+Inv03.ceilQuot exposure 100)]) := by
  let a := baseStage r base
  let d := a.declareLocal tmp (.word 0)
  let s := ({aggregateFinal next with locals := d.locals} : Runtime).pushScope.declareLocal aggregateRet (.word exposure)
  let captured := minimumCaptured r next base exposure
  let written := captured.pushScope.declareLocal aggregateRet (.word exposure)
  have call := aggregateCallRun n c (minimumAggregateEntry r base) next s rows aggregateRet
    implementation universeBytes token root exposure out h
    (by cases H : r.locals <;> simp [s,d,a,baseStage,minimumAggregateEntry,hoistInside,
      Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.lookupMemoryRef?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,H])
  have saved := hoistRun (n+49) c d s written rows aggregateRet aggregateKey exposure call
    (by cases H : r.locals <;> simp [s,d,a,baseStage,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,aggregateRet,Inv48.Minima.operand])
    (by simp [s,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?])
    (by cases H : r.locals <;> simp [s,written,captured,minimumCaptured,d,a,baseStage,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,H,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,aggregateRet,Inv48.Minima.operand])
  have tail := Inv48.Minima.generatedCollateralTail (n+36) c captured exposure base h.exposureFits baseFits fits checked
    (by cases H : r.locals <;> simp [captured,minimumCaptured,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H])
    (by cases H : r.locals <;> simp [captured,minimumCaptured,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,Inv48.Minima.operand])
  unfold minimumList
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) (Inv48.Minima.baseDeclaration (n+51) c r field base found type stored baseFits))
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) (Inv48.CloneGetters.decl_none (n+51) table c a .uint256 tmp))
  simp only [Ty.defaultValue]
  apply seqRun _ _ _ _ _ _ _ _ saved
  exact congrArg (SolI.runWith rows) tail
end Inv48.CollateralMinimum
