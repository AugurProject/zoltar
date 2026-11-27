import Inv48RequestQuoteShape
import Inv48RequestQuoteReturn
open SolidCore.Solidity.Source
namespace Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem quoteCallInputs (c : Context) (r : Runtime) (price requested bounty : Nat)
    (P : r.lookupLocal? "_ic_arg_0" = some (.word price))
    (A : r.lookupLocal? "_ic_arg_1" = some (.word requested))
    (B : r.lookupLocal? "_ic_arg_2" = some (.word bounty)) :
    Expr.evalRefArgList c r [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word price,.word requested,.word bounty],r) := by
  unfold Expr.evalRefArgList
  simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ price P]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ requested A]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,Inv48.EscrowPrefix.scalarRefArg c r _ bounty B]
  simp only [pb]
  rw [Expr.evalRefArgListFuel]
  rfl

theorem referenceReturnCoercion (decl : BindingDecl) (r : Runtime) (id : Nat) :
    coerceReturnBindingsRef [decl] r [.memoryRef id] = .ok [.memoryRef id] := rfl

theorem namedReferenceReturn (decl : BindingDecl) (r : Runtime) (id : Nat)
    (ref : r.lookupLocal? decl.name = some (.memoryRef id)) :
    collectReturnBindingsRef [decl] r = .ok [.memoryRef id] := by
  simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,ref,Bind.bind,Except.bind]

theorem checkedOperational (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s sponsor bounty gas : Nat)
    (stmt : Stmt) (source : actualCall = some stmt)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160)
    (self : c.self<R) (construction : c.construction=false) :
    Stmt.eval (n+1) t c r stmt =
    (selfDispatchCall c r.state .call c.self
      (calldata 2391489481 c.sender sponsor a b h bounty gas) 0 none >>=
      reply n t c r returns cleanups successBody) := by
  have eq : stmt = callStmt := Option.some.inj (source.symm.trans checkedCall)
  subst stmt
  exact callTree n t c r 2391489481 id a b h e s sponsor bounty gas returns cleanups successBody
    ref mem S B G ha hb hh hB hG hp hs (by decide) self construction

theorem replyNormalSuccess (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (response : LowLevelCallResult × State) (trace : EvmCompiler.Simulation.Interaction.Transcript)
    (run : Inv48.EscrowPrefix.ExecutesOK (reply n t c r returns cleanups successBody response)
      trace (.normal final)) : response.1.success = true := by
  by_cases success : response.1.success = true
  · exact success
  · simp only [reply,success,if_false] at run
    have impossible := Inv48.EscrowPrefix.pureResult _ _ _ run
    cases impossible.2

theorem successfulCheckedDispatch (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s sponsor bounty gas : Nat)
    (stmt : Stmt) (source : actualCall = some stmt)
    (trace : EvmCompiler.Simulation.Interaction.Transcript) (final : Runtime)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160)
    (self : c.self<R) (construction : c.construction=false)
    (run : Inv48.EscrowPrefix.ExecutesOK (Stmt.eval (n+1) t c r stmt) trace (.normal final)) :
    ∃ response before after, trace = before ++ after ∧
      Inv48.EscrowPrefix.ExecutesOK
        (selfDispatchCall c r.state .call c.self
          (calldata 2391489481 c.sender sponsor a b h bounty gas) 0 none) before response ∧
      Inv48.EscrowPrefix.ExecutesOK (reply n t c r returns cleanups successBody response)
        after (.normal final) := by
  rw [checkedOperational n t c r id a b h e s sponsor bounty gas stmt source
    ref mem S B G ha hb hh hB hG hp hs self construction] at run
  exact Inv48.EscrowPrefix.bindSuccessful _ _ _ _ run

#print axioms quoteCallInputs
#print axioms referenceReturnCoercion
#print axioms namedReferenceReturn
#print axioms captureNormal
#print axioms replyNormalSuccess
#print axioms successfulCheckedDispatch
#print axioms checkedOperational
#print axioms internalRun
#print axioms successfulReturn
#print axioms quoteReturn
#print axioms quoteAlias
#print axioms hoistAlias
#print axioms arguments
#print axioms encoding
#print axioms checkedQuoteCapture
end Inv48.RequestQuote
