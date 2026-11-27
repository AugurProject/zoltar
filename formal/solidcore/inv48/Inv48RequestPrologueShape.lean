import Inv48RequestPrologueCore
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def quoteParams : List BindingDecl :=
  [⟨"proposedRepPerEthPrice",.uint256,false⟩,
   ⟨"requestedInitialAttoWeth",.uint256,false⟩,⟨"bountyAttoEth",.uint256,false⟩]
def quoteParamP := seq [
  Inv48.EscrowTrace.bindingPattern (lit "proposedRepPerEthPrice") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "requestedInitialAttoWeth") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "bountyAttoEth") Ty_uint256 (lit false)]
def quoteTypeP : Pattern Ty where
  value := Inv48.WholeQuote.quoteTy
  test | .tuple [.uint256,.uint256,.uint256,.uint256,.uint256] => true | _ => false
  sound v h := by split at h <;> simp_all [Inv48.WholeQuote.quoteTy]
def registeredQuote := Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey

theorem quoteMetadata : ∀ fn ∈ registeredQuote,
    fn.params = quoteParams ∧ fn.returns = [⟨"quote",Inv48.WholeQuote.quoteTy,false⟩] := by
  have cert : (registeredQuote.map fun fn => quoteParamP.test fn.params &&
    (seq [Inv48.EscrowTrace.bindingPattern (lit "quote")
      quoteTypeP
      (lit false)]).test fn.returns) = some true := by native_decide
  intro fn hf
  have found : registeredQuote = some fn := hf
  rw [found] at cert
  simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at cert
  exact ⟨quoteParamP.sound _ cert.1,
    (seq [Inv48.EscrowTrace.bindingPattern (lit "quote")
      quoteTypeP
      (lit false)]).sound _ cert.2⟩

end Inv48.RequestPrologue

namespace Inv48.RequestPrologue
open SolidCore.Solidity.Source

theorem registeredInitial (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (p a bounty : Nat) (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256) :
    fn.initialFrame? [.word p,.word a,.word bounty] = some
      [("proposedRepPerEthPrice",.word p),("requestedInitialAttoWeth",.word a),
       ("bountyAttoEth",.word bounty),("quote",Inv48.QuoteMemory.tuple 0 0 0 0 0)] := by
  have metadata := quoteMetadata fn linked
  simp [InternalFunction.initialFrame?,InternalFunction.returnDefaultBindings,metadata.1,metadata.2,
    quoteParams,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,Inv48.WholeQuote.quoteTy,
    Inv48.QuoteMemory.tuple,Nat.mod_eq_of_lt hp,Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hb]
end Inv48.RequestPrologue
