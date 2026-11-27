import Inv12PremiumShape
import Inv12PremiumArgs
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def premiumBytes (r : Runtime) (f b : Ref) (source child : Nat) :=
  wireBytes 2234981752 [source,child,b.get r.state 4,f.get r.state 1]

theorem premiumExecution (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (source child target : Nat)
    (rows : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (chosen : b.hasField 5 4) (total : f.hasField 1 1)
    (src : r.lookupLocal? "source"=some (.word source)) (ch : r.lookupLocal? "child"=some (.word child))
    (service : r.lookupLocal? "#view55792"=some (.word target)) (word : target<Inv32Division.R)
    (away : wordEq target c.self=false) (code : r.state.envAccountHasCode c target=true)
    (answered : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .call target (premiumBytes r f b source child) 0 none)=some out)
    (ok : out.success=true) (noWrites : NoCoordinatorWrites rows)
    (snap : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true) (wf : StorageMap.WF r.state.storage) :
    ∃ stmt next, callbackStmt=some stmt ∧ (Stmt.eval (n+2) model.core.table c r stmt).runWith rows=.ok (.normal next) ∧
      next.locals=r.locals ∧ ∀ ref off, Ref.get ref next.state off=ref.get r.state off := by
  let bytes := premiumBytes r f b source child
  have encoded := calldata c r 2234981752 (by decide) _ _ (premiumArgumentValues c r f b source child src ch fork branch chosen total)
  have ran := runPremiumCall n model.core.table c r serviceAddress premiumData target bytes rows out
    (wordFromRead c r _ _ (Inv08.localReads _ _ _ _ service))
    (wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))) encoded (Nat.mod_eq_of_lt word)
    (wireClean _ _) away code answered ok
  refine ⟨_,_,premiumFromChoose,ran,rfl,?_⟩
  intro ref off
  exact afterResponse c r out.postWorld (matchedReply c rows _ _ _ noWrites answered) snap wf ref off

#print axioms premiumExecution
end Inv12
