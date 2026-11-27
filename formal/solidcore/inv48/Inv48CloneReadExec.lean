import Inv48Model
open SolidCore.Solidity.Source
namespace Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

def cloneKey := "__internal___library_SecurityPoolBoundClones_universeBindings()#[]"
def universeKey := "__internal_universeId()#[]"
end Inv48.CloneRead

namespace Inv48.CloneRead
-- Nonuniform bindings detect offset, byte order, loop reset, and tuple selection mistakes.
def witnessImplementation : List Nat := List.replicate 20 0x11
def witnessUniverse : List Nat := (List.range 31).map (· + 1)
def witnessToken : List Nat := (List.range 20).map (· + 32)
def witnessCode : List Nat :=
  [0x36,0x3d,0x3d,0x37,0x3d,0x3d,0x3d,0x36,0x3d,0x73] ++
  witnessImplementation ++ [0x5a,0xf4,0x3d,0x82,0x80,0x3e,0x90,0x3d,0x91,0x60,0x2b,0x57,0xfd,0x5b,0xf3] ++
  witnessUniverse ++ witnessToken

/-- External-code assumption: the self account's runtime bytes are exactly `code`.
The initial state has no adopted external world, so `accountCodes` is authoritative.
No claim here establishes CREATE execution, delegatecall deployment provenance,
code immutability on a live chain, or the truth of an RPC/account-code oracle.
After world adoption the corresponding `State.envWorld?` self code must agree.
The Solidity length guard alone does not authenticate the forwarder prefix.
-/
def witnessContext (code : List Nat) : Context :=
  { Context.empty with self := 0xcafe, accountCodes := [(0xcafe,code)] }
def witnessRuntime : Runtime :=
  ((Runtime.ofState State.empty).declareLocal "u" (.word 0)).declareLocal "t" (.word 0)
def observe (code : List Nat) (key : String) (targets : List String) : Option (List Nat) :=
  match (Stmt.eval 512 Inv48.Source.model.core.table (witnessContext code) witnessRuntime
      (.internalCall targets key [])).runWith [] with
  | .ok (.normal r) => targets.mapM (fun name => match r.lookupLocal? name with
      | some (.word n) => some n
      | _ => none)
  | _ => none
end Inv48.CloneRead
