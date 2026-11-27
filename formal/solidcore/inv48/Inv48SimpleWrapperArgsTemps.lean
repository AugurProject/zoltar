import Inv48SimpleWrapperArgsExecution
import Inv48MinimaLocals
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem cleanRead (c : Context) (r : Runtime) (bits v : Nat) (source : String)
    (positive : 0 < bits) (width : bits ≤ 256) (word : v < 2^256) (fits : v < 2^bits)
    (look : r.lookupLocal? source = some (.word v)) :
    Expr.eval c r (.castOp .uintCleanup bits (.var source)) = pure (.word v,r) := by
  unfold Expr.eval
  simp only [Expr.orderFuel]
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ look]
  change (do
    let converted ← (uintCleanup? c.checked bits (.word v) : Except RevertData Value)
    pure (converted,r) : SolI (Value × Runtime)) = _
  rw [Inv48.EscrowEntry.cleanWidth c.checked bits v positive width word fits]
  rfl

def stage (r : Runtime) : Runtime :=
  ((r.declareLocal hoist (.word 4000000)).declareLocal viewName (.word 4000000)).declareLocal hoist (.word 0)

theorem beforeRequestExecution (n : Nat) (c : Context) (r : Runtime) :
    Stmt.evalList (n+6) Inv48.Source.model.core.table c r beforeRequest = pure (.normal (stage r)) := by
  let r1 := r.declareLocal hoist (.word 4000000)
  let r2 := r1.declareLocal viewName (.word 4000000)
  have first := Inv48.CloneGetters.decl_none (n+5) Inv48.Source.model.core.table c r .uint256 hoist
  have getter := getterBlockExecution n c r
  have viewStep := Inv48.PositiveHoist.declEval (n+5) Inv48.Source.model.core.table c r1 viewName .uint256
    (.castOp .uintCleanup 32 (.var hoist)) 4000000
    (cleanRead c r1 32 4000000 hoist (by decide) (by decide) (by decide) (by decide)
      (by simp [r1])) (by rfl)
  have last := Inv48.CloneGetters.decl_none (n+5) Inv48.Source.model.core.table c r2 .uint256 hoist
  simp only [Ty.defaultValue] at first last
  unfold beforeRequest temp
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ first,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ getter,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ viewStep,
    Inv48.WholeQuote.singleList,last]
  rfl

def temps (c : Context) (r : Runtime) (p a b : Nat) : Runtime :=
  ((((((r.declareLocal "_ic_arg_0" (.word c.sender)).declareLocal
    "_ic_arg_1" (.word p)).declareLocal "_ic_arg_2" (.word a)).declareLocal
    "_ic_arg_3" (.word b)).declareLocal "_ic_arg_4" (.word 4000000)).declareLocal
    "_ret__requestPrice_0" (.word 0))

theorem tempsValues (c : Context) (r : Runtime) (p a b : Nat) :
    Inv48.WrapperArgs.TempValues (temps c r p a b)
      c.sender p a b 4000000 := by
  simp [Inv48.WrapperArgs.TempValues,temps]

theorem requestPrefixExecution (n : Nat) (c : Context) (r : Runtime) (p a b : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word b))
    (G : r.lookupLocal? viewName = some (.word 4000000)) :
    Stmt.evalList (n+1) Inv48.Source.model.core.table c r requestPrefix =
      pure (.normal (temps c r p a b)) := by
  let r1 := r.declareLocal "_ic_arg_0" (.word c.sender)
  let r2 := r1.declareLocal "_ic_arg_1" (.word p)
  let r3 := r2.declareLocal "_ic_arg_2" (.word a)
  let r4 := r3.declareLocal "_ic_arg_3" (.word b)
  let r5 := r4.declareLocal "_ic_arg_4" (.word 4000000)
  have s := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r
    "_ic_arg_0" .address .caller c.sender (by rfl) (by rfl)
  have pStep := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r1
    "_ic_arg_1" .uint256 _ p
    (cleanRead c r1 256 p "proposedRepPerEthPrice" (by decide) (by decide) hp hp (by simpa [r1] using P)) (by rfl)
  have aStep := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r2
    "_ic_arg_2" .uint256 _ a
    (cleanRead c r2 256 a "requestedInitialAttoWeth" (by decide) (by decide) ha ha (by simpa [r2,r1] using A)) (by rfl)
  have bStep := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r3
    "_ic_arg_3" .uint256 _ b
    (cleanRead c r3 256 b "bountyAttoEth" (by decide) (by decide) hb hb (by simpa [r3,r2,r1] using B)) (by rfl)
  have gStep := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r4
    "_ic_arg_4" .uint256 _ 4000000
    (cleanRead c r4 32 4000000 viewName (by decide) (by decide) (by decide) (by decide)
      (by simpa [r4,r3,r2,r1,viewName] using G)) (by rfl)
  have last : Stmt.eval (n+1) Inv48.Source.model.core.table c r5
      (.varDecl .uint256 "_ret__requestPrice_0" none) =
      pure (.normal (r5.declareLocal "_ret__requestPrice_0" (.word 0)))  := by
    simpa only [Ty.defaultValue] using
      (Inv48.CloneGetters.decl_none n Inv48.Source.model.core.table c r5 .uint256 "_ret__requestPrice_0")
  unfold requestPrefix temp
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ s,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ pStep,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ aStep,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ bStep,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ gStep,
    Inv48.WholeQuote.singleList,last]
  rfl
end Inv48.SimpleWrapperArgs
