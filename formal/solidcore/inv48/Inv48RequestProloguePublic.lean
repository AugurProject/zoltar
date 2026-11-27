import Inv48RequestPrologueSource
open SolidCore.Solidity.Source
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def publicFrame (p a bounty : Nat) : Frame :=
  [("proposedRepPerEthPrice",.word p),("requestedInitialAttoWeth",.word a),
   ("bountyAttoEth",.word bounty),("reportId",.word 0)]
def publicBase (c : Context) (state : State) (p a bounty : Nat) : Runtime :=
  {state := {state with
    selfBalance := SolidCore.Solidity.Shared.addWord
      (SolidCore.Solidity.Shared.Account.balanceAt c.accountBalances c.self) c.value
    worldMutatedSinceAdoption := true}
   locals := [publicFrame p a bounty]}

theorem publicBinding (fn : FunctionDef) (p a bounty : Nat)
    (params : fn.params = quoteParams)
    (returns : fn.returns = [⟨"reportId",.uint256,false⟩]) :
    fn.initialFrame? [.word p,.word a,.word bounty] = some (publicFrame p a bounty) := by
  simp [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,params,returns,
    quoteParams,publicFrame,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue]

/-- The actual registered payable request entry, with its real initial state
and named return. The path from this tree through the request guards remains open. -/
theorem registeredPublicEntry (fuel : Nat) (c : Context) (state : State) (p a bounty : Nat) :
    ∃ fn, publicRequest = some fn ∧
      fn.evalBodyEntry fuel Inv48.Source.model.core.table c state [.word p,.word a,.word bounty] =
        some (Stmt.eval fuel Inv48.Source.model.core.table c (publicBase c state p a bounty) fn.body) := by
  obtain ⟨fn,linked,params,returns,payable,prologue⟩ := publicRegistered
  refine ⟨fn,linked,?_⟩
  unfold FunctionDef.evalBodyEntry
  rw [show fn.acceptsValue c.value = true by simp [FunctionDef.acceptsValue,payable],
    publicBinding fn p a bounty params returns]
  rfl

theorem publicPrologueExecution (n : Nat) (c : Context) (state : State) (p a bounty : Nat)
    (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256) :
    Stmt.evalList (n+1) Inv48.Source.model.core.table c (publicBase c state p a bounty).pushScope
      publicPrologueP.value = pure (.normal (publicBase c state p a bounty).pushScope) := by
  let r := (publicBase c state p a bounty).pushScope
  have one := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "proposedRepPerEthPrice" p hp (by rfl) (by simp [r,publicBase,publicFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have two := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "requestedInitialAttoWeth" a ha (by rfl) (by simp [r,publicBase,publicFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have three := Inv32FloorFastPath.cleanParamExec n Inv48.Source.model.core.table c r
    "bountyAttoEth" bounty hb (by rfl) (by simp [r,publicBase,publicFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  change Stmt.evalList (n+1) _ c r [Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",
    Inv32FloorFastPath.cleanParam "requestedInitialAttoWeth",
    Inv32FloorFastPath.cleanParam "bountyAttoEth",.skip] = _
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ one).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ two).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ three).trans (by rw [Inv48.WholeQuote.singleList,Stmt.eval])))
end Inv48.RequestPrologue
