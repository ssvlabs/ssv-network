import {
  ethereum,
  JSONValue,
  TypedMap,
  Entity,
  Bytes,
  Address,
  BigInt
} from '@graphprotocol/graph-ts';

export class NewOperator extends ethereum.Event {
  get params(): NewOperator__Params {
    return new NewOperator__Params(this);
  }
}

export class NewOperator__Params {
  _event: NewOperator;

  constructor(event: NewOperator) {
    this._event = event;
  }

  get id(): Bytes {
    return this._event.parameters[2].value.toBytes();
  }

  get name(): string {
    return this._event.parameters[0].value.toString();
  }

  get pubkey(): Bytes {
    return this._event.parameters[2].value.toBytes();
  }

  get ownerAddress(): Address {
    return this._event.parameters[1].value.toAddress();
  }
}