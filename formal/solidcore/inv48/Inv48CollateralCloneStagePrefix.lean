import Inv48CollateralCloneStageCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralCloneStage
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem prefixPure (n : Nat) (c : Context) (r : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv48.SymbolicClone.R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    Stmt.evalList (n+46) table c r (aggregateList.take 4) =
      pure (.normal (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes))) := by
  let code := runtimeCode implementation universeBytes token
  let u := decode universeBytes
  let a := universeStage r code u
  let b := a.declareLocal universeView (.word u)
  let d := oracleStage r code u
  have small : u<2^248 := universe_bounds universeBytes hu cu
  have lookup : a.lookupLocal? tmp=some (.word u) := by
    cases h : r.locals <;> simp [a,universeStage,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,post,Runtime.allocMemory,h]
  have fit : u<Inv32Division.R := small.trans (by decide)
  have clean : Expr.eval c a (.castOp .uintCleanup 248 (.var tmp))=pure (.word u,a) := by
    have cast : uintCleanup? c.checked 248 (.word u)=.ok (.word u) := by
      have smallNum := small
      norm_num at smallNum
      simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
        Nat.mod_eq_of_lt (show u<SolidCore.Solidity.Shared.wordModulus from fit),Nat.mod_eq_of_lt small,small,smallNum,Nat.mod_eq_of_lt smallNum,Bind.bind,Except.bind]
    unfold Expr.eval
    rw [Expr.evalFuel]
    change (do let p ← Expr.evalFuel (0+1) c a (.var tmp); let v ← liftM (uintCleanup? c.checked 248 p.1); pure (v,p.2) : SolI (Value × Runtime)) = _
    rw [Inv32Guards.readWord _ _ _ _ _ lookup]
    change (do let v ← liftM (uintCleanup? c.checked 248 (.word u)); pure (v,a) : SolI (Value × Runtime)) = _
    rw [cast]; rfl
  have decl := Inv32Hoist.declEval (n+45) table c a universeView .uint256 _ u clean (by rw [Ty.coerceValue?])
  change Stmt.evalList (n+46) table c r
    [.varDecl .uint256 tmp none,hoist universeRet universeKey,
     .varDecl .uint256 universeView (some (.castOp .uintCleanup 248 (.var tmp))),
     .varDecl .uint256 tmp none] = _
  apply seqPure _ _ _ _ _ _ _ (decl_none (n+45) table c r .uint256 tmp)
  simp only [Ty.defaultValue]
  apply seqPure _ _ _ _ _ _ _ (universePure n c r implementation universeBytes token hi hu ht cu ct selfWord boundary)
  apply seqPure _ _ _ _ _ _ _ decl
  apply seqPure _ _ _ _ _ _ _ (decl_none (n+45) table c b .uint256 tmp)
  rw [Stmt.evalList]
  simp [b,a,code,u,oracleStage,Ty.defaultValue]
end Inv48.CollateralCloneStage
