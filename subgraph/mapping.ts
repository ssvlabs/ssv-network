import { NewOperator } from './newOperator'
import { Operator } from './schema'

export function handleNewOperator(event: NewOperator): void {
  let operator = new Operator(event.params.id.toHex())
  operator.name = event.params.name
  operator.ownerAddress = event.params.ownerAddress
  operator.pubkey = event.params.pubkey
  operator.save()
}
