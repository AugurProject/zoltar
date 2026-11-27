import Inv48RequestQuoteEval
open SolidCore.Solidity.Source
namespace Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def reply (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (returns : List BindingDecl) (cleanups : List AbiCleanup) (body : Stmt)
    (response : LowLevelCallResult × State) : SolI Result :=
  let rr := ({r with state := response.2}).recordExternalInteraction (.lowLevelCall response.1)
  if response.1.success then
    match abiDecodeValuesExcept? (returns.map BindingDecl.ty) (response.1.output.map normByte) with
    | .ok decoded =>
      if AbiCleanups.acceptOrUnspecified cleanups decoded then
        match BindingDecl.bindArgs? returns decoded with
        | some frame => do
          let result ← Stmt.eval fuel t c (rr.withFrame frame) body
          pure (result.mapRuntime Runtime.popScope)
        | none => pure (.reverted rr RevertData.typeMismatch)
      else pure (.reverted rr RevertData.empty)
    | .error err => pure (.reverted rr err)
  else pure (.reverted rr (.fromRawBytes (response.1.output.map normByte)))

theorem callTree (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (selector id a b h e s sponsor bounty gas : Nat)
    (returns : List BindingDecl) (cleanups : List AbiCleanup) (body : Stmt)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160) (hsel : selector<R)
    (self : c.self<R) (construction : c.construction=false) :
    Stmt.eval (n+1) t c r
      (.tryExternalCall .call .self (calldataExpr selector) (.word 0) none false false
        returns cleanups body []) =
    (selfDispatchCall c r.state .call c.self
      (calldata selector c.sender sponsor a b h bounty gas) 0 none >>=
      reply n t c r returns cleanups body) := by
  have target : (.self : Expr).evalWithRuntimeByContext c r = .ok (.word c.self,r) := rfl
  have zero : (.word 0 : Expr).evalWithRuntimeByContext c r = .ok (.word 0,r) := rfl
  have enc : (calldataExpr selector).evalWithRuntimeByContext c r =
      .ok (.bytes (calldata selector c.sender sponsor a b h bounty gas),r) := by
    unfold Expr.evalWithRuntimeByContext
    rw [encoding c r selector id a b h e s sponsor bounty gas ref mem S B G ha hb hh hB hG hp hs hsel]
    rfl
  rw [Stmt.eval]
  simp only [target,Value.expectWord,zero,enc,Value.asBytes?,construction,
    Bool.and_false,Bool.false_and,Bool.or_false,Bool.false_eq_true,if_false]
  rw [show SolidCore.Solidity.Shared.norm c.self = c.self from Nat.mod_eq_of_lt self]
  have nb (v : Nat) : normByte (normByte v) = normByte v := by
    simp [normByte,SolidCore.Solidity.Shared.Account.byte]
  have wb (n v : Nat) : (wordToBytesBE n v).map normByte = wordToBytesBE n v := by
    induction n generalizing v with
    | zero => rfl
    | succ n ih => simp [wordToBytesBE,List.map_append,ih,nb]
  have nc : (calldata selector c.sender sponsor a b h bounty gas).map normByte =
      calldata selector c.sender sponsor a b h bounty gas := by
    simp [calldata,payload,List.map_append,List.flatMap_cons,List.flatMap_nil,wb]
  rw [nc,show SolidCore.Solidity.Shared.norm 0 = 0 by decide]
  apply congrArg (fun k => selfDispatchCall c r.state .call c.self
    (calldata selector c.sender sponsor a b h bounty gas) 0 none >>= k)
  funext response
  have noCatch (raw : List Byte) : TryCatchClause.findMatch? raw [] = none := by
    unfold TryCatchClause.findMatch?
    cases revertClassify raw <;> rfl
  simp only [noCatch]
  rfl

#print axioms callTree
end Inv48.RequestQuote
