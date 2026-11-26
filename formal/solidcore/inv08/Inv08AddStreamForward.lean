import Inv08AddStreamBody
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.AddStream
open ExpiryStorage FundingHistory
def afterFunding (r : Runtime) (f : Funding) (p : Record) : Runtime :=
  {allocated r p with state:=post r.state f p}

theorem internalFunding (n : Nat) (c : Context) (r : Runtime) (x y : String) (f : Funding) (p : Record)
    (X : r.lookupLocal? x=some (.word f.eth)) (Y : r.lookupLocal? y=some (.word f.rep))
    (fields : c.storageFields=model.core.context.storageFields) (clock : EnvWord.blockTimestamp.eval c=f.time)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) (pf : p.endAt<2^48) :
    Stmt.eval (n+9) model.core.table c r (.internalCall [] rawKey [.var x,.var y]) = pure (.normal (afterFunding r f p)) := by
  obtain ⟨fn,found,ps,rs,bd⟩ := rawLink
  let empty := {r with locals:=[]}
  let src := empty.withFrame (frame f)
  have enter : internalCallEnter? fn [.word f.eth,.word f.rep] r=some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      Ty.coerceValue?,frame,empty,src,Runtime.withFrame]
  have ev := executeRaw n {c with checked:=true} empty f p fields clock dom stages pf
  change Stmt.eval _ _ _ src _ = _ at ev
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args c r x y _ _ X Y) found enter ev,internalCallFinish,rs]
  change (pure (.normal {finalRuntime empty f p with locals:=r.locals}) : SolI Result)=_
  simp only [empty,finalRuntime,afterFunding,allocated,Runtime.withFrame,Runtime.allocMemory]

theorem forward (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (eth : r.pushScope.lookupLocal? "ethAmount"=some (.word f.eth)) (rep : r.pushScope.lookupLocal? "repAmount"=some (.word f.rep))
    (fields : c.storageFields=model.core.context.storageFields) (clock : EnvWord.blockTimestamp.eval c=f.time)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) (pf : p.endAt<2^48) :
    forwardCall.value.eval (n+11) model.core.table c r = pure (.normal (afterFunding r f p)) := by
  let root := r.pushScope
  let a := root.declareLocal "_ic_arg_0" (.word f.eth)
  let b := a.declareLocal "_ic_arg_1" (.word f.rep)
  have R : a.lookupLocal? "repAmount"=some (.word f.rep) := by
    simpa [a,root,Runtime.declareLocal,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?] using rep
  have A := Inv32Hoist.declEval (n+9) model.core.table c root "_ic_arg_0" .uint256 _ f.eth
    (ReleaseQuote.readClean (localReads c root "ethAmount" _ eth) (lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum) _ (Nat.le_succ _)) rfl
  have B := Inv32Hoist.declEval (n+9) model.core.table c a "_ic_arg_1" .uint256 _ f.rep
    (ReleaseQuote.readClean (localReads c a "repAmount" _ R) (lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum) _ (Nat.le_succ _)) rfl
  have X := internalFunding n c b "_ic_arg_0" "_ic_arg_1" f p rfl rfl fields clock dom stages pf
  have W := Inv32Internal.capture (n+9) model.core.table c b _ [] _ X
  have restore : (afterFunding b f p).popScope=afterFunding r f p := by
    simp only [afterFunding,allocated,b,a,root,Runtime.popScope,Runtime.declareLocal,Runtime.pushScope,Runtime.allocMemory,LocalEnv.declare,List.drop]
  rw [←restore]
  apply Inv32Hoist.block (n+10) model.core.table c r (afterFunding b f p) _
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] W).trans (by rw [Stmt.evalList])))
end Inv08.AddStream
