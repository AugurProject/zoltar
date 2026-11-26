import Inv39InitWrites
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv39.Init
inductive Key | universe | number | name | symbol | cap
def name : Key → String
  | .universe => "universeId" | .number => "repNumber" | .name => "_name" | .symbol => "_symbol" | .cap => "totalTheoreticalSupplyAttoRep"
def slot : Key → Nat | .universe => 6 | .number => 7 | .name => 3 | .symbol => 4 | .cap => 5
def scalar : Key → Bool | .name | .symbol => false | _ => true
def kind (k : Key) := if scalar k then StorageLayout.scalar .uint256 else StorageLayout.string
def field (k : Key) : StorageField :=
  { name := name k
    slot := slot k
    ty? := if scalar k then some .uint256 else none
    layout? := some (kind k)
    packedBytes := match k with | .universe => 31 | _ => 32 }
def metadata (f : StorageField) : Option (String × Nat × Bool × Nat) := do
  if f.transient || f.packedSigned || f.packedOffset != 0 then none else
  match f.ty?,f.layout? with
  | some .uint256,some (.scalar .uint256) => return (f.name,f.slot,true,f.packedBytes)
  | none,some .string => return (f.name,f.slot,false,f.packedBytes)
  | _,_ => none
def matchesKey (k : Key) := ((model.core.context.storageField? (name k)).bind metadata)==metadata (field k)
theorem equivalent (k : Key) (o : Option StorageField) (h : o.bind metadata=metadata (field k)) : o=some (field k) := by
  cases k <;> cases o with
  | none => contradiction
  | some f =>
    cases f; dsimp [metadata,field,kind,scalar,name,slot] at h ⊢
    split at h <;> try contradiction
    split at h <;> simp_all
end Inv39.Init
