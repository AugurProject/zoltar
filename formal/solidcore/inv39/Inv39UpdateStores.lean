import Inv39DebitBranch
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.ERC20
def afterFrom (s : State) (src value : Nat) : State :=
  if src=0 then s.storeSlot circulating.slot (s.loadSlot circulating.slot+value)
  else s.storeSlot (balanceSlot src) (s.loadSlot (balanceSlot src)-value)
def afterTo (s : State) (dst value : Nat) : State :=
  if dst=0 then s.storeSlot circulating.slot (s.loadSlot circulating.slot-value)
  else s.storeSlot (balanceSlot dst) (s.loadSlot (balanceSlot dst)+value)
def fromBounds (s : State) (src value : Nat) : Prop :=
  if src=0 then s.loadSlot circulating.slot+value < R else value ≤ s.loadSlot (balanceSlot src) ∧ s.loadSlot (balanceSlot src)<R
def toBounds (s : State) (dst value : Nat) : Prop :=
  if dst=0 then value≤s.loadSlot circulating.slot ∧ s.loadSlot circulating.slot < R else s.loadSlot (balanceSlot dst)+value<R
theorem fromRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel src val : Nat)
    (srcWord : src<R) (fromVal : r.lookupLocal? "from"=some (.word src)) (qty : r.lookupLocal? "value"=some (.word val))
    (enough : fromBounds r.state src val) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+5) t c r fromStep.value = pure (.normal {r with state:=afterFrom r.state src val}) := by
  change Stmt.eval (fuel+5) t c r (.ifElse (zeroTest "from") mint.value debit.value) = _
  rw [Inv32Blocks.branch (fuel+4) t c r _ _ _ (decide (src=0)) (zeroResult _ _ _ _ srcWord fromVal)]
  by_cases z : src=0
  · simp only [z,decide_true,if_true,afterFrom] at *
    exact mintRun _ _ _ (fuel+2) _ qty enough fields
  · simp only [z,decide_false,if_false,afterFrom,fromBounds] at *
    exact debitRun _ _ _ fuel _ _ fromVal qty enough.1 enough.2 fields
theorem toRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel dst val : Nat)
    (dstWord : dst<R) (toVal : r.lookupLocal? "to"=some (.word dst)) (qty : r.lookupLocal? "value"=some (.word val))
    (enough : toBounds r.state dst val) (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+5) t c r toStep.value = pure (.normal {r with state:=afterTo r.state dst val}) := by
  change Stmt.eval (fuel+5) t c r (.ifElse (zeroTest "to") burn.value credit.value) = _
  rw [Inv32Blocks.branch (fuel+4) t c r _ _ _ (decide (dst=0)) (zeroResult _ _ _ _ dstWord toVal)]
  by_cases z : dst=0
  · subst dst
    simp only [afterTo,toBounds,if_pos rfl,decide_true,if_true] at *
    exact burnRun _ _ _ _ _ qty enough.1 enough.2 fields
  · simp only [z,decide_false,if_false,afterTo,toBounds] at *
    exact creditRun _ _ _ _ _ _ toVal qty enough fields
end Inv39.ERC20
