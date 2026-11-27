import Inv48CollateralReturnedMinimumPublic
import Inv48RepMinimumCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RepReturnedMinimum
open Inv48.MinimumCollateralTrace Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.MinimumSuccessWords
open Inv48.CollateralMinimum Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
abbrev view := "#view47475"
def sourceList : List Source.Stmt := match Inv48.Minima.repBody with
  | .block [_,.block [.block xs]] => xs
  | _ => []
def oracleStage (r : Runtime) (code : List Nat) (u : Nat) :=
  ((Inv48.CollateralMinimum.universeStage r code u).declareLocal view (.word u)).declareLocal tmp (.word 0)
theorem bodyList (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.CollateralMinimum.table c r
      Inv48.Minima.repBody) tr (.ok out)) :
    ∃ n value, fuel = n+3 ∧
      out = ((value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope).mapRuntime Runtime.popScope ∧
      ¬ Escapes value ∧
      Interaction.Executes (Stmt.evalList n Inv48.CollateralMinimum.table c
        r.pushScope.pushScope.pushScope sourceList) tr (.ok value) := by
  change Interaction.Executes (Stmt.eval fuel Inv48.CollateralMinimum.table c r
    (.block [.skip,.block [.block sourceList]])) tr (.ok out) at run
  obtain ⟨n,a,eq,oa,first⟩ := block _ _ _ _ _ _ _ run
  have ordinaryA : ¬ Escapes a := popOrdinary a (by rwa [oa] at ordinary)
  have second := singleton _ _ _ _ _ _ _ (skipCons _ _ _ _ _ _ _ ordinaryA first)
  obtain ⟨m,b,eq2,ab,second⟩ := block _ _ _ _ _ _ _ second
  have ordinaryB : ¬ Escapes b := popOrdinary b (by rwa [ab] at ordinaryA)
  have third := singleton _ _ _ _ _ _ _ second
  obtain ⟨k,v,eq3,bv,last⟩ := block _ _ _ _ _ _ _ third
  refine ⟨k,v,by omega,?_,?_,last⟩
  · rw [oa,ab,bv]
  · exact popOrdinary v (by rwa [bv] at ordinaryB)

theorem prefixPure (n : Nat) (c : Context) (r : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv48.SymbolicClone.R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    Stmt.evalList (n+46) table c r (sourceList.take 4) =
      pure (.normal (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes))) := by
  let code := runtimeCode implementation universeBytes token
  let u := decode universeBytes
  let a := universeStage r code u
  let b := a.declareLocal view (.word u)
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
  have decl := Inv32Hoist.declEval (n+45) table c a view .uint256 _ u clean (by rw [Ty.coerceValue?])
  change Stmt.evalList (n+46) table c r
    [.varDecl .uint256 tmp none,hoist universeRet universeKey,
     .varDecl .uint256 view (some (.castOp .uintCleanup 248 (.var tmp))),
     .varDecl .uint256 tmp none] = _
  apply Inv48.CollateralCloneStage.seqPure _ _ _ _ _ _ _ (decl_none (n+45) table c r .uint256 tmp)
  simp only [Ty.defaultValue]
  apply Inv48.CollateralCloneStage.seqPure _ _ _ _ _ _ _ (Inv48.CollateralCloneStage.universePure n c r implementation universeBytes token hi hu ht cu ct selfWord boundary)
  apply Inv48.CollateralCloneStage.seqPure _ _ _ _ _ _ _ decl
  apply Inv48.CollateralCloneStage.seqPure _ _ _ _ _ _ _ (decl_none (n+45) table c b .uint256 tmp)
  rw [Stmt.evalList]
  simp [b,a,code,u,oracleStage,Ty.defaultValue]
end Inv48.RepReturnedMinimum
