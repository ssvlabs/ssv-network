import { NewOperator } from './newOperator'
import { Operator } from './schema'

export function handleNewOperator(event: NewOperator): void {
  let operator = new Operator(event.params.id.toHex())
  operator.name = event.params.name
  operator.paymentAddress = event.params.paymentAddress
  operator.pubkey = event.params.pubkey
  operator.save()
}
