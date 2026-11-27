import Inv48PositiveSyntax
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def entryState (ctx : Context) (state : State) : State :=
  { state with
    selfBalance := Shared.addWord (Shared.Account.balanceAt ctx.accountBalances ctx.self) ctx.value
    worldMutatedSinceAdoption := true }

def entryBase (ctx : Context) (state : State) : Runtime :=
  { state := entryState ctx state, locals := [] }

theorem functionCall (fuel : Nat) (table : FunctionTable) (ctx : Context) (fn : FunctionDef)
    (state : State) (p v : Nat) (zeroValue : ctx.value=0)
    (params : fn.params = [⟨"proposedRepPerEthPrice",.uint256,false⟩])
    (returns : fn.returns = [⟨"_ret0",.uint256,false⟩]) (nonpayable : fn.payable=false)
    (body : fn.body=Inv48.Public.body)
    (ev : Stmt.eval fuel table ctx (start (entryBase ctx state) p) Inv48.Public.body =
      pure (.returned (start (entryBase ctx state) p) [.word v])) :
    fn.call fuel table ctx state [.word p] = some (pure (.returned
      {entryState ctx state with constructorOutput? := none} [.word v])) := by
  have initial : fn.initialFrame? [.word p] = some [("proposedRepPerEthPrice",.word p),("_ret0",.word 0)] := by
    simp [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,params,returns,
      BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]
  have accepts : fn.acceptsValue ctx.value = true := by
    rw [FunctionDef.acceptsValue,nonpayable,zeroValue]; rfl
  unfold FunctionDef.call FunctionDef.evalBodyEntry
  rw [accepts,initial,body]
  change some ((fn.callBodyResult state) <$> Stmt.eval fuel table ctx
    (start (entryBase ctx state) p) Inv48.Public.body) = _
  rw [ev]
  have mapPure {α β : Type} (f : α → β) (a : α) : f <$> (pure a : SolI α) = pure (f a) := rfl
  rw [mapPure]
  simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,returns,
    coerceReturnBindings,coerceReturnBindings.coerce,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,start,entryBase,Runtime.withFrame,Bind.bind,Except.bind,Value.untagFixedBytes]

#print axioms functionCall
end Inv48.Positive
