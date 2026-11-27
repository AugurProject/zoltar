import Inv48LiquidationVerifiedArguments
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationLibrary
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem normalizedArgumentEvaluation (n : Nat) (c : Context) (r : Runtime) (p u : Nat)
    (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (value : Value)
    (U : r.loadImmutableField c "targetPriceErrorForDispute" = .ok value)
    (clean : uintCleanup? c.checked 256 value = .ok (.word u)) :
    Stmt.evalList (n+1) table c r GuardRecovery.hoistArgs =
      pure (.normal (argsReady r p u)) := by
  have price : Expr.eval c r (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")) =
      pure (.word p,r) :=
    Inv32Guards.clean _ _ _ _ _ hp (Inv32Guards.readWord _ _ _ _ _ P)
  have loaded : (arg0 r p).loadImmutableField c "targetPriceErrorForDispute" = .ok value := U
  have uncertainty : Expr.eval c (arg0 r p) (.castOp .uintCleanup 256 (.immutable "targetPriceErrorForDispute")) =
      pure (.word u,arg0 r p) := by
    change Expr.evalFuel 3 c (arg0 r p) _ = _
    rw [Expr.evalFuel]
    change (Expr.evalFuel 2 c (arg0 r p) (.immutable "targetPriceErrorForDispute") >>= _) = _
    rw [Expr.evalFuel,loaded]
    change (pure (value,arg0 r p) >>= _) = _
    rw [show ∀ {α β : Type} (a : α) (k : α → SolI β), pure a >>= k = k a from fun _ _ => rfl]
    dsimp only
    rw [clean]
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

#print axioms normalizedArgumentEvaluation
end LiquidationLibrary
