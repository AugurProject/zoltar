import Inv48LiquidationVerifiedUncertainty
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationLibrary
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def arg0 (r : Runtime) (p : Nat) := r.declareLocal "_ic_arg_0" (.word p)
def arg1 (r : Runtime) (p u : Nat) := (arg0 r p).declareLocal "_ic_arg_1" (.word u)
def argsReady (r : Runtime) (p u : Nat) :=
  (arg1 r p u).declareLocal GuardRecovery.libraryRet (.word 0)

theorem actualArgumentEvaluation (n : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (U : r.loadImmutableField c "targetPriceErrorForDispute" = .ok (.word u)) :
    Stmt.evalList (n+1) table c r GuardRecovery.hoistArgs =
      pure (.normal (argsReady r p u)) := by
  have price : Expr.eval c r (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")) =
      pure (.word p,r) :=
    Inv32Guards.clean _ _ _ _ _ hp (Inv32Guards.readWord _ _ _ _ _ P)
  have loaded : (arg0 r p).loadImmutableField c "targetPriceErrorForDispute" = .ok (.word u) := U
  have uncertainty : Expr.eval c (arg0 r p) (.castOp .uintCleanup 256 (.immutable "targetPriceErrorForDispute")) =
      pure (.word u,arg0 r p) := by
    change Expr.evalFuel 3 c (arg0 r p) _ = _
    apply Inv32Guards.clean _ _ _ _ _ hu
    rw [Expr.evalFuel,loaded]
    rfl
  have d0 := Inv32Hoist.declEval n table c r "_ic_arg_0" .uint256 _ p price (by rfl)
  have d1 := Inv32Hoist.declEval n table c (arg0 r p) "_ic_arg_1" .uint256 _ u uncertainty (by rfl)
  have d2 := Inv32FloorStart.zero n table c (arg1 r p u) GuardRecovery.libraryRet
  change Stmt.evalList (n+1) table c r [_,_,_] = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d0]
  dsimp only [arg0] at d1
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d1]
  dsimp only [arg1,arg0,GuardRecovery.libraryRet] at d2
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ d2]
  rw [Stmt.evalList]
  rfl

private theorem pureResult (a b : Runtime) (tr : Interaction.Transcript)
    (run : Interaction.Executes (pure (.normal a) : SolI Result) tr (.ok (.normal b))) : b=a := by
  cases run
  rfl

/-- Transport the public clean price and physically loaded immutable to the
 argument runtime recovered from the same successful guard hoist. -/
theorem actualArgumentReads (h : GuardRecovery.HoistPath n c r final tr)
    (p u : Nat) (hp : p<R) (hu : u<R)
    (P : h.declared.pushScope.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (U : h.declared.pushScope.loadImmutableField c "targetPriceErrorForDispute" = .ok (.word u)) :
    h.caller = argsReady h.declared.pushScope p u ∧
    h.caller.lookupLocal? "_ic_arg_0" = some (.word p) ∧
    h.caller.lookupLocal? "_ic_arg_1" = some (.word u) ∧
    {h.caller with locals := h.declared.pushScope.locals} = h.declared.pushScope := by
  have run := h.argsRun
  rw [actualArgumentEvaluation n c h.declared.pushScope p u hp hu P U] at run
  have eq := pureResult _ _ _ run
  refine ⟨eq,?_,?_,?_⟩
  all_goals rw [eq]
  ·
    cases H : h.declared.locals <;>
      simp [argsReady,arg1,arg0,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
        LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,GuardRecovery.libraryRet]
  · cases H : h.declared.locals <;>
      simp [argsReady,arg1,arg0,Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,
        LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H,GuardRecovery.libraryRet]
  · rfl

#print axioms actualArgumentEvaluation
#print axioms actualArgumentReads
end LiquidationLibrary

namespace LiquidationLibrary
open SolidCore.Solidity.Source
/-- Bind the argument source to the actual stored immutable and declaration. -/
theorem physicalUncertainty (c : Context) (r : Runtime) (field : ImmutableField) (u : Nat)
    (found : c.immutableField? "targetPriceErrorForDispute" = some field)
    (ty : field.ty = .uint256)
    (stored : r.state.immutable? "targetPriceErrorForDispute" = some (.word u)) :
    r.loadImmutableField c "targetPriceErrorForDispute" = .ok (.word u) := by
  rw [Runtime.loadImmutableField,found,stored]
  simp [ty,Ty.coerceValue?]
#print axioms physicalUncertainty
end LiquidationLibrary
