import Inv48MinimumFullTracePieces
import Inv48MinimumFullTraceCollateral
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
open Inv48.MinimumSuffixPath Inv48.Positive Inv48.WrapperTraversal Inv48.MinimumCollateralTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- One ordered path, with each classified helper indexed by its own cut of that
path. The enclosing transcript is their ordered concatenation. -/
structure BodyRecovery (fuel : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) where
  path : Path fuel c r tr out
  collateralFinal : Runtime
  repFinal : Runtime
  collateral : Inv48.CollateralReturnedMinimum.Joined path.collateralTrace (.normal collateralFinal)
  rep : Inv48.RepReturnedMinimum.Joined path.repTrace (.normal repFinal)
  collateralEq : path.collateralTrace = Inv48.QuoteMinimumEvents.collateralTrace collateral
  repEq : path.repTrace = Inv48.QuoteMinimumEvents.repTrace rep
  purePrologue : path.prologueTrace = []
  pureGuard : path.guardTrace = []
  pureSuffix : path.suffixTrace = []
  split : tr = Inv48.QuoteMinimumEvents.collateralTrace collateral ++ Inv48.QuoteMinimumEvents.repTrace rep

theorem bodyRecovery (fuel : Nat) (c : Context) (r : Runtime) (tr : Interaction.Transcript)
    (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      tr (.ok out)) : Nonempty (BodyRecovery fuel c r tr out) := by
  have replay := Inv48.CollateralCloneFuel.replay (Nat.le_add_right fuel 5) _ _ _ _ _ _ run
  obtain ⟨path⟩ := Inv48.MinimumSuffixPath.recover fuel c r tr out ordinary replay
  obtain ⟨cc,cf,crun⟩ := hoist fuel c path.guarded path.collateral h0 ret1 key1 path.collateralRun
  obtain ⟨collateral,ceq⟩ := recoverCollateral _ _ _ _ _ crun
  have repRun := path.repRun
  change Interaction.Executes (Stmt.evalList (fuel+3) _ c path.collateral
    ([.varDecl .uint256 h1 none] ++ [simpleCode h1 ret2 key2])) path.repTrace (.ok (.normal path.rep)) at repRun
  obtain ⟨declared,dt,ht,sp,decl,hoisted⟩ := normalPrefix _ _ _ _ _ _ _ _ repRun
  have dn : dt = [] := listEvents 2 _ _ _ _ (by decide) decl
  have heq : path.repTrace = ht := by rw [sp,dn,List.nil_append]
  have hoisted := singleton _ _ _ _ _ _ _ hoisted
  obtain ⟨rc,rf,rrun⟩ := hoist fuel c declared path.rep h1 ret2 key2 hoisted
  rw [← heq] at rrun
  obtain ⟨rep,req⟩ := recoverRep _ _ _ _ _ rrun
  have pn := listEvents 100 _ _ _ _ prologueSafe path.prologueRun
  have gn := listEvents 100 _ _ _ _ guardSafe path.guardRun
  have sn := listEvents 100 _ _ _ _ suffixSafe path.suffixRun
  exact ⟨⟨path,cf,rf,collateral,rep,ceq,req,pn,gn,sn,by
    calc
      tr = path.prologueTrace ++ (path.guardTrace ++ (path.collateralTrace ++ (path.repTrace ++ path.suffixTrace))) := path.split
      _ = path.collateralTrace ++ path.repTrace := by rw [pn,gn,sn]; simp only [List.nil_append,List.append_nil]
      _ = _ := congrArg₂ List.append ceq req⟩⟩
end Inv48.MinimumFullTrace
